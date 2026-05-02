"""
Library agent — backend for Task #18 power-ups:
  - Soft-delete (Trash) + Archive on memories, notes, bookmarks
  - Bulk operations: delete, restore, purge, archive, unarchive,
    tag add/remove, move-to-project (memories only)
  - Smart Collections (saved Vault filter combos)
  - Global Tag Manager (rename / merge / delete cascade)
  - Deep full-text search across memories + notes + bookmarks
  - Related-memories suggestions (tag/domain overlap)
  - Pin toggle on memories

All reads/writes are scoped to the current user via belongs_to_current_user
and stamp() from app.user_context.

Trashed items have a `trashed_at` ISO timestamp; archived items have
`archived=True`. Deleting a trashed item via /trash/purge actually removes
the doc from Firestore.

Designed to work with both the in-memory MockFirestoreClient and real
Firestore (AsyncClient).
"""
import asyncio
import datetime
import re
import uuid
from typing import Any, Dict, List, Optional, Tuple

from app.db import get_db
from app.user_context import belongs_to_current_user, get_uid, stamp


def _utcnow_iso() -> str:
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


# Days an item can sit in Trash before it's eligible for purge. The frontend
# surfaces this number; we don't auto-purge on a schedule (no cron in this
# environment), but `purge_expired_trash` can be called at startup.
TRASH_TTL_DAYS = 30


# ─── Internal helpers ─────────────────────────────────────────────────────────

async def _scoped_docs(collection: str) -> List[Tuple[str, Dict[str, Any]]]:
    """Fetch every doc in `collection` owned by the current user."""
    db = await get_db()
    snap = await db.collection(collection).get()
    out: List[Tuple[str, Dict[str, Any]]] = []
    for d in snap:
        data = d.to_dict() or {}
        if belongs_to_current_user(data):
            out.append((d.id, data))
    return out


async def _doc(collection: str, doc_id: str) -> Optional[Dict[str, Any]]:
    db = await get_db()
    snap = await db.collection(collection).document(doc_id).get()
    if not snap.exists:
        return None
    data = snap.to_dict() or {}
    if not belongs_to_current_user(data):
        return None
    return data


async def _update(collection: str, doc_id: str, fields: Dict[str, Any]) -> None:
    db = await get_db()
    await db.collection(collection).document(doc_id).update(fields)


async def _hard_delete(collection: str, doc_id: str) -> None:
    db = await get_db()
    await db.collection(collection).document(doc_id).delete()


def _is_trashed(d: Dict[str, Any]) -> bool:
    return bool(d.get("trashed_at"))


def _is_archived(d: Dict[str, Any]) -> bool:
    return bool(d.get("archived"))


# ─── Soft-delete + restore + purge (works for memories/notes/bookmarks) ───────

ENTITY_COLLECTIONS = {
    "memory": "memories",
    "note": "notes",
    "bookmark": "bookmarks",
}


async def soft_delete(entity: str, ids: List[str]) -> Dict[str, Any]:
    """Mark items as trashed (sets trashed_at). Returns count moved."""
    coll = ENTITY_COLLECTIONS.get(entity)
    if not coll:
        raise ValueError(f"Unknown entity: {entity}")
    moved: List[str] = []
    now = _utcnow_iso()
    for doc_id in ids:
        d = await _doc(coll, doc_id)
        if d is None:
            continue
        await _update(coll, doc_id, {"trashed_at": now})
        moved.append(doc_id)
    return {"trashed": len(moved), "ids": moved}


async def restore_from_trash(entity: str, ids: List[str]) -> Dict[str, Any]:
    coll = ENTITY_COLLECTIONS.get(entity)
    if not coll:
        raise ValueError(f"Unknown entity: {entity}")
    restored: List[str] = []
    for doc_id in ids:
        d = await _doc(coll, doc_id)
        if d is None or not _is_trashed(d):
            continue
        # Firestore can't easily delete a field via update() for both backends,
        # so we set trashed_at to empty string. Readers treat both empty and
        # missing as "not trashed."
        await _update(coll, doc_id, {"trashed_at": ""})
        restored.append(doc_id)
    return {"restored": len(restored), "ids": restored}


async def purge_from_trash(entity: str, ids: List[str]) -> Dict[str, Any]:
    coll = ENTITY_COLLECTIONS.get(entity)
    if not coll:
        raise ValueError(f"Unknown entity: {entity}")
    purged: List[str] = []
    for doc_id in ids:
        d = await _doc(coll, doc_id)
        if d is None or not _is_trashed(d):
            continue
        await _hard_delete(coll, doc_id)
        purged.append(doc_id)
    return {"purged": len(purged), "ids": purged}


async def purge_expired_trash() -> Dict[str, Any]:
    """Hard-delete every trashed item (across memories/notes/bookmarks for
    the current user) whose 30-day grace window has elapsed. Safe to call
    on demand or from a scheduled job — items still inside the window are
    left untouched."""
    cutoff = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=TRASH_TTL_DAYS)
    purged: Dict[str, int] = {"memories": 0, "notes": 0, "bookmarks": 0}
    for entity, coll in ENTITY_COLLECTIONS.items():
        for doc_id, data in await _scoped_docs(coll):
            if not _is_trashed(data):
                continue
            ts = data.get("trashed_at")
            t: Optional[datetime.datetime]
            try:
                if isinstance(ts, datetime.datetime):
                    t = ts
                else:
                    t = datetime.datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
            except Exception:
                t = None
            if t is None or t > cutoff:
                continue
            await _hard_delete(coll, doc_id)
            key = f"{entity}s" if entity != "memory" else "memories"
            purged[key] = purged.get(key, 0) + 1
    return {"purged": purged, "cutoff": cutoff.isoformat(), "ttl_days": TRASH_TTL_DAYS}


