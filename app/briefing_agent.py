"""Daily Briefing persistence + history + recap.

Each generated briefing is now saved to a Firestore collection (`briefings`)
keyed by `{user_id}_{YYYY-MM-DD}` so the user can reopen any past day. We also
expose helpers that pull recent action items out of memories and remember
which ones the user has ticked off.

This module is intentionally LLM-light — only the weekly/monthly recap calls
the model. Day-of briefings continue to come from `capture_agent.generate_daily_briefing`,
this file just persists the result.
"""
from __future__ import annotations

import datetime
import hashlib
from collections import Counter
from typing import Any, Dict, List, Optional

from app.db import get_db
from app.user_context import belongs_to_current_user, get_uid
from app.ai_helper import chat_with_fallback
from app.config import settings


IST = datetime.timezone(datetime.timedelta(hours=5, minutes=30))

# Briefing notification settings — keyed by user_id. Values are intentionally
# small (a toggle, an hour, a tz offset, and the last date we already
# notified) so the scheduler can scan them cheaply.
_SETTINGS_COLLECTION = "briefing_settings"
_NOTIFICATION_COLLECTION = "briefing_notifications"


def _today_iso() -> str:
    return datetime.datetime.now(IST).date().isoformat()


def _doc_id(user_id: str, date_iso: str) -> str:
    return f"{user_id}_{date_iso}"


def _action_id(memory_id: str, text: str) -> str:
    """Stable per-action ID so completion state survives across briefing
    regenerations. The same action text on the same memory always hashes to
    the same id."""
    h = hashlib.sha1(f"{memory_id}|{text.strip().lower()}".encode("utf-8")).hexdigest()[:16]
    return f"a_{h}"


def _parse_iso(raw: Any) -> Optional[datetime.datetime]:
    if not raw:
        return None
    if isinstance(raw, datetime.datetime):
        return raw
    try:
        return datetime.datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
    except Exception:
        return None


# ── Persistence ──────────────────────────────────────────────────────────────

async def scan_habit_memory_links(user_id: str = "") -> Dict[str, Any]:
    """W4-2 — find new memories whose tags overlap with habit names
    and queue them as suggestions. Runs on the briefing trigger.

    Token-overlap is intentionally simple: lowercase habit name vs.
    lowercase memory tag, with a small stopword filter. The point is
    a high-precision nudge, not exhaustive matching — anything fancier
    risks noise the user has to dismiss.
    """
    from app.user_context import get_uid as _get_uid
    from app.auto_linker import create_suggestion
    uid = (user_id or _get_uid() or "").strip()
    if not uid:
        return {"created": 0, "scanned": 0}

    # P4B — opt-out gate. The whole scan is a no-op when the user has
    # toggled habit suggestions off. We still return the standard shape
    # so callers don't need a special branch.
    try:
        from app.auto_link_prefs import is_habit_suggestions_enabled
        if not await is_habit_suggestions_enabled(uid):
            return {"created": 0, "scanned": 0, "disabled": True}
    except Exception:
        pass

    db = await get_db()
    horizon = (datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(hours=24)).isoformat()

    mem_snap = await db.collection("memories") \
        .where("created_at", ">=", horizon) \
        .order_by("created_at", direction="DESCENDING") \
        .limit(60) \
        .get()
    # IMPORTANT — _atomic_create_memory writes the doc to Firestore BEFORE
    # mutating doc["id"]; the persisted body therefore has no `id` field.
    # Merge `doc.id` from the snapshot so suggestion creation has a valid
    # for_memory_id. Same pattern repeats in every W4 scanner below.
    memories = [{**(m.to_dict() or {}), "id": m.id} for m in mem_snap if (m.to_dict() or {}).get("user_id") == uid]

    hab_snap = await db.collection("habits").limit(80).get()
    habits = [{**(h.to_dict() or {}), "id": h.id} for h in hab_snap if (h.to_dict() or {}).get("user_id") == uid]
    if not habits or not memories:
        return {"created": 0, "scanned": len(memories)}

    _stop = {"the", "a", "an", "and", "or", "of", "to", "for", "with", "in", "on", "at", "is", "my", "your"}

    def _toks(s: str) -> set:
        return {w for w in (s or "").lower().replace("-", " ").replace("_", " ").split() if w and w not in _stop}

    created = 0
    for m in memories:
        mem_id = m.get("id") or ""
        if not mem_id:
            continue
        mem_tag_toks: set = set()
        for t in (m.get("tags") or []):
            mem_tag_toks |= _toks(str(t))
        # Title tokens widen the net a bit so habits like
        # "morning workout" hit a "Hit a new squat PR" memory tagged
        # only "fitness".
        title_toks = _toks(m.get("title") or "")
        candidate_toks = mem_tag_toks | title_toks
        if not candidate_toks:
            continue
        for h in habits:
            hab_id = h.get("id") or ""
            if not hab_id:
                continue
            name_toks = _toks(h.get("name") or "")
            if not name_toks:
                continue
            overlap = name_toks & candidate_toks
            if not overlap:
                continue
            # Confidence scaled by how much of the habit name was hit.
            conf = round(min(0.95, 0.5 + 0.15 * len(overlap)), 3)
            res = await create_suggestion(
                kind="habit",
                ref_id=hab_id,
                for_memory_id=mem_id,
                reason=f"Memory tags overlap with habit '{h.get('name') or hab_id}' ({', '.join(sorted(overlap))[:80]}).",
                confidence=conf,
                source="scan_habit_memory_links",
                user_id=uid,
            )
            if res and not res.get("noop"):
                created += 1
    return {"created": created, "scanned": len(memories), "habits": len(habits)}


