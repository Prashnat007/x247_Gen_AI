"""W4 — AI auto-link layer.

This module owns the *suggestion* lifecycle: generation, persistence,
dedup, accept/reject. The actual scanners live next to the domain
they query (briefing_agent for habits + stale tasks, insight_agent
for clustering, revisit_agent for revisit gaps). They all funnel
writes through `create_suggestion` so dedup + dismissal-filtering
happens in one place.

Two collections:
  - `suggestions`           — pending/accepted/rejected proposals.
  - `suggestion_dismissals` — per-user "don't suggest this again"
                              keyed by signature so a rejection
                              survives across re-scans.

A suggestion's *signature* is `kind:ref_id:for_memory_id`. Same
target on the same memory dedups; the same target on a *different*
memory gets its own shot (different memory = different context).

`suggest_links(memory_id)` is the on-demand path used by the memory
detail page. It runs a single fallback-model JSON call with the
memory's title/summary/tags + a small candidate set from each kind
and returns up to 8 ranked suggestions. Errors are non-fatal — the
caller treats an empty list as "no AI suggestions right now".
"""

from __future__ import annotations

import datetime
import json
import uuid
from typing import Any, Dict, List, Optional

from app.config import settings
from app.db import get_db
from app.user_context import belongs_to_current_user, get_uid


SUGGESTIONS = "suggestions"
DISMISSALS = "suggestion_dismissals"


# --- Signature helpers ----------------------------------------------------

def signature_for(kind: str, ref_id: str = "", for_memory_id: str = "") -> str:
    """Stable dedup key. Lower-cased and colon-joined so trivially
    different cases ("Habit" vs "habit") don't bypass dismissals."""
    return f"{(kind or '').lower()}:{(ref_id or '').strip()}:{(for_memory_id or '').strip()}"


def _now_iso() -> str:
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def _parse_iso(raw: Any) -> Optional[datetime.datetime]:
    if not raw:
        return None
    if isinstance(raw, datetime.datetime):
        return raw if raw.tzinfo else raw.replace(tzinfo=datetime.timezone.utc)
    try:
        s = str(raw).replace("Z", "+00:00")
        dt = datetime.datetime.fromisoformat(s)
        return dt if dt.tzinfo else dt.replace(tzinfo=datetime.timezone.utc)
    except Exception:
        return None


# --- Dismissal store ------------------------------------------------------

async def _is_dismissed(user_id: str, signature: str) -> bool:
    """O(1) check via deterministic doc id `{user_id}:{signature}`. We
    avoid a where-query so this stays cheap inside scanner loops."""
    if not user_id or not signature:
        return False
    db = await get_db()
    doc_id = f"{user_id}:{signature}"[:1500]  # firestore key cap
    doc = await db.collection(DISMISSALS).document(doc_id).get()
    return doc.exists


async def _record_dismissal(user_id: str, signature: str) -> None:
    db = await get_db()
    doc_id = f"{user_id}:{signature}"[:1500]
    await db.collection(DISMISSALS).document(doc_id).set({
        "user_id": user_id,
        "signature": signature,
        "dismissed_at": _now_iso(),
    })


# --- Pending-dedup helper -------------------------------------------------

async def _has_pending(user_id: str, signature: str) -> bool:
    """Skip writing a fresh suggestion if there's already a pending
    one for the same signature. We tolerate the extra query because
    scanners run on a cadence, not in a tight inner loop."""
    db = await get_db()
    snap = await db.collection(SUGGESTIONS) \
        .where("user_id", "==", user_id) \
        .where("signature", "==", signature) \
        .where("status", "==", "pending") \
        .limit(1) \
        .get()
    return any(True for _ in snap)


# --- Create / list / accept / reject -------------------------------------

