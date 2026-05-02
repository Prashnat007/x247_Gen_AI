"""Dashboard aggregator — single async call returns everything the advanced
DashboardPage needs: greeting, pulse deltas, 84-day heatmap, top tags,
pick-up-where-left-off, today focus, 7-day forecast, capture streak.

No LLM calls — keeps the response fast (< 200ms in mock-DB dev).
"""
from __future__ import annotations
import datetime
from collections import Counter
from typing import Any, Dict, List, Optional, Tuple

from app.db import get_db
from app.task_agent import list_tasks
from app.revisit_agent import list_revisits


IST = datetime.timezone(datetime.timedelta(hours=5, minutes=30))


def _now_ist() -> datetime.datetime:
    return datetime.datetime.now(IST)


def _today_ist() -> datetime.date:
    return _now_ist().date()


def _greeting_for_hour(hour: int) -> Tuple[str, str]:
    if 4 <= hour < 12:
        return "morning", "Good morning"
    if 12 <= hour < 17:
        return "afternoon", "Good afternoon"
    if 17 <= hour < 21:
        return "evening", "Good evening"
    return "night", "Working late"


def _parse_created(raw: Any) -> Optional[datetime.date]:
    if not raw:
        return None
    if hasattr(raw, "date"):
        try:
            return raw.date()
        except Exception:
            pass
    s = str(raw)
    try:
        return datetime.date.fromisoformat(s[:10])
    except Exception:
        return None


def _parse_iso_dt(raw: Any) -> Optional[datetime.datetime]:
    if not raw:
        return None
    if isinstance(raw, datetime.datetime):
        return raw
    s = str(raw).replace("Z", "+00:00")
    try:
        return datetime.datetime.fromisoformat(s)
    except Exception:
        try:
            return datetime.datetime.fromisoformat(s[:10])
        except Exception:
            return None


def _delta(curr: int, prev: int) -> Dict[str, Any]:
    diff = curr - prev
    if prev <= 0:
        pct = 100 if curr > 0 else 0
    else:
        pct = round((diff / prev) * 100)
    direction = "up" if diff > 0 else ("down" if diff < 0 else "flat")
    return {"current": curr, "previous": prev, "diff": diff, "pct": pct, "direction": direction}


def _build_heatmap(memory_dates: List[datetime.date], days: int = 84) -> Tuple[List[Dict[str, Any]], int, int]:
    """Returns (cells, current_streak, longest_streak). Oldest first."""
    today = _today_ist()
    counts: Counter = Counter(memory_dates)
    cells: List[Dict[str, Any]] = []
    for offset in range(days - 1, -1, -1):
        d = today - datetime.timedelta(days=offset)
        c = counts.get(d, 0)
        cells.append({
            "date": d.isoformat(),
            "weekday": d.weekday(),
            "count": c,
        })

    # streaks (current = consecutive days ending today; longest in window)
    current_streak = 0
    for cell in reversed(cells):
        if cell["count"] > 0:
            current_streak += 1
        else:
            break

    longest = 0
    run = 0
    for cell in cells:
        if cell["count"] > 0:
            run += 1
            longest = max(longest, run)
        else:
            run = 0

    return cells, current_streak, longest


def _build_pulse(
    memory_dates: List[datetime.date],
    interaction_dates: List[datetime.date],
) -> Dict[str, Any]:
    today = _today_ist()
    yday = today - datetime.timedelta(days=1)
    week_start = today - datetime.timedelta(days=today.weekday())  # Monday
    last_week_start = week_start - datetime.timedelta(days=7)

    mem_today = sum(1 for d in memory_dates if d == today)
    mem_yday = sum(1 for d in memory_dates if d == yday)
    mem_this_week = sum(1 for d in memory_dates if d >= week_start)
    mem_last_week = sum(1 for d in memory_dates if last_week_start <= d < week_start)

    ai_today = sum(1 for d in interaction_dates if d == today)
    ai_yday = sum(1 for d in interaction_dates if d == yday)
    ai_this_week = sum(1 for d in interaction_dates if d >= week_start)
    ai_last_week = sum(1 for d in interaction_dates if last_week_start <= d < week_start)

    return {
        "memories_today": _delta(mem_today, mem_yday),
        "memories_this_week": _delta(mem_this_week, mem_last_week),
        "ai_calls_today": _delta(ai_today, ai_yday),
        "ai_calls_this_week": _delta(ai_this_week, ai_last_week),
    }


