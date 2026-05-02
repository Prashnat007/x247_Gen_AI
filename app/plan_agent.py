"""
Plan Agent — multi-agent plan generator.

Orchestrates 4 specialist agents to turn ANY goal (study, project, research,
travel, career, health, learning, launch, etc.) into a structured, scheduled,
folder-organized plan with LIVE web/YouTube resources interwoven.

Agents:
    1. ResearcherAgent  - extracts intent + breaks goal into focus areas
    2. DiscoverAgent    - pulls live YouTube + curated articles per focus
    3. OrganizerAgent   - groups everything into folders / categories
    4. SchedulerAgent   - lays it out as a day-by-day actionable plan

Returns a single payload the UI renders end-to-end with a visible pipeline.
"""
from __future__ import annotations

import asyncio
import datetime
import json
import logging
import re
from typing import List, Dict, Any, Optional

from app.config import settings
from app.discover_agent import discover_resources
from app.ai_helper import chat_with_fallback, chat_json  # noqa: F401

logger = logging.getLogger("recall-x247.plan")


GOAL_TYPES = {
    "study": {
        "label": "Study / Learn a topic",
        "verb": "master",
        "lens": "concepts, exercises, projects, recall",
    },
    "project": {
        "label": "Ship a project",
        "verb": "ship",
        "lens": "scope, milestones, builds, tests, launch",
    },
    "research": {
        "label": "Research deep-dive",
        "verb": "investigate",
        "lens": "literature, hypotheses, experiments, synthesis",
    },
    "career": {
        "label": "Career move / interview prep",
        "verb": "land",
        "lens": "skills, projects, mocks, networking, applications",
    },
    "travel": {
        "label": "Travel itinerary",
        "verb": "plan",
        "lens": "logistics, places, food, costs, days",
    },
    "health": {
        "label": "Health / fitness goal",
        "verb": "achieve",
        "lens": "training blocks, nutrition, recovery, tracking",
    },
    "launch": {
        "label": "Launch / GTM",
        "verb": "launch",
        "lens": "positioning, audience, channels, content, metrics",
    },
    "skill": {
        "label": "Build a skill",
        "verb": "build",
        "lens": "fundamentals, drills, projects, feedback loops",
    },
}


def _today() -> datetime.date:
    return datetime.date.today()


def _date_str(offset_days: int) -> str:
    return (_today() + datetime.timedelta(days=offset_days)).isoformat()