async def scan_stale_linked_tasks(user_id: str = "", days: int = 14) -> List[Dict[str, Any]]:
    """W4-5 — pending tasks whose linked memory was captured ≥`days`
    ago. Returned as a list the briefing UI renders inline (not as a
    `suggestion` row, since the user already explicitly created the
    task — this is a nudge, not a proposed link)."""
    from app.user_context import get_uid as _get_uid
    uid = (user_id or _get_uid() or "").strip()
    if not uid:
        return []

    db = await get_db()
    cutoff = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=max(1, int(days)))

    task_snap = await db.collection("tasks") \
        .where("status", "==", "pending") \
        .limit(120) \
        .get()
    out: List[Dict[str, Any]] = []
    for t_doc in task_snap:
        t = t_doc.to_dict() or {}
        if t.get("user_id") != uid:
            continue
        mem_id = t.get("linked_memory_id") or ""
        if not mem_id:
            continue
        mem = await db.collection("memories").document(mem_id).get()
        if not mem.exists:
            continue
        m = mem.to_dict() or {}
        if m.get("user_id") != uid:
            continue
        captured = _parse_iso(m.get("created_at"))
        if not captured or captured > cutoff:
            continue
        # task.id same fallback — `tasks` collection writers also rely on
        # post-write doc["id"] mutation, so the persisted body may lack it.
        out.append({
            "task_id": t.get("id") or t_doc.id,
            "task_title": (t.get("title") or "")[:160],
            "memory_id": mem_id,
            "memory_title": (m.get("title") or "")[:160],
            "captured_date": captured.date().isoformat(),
            "days_stale": (datetime.datetime.now(datetime.timezone.utc) - captured).days,
        })
    out.sort(key=lambda x: -int(x.get("days_stale") or 0))
    return out[:20]