async def create_suggestion(
    *,
    kind: str,
    ref_id: str = "",
    for_memory_id: str = "",
    reason: str = "",
    confidence: float = 0.5,
    source: str = "scanner",
    payload: Optional[Dict[str, Any]] = None,
    user_id: str = "",
) -> Dict[str, Any]:
    """Persist a suggestion if (a) the user hasn't dismissed this
    signature before, and (b) there isn't already a pending one. The
    second check costs one indexed query but saves a lot of "stop
    suggesting the same thing every night" noise.

    Returns the created suggestion dict on write, or
    `{noop: True, reason: "..."}` when skipped — callers can ignore
    the noop case or count it for telemetry.
    """
    uid = (user_id or get_uid() or "").strip()
    if not uid:
        return {"noop": True, "reason": "no user context"}
    if not kind:
        return {"noop": True, "reason": "kind required"}

    sig = signature_for(kind, ref_id, for_memory_id)
    if await _is_dismissed(uid, sig):
        return {"noop": True, "reason": "dismissed", "signature": sig}
    if await _has_pending(uid, sig):
        return {"noop": True, "reason": "already pending", "signature": sig}

    suggestion_id = uuid.uuid4().hex
    doc = {
        "id": suggestion_id,
        "user_id": uid,
        "kind": kind,
        "ref_id": ref_id or "",
        "for_memory_id": for_memory_id or "",
        "reason": (reason or "")[:400],
        "confidence": max(0.0, min(1.0, float(confidence or 0))),
        "signature": sig,
        "status": "pending",
        "source": source or "scanner",
        "payload": payload or {},
        "created_at": _now_iso(),
    }
    db = await get_db()
    await db.collection(SUGGESTIONS).document(suggestion_id).set(doc)
    return doc


async def get_suggestion(suggestion_id: str) -> Optional[Dict[str, Any]]:
    if not suggestion_id:
        return None
    db = await get_db()
    snap = await db.collection(SUGGESTIONS).document(suggestion_id).get()
    if not snap.exists:
        return None
    data = snap.to_dict() or {}
    if not belongs_to_current_user(data):
        return None
    return data


async def list_for_memory(memory_id: str) -> List[Dict[str, Any]]:
    """Pending suggestions tied to a specific memory. Sorted newest
    first so the UI can render the freshest hints up top."""
    if not memory_id:
        return []
    db = await get_db()
    snap = await db.collection(SUGGESTIONS) \
        .where("user_id", "==", get_uid()) \
        .where("for_memory_id", "==", memory_id) \
        .where("status", "==", "pending") \
        .get()
    out: List[Dict[str, Any]] = []
    for d in snap:
        data = d.to_dict() or {}
        if belongs_to_current_user(data):
            out.append(data)
    out.sort(key=lambda x: str(x.get("created_at") or ""), reverse=True)
    return out


async def list_inbox(limit: int = 50) -> List[Dict[str, Any]]:
    """All pending suggestions for the current user, newest first."""
    db = await get_db()
    snap = await db.collection(SUGGESTIONS) \
        .where("user_id", "==", get_uid()) \
        .where("status", "==", "pending") \
        .get()
    out: List[Dict[str, Any]] = []
    for d in snap:
        data = d.to_dict() or {}
        if belongs_to_current_user(data):
            out.append(data)
    out.sort(key=lambda x: str(x.get("created_at") or ""), reverse=True)
    return out[: max(1, min(200, int(limit or 50)))]


async def accept_suggestion(suggestion_id: str) -> Dict[str, Any]:
    """Apply the link this suggestion proposes, then mark accepted.

    For ordinary memory↔X / task↔event pairs we delegate to
    `app.links.create_link`. For `folder_bundle` (cluster_weekly) we
    don't auto-create a folder — the spec wants a notification, so
    accepting just records the user's intent and surfaces the payload
    so the UI can navigate them to the workspace creator. The
    suggestion is still marked accepted in either case.
    """
    sug = await get_suggestion(suggestion_id)
    if not sug:
        raise ValueError(f"Suggestion '{suggestion_id}' not found.")
    if sug.get("status") != "pending":
        return {"success": True, "noop": True, "status": sug.get("status")}

    kind = sug.get("kind") or ""
    ref_id = sug.get("ref_id") or ""
    for_memory_id = sug.get("for_memory_id") or ""
    payload = sug.get("payload") or {}
    apply_result: Dict[str, Any] = {}

    try:
        if kind in {"task", "event", "habit", "revisit", "memory", "folder", "external_ref"} and for_memory_id and ref_id:
            from app import links as _links
            apply_result = await _links.create_link(
                from_kind="memory",
                from_id=for_memory_id,
                to_kind=kind,
                to_id=ref_id,
            )
        elif kind == "folder_bundle":
            # Cluster suggestions don't auto-create — the user goes
            # to the workspace creator with the memory_ids prefilled.
            apply_result = {
                "deferred": True,
                "memory_ids": payload.get("memory_ids", []),
                "topic": payload.get("topic", ""),
            }
        else:
            # Unknown kind — record as accepted but flag that we
            # didn't apply anything so the UI can show a hint.
            apply_result = {"unhandled_kind": kind}
    except Exception as e:
        # Surface the apply error but don't flip status — the user
        # may want to retry once they fix the broken state.
        raise ValueError(f"Couldn't apply suggestion: {e}")

    db = await get_db()
    await db.collection(SUGGESTIONS).document(suggestion_id).update({
        "status": "accepted",
        "accepted_at": _now_iso(),
        "apply_result": apply_result,
    })
    return {
        "success": True,
        "id": suggestion_id,
        "kind": kind,
        "applied": apply_result,
    }


