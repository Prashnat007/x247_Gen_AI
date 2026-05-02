"""
Page-specific specialist agents.

Each major page (Dashboard, Library/Vault, Recall, Focus/Tasks, Calendar,
Briefing, Capture, Learn, Insights, Workspace, Discover, Settings,
Integrations) has its own dock specialist. Specialists differ from the
main /agent orchestrator in two ways:

  1. The system prompt is tailored to the page (focused persona + the
     short list of things that page is *for*).
  2. The tool surface is restricted to a small allow-list — e.g. the
     Vault specialist only has memory tools, the Tasks specialist only
     has task tools. This keeps the LLM honest and prevents a "vault
     dock" from creating a calendar event by mistake.

Implementation reuses the existing `run_tool`, `_make_client`, the same
3-tier provider fallback, and the same tool registry from `coordinator.py`
— we just slice TOOLS to the page's allow-list and swap the system prompt.

The streaming loop is intentionally a simpler version of the orchestrator:
no parallel batching, no clarification, no scratchpad. Specialists are
short, focused, single-page interactions.
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections import OrderedDict
from typing import AsyncGenerator, Dict, List

from openai import APIConnectionError, APITimeoutError

from app.config import settings
from app.coordinator import (
    TOOLS,
    TOOL_AGENT_MAP,
    TOOL_DISPLAY_NAMES,
    _make_client,
    _fallback_model,
    _backup_gemini_model,
    _is_quota_error,
    _friendly_ai_error,
    _serialize_assistant_msg,
    run_tool,
)
from app.workflow_engine import create_workflow

log = logging.getLogger("recall-x247.specialists")


# ─── Per-page configuration ───────────────────────────────────────────────────
#
# Keys are the canonical page_id strings the frontend dock passes in. Values:
#   label         — friendly name shown in the dock header
#   focus         — one-line "what this dock is for" tagline
#   system_prompt — page-specific system prompt added to the base persona
#   allowed_tools — names of TOOLS this specialist can call. Anything else
#                   (including ask_clarification) is hidden from the LLM.
#
# Tone matches the rest of the app: Hinglish-friendly, casual, no emojis.

_BASE_PERSONA = (
    "You are a focused page-specialist agent inside Recall X247. "
    "You only handle this one page's job — politely redirect to the main "
    "Agent (/agent) for anything outside your scope. Keep replies short, "
    "Hinglish-friendly, no emojis. If a tool returns nothing, say so "
    "honestly — never invent results."
)


PAGE_SPECIALISTS: Dict[str, dict] = {
    "dashboard": {
        "label": "Dashboard helper",
        "focus": "Quick read on tasks, schedule and today's briefing.",
        "system_prompt": (
            "You are the Dashboard specialist. Help the user get a fast "
            "snapshot of what's pending today: tasks, calendar, briefing, "
            "and stats. Prefer short summaries (3-5 bullets max) over long "
            "prose. You cannot create or edit anything — for that, point "
            "the user to the right page or the main Agent."
        ),
        "allowed_tools": [
            "list_tasks",
            "list_schedule",
            "get_daily_briefing",
            "get_knowledge_stats",
            "list_memories",
        ],
    },
    "library": {
        "label": "Library helper",
        "focus": "Browse, edit, tag and recall captured memories.",
        "system_prompt": (
            "You are the Library (Vault/Notes) specialist. You manage saved "
            "memories — list them, search them, edit titles/summaries/tags, "
            "and capture new notes. You do NOT touch tasks or calendar. If "
            "the user asks for those, suggest the right page."
        ),
        "allowed_tools": [
            "list_memories",
            "recall_knowledge",
            "edit_memory",
            "capture_knowledge",
        ],
    },
    "vault": {  # alias — older menu still says "vault"
        "label": "Vault helper",
        "focus": "Edit, tag and link your saved memories.",
        "system_prompt": (
            "You are the Vault specialist. You manage saved memories — list, "
            "search, edit, and re-tag. You do NOT capture new content "
            "(that's the Capture page) and you do NOT touch tasks/calendar."
        ),
        "allowed_tools": [
            "list_memories",
            "recall_knowledge",
            "edit_memory",
        ],
    },
    "recall": {
        "label": "Recall helper",
        "focus": "Search your knowledge base and answer from saved memories.",
        "system_prompt": (
            "You are the Recall specialist. Your only job is to search the "
            "user's saved memories and answer their questions strictly from "
            "those results. If the search returns nothing relevant, say so — "
            "do NOT answer from general knowledge."
        ),
        "allowed_tools": [
            "recall_knowledge",
            "list_memories",
        ],
    },
    "focus": {
        "label": "Focus helper",
        "focus": "Add tasks, see what's pending, plan the day.",
        "system_prompt": (
            "You are the Focus (Tasks) specialist. Create tasks, list "
            "pending tasks, and help the user prioritize. You can also peek "
            "at the calendar for context but cannot create events — for "
            "scheduling, send them to the Calendar dock."
        ),
        "allowed_tools": [
            "list_tasks",
            "create_task",
            "list_schedule",
        ],
    },
    "calendar": {
        "label": "Calendar helper",
        "focus": "See upcoming events and schedule new ones.",
        "system_prompt": (
            "You are the Calendar specialist. List the user's upcoming "
            "events and schedule new ones. You can read tasks for context "
            "(e.g. 'block time for high-priority tasks') but cannot create "
            "or edit them."
        ),
        "allowed_tools": [
            "list_schedule",
            "schedule_event",
            "list_tasks",
        ],
    },
    "briefing": {
        "label": "Briefing helper",
        "focus": "Pull together today's briefing and stats.",
        "system_prompt": (
            "You are the Daily Briefing specialist. Generate the user's "
            "personalized briefing and surface knowledge-base stats. Keep "
            "answers concise — the briefing itself is the long-form view."
        ),
        "allowed_tools": [
            "get_daily_briefing",
            "get_knowledge_stats",
            "list_memories",
        ],
    },
    "capture": {
        "label": "Capture helper",
        "focus": "Save a YouTube link, web article or quick note.",
        "system_prompt": (
            "You are the Capture specialist. Help the user save new content "
            "into their knowledge base — YouTube URLs, web articles, or "
            "typed notes. Auto-detect the source type from the URL when you "
            "can. After capturing, confirm with a one-line summary. You do "
            "NOT manage existing memories — that's the Vault."
        ),
        "allowed_tools": [
            "capture_knowledge",
        ],
    },
    "learn": {
        "label": "Learn helper",
        "focus": "Build study plans from your saved knowledge.",
        "system_prompt": (
            "You are the Learn specialist. You help the user build study "
            "plans, surface relevant memories for a topic, and review "
            "captured material. Keep plans practical (number of days, what "
            "to do each day, no fluff)."
        ),
        "allowed_tools": [
            "generate_study_plan",
            "recall_knowledge",
            "list_memories",
        ],
    },
    "insights": {
        "label": "Insights helper",
        "focus": "Stats, trends and patterns across your knowledge base.",
        "system_prompt": (
            "You are the Insights/Analytics specialist. Surface knowledge "
            "stats, domain coverage, and learning velocity. Keep numbers "
            "front-and-centre and explain what they mean in one short line."
        ),
        "allowed_tools": [
            "get_knowledge_stats",
            "list_memories",
        ],
    },
    "workspace": {
        "label": "Workspace helper",
        "focus": "Quick recall and capture inside your workspace.",
        "system_prompt": (
            "You are the Workspace specialist. The user is doing focused "
            "work — answer quickly from their saved memories or capture a "
            "fresh note in one shot. Keep replies tight."
        ),
        "allowed_tools": [
            "recall_knowledge",
            "list_memories",
            "capture_knowledge",
        ],
    },
    "discover": {
        "label": "Discover helper",
        "focus": "Find related memories and surface what to revisit.",
        "system_prompt": (
            "You are the Discover specialist. Surface memories worth "
            "revisiting and find related items by topic. Read-only — no "
            "captures, no edits, no tasks."
        ),
        "allowed_tools": [
            "recall_knowledge",
            "list_memories",
            "get_knowledge_stats",
        ],
    },
    "settings": {
        "label": "Settings helper",
        "focus": "Explain settings and what each option does.",
        "system_prompt": (
            "You are the Settings specialist. You explain what each setting "
            "does and how to use the app — you have NO tools. If the user "
            "asks for data or actions (tasks, capture, etc.), point them to "
            "the right page or the main Agent."
        ),
        "allowed_tools": [],  # explanatory only — no tool calls
    },
    "integrations": {
        "label": "Integrations helper",
        "focus": "Explain integrations (YouTube, calendar etc.) and setup steps.",
        "system_prompt": (
            "You are the Integrations specialist. Explain available "
            "integrations and how to connect them. You have NO action tools "
            "— for actual data, point the user to the relevant page."
        ),
        "allowed_tools": [],
    },
}


def is_known_page(page_id: str) -> bool:
    return page_id in PAGE_SPECIALISTS


def list_pages() -> List[dict]:
    return [
        {"page_id": pid, "label": cfg["label"], "focus": cfg["focus"]}
        for pid, cfg in PAGE_SPECIALISTS.items()
    ]


# ─── Per-specialist session history ───────────────────────────────────────────
# Each (page_id, session_id) keeps its own short history so the dock on each
# page is independent of the main /agent chat AND of other docks.
#
# Bounded by TWO caps to keep memory predictable on a single instance:
#   * _HISTORY_KEEP_TURNS — per-key trim of message count so a single chat
#                            cannot grow tokens unbounded.
#   * _MAX_SESSION_KEYS   — process-wide cap on the NUMBER of (page,session)
#                            entries — eviction is LRU via OrderedDict.
#                            Without this, an attacker (or a buggy client
#                            churning session_ids) could grow memory until
#                            OOM. 500 keys * ~30 small messages each is a
#                            comfortable ceiling for an in-memory dev cache.
_SPECIALIST_HISTORY: "OrderedDict[str, List[dict]]" = OrderedDict()
_HISTORY_KEEP_TURNS = 8
_MAX_SESSION_KEYS = 500


def _hkey(page_id: str, session_id: str) -> str:
    """Compose the per-tenant specialist-history key.

    Includes the request's UID so two different users sharing a
    page_id + session_id (e.g. both clients hardcode "default_session")
    get isolated buckets. Pre-fix this was just `f"{page_id}::{session_id}"`,
    which let any caller who learned a session_id read or wipe another
    user's specialist chat — and the /workflows debug endpoint leaked
    exactly those session_ids cross-tenant.
    """
    from app.user_context import get_uid
    return f"{get_uid()}::{page_id}::{session_id}"


def _touch_key(key: str) -> None:
    """Mark `key` as most-recently-used so eviction targets the cold ones."""
    if key in _SPECIALIST_HISTORY:
        _SPECIALIST_HISTORY.move_to_end(key)


def _evict_if_needed() -> None:
    while len(_SPECIALIST_HISTORY) > _MAX_SESSION_KEYS:
        _SPECIALIST_HISTORY.popitem(last=False)  # drop oldest


def get_specialist_history(page_id: str, session_id: str) -> List[dict]:
    key = _hkey(page_id, session_id)
    _touch_key(key)
    return list(_SPECIALIST_HISTORY.get(key, []))


def clear_specialist_history(page_id: str, session_id: str) -> int:
    key = _hkey(page_id, session_id)
    n = len(_SPECIALIST_HISTORY.get(key, []))
    _SPECIALIST_HISTORY.pop(key, None)
    return n


def _trim_history(key: str) -> None:
    """Trim history so we don't blow up token count — keep last N user/assistant pairs."""
    h = _SPECIALIST_HISTORY.get(key, [])
    if len(h) <= _HISTORY_KEEP_TURNS * 4:  # rough cap
        return
    # Find the start of the Nth-from-last user message and keep from there.
    user_idxs = [i for i, m in enumerate(h) if m.get("role") == "user"]
    if len(user_idxs) <= _HISTORY_KEEP_TURNS:
        return
    keep_from = user_idxs[-_HISTORY_KEEP_TURNS]
    _SPECIALIST_HISTORY[key] = h[keep_from:]


