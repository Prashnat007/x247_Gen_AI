"""
Insight extraction layer over the Workspace.

Scans every item inside a folder (or whole project), pulls out:
  - Insights      — non-obvious takeaways worth remembering
  - Data points   — concrete facts / numbers / benchmarks / quotes
  - Tasks         — actionable to-dos hiding inside notes / summaries

For each finding it produces:
  - auto-assigned priority (high | medium | low)
  - 1–3 meaningful suggested actions, drawn from:
        add_task         → wires into /tasks (calendar + reminders)
        create_plan      → wires into /plan/generate (multi-day study/build plan)
        save_to_memory   → wires into /memory/save (vault)

Apply step calls the existing endpoints — no duplicate logic, no shadow store.
"""

from __future__ import annotations

import json
import logging
import re
import uuid
from typing import Any, Dict, List, Optional, Tuple

from app.ai_helper import chat_json
from app.config import settings
from app.workspace_agent import (
    DEFAULT_SECTIONS,
    add_items,
    add_task as ws_add_task,
    get_project,
    ingest_plan,
)

logger = logging.getLogger(__name__)

# ─── Heuristic helpers ────────────────────────────────────────────────────────

INSIGHT_TYPES = {"insight", "data", "task"}
PRIORITY_LEVELS = {"high", "medium", "low"}
ACTION_TYPES = {"add_task", "create_plan", "save_to_memory"}

# Words that imply urgency → bump priority during validation.
HIGH_PRIORITY_KEYWORDS = re.compile(
    r"\b(urgent|asap|deadline|due|today|tomorrow|this week|blocker|critical|must|production|incident|outage|deploy)\b",
    re.IGNORECASE,
)
TASK_LIKE_VERBS = re.compile(
    r"\b(implement|build|write|fix|add|refactor|test|review|read|watch|study|prepare|email|call|schedule|book|submit|ship)\b",
    re.IGNORECASE,
)


def _short_id(prefix: str = "ins") -> str:
    return f"{prefix}_{uuid.uuid4().hex[:10]}"


def _harvest_text_for_item(it: Dict[str, Any]) -> str:
    """Squeeze every readable string out of a workspace item into one block."""
    parts: List[str] = []
    title = (it.get("title") or "").strip()
    if title:
        parts.append(f"# {title}")

    meta = it.get("meta") or {}
    for key in ("executive_summary", "summary"):
        val = meta.get(key) or it.get(key)
        if isinstance(val, str) and val.strip():
            parts.append(val.strip())

    for key in ("key_points", "action_items"):
        arr = meta.get(key) or it.get(key)
        if isinstance(arr, list) and arr:
            parts.append(f"{key}:")
            for x in arr[:8]:
                if isinstance(x, str) and x.strip():
                    parts.append(f"- {x.strip()}")

    glossary = meta.get("glossary") or it.get("glossary")
    if isinstance(glossary, list) and glossary:
        parts.append("glossary:")
        for g in glossary[:6]:
            if isinstance(g, dict):
                t, d = g.get("term"), g.get("definition")
                if t and d:
                    parts.append(f"- {t}: {d}")

    tags = meta.get("tags") or it.get("tags") or []
    if isinstance(tags, list) and tags:
        parts.append("tags: " + ", ".join(str(t) for t in tags[:8]))

    return "\n".join(parts)[:1800]  # hard cap per item to keep prompt bounded


def _items_in_scope(project: Dict[str, Any], folder_id: Optional[str]) -> List[Dict[str, Any]]:
    items = project.get("items") or []
    if folder_id is None:
        return items
    if folder_id == "":
        return [it for it in items if not it.get("folder_id")]
    return [it for it in items if it.get("folder_id") == folder_id]


def _validate_priority(p: Any, fallback: str = "medium") -> str:
    p = (p or "").lower() if isinstance(p, str) else ""
    return p if p in PRIORITY_LEVELS else fallback