def _top_tags(tag_counter: Counter, limit: int = 12) -> List[Dict[str, Any]]:
    most = tag_counter.most_common(limit)
    if not most:
        return []
    max_count = most[0][1] or 1
    out = []
    for tag, count in most:
        out.append({
            "tag": tag,
            "count": count,
            "weight": round(count / max_count, 3),
        })
    return out


def _build_today_focus(
    revisits_due: List[Dict[str, Any]],
    pending_tasks: List[Dict[str, Any]],
    habits: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """Top 3 actionable items ranked by urgency."""
    today_iso = _today_ist().isoformat()
    items: List[Dict[str, Any]] = []

    # Overdue revisits get top priority
    for rv in revisits_due:
        overdue_h = rv.get("overdue_hours", 0) or 0
        urgency = 1000 + min(overdue_h, 720)  # cap at 30 days
        items.append({
            "kind": "revisit",
            "id": rv.get("id", ""),
            "title": rv.get("title", "Untitled"),
            "subtitle": (
                f"Overdue by {int(overdue_h)}h"
                if overdue_h and overdue_h < 48
                else (f"Overdue by {round(overdue_h / 24)}d" if overdue_h else "Due now")
            ),
            "action_label": rv.get("action_label", "Open"),
            "url": rv.get("url", ""),
            "memory_id": rv.get("memory_id", ""),
            "color": "#ef4444" if overdue_h > 0 else "#f59e0b",
            "urgency": urgency,
        })

    # Tasks: only overdue or due today belong in Today's Focus
    for t in pending_tasks:
        due = (t.get("due_date") or "").strip()
        priority = (t.get("priority") or "medium").lower()
        prio_weight = {"high": 3, "medium": 2, "low": 1}.get(priority, 2)
        if due and due < today_iso:
            urgency = 800 + prio_weight * 10
            sub = f"Overdue · {priority}"
        elif due == today_iso:
            urgency = 600 + prio_weight * 10
            sub = f"Due today · {priority}"
        else:
            # Future-dated and undated tasks are surfaced elsewhere — skip here
            continue
        items.append({
            "kind": "task",
            "id": t.get("id", ""),
            "title": t.get("title", "Untitled"),
            "subtitle": sub,
            "action_label": "Complete",
            "url": "",
            "memory_id": t.get("linked_memory_id", "") or "",
            "color": "#9333ea",
            "urgency": urgency,
        })

    # Habits not yet done today (light nudge)
    for h in habits:
        if h.get("completed_today"):
            continue
        streak = int(h.get("streak", 0) or 0)
        # struggling habits (low or zero streak) higher than long-running healthy ones
        urgency = 150 + max(0, 30 - streak)
        items.append({
            "kind": "habit",
            "id": h.get("id", ""),
            "title": h.get("name", "Habit"),
            "subtitle": f"{streak}d streak — keep it alive" if streak else "Start a streak today",
            "action_label": "Mark done",
            "url": "",
            "memory_id": "",
            "color": h.get("color", "#10b981"),
            "urgency": urgency,
        })

    items.sort(key=lambda x: x["urgency"], reverse=True)
    return items[:3]


def _build_forecast(
    revisits: List[Dict[str, Any]],
    pending_tasks: List[Dict[str, Any]],
    days: int = 7,
) -> List[Dict[str, Any]]:
    today = _today_ist()
    buckets: Dict[str, Dict[str, Any]] = {}
    for offset in range(days):
        d = today + datetime.timedelta(days=offset)
        buckets[d.isoformat()] = {
            "date": d.isoformat(),
            "label": d.strftime("%a"),
            "day": d.day,
            "revisits": 0,
            "tasks": 0,
        }

    for rv in revisits:
        if rv.get("status") not in ("active", None):
            continue
        nd = _parse_iso_dt(rv.get("next_due"))
        if not nd:
            continue
        try:
            d_iso = nd.astimezone(IST).date().isoformat()
        except Exception:
            d_iso = nd.date().isoformat()
        if d_iso in buckets:
            buckets[d_iso]["revisits"] += 1

    for t in pending_tasks:
        due = (t.get("due_date") or "").strip()
        if due and due in buckets:
            buckets[due]["tasks"] += 1

    return list(buckets.values())


async def _fetch_habits() -> List[Dict[str, Any]]:
    from app.user_context import belongs_to_current_user
    try:
        db = await get_db()
        snap = await db.collection("habits").get()
        out = []
        today_iso = _today_ist().isoformat()
        for doc in snap:
            d = doc.to_dict()
            if not belongs_to_current_user(d):
                continue
            d["id"] = getattr(doc, "id", d.get("id", ""))
            history = d.get("history", []) or []
            d["completed_today"] = today_iso in history
            d["streak"] = d.get("streak", 0)
            out.append(d)
        return out
    except Exception:
        return []


async def get_advanced_dashboard() -> Dict[str, Any]:
    from app.user_context import belongs_to_current_user
    db = await get_db()

    # Memories: pull all (small dataset in mock; bounded to 2k for safety)
    mem_snap = await db.collection("memories").limit(2000).get()
    memories = []
    for doc in mem_snap:
        m = doc.to_dict()
        if not belongs_to_current_user(m):
            continue
        m["id"] = getattr(doc, "id", m.get("id", ""))
        memories.append(m)
    memories.sort(
        key=lambda x: str(x.get("created_at") or ""),
        reverse=True,
    )

    memory_dates: List[datetime.date] = []
    tag_counter: Counter = Counter()
    for m in memories:
        d = _parse_created(m.get("created_at"))
        if d:
            memory_dates.append(d)
        for tag in (m.get("tags") or []):
            t = str(tag).strip().lower()
            if t and len(t) <= 40:
                tag_counter[t] += 1

    # Interactions
    interaction_dates: List[datetime.date] = []
    try:
        log_snap = await db.collection("interaction_logs").limit(2000).get()
        for doc in log_snap:
            d = doc.to_dict()
            if not belongs_to_current_user(d):
                continue
            ts = d.get("timestamp")
            dt = _parse_iso_dt(ts)
            if dt:
                try:
                    interaction_dates.append(dt.astimezone(IST).date())
                except Exception:
                    interaction_dates.append(dt.date())
    except Exception:
        pass

    # Tasks + revisits — single active-revisits read, derive both due and forecast slices
    pending_tasks = await list_tasks(status="pending", limit=200)
    all_revisits = await list_revisits(status="active", limit=2000)
    now_utc = datetime.datetime.now(datetime.timezone.utc)
    revisits_due: List[Dict[str, Any]] = []
    for rv in all_revisits:
        nd = _parse_iso_dt(rv.get("next_due"))
        if not nd:
            continue
        delta_h = (now_utc - nd).total_seconds() / 3600.0
        if delta_h >= 0:
            enriched = dict(rv)
            enriched["overdue_hours"] = round(delta_h, 1)
            revisits_due.append(enriched)
    revisits_due.sort(key=lambda r: r.get("overdue_hours", 0), reverse=True)

    cells, current_streak, longest_streak = _build_heatmap(memory_dates, days=84)
    pulse = _build_pulse(memory_dates, interaction_dates)
    top_tags = _top_tags(tag_counter, limit=12)
    habits = await _fetch_habits()
    today_focus = _build_today_focus(revisits_due, pending_tasks, habits)
    forecast = _build_forecast(all_revisits, pending_tasks, days=7)

    # Pick up where you left off
    pick_up: Optional[Dict[str, Any]] = None
    if memories:
        last_visited = None
        for m in memories:
            if m.get("last_visited"):
                if last_visited is None or str(m.get("last_visited")) > str(last_visited.get("last_visited", "")):
                    last_visited = m
        anchor = last_visited or memories[0]
        pick_up = {
            "id": anchor.get("id", ""),
            "title": anchor.get("title", "Untitled"),
            "summary": (anchor.get("summary") or "")[:220],
            "domain": anchor.get("domain", ""),
            "source_type": anchor.get("source_type", ""),
            "source_url": anchor.get("source_url", ""),
            "created_at": str(anchor.get("created_at", ""))[:19],
            "suggestion": (
                "Continue from where you stopped"
                if last_visited
                else "Your most recent capture"
            ),
        }

    now = _now_ist()
    period, label = _greeting_for_hour(now.hour)

    return {
        "greeting": {
            "period": period,
            "label": label,
            "hour_ist": now.hour,
            "iso": now.isoformat(),
        },
        "pulse": pulse,
        "activity_heatmap": {
            "days": 84,
            "cells": cells,
            "max": max((c["count"] for c in cells), default=0),
        },
        "streak": {
            "current": current_streak,
            "longest": longest_streak,
        },
        "top_tags": top_tags,
        "today_focus": today_focus,
        "forecast_7d": forecast,
        "pick_up": pick_up,
        "totals": {
            "memories": len(memories),
            "pending_tasks": len(pending_tasks),
            "active_revisits": len(all_revisits),
            "due_revisits": len(revisits_due),
            "interactions": len(interaction_dates),
        },
    }