async def list_trash() -> Dict[str, List[Dict[str, Any]]]:
    """Return trashed memories/notes/bookmarks for the current user, with
    a `days_left` countdown (purge after TRASH_TTL_DAYS)."""
    out: Dict[str, List[Dict[str, Any]]] = {"memories": [], "notes": [], "bookmarks": []}
    for entity, coll in ENTITY_COLLECTIONS.items():
        for doc_id, data in await _scoped_docs(coll):
            if not _is_trashed(data):
                continue
            data = dict(data)
            data["id"] = doc_id
            data["entity"] = entity
            data["days_left"] = _days_until_purge(data.get("trashed_at"))
            out[entity + "s" if entity != "memory" else "memories"].append(data)
    # Newest trashed first
    for k in out:
        out[k].sort(key=lambda x: str(x.get("trashed_at", "")), reverse=True)
    return out


def _days_until_purge(trashed_at: Any) -> int:
    if not trashed_at:
        return TRASH_TTL_DAYS
    try:
        if isinstance(trashed_at, str):
            ts = datetime.datetime.fromisoformat(trashed_at.replace("Z", "+00:00"))
        else:
            ts = trashed_at
        elapsed = (datetime.datetime.now(datetime.timezone.utc) - ts).days
        return max(0, TRASH_TTL_DAYS - elapsed)
    except Exception:
        return TRASH_TTL_DAYS


# ─── Archive + Pin (memories only — notes already have pin) ──────────────────

_ENTITY_TO_COLLECTION = {
    "memory": "memories",
    "memories": "memories",
    "note": "notes",
    "notes": "notes",
    "bookmark": "bookmarks",
    "bookmarks": "bookmarks",
}


async def set_archived(ids: List[str], archived: bool, entity: str = "memory") -> Dict[str, Any]:
    coll = _ENTITY_TO_COLLECTION.get((entity or "memory").lower(), "memories")
    changed: List[str] = []
    for doc_id in ids:
        d = await _doc(coll, doc_id)
        if d is None:
            continue
        patch: Dict[str, Any] = {"archived": bool(archived)}
        if coll == "memories":
            patch["reviewed"] = True
        await _update(coll, doc_id, patch)
        changed.append(doc_id)
    return {"updated": len(changed), "archived": archived, "entity": entity, "ids": changed}


async def set_pinned(memory_id: str, pinned: bool) -> Dict[str, Any]:
    d = await _doc("memories", memory_id)
    if d is None:
        raise ValueError(f"Memory {memory_id} not found")
    await _update("memories", memory_id, {"pinned": bool(pinned)})
    return {"id": memory_id, "pinned": bool(pinned)}


async def bulk_move_project(ids: List[str], project_id: Optional[str], entity: str = "memory") -> Dict[str, Any]:
    coll = _ENTITY_TO_COLLECTION.get((entity or "memory").lower(), "memories")
    pid = (project_id or "").strip() or None
    changed: List[str] = []
    for doc_id in ids:
        d = await _doc(coll, doc_id)
        if d is None:
            continue
        await _update(coll, doc_id, {"project_id": pid})
        changed.append(doc_id)
    return {"updated": len(changed), "project_id": pid, "entity": entity, "ids": changed}


# ─── Bulk tag operations on memories ─────────────────────────────────────────

def _norm_tags(tags: List[str]) -> List[str]:
    seen = set()
    out: List[str] = []
    for t in tags or []:
        tt = (t or "").strip()
        if tt and tt.lower() not in seen:
            seen.add(tt.lower())
            out.append(tt)
        if len(out) >= 24:
            break
    return out


async def bulk_tag_add(entity: str, ids: List[str], tags: List[str]) -> Dict[str, Any]:
    coll = ENTITY_COLLECTIONS.get(entity)
    if not coll:
        raise ValueError(f"Unknown entity: {entity}")
    add = _norm_tags(tags)
    if not add:
        return {"updated": 0, "ids": []}
    updated: List[str] = []
    for doc_id in ids:
        d = await _doc(coll, doc_id)
        if d is None:
            continue
        cur = list(d.get("tags") or [])
        cur_lc = {t.lower() for t in cur}
        for t in add:
            if t.lower() not in cur_lc:
                cur.append(t)
                cur_lc.add(t.lower())
        await _update(coll, doc_id, {"tags": _norm_tags(cur)})
        updated.append(doc_id)
    return {"updated": len(updated), "ids": updated}


async def bulk_tag_remove(entity: str, ids: List[str], tags: List[str]) -> Dict[str, Any]:
    coll = ENTITY_COLLECTIONS.get(entity)
    if not coll:
        raise ValueError(f"Unknown entity: {entity}")
    rm_lc = {t.strip().lower() for t in (tags or []) if t and t.strip()}
    if not rm_lc:
        return {"updated": 0, "ids": []}
    updated: List[str] = []
    for doc_id in ids:
        d = await _doc(coll, doc_id)
        if d is None:
            continue
        cur = [t for t in (d.get("tags") or []) if t.lower() not in rm_lc]
        await _update(coll, doc_id, {"tags": cur})
        updated.append(doc_id)
    return {"updated": len(updated), "ids": updated}