def _slug(s: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", (s or "").lower()).strip("-")
    return s[:48] or "plan"


# ─── Agent 1: Researcher ──────────────────────────────────────────────────────

async def researcher_agent(topic: str, goal_type: str, days: int) -> Dict[str, Any]:
    """Break the user goal into 3-6 focus areas with one-line descriptions."""
    gt = GOAL_TYPES.get(goal_type, GOAL_TYPES["study"])
    prompt = (
        f"You are ResearcherAgent. The user wants to {gt['verb']} the goal: "
        f"\"{topic}\" in {days} days. Lens: {gt['lens']}.\n\n"
        f"Return JSON {{\"intent\": <1-line restatement>, \"focus_areas\": [<3 to 6 items>]}}. "
        f"Each focus_area MUST be an object with keys: "
        f"id (short kebab-case), title (2-4 words), description (1 short sentence), "
        f"weight (1-5 importance), search_query (3-6 word YouTube search query). "
        f"Be specific to the topic — no generic filler."
    )
    try:
        result = await chat_json(
            messages=[{"role": "user", "content": prompt}],
            model=settings.OPENAI_MODEL,
            temperature=0.4,
        )
        focus = result.get("focus_areas") or []
        # Sanitize
        clean = []
        for i, f in enumerate(focus[:6]):
            if not isinstance(f, dict):
                continue
            clean.append({
                "id": _slug(str(f.get("id") or f.get("title") or f"area-{i}")),
                "title": str(f.get("title") or f"Focus {i+1}").strip()[:60],
                "description": str(f.get("description") or "").strip()[:160],
                "weight": int(max(1, min(5, f.get("weight") or 3))),
                "search_query": str(f.get("search_query") or f.get("title") or topic).strip()[:80],
            })
        if not clean:
            # Fallback: split topic into one focus area
            clean = [{
                "id": _slug(topic),
                "title": topic[:40],
                "description": "Core focus area",
                "weight": 5,
                "search_query": topic,
            }]
        return {"intent": str(result.get("intent") or topic).strip()[:200], "focus_areas": clean}
    except Exception as e:
        logger.warning(f"researcher_agent failed: {e}")
        return {
            "intent": topic,
            "focus_areas": [{
                "id": _slug(topic), "title": topic[:40],
                "description": "Core focus area", "weight": 5, "search_query": topic,
            }],
        }


# ─── Agent 2: Discover (live YT + articles per focus area) ────────────────────

async def discover_for_focus(focus: Dict[str, Any]) -> Dict[str, Any]:
    """Run /discover for ONE focus area. Returns trimmed top-N items."""
    try:
        res = await discover_resources(topic=focus["search_query"], kinds=["video", "article"])
        items = res.get("items") or []
        # Trim to top 3 videos + top 2 articles per focus
        videos = [i for i in items if i.get("type") == "video"][:3]
        articles = [i for i in items if i.get("type") == "article"][:2]
        return {"focus_id": focus["id"], "videos": videos, "articles": articles}
    except Exception as e:
        logger.warning(f"discover_for_focus failed for {focus.get('id')}: {e}")
        return {"focus_id": focus["id"], "videos": [], "articles": []}


async def discover_agent(focus_areas: List[Dict[str, Any]]) -> Dict[str, List[Dict]]:
    """Run discovery for all focus areas in parallel."""
    results = await asyncio.gather(
        *[discover_for_focus(f) for f in focus_areas],
        return_exceptions=True,
    )
    by_focus: Dict[str, List[Dict]] = {}
    for r in results:
        if isinstance(r, dict):
            by_focus[r["focus_id"]] = (r.get("videos") or []) + (r.get("articles") or [])
    return by_focus


# ─── Agent 3: Organizer (folder structure) ────────────────────────────────────

def organizer_agent(
    topic: str,
    focus_areas: List[Dict[str, Any]],
    resources_by_focus: Dict[str, List[Dict]],
) -> Dict[str, Any]:
    """Group everything into a clean folder structure deterministically."""
    folders = []
    total_resources = 0
    for f in focus_areas:
        res = resources_by_focus.get(f["id"], [])
        videos = [r for r in res if r.get("type") == "video"]
        articles = [r for r in res if r.get("type") == "article"]
        total_resources += len(res)
        folders.append({
            "id": f["id"],
            "name": f["title"],
            "description": f["description"],
            "weight": f["weight"],
            "videos": videos,
            "articles": articles,
            "video_count": len(videos),
            "article_count": len(articles),
        })
    return {
        "root": _slug(topic),
        "folders": folders,
        "total_resources": total_resources,
    }


# ─── Agent 4: Scheduler (day-by-day) ──────────────────────────────────────────

def scheduler_agent(
    topic: str,
    days: int,
    folders: List[Dict[str, Any]],
    minutes_per_day: int = 60,
) -> List[Dict[str, Any]]:
    """Distribute folders across days deterministically; weave in resources."""
    if not folders:
        return []

    # Weight-based round-robin: each day gets a focus area + 1-2 resources
    # Sort folders by weight descending so heavier areas appear first
    sorted_folders = sorted(folders, key=lambda f: (-f.get("weight", 3), f["id"]))
    plan: List[Dict[str, Any]] = []
    res_idx_by_focus = {f["id"]: 0 for f in folders}

    for d in range(days):
        focus = sorted_folders[d % len(sorted_folders)]
        all_res = (focus.get("videos") or []) + (focus.get("articles") or [])
        idx = res_idx_by_focus[focus["id"]]
        # 1-2 resources per day from this focus, cycling
        chunk = []
        if all_res:
            chunk.append(all_res[idx % len(all_res)])
            if len(all_res) > 1:
                chunk.append(all_res[(idx + 1) % len(all_res)])
            res_idx_by_focus[focus["id"]] = idx + 2

        activities = []
        if d == 0:
            activities.append(f"Kick off — set up your workspace for {topic}")
        activities.append(f"Focus: {focus['name']}")
        if focus.get("description"):
            activities.append(focus["description"])
        for r in chunk:
            label = "Watch" if r.get("type") == "video" else "Read"
            title = (r.get("title") or "")[:80]
            dur = r.get("duration_display")
            extra = f" ({dur})" if dur else ""
            activities.append(f"{label}: {title}{extra}")
        if d == days - 1:
            activities.append("Wrap-up: write a 5-bullet summary + 3 questions")
        else:
            activities.append("Capture 3 key takeaways into your second brain")

        plan.append({
            "day": d + 1,
            "date": _date_str(d),
            "title": f"Day {d + 1} — {focus['name']}",
            "focus_area": focus["name"],
            "focus_id": focus["id"],
            "duration_minutes": minutes_per_day,
            "activities": activities,
            "resources": [{
                "title": r.get("title"),
                "url": r.get("url"),
                "type": r.get("type"),
                "thumbnail": r.get("thumbnail"),
                "youtube_id": r.get("youtube_id"),
                "channel_title": r.get("channel_title"),
                "duration_display": r.get("duration_display"),
                "domain": r.get("domain") or r.get("source"),
            } for r in chunk],
        })
    return plan


# ─── Public entry point ───────────────────────────────────────────────────────

async def generate_plan(
    topic: str,
    goal_type: str = "study",
    days: int = 7,
    minutes_per_day: int = 60,
    include_resources: bool = True,
) -> Dict[str, Any]:
    """Run the full 4-agent pipeline."""
    topic = (topic or "").strip()
    if not topic:
        return {"error": "topic is required"}
    days = max(1, min(30, int(days or 7)))
    minutes_per_day = max(15, min(480, int(minutes_per_day or 60)))
    goal_type = goal_type if goal_type in GOAL_TYPES else "study"

    pipeline_started = datetime.datetime.utcnow().isoformat() + "Z"
    timings: Dict[str, float] = {}

    # 1. Researcher
    t0 = asyncio.get_event_loop().time()
    research = await researcher_agent(topic, goal_type, days)
    timings["researcher_ms"] = round((asyncio.get_event_loop().time() - t0) * 1000)
    focus_areas = research["focus_areas"]

    # 2. Discover (parallel per focus)
    if include_resources:
        t0 = asyncio.get_event_loop().time()
        resources_by_focus = await discover_agent(focus_areas)
        timings["discover_ms"] = round((asyncio.get_event_loop().time() - t0) * 1000)
    else:
        resources_by_focus = {f["id"]: [] for f in focus_areas}
        timings["discover_ms"] = 0

    # 3. Organizer
    t0 = asyncio.get_event_loop().time()
    organized = organizer_agent(topic, focus_areas, resources_by_focus)
    timings["organizer_ms"] = round((asyncio.get_event_loop().time() - t0) * 1000)

    # 4. Scheduler
    t0 = asyncio.get_event_loop().time()
    schedule = scheduler_agent(topic, days, organized["folders"], minutes_per_day)
    timings["scheduler_ms"] = round((asyncio.get_event_loop().time() - t0) * 1000)

    return {
        "topic": topic,
        "intent": research["intent"],
        "goal_type": goal_type,
        "goal_label": GOAL_TYPES[goal_type]["label"],
        "days": days,
        "minutes_per_day": minutes_per_day,
        "focus_areas": focus_areas,
        "folders": organized["folders"],
        "total_resources": organized["total_resources"],
        "plan": schedule,
        "pipeline": {
            "started_at": pipeline_started,
            "agents": [
                {"name": "ResearcherAgent", "status": "done", "ms": timings["researcher_ms"], "out": f"{len(focus_areas)} focus areas"},
                {"name": "DiscoverAgent", "status": "done", "ms": timings["discover_ms"], "out": f"{organized['total_resources']} live resources"},
                {"name": "OrganizerAgent", "status": "done", "ms": timings["organizer_ms"], "out": f"{len(organized['folders'])} folders"},
                {"name": "SchedulerAgent", "status": "done", "ms": timings["scheduler_ms"], "out": f"{len(schedule)} days scheduled"},
            ],
            "total_ms": sum(timings.values()),
        },
    }


# ─── Single-day regenerate ────────────────────────────────────────────────────

async def regenerate_day(
    topic: str,
    day_index: int,
    plan: List[Dict[str, Any]],
    goal_type: str = "study",
    minutes_per_day: int = 60,
) -> Dict[str, Any]:
    """Regenerate a single day with a fresh angle. Uses the existing plan as
    context so the new day complements the others (no duplicate focus_area
    when avoidable, fresh activities, swap to alternate resources).
    """
    if not plan or day_index < 0 or day_index >= len(plan):
        return {"error": "invalid day_index"}

    target = plan[day_index]
    focus_name = (target.get("focus_area") or "").strip() or topic
    focus_id = target.get("focus_id") or _slug(focus_name)
    other_titles = [d.get("title", "") for i, d in enumerate(plan) if i != day_index]

    # Pull fresh resources for the focus area (best-effort; non-blocking on errors)
    resources: List[Dict[str, Any]] = []
    try:
        # Rotate the search query angle so we get genuinely different results
        # than the original day's resources (avoid same top hits).
        rotation = ["explained", "tutorial", "deep dive", "case study", "advanced", "best practices"]
        suffix = rotation[day_index % len(rotation)]
        focus_obj = {
            "id": focus_id,
            "name": focus_name,
            "description": "",
            "search_query": f"{focus_name} {suffix}",
        }
        disc = await discover_for_focus(focus_obj)
        resources = (disc.get("videos") or [])[:3] + (disc.get("articles") or [])[:3]
    except Exception as e:
        logger.warning(f"regenerate_day discover failed: {e}")

    # Pick 2 resources we have NOT already shown in plan
    seen_urls = set()
    for d in plan:
        for r in (d.get("resources") or []):
            if r.get("url"):
                seen_urls.add(r["url"])
    fresh = [r for r in resources if r.get("url") and r["url"] not in seen_urls][:2]
    if not fresh:
        fresh = resources[:2]

    # Build a richer activity list with a different angle than the existing day
    angles = [
        "Deep-dive perspective",
        "Hands-on practice",
        "Critique & compare",
        "Teach-back exercise",
        "Real-world case study",
        "Speed-run review",
    ]
    angle = angles[(day_index + int(asyncio.get_event_loop().time())) % len(angles)]

    activities: List[str] = [
        f"Angle: {angle} on {focus_name}",
        f"Warm-up — recall yesterday's takeaways for {topic}",
    ]
    for r in fresh:
        label = "Watch" if r.get("type") == "video" else "Read"
        title = (r.get("title") or "")[:80]
        dur = r.get("duration_display")
        extra = f" ({dur})" if dur else ""
        activities.append(f"{label}: {title}{extra}")
    activities.append(f"Reflect — write 3 questions you still have about {focus_name}")
    activities.append(f"Capture 2 fresh notes into your second brain")

    new_day = {
        "day": target.get("day", day_index + 1),
        "date": target.get("date") or _date_str(day_index),
        "title": f"Day {target.get('day', day_index + 1)} — {focus_name} ({angle})",
        "focus_area": focus_name,
        "focus_id": focus_id,
        "duration_minutes": minutes_per_day,
        "activities": activities,
        "resources": [{
            "title": r.get("title"),
            "url": r.get("url"),
            "type": r.get("type"),
            "thumbnail": r.get("thumbnail"),
            "youtube_id": r.get("youtube_id"),
            "channel_title": r.get("channel_title"),
            "duration_display": r.get("duration_display"),
            "domain": r.get("domain") or r.get("source"),
        } for r in fresh],
        "regenerated": True,
        "angle": angle,
    }
    return {"day": new_day}


# ─── Lightweight task → step-by-step micro-plan ───────────────────────────────
#
# Different from `generate_plan`: that one researches a topic and builds a
# multi-day study/build curriculum (heavyweight: 4 agents, dozens of resources).
# This one breaks ONE task into 3-7 ordered steps with optional dates spread
# across `days`. Used when the user clicks "Create Plan" on a task or insight.

import logging as _bd_logging
_bd_logger = _bd_logging.getLogger("recall-x247.breakdown")


async def breakdown_task(
    task_title: str,
    context: str = "",
    days: int = 3,
    start_date: str = "",
    deadline: str = "",
) -> Dict[str, Any]:
    """Break a single task into 3-7 ordered, dated micro-steps.

    Returns:
      {
        ok, task_title, days, start_date, deadline,
        summary       (1 sentence describing the approach),
        steps: [
          {order, title, day_offset, due_date, est_minutes, notes}
        ]
      }
    """
    task_title = (task_title or "").strip()
    if not task_title:
        return {"ok": False, "error": "task_title is required"}
    days = max(1, min(14, int(days or 3)))

    # Resolve start date
    try:
        if start_date:
            start = datetime.date.fromisoformat(start_date)
        else:
            start = _today()
    except ValueError:
        start = _today()

    # Resolve deadline → cap days so steps don't overshoot it.
    # If the deadline is already in the past relative to start_date, refuse —
    # we never want to manufacture due_dates beyond the user's deadline.
    deadline_date = None
    if deadline:
        try:
            deadline_date = datetime.date.fromisoformat(deadline)
        except ValueError:
            deadline_date = None
        if deadline_date is not None:
            window = (deadline_date - start).days + 1
            if window <= 0:
                return {
                    "ok": False,
                    "error": f"deadline {deadline_date.isoformat()} is on or before start_date {start.isoformat()}",
                }
            days = min(days, window)

    sys_prompt = (
        "You are a planning assistant. Break the user's task into 3-7 ordered "
        "micro-steps that fit inside the given day window. Each step must be "
        "imperative, concrete, and independently completable.\n\n"
        "Return STRICT JSON: {\"steps\": [...], \"summary\": \"...\"}\n"
        "Each step: {\n"
        "  order:        1-based integer\n"
        "  title:        imperative verb phrase, ≤90 chars\n"
        "  day_offset:   integer 0..(days-1) — which day to do it\n"
        "  est_minutes:  realistic estimate in minutes (15-240)\n"
        "  notes:        optional 1-sentence context (≤140 chars)\n"
        "}\n"
        "Rules: spread steps roughly evenly across days; never put more than 2 "
        "steps on the final day; the summary should be 1 sentence describing "
        "the overall approach (e.g. 'Research, prototype, then validate')."
    )
    user_prompt = (
        f"TASK: {task_title}\n"
        + (f"CONTEXT: {context.strip()[:600]}\n" if context else "")
        + f"AVAILABLE DAYS: {days}\n"
        + (f"DEADLINE: {deadline}\n" if deadline else "")
        + "Return JSON now."
    )

    try:
        result = await chat_json(
            messages=[
                {"role": "system", "content": sys_prompt},
                {"role": "user", "content": user_prompt},
            ],
            model=settings.OPENAI_MODEL,
            temperature=0.3,
        )
    except Exception as e:
        _bd_logger.error(f"breakdown_task LLM call failed: {e}")
        return {"ok": False, "error": f"LLM call failed: {e}"}

    raw_steps = result.get("steps") if isinstance(result, dict) else None
    if not isinstance(raw_steps, list) or not raw_steps:
        return {"ok": False, "error": "LLM returned no steps"}

    # Validate + clamp
    clean: List[Dict[str, Any]] = []
    for i, s in enumerate(raw_steps[:7]):
        if not isinstance(s, dict):
            continue
        title = (s.get("title") or "").strip()
        if not title:
            continue
        try:
            offset = max(0, min(days - 1, int(s.get("day_offset", i % days))))
        except (TypeError, ValueError):
            offset = i % days
        try:
            mins = int(s.get("est_minutes") or 30)
        except (TypeError, ValueError):
            mins = 30
        mins = max(15, min(240, mins))
        notes = (s.get("notes") or "").strip()[:200]
        due = (start + datetime.timedelta(days=offset)).isoformat()
        clean.append({
            "order": len(clean) + 1,
            "title": title[:120],
            "day_offset": offset,
            "due_date": due,
            "est_minutes": mins,
            "notes": notes,
        })

    if not clean:
        return {"ok": False, "error": "no valid steps after validation"}

    summary = (result.get("summary") or "").strip()[:240]

    return {
        "ok": True,
        "task_title": task_title,
        "days": days,
        "start_date": start.isoformat(),
        "deadline": deadline_date.isoformat() if deadline_date else "",
        "summary": summary,
        "steps": clean,
        "total_minutes": sum(s["est_minutes"] for s in clean),
    }