def _validate_actions(actions: Any) -> List[Dict[str, Any]]:
    """Keep only well-formed actions; cap at 3; dedupe by type."""
    out: List[Dict[str, Any]] = []
    seen_types: set = set()
    if not isinstance(actions, list):
        return out
    for a in actions:
        if not isinstance(a, dict):
            continue
        t = (a.get("type") or "").lower()
        if t not in ACTION_TYPES or t in seen_types:
            continue
        payload = a.get("payload") if isinstance(a.get("payload"), dict) else {}
        # Per-action minimum required fields.
        if t == "add_task":
            title = (payload.get("title") or "").strip()
            if not title:
                continue
            payload["title"] = title[:200]
            payload["priority"] = _validate_priority(payload.get("priority"))
            due = payload.get("due_in_days")
            try:
                payload["due_in_days"] = max(0, min(60, int(due))) if due is not None else None
            except (TypeError, ValueError):
                payload["due_in_days"] = None
        elif t == "create_plan":
            topic = (payload.get("topic") or "").strip()
            if not topic:
                continue
            payload["topic"] = topic[:120]
            try:
                payload["days"] = max(3, min(14, int(payload.get("days") or 7)))
            except (TypeError, ValueError):
                payload["days"] = 7
            gt = (payload.get("goal_type") or "").lower()
            payload["goal_type"] = gt if gt in {"study", "build", "research", "career"} else "study"
        elif t == "save_to_memory":
            title = (payload.get("title") or "").strip()
            summary = (payload.get("summary") or "").strip()
            if not title or not summary:
                continue
            payload["title"] = title[:160]
            payload["summary"] = summary[:600]
            tags = payload.get("tags") or []
            payload["tags"] = [str(x).strip().lower() for x in tags if str(x).strip()][:6]

        out.append({"type": t, "payload": payload})
        seen_types.add(t)
        if len(out) >= 3:
            break
    return out


def _validate_insight(
    raw: Dict[str, Any], valid_item_ids: set
) -> Optional[Dict[str, Any]]:
    if not isinstance(raw, dict):
        return None
    title = (raw.get("title") or "").strip()
    detail = (raw.get("detail") or raw.get("description") or "").strip()
    if not title or not detail:
        return None

    itype = (raw.get("type") or "").lower()
    if itype not in INSIGHT_TYPES:
        itype = "insight"

    # Source ids must reference real items.
    src = raw.get("source_item_ids") or []
    if not isinstance(src, list):
        src = []
    src = [s for s in src if isinstance(s, str) and s in valid_item_ids][:5]

    # Auto-bump priority if the detail screams urgency.
    priority = _validate_priority(raw.get("priority"))
    if priority != "high" and HIGH_PRIORITY_KEYWORDS.search(detail):
        priority = "high"
    if itype == "task" and priority == "low" and TASK_LIKE_VERBS.search(detail):
        priority = "medium"

    actions = _validate_actions(raw.get("suggested_actions"))
    if not actions:
        # Heuristic fallback so every insight is actionable.
        if itype == "task":
            actions = [{
                "type": "add_task",
                "payload": {"title": title[:200], "priority": priority, "due_in_days": 3},
            }]
        elif itype == "data":
            actions = [{
                "type": "save_to_memory",
                "payload": {
                    "title": title[:160],
                    "summary": detail[:600],
                    "tags": ["insight", "data"],
                },
            }]
        else:
            actions = [{
                "type": "save_to_memory",
                "payload": {
                    "title": title[:160],
                    "summary": detail[:600],
                    "tags": ["insight"],
                },
            }]

    return {
        "id": _short_id(),
        "type": itype,
        "title": title[:180],
        "detail": detail[:500],
        "priority": priority,
        "reason": (raw.get("reason") or "").strip()[:240],
        "source_item_ids": src,
        "suggested_actions": actions,
    }


# ─── Main entry ───────────────────────────────────────────────────────────────