async def reject_suggestion(suggestion_id: str) -> Dict[str, Any]:
    """Mark rejected and persist a dismissal so the same signature
    won't resurface in future scans. Idempotent."""
    sug = await get_suggestion(suggestion_id)
    if not sug:
        raise ValueError(f"Suggestion '{suggestion_id}' not found.")
    if sug.get("status") == "rejected":
        return {"success": True, "noop": True, "status": "rejected"}

    sig = sug.get("signature") or signature_for(
        sug.get("kind") or "",
        sug.get("ref_id") or "",
        sug.get("for_memory_id") or "",
    )
    user_id = sug.get("user_id") or get_uid()
    await _record_dismissal(user_id, sig)

    db = await get_db()
    await db.collection(SUGGESTIONS).document(suggestion_id).update({
        "status": "rejected",
        "rejected_at": _now_iso(),
    })
    return {"success": True, "id": suggestion_id, "signature": sig}


# --- LLM-driven on-demand suggestions ------------------------------------

async def _gather_candidates_for_memory(
    memory: Dict[str, Any],
    user_id: str,
) -> Dict[str, List[Dict[str, Any]]]:
    """Pull a small per-kind candidate pool the LLM can pick from.

    Each list is capped to keep the prompt cheap. We prefer recency
    + tag overlap so the model sees plausible candidates rather than
    a random slice of the user's data.
    """
    db = await get_db()
    mem_tags = {str(t).lower() for t in (memory.get("tags") or []) if t}
    mem_id = memory.get("id") or ""

    # Tasks: pending tasks for this user, newest first.
    task_snap = await db.collection("tasks") \
        .where("status", "==", "pending") \
        .order_by("created_at", direction="DESCENDING") \
        .limit(20) \
        .get()
    tasks = [t.to_dict() for t in task_snap if belongs_to_current_user(t.to_dict())][:10]

    # Events: future events for this user.
    today_iso = datetime.date.today().isoformat()
    try:
        ev_snap = await db.collection("schedules") \
            .where("date", ">=", today_iso) \
            .order_by("date") \
            .limit(20) \
            .get()
        events = [e.to_dict() for e in ev_snap if belongs_to_current_user(e.to_dict())][:8]
    except Exception:
        events = []

    # Habits: all habits (small set typically).
    hab_snap = await db.collection("habits").limit(40).get()
    habits = [h.to_dict() for h in hab_snap if belongs_to_current_user(h.to_dict())][:15]

    # Other memories sharing a tag.
    others: List[Dict[str, Any]] = []
    if mem_tags:
        try:
            mem_snap = await db.collection("memories") \
                .where("tags", "array_contains_any", list(mem_tags)[:10]) \
                .order_by("created_at", direction="DESCENDING") \
                .limit(15) \
                .get()
            for m in mem_snap:
                d = m.to_dict() or {}
                if d.get("id") == mem_id:
                    continue
                if belongs_to_current_user(d):
                    others.append(d)
            others = others[:8]
        except Exception:
            others = []

    return {"task": tasks, "event": events, "habit": habits, "memory": others}


