"""
Global Search — W3 Universal Linker (Cmd-K palette).

Fans out a single text query across every "linkable" entity collection
(memories, tasks, events, revisits, habits, folders) and returns a
single ranked list the frontend palette can render without knowing
which kind any given hit came from.

Design notes
────────────
- We piggy-back on each agent's existing `list_*` helper instead of
  hitting Firestore directly. That way per-user scoping, soft-delete,
  and "in-app substring filter where Firestore can't index" stay in one
  place (the agent) and the search endpoint never needs to be patched
  when a collection adds a new dimension.
- Scoring is intentionally simple: `text_match * 100 + recency_boost`.
  Title/name matches outrank substring-only matches, and recent items
  float to the top within the same match tier so the palette feels
  "alive" instead of returning a pile of equally-good rows.
- Per-kind helpers all run concurrently via `asyncio.gather` so the
  total p95 stays close to the slowest single helper rather than the
  sum of them. The palette debounces typing on the client (≥150ms) so
  we don't hammer Firestore on every keystroke.
- Flashcards are intentionally absent — no real collection backs them
  yet (see MemoryLinksPanel and MemoryLinkKind). External_refs are
  also out: they're per-memory metadata rows, not standalone targets
  the user would want to "jump to".
"""
from __future__ import annotations

import asyncio
import datetime
from typing import Any, Dict, List, Optional, Sequence

from app import calendar_agent, extras_agent, recall_agent, revisit_agent, task_agent
from app.workspace_agent import list_flat_folders as ws_list_flat_folders


# All kinds the palette knows how to render. Keep in lockstep with the
# `Kind` union in src/contexts/LinkerContext.tsx — adding a kind here
# without a frontend match means hits silently disappear from results.
ALL_KINDS: Sequence[str] = (
    "memory", "task", "event", "revisit", "habit", "folder",
)


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


def _parse_iso(s: Any) -> Optional[datetime.datetime]:
    if not s:
        return None
    if isinstance(s, datetime.datetime):
        return s if s.tzinfo else s.replace(tzinfo=datetime.timezone.utc)
    try:
        # `fromisoformat` handles both naive and aware ISO strings on 3.11+
        dt = datetime.datetime.fromisoformat(str(s).replace("Z", "+00:00"))
        return dt if dt.tzinfo else dt.replace(tzinfo=datetime.timezone.utc)
    except Exception:
        return None


def _recency_boost(iso_ts: Any) -> float:
    """Linear decay from 30→0 across the last 30 days. Items older than
    a month contribute nothing — we don't want a four-year-old memory
    out-ranking a fresh task just because both share the same word."""
    dt = _parse_iso(iso_ts)
    if dt is None:
        return 0.0
    age_days = max(0.0, (_now() - dt).total_seconds() / 86400.0)
    if age_days >= 30:
        return 0.0
    return 30.0 - age_days


def _score(needle: str, title: str, body: str, ts: Any) -> float:
    """Composite score. Returns 0 when the needle doesn't appear in
    either field so callers can prune non-matches with a single check."""
    nlc = needle.lower()
    tlc = (title or "").lower()
    blc = (body or "").lower()
    if not nlc:
        # Empty query → recency-only ranking (used when a section opens
        # with nothing typed yet, so the user still sees recent items).
        return _recency_boost(ts)
    match = 0.0
    if nlc in tlc:
        # Word-start matches outrank mid-word substring hits — typing
        # "rec" should surface "Recall plan" before "Project recall".
        match = 200.0 if tlc.startswith(nlc) or f" {nlc}" in tlc else 150.0
    elif nlc in blc:
        match = 80.0
    else:
        return 0.0
    return match + _recency_boost(ts)


def _snippet(body: str, needle: str, radius: int = 60) -> str:
    """Cheap window snippet around the first match. Mirrors the helper
    in library_agent.deep_search but kept local so this module has no
    cross-dependency on a private function in another agent."""
    if not body:
        return ""
    if not needle:
        return body[:140].strip()
    blc = body.lower()
    nlc = needle.lower()
    idx = blc.find(nlc)
    if idx < 0:
        return body[:140].strip()
    start = max(0, idx - radius)
    end = min(len(body), idx + len(needle) + radius)
    pre = "…" if start > 0 else ""
    post = "…" if end < len(body) else ""
    return f"{pre}{body[start:end].strip()}{post}"