EXTRACT_SYSTEM = """You are RecallX247's INSIGHT EXTRACTOR — a senior research assistant that surfaces what *matters* from a folder of mixed notes, tasks, ideas, and resources.

Return STRICT JSON: {"insights": [...]}

Rules:
1. Produce 3–7 insights total. Quality over quantity. Skip the obvious.
2. Each insight has exactly these fields:
   - id            (any short string, will be replaced)
   - type          one of: "insight" | "data" | "task"
        insight  → a non-obvious takeaway, pattern, or recommendation
        data     → a concrete fact / number / benchmark / quote worth saving
        task     → an actionable to-do hiding inside the text
   - title         specific, ≤80 chars (NOT "Important takeaway"; mention the actual concept)
   - detail        1–2 sentences with the concrete WHY/HOW (cite numbers, names, mechanisms)
   - priority      "high" | "medium" | "low"
        high   = blocker, deadline, urgent, or directly unblocks downstream work
        medium = important but not time-sensitive
        low    = nice-to-know, low effort to keep
   - reason        why this priority was chosen (≤25 words)
   - source_item_ids  array of 1–3 item ids you derived this from
   - suggested_actions  1–3 actions chosen from:
        {"type":"add_task","payload":{"title":"...","priority":"high|medium|low","due_in_days":N}}
        {"type":"create_plan","payload":{"topic":"...","days":N,"goal_type":"study|build|research"}}
        {"type":"save_to_memory","payload":{"title":"...","summary":"...","tags":["..."]}}

3. Suggestions MUST be meaningful for THIS insight. Do NOT default to "save_to_memory" for everything.
   - Use add_task ONLY when there's a real action with a clear next step (and a sensible due_in_days).
   - Use create_plan ONLY when the topic genuinely needs multi-day structured learning/building (≥3 days of work).
   - Use save_to_memory ONLY when the data/insight is reusable later (a fact, definition, benchmark) AND not already in the source items verbatim.
4. NEVER repeat what's already in an item word-for-word — synthesize.
5. NEVER invent facts. If something is uncertain, omit it.
6. Tasks must use imperative verbs ("Implement", "Read", "Email").
"""


async def extract_insights(
    project_id: str, folder_id: Optional[str] = None
) -> Dict[str, Any]:
    project = await get_project(project_id)
    if not project:
        return {"ok": False, "error": "project not found"}

    items = _items_in_scope(project, folder_id)
    if not items:
        return {
            "ok": True, "insights": [], "stats": {"items_scanned": 0, "insights": 0},
            "scope": {"project_id": project_id, "folder_id": folder_id},
        }

    # Build the LLM context — id + condensed text per item.
    blocks: List[str] = []
    valid_ids: set = set()
    for it in items[:40]:  # safety cap
        iid = it.get("id")
        if not iid:
            continue
        valid_ids.add(iid)
        text = _harvest_text_for_item(it)
        if not text.strip():
            continue
        kind = it.get("kind") or "item"
        section = it.get("section_id") or "notes"
        blocks.append(f"---\nITEM_ID: {iid}\nKIND: {kind}\nSECTION: {section}\n{text}")

    if not blocks:
        return {
            "ok": True, "insights": [], "stats": {"items_scanned": len(items), "insights": 0},
            "scope": {"project_id": project_id, "folder_id": folder_id},
        }

    folder_label = "WHOLE PROJECT"
    if folder_id:
        for f in project.get("folders") or []:
            if f.get("id") == folder_id:
                folder_label = f"FOLDER: {f.get('name')}"
                break
    elif folder_id == "":
        folder_label = "ROOT (un-foldered items)"

    user_prompt = (
        f"Project: {project.get('name')}\n"
        f"Scope: {folder_label}\n"
        f"Items in scope: {len(blocks)}\n\n"
        + "\n".join(blocks)
        + '\n\nReturn JSON: {"insights":[...]} per the rules.'
    )

    try:
        result = await chat_json(
            messages=[
                {"role": "system", "content": EXTRACT_SYSTEM},
                {"role": "user", "content": user_prompt},
            ],
            model=settings.OPENAI_MODEL,
            temperature=0.4,
        )
    except Exception as e:
        logger.error(f"extract_insights LLM call failed: {e}")
        return {"ok": False, "error": f"LLM call failed: {e}"}

    raw_insights = result.get("insights") if isinstance(result, dict) else None
    if not isinstance(raw_insights, list):
        return {"ok": False, "error": "LLM returned no insights array"}

    cleaned: List[Dict[str, Any]] = []
    for r in raw_insights:
        v = _validate_insight(r, valid_ids)
        if v:
            cleaned.append(v)

    # Sort high → medium → low for the UI.
    order = {"high": 0, "medium": 1, "low": 2}
    cleaned.sort(key=lambda x: order.get(x["priority"], 3))

    counts = {
        "high":   sum(1 for x in cleaned if x["priority"] == "high"),
        "medium": sum(1 for x in cleaned if x["priority"] == "medium"),
        "low":    sum(1 for x in cleaned if x["priority"] == "low"),
        "insight": sum(1 for x in cleaned if x["type"] == "insight"),
        "data":    sum(1 for x in cleaned if x["type"] == "data"),
        "task":    sum(1 for x in cleaned if x["type"] == "task"),
    }

    # ── Persist insights into the project for later timeline assembly ────────
    # Each persisted insight carries created_at + folder_id + applied_actions[]
    # so the timeline endpoint can join insight → derived task/memory/plan.
    # We cap recent_insights at 50 (FIFO) to keep the project doc bounded.
    try:
        import datetime as _dt
        from app.db import get_db as _get_db
        now_iso = _dt.datetime.now(_dt.timezone.utc).isoformat()
        from app.user_context import belongs_to_current_user
        db = await _get_db()
        pdoc = await db.collection("workspace_projects").document(project_id).get()
        if getattr(pdoc, "exists", False) and belongs_to_current_user(pdoc.to_dict()):
            pdata = pdoc.to_dict() or {}
            existing = pdata.get("recent_insights") or []
            persisted = []
            for ins in cleaned:
                persisted.append({
                    "id": ins["id"],
                    "title": ins.get("title", ""),
                    "detail": ins.get("detail", ""),
                    "type": ins.get("type", "insight"),
                    "priority": ins.get("priority", "medium"),
                    "folder_id": ins.get("folder_id") or folder_id or "",
                    "source_item_ids": ins.get("source_item_ids") or [],
                    "created_at": now_iso,
                    "applied_actions": [],
                })
            merged = persisted + existing
            pdata["recent_insights"] = merged[:50]
            pdata["updated_at"] = now_iso
            await db.collection("workspace_projects").document(project_id).set(pdata)
    except Exception as e:
        logger.warning(f"persist insights failed (non-fatal): {e}")

    return {
        "ok": True,
        "scope": {"project_id": project_id, "folder_id": folder_id, "label": folder_label},
        "insights": cleaned,
        "stats": {
            "items_scanned": len(blocks),
            "insights": len(cleaned),
            "by_priority": {k: counts[k] for k in ("high", "medium", "low")},
            "by_type":     {k: counts[k] for k in ("insight", "data", "task")},
        },
    }


