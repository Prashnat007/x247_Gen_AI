"""
Revisit Reminder Agent
======================
Schedules and tracks "come back to this later" reminders for captured items
(memories, URLs, freeform notes). Supports recurring patterns:
  - once          : single shot (next_due then auto-completes)
  - daily         : every day
  - weekly        : every 7 days
  - biweekly      : every 14 days  ("twice a month-ish")
  - monthly       : every ~30 days
  - twice_weekly  : every 3-4 days
  - custom_days   : every N days (interval_days)
  - specific_date : fires once on a chosen date

All datetime values stored as ISO 8601 UTC strings for JSON friendliness.
"""

import uuid
import datetime
from typing import List, Optional
from app.db import get_db


FREQUENCIES = {
    "once": None,           # no recurrence
    "daily": 1,
    "twice_weekly": 3,      # ~Mon + Thu cadence
    "weekly": 7,
    "biweekly": 14,
    "monthly": 30,
    "custom_days": None,    # uses interval_days
    "specific_date": None,  # one-shot on specific date
}


def _now_utc() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


def _iso(dt: datetime.datetime) -> str:
    return dt.astimezone(datetime.timezone.utc).isoformat()


def _parse_iso(s: str) -> Optional[datetime.datetime]:
    if not s:
        return None
    try:
        if s.endswith("Z"):
            s = s[:-1] + "+00:00"
        dt = datetime.datetime.fromisoformat(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=datetime.timezone.utc)
        return dt
    except Exception:
        return None


def _compute_next_due(
    frequency: str,
    interval_days: int = 0,
    specific_date: str = "",
    starting_from: Optional[datetime.datetime] = None,
) -> Optional[datetime.datetime]:
    """Return next_due datetime (UTC) or None if frequency invalid / one-shot exhausted."""
    base = starting_from or _now_utc()

    if frequency == "specific_date":
        d = _parse_iso(specific_date)
        return d  # may be None — caller validates

    if frequency == "once":
        return _parse_iso(specific_date) or base

    if frequency == "custom_days":
        days = max(1, int(interval_days or 1))
        return base + datetime.timedelta(days=days)

    days = FREQUENCIES.get(frequency)
    if days is None:
        return None
    return base + datetime.timedelta(days=int(days))


async def create_revisit(
    title: str,
    frequency: str = "once",
    memory_id: str = "",
    url: str = "",
    notes: str = "",
    interval_days: int = 0,
    specific_date: str = "",
    action_label: str = "Open",
    starts_at: str = "",
) -> dict:
    """Create a revisit reminder. starts_at lets caller delay first fire (ISO date or datetime)."""
    if not title or not title.strip():
        return {"error": "title is required"}
    if frequency not in FREQUENCIES:
        return {"error": f"invalid frequency '{frequency}'. Must be one of {list(FREQUENCIES)}"}
    if frequency in ("specific_date", "once") and specific_date:
        if not _parse_iso(specific_date):
            return {"error": "specific_date must be ISO 8601 (YYYY-MM-DD or full datetime)"}
    if frequency == "custom_days" and (not interval_days or int(interval_days) < 1):
        return {"error": "interval_days >= 1 required for custom_days frequency"}

    starts = _parse_iso(starts_at) if starts_at else None
    next_due = _compute_next_due(frequency, interval_days, specific_date, starting_from=starts)
    if next_due is None and frequency != "once":
        next_due = _now_utc() + datetime.timedelta(days=1)

    from app.user_context import get_uid
    rid = str(uuid.uuid4())
    now = _now_utc()
    doc = {
        "id": rid,
        "title": title.strip()[:200],
        "memory_id": (memory_id or "").strip(),
        "url": (url or "").strip()[:1000],
        "notes": (notes or "").strip()[:2000],
        "frequency": frequency,
        "interval_days": int(interval_days or 0),
        "specific_date": specific_date or "",
        "action_label": (action_label or "Open").strip()[:40],
        "next_due": _iso(next_due) if next_due else "",
        "last_visited": "",
        "visit_count": 0,
        "status": "active",   # active | paused | completed
        "created_at": _iso(now),
        "updated_at": _iso(now),
        "user_id": get_uid(),
    }
    db = await get_db()
    await db.collection("revisits").document(rid).set(doc)
    return doc