# ─── Per-kind collectors ───────────────────────────────────────────────

async def _search_memories(needle: str, cap: int) -> List[Dict[str, Any]]:
    # `list_memories(q=...)` already runs the substring match server-
    # side but caps the candidate window — pass `q` through so heavy
    # vaults still surface deep matches, and bump `limit` so the
    # palette can show ~10 results per kind comfortably.
    rows = await recall_agent.list_memories(q=needle, limit=cap, include_archived=False)
    out: List[Dict[str, Any]] = []
    for m in rows:
        title = m.get("title") or "(untitled memory)"
        body = m.get("summary") or ""
        score = _score(needle, title, body, m.get("created_at"))
        if score <= 0 and needle:
            continue
        out.append({
            "kind": "memory",
            "id": m.get("id"),
            "title": title,
            "meta": m.get("source_type") or "memory",
            "snippet": _snippet(body, needle),
            "score": score,
        })
    return out


async def _search_tasks(needle: str, cap: int) -> List[Dict[str, Any]]:
    # `list_tasks` is status-locked. Fan out across the two statuses we
    # care about for jump/link (pending + completed) so the user can
    # surface a task they finished last week as easily as one due
    # tomorrow.
    pending, completed = await asyncio.gather(
        task_agent.list_tasks(status="pending", limit=max(cap, 60)),
        task_agent.list_tasks(status="completed", limit=max(cap, 60)),
    )
    out: List[Dict[str, Any]] = []
    for t in [*pending, *completed]:
        title = t.get("title") or "(untitled task)"
        body = t.get("title") or ""
        score = _score(needle, title, body, t.get("created_at"))
        if score <= 0 and needle:
            continue
        meta_bits: List[str] = []
        if t.get("status"): meta_bits.append(t["status"])
        if t.get("due_date"): meta_bits.append(f"due {t['due_date']}")
        out.append({
            "kind": "task",
            "id": t.get("id"),
            "title": title,
            "meta": " · ".join(meta_bits) or "task",
            "snippet": "",
            "score": score,
        })
    return out


async def _search_events(needle: str, cap: int) -> List[Dict[str, Any]]:
    # `list_upcoming_events(days=N)` is forward-looking; for the
    # palette we want the user's whole history too, so widen the
    # horizon to a year in each direction. Past events score lower via
    # `_recency_boost`, which is the right behaviour.
    events = await calendar_agent.list_upcoming_events(days=365)
    out: List[Dict[str, Any]] = []
    for e in events[:cap * 4]:
        title = e.get("title") or "(untitled event)"
        body = e.get("description") or e.get("title") or ""
        # Use event date as the recency anchor — a session "last
        # Tuesday" is more relevant than one created six months ago
        # but scheduled for next year.
        anchor = e.get("date") or e.get("created_at")
        score = _score(needle, title, body, anchor)
        if score <= 0 and needle:
            continue
        date_str = e.get("date") or ""
        time_str = e.get("time") or ""
        meta = f"{date_str} {time_str}".strip() or "event"
        out.append({
            "kind": "event",
            "id": e.get("id"),
            "title": title,
            "meta": meta,
            "snippet": _snippet(body, needle),
            "score": score,
        })
    return out


async def _search_revisits(needle: str, cap: int) -> List[Dict[str, Any]]:
    # Cover both active and paused revisits — a user resurrecting a
    # paused reminder via the linker is a real flow.
    active, paused = await asyncio.gather(
        revisit_agent.list_revisits(status="active", limit=max(cap, 80)),
        revisit_agent.list_revisits(status="paused", limit=max(cap, 80)),
    )
    out: List[Dict[str, Any]] = []
    for r in [*active, *paused]:
        title = r.get("title") or "(untitled revisit)"
        body = r.get("title") or ""
        score = _score(needle, title, body, r.get("created_at"))
        if score <= 0 and needle:
            continue
        meta_bits: List[str] = []
        if r.get("frequency"): meta_bits.append(r["frequency"])
        if r.get("next_due"): meta_bits.append(f"next {r['next_due']}")
        out.append({
            "kind": "revisit",
            "id": r.get("id"),
            "title": title,
            "meta": " · ".join(meta_bits) or "revisit",
            "snippet": "",
            "score": score,
        })
    return out


