"""
Generic link writer — W3 Universal Linker.

The detail-page panel already has `library_agent.link_memory_to` as
the canonical bidirectional writer for any pair where ONE side is a
memory. This module wraps that for the Cmd-K palette's generic
`POST /links` body shape (`from`/`to` instead of `kind`/`ref_id`) and
adds the few non-memory pairs we actually support today (task↔event).

Design rationale
────────────────
- Keeping all "writes both sides" logic in `library_agent.link_memory_to`
  means the palette can never get out of sync with the detail-page
  panel — both flow through the same lock + bidirectional update path.
- Anything outside the supported pair set raises `LinkPairUnsupported`
  rather than silently no-op'ing. The frontend palette translates that
  into a toast so the user knows the link wasn't actually made.
- Symmetric pairs (memory↔task, task↔memory) get normalised here so
  callers don't have to think about ordering.
"""
from __future__ import annotations

from typing import Any, Dict

from app import library_agent
from app.db import get_db
from app.user_context import belongs_to_current_user


class LinkPairUnsupported(ValueError):
    """Raised when the (from_kind, to_kind) pair has no defined writer.

    Callers should map this to HTTP 400 — the link genuinely cannot be
    made yet, vs. a 404 (target missing) or 500 (write failure)."""


# Every link kind link_memory_to knows about. Keep in sync with
# library_agent._LINK_KINDS — copy here so import-time wiring is
# self-documenting and we don't depend on a private symbol.
_MEMORY_LINKABLE = {"task", "event", "revisit", "habit", "memory", "folder", "external_ref"}


async def _link_task_to_event(task_id: str, event_id: str) -> Dict[str, Any]:
    """Write the FK on the event doc that already exists in the
    schedule schema (`linked_task_id`). The task side carries no
    reverse pointer, so this is the one direction we touch.

    BOTH sides are ownership-checked before we write — the event for
    obvious reasons, and the task too because otherwise a user could
    attach an event of theirs to a guessed task ID owned by someone
    else (broken authorization on the cross-entity reference even
    though no data leaks back).
    """
    db = await get_db()
    # Verify task exists and belongs to the caller — otherwise we'd
    # silently let one user point their event at another user's task.
    task_doc = await db.collection("tasks").document(task_id).get()
    if not task_doc.exists:
        raise ValueError(f"Task '{task_id}' not found.")
    task_data = task_doc.to_dict() or {}
    if not belongs_to_current_user(task_data):
        # Surface the same "not found" message we use for cross-user
        # access in other agents — don't leak existence info via a
        # different error code/message.
        raise ValueError(f"Task '{task_id}' not found.")

    doc_ref = db.collection("schedules").document(event_id)
    doc = await doc_ref.get()
    if not doc.exists:
        raise ValueError(f"Event '{event_id}' not found.")
    data = doc.to_dict() or {}
    if not belongs_to_current_user(data):
        raise ValueError(f"Event '{event_id}' not found.")
    if data.get("linked_task_id") == task_id:
        return {"success": True, "from": {"kind": "task", "id": task_id},
                "to": {"kind": "event", "id": event_id}, "noop": True}
    await doc_ref.update({"linked_task_id": task_id})
    return {
        "success": True,
        "from": {"kind": "task", "id": task_id},
        "to":   {"kind": "event", "id": event_id},
    }


async def create_link(
    from_kind: str, from_id: str,
    to_kind: str,   to_id: str,
) -> Dict[str, Any]:
    """Generic link creator. Routes to the right per-pair writer based
    on the kinds involved.

    Supported pairs (either order):
        - memory ↔ {task, event, revisit, habit, memory, folder, external_ref}
        - task   ↔ event
    Anything else raises `LinkPairUnsupported`.
    """
    fk = (from_kind or "").strip().lower()
    tk = (to_kind or "").strip().lower()
    fi = (from_id or "").strip()
    ti = (to_id or "").strip()
    if not fk or not tk or not fi or not ti:
        raise ValueError("from.kind, from.id, to.kind, to.id all required.")
    if fk == tk and fi == ti:
        raise ValueError("Cannot link an item to itself.")

    # Memory ↔ X: route through the canonical bidirectional writer. We
    # always pass `memory_id=<the memory side>` and `kind=<the other
    # kind>` regardless of which side the caller put first, so the
    # palette doesn't have to care about ordering.
    if fk == "memory" and tk in _MEMORY_LINKABLE:
        await library_agent.link_memory_to(fi, tk, ti)
        return {"success": True, "from": {"kind": fk, "id": fi}, "to": {"kind": tk, "id": ti}}
    if tk == "memory" and fk in _MEMORY_LINKABLE:
        await library_agent.link_memory_to(ti, fk, fi)
        return {"success": True, "from": {"kind": fk, "id": fi}, "to": {"kind": tk, "id": ti}}

    # Task ↔ event — the one non-memory pair we have a real schema
    # column for (events.linked_task_id).
    if {fk, tk} == {"task", "event"}:
        task_id = fi if fk == "task" else ti
        event_id = fi if fk == "event" else ti
        return await _link_task_to_event(task_id, event_id)

    raise LinkPairUnsupported(
        f"Linking '{fk}' to '{tk}' isn't supported yet. "
        f"Supported pairs: memory↔{{{','.join(sorted(_MEMORY_LINKABLE))}}}, task↔event."
    )