# ─── Global Tag Manager ──────────────────────────────────────────────────────

async def tags_index() -> List[Dict[str, Any]]:
    """All tags across memories+notes+bookmarks with usage counts."""
    counts: Dict[str, Dict[str, int]] = {}
    for entity, coll in ENTITY_COLLECTIONS.items():
        for _doc_id, data in await _scoped_docs(coll):
            if _is_trashed(data):
                continue
            for t in (data.get("tags") or []):
                key = (t or "").strip()
                if not key:
                    continue
                key_lc = key.lower()
                if key_lc not in counts:
                    counts[key_lc] = {"name": key, "memories": 0, "notes": 0, "bookmarks": 0}
                bucket = entity + "s" if entity != "memory" else "memories"
                counts[key_lc][bucket] = counts[key_lc].get(bucket, 0) + 1
    out = []
    for key_lc, info in counts.items():
        total = info["memories"] + info["notes"] + info["bookmarks"]
        out.append({**info, "total": total})
    out.sort(key=lambda x: (-x["total"], x["name"].lower()))
    return out


async def tag_rename(old: str, new: str) -> Dict[str, Any]:
    old_lc = (old or "").strip().lower()
    new_clean = (new or "").strip()
    if not old_lc or not new_clean:
        raise ValueError("old and new tag names required")
    changed = 0
    for entity, coll in ENTITY_COLLECTIONS.items():
        for doc_id, data in await _scoped_docs(coll):
            tags = data.get("tags") or []
            if not any(t.lower() == old_lc for t in tags):
                continue
            new_tags: List[str] = []
            seen = set()
            for t in tags:
                replacement = new_clean if t.lower() == old_lc else t
                if replacement.lower() not in seen:
                    seen.add(replacement.lower())
                    new_tags.append(replacement)
            await _update(coll, doc_id, {"tags": new_tags})
            changed += 1
    return {"renamed": True, "from": old, "to": new_clean, "items_updated": changed}


async def tag_merge(sources: List[str], target: str) -> Dict[str, Any]:
    """Merge several tags into one. All items carrying any source tag get the
    target tag added (deduped), and the source tags removed."""
    src_lc = {(s or "").strip().lower() for s in sources if s and s.strip()}
    target_clean = (target or "").strip()
    if not src_lc or not target_clean:
        raise ValueError("sources and target required")
    src_lc.discard(target_clean.lower())
    changed = 0
    for entity, coll in ENTITY_COLLECTIONS.items():
        for doc_id, data in await _scoped_docs(coll):
            tags = data.get("tags") or []
            tags_lc = [t.lower() for t in tags]
            if not any(s in tags_lc for s in src_lc):
                continue
            kept = [t for t in tags if t.lower() not in src_lc and t.lower() != target_clean.lower()]
            kept.append(target_clean)
            # Dedup, preserve case of first occurrence
            seen = set()
            new_tags = []
            for t in kept:
                if t.lower() not in seen:
                    seen.add(t.lower())
                    new_tags.append(t)
            await _update(coll, doc_id, {"tags": new_tags})
            changed += 1
    return {"merged": True, "sources": sorted(src_lc), "target": target_clean, "items_updated": changed}


async def tag_delete(name: str) -> Dict[str, Any]:
    name_lc = (name or "").strip().lower()
    if not name_lc:
        raise ValueError("tag name required")
    changed = 0
    for entity, coll in ENTITY_COLLECTIONS.items():
        for doc_id, data in await _scoped_docs(coll):
            tags = data.get("tags") or []
            if not any(t.lower() == name_lc for t in tags):
                continue
            new_tags = [t for t in tags if t.lower() != name_lc]
            await _update(coll, doc_id, {"tags": new_tags})
            changed += 1
    return {"deleted": True, "name": name, "items_updated": changed}


# ─── Smart Collections ────────────────────────────────────────────────────────

SMART_COLLECTIONS = "smart_collections"


async def list_smart_collections() -> List[Dict[str, Any]]:
    out = []
    for doc_id, data in await _scoped_docs(SMART_COLLECTIONS):
        d = dict(data)
        d["id"] = doc_id
        out.append(d)
    out.sort(key=lambda x: str(x.get("created_at", "")), reverse=True)
    return out


async def create_smart_collection(name: str, filters: Dict[str, Any]) -> Dict[str, Any]:
    name = (name or "").strip()
    if not name:
        raise ValueError("name required")
    db = await get_db()
    cid = str(uuid.uuid4())[:10]
    doc = stamp({
        "id": cid,
        "name": name[:80],
        "filters": filters or {},
        "created_at": _utcnow_iso(),
        "updated_at": _utcnow_iso(),
    })
    await db.collection(SMART_COLLECTIONS).document(cid).set(doc)
    return doc