# ─── Tool filtering ───────────────────────────────────────────────────────────
def _filter_tools(allowed: List[str]) -> List[dict]:
    if not allowed:
        return []
    allow = set(allowed)
    return [t for t in TOOLS if t.get("function", {}).get("name") in allow]


# ─── Streaming runner ─────────────────────────────────────────────────────────
async def run_specialist_stream(
    page_id: str,
    message: str,
    session_id: str,
) -> AsyncGenerator[str, None]:
    """
    Streaming SSE generator for a page specialist.

    Emits the same event shapes the main orchestrator uses (workflow_start,
    agent_start, agent_complete, token, workflow_complete, error) so the
    frontend dock can reuse the parser.
    """

    def sse(event_type: str, data: dict) -> str:
        return f"data: {json.dumps({'type': event_type, **data})}\n\n"

    cfg = PAGE_SPECIALISTS.get(page_id)
    if not cfg:
        yield sse("error", {"message": f"Unknown page specialist: {page_id}"})
        return

    if not settings.OPENAI_API_KEY:
        yield sse("error", {"message": "Neural AI not configured. Set GEN_APAC_API_KEY in Secrets."})
        return

    workflow = create_workflow(
        name=f"{cfg['label']} chat",
        description=message[:80],
        user_message=message,
        session_id=f"{page_id}::{session_id}",
    )
    yield sse("workflow_start", {
        "workflow_id": workflow.id,
        "message": message,
        "timestamp": workflow.created_at,
        "page_id": page_id,
        "specialist_label": cfg["label"],
    })

    tools = _filter_tools(cfg["allowed_tools"])
    history_key = _hkey(page_id, session_id)
    history = _SPECIALIST_HISTORY.get(history_key, [])

    system_block = (
        f"{_BASE_PERSONA}\n\n{cfg['system_prompt']}\n\n"
        f"Allowed tools for this dock: "
        f"{', '.join(cfg['allowed_tools']) if cfg['allowed_tools'] else 'none (you answer from general knowledge of the app only)'}.\n"
        "If the user asks for something outside this scope, say so plainly and "
        "suggest the right page or the main Agent (/agent)."
    )

    messages: List[dict] = [
        {"role": "system", "content": system_block},
        *history,
        {"role": "user", "content": message},
    ]
    turn_messages: List[dict] = [{"role": "user", "content": message}]

    client = _make_client(tier="primary")
    current_model = settings.OPENAI_MODEL
    reply = ""
    agents_called: List[str] = []

    MAX_ITERATIONS = 4

    for iteration in range(MAX_ITERATIONS):
        # ── Planning call with tier fallback ─────────────────────────────────
        async def _call(use_client, use_model):
            kwargs = dict(
                model=use_model,
                messages=messages,
                temperature=0.3,
                max_tokens=2048,
            )
            if tools:
                kwargs["tools"] = tools
                kwargs["tool_choice"] = "auto"
            return await asyncio.wait_for(
                use_client.chat.completions.create(**kwargs),
                timeout=45.0,
            )

        try:
            try:
                response = await _call(client, current_model)
            except Exception as e1:
                if not _is_quota_error(e1):
                    raise
                tier2_ok = False
                if settings.FALLBACK_AI_KEY and current_model != _fallback_model():
                    log.warning("Specialist primary quota — falling back to OpenRouter.")
                    client = _make_client(tier="fallback")
                    current_model = _fallback_model()
                    try:
                        response = await _call(client, current_model)
                        tier2_ok = True
                    except Exception as e2:
                        if not _is_quota_error(e2):
                            raise
                if not tier2_ok:
                    if not settings.BACKUP_GEMINI_API_KEY:
                        yield sse("error", {
                            "message": _friendly_ai_error(str(e1)),
                            "workflow_id": workflow.id,
                        })
                        workflow.fail(str(e1))
                        return
                    log.warning("Specialist fallback exhausted — using BACKUP Gemini key.")
                    client = _make_client(tier="backup_gemini")
                    current_model = _backup_gemini_model()
                    response = await _call(client, current_model)
        except (asyncio.TimeoutError, APITimeoutError):
            yield sse("error", {
                "message": "The AI took too long to respond. Please try again.",
                "workflow_id": workflow.id,
            })
            workflow.fail("LLM timeout")
            return
        except APIConnectionError as e:
            yield sse("error", {
                "message": f"Connection to AI failed: {str(e)}",
                "workflow_id": workflow.id,
            })
            workflow.fail(str(e))
            return
        except Exception as e:
            log.exception("Specialist call failed")
            yield sse("error", {
                "message": _friendly_ai_error(str(e)),
                "workflow_id": workflow.id,
            })
            workflow.fail(str(e))
            return

        msg = response.choices[0].message
        messages.append(msg)
        turn_messages.append(_serialize_assistant_msg(msg))

        # ── No tool calls → stream the reply word-by-word ────────────────────
        if not getattr(msg, "tool_calls", None):
            raw = msg.content or "All set — anything else?"
            words = raw.split(" ")
            for i, w in enumerate(words):
                chunk = w + (" " if i < len(words) - 1 else "")
                reply += chunk
                yield sse("token", {"text": chunk})
                await asyncio.sleep(0.005)
            break

        # ── Execute tool calls sequentially (specialists keep it simple) ─────
        for tc in msg.tool_calls:
            tool_name = tc.function.name
            try:
                tool_args = json.loads(tc.function.arguments or "{}")
            except Exception:
                tool_args = {}

            agent_name = TOOL_AGENT_MAP.get(tool_name, "Specialist")
            display = TOOL_DISPLAY_NAMES.get(tool_name, tool_name)
            step = workflow.add_step(agent_name, tool_name, tool_args)
            agents_called.append(agent_name)

            yield sse("agent_start", {
                "step_id": step.id,
                "agent": agent_name,
                "tool": tool_name,
                "name": display,
                "input": tool_args,
                "workflow_id": workflow.id,
            })

            t0 = asyncio.get_event_loop().time()
            try:
                result = await run_tool(tool_name, tool_args)
                duration_ms = int((asyncio.get_event_loop().time() - t0) * 1000)
                step.complete(result)
                # Truncate large results before showing back to LLM (keeps
                # context bounded; the dock chat is short-form by design).
                result_str = json.dumps(result, default=str)[:6000]
                messages.append({
                    "role": "tool",
                    "tool_call_id": tc.id,
                    "name": tool_name,
                    "content": result_str,
                })
                turn_messages.append({
                    "role": "tool",
                    "tool_call_id": tc.id,
                    "name": tool_name,
                    "content": result_str,
                })
                yield sse("agent_complete", {
                    "step_id": step.id,
                    "agent": agent_name,
                    "tool": tool_name,
                    "duration_ms": duration_ms,
                    "output_summary": _short_summary(result),
                    "workflow_id": workflow.id,
                })
            except Exception as e:
                step.fail(str(e))
                err_payload = {"error": str(e)}
                messages.append({
                    "role": "tool",
                    "tool_call_id": tc.id,
                    "name": tool_name,
                    "content": json.dumps(err_payload),
                })
                yield sse("agent_error", {
                    "step_id": step.id,
                    "agent": agent_name,
                    "tool": tool_name,
                    "error": str(e),
                    "workflow_id": workflow.id,
                })

    # ── Persist history & emit completion ────────────────────────────────────
    workflow.complete(reply)
    _SPECIALIST_HISTORY.setdefault(history_key, []).extend(turn_messages)
    _trim_history(history_key)
    _touch_key(history_key)
    _evict_if_needed()

    yield sse("workflow_complete", {
        "workflow_id": workflow.id,
        "reply": reply,
        "agents_called": list(dict.fromkeys(agents_called)),
        "page_id": page_id,
        "timestamp": workflow.created_at,
    })


def _short_summary(result) -> str:
    """One-line summary of a tool result for the dock UI."""
    try:
        if isinstance(result, dict):
            for k in ("summary", "message", "title", "reply"):
                v = result.get(k)
                if isinstance(v, str) and v.strip():
                    return v.strip()[:140]
            for k in ("memories", "tasks", "events", "items", "results"):
                v = result.get(k)
                if isinstance(v, list):
                    return f"{len(v)} {k}"
            return "Done"
        if isinstance(result, list):
            return f"{len(result)} items"
        if isinstance(result, str):
            return result[:140]
        return "Done"
    except Exception:
        return "Done"