async def save_briefing(payload: Dict[str, Any], date_iso: Optional[str] = None) -> Dict[str, Any]:
    """Persist a briefing for `date_iso` (defaults to today, IST). Idempotent —
    re-saving the same date overwrites the previous copy so the user always
    sees the freshest text for that day."""
    uid = get_uid()
    when = date_iso or _today_iso()
    doc = {
        "user_id": uid,
        "date": when,
        "briefing": str(payload.get("briefing") or "").strip(),
        "executive_summary": str(payload.get("executive_summary") or "").strip(),
        "sections": payload.get("sections") or {},
        "stats": payload.get("stats") or {},
        "memories": payload.get("memories") or [],
        "tasks": payload.get("tasks") or [],
        "saved_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    }
    db = await get_db()
    try:
        await db.collection("briefings").document(_doc_id(uid, when)).set(doc)
    except Exception as e:
        print(f"save_briefing error: {e}")
    return doc


async def get_briefing(date_iso: str) -> Optional[Dict[str, Any]]:
    """Return the saved briefing for the given date for the current user, or None."""
    uid = get_uid()
    db = await get_db()
    try:
        snap = await db.collection("briefings").document(_doc_id(uid, date_iso)).get()
        if not getattr(snap, "exists", False):
            return None
        data = snap.to_dict() or {}
        if not belongs_to_current_user(data):
            return None
        return data
    except Exception as e:
        print(f"get_briefing error: {e}")
        return None


async def list_briefings(limit: int = 30) -> List[Dict[str, Any]]:
    """Return recent persisted briefings (newest first), capped to `limit`.

    Filters by `user_id == uid` server-side with `order_by("date", DESC)` and
    `limit` so we never scan the full collection. Falls back to a client-side
    filter only if Firestore composite-index errors come back, so the page
    keeps working until the index is added."""
    uid = get_uid()
    db = await get_db()
    out: List[Dict[str, Any]] = []
    try:
        try:
            snap = await db.collection("briefings").where(
                "user_id", "==", uid
            ).order_by("date", direction="DESCENDING").limit(limit).get()
        except Exception as inner:
            # Composite-index missing or backend unsupported — fall back so
            # the page still renders. Logged so the operator can add the index.
            print(f"list_briefings indexed query failed, falling back: {inner}")
            snap = await db.collection("briefings").where(
                "user_id", "==", uid
            ).get()
        for doc in snap:
            data = doc.to_dict() or {}
            if not belongs_to_current_user(data):
                continue
            out.append({
                "date": data.get("date") or "",
                "briefing": data.get("briefing") or "",
                "executive_summary": data.get("executive_summary") or "",
                "saved_at": data.get("saved_at") or "",
            })
    except Exception as e:
        print(f"list_briefings error: {e}")
    out.sort(key=lambda b: b.get("date", ""), reverse=True)
    return out[:limit]


# ── Action items (sourced from recent memories) ──────────────────────────────

async def list_action_items(limit_memories: int = 12, max_items: int = 20) -> List[Dict[str, Any]]:
    """Pull `action_items` out of the user's most recent memories and return
    them as a flat checkbox-friendly list. Completion state is read from a
    separate `briefing_action_state` doc per user so toggles don't mutate the
    underlying memory."""
    uid = get_uid()
    db = await get_db()
    items: List[Dict[str, Any]] = []
    completed = await _load_completed(uid)
    try:
        snap = await db.collection("memories").order_by(
            "created_at", direction="DESCENDING"
        ).limit(60).get()
        seen = 0
        for doc in snap:
            data = doc.to_dict() or {}
            if not belongs_to_current_user(data):
                continue
            if data.get("trashed_at") or data.get("archived"):
                continue
            seen += 1
            if seen > limit_memories:
                pass  # keep scanning a bit further so older memories with
                       # action_items still surface, but cap the total below
            mem_id = getattr(doc, "id", "") or data.get("id", "")
            for raw in (data.get("action_items") or [])[:6]:
                text = str(raw).strip()
                if not text:
                    continue
                aid = _action_id(mem_id, text)
                items.append({
                    "id": aid,
                    "memory_id": mem_id,
                    "memory_title": (data.get("title") or "Untitled")[:120],
                    "domain": data.get("domain") or "",
                    "text": text[:240],
                    "completed": aid in completed,
                    "created_at": str(data.get("created_at") or ""),
                })
                if len(items) >= max_items:
                    break
            if len(items) >= max_items:
                break
    except Exception as e:
        print(f"list_action_items error: {e}")
    items.sort(key=lambda x: (x["completed"], x["created_at"]), reverse=False)
    return items


async def _load_completed(uid: str) -> set:
    db = await get_db()
    try:
        snap = await db.collection("briefing_action_state").document(uid).get()
        if not getattr(snap, "exists", False):
            return set()
        data = snap.to_dict() or {}
        return set(data.get("completed") or [])
    except Exception:
        return set()


async def toggle_action_item(action_id: str, done: bool) -> Dict[str, Any]:
    """Mark an action item complete/incomplete.

    Concurrency-safe: uses Firestore's atomic `ArrayUnion` / `ArrayRemove`
    sentinels via `set(merge=True)` so two devices (or two tabs) toggling at
    the same time never clobber each other. The in-memory mock client honours
    the same sentinels so behaviour is consistent in local dev too."""
    # Hardening: refuse silly-long ids so a malicious caller can't grow the
    # `completed` array unboundedly. Real ids are short hashes (~24 chars).
    aid = (action_id or "").strip()[:128]
    if not aid:
        return {"id": action_id, "completed": done, "ignored": True}
    uid = get_uid()
    db = await get_db()
    from app.db import ArrayUnion, ArrayRemove
    sentinel = ArrayUnion([aid]) if done else ArrayRemove([aid])
    try:
        await db.collection("briefing_action_state").document(uid).set(
            {
                "user_id": uid,
                "completed": sentinel,
                "updated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            },
            merge=True,
        )
    except Exception as e:
        print(f"toggle_action_item error: {e}")
    return {"id": action_id, "completed": done}


# ── Today's timeline (tasks + revisits + calendar events) ───────────────────

async def todays_timeline() -> List[Dict[str, Any]]:
    """Chronologically merged list of today's tasks, due habits, due revisits
    and scheduled calendar events."""
    from app.task_agent import list_tasks
    from app.revisit_agent import list_due
    from app.calendar_agent import list_upcoming_events
    from app.extras_agent import list_habits

    today = datetime.datetime.now(IST).date()
    today_iso = today.isoformat()
    items: List[Dict[str, Any]] = []

    # Habits that haven't been ticked off today yet — surface as anytime items.
    try:
        habits = await list_habits()
        for h in habits:
            if h.get("completed_today"):
                continue
            items.append({
                "kind": "habit",
                "id": h.get("id", ""),
                "title": h.get("name") or h.get("title") or "Untitled habit",
                "subtitle": f"Streak: {h.get('streak', 0)}d",
                "time_iso": "",  # anytime — sorted to the end
                "color": "#10b981",
            })
    except Exception:
        pass

    try:
        tasks = await list_tasks(status="pending", limit=200)
    except Exception:
        tasks = []
    for t in tasks:
        due = (t.get("due_date") or "").strip()
        # Today-focused timeline: include OVERDUE + due-today + no-date tasks.
        # Future-dated tasks belong in the "Upcoming" card, not here.
        no_date = not due
        is_overdue = False
        overdue_days = 0
        if due:
            if due > today_iso:
                continue
            if due < today_iso:
                is_overdue = True
                try:
                    od = (today - datetime.date.fromisoformat(due)).days
                    overdue_days = max(1, od)
                except Exception:
                    overdue_days = 1
        priority = (t.get("priority") or "medium").lower()
        if priority not in ("high", "medium", "low"):
            priority = "medium"
        items.append({
            "kind": "task",
            "id": t.get("id", ""),
            "title": t.get("title", "Untitled"),
            "subtitle": (
                f"{overdue_days}d overdue" if is_overdue
                else "No due date" if no_date
                else "Due today"
            ),
            "time_iso": t.get("due_at") or "",
            "color": "#9333ea" if not is_overdue else "#ef4444",
            "priority": priority,
            "overdue": is_overdue,
            "overdue_days": overdue_days,
            "no_date": no_date,
            "due_date": due or None,
            # Tasks store the link as `linked_memory_id` — surface it under
            # `memory_id` so the timeline UI can render the "Linked memory"
            # chip and route to /memory/{id}.
            "memory_id": t.get("linked_memory_id") or t.get("memory_id") or "",
            "category": t.get("category") or "",
        })

    try:
        rv = await list_due(window_days=1)
        for r in rv.get("due", []):
            items.append({
                "kind": "revisit",
                "id": r.get("id", ""),
                "title": r.get("title", "Untitled"),
                "subtitle": "Revisit due",
                "time_iso": r.get("next_due") or "",
                "url": r.get("url", ""),
                "memory_id": r.get("memory_id", ""),
                "color": "#f59e0b",
            })
    except Exception:
        pass

    try:
        evts = await list_upcoming_events(days=1)
        for e in evts:
            # Calendar events store `date` (YYYY-MM-DD) and `time` (HH:MM)
            # separately. Combine them into a real ISO timestamp so the
            # frontend can bucket the event into Morning / Afternoon / Evening.
            ev_date = (e.get("date") or "").strip()
            ev_time = (e.get("time") or "").strip()
            start_raw = e.get("start_iso") or ""
            if not start_raw and ev_date:
                if ev_time:
                    start_raw = f"{ev_date}T{ev_time}:00"
                else:
                    start_raw = ev_date
            start_dt = _parse_iso(start_raw)
            if start_dt is None:
                continue
            try:
                # Treat naive datetimes as IST (events are typed in local time)
                if start_dt.tzinfo is None:
                    start_dt = start_dt.replace(tzinfo=IST)
                if start_dt.astimezone(IST).date() != today:
                    continue
            except Exception:
                continue
            items.append({
                "kind": "event",
                "id": e.get("id", ""),
                "title": e.get("title", "Untitled"),
                "subtitle": e.get("topic") or "Calendar",
                "time_iso": start_raw,
                "color": "#06b6d4",
                # Surface linked memory so the timeline can deep-link to it.
                "memory_id": e.get("linked_memory_id") or "",
            })
    except Exception:
        pass

    # Sort: overdue first (most overdue → least), then chronological by time,
    # then untimed/anytime items at the bottom. Habits and no-date tasks
    # naturally fall into the "anytime" bucket.
    def sort_key(it: Dict[str, Any]):
        if it.get("overdue"):
            # Negative so most-overdue (largest overdue_days) comes first
            return (0, -int(it.get("overdue_days") or 0), "")
        time_iso = it.get("time_iso") or ""
        if time_iso:
            return (1, 0, time_iso)
        return (2, 0, "")
    items.sort(key=sort_key)
    return items


# ── Weekly / Monthly recap ──────────────────────────────────────────────────

def _period_window(period: str) -> int:
    return 30 if period == "month" else 7


async def generate_recap(period: str = "week") -> Dict[str, Any]:
    """Aggregate captures for the period and ask the LLM for a short recap.
    Falls back to a deterministic stats-only summary if no model key is set."""
    days = _period_window(period)
    uid = get_uid()
    db = await get_db()
    now = datetime.datetime.now(datetime.timezone.utc)
    cutoff = now - datetime.timedelta(days=days)
    prev_cutoff = now - datetime.timedelta(days=days * 2)
    captures: List[Dict[str, Any]] = []
    prev_count = 0  # captures in the previous comparable window
    try:
        snap = await db.collection("memories").order_by(
            "created_at", direction="DESCENDING"
        ).limit(800).get()
        for doc in snap:
            data = doc.to_dict() or {}
            if not belongs_to_current_user(data):
                continue
            if data.get("trashed_at"):
                continue
            ts = _parse_iso(data.get("created_at"))
            if ts is None:
                continue
            if ts >= cutoff:
                captures.append(data)
            elif ts >= prev_cutoff:
                prev_count += 1
    except Exception as e:
        print(f"generate_recap fetch error: {e}")

    domain_counts = Counter(m.get("domain") or "General" for m in captures)
    tag_counts: Counter = Counter()
    for m in captures:
        for t in (m.get("tags") or [])[:6]:
            tag = str(t).strip().lower()
            if tag:
                tag_counts[tag] += 1
    src_counts = Counter((m.get("source_type") or "note").lower() for m in captures)
    top_titles = [(m.get("title") or "Untitled")[:90] for m in captures[:8]]

    cur_count = len(captures)
    diff = cur_count - prev_count
    direction = "flat"
    if diff > 0:
        direction = "up"
    elif diff < 0:
        direction = "down"
    stats = {
        "captures": cur_count,
        "previous_captures": prev_count,
        "captures_delta": diff,
        "captures_direction": direction,
        "top_domains": [{"name": d, "count": c} for d, c in domain_counts.most_common(5)],
        "top_tags": [{"tag": t, "count": c} for t, c in tag_counts.most_common(8)],
        "source_mix": [{"type": s, "count": c} for s, c in src_counts.most_common(4)],
    }

    recap_text = ""
    if settings.OPENAI_API_KEY and captures:
        period_label = "week" if period == "week" else "month"
        title_block = "\n".join(f"- {t}" for t in top_titles) or "(no captures)"
        prompt = (
            f"Write a friendly 3-4 sentence recap of the user's past {period_label} "
            f"of learning. They captured {len(captures)} items, mostly in "
            f"{(stats['top_domains'][0]['name'] if stats['top_domains'] else 'mixed topics')}. "
            f"Mention one specific topic from the list below.\n\nRecent titles:\n{title_block}\n\n"
            f"Tone: warm, concrete, no filler, no emojis."
        )
        try:
            recap_text = await chat_with_fallback(
                messages=[{"role": "user", "content": prompt}],
                model=settings.OPENAI_MODEL,
                temperature=0.4,
                max_tokens=180,
            )
        except Exception as e:
            print(f"generate_recap LLM error: {e}")
    if not recap_text:
        if captures:
            top_dom = stats["top_domains"][0]["name"] if stats["top_domains"] else "various topics"
            recap_text = (
                f"You captured {len(captures)} items in the past {days} days, "
                f"with {top_dom} leading the way. Keep the momentum going."
            )
        else:
            recap_text = (
                f"No captures in the past {days} days. A short reading session today "
                f"would re-start the streak."
            )

    return {
        "period": period,
        "days": days,
        "user_id": uid,
        "stats": stats,
        "recap": recap_text,
        "generated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    }


# ── Notification settings ───────────────────────────────────────────────────

DEFAULT_SEND_HOUR = 8
_VALID_HOURS = set(range(24))


def _normalize_settings(raw: Optional[Dict[str, Any]], uid: str) -> Dict[str, Any]:
    """Return a clean settings dict with safe defaults applied. Settings are
    intentionally minimal: a toggle, the local hour to deliver at, the
    user's timezone offset (minutes from UTC, matches `Date.getTimezoneOffset`
    inverted), and bookkeeping for the scheduler."""
    raw = raw or {}
    try:
        hour = int(raw.get("send_hour", DEFAULT_SEND_HOUR))
    except Exception:
        hour = DEFAULT_SEND_HOUR
    if hour not in _VALID_HOURS:
        hour = DEFAULT_SEND_HOUR
    try:
        # tz_offset_minutes: positive east of UTC. e.g. IST = +330.
        # Frontend computes -new Date().getTimezoneOffset() so values are sign-correct.
        tz = int(raw.get("tz_offset_minutes", 330))
    except Exception:
        tz = 330
    if tz < -14 * 60 or tz > 14 * 60:
        tz = 330
    return {
        "user_id": uid,
        "notifications_enabled": bool(raw.get("notifications_enabled", False)),
        "send_hour": hour,
        "tz_offset_minutes": tz,
        "last_notified_date": str(raw.get("last_notified_date") or ""),
        "updated_at": str(raw.get("updated_at") or ""),
    }


async def get_briefing_settings(uid: Optional[str] = None) -> Dict[str, Any]:
    """Return the briefing notification preferences for the current user, or a
    safe default (notifications off, 8am IST) if none has been saved yet."""
    user_id = uid or get_uid()
    db = await get_db()
    try:
        snap = await db.collection(_SETTINGS_COLLECTION).document(user_id).get()
        if getattr(snap, "exists", False):
            data = snap.to_dict() or {}
            return _normalize_settings(data, user_id)
    except Exception as e:
        print(f"get_briefing_settings error: {e}")
    return _normalize_settings(None, user_id)


async def set_briefing_settings(
    notifications_enabled: bool,
    send_hour: Optional[int] = None,
    tz_offset_minutes: Optional[int] = None,
) -> Dict[str, Any]:
    """Persist the user's notification preferences. Only fields the caller
    supplies are updated; the rest fall back to whatever is already saved
    (or the defaults from `_normalize_settings`)."""
    uid = get_uid()
    current = await get_briefing_settings(uid)
    merged = dict(current)
    merged["notifications_enabled"] = bool(notifications_enabled)
    if send_hour is not None:
        merged["send_hour"] = send_hour
    if tz_offset_minutes is not None:
        merged["tz_offset_minutes"] = tz_offset_minutes
    merged = _normalize_settings(merged, uid)
    merged["updated_at"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    db = await get_db()
    try:
        await db.collection(_SETTINGS_COLLECTION).document(uid).set(merged)
    except Exception as e:
        print(f"set_briefing_settings error: {e}")
    return merged


async def list_users_with_notifications_enabled() -> List[Dict[str, Any]]:
    """Scan the settings collection and return everyone who has notifications
    turned on. Used by the scheduler — kept tiny on purpose so the scan is
    cheap even if the collection grows."""
    db = await get_db()
    out: List[Dict[str, Any]] = []
    try:
        try:
            snap = await db.collection(_SETTINGS_COLLECTION).where(
                "notifications_enabled", "==", True
            ).get()
        except Exception:
            # Backend doesn't support `.where` (mock) — fall through to full scan.
            snap = await db.collection(_SETTINGS_COLLECTION).get()
        for doc in snap:
            data = doc.to_dict() or {}
            uid = data.get("user_id") or getattr(doc, "id", "")
            if not uid:
                continue
            if not data.get("notifications_enabled"):
                continue
            out.append(_normalize_settings(data, uid))
    except Exception as e:
        print(f"list_users_with_notifications_enabled error: {e}")
    return out


async def _persist_notification(uid: str, payload: Dict[str, Any]) -> None:
    """Upsert the *latest* unread briefing notification for `uid`. We keep one
    doc per user (keyed by uid) so the in-app banner always shows today's
    briefing and we don't accumulate stale rows."""
    db = await get_db()
    doc = {
        "user_id": uid,
        "date": payload.get("date") or "",
        "executive_summary": (payload.get("executive_summary") or "")[:600],
        "preview": (payload.get("briefing") or "")[:300],
        "created_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "seen": False,
    }
    try:
        await db.collection(_NOTIFICATION_COLLECTION).document(uid).set(doc)
    except Exception as e:
        print(f"_persist_notification error: {e}")


async def get_pending_notification() -> Optional[Dict[str, Any]]:
    """Return the latest *unseen* briefing notification for the current user,
    or None. The frontend polls this and shows a banner / browser notification
    when a payload is returned."""
    uid = get_uid()
    db = await get_db()
    try:
        snap = await db.collection(_NOTIFICATION_COLLECTION).document(uid).get()
        if not getattr(snap, "exists", False):
            return None
        data = snap.to_dict() or {}
        if not belongs_to_current_user(data):
            return None
        if data.get("seen"):
            return None
        return data
    except Exception as e:
        print(f"get_pending_notification error: {e}")
    return None


async def mark_notification_seen() -> Dict[str, Any]:
    """Flag the current user's latest briefing notification as seen so it
    stops re-appearing in the banner. Idempotent."""
    uid = get_uid()
    db = await get_db()
    try:
        snap = await db.collection(_NOTIFICATION_COLLECTION).document(uid).get()
        if not getattr(snap, "exists", False):
            return {"ok": True, "had_notification": False}
        data = snap.to_dict() or {}
        data["seen"] = True
        data["seen_at"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
        await db.collection(_NOTIFICATION_COLLECTION).document(uid).set(data)
    except Exception as e:
        print(f"mark_notification_seen error: {e}")
        return {"ok": False, "error": str(e)}
    return {"ok": True, "had_notification": True}


# ── Scheduler helpers ───────────────────────────────────────────────────────

def _user_local_now(tz_offset_minutes: int) -> datetime.datetime:
    """Convert UTC now to the user's local wall-clock using a fixed minute
    offset (no DST handling — good enough for an 8am notification)."""
    tz = datetime.timezone(datetime.timedelta(minutes=tz_offset_minutes))
    return datetime.datetime.now(datetime.timezone.utc).astimezone(tz)


def should_send_now(s: Dict[str, Any], now_utc: Optional[datetime.datetime] = None) -> bool:
    """True if the user's local time is at or past their configured send hour
    AND we haven't already notified them today. Designed to be called every
    few minutes so a delayed scheduler tick still catches them — once we
    notify, `last_notified_date` blocks any duplicates for the day."""
    if not s.get("notifications_enabled"):
        return False
    # Explicit None-check, not `or`, so a user who chose 0 (midnight) or a
    # timezone offset of exactly 0 (UTC) is honored instead of silently
    # falling back to the default.
    raw_tz = s.get("tz_offset_minutes")
    tz_offset = int(raw_tz) if raw_tz is not None else 330
    raw_hour = s.get("send_hour")
    send_hour = int(raw_hour) if raw_hour is not None else DEFAULT_SEND_HOUR
    tz = datetime.timezone(datetime.timedelta(minutes=tz_offset))
    base = (now_utc or datetime.datetime.now(datetime.timezone.utc))
    local = base.astimezone(tz)
    local_today = local.date().isoformat()
    if s.get("last_notified_date") == local_today:
        return False
    # Send only within an 8-hour window starting at send_hour, so a brief
    # outage doesn't cause us to skip the day, but a user who turned on
    # notifications late at night still gets tomorrow's briefing rather
    # than yesterday's. Handles wrap-around past midnight: e.g. send_hour
    # 20 means the window is 20:00 → next day 04:00.
    end_hour = send_hour + 8
    h = local.hour
    if end_hour <= 24:
        if h < send_hour or h >= end_hour:
            return False
    else:
        # Wraps midnight: in window iff hour >= send_hour OR hour < (end_hour-24).
        if h < send_hour and h >= end_hour - 24:
            return False
    return True


async def mark_user_notified(uid: str, local_date_iso: str) -> None:
    """Record that we already pushed a notification to `uid` for the given
    *local* date so the scheduler won't retry."""
    db = await get_db()
    try:
        snap = await db.collection(_SETTINGS_COLLECTION).document(uid).get()
        data = snap.to_dict() if getattr(snap, "exists", False) else {}
        data = data or {}
        data["user_id"] = uid
        data["last_notified_date"] = local_date_iso
        data["updated_at"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
        await db.collection(_SETTINGS_COLLECTION).document(uid).set(data)
    except Exception as e:
        print(f"mark_user_notified error: {e}")


async def deliver_briefing_notification(uid: str) -> Dict[str, Any]:
    """Generate (or reuse) today's briefing for `uid` and enqueue an in-app
    notification. Used by the scheduler and by the manual /briefing/notify-now
    endpoint so the same code path serves both. Sets the user-context var so
    every downstream function (which reads `get_uid()`) operates as `uid`."""
    from app.user_context import current_user_id_var
    from app.capture_agent import generate_daily_briefing

    token = current_user_id_var.set(uid)
    try:
        s = await get_briefing_settings(uid)
        raw_tz = s.get("tz_offset_minutes")
        tz_offset = int(raw_tz) if raw_tz is not None else 330
        local_today = _user_local_now(tz_offset).date().isoformat()

        # Prefer a briefing already saved for the user's local date; fall
        # back to today-IST (the existing on-demand cache) for anyone close
        # to that timezone. Only when neither exists do we regenerate, which
        # keeps the scheduler cheap and avoids a date-skew bug for users far
        # from IST whose local date crosses a UTC boundary.
        existing = await get_briefing(local_today)
        if existing is None and local_today != _today_iso():
            existing = await get_briefing(_today_iso())
        if existing:
            briefing = existing
        else:
            briefing = await generate_daily_briefing()
            try:
                await save_briefing(briefing, date_iso=local_today)
            except Exception as e:
                print(f"deliver_briefing_notification save error: {e}")

        await _persist_notification(uid, {
            "date": briefing.get("date") or local_today,
            "executive_summary": briefing.get("executive_summary") or "",
            "briefing": briefing.get("briefing") or "",
        })
        await mark_user_notified(uid, local_today)
        return {"ok": True, "user_id": uid, "date": local_today}
    finally:
        current_user_id_var.reset(token)