async def update_smart_collection(cid: str, name: Optional[str], filters: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    d = await _doc(SMART_COLLECTIONS, cid)
    if d is None:
        raise ValueError(f"Smart collection {cid} not found")
    updates: Dict[str, Any] = {"updated_at": _utcnow_iso()}
    if name is not None:
        nm = name.strip()[:80]
        if nm:
            updates["name"] = nm
    if filters is not None:
        updates["filters"] = filters
    await _update(SMART_COLLECTIONS, cid, updates)
    d.update(updates)
    d["id"] = cid
    return d


async def delete_smart_collection(cid: str) -> Dict[str, Any]:
    d = await _doc(SMART_COLLECTIONS, cid)
    if d is None:
        raise ValueError(f"Smart collection {cid} not found")
    await _hard_delete(SMART_COLLECTIONS, cid)
    return {"deleted": True, "id": cid}


# ─── Deep full-text search ───────────────────────────────────────────────────

_HIGHLIGHT_PRE = "<<HL>>"
_HIGHLIGHT_POST = "<</HL>>"


def _build_snippet(text: str, query: str, radius: int = 80) -> str:
    """Return a ~160-char snippet around the first match, with the matched
    phrase wrapped in <<HL>>...<</HL>> markers (frontend converts to <mark>).
    """
    if not text or not query:
        return ""
    q = query.strip()
    if not q:
        return ""
    body = text.replace("\n", " ").strip()
    lc = body.lower()
    qlc = q.lower()
    idx = lc.find(qlc)
    if idx < 0:
        # Try matching individual words
        for w in qlc.split():
            if len(w) < 3:
                continue
            j = lc.find(w)
            if j >= 0:
                idx = j
                qlc = w
                break
    if idx < 0:
        return body[: radius * 2] + ("…" if len(body) > radius * 2 else "")
    start = max(0, idx - radius)
    end = min(len(body), idx + len(qlc) + radius)
    snippet = body[start:end]
    # Re-find within snippet (case-insensitive) and wrap
    rx = re.compile(re.escape(qlc), re.IGNORECASE)
    snippet = rx.sub(lambda m: f"{_HIGHLIGHT_PRE}{m.group(0)}{_HIGHLIGHT_POST}", snippet)
    prefix = "…" if start > 0 else ""
    suffix = "…" if end < len(body) else ""
    return f"{prefix}{snippet}{suffix}"


async def deep_search(
    query: str,
    limit: int = 30,
    entities: Optional[List[str]] = None,
) -> Dict[str, List[Dict[str, Any]]]:
    """Full-text search across memories (title, summary, key_points, notes,
    executive_summary), notes (title, content), bookmarks (title, description,
    url). Returns matched rows with a snippet preview.

    `entities` optionally restricts the search to a subset of
    {"memory", "note", "bookmark"}. When omitted or empty, all three are
    searched. Buckets that aren't requested are returned empty so the
    response shape stays stable for callers.
    """
    q = (query or "").strip()
    if not q:
        return {"memories": [], "notes": [], "bookmarks": []}
    qlc = q.lower()
    wanted = {e.strip().lower() for e in (entities or []) if e and e.strip()}
    want_memories = not wanted or "memory" in wanted
    want_notes = not wanted or "note" in wanted
    want_bookmarks = not wanted or "bookmark" in wanted

    def _matches(text: str) -> bool:
        return qlc in (text or "").lower()

    out: Dict[str, List[Dict[str, Any]]] = {"memories": [], "notes": [], "bookmarks": []}

    if not want_memories:
        memory_iter: List = []
    else:
        memory_iter = list(await _scoped_docs("memories"))
    for doc_id, data in memory_iter:
        if _is_trashed(data):
            continue
        # Defensive: include any extracted body, transcript, or full-text fields
        # the document may carry (PDF extraction, audio transcript, page content, etc.).
        haystack_parts = [
            data.get("title", ""),
            data.get("summary", ""),
            data.get("executive_summary", ""),
            data.get("notes", ""),
            data.get("transcript", ""),
            data.get("extracted_text", ""),
            data.get("body", ""),
            data.get("content", ""),
            data.get("raw_content", ""),
            data.get("full_text", ""),
            data.get("page_text", ""),
            data.get("description", ""),
            data.get("source_url", ""),
            " ".join(data.get("key_points") or []),
            " ".join(data.get("tags") or []),
            " ".join(data.get("action_items") or []),
            " ".join(data.get("quotes") or []),
        ]
        haystack = "\n".join(p for p in haystack_parts if p)
        if not _matches(haystack):
            continue
        snippet = _build_snippet(haystack, q)
        row = {
            "id": doc_id,
            "title": data.get("title"),
            "summary": (data.get("summary") or "")[:200],
            "domain": data.get("domain"),
            "source_type": data.get("source_type"),
            "source_url": data.get("source_url"),
            "tags": data.get("tags") or [],
            "snippet": snippet,
            "created_at": _to_iso(data.get("created_at")),
        }
        out["memories"].append(row)

    notes_iter = await _scoped_docs("notes") if want_notes else []
    for doc_id, data in notes_iter:
        if _is_trashed(data):
            continue
        haystack = "\n".join([data.get("title", ""), data.get("content", ""), " ".join(data.get("tags") or [])])
        if not _matches(haystack):
            continue
        out["notes"].append({
            "id": doc_id,
            "title": data.get("title"),
            "snippet": _build_snippet(haystack, q),
            "tags": data.get("tags") or [],
            "updated_at": _to_iso(data.get("updated_at")),
        })

    bookmarks_iter = await _scoped_docs("bookmarks") if want_bookmarks else []
    for doc_id, data in bookmarks_iter:
        if _is_trashed(data):
            continue
        haystack = "\n".join([
            data.get("title", ""), data.get("url", ""), data.get("description", ""),
            " ".join(data.get("tags") or [])
        ])
        if not _matches(haystack):
            continue
        out["bookmarks"].append({
            "id": doc_id,
            "title": data.get("title"),
            "url": data.get("url"),
            "snippet": _build_snippet(haystack, q),
            "tags": data.get("tags") or [],
            "created_at": _to_iso(data.get("created_at")),
        })

    # Cap each bucket
    out["memories"] = out["memories"][:limit]
    out["notes"] = out["notes"][:limit]
    out["bookmarks"] = out["bookmarks"][:limit]
    return out


def _to_iso(v: Any) -> str:
    if v is None:
        return ""
    if hasattr(v, "isoformat"):
        return v.isoformat()
    return str(v)


# ─── Related memories ────────────────────────────────────────────────────────

async def related_memories(memory_id: str, limit: int = 5) -> List[Dict[str, Any]]:
    """Find memories sharing tags or domain with the given one. Scored by
    overlap. Excludes trashed and the source memory itself."""
    src = await _doc("memories", memory_id)
    if src is None:
        return []
    src_tags = {t.lower() for t in (src.get("tags") or [])}
    src_domain = src.get("domain")

    scored: List[Tuple[int, Dict[str, Any], str]] = []
    for doc_id, data in await _scoped_docs("memories"):
        if doc_id == memory_id or _is_trashed(data):
            continue
        tags = {t.lower() for t in (data.get("tags") or [])}
        overlap = len(tags & src_tags)
        domain_match = 1 if data.get("domain") == src_domain else 0
        score = overlap * 2 + domain_match
        if score <= 0:
            continue
        scored.append((score, data, doc_id))

    scored.sort(key=lambda x: x[0], reverse=True)
    out = []
    for score, data, doc_id in scored[:limit]:
        out.append({
            "id": doc_id,
            "title": data.get("title"),
            "domain": data.get("domain"),
            "source_type": data.get("source_type"),
            "summary": (data.get("summary") or "")[:160],
            "tags": data.get("tags") or [],
            "score": score,
        })
    return out


# ─── W2-B1/B2: Memory ↔ everything links (single fan-out + writer) ───────────
#
# Each memory holds inverse pointers as scalar lists on the doc:
#   linked_task_ids, linked_event_ids, linked_revisit_ids,
#   linked_habit_ids, linked_memory_ids
# plus a `project_id` for the workspace folder it lives under.
#
# The target entities ALSO carry a back-pointer:
#   task.linked_memory_id (single)      schedule.linked_memory_id (single)
#   revisit.memory_id     (single)      habit.linked_memory_ids   (list)
#   memory.linked_memory_ids            (list — symmetric for memory↔memory)
#
# `link_memory_to` writes BOTH sides; `unlink_memory_from` clears both.
# `get_memory_links` reads from the memory's lists *and* reverse-queries
# each collection so back-pointers added before the lists existed (or
# created via a third-party flow that forgot to update the memory) still
# show up — defensive de-dupe on doc id.

_LINK_KINDS = {"task", "event", "revisit", "habit", "memory", "folder", "external_ref"}

# Per-memory in-process lock so back-to-back link / unlink calls on the
# *same* memory serialise and avoid the classic Firestore-RMW lost-update
# (read list → mutate → write) when two requests interleave. The mock
# Firestore client + the real AsyncClient both lack atomic ArrayUnion
# helpers in this codebase, so a process-local lock is the pragmatic
# guard. Cross-process correctness still requires Firestore transactions
# (out of scope for W2-B2); this at minimum kills the most common race
# of a UI double-click into the same handler. Bounded growth is fine
# because the dict only grows by `mid` strings the user actually mutates.
_MEMORY_LINK_LOCKS: Dict[str, asyncio.Lock] = {}


def _link_lock_for(memory_id: str) -> asyncio.Lock:
    lock = _MEMORY_LINK_LOCKS.get(memory_id)
    if lock is None:
        lock = asyncio.Lock()
        _MEMORY_LINK_LOCKS[memory_id] = lock
    return lock

# Maps the public `kind` to (memory list field, target collection,
# inverse field name on the target, "single" or "list"). `None`
# entries mean "handled out-of-band" (folder, external_ref).
_KIND_SPEC: Dict[str, Optional[Tuple[str, str, str, str]]] = {
    "task":    ("linked_task_ids",    "tasks",     "linked_memory_id",  "single"),
    "event":   ("linked_event_ids",   "schedules", "linked_memory_id",  "single"),
    "revisit": ("linked_revisit_ids", "revisits",  "memory_id",         "single"),
    "habit":   ("linked_habit_ids",   "habits",    "linked_memory_ids", "list"),
    "memory":  ("linked_memory_ids",  "memories",  "linked_memory_ids", "list"),
    "folder":      None,
    "external_ref": None,
}


async def _resolve_folder_for_memory(memory_id: str, project_id: str) -> Optional[Dict[str, Any]]:
    """Return {project_id, project_name, folder_id, folder_name} for the
    folder this memory currently lives in, or None if it isn't filed.
    Looks up the workspace_project's items[] for a row whose
    `ref_id == memory_id` to find the folder_id, then resolves the
    folder name from the project's folders[]."""
    if not project_id:
        return None
    proj = await _doc("workspace_projects", project_id)
    if not proj:
        return None
    items = proj.get("items") or []
    item = next((it for it in items if it.get("ref_id") == memory_id), None)
    folder_id = (item or {}).get("folder_id") or ""
    folder_name = ""
    for f in (proj.get("folders") or []):
        if f.get("id") == folder_id:
            folder_name = f.get("name") or ""
            break
    return {
        "project_id": project_id,
        "project_name": proj.get("name") or "",
        "folder_id": folder_id,
        "folder_name": folder_name,
    }


async def _list_linked_tasks(memory_id: str, ids: set) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    seen: set = set()
    for tid, data in await _scoped_docs("tasks"):
        if _is_trashed(data):
            continue
        if tid in ids or data.get("linked_memory_id") == memory_id:
            if tid in seen:
                continue
            seen.add(tid)
            out.append({
                "id": tid,
                "title": data.get("title") or "",
                "status": data.get("status") or "pending",
                "due_date": data.get("due_date") or "",
            })
    return out


async def _list_linked_events(memory_id: str, ids: set) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    seen: set = set()
    for eid, data in await _scoped_docs("schedules"):
        if eid in ids or data.get("linked_memory_id") == memory_id:
            if eid in seen:
                continue
            seen.add(eid)
            out.append({
                "id": eid,
                "title": data.get("title") or "",
                "date": data.get("date") or "",
                "time": data.get("time") or "",
            })
    out.sort(key=lambda e: (e.get("date") or "", e.get("time") or ""))
    return out


async def _list_linked_revisits(memory_id: str, ids: set) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    seen: set = set()
    for rid, data in await _scoped_docs("revisits"):
        if rid in ids or data.get("memory_id") == memory_id:
            if rid in seen:
                continue
            seen.add(rid)
            out.append({
                "id": rid,
                "frequency": data.get("frequency") or "",
                "next_due": data.get("next_due") or "",
                "status": data.get("status") or "active",
            })
    return out


async def _list_linked_habits(memory_id: str, ids: set) -> List[Dict[str, Any]]:
    # Compute streak inline rather than importing _compute_streak to
    # avoid a circular import — habits live in extras_agent, which may
    # in future import library_agent.
    today = datetime.date.today()
    out: List[Dict[str, Any]] = []
    seen: set = set()
    for hid, data in await _scoped_docs("habits"):
        if data.get("trashed_at"):
            continue
        linked = list(data.get("linked_memory_ids") or [])
        if hid in ids or memory_id in linked:
            if hid in seen:
                continue
            seen.add(hid)
            completed = set(data.get("completions") or [])
            streak = 0
            cur = today
            while cur.isoformat() in completed:
                streak += 1
                cur -= datetime.timedelta(days=1)
            out.append({
                "id": hid,
                "name": data.get("name") or "",
                "streak": streak,
            })
    return out


async def _list_linked_flashcards(memory_id: str) -> List[Dict[str, Any]]:
    """Flashcards aren't persisted yet — `generate_flashcards` returns
    them on demand without a save. Return [] today; the contract is
    stable so a future flashcard-decks collection can plug in here
    without touching callers."""
    return []


async def get_memory_links(memory_id: str, user_id: Optional[str] = None) -> Dict[str, Any]:
    """Single-round-trip fan-out: every link surface for the memory
    detail page in one payload. Each fan-out is async and runs
    concurrently via `asyncio.gather`; partial failures degrade
    gracefully (the failed slot returns its empty default rather than
    blowing up the whole response)."""
    src = await _doc("memories", memory_id)
    if src is None:
        raise ValueError(f"Memory '{memory_id}' not found.")

    linked_task_ids    = set(src.get("linked_task_ids")    or [])
    linked_event_ids   = set(src.get("linked_event_ids")   or [])
    linked_revisit_ids = set(src.get("linked_revisit_ids") or [])
    linked_habit_ids   = set(src.get("linked_habit_ids")   or [])
    project_id         = src.get("project_id") or ""

    # Local import to dodge an import cycle (external_refs imports
    # nothing from library_agent today, but the safe pattern keeps it
    # that way).
    from app import external_refs as _ext

    folder, tasks, events, revisits, habits, flashcards, related, externals = await asyncio.gather(
        _resolve_folder_for_memory(memory_id, project_id),
        _list_linked_tasks(memory_id, linked_task_ids),
        _list_linked_events(memory_id, linked_event_ids),
        _list_linked_revisits(memory_id, linked_revisit_ids),
        _list_linked_habits(memory_id, linked_habit_ids),
        _list_linked_flashcards(memory_id),
        related_memories(memory_id, limit=5),
        _ext.list_for_memory(memory_id),
        return_exceptions=True,
    )

    def _safe(v: Any, default: Any) -> Any:
        if isinstance(v, BaseException):
            print(f"get_memory_links sub-fetch failed: {v!r}")
            return default
        return v

    related_payload = [
        {
            "id":    r.get("id"),
            "title": r.get("title") or "",
            "score": int(r.get("score", 0) or 0),
        }
        for r in (_safe(related, []) or [])
    ]
    external_payload = [
        {
            "id":     e.get("id"),
            "source": e.get("source") or "",
            "title":  e.get("title") or "",
            "url":    e.get("url") or "",
        }
        for e in (_safe(externals, []) or [])
    ]

    return {
        "folder":           _safe(folder, None),
        "tasks":            _safe(tasks, []),
        "events":           _safe(events, []),
        "revisits":         _safe(revisits, []),
        "habits":           _safe(habits, []),
        "flashcards":       _safe(flashcards, []),
        "related_memories": related_payload,
        "external_refs":    external_payload,
    }


async def _add_id(collection: str, doc_id: str, field: str, value: str) -> None:
    """Append `value` to a list field on `collection/doc_id` (deduped),
    or set it as a scalar when the field is a single string. Caller
    has already verified ownership of the doc."""
    db = await get_db()
    snap = await db.collection(collection).document(doc_id).get()
    if not snap.exists:
        return
    data = snap.to_dict() or {}
    cur = data.get(field)
    if isinstance(cur, list):
        if value in cur:
            return
        new_val: Any = list(cur) + [value]
    else:
        # scalar (single back-pointer slot — task / event / revisit)
        if cur == value:
            return
        new_val = value
    await db.collection(collection).document(doc_id).update({field: new_val})


async def _remove_id(collection: str, doc_id: str, field: str, value: str) -> None:
    db = await get_db()
    snap = await db.collection(collection).document(doc_id).get()
    if not snap.exists:
        return
    data = snap.to_dict() or {}
    cur = data.get(field)
    if isinstance(cur, list):
        if value not in cur:
            return
        new_val: Any = [v for v in cur if v != value]
    else:
        # scalar — only clear if it currently points at `value`, so we
        # never clobber an unrelated link by accident.
        if cur != value:
            return
        new_val = ""
    await db.collection(collection).document(doc_id).update({field: new_val})


def _parse_folder_ref(ref_id: str) -> Tuple[str, str]:
    """`ref_id` for a folder link is "project_id" (folder defaults to
    inbox/empty) or "project_id/folder_id"."""
    if not ref_id:
        return "", ""
    if "/" in ref_id:
        pid, fid = ref_id.split("/", 1)
        return pid.strip(), fid.strip()
    return ref_id.strip(), ""


async def _link_folder(memory_id: str, mem: Dict[str, Any], ref_id: str) -> None:
    project_id, folder_id = _parse_folder_ref(ref_id)
    if not project_id:
        raise ValueError("folder ref_id requires a project_id (got empty).")
    proj = await _doc("workspace_projects", project_id)
    if not proj:
        raise ValueError(f"Project '{project_id}' not found.")
    if folder_id:
        known_folder_ids = {f.get("id") for f in (proj.get("folders") or [])}
        if folder_id not in known_folder_ids:
            raise ValueError(f"Folder '{folder_id}' not found in project '{project_id}'.")
    db = await get_db()
    # 1. Update memory.project_id
    await db.collection("memories").document(memory_id).update({"project_id": project_id})
    # 2. Add a workspace item if this memory isn't already filed under
    #    the project. Goes through workspace_agent.add_items so the
    #    section / metadata defaults stay consistent with elsewhere.
    items = proj.get("items") or []
    if not any(it.get("ref_id") == memory_id for it in items):
        from app.workspace_agent import add_items as ws_add_items
        await ws_add_items(project_id, [{
            "kind":   "memory",
            "ref_id": memory_id,
            "title":  mem.get("title") or "Untitled",
            "url":    mem.get("source_url") or "",
        }], folder_id=folder_id or None)


async def _unlink_folder(memory_id: str, mem: Dict[str, Any], ref_id: str) -> None:
    project_id, _ = _parse_folder_ref(ref_id)
    if not project_id:
        return
    if (mem.get("project_id") or "") != project_id:
        # Memory isn't in this project — nothing to unlink. No raise so
        # repeated DELETEs are idempotent.
        return
    db = await get_db()
    await db.collection("memories").document(memory_id).update({"project_id": ""})
    proj = await _doc("workspace_projects", project_id)
    if not proj:
        return
    items = [it for it in (proj.get("items") or []) if it.get("ref_id") != memory_id]
    proj["items"] = items
    proj["updated_at"] = _utcnow_iso()
    await db.collection("workspace_projects").document(project_id).set(proj)


async def link_memory_to(memory_id: str, kind: str, ref_id: str) -> Dict[str, Any]:
    """Generic bidirectional link writer. Verifies both sides belong to
    the current user before mutating, then writes BOTH ends so a later
    `get_memory_links` returns the new edge regardless of which side
    is queried first.

    Concurrency: serialised per-memory via `_link_lock_for(memory_id)`
    so two rapid clicks on the same memory's "Link" CTA can't lose
    each other's writes via the read-modify-write cycle on
    `linked_*_ids`."""
    kind = (kind or "").strip().lower()
    if kind not in _LINK_KINDS:
        raise ValueError(f"Unknown link kind '{kind}'. Allowed: {sorted(_LINK_KINDS)}")
    ref_id = (ref_id or "").strip()
    if not ref_id:
        raise ValueError("ref_id is required.")

    async with _link_lock_for(memory_id):
        # Re-fetch memory inside the lock so we're working on the
        # post-prior-write view, not a snapshot taken before the
        # competing call landed.
        mem = await _doc("memories", memory_id)
        if mem is None:
            raise ValueError(f"Memory '{memory_id}' not found.")

        if kind == "folder":
            await _link_folder(memory_id, mem, ref_id)
            return {"success": True, "memory_id": memory_id, "kind": kind, "ref_id": ref_id}

        if kind == "external_ref":
            # Two flavours:
            #   1. ref_id is an existing external_refs doc id → re-parent
            #      it to this memory.
            #   2. ref_id is "source:source_id[:title[:url]]" → create a
            #      new external_ref. (Sugar so the frontend can link
            #      without two round-trips.)
            from app import external_refs as _ext
            existing = await _ext.get_ref(ref_id)
            if existing is not None:
                db = await get_db()
                await db.collection(_ext._COLLECTION).document(ref_id).update({
                    "memory_id": memory_id,
                })
                return {"success": True, "memory_id": memory_id, "kind": kind, "ref_id": ref_id}
            # Sugar: "source:source_id" or "source:source_id:title:url"
            parts = ref_id.split(":", 3)
            if len(parts) < 2:
                raise ValueError(
                    "external_ref ref_id must be an existing ref id or "
                    "'source:source_id[:title:url]'."
                )
            source = parts[0]
            source_id = parts[1]
            title = parts[2] if len(parts) > 2 else ""
            url = parts[3] if len(parts) > 3 else ""
            created = await _ext.create_external_ref(
                memory_id=memory_id, source=source, source_id=source_id,
                title=title, url=url,
            )
            return {
                "success": True, "memory_id": memory_id, "kind": kind,
                "ref_id": created["id"],
            }

        spec = _KIND_SPEC[kind]
        assert spec is not None  # narrowed by the early returns above
        mem_field, target_collection, inverse_field, inverse_kind = spec

        # Self-link guard for memory↔memory.
        if kind == "memory" and ref_id == memory_id:
            raise ValueError("Cannot link a memory to itself.")

        # Verify target ownership.
        target = await _doc(target_collection, ref_id)
        if target is None:
            raise ValueError(f"{kind.capitalize()} '{ref_id}' not found.")

        # Re-link cleanup for SCALAR-inverse kinds (task / event /
        # revisit). If this target is currently pointing at some OTHER
        # memory, that other memory's `linked_*_ids` still has our
        # ref_id and a future GET on it would falsely report the link.
        # Strip the ref from the previous memory's list before we
        # repoint the inverse here.
        if inverse_kind == "single":
            prev_memory_id = (target.get(inverse_field) or "").strip()
            if prev_memory_id and prev_memory_id != memory_id:
                # Acquire the lock for the *other* memory too. Always
                # acquire in id-sorted order to dodge AB/BA deadlock
                # if two parallel re-links cross over each other.
                first, second = sorted([memory_id, prev_memory_id])
                # We already hold our own lock; only acquire the other.
                other_lock = _link_lock_for(prev_memory_id) if first == memory_id else None
                if other_lock is not None:
                    async with other_lock:
                        await _remove_id("memories", prev_memory_id, mem_field, ref_id)
                else:
                    # prev_memory_id sorts first → release our lock
                    # logic isn't possible mid-context; settle for a
                    # best-effort un-locked update. Same-process races
                    # here are inherently rare (two diff memories both
                    # re-linking the SAME task at the SAME instant).
                    await _remove_id("memories", prev_memory_id, mem_field, ref_id)

        # 1. Memory side — append to its list.
        db = await get_db()
        cur_ids = list(mem.get(mem_field) or [])
        if ref_id not in cur_ids:
            cur_ids.append(ref_id)
            await db.collection("memories").document(memory_id).update({mem_field: cur_ids})

        # 2. Target side — set scalar or append to list per spec.
        await _add_id(target_collection, ref_id, inverse_field, memory_id)

        # 3. Symmetric memory↔memory: also append the source onto the
        #    other memory's list so a future GET on the other side
        #    returns this edge too. _add_id handles dedupe. Wrap in
        #    the other memory's lock to keep its list RMW serialised.
        if kind == "memory":
            async with _link_lock_for(ref_id):
                await _add_id("memories", ref_id, "linked_memory_ids", memory_id)

        return {"success": True, "memory_id": memory_id, "kind": kind, "ref_id": ref_id}


async def unlink_memory_from(memory_id: str, kind: str, ref_id: str) -> Dict[str, Any]:
    """Inverse of `link_memory_to`. Idempotent: missing edges return
    `{success: True}` rather than raising, so a duplicate DELETE from
    the UI doesn't 500. Serialised per-memory like the linker so
    unlink/link races don't lose each other's list mutation."""
    kind = (kind or "").strip().lower()
    if kind not in _LINK_KINDS:
        raise ValueError(f"Unknown link kind '{kind}'. Allowed: {sorted(_LINK_KINDS)}")
    ref_id = (ref_id or "").strip()
    if not ref_id:
        raise ValueError("ref_id is required.")

    async with _link_lock_for(memory_id):
        mem = await _doc("memories", memory_id)
        if mem is None:
            raise ValueError(f"Memory '{memory_id}' not found.")

        if kind == "folder":
            await _unlink_folder(memory_id, mem, ref_id)
            return {"success": True, "memory_id": memory_id, "kind": kind, "ref_id": ref_id}

        if kind == "external_ref":
            from app import external_refs as _ext
            removed = await _ext.delete(ref_id)
            return {
                "success": True, "memory_id": memory_id, "kind": kind,
                "ref_id": ref_id, "removed": removed,
            }

        spec = _KIND_SPEC[kind]
        assert spec is not None
        mem_field, target_collection, inverse_field, _inverse_kind = spec

        # 1. Memory side.
        db = await get_db()
        cur_ids = list(mem.get(mem_field) or [])
        if ref_id in cur_ids:
            cur_ids = [i for i in cur_ids if i != ref_id]
            await db.collection("memories").document(memory_id).update({mem_field: cur_ids})

        # 2. Target side — only touch if it still belongs to this user
        #    (deleted targets just leave a dangling list entry which we've
        #    already cleared above).
        target = await _doc(target_collection, ref_id)
        if target is not None:
            await _remove_id(target_collection, ref_id, inverse_field, memory_id)

        if kind == "memory":
            async with _link_lock_for(ref_id):
                await _remove_id("memories", ref_id, "linked_memory_ids", memory_id)

        return {"success": True, "memory_id": memory_id, "kind": kind, "ref_id": ref_id}
