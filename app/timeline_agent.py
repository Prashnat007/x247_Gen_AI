"""
Folder timeline — chronologically merges every event tied to a workspace folder
(or whole project) so the UI can render a single "story" of how knowledge moved
through the system: capture → insight → task → memory → plan.

Event types
-----------
  capture   — a workspace item was added (any kind: web, youtube, pdf, note, memory)
  insight   — the AI extracted an insight scoped to this folder
  task      — a task was created in this folder (workspace task or insight-derived)
  memory    — a memory was saved AND pinned into this folder via save_to_memory
  plan      — a sibling project was generated via create_plan from an insight here

Edges
-----
Each event carries optional `linked_from` (id of the event that produced it) and
optional `linked_to` (ids of events derived from it). These are computed from
insight.applied_actions[] which is populated whenever apply_insight_action runs.

Read-only — never mutates state. Bounded scans so we don't blow up on large
projects.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from app.db import get_db

logger = logging.getLogger(__name__)


def _norm_iso(ts: Any) -> str:
    """Best-effort ISO string for sorting. Empty string sorts last."""
    if ts is None:
        return ""
    if isinstance(ts, str):
        return ts
    if hasattr(ts, "isoformat"):
        try:
            return ts.isoformat()
        except Exception:
            return ""
    return str(ts)


def _short(text: str, n: int = 160) -> str:
    s = (text or "").strip()
    return (s[: n - 1] + "…") if len(s) > n else s


async def get_folder_timeline(
    project_id: str,
    folder_id: Optional[str] = None,
    limit: int = 200,
) -> Dict[str, Any]:
    """Return a merged, time-sorted event stream for this folder (or project).

    Args:
      project_id: required
      folder_id:  None  → whole project
                  ""    → root (un-foldered) bucket only
                  "f_x" → that specific folder

    Returns:
      {
        ok, scope: {project_id, project_name, folder_id, folder_name},
        events: [{
          id, type, timestamp, title, summary,
          source_type, source_id, source_url?,
          priority?, status?, due_date?,
          linked_from?: {event_id, type, label},   # what produced this
          linked_to?:   [{event_id, type, label, action}],  # what this produced
          deeplink: { route, params }              # for "click → open source"
        }],
        counts: {capture, insight, task, memory, plan, total},
        edges:  count of cross-event links
      }
    """
    from app.user_context import belongs_to_current_user
    db = await get_db()
    pdoc = await db.collection("workspace_projects").document(project_id).get()
    if not getattr(pdoc, "exists", False):
        return {"ok": False, "error": "project not found"}
    project = pdoc.to_dict() or {}
    if not belongs_to_current_user(project):
        return {"ok": False, "error": "project not found"}

    # Resolve folder name (cosmetic only)
    folder_name = ""
    if folder_id:
        for f in project.get("folders") or []:
            if isinstance(f, dict) and f.get("id") == folder_id:
                folder_name = f.get("name") or ""
                break

    def _in_scope(it_folder: str) -> bool:
        if folder_id is None:
            return True
        if folder_id == "":
            return not it_folder
        return it_folder == folder_id

    events: List[Dict[str, Any]] = []

    # ── 1. Capture events (workspace items) ───────────────────────────────────
    item_id_to_event: Dict[str, str] = {}
    # When an item is a memory pin, also register `memory:<memory_id>` as an
    # alias for its event id so edges logged with target_type="memory" can
    # resolve to the actual rendered event.
    memory_alias_to_event: Dict[str, str] = {}
    for it in (project.get("items") or []):
        if not isinstance(it, dict):
            continue
        if not _in_scope(it.get("folder_id") or ""):
            continue
        meta = it.get("meta") or {}
        kind = it.get("kind") or "resource"
        # If this is a memory pin, classify as 'memory' instead of 'capture'
        # so the timeline distinguishes vault-saves from raw clips.
        is_memory_pin = (kind == "memory") or (meta.get("source_type") == "note" and it.get("ref_id"))
        ev_type = "memory" if is_memory_pin else "capture"
        ev_id = f"item:{it.get('id')}"
        item_id_to_event[it.get("id") or ""] = ev_id
        if is_memory_pin and it.get("ref_id"):
            memory_alias_to_event[f"memory:{it['ref_id']}"] = ev_id

        # Pick best deep-link by what we actually have.
        deeplink = {"route": "/workspace", "params": {"project": project_id}}
        if it.get("ref_id") and is_memory_pin:
            deeplink = {"route": f"/memory/{it['ref_id']}", "params": {}}
        elif it.get("url"):
            deeplink = {"route": "/vault", "params": {"highlight": it.get("ref_id") or ""}}

        events.append({
            "id": ev_id,
            "type": ev_type,
            "timestamp": _norm_iso(it.get("added_at")),
            "title": it.get("title") or "Untitled",
            "summary": _short(meta.get("summary") or meta.get("executive_summary") or ""),
            "source_type": meta.get("source_type") or kind,
            "source_id": it.get("ref_id") or it.get("id"),
            "source_url": it.get("url") or "",
            "tags": (it.get("tags") or [])[:5],
            "folder_id": it.get("folder_id") or "",
            "deeplink": deeplink,
        })

    # ── 2. Insight events + outgoing edges ───────────────────────────────────
    insight_id_to_event: Dict[str, str] = {}
    edge_count = 0
    for ins in (project.get("recent_insights") or []):
        if not isinstance(ins, dict):
            continue
        if not _in_scope(ins.get("folder_id") or ""):
            continue
        ev_id = f"insight:{ins.get('id')}"
        insight_id_to_event[ins.get("id") or ""] = ev_id

        derived: List[Dict[str, str]] = []
        seen_targets: set = set()  # de-dup duplicate apply rows
        for a in (ins.get("applied_actions") or []):
            if not isinstance(a, dict):
                continue
            tt = a.get("target_type") or ""
            tid = a.get("target_id") or ""
            action = a.get("action") or ""
            if not (tt and tid):
                continue
            # Canonicalize target id so derived links round-trip to a real
            # rendered event:
            #   memory → resolved via memory_alias_to_event (item event)
            #   project + create_plan → emitted as plan:<id> in section 5
            raw_id = f"{tt}:{tid}"
            canonical = memory_alias_to_event.get(raw_id, raw_id)
            if tt == "project" and action == "create_plan":
                canonical = f"plan:{tid}"
                ev_type_for_link = "plan"
            elif tt == "memory":
                ev_type_for_link = "memory"
            else:
                ev_type_for_link = tt
            dedup_key = (action, canonical)
            if dedup_key in seen_targets:
                continue
            seen_targets.add(dedup_key)
            derived.append({
                "event_id": canonical,
                "type": ev_type_for_link,
                "label": _short(a.get("target_label") or "", 80),
                "action": action,
                "applied_at": _norm_iso(a.get("applied_at")),
            })
            edge_count += 1

        events.append({
            "id": ev_id,
            "type": "insight",
            "timestamp": _norm_iso(ins.get("created_at")),
            "title": ins.get("title") or "Insight",
            "summary": _short(ins.get("detail") or ""),
            "priority": ins.get("priority") or "medium",
            "insight_type": ins.get("type") or "insight",
            "folder_id": ins.get("folder_id") or "",
            "linked_to": derived,
            "deeplink": {
                "route": "/workspace",
                "params": {"project": project_id, "open_insights": "1"},
            },
        })

    # ── 3. Task events (workspace tasks scoped to folder) ─────────────────────
    task_id_to_event: Dict[str, str] = {}
    for t in (project.get("tasks") or []):
        if not isinstance(t, dict):
            continue
        if not _in_scope(t.get("folder_id") or ""):
            continue
        ev_id = f"task:{t.get('id')}"
        task_id_to_event[t.get("id") or ""] = ev_id
        events.append({
            "id": ev_id,
            "type": "task",
            "timestamp": _norm_iso(t.get("created_at")),
            "title": t.get("text") or "Task",
            "summary": "",
            "status": "completed" if t.get("done") else "pending",
            "source": "workspace",
            "folder_id": t.get("folder_id") or "",
            "deeplink": {"route": "/tasks", "params": {"highlight": t.get("id") or ""}},
        })

    # ── 4. Global tasks linked via insight.applied_actions ───────────────────
    # We add them as separate events when their target_id wasn't already a
    # workspace task (i.e. only created in /tasks, not pinned in the project).
    referenced_global_task_ids: List[str] = []
    for ins in (project.get("recent_insights") or []):
        if not _in_scope(ins.get("folder_id") or ""):
            continue
        for a in (ins.get("applied_actions") or []):
            if a.get("target_type") == "task":
                tid = a.get("target_id") or ""
                if tid and tid not in task_id_to_event and tid not in referenced_global_task_ids:
                    referenced_global_task_ids.append(tid)

    if referenced_global_task_ids:
        try:
            from app.user_context import belongs_to_current_user
            for tid in referenced_global_task_ids[:50]:
                tdoc = await db.collection("tasks").document(tid).get()
                if not getattr(tdoc, "exists", False):
                    continue
                t = tdoc.to_dict() or {}
                if not belongs_to_current_user(t):
                    continue
                ev_id = f"task:{tid}"
                task_id_to_event[tid] = ev_id
                events.append({
                    "id": ev_id,
                    "type": "task",
                    "timestamp": _norm_iso(t.get("created_at")),
                    "title": t.get("title") or "Task",
                    "summary": "",
                    "status": t.get("status") or "pending",
                    "priority": t.get("priority") or "medium",
                    "due_date": t.get("due_date") or "",
                    "source": "global",
                    "deeplink": {"route": "/tasks", "params": {"highlight": tid}},
                })
        except Exception as e:
            logger.warning(f"global task hydrate failed: {e}")

    # ── 5. Plan events (sibling projects spawned by create_plan) ─────────────
    seen_plan_pids: set = set()
    for ins in (project.get("recent_insights") or []):
        if not _in_scope(ins.get("folder_id") or ""):
            continue
        for a in (ins.get("applied_actions") or []):
            if a.get("action") == "create_plan" and a.get("target_type") in ("plan", "project"):
                pid = a.get("target_id") or ""
                if not pid or pid in seen_plan_pids:
                    continue
                seen_plan_pids.add(pid)
                events.append({
                    "id": f"plan:{pid}",
                    "type": "plan",
                    "timestamp": _norm_iso(a.get("applied_at")),
                    "title": a.get("target_label") or "Generated plan",
                    "summary": _short(ins.get("title") or ""),
                    "deeplink": {"route": "/workspace", "params": {"project": pid}},
                })

    # ── 6. Backfill `linked_from` on events that an insight produced ─────────
    # Walk insights again — for each derived target, find the matching event and
    # stamp where it came from. This lets the UI draw connection lines both ways.
    # Use the same canonicalization as section 2 so memory→item and
    # project→plan rewrites resolve.
    event_index: Dict[str, Dict[str, Any]] = {e["id"]: e for e in events}
    for ins in (project.get("recent_insights") or []):
        if not _in_scope(ins.get("folder_id") or ""):
            continue
        ins_ev_id = insight_id_to_event.get(ins.get("id") or "")
        if not ins_ev_id:
            continue
        ins_label = _short(ins.get("title") or "", 80)
        for a in (ins.get("applied_actions") or []):
            tt = a.get("target_type") or ""
            tid = a.get("target_id") or ""
            action = a.get("action") or ""
            if not (tt and tid):
                continue
            raw_id = f"{tt}:{tid}"
            canonical = memory_alias_to_event.get(raw_id, raw_id)
            if tt == "project" and action == "create_plan":
                canonical = f"plan:{tid}"
            tgt = event_index.get(canonical)
            if tgt is not None and "linked_from" not in tgt:
                tgt["linked_from"] = {
                    "event_id": ins_ev_id,
                    "type": "insight",
                    "label": ins_label,
                    "action": action,
                }

    # ── 7. Sort + cap ─────────────────────────────────────────────────────────
    # Newest first. Empty timestamp sorts last (older / unknown).
    events.sort(key=lambda e: (e.get("timestamp") or ""), reverse=True)
    events = events[:limit]

    counts = {"capture": 0, "insight": 0, "task": 0, "memory": 0, "plan": 0}
    for e in events:
        t = e["type"]
        if t in counts:
            counts[t] += 1
    counts["total"] = len(events)

    return {
        "ok": True,
        "scope": {
            "project_id": project_id,
            "project_name": project.get("name") or "",
            "folder_id": folder_id,
            "folder_name": folder_name,
        },
        "events": events,
        "counts": counts,
        "edges": edge_count,
    }