async def suggest_links(
    memory_id: str,
    user_id: str = "",
) -> List[Dict[str, Any]]:
    """On-demand AI suggestions for a memory. Up to 8, mixed kinds.

    Soft-fails: any LLM error returns []. The caller treats that as
    "no suggestions right now" — we never block memory rendering on
    AI availability.
    """
    uid = (user_id or get_uid() or "").strip()
    if not memory_id or not uid:
        return []

    db = await get_db()
    mem_doc = await db.collection("memories").document(memory_id).get()
    if not mem_doc.exists:
        return []
    memory = mem_doc.to_dict() or {}
    if not belongs_to_current_user(memory):
        return []

    candidates = await _gather_candidates_for_memory(memory, uid)
    if not any(candidates.values()):
        return []

    # Compress candidates for the prompt — we only need id + label.
    def _tasks_block(items: List[Dict[str, Any]]) -> str:
        return "\n".join(
            f"- task:{i.get('id','')} | {(i.get('title') or '')[:80]}"
            for i in items if i.get("id")
        ) or "(none)"

    def _events_block(items: List[Dict[str, Any]]) -> str:
        return "\n".join(
            f"- event:{i.get('id','')} | {(i.get('title') or '')[:80]} | {i.get('date','')}"
            for i in items if i.get("id")
        ) or "(none)"

    def _habits_block(items: List[Dict[str, Any]]) -> str:
        return "\n".join(
            f"- habit:{i.get('id','')} | {(i.get('name') or '')[:60]}"
            for i in items if i.get("id")
        ) or "(none)"

    def _memories_block(items: List[Dict[str, Any]]) -> str:
        return "\n".join(
            f"- memory:{i.get('id','')} | {(i.get('title') or '')[:80]}"
            for i in items if i.get("id")
        ) or "(none)"

    prompt = (
        "You suggest cross-links for a personal knowledge base. Given a memory and "
        "candidate items, return UP TO 8 of the most likely related items the user "
        "would want linked. Only pick items that meaningfully relate — empty list is "
        "fine when nothing fits.\n\n"
        f"MEMORY:\n  title: {(memory.get('title') or '')[:120]}\n"
        f"  summary: {(memory.get('summary') or '')[:300]}\n"
        f"  tags: {', '.join((memory.get('tags') or [])[:8])}\n\n"
        f"CANDIDATE TASKS:\n{_tasks_block(candidates['task'])}\n\n"
        f"CANDIDATE EVENTS:\n{_events_block(candidates['event'])}\n\n"
        f"CANDIDATE HABITS:\n{_habits_block(candidates['habit'])}\n\n"
        f"CANDIDATE OTHER MEMORIES:\n{_memories_block(candidates['memory'])}\n\n"
        "Return JSON: {\"suggestions\": [{\"kind\": \"task|event|habit|memory\", "
        "\"ref_id\": \"<id>\", \"reason\": \"<short why>\", \"confidence\": 0.0-1.0}]}. "
        "Confidence reflects how sure you are. Skip anything below 0.4."
    )

    try:
        from app.ai_helper import chat_json
        result = await chat_json(
            messages=[{"role": "user", "content": prompt}],
            model=settings.FALLBACK_AI_MODEL,
            temperature=0.2,
        )
    except Exception as e:
        # Soft-fail: AI down, no suggestions today.
        print(f"auto_linker.suggest_links AI error: {e}")
        return []

    raw = result.get("suggestions") if isinstance(result, dict) else None
    if not isinstance(raw, list):
        return []

    valid_kinds = {"task", "event", "habit", "memory"}
    candidate_ids: Dict[str, set] = {
        "task": {i.get("id") for i in candidates["task"] if i.get("id")},
        "event": {i.get("id") for i in candidates["event"] if i.get("id")},
        "habit": {i.get("id") for i in candidates["habit"] if i.get("id")},
        "memory": {i.get("id") for i in candidates["memory"] if i.get("id")},
    }

    out: List[Dict[str, Any]] = []
    for s in raw[:20]:
        if not isinstance(s, dict):
            continue
        kind = str(s.get("kind") or "").lower()
        ref_id = str(s.get("ref_id") or "").strip()
        if kind not in valid_kinds or not ref_id:
            continue
        # Hallucination guard — only allow ids we showed the model.
        if ref_id not in candidate_ids[kind]:
            continue
        try:
            conf = float(s.get("confidence") or 0)
        except Exception:
            conf = 0.0
        if conf < 0.4:
            continue
        sig = signature_for(kind, ref_id, memory_id)
        if await _is_dismissed(uid, sig):
            continue
        out.append({
            "kind": kind,
            "ref_id": ref_id,
            "reason": str(s.get("reason") or "")[:200],
            "confidence": max(0.0, min(1.0, conf)),
        })
        if len(out) >= 8:
            break
    return out