async def list_revisits(
    status: str = "active",
    limit: int = 100,
) -> List[dict]:
    """List revisits scoped to current user, ordered by next_due ASC."""
    from app.user_context import belongs_to_current_user
    db = await get_db()
    coll = db.collection("revisits")
    base = coll.where("status", "==", status) if (status and status != "all") else coll
    docs: List[dict] = []
    fetch = limit * 4 if limit else 400
    try:
        query = base.order_by("next_due", direction="ASCENDING").limit(fetch)
        async for d in query.stream():
            data = d.to_dict()
            if belongs_to_current_user(data):
                docs.append(data)
                if len(docs) >= limit:
                    break
    except Exception:
        async for d in base.limit(fetch).stream():
            data = d.to_dict()
            if belongs_to_current_user(data):
                docs.append(data)
        docs.sort(key=lambda d: (d.get("next_due") or "9999-12-31T00:00:00+00:00"))
        docs = docs[:limit]
    return docs


async def list_due(window_days: int = 7, fetch_limit: int = 2000) -> dict:
    """Return {due, upcoming} arrays based on window_days.
    fetch_limit raised to 2000 so heavy users still see all due reminders;
    list_revisits orders by next_due ASC so even at the cap we cover the
    most urgent ones first."""
    all_active = await list_revisits(status="active", limit=fetch_limit)
    now = _now_utc()
    horizon = now + datetime.timedelta(days=max(0, window_days))
    due, upcoming = [], []
    for r in all_active:
        nd = _parse_iso(r.get("next_due", ""))
        if not nd:
            continue
        if nd <= now:
            r["overdue_hours"] = max(0, int((now - nd).total_seconds() // 3600))
            due.append(r)
        elif nd <= horizon:
            r["due_in_hours"] = int((nd - now).total_seconds() // 3600)
            upcoming.append(r)
    return {"due": due, "upcoming": upcoming, "due_count": len(due), "upcoming_count": len(upcoming)}


async def get_revisit(revisit_id: str) -> Optional[dict]:
    from app.user_context import belongs_to_current_user
    db = await get_db()
    snap = await db.collection("revisits").document(revisit_id).get()
    if not snap.exists:
        return None
    data = snap.to_dict()
    if not belongs_to_current_user(data):
        return None
    return data


async def mark_visited(revisit_id: str) -> dict:
    """Bumps last_visited, advances next_due based on frequency, auto-completes 'once'."""
    from app.user_context import belongs_to_current_user
    db = await get_db()
    ref = db.collection("revisits").document(revisit_id)
    snap = await ref.get()
    if not snap.exists or not belongs_to_current_user(snap.to_dict()):
        return {"error": "revisit not found"}
    doc = snap.to_dict()
    now = _now_utc()
    freq = doc.get("frequency", "once")

    update = {
        "last_visited": _iso(now),
        "visit_count": int(doc.get("visit_count", 0)) + 1,
        "updated_at": _iso(now),
    }
    if freq in ("once", "specific_date"):
        update["status"] = "completed"
        update["next_due"] = ""
    else:
        nd = _compute_next_due(
            freq,
            doc.get("interval_days", 0),
            doc.get("specific_date", ""),
            starting_from=now,
        )
        update["next_due"] = _iso(nd) if nd else ""
    await ref.update(update)
    doc.update(update)
    return doc


async def snooze_revisit(revisit_id: str, days: float = 1) -> dict:
    """Push next_due forward by N days (float, e.g. 0.5 = 12h)."""
    from app.user_context import belongs_to_current_user
    db = await get_db()
    ref = db.collection("revisits").document(revisit_id)
    snap = await ref.get()
    if not snap.exists or not belongs_to_current_user(snap.to_dict()):
        return {"error": "revisit not found"}
    doc = snap.to_dict()
    now = _now_utc()
    base = _parse_iso(doc.get("next_due", "")) or now
    if base < now:
        base = now
    new_due = base + datetime.timedelta(days=float(days))
    update = {"next_due": _iso(new_due), "status": "active", "updated_at": _iso(now)}
    await ref.update(update)
    doc.update(update)
    return doc


async def update_revisit(revisit_id: str, **fields) -> dict:
    """Patch arbitrary fields. Recomputes next_due if frequency/interval/specific_date changed."""
    from app.user_context import belongs_to_current_user
    db = await get_db()
    ref = db.collection("revisits").document(revisit_id)
    snap = await ref.get()
    if not snap.exists or not belongs_to_current_user(snap.to_dict()):
        return {"error": "revisit not found"}
    doc = snap.to_dict()
    now = _now_utc()

    allowed = {"title", "notes", "url", "action_label", "frequency", "interval_days", "specific_date", "status"}
    update = {k: v for k, v in fields.items() if k in allowed and v is not None}

    if any(k in update for k in ("frequency", "interval_days", "specific_date")):
        freq = update.get("frequency", doc.get("frequency", "once"))
        ivl = update.get("interval_days", doc.get("interval_days", 0))
        sd = update.get("specific_date", doc.get("specific_date", ""))
        if freq not in FREQUENCIES:
            return {"error": f"invalid frequency '{freq}'"}
        # Validate specific_date here so we don't silently break next_due
        if sd and not _parse_iso(sd):
            return {"error": "specific_date must be ISO 8601 (YYYY-MM-DD or full datetime)"}
        if freq == "custom_days" and (not ivl or int(ivl) < 1):
            return {"error": "interval_days >= 1 required for custom_days frequency"}
        nd = _compute_next_due(freq, ivl, sd, starting_from=now)
        update["next_due"] = _iso(nd) if nd else ""

    update["updated_at"] = _iso(now)
    await ref.update(update)
    doc.update(update)
    return doc


async def delete_revisit(revisit_id: str) -> dict:
    from app.user_context import belongs_to_current_user
    db = await get_db()
    ref = db.collection("revisits").document(revisit_id)
    snap = await ref.get()
    if not snap.exists or not belongs_to_current_user(snap.to_dict()):
        return {"error": "revisit not found"}
    await ref.delete()
    return {"id": revisit_id, "deleted": True}


async def pause_revisit(revisit_id: str) -> dict:
    return await update_revisit(revisit_id, status="paused")


async def resume_revisit(revisit_id: str) -> dict:
    return await update_revisit(revisit_id, status="active")


def _heuristic_suggestion(text: str) -> dict:
    """Pure-keyword fallback when LLM is unavailable."""
    t = (text or "").lower()
    hits = lambda kws: any(k in t for k in kws)

    if hits(["daily", "every day", "everyday"]):
        return {"frequency": "daily", "reason": "Mentions daily cadence"}
    if hits(["weekly", "every week", "each week"]):
        return {"frequency": "weekly", "reason": "Mentions weekly cadence"}
    if hits(["monthly", "every month", "each month"]):
        return {"frequency": "monthly", "reason": "Mentions monthly cadence"}
    if hits(["hackathon", "registration", "deadline", "apply by", "last date", "submit by"]):
        return {"frequency": "once", "reason": "Looks like a one-time deadline — use a specific date"}
    if hits(["routine", "habit", "exercise", "workout", "meditation"]):
        return {"frequency": "daily", "reason": "Habit-style — daily reminder"}
    if hits(["interview", "meeting", "call with", "demo"]):
        return {"frequency": "once", "reason": "One-off event"}
    if hits(["course", "lesson", "tutorial", "study", "review notes"]):
        return {"frequency": "twice_weekly", "reason": "Study material — review twice a week"}
    return {"frequency": "weekly", "reason": "No strong signal — defaulting to weekly check-in"}


def suggest_frequency_from_text(text: str) -> dict:
    """Sync wrapper — kept for any legacy callers. Returns heuristic only."""
    return _heuristic_suggestion(text)


async def ai_plan_revisit(
    title: str = "",
    url: str = "",
    notes: str = "",
    text: str = "",
) -> dict:
    """LLM-driven advanced revisit plan.

    Returns a richer suggestion than the heuristic — frequency, an optional
    interval / specific_date, a smart action label, and a one-line reason.
    Falls back to the heuristic if the LLM is unavailable or returns garbage.

    Output schema:
        {
          "frequency": "<one of FREQUENCIES>",
          "interval_days": <int, only if custom_days>,
          "specific_date": "YYYY-MM-DD" (only if specific_date / once),
          "action_label": "Visit", "Open notes", "Re-read", etc.,
          "smart_notes": "1 short sentence — what to do when this fires",
          "reason": "1 short sentence — why this cadence",
          "source": "ai" | "heuristic"
        }
    """
    blob = " | ".join([s for s in [title, url, notes, text] if s]).strip()
    if not blob:
        return {**_heuristic_suggestion(""), "source": "heuristic"}

    today_iso = _now_utc().date().isoformat()
    prompt = f"""You are scheduling a "come back to this later" reminder for a knowledge worker.
Today is {today_iso} (UTC). Pick the most useful cadence given the captured item below.

Allowed frequency keys (pick exactly one):
  - "once"          — single check-in, no recurrence
  - "daily"         — every day (habits, daily standups, journaling)
  - "twice_weekly"  — every 3-4 days (active study, ongoing project)
  - "weekly"        — every 7 days (general review, weekly digest)
  - "biweekly"      — every 14 days (slow-moving topics)
  - "monthly"       — every 30 days (long-term reference)
  - "custom_days"   — every N days (give an "interval_days" between 2 and 90)
  - "specific_date" — fires once on a chosen date (give "specific_date" YYYY-MM-DD)

Captured item:
TITLE: {title or "(none)"}
URL:   {url or "(none)"}
NOTES: {notes or "(none)"}
EXTRA: {text or "(none)"}

Rules:
- If the item mentions a deadline / submission date / event date in the future, use "specific_date".
- For habits / daily routines / journaling, use "daily".
- For active study material or ongoing courses, use "twice_weekly".
- For one-off interviews / meetings / demos with no clear date, use "once" with a specific_date 1-3 days before the likely event.
- Default to "weekly" only if no strong signal.
- "action_label" must be 1-3 words (e.g. "Visit", "Re-read", "Open notes", "Register", "Submit").
- "smart_notes" must be ONE short sentence (under 100 chars) describing what to do when the reminder fires.
- "reason" must be ONE short sentence (under 90 chars) explaining the chosen cadence.

Return ONLY valid JSON with these exact keys (omit interval_days / specific_date if not relevant):
{{
  "frequency": "...",
  "interval_days": 0,
  "specific_date": "",
  "action_label": "...",
  "smart_notes": "...",
  "reason": "..."
}}"""

    try:
        from app.ai_helper import chat_json
        from app.config import settings
        raw = await chat_json(
            messages=[{"role": "user", "content": prompt}],
            model=settings.OPENAI_MODEL,
            temperature=0.2,
        )
    except Exception:
        return {**_heuristic_suggestion(blob), "source": "heuristic"}

    if not isinstance(raw, dict):
        return {**_heuristic_suggestion(blob), "source": "heuristic"}

    freq = str(raw.get("frequency") or "").strip().lower()
    if freq not in FREQUENCIES:
        return {**_heuristic_suggestion(blob), "source": "heuristic"}

    out = {
        "frequency": freq,
        "action_label": str(raw.get("action_label") or "Open").strip()[:40] or "Open",
        "smart_notes": str(raw.get("smart_notes") or "").strip()[:200],
        "reason": str(raw.get("reason") or "").strip()[:200] or "AI suggested cadence",
        "source": "ai",
    }

    if freq == "custom_days":
        try:
            n = int(raw.get("interval_days") or 0)
            out["interval_days"] = max(2, min(90, n)) if n > 0 else 3
        except Exception:
            out["interval_days"] = 3
    elif freq == "specific_date":
        sd = str(raw.get("specific_date") or "").strip()
        if sd and _parse_iso(sd):
            out["specific_date"] = sd[:10]
        else:
            # AI picked specific_date but no date — fall back to 7 days out
            future = _now_utc() + datetime.timedelta(days=7)
            out["specific_date"] = future.date().isoformat()

    return out


# ───────────────────────────────────────────────────────────────────────
# W4-4 — Revisit recommendations.
#
# Find memories that haven't been revisited in `stale_days`+ AND whose
# tags appear in `min_recent_uses`+ recent (last 14d) captures. The
# combination prevents two failure modes: (a) suggesting a revisit on
# something the user has already moved past (no recent tag activity),
# and (b) suggesting on something they just captured (recency cutoff).
# ───────────────────────────────────────────────────────────────────────

async def scan_stale_revisit_candidates(
    user_id: str = "",
    stale_days: int = 14,
    min_recent_uses: int = 3,
    limit: int = 20,
) -> dict:
    """Return + persist suggestions for memories ripe for revisit.

    A candidate is:
      - older than `stale_days` (so genuinely "stale", not fresh)
      - has NO active revisit doc pointing at it
      - shares ≥1 tag with `min_recent_uses` other captures from the
        last 14 days (signal that the topic is still active)

    Suggestions go through `auto_linker.create_suggestion` so previous
    rejections silently filter them out on subsequent runs.
    """
    from app.user_context import get_uid as _get_uid
    from app.auto_linker import create_suggestion
    from collections import Counter

    uid = (user_id or _get_uid() or "").strip()
    if not uid:
        return {"created": 0, "scanned": 0, "candidates": []}

    db = await get_db()
    now = _now_utc()
    stale_cutoff = now - datetime.timedelta(days=max(1, int(stale_days)))
    recent_cutoff = now - datetime.timedelta(days=14)

    # Pull a generous slice of recent memories so we can build the
    # tag-frequency map for the "topic still active" check.
    recent_snap = await db.collection("memories") \
        .where("created_at", ">=", recent_cutoff.isoformat()) \
        .order_by("created_at", direction="DESCENDING") \
        .limit(200) \
        .get()
    # Same merge as the briefing/insight scanners — persisted memory
    # bodies don't include `id`, so we patch it back from snapshot.id.
    recent_memories = [{**(m.to_dict() or {}), "id": m.id} for m in recent_snap if (m.to_dict() or {}).get("user_id") == uid]
    if not recent_memories:
        return {"created": 0, "scanned": 0, "candidates": []}

    tag_counts: Counter = Counter()
    for m in recent_memories:
        for t in (m.get("tags") or [])[:8]:
            t = str(t or "").lower().strip()
            if t:
                tag_counts[t] += 1
    active_tags = {t for t, n in tag_counts.items() if n >= int(min_recent_uses)}
    if not active_tags:
        return {"created": 0, "scanned": len(recent_memories), "candidates": []}

    # Stale memories — separate query (older window).
    stale_snap = await db.collection("memories") \
        .order_by("created_at", direction="DESCENDING") \
        .limit(400) \
        .get()
    stale_pool = []
    for m_doc in stale_snap:
        m = m_doc.to_dict() or {}
        if m.get("user_id") != uid:
            continue
        created = _parse_iso(m.get("created_at"))
        if not created or created > stale_cutoff:
            continue
        # Patch in doc.id (see note above) so the suggestion's
        # for_memory_id is non-empty.
        m["id"] = m.get("id") or m_doc.id
        stale_pool.append(m)

    # Active revisit map — memories that already have an open revisit
    # are skipped. Status filter follows the existing collection convention.
    rv_snap = await db.collection("revisits").where("status", "==", "active").limit(500).get()
    has_revisit = set()
    for r_doc in rv_snap:
        r = r_doc.to_dict() or {}
        if r.get("user_id") != uid:
            continue
        if r.get("memory_id"):
            has_revisit.add(r["memory_id"])

    candidates = []
    created = 0
    for m in stale_pool:
        mem_id = m.get("id") or ""
        if not mem_id or mem_id in has_revisit:
            continue
        mem_tags = {str(t or "").lower().strip() for t in (m.get("tags") or [])}
        overlap = mem_tags & active_tags
        if not overlap:
            continue
        # Confidence scaled by how many active tags overlap.
        conf = round(min(0.9, 0.4 + 0.15 * len(overlap)), 3)
        candidates.append({
            "memory_id": mem_id,
            "title": (m.get("title") or "")[:160],
            "active_tags": sorted(overlap),
            "confidence": conf,
        })
        if len(candidates) >= int(limit):
            break

    for c in candidates:
        res = await create_suggestion(
            kind="revisit",
            ref_id="",
            for_memory_id=c["memory_id"],
            reason=(
                f"You haven't revisited '{c['title']}' in {stale_days}+ days, "
                f"but '{', '.join(c['active_tags'])[:60]}' is active in recent captures."
            ),
            confidence=c["confidence"],
            source="scan_stale_revisit_candidates",
            payload={"active_tags": c["active_tags"]},
            user_id=uid,
        )
        if res and not res.get("noop"):
            created += 1

    return {
        "created": created,
        "scanned": len(stale_pool),
        "active_tags": sorted(active_tags),
        "candidates": candidates,
    }
