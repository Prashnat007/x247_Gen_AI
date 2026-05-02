"""
External refs — third-party documents (Notion pages, Gmail threads,
Slack messages, Drive files) that the user has explicitly linked to a
memory. Stored in a flat Firestore collection `external_refs`, scoped
to the current user via `user_id`.

Unlike the memory ↔ task / event / revisit / habit links — which write
the inverse pointer onto the target entity — external refs ARE the
link: each row carries `memory_id` so `list_for_memory` is a simple
filtered scan and there is no "other side" to keep in sync.

Sources are restricted to a known list so a stray "twitter" or
"random" string can never sneak into the saved doc and break the
frontend's source-aware rendering / icon lookup.
"""
import datetime
import uuid
from typing import List, Optional

from app.db import get_db
from app.user_context import belongs_to_current_user, get_uid


_COLLECTION = "external_refs"
_ALLOWED_SOURCES = {"notion", "gmail", "slack", "drive"}


def _utcnow_iso() -> str:
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def _normalise_source(source: str) -> str:
    s = (source or "").strip().lower()
    if s not in _ALLOWED_SOURCES:
        raise ValueError(
            f"Invalid source '{source}'. Must be one of {sorted(_ALLOWED_SOURCES)}."
        )
    return s


async def create_external_ref(
    memory_id: str,
    source: str,
    source_id: str,
    title: str = "",
    url: str = "",
    snippet: str = "",
) -> dict:
    """Create + persist an ExternalRef for `memory_id`. Caller is
    responsible for verifying that `memory_id` exists and belongs to
    the current user — we don't re-check here because the only callsite
    today (link_memory_to) already does that gate."""
    src = _normalise_source(source)
    rid = str(uuid.uuid4())[:12]
    doc = {
        "id": rid,
        "memory_id": (memory_id or "").strip(),
        "source": src,
        "source_id": (source_id or "").strip()[:240],
        "title": (title or "").strip()[:240],
        "url": (url or "").strip()[:2048],
        "snippet": (snippet or "").strip()[:1000],
        "synced_at": _utcnow_iso(),
        "user_id": get_uid(),
    }
    db = await get_db()
    await db.collection(_COLLECTION).document(rid).set(doc)
    return doc


async def list_for_memory(memory_id: str) -> List[dict]:
    """Return every external_ref attached to `memory_id` for the
    current user, newest synced first."""
    if not memory_id:
        return []
    db = await get_db()
    snap = await db.collection(_COLLECTION).get()
    out: List[dict] = []
    for d in snap:
        data = (d.to_dict() or {}) | {"id": d.id}
        if not belongs_to_current_user(data):
            continue
        if data.get("memory_id") != memory_id:
            continue
        out.append(data)
    out.sort(key=lambda r: r.get("synced_at") or "", reverse=True)
    return out


async def get_ref(ref_id: str) -> Optional[dict]:
    """Fetch a single ref by id, scoped to current user."""
    if not ref_id:
        return None
    db = await get_db()
    snap = await db.collection(_COLLECTION).document(ref_id).get()
    if not snap.exists:
        return None
    data = snap.to_dict() or {}
    if not belongs_to_current_user(data):
        return None
    data["id"] = ref_id
    return data


async def delete(ref_id: str) -> bool:
    """Hard-delete an external ref. Returns True if removed, False if
    not found / not owned by current user."""
    existing = await get_ref(ref_id)
    if not existing:
        return False
    db = await get_db()
    await db.collection(_COLLECTION).document(ref_id).delete()
    return True