# ─── Apply an action ──────────────────────────────────────────────────────────


async def _log_applied_action(
    project_id: str,
    insight_id: str,
    action_type: str,
    target_type: str,
    target_id: str,
    target_label: str = "",
) -> None:
    """Append an applied-action record to the matching persisted insight so the
    timeline endpoint can render a 'derived from this insight' edge.
    Best-effort: never block the apply path if the project doc has rotated."""
    if not (project_id and insight_id and target_id):
        return
    try:
        import datetime as _dt
        from app.db import get_db as _get_db
        from app.user_context import belongs_to_current_user
        db = await _get_db()
        pdoc = await db.collection("workspace_projects").document(project_id).get()
        if not getattr(pdoc, "exists", False):
            return
        pdata = pdoc.to_dict() or {}
        if not belongs_to_current_user(pdata):
            return
        recent = pdata.get("recent_insights") or []
        touched = False
        now_iso = _dt.datetime.now(_dt.timezone.utc).isoformat()
        for r in recent:
            if r.get("id") == insight_id:
                acts = r.get("applied_actions") or []
                # Idempotency — same (action, target_id) tuple already logged?
                # Prevents duplicate edges from rapid double-clicks or retries.
                if any(a.get("action") == action_type and a.get("target_id") == target_id
                       for a in acts if isinstance(a, dict)):
                    return
                acts.append({
                    "action": action_type,
                    "target_type": target_type,   # task | memory | plan | project
                    "target_id": target_id,
                    "target_label": target_label[:160],
                    "applied_at": now_iso,
                })
                r["applied_actions"] = acts[-10:]  # cap per insight
                touched = True
                break
        if touched:
            pdata["updated_at"] = now_iso
            await db.collection("workspace_projects").document(project_id).set(pdata)
    except Exception as e:
        logger.warning(f"_log_applied_action failed (non-fatal): {e}")