async def _search_habits(needle: str, cap: int) -> List[Dict[str, Any]]:
    rows = await extras_agent.list_habits()
    out: List[Dict[str, Any]] = []
    for h in rows:
        title = h.get("name") or h.get("title") or "(untitled habit)"
        body = h.get("description") or title
        score = _score(needle, title, body, h.get("created_at"))
        if score <= 0 and needle:
            continue
        meta = f"streak {h.get('streak', 0)}" if h.get("streak") is not None else "habit"
        out.append({
            "kind": "habit",
            "id": h.get("id"),
            "title": title,
            "meta": meta,
            "snippet": "",
            "score": score,
        })
        if len(out) >= cap * 2:
            break
    return out


async def _search_folders(needle: str, cap: int) -> List[Dict[str, Any]]:
    # `list_flat_folders` already merges every folder across every
    # project into one searchable list with `recent_use_at`, so we use
    # that instead of walking projects ourselves.
    folders = await ws_list_flat_folders()
    out: List[Dict[str, Any]] = []
    for f in folders:
        title = f.get("folder_name") or "(untitled folder)"
        body = f"{f.get('project_name') or ''} {title}"
        score = _score(needle, title, body, f.get("recent_use_at"))
        if score <= 0 and needle:
            continue
        # Folder ref is "project_id/folder_id" — the same shape
        # link_memory_to expects, so the palette can paste it straight
        # into POST /links without re-encoding.
        ref = f"{f.get('project_id')}/{f.get('folder_id')}"
        meta = f.get("project_name") or "folder"
        out.append({
            "kind": "folder",
            "id": ref,
            "title": title,
            "meta": meta,
            "snippet": "",
            "score": score,
        })
        if len(out) >= cap * 2:
            break
    return out


# ─── Public entry point ───────────────────────────────────────────────

_KIND_RUNNERS = {
    "memory":  _search_memories,
    "task":    _search_tasks,
    "event":   _search_events,
    "revisit": _search_revisits,
    "habit":   _search_habits,
    "folder":  _search_folders,
}


async def global_search(
    q: str = "",
    kinds: Optional[Sequence[str]] = None,
    limit: int = 20,
) -> Dict[str, Any]:
    """Run the search across every requested kind in parallel and
    return a single ranked list plus per-kind buckets.

    `kinds` filters which collections we touch — passing
    `["memory","task"]` means folders/events/etc. aren't queried at
    all (cheaper for the palette's "Link to memory" mode where only
    one kind is relevant).
    """
    needle = (q or "").strip()
    requested = [k for k in (kinds or ALL_KINDS) if k in _KIND_RUNNERS]
    if not requested:
        return {"results": [], "by_kind": {}, "total": 0}

    # Per-kind cap — we'll trim the merged list to `limit` at the end.
    # 12 keeps the merged ranker's input bounded but still leaves room
    # for the global top-K to favour any one strong category.
    per_kind_cap = max(8, min(20, limit))

    runners = [_KIND_RUNNERS[k](needle, per_kind_cap) for k in requested]
    bucket_lists = await asyncio.gather(*runners, return_exceptions=True)

    by_kind: Dict[str, List[Dict[str, Any]]] = {}
    merged: List[Dict[str, Any]] = []
    for kind, bucket in zip(requested, bucket_lists):
        if isinstance(bucket, Exception):
            # One agent blowing up shouldn't black out the whole
            # palette — log nothing (no logger to avoid spam) and
            # surface an empty bucket so the UI just shows "no hits"
            # for that kind.
            by_kind[kind] = []
            continue
        # Sort each bucket by score desc, trim, stash for per-kind UI.
        bucket_sorted = sorted(bucket, key=lambda r: r.get("score", 0), reverse=True)
        by_kind[kind] = bucket_sorted[:per_kind_cap]
        merged.extend(by_kind[kind])

    merged.sort(key=lambda r: r.get("score", 0), reverse=True)
    return {
        "results": merged[:limit],
        "by_kind": by_kind,
        "total": len(merged),
    }