async def apply_insight_action(
    project_id: str,
    insight: Dict[str, Any],
    action: Dict[str, Any],
) -> Dict[str, Any]:
    """Route a single chosen action to the right system.

    SECURITY: re-runs the same validators used at extraction time so that
    a hand-crafted client payload cannot bypass length/range/type clamps,
    spoof an unsupported action, or pin items into a folder that doesn't
    exist on this project. No assumptions about what arrived from the wire.
    """
    project = await get_project(project_id)
    if not project:
        return {"ok": False, "error": "project not found"}

    if not isinstance(insight, dict):
        return {"ok": False, "error": "insight must be an object"}
    if not isinstance(action, dict):
        return {"ok": False, "error": "action must be an object"}

    # 1. Re-validate the action against the same rules as extraction.
    cleaned_actions = _validate_actions([action])
    if not cleaned_actions:
        return {"ok": False, "error": "invalid action — failed server-side validation"}
    action = cleaned_actions[0]
    a_type = action["type"]
    payload = action["payload"]  # already clamped/sanitized by validator

    # 1b. Idempotency guard — if THIS insight has already been applied with
    # THIS action_type, return the previous result instead of duplicating
    # tasks/memories/plans on retry or accidental double-click.
    insight_id_for_dedup = str(insight.get("id") or "")[:64]
    if insight_id_for_dedup:
        for r in (project.get("recent_insights") or []):
            if not isinstance(r, dict) or r.get("id") != insight_id_for_dedup:
                continue
            for prev in (r.get("applied_actions") or []):
                if isinstance(prev, dict) and prev.get("action") == a_type:
                    return {
                        "ok": True,
                        "action": a_type,
                        "idempotent": True,
                        "message": f"Already applied as {prev.get('target_type')}:{prev.get('target_id')}",
                        "previous": {
                            "target_type": prev.get("target_type"),
                            "target_id":   prev.get("target_id"),
                            "target_label":prev.get("target_label"),
                            "applied_at":  prev.get("applied_at"),
                        },
                    }
            break

    # 2. Sanitize the insight envelope (only the fields apply actually uses).
    safe_insight = {
        "id": str(insight.get("id") or "")[:64],
        "title": str(insight.get("title") or "")[:200].strip(),
        "detail": str(insight.get("detail") or "")[:600].strip(),
        "priority": _validate_priority(insight.get("priority")),
    }

    # 3. folder_id must reference an actual folder on THIS project (or be empty
    #    for the root bucket). Drop unknown folder ids silently.
    raw_folder = (insight or {}).get("folder_id")
    folder_id = ""
    if isinstance(raw_folder, str) and raw_folder.strip():
        valid_folder_ids = {f.get("id") for f in (project.get("folders") or []) if isinstance(f, dict)}
        if raw_folder in valid_folder_ids:
            folder_id = raw_folder
    insight = safe_insight  # use sanitized envelope from here on

    # ── add_task → global /tasks (calendar) + project-level task pin ─────────
    if a_type == "add_task":
        from app.task_agent import create_task  # global task / calendar
        title = (payload.get("title") or insight.get("title") or "").strip()
        if not title:
            return {"ok": False, "error": "task title required"}
        priority = _validate_priority(payload.get("priority") or insight.get("priority"))
        due_in_days = payload.get("due_in_days")
        due_date = ""
        if isinstance(due_in_days, int) and due_in_days >= 0:
            import datetime
            due_date = (datetime.date.today() + datetime.timedelta(days=due_in_days)).isoformat()

        global_task = await create_task(title=title, due_date=due_date, priority=priority)

        # Mirror into the project so it shows up inside the folder.
        try:
            ws_task = await ws_add_task(project_id, text=title, folder_id=folder_id or None)
        except Exception as e:
            logger.warning(f"ws_add_task mirror failed: {e}")
            ws_task = None

        # Record the linkage on the source insight (timeline edges). We log
        # BOTH the global task (calendar) and the workspace pinned task so
        # the timeline shows the full fan-out from one insight.
        if global_task and global_task.get("id"):
            await _log_applied_action(
                project_id=project_id,
                insight_id=insight.get("id"),
                action_type="add_task",
                target_type="task",
                target_id=global_task["id"],
                target_label=title,
            )
        if ws_task and ws_task.get("id"):
            await _log_applied_action(
                project_id=project_id,
                insight_id=insight.get("id"),
                action_type="add_task",
                target_type="task",
                target_id=ws_task["id"],
                target_label=title,
            )

        return {
            "ok": True,
            "action": "add_task",
            "task": global_task,
            "workspace_task": ws_task,
        }

    # ── create_plan → /plan/generate then ingest into a sibling project ──────
    if a_type == "create_plan":
        from app.plan_agent import generate_plan
        topic = (payload.get("topic") or insight.get("title") or "").strip()
        if not topic:
            return {"ok": False, "error": "plan topic required"}
        days = int(payload.get("days") or 7)
        goal_type = payload.get("goal_type") or "study"

        plan = await generate_plan(
            topic=topic, goal_type=goal_type, days=days, minutes_per_day=60,
        )
        if "error" in plan:
            return {"ok": False, "error": plan["error"]}

        # Spin up a new linked project from the plan.
        new_proj = await ingest_plan(plan, project_name=f"Plan — {topic}")

        await _log_applied_action(
            project_id=project_id,
            insight_id=insight.get("id"),
            action_type="create_plan",
            target_type="plan",  # canonicalized → emits as plan:<id> in timeline
            target_id=new_proj.get("id") or "",
            target_label=new_proj.get("name") or topic,
        )

        return {
            "ok": True,
            "action": "create_plan",
            "plan_topic": topic,
            "days": days,
            "new_project_id": new_proj.get("id"),
            "new_project_name": new_proj.get("name"),
        }

    # ── save_to_memory → /memory/save → also slot into this folder ───────────
    if a_type == "save_to_memory":
        from app.capture_agent import save_memory
        title = (payload.get("title") or insight.get("title") or "").strip()
        summary = (payload.get("summary") or insight.get("detail") or "").strip()
        if not title or not summary:
            return {"ok": False, "error": "title and summary required"}
        tags = payload.get("tags") or []
        if not isinstance(tags, list):
            tags = []

        memory_payload = {
            "source_type": "note",
            "source_url": "",
            "title": title,
            "summary": summary,
            "key_points": [insight.get("detail") or summary],
            "tags": tags or ["insight"],
            "domain": "RecallX247 Insight",
        }
        mem = await save_memory(memory_payload)

        # Pin into the project's folder so it's visible alongside the source items.
        try:
            await add_items(project_id, [{
                "kind": "memory",
                "ref_id": mem.get("id"),
                "title": title,
                "folder_id": folder_id or None,
                "section_id": "notes",
                "tags": tags or ["insight"],
                "meta": {
                    "summary": summary,
                    "source_type": "note",
                    "tags": tags or ["insight"],
                },
            }])
        except Exception as e:
            logger.warning(f"workspace pin after save_to_memory failed: {e}")

        await _log_applied_action(
            project_id=project_id,
            insight_id=insight.get("id"),
            action_type="save_to_memory",
            target_type="memory",
            target_id=mem.get("id") or "",
            target_label=title,
        )

        return {
            "ok": True,
            "action": "save_to_memory",
            "memory_id": mem.get("id"),
            "title": title,
        }

    return {"ok": False, "error": "unhandled action type"}


# ───────────────────────────────────────────────────────────────────────
# W4-3 — Cross-memory clustering (weekly).
#
# Groups the user's last-7-days memories by topic via a single fallback-
# model JSON call. For any cluster ≥ 5 we drop a `folder_bundle`
# suggestion so the user can review + collapse them into a workspace
# folder. Suggestions go through `auto_linker.create_suggestion` so
# dismissals stick.
# ───────────────────────────────────────────────────────────────────────

async def cluster_weekly(user_id: str = "", min_cluster_size: int = 5) -> dict:
    """Run a topic-clustering pass over the past 7 days of memories.

    Returns `{clusters: [...], suggestions_created: N}`. Errors surface
    as `{error: str}` but never raise — the caller (briefing scheduler
    or a manual trigger) treats failures as "no clusters this run".
    """
    import datetime as _dt
    from app.user_context import get_uid as _get_uid
    from app.db import get_db as _get_db
    from app.config import settings as _settings
    from app.auto_linker import create_suggestion

    uid = (user_id or _get_uid() or "").strip()
    if not uid:
        return {"clusters": [], "suggestions_created": 0}

    # P4B — opt-out gate. The cluster scan is a no-op when the user has
    # toggled cluster suggestions off. Same shape as the success path so
    # the briefing aggregator can still read counts.
    try:
        from app.auto_link_prefs import is_cluster_suggestions_enabled
        if not await is_cluster_suggestions_enabled(uid):
            return {"clusters": [], "suggestions_created": 0, "disabled": True}
    except Exception:
        pass

    db = await _get_db()
    horizon = (_dt.datetime.now(_dt.timezone.utc) - _dt.timedelta(days=7)).isoformat()
    snap = await db.collection("memories") \
        .where("created_at", ">=", horizon) \
        .order_by("created_at", direction="DESCENDING") \
        .limit(120) \
        .get()
    # Merge `doc.id` — memory docs persisted via `_atomic_create_memory`
    # do NOT include an `id` field in the body; without this, all
    # `m.get("id")` reads below would be empty and the cluster prompt
    # would build with blank IDs.
    memories = [{**(m.to_dict() or {}), "id": m.id} for m in snap if (m.to_dict() or {}).get("user_id") == uid]
    if len(memories) < int(min_cluster_size or 5):
        return {"clusters": [], "suggestions_created": 0, "scanned": len(memories)}

    # Compress to id+title+tags for the prompt.
    items_block = "\n".join(
        f"- {m.get('id','')} | {(m.get('title') or '')[:80]} | {', '.join((m.get('tags') or [])[:5])}"
        for m in memories if m.get("id")
    )

    prompt = (
        "Group these recent personal-knowledge captures by topic. "
        "Only return groups with at least "
        f"{min_cluster_size} items — drop everything smaller. Each group's "
        "topic should be a short 2-4 word label.\n\n"
        f"ITEMS (id | title | tags):\n{items_block}\n\n"
        "Return JSON: {\"clusters\": [{\"topic\": \"<label>\", "
        "\"memory_ids\": [\"<id>\", ...]}]}"
    )

    try:
        from app.ai_helper import chat_json
        result = await chat_json(
            messages=[{"role": "user", "content": prompt}],
            model=_settings.FALLBACK_AI_MODEL,
            temperature=0.2,
        )
    except Exception as e:
        return {"error": str(e), "clusters": [], "suggestions_created": 0}

    raw_clusters = result.get("clusters") if isinstance(result, dict) else None
    if not isinstance(raw_clusters, list):
        return {"clusters": [], "suggestions_created": 0}

    valid_ids = {m.get("id") for m in memories if m.get("id")}
    out_clusters = []
    suggestions_created = 0

    for c in raw_clusters[:10]:
        if not isinstance(c, dict):
            continue
        topic = str(c.get("topic") or "").strip()[:60]
        ids = [str(x) for x in (c.get("memory_ids") or []) if isinstance(x, (str, int))]
        ids = [i for i in ids if i in valid_ids]  # hallucination guard
        if not topic or len(ids) < int(min_cluster_size or 5):
            continue
        out_clusters.append({"topic": topic, "memory_ids": ids})
        # Anchor the suggestion on the first memory in the cluster so
        # the for_memory_id field is meaningful for inbox grouping. The
        # full id list lives in payload.memory_ids.
        anchor = ids[0]
        res = await create_suggestion(
            kind="folder_bundle",
            ref_id="",
            for_memory_id=anchor,
            reason=f"You captured {len(ids)} things about '{topic}' this week — bundle them into a workspace?",
            confidence=min(0.95, 0.5 + 0.05 * len(ids)),
            source="cluster_weekly",
            payload={"memory_ids": ids, "topic": topic, "size": len(ids)},
            user_id=uid,
        )
        if res and not res.get("noop"):
            suggestions_created += 1

    return {
        "clusters": out_clusters,
        "suggestions_created": suggestions_created,
        "scanned": len(memories),
    }
