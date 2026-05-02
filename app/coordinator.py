"""
Orchestrator — Primary multi-agent coordinator for Recall X247.
Routes user requests to specialized sub-agents using OpenAI function calling.
Tracks execution as Workflows with named Steps for full auditability.
"""

import json
import re
import asyncio
import datetime
import httpx
from typing import List, Dict, Any, AsyncGenerator, Optional, Tuple
from openai import AsyncOpenAI, APITimeoutError, APIConnectionError, RateLimitError
from app.config import settings, OPENROUTER_BASE_URL, OPENAI_BASE_URL
from app.user_context import get_uid

# Global timeout applied to every OpenAI call
_OPENAI_TIMEOUT = httpx.Timeout(connect=8.0, read=50.0, write=10.0, pool=5.0)


def _friendly_ai_error(raw: str) -> str:
    """Convert raw API error strings into short, user-friendly messages."""
    low = raw.lower()
    if "402" in raw or "credits" in low or "afford" in low or "billing" in low:
        return "The AI service is temporarily out of credits. Please try again later or contact support."
    if "429" in raw or "rate" in low or "quota" in low or "resource_exhausted" in low:
        return "Too many requests right now. Please wait a moment and try again."
    if "timeout" in low:
        return "The AI took too long to respond. Please try again."
    if "connection" in low or "network" in low:
        return "Could not reach the AI service. Check your connection and try again."
    return "Something went wrong with the AI. Please try again."


def _make_client(tier: str = "primary") -> AsyncOpenAI:
    """Create an OpenAI-compatible client for a given tier.

    Tiers (in order of preference):
      * "primary"       — main Gemini key (or main OpenAI/OpenRouter)
      * "fallback"      — OpenAI / OpenRouter fallback used on primary 429
      * "backup_gemini" — separate Gemini key on a different Google Cloud
                          billing account, used as the final tier when both
                          primary and fallback are exhausted.
    """
    if tier == "fallback" and settings.FALLBACK_AI_KEY:
        from app.config import _is_openrouter_key
        fb_key = settings.FALLBACK_AI_KEY
        base = settings.FALLBACK_AI_BASE_URL
        extra = {"HTTP-Referer": "https://recall-x247.replit.app", "X-Title": "Recall X247"} if _is_openrouter_key(fb_key) else {}
        return AsyncOpenAI(api_key=fb_key, base_url=base, default_headers=extra, timeout=_OPENAI_TIMEOUT)
    if tier == "backup_gemini" and settings.BACKUP_GEMINI_API_KEY:
        return AsyncOpenAI(
            api_key=settings.BACKUP_GEMINI_API_KEY,
            base_url=settings.BACKUP_GEMINI_BASE_URL,
            default_headers={},
            timeout=_OPENAI_TIMEOUT,
        )
    return AsyncOpenAI(
        api_key=settings.PRIMARY_AI_KEY or settings.OPENAI_API_KEY,
        base_url=settings.openai_base_url,
        default_headers=settings.openai_extra_headers,
        timeout=_OPENAI_TIMEOUT,
    )


def _fallback_model() -> str:
    return settings.FALLBACK_AI_MODEL


def _backup_gemini_model() -> str:
    return settings.BACKUP_GEMINI_MODEL


def _is_quota_error(err: Exception) -> bool:
    """True for both 429 (rate limit) and 402 (out of credits / billing)."""
    if isinstance(err, RateLimitError):
        return True
    raw = str(err)
    low = raw.lower()
    return (
        "402" in raw
        or "credits" in low
        or "billing" in low
        or "afford" in low
        or "insufficient" in low
        or "quota" in low
        or "resource_exhausted" in low
    )


from app.capture_agent import capture, generate_daily_briefing, generate_flashcards, generate_study_plan
from app.task_agent import create_task, list_tasks, get_tasks_summary
from app.calendar_agent import create_event, list_upcoming_events
from app.recall_agent import recall, list_memories, get_stats
from app.workflow_engine import create_workflow, Workflow, AGENT_REGISTRY

# ─── Tool Definitions (MCP-style) ─────────────────────────────────────────────

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "capture_knowledge",
            "description": "CaptureAgent: Save and summarize content from YouTube URLs, web articles, or typed notes. Automatically detects source type from URL.",
            "parameters": {
                "type": "object",
                "properties": {
                    "source_type": {"type": "string", "enum": ["youtube", "web", "note"], "description": "Type of content source"},
                    "url": {"type": "string", "description": "Full URL for youtube or web sources"},
                    "content": {"type": "string", "description": "Text content for notes"}
                },
                "required": ["source_type"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "recall_knowledge",
            "description": "RecallAgent: Search and answer questions from saved memories in the knowledge base. Use when user asks about saved knowledge.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "The question or topic to search for"}
                },
                "required": ["query"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "list_memories",
            "description": "RecallAgent: List memories from the knowledge vault, optionally filtered by domain.",
            "parameters": {
                "type": "object",
                "properties": {
                    "domain": {"type": "string", "description": "Optional domain filter (AI, Technology, Science, Business, Health, etc.)"},
                    "limit": {"type": "integer", "description": "Number of memories to return", "default": 10}
                }
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "edit_memory",
            "description": (
                "RecallAgent: Edit an existing memory in the vault. Use when the user says things like "
                "'change the title of that memory to X', 'update the summary', 'add tag Y', "
                "'fix the source URL'. If memory_id is omitted, the currently-focused memory "
                "(last captured / recalled) is edited. Pass only the fields you want to change."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "memory_id": {"type": "string", "description": "Memory ID to edit. Omit to edit the focused memory."},
                    "title": {"type": "string", "description": "New title (optional)."},
                    "summary": {"type": "string", "description": "New summary / notes body (optional). Pass empty string to clear."},
                    "source_url": {"type": "string", "description": "New source URL (optional). Pass empty string to clear."},
                    "tags": {"type": "array", "items": {"type": "string"}, "description": "Replacement tag list (optional). Replaces ALL existing tags."}
                }
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "create_task",
            "description": "TaskAgent: Create a new task or to-do item. Use when user mentions needing to do something.",
            "parameters": {
                "type": "object",
                "properties": {
                    "title": {"type": "string", "description": "Task title or description"},
                    "due_date": {"type": "string", "description": "Due date in YYYY-MM-DD format"},
                    "priority": {"type": "string", "enum": ["low", "medium", "high"]},
                    "linked_memory_id": {"type": "string", "description": "Optional related memory ID"}
                },
                "required": ["title"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "list_tasks",
            "description": "TaskAgent: Show the user's current task list.",
            "parameters": {
                "type": "object",
                "properties": {
                    "status": {"type": "string", "enum": ["pending", "completed"], "default": "pending"}
                }
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "schedule_event",
            "description": "CalendarAgent: Schedule a study session or calendar event.",
            "parameters": {
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "date": {"type": "string", "description": "YYYY-MM-DD"},
                    "time": {"type": "string", "description": "HH:MM 24h"},
                    "duration_minutes": {"type": "integer", "default": 60}
                },
                "required": ["title", "date", "time"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "list_schedule",
            "description": "CalendarAgent: Show upcoming calendar events.",
            "parameters": {"type": "object", "properties": {}}
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_daily_briefing",
            "description": "BriefingAgent: Generate a personalized AI daily briefing with learning summary and recommendations.",
            "parameters": {"type": "object", "properties": {}}
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_knowledge_stats",
            "description": "AnalyticsAgent: Get statistics about the knowledge base including memory count, domains, and learning velocity.",
            "parameters": {"type": "object", "properties": {}}
        }
    },
    {
        "type": "function",
        "function": {
            "name": "generate_study_plan",
            "description": "BriefingAgent: Create a personalized multi-day study plan for a topic.",
            "parameters": {
                "type": "object",
                "properties": {
                    "topic": {"type": "string", "description": "Topic to study"},
                    "days": {"type": "integer", "description": "Number of days", "default": 7}
                },
                "required": ["topic"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "ask_clarification",
            "description": (
                "ClarifierAgent: Ask the user a short clarifying question BEFORE acting "
                "when the request is genuinely ambiguous (e.g. 'show me my stuff' could "
                "mean tasks, memories, briefing or schedule; 'remind me about that' with "
                "no clear referent; 'plan it' with no topic). DO NOT use for minor "
                "missing fields you can infer — only for one-shot fork-in-the-road "
                "ambiguity where guessing wrong wastes the user's time. Provide 2-4 "
                "concrete options the user can tap. After this fires, the loop ENDS — "
                "the user's reply will start a fresh turn."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "question": {
                        "type": "string",
                        "description": "The short, direct question to ask the user (1 sentence)."
                    },
                    "options": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "2-4 concrete options the user can tap (each <= 60 chars). E.g. ['Show today\\'s tasks', 'Show recent memories', 'Show calendar']"
                    },
                    "reason": {
                        "type": "string",
                        "description": "One short line explaining why you need clarification (helps the user trust the question)."
                    }
                },
                "required": ["question", "options"]
            }
        }
    }
]

# ─── Tool safety classification ───────────────────────────────────────────────
# READ-ONLY tools have NO side effects and can be safely executed in parallel
# when the LLM emits multiple tool_calls in the same turn (e.g. "tasks check
# kar aur briefing bhi do" → list_tasks + get_daily_briefing fan out).
#
# Tools NOT in this set are treated as sequential — they either mutate state
# (capture/create/edit/schedule), navigate (ask_clarification), or have other
# side effects we want strictly ordered.
_PARALLEL_SAFE_TOOLS = frozenset({
    "recall_knowledge",
    "list_memories",
    "list_tasks",
    "list_schedule",
    "get_daily_briefing",
    "get_knowledge_stats",
})

# ─── Tool → Agent mapping ─────────────────────────────────────────────────────

TOOL_AGENT_MAP = {
    "capture_knowledge": "CaptureAgent",
    "recall_knowledge": "RecallAgent",
    "list_memories": "RecallAgent",
    "edit_memory": "RecallAgent",
    "create_task": "TaskAgent",
    "list_tasks": "TaskAgent",
    "schedule_event": "CalendarAgent",
    "list_schedule": "CalendarAgent",
    "get_daily_briefing": "BriefingAgent",
    "get_knowledge_stats": "AnalyticsAgent",
    "generate_study_plan": "BriefingAgent",
    "ask_clarification": "ClarifierAgent",
}

TOOL_DISPLAY_NAMES = {
    "capture_knowledge": "Capturing knowledge",
    "recall_knowledge": "Searching memories",
    "list_memories": "Listing memories",
    "edit_memory": "Editing memory",
    "create_task": "Creating task",
    "list_tasks": "Fetching tasks",
    "schedule_event": "Scheduling event",
    "list_schedule": "Fetching schedule",
    "get_daily_briefing": "Generating briefing",
    "get_knowledge_stats": "Analyzing stats",
    "generate_study_plan": "Creating study plan",
    "ask_clarification": "Asking for clarification",
}

# ─── System Prompt ────────────────────────────────────────────────────────────

SYSTEM_PROMPT = """You are Recall X247 Neural AI — an AI-powered Second Brain orchestrator.
You coordinate 7 specialized sub-agents and have FULL MEMORY of this conversation.

SUB-AGENTS YOU COORDINATE:
- CaptureAgent: Captures knowledge from YouTube, web, PDFs, notes → use capture_knowledge
- RecallAgent: Searches saved memories semantically → use recall_knowledge or list_memories
- TaskAgent: Creates and manages tasks → use create_task or list_tasks
- CalendarAgent: Schedules events and study sessions → use schedule_event or list_schedule
- BriefingAgent: Generates briefings and study plans → use get_daily_briefing or generate_study_plan
- AnalyticsAgent: Provides stats and insights → use get_knowledge_stats
- FlashcardAgent: Generates spaced-repetition flashcards from a memory

CONVERSATION CONTEXT IS SACRED:
- The full chat history is provided. NEVER pretend you don't know what was just discussed.
- If the user replies "yes", "sure", "do it", or any short affirmation, it ALWAYS refers to the most recent suggestion you made — execute that exact action without asking again.
- If the user says "no" / "later", acknowledge briefly and offer 1-2 alternative agents that could help.

CURRENT TOPIC (the item the user is currently focused on):
{focus_block}
- When the user uses pronouns ("uska", "iska", "that", "this one", "it", "wo wala", "same video"), they are ALMOST ALWAYS referring to the CURRENT TOPIC above.
- When you call create_task / schedule_event / generate_study_plan and the user is referring to the current topic, ALWAYS pass `linked_memory_id` set to the topic's memory_id and weave the topic title into the entity title (e.g. task title: "Watch — <topic title>").
- Never silently start a fresh search when the user is clearly continuing on the same topic. Reuse what you already have.

ROUTING RULES:
- YouTube/web URL → CaptureAgent (capture_knowledge)
- "create task" / "remind me" / "todo" → TaskAgent (create_task)
- "schedule" / "book time" / "study session" → CalendarAgent (schedule_event)
- "briefing" / "daily summary" → BriefingAgent (get_daily_briefing)
- "stats" / "how am I doing" → AnalyticsAgent (get_knowledge_stats)
- ONE agent per user turn unless the user explicitly asks for two
  (e.g. "save this AND remind me tomorrow"). Do NOT chain on your own.
- WHEN the user explicitly asks for MULTIPLE things in one turn (e.g.
  "tasks check kar aur briefing bhi do", "show me my tasks AND today's
  schedule", "give me stats and recent memories"), emit ALL the relevant
  tool_calls in a SINGLE assistant turn (parallel function calling).
  Read-only tools fan out concurrently; one round-trip, one wait.

CROSS-AGENT CONTEXT (the SCRATCHPAD block):
- Before each turn you may receive a "RECENT AGENT OUTPUTS" block
  listing IDs and short hints from earlier tool calls (last_memory_id,
  last_task_id, last_event_id, etc). USE these IDs implicitly — when
  the user says "schedule it", "remind me about that", "make a plan
  for it", pass the ID directly into the next tool call instead of
  re-searching.

CLARIFICATION (use ask_clarification BEFORE acting when ambiguous):
- If the user's request has TWO OR MORE plausible interpretations and
  guessing wrong would waste their time, call `ask_clarification` with
  a short question + 2-4 concrete options. Examples that NEED clarification:
    * "show me my stuff"           → tasks? memories? briefing? schedule?
    * "remind me about that"       → no clear referent in focus
    * "plan it"                    → topic not given
    * "open it"                    → multiple recent items
- Examples that DO NOT need clarification (just act):
    * "show my tasks"              → list_tasks
    * "save this URL"              → capture_knowledge
    * "what's on today"            → list_schedule
    * "remind me tomorrow about <focused topic>" → create_task with focus
- After ask_clarification fires, the loop ENDS. Don't call any other
  tool in the same turn — wait for the user's reply.

DO NOT recall or list inside this chat — those are routed to /recall, /tasks, /calendar by the app BEFORE you even see the message. If you somehow receive a pure recall/list query, respond with one short line pointing the user to the right page (e.g. "Opening /recall…") instead of calling recall_knowledge / list_memories / list_tasks / list_schedule. Use those tools only as a sub-step inside a multi-step action the user explicitly asked for.

AFTER A SUCCESSFUL CAPTURE:
- Reply with EXACTLY ONE short line confirming the save. Use this
  shape: "Saved <title> to your Inbox." (substitute the real title).
  Optionally append the source type in parens, e.g.
  "Saved 'Transformer (deep learning) - Wikipedia' to your Inbox (web)."
- Do NOT add a follow-up question, do NOT ask "how else can I help",
  do NOT list next-actions, do NOT call any other agent. STOP there.
- Never schedule, never create tasks, never generate plans, never
  list suggestions on your own after a capture. The user came to
  capture; respect that.
- If — and only if — the user later asks for something else
  ("schedule a session for this", "make a task", "give me a plan"),
  THEN call the matching agent — and pass the captured memory's id
  via `linked_memory_id` so the new task/event references it.

Today: {today}

Always confirm completed actions with ✅. Be concise. Use Hinglish-friendly tone (warm, direct)."""

# ─── Session History (in-memory conversation memory) ──────────────────────────

# Keyed by (uid, session_id) — NEVER by session_id alone. The session_id
# is generated client-side as `s-<timestamp>-<4 base36 chars>` (see
# AgentPage.tsx) which is not an authorisation secret; before this change
# any caller who learned a session_id (e.g. via the /workflows debug
# endpoint that used to leak them) could read or wipe another user's
# chat history. Tying every read/write to (uid, session_id) makes the
# session_id a per-user namespace key only.
_SESSION_HISTORY: Dict[Tuple[str, str], List[dict]] = {}
_SESSION_MAX_MESSAGES = 24  # Keep last ~12 turns (user+assistant pairs)


def _history_key(session_id: str) -> Tuple[str, str]:
    """Compose the per-tenant history key. Mirrors `_focus_key` /
    `_scratchpad_key` so all in-memory per-session state is scoped the
    same way."""
    return (get_uid(), session_id or "default")

# Per-(uid, session) "focus item" — the memory the user is currently working
# on. Refreshed whenever capture_knowledge succeeds or recall_knowledge / a
# memory action lands on a primary item. Lets the LLM resolve pronouns ("uska
# reminder set kar do") to the right memory_id without re-searching.
_SESSION_FOCUS: Dict[Tuple[str, str], dict] = {}
_FOCUS_TTL_SECONDS = 60 * 60  # one focused topic survives ~an hour of idle
_FOCUS_MAX_ENTRIES = 2000     # hard cap so a long-lived worker can't grow forever


def _gc_focus_map() -> None:
    """Lightweight GC: when the focus map exceeds the cap, evict TTL-expired
    entries first; if still over cap, drop the oldest by timestamp. Cheap
    enough to call on every write because we only do real work when over."""
    if len(_SESSION_FOCUS) <= _FOCUS_MAX_ENTRIES:
        return
    now = datetime.datetime.utcnow()
    expired = []
    for key, item in _SESSION_FOCUS.items():
        try:
            ts = datetime.datetime.fromisoformat(item.get("ts", ""))
            if (now - ts).total_seconds() > _FOCUS_TTL_SECONDS:
                expired.append(key)
        except Exception:
            expired.append(key)
    for k in expired:
        _SESSION_FOCUS.pop(k, None)
    if len(_SESSION_FOCUS) <= _FOCUS_MAX_ENTRIES:
        return
    # Still over cap → drop the oldest entries until we're back under.
    items = sorted(
        _SESSION_FOCUS.items(),
        key=lambda kv: kv[1].get("ts", ""),
    )
    overflow = len(_SESSION_FOCUS) - _FOCUS_MAX_ENTRIES
    for key, _ in items[:overflow]:
        _SESSION_FOCUS.pop(key, None)


def _focus_key(session_id: str) -> Tuple[str, str]:
    """Scope focus by (uid, session) so two users on the same hardcoded
    'agent-hub' session_id can never see each other's focus item."""
    return (get_uid(), session_id or "default")


def _set_focus(session_id: str, *, memory_id: str, title: str,
               source_type: Optional[str] = None,
               source_url: Optional[str] = None) -> None:
    if not memory_id or not title:
        return
    _SESSION_FOCUS[_focus_key(session_id)] = {
        "memory_id": memory_id,
        "title": title,
        "source_type": source_type or "",
        "source_url": source_url or "",
        "ts": datetime.datetime.utcnow().isoformat(),
    }
    _gc_focus_map()


def _get_focus(session_id: str) -> Optional[dict]:
    item = _SESSION_FOCUS.get(_focus_key(session_id))
    if not item:
        return None
    try:
        ts = datetime.datetime.fromisoformat(item["ts"])
        if (datetime.datetime.utcnow() - ts).total_seconds() > _FOCUS_TTL_SECONDS:
            _SESSION_FOCUS.pop(_focus_key(session_id), None)
            return None
    except Exception:
        pass
    return item


def _clear_focus(session_id: str) -> None:
    _SESSION_FOCUS.pop(_focus_key(session_id), None)


def _focus_block(session_id: str) -> str:
    item = _get_focus(session_id)
    if not item:
        return "(none yet — no specific item is in focus this turn)"
    bits = [f"- title: {item['title']}", f"- memory_id: {item['memory_id']}"]
    if item.get("source_type"):
        bits.append(f"- type: {item['source_type']}")
    if item.get("source_url"):
        bits.append(f"- url: {item['source_url']}")
    return "\n".join(bits)


# ─── Cross-agent scratchpad ──────────────────────────────────────────────────
# A small per-(uid, session) dict that accumulates the IMPORTANT structured
# signals from each tool call so a follow-up tool — even one called in the
# same parallel batch's NEXT iteration — can use them implicitly. This is
# how "scheduled it for tomorrow" silently picks up `last_memory_id` from a
# capture that just finished, without forcing the LLM to re-search or for the
# user to repeat the topic.
#
# We deliberately store small, scalar hints (IDs, short titles, counts,
# top-1 result snippet) — never full result blobs. Anything heavy belongs in
# the tool's role="tool" message that's already in `messages`. The scratchpad
# is what the LLM sees as a system hint BEFORE its next planning call so it
# remembers the relevant breadcrumbs.
_SESSION_SCRATCHPAD: Dict[Tuple[str, str], Dict[str, Any]] = {}
_SCRATCHPAD_TTL_SECONDS = 60 * 30  # ~30 min — long enough for a multi-step task
_SCRATCHPAD_MAX_ENTRIES = 2000     # mirror focus-map cap
_SCRATCHPAD_MAX_FIELDS = 16        # never inject more than this many hints


def _scratchpad_key(session_id: str) -> Tuple[str, str]:
    return (get_uid(), session_id or "default")


def _gc_scratchpad() -> None:
    if len(_SESSION_SCRATCHPAD) <= _SCRATCHPAD_MAX_ENTRIES:
        return
    now = datetime.datetime.utcnow()
    expired = []
    for key, item in _SESSION_SCRATCHPAD.items():
        try:
            ts = datetime.datetime.fromisoformat(item.get("_ts", ""))
            if (now - ts).total_seconds() > _SCRATCHPAD_TTL_SECONDS:
                expired.append(key)
        except Exception:
            expired.append(key)
    for k in expired:
        _SESSION_SCRATCHPAD.pop(k, None)
    if len(_SESSION_SCRATCHPAD) <= _SCRATCHPAD_MAX_ENTRIES:
        return
    items = sorted(_SESSION_SCRATCHPAD.items(), key=lambda kv: kv[1].get("_ts", ""))
    overflow = len(_SESSION_SCRATCHPAD) - _SCRATCHPAD_MAX_ENTRIES
    for key, _ in items[:overflow]:
        _SESSION_SCRATCHPAD.pop(key, None)


def _scratchpad_set(session_id: str, **fields: Any) -> None:
    if not fields:
        return
    key = _scratchpad_key(session_id)
    cur = _SESSION_SCRATCHPAD.get(key) or {}
    for k, v in fields.items():
        if v is None or v == "":
            continue
        cur[k] = v
    cur["_ts"] = datetime.datetime.utcnow().isoformat()
    _SESSION_SCRATCHPAD[key] = cur
    _gc_scratchpad()


def _scratchpad_get(session_id: str) -> Dict[str, Any]:
    key = _scratchpad_key(session_id)
    item = _SESSION_SCRATCHPAD.get(key)
    if not item:
        return {}
    try:
        ts = datetime.datetime.fromisoformat(item.get("_ts", ""))
        if (datetime.datetime.utcnow() - ts).total_seconds() > _SCRATCHPAD_TTL_SECONDS:
            _SESSION_SCRATCHPAD.pop(key, None)
            return {}
    except Exception:
        pass
    return {k: v for k, v in item.items() if not k.startswith("_")}


def _scratchpad_clear(session_id: str) -> None:
    _SESSION_SCRATCHPAD.pop(_scratchpad_key(session_id), None)


def _scratchpad_block(session_id: str) -> str:
    """Render the scratchpad as a compact system-message block. Returns
    empty string when there's nothing useful to inject (so we don't waste
    tokens on a stub block on the very first turn)."""
    pad = _scratchpad_get(session_id)
    if not pad:
        return ""
    # Keep only the N most recent fields so the block stays small.
    items = list(pad.items())[-_SCRATCHPAD_MAX_FIELDS:]
    lines = ["RECENT AGENT OUTPUTS (use these IDs/values when the user refers to them):"]
    for k, v in items:
        # Truncate long values so we never bloat the prompt.
        s = str(v)
        if len(s) > 160:
            s = s[:157] + "…"
        lines.append(f"- {k}: {s}")
    return "\n".join(lines)


def _learn_scratchpad_from_tool(session_id: str, tool_name: str, result: Any) -> None:
    """Pull small, useful structured signals from a tool result into the
    scratchpad. Called after every tool completes (including parallel
    batch members) so the next planning call can reference them.
    """
    if not isinstance(result, dict) or "error" in result:
        return
    fields: Dict[str, Any] = {}
    if tool_name == "capture_knowledge":
        if result.get("memory_id") or result.get("id"):
            fields["last_memory_id"] = result.get("memory_id") or result.get("id")
        if result.get("title"):
            fields["last_memory_title"] = result["title"]
        if result.get("source_type"):
            fields["last_memory_source_type"] = result["source_type"]
    elif tool_name == "recall_knowledge":
        sources = result.get("sources") or []
        if sources:
            top = sources[0] or {}
            if top.get("id") or top.get("memory_id"):
                fields["last_recall_top_id"] = top.get("id") or top.get("memory_id")
            if top.get("title"):
                fields["last_recall_top_title"] = top["title"]
        if isinstance(result.get("count"), int):
            fields["last_recall_count"] = result["count"]
        elif sources:
            fields["last_recall_count"] = len(sources)
    elif tool_name == "list_memories":
        rows = result if isinstance(result, list) else (result.get("memories") or [])
        if rows:
            fields["last_listed_memory_count"] = len(rows)
            top = rows[0]
            if isinstance(top, dict) and (top.get("id") or top.get("memory_id")):
                fields["last_listed_memory_top_id"] = top.get("id") or top.get("memory_id")
    elif tool_name == "create_task":
        if result.get("id") or result.get("task_id"):
            fields["last_task_id"] = result.get("id") or result.get("task_id")
        if result.get("title") or result.get("text"):
            fields["last_task_title"] = result.get("title") or result.get("text")
    elif tool_name == "list_tasks":
        rows = result if isinstance(result, list) else (result.get("tasks") or [])
        if rows:
            fields["last_listed_task_count"] = len(rows)
    elif tool_name == "schedule_event":
        if result.get("id") or result.get("event_id"):
            fields["last_event_id"] = result.get("id") or result.get("event_id")
        if result.get("title"):
            fields["last_event_title"] = result["title"]
    elif tool_name == "list_schedule":
        rows = result if isinstance(result, list) else (result.get("events") or [])
        if rows:
            fields["last_listed_event_count"] = len(rows)
    elif tool_name == "get_daily_briefing":
        # Briefing returns long markdown; just record we have it + a short
        # one-liner so a follow-up "remind me to read it" has something to
        # latch onto.
        if result.get("briefing") or result.get("summary"):
            blurb = (result.get("summary") or result.get("briefing") or "")
            if isinstance(blurb, str) and blurb:
                fields["last_briefing_blurb"] = blurb[:120]
    elif tool_name == "get_knowledge_stats":
        for k in ("total_memories", "domains_covered", "this_week"):
            if k in result:
                fields[f"last_stats_{k}"] = result[k]
    if fields:
        _scratchpad_set(session_id, **fields)


def _learn_focus_from_tool(session_id: str, tool_name: str, result: Any) -> None:
    """Inspect a tool result and refresh focus when it produced a primary item."""
    if not isinstance(result, dict) or "error" in result:
        return
    if tool_name == "capture_knowledge":
        mid = result.get("memory_id") or result.get("id")
        title = result.get("title")
        if mid and title:
            _set_focus(
                session_id,
                memory_id=str(mid),
                title=str(title),
                source_type=result.get("source_type"),
                source_url=result.get("source_url"),
            )
    elif tool_name == "recall_knowledge":
        sources = result.get("sources") or []
        if sources:
            top = sources[0] or {}
            mid = top.get("id") or top.get("memory_id")
            title = top.get("title")
            if mid and title:
                _set_focus(
                    session_id,
                    memory_id=str(mid),
                    title=str(title),
                    source_type=top.get("source_type"),
                    source_url=top.get("source_url"),
                )


# ─── Intent gate: send pure recall/list intents to their dedicated pages ─────
#
# The user explicitly asked for this: when the agent chat receives a message
# that is purely "find / show / recall my X", we don't run the recall_knowledge
# tool inline (which dumps a wall of cards into the chat). We emit a
# `navigate` SSE event so the client redirects to /recall (or /tasks,
# /calendar) with the query prefilled. The dedicated pages handle the search,
# show one card per topic, and preserve continuity for follow-ups.
#
# We use deterministic regex on the user message (cheap, predictable) instead
# of an extra LLM call. Anything that's not clearly a navigation intent —
# e.g. "save this URL", "make a task for tomorrow", "schedule next Tuesday"
# — falls through to the normal coordinator loop.

_RECALL_PATTERNS = [
    r"^\s*(recall|find|search|look\s*up|lookup|kya\s+pata)\b",
    r"^\s*(what|kya|kaun|which|kab|where|kahan)\b.*\b(saved|capture[d]?|note[d]?|read|seen|watched|wo wala|wo video|us article|that video|that article|my notes?|my videos?|my articles?|my pdfs?)\b",
    r"\b(tell me about|tell me more about|details? of|gist of|summary of)\b.*\b(my\s+|the\s+|that\s+|wo\s+|us\s+)",
    r"\b(do i have|kya mere paas|mere paas)\b.*\b(any|kuch|koi)\b",
]
_TASKS_LIST_PATTERNS = [
    r"^\s*(show|list|open|view|see|dikha[oa]|batao)\b.*\b(my\s+)?tasks?\b",
    r"^\s*(what|kya|kaun)\b.*\b(tasks?|todos?|to-?do)\b.*\b(today|now|pending|left|baki|hain|hai|this\s+week|tomorrow|do\s+i\s+(have|need))\b",
    # "what do I need to do (today|tomorrow|this week)?", "what's on my plate"
    r"\bwhat\s+do\s+i\s+(need\s+to\s+do|have\s+to\s+do)\b",
    r"\bwhat.?s\s+on\s+my\s+(plate|to-?do)\b",
    r"\b(my\s+)?(task|todo)\s+list\b",
    # "any tasks for today / tomorrow / this week"
    r"\bany\s+(tasks?|todos?|to-?do)s?\b",
    # Hinglish: "aaj ka kaam", "kal ke kaam", "kya karna hai"
    r"\bkya\s+karna\s+(hai|h)\b",
    r"\b(aaj|kal)\s+(ka|ke|ki)\s+(kaam|task|todo)s?\b",
]
_SCHEDULE_LIST_PATTERNS = [
    r"^\s*(show|list|open|view|see|dikha[oa]|batao)\b.*\b(my\s+)?(calendar|schedule|events?|agenda|meetings?)\b",
    # "what's on my calendar" + "what is on my calendar" (the previous regex
    # missed "what is" because `what.?s` only matches "whats"/"what's").
    r"\b(what.?s|what\s+is|what\s+are|kya\s+hai|kya\s+hain)\b.*\b(on\s+(my\s+)?(calendar|schedule|agenda)|today.?s\s+schedule|coming\s+up|upcoming)\b",
    # "any meetings / events / appointments today/tomorrow/this week"
    r"\bany\s+(meetings?|events?|appointments?|calls?|catch-?ups?)\b",
    # "do I have anything (scheduled|on|planned) (today|tomorrow|this week)"
    r"\bdo\s+i\s+have\s+(anything|something|any\s+(meetings?|events?|calls?))\b.*\b(today|tomorrow|this\s+week|on|planned|scheduled)?\b",
    # "what's coming up", "what's next on my calendar"
    r"\bwhat.?s\s+(coming\s+up|next|on)\b.*\b(week|calendar|schedule|today|tomorrow)?\b",
    # Hinglish: "kal kya hai", "aaj kya hai", "is week mein kya hai".
    # `(\s+\w+){0,3}` lets a few filler words sit between the time word
    # and "kya hai" ("is week mein kya hai", "aaj evening kya hai") without
    # going so wide that it eats unrelated questions.
    r"\b(aaj|kal|is\s+week|is\s+hafte)(\s+\w+){0,3}\s+kya\s+(hai|h)\b",
]
_NOTES_LIST_PATTERNS = [
    r"^\s*(show|list|open|view|dikha[oa])\b.*\b(my\s+)?notes?\b\s*$",
    r"\b(notes?\s+list|all\s+my\s+notes?)\b",
]
_VAULT_LIST_PATTERNS = [
    r"^\s*(open|show|view|dikha[oa])\b.*\b(vault|memories|library)\b",
]
_BRIEFING_PATTERNS = [
    r"\b(daily\s+briefing|today.?s\s+briefing|morning\s+briefing|brief\s+me)\b",
]

# Cheap signals that tell us the user's message also contains an ACTION verb,
# in which case we should NOT navigate — the orchestrator must handle it.
_ACTION_VETO = re.compile(
    r"\b(remind me|create (a |an )?(task|reminder|todo)|make (a |an )?(task|reminder|todo|note)|"
    r"add (a |an )?(task|reminder|todo|note)|schedule|book|put on (my |the )?calendar|"
    r"save this|capture this|add this|store this|note down|jot down|"
    r"summari[sz]e this|generate (a |an )?(plan|study plan|flashcards?))\b",
    re.IGNORECASE,
)
# URLs are almost always capture intents — never navigate them away.
_URL_RX = re.compile(r"https?://\S+", re.IGNORECASE)


def _classify_navigate_intent(message: str) -> Optional[Tuple[str, str]]:
    """Return (path, prefilled_query) if the message is a pure navigation
    intent that belongs on a dedicated page; else None.

    `prefilled_query` is what the destination page should auto-search for —
    typically the original message minus boilerplate ("recall ", "find ").
    """
    if not message or not message.strip():
        return None
    text = message.strip()
    if _URL_RX.search(text):
        return None
    if _ACTION_VETO.search(text):
        return None
    low = text.lower()

    def _strip_lead(s: str) -> str:
        # Strip leading "recall ", "find ", "search ", "look up " etc. so the
        # destination page's own search box gets a clean topic.
        return re.sub(
            r"^\s*(recall|find|search|look\s*up|lookup|tell me about|tell me more about|"
            r"what is|what was|what about|kya hai|kya tha|kya pata|details? of|gist of|summary of)\s+",
            "",
            s,
            count=1,
            flags=re.IGNORECASE,
        ).strip(" ?.!,") or s

    # Briefing / tasks / schedule / notes intents are now handled INLINE by
    # the LLM using its tools (get_daily_briefing, list_tasks, list_schedule,
    # list_notes). The orchestrator should reason and answer in chat first;
    # only suggest a dedicated page if the user explicitly asks for a deep dive
    # (e.g. "open vault", "open recall page").
    for pat in _VAULT_LIST_PATTERNS:
        if re.search(pat, low):
            return ("/vault", "")
    for pat in _RECALL_PATTERNS:
        if re.search(pat, low):
            return ("/recall", _strip_lead(text))
    return None


def _serialize_assistant_msg(msg) -> dict:
    """Convert an OpenAI ChatCompletionMessage to a JSON-safe dict for replay."""
    out: dict = {"role": "assistant", "content": msg.content or ""}
    if getattr(msg, "tool_calls", None):
        out["tool_calls"] = [
            {
                "id": tc.id,
                "type": "function",
                "function": {"name": tc.function.name, "arguments": tc.function.arguments},
            }
            for tc in msg.tool_calls
        ]
    return out


def _trim_history(session_id: str) -> None:
    key = _history_key(session_id)
    h = _SESSION_HISTORY.get(key, [])
    if len(h) <= _SESSION_MAX_MESSAGES:
        return
    # Drop oldest while ensuring we don't orphan a tool message without its assistant
    overflow = len(h) - _SESSION_MAX_MESSAGES
    new_start = overflow
    while new_start < len(h) and h[new_start].get("role") == "tool":
        new_start += 1
    _SESSION_HISTORY[key] = h[new_start:]


def get_session_history(session_id: str) -> List[dict]:
    return list(_SESSION_HISTORY.get(_history_key(session_id), []))


def clear_session_history(session_id: str) -> int:
    key = _history_key(session_id)
    n = len(_SESSION_HISTORY.get(key, []))
    _SESSION_HISTORY.pop(key, None)
    # Clearing the chat must also clear the focus item AND the cross-agent
    # scratchpad — otherwise the next turn (with empty history) would still
    # resolve pronouns / "RECENT AGENT OUTPUTS" against the previous chat's
    # last tool calls.
    _clear_focus(session_id)
    _scratchpad_clear(session_id)
    return n


# ─── Tool Executor ────────────────────────────────────────────────────────────

async def _edit_memory_tool(args: dict) -> dict:
    """Backing implementation for the `edit_memory` tool.

    Mirrors the validation in `patch_memory_endpoint` so the agent path and
    the UI path stay consistent: title can't be blanked, summary/source_url
    can be cleared, tags fully replace existing tags, capped lengths.
    """
    from app.db import get_db
    from app.user_context import belongs_to_current_user, get_uid

    memory_id = (args.get("memory_id") or "").strip()
    if not memory_id:
        # Fall back to whatever the orchestrator was last working on.
        # NOTE: session_id isn't threaded through run_tool, so we look for
        # the most recent focused memory belonging to the current user. If
        # there's exactly one such focus, use it; otherwise ask for clarity.
        try:
            uid = get_uid()
            mine = [v for k, v in _SESSION_FOCUS.items() if k[0] == uid and v.get("memory_id")]
            if len(mine) == 1:
                memory_id = str(mine[0]["memory_id"])
            elif len(mine) > 1:
                # Pick the most recent by timestamp.
                mine.sort(key=lambda v: v.get("ts", ""), reverse=True)
                memory_id = str(mine[0]["memory_id"])
        except Exception:
            pass
    if not memory_id:
        return {"error": "Need a memory_id to edit. Ask the user which memory they mean, or capture/recall one first."}

    db = await get_db()
    doc_ref = db.collection("memories").document(memory_id)
    doc = await doc_ref.get()
    if not doc.exists or not belongs_to_current_user(doc.to_dict()):
        return {"error": f"Memory '{memory_id}' not found."}

    updates: Dict[str, Any] = {}
    if "title" in args and args["title"] is not None:
        t = str(args["title"]).strip()
        if t:
            updates["title"] = t[:240]
    if "summary" in args and args["summary"] is not None:
        updates["summary"] = str(args["summary"]).strip()[:4000]
    if "source_url" in args and args["source_url"] is not None:
        updates["source_url"] = str(args["source_url"]).strip()[:2048]
    if "tags" in args and isinstance(args["tags"], list):
        seen, clean = set(), []
        for t in args["tags"]:
            tt = str(t or "").strip()
            if tt and tt.lower() not in seen:
                seen.add(tt.lower())
                clean.append(tt)
            if len(clean) >= 24:
                break
        updates["tags"] = clean

    if not updates:
        return {"id": memory_id, "updated": False, "message": "No changes — nothing to update."}

    await doc_ref.update(updates)
    return {"id": memory_id, "updated": True, "fields_changed": list(updates.keys()), **updates}


async def run_tool(name: str, args: dict) -> Any:
    if name == "capture_knowledge":
        return await capture(
            source_type=args.get("source_type", "note"),
            url=args.get("url", ""),
            content=args.get("content", ""),
        )
    elif name == "recall_knowledge":
        return await recall(query=args.get("query", ""))
    elif name == "list_memories":
        return await list_memories(domain=args.get("domain", ""), limit=args.get("limit", 10))
    elif name == "edit_memory":
        return await _edit_memory_tool(args)
    elif name == "create_task":
        return await create_task(
            title=args["title"],
            due_date=args.get("due_date", ""),
            priority=args.get("priority", "medium"),
            linked_memory_id=args.get("linked_memory_id", "")
        )
    elif name == "list_tasks":
        return await list_tasks(status=args.get("status", "pending"))
    elif name == "schedule_event":
        return await create_event(
            title=args["title"],
            date=args["date"],
            time=args["time"],
            duration_minutes=args.get("duration_minutes", 60)
        )
    elif name == "list_schedule":
        return await list_upcoming_events(days=7)
    elif name == "get_daily_briefing":
        return await generate_daily_briefing()
    elif name == "get_knowledge_stats":
        return await get_stats()
    elif name == "generate_study_plan":
        return await generate_study_plan(
            topic=args.get("topic", ""),
            days=args.get("days", 7)
        )
    elif name == "ask_clarification":
        # Pseudo-tool: the LLM signals "I need more info from the user
        # before I can act". The streaming loop intercepts the result,
        # emits a `clarification_needed` SSE event, and ends the turn.
        # We return a JSON-shaped result so it still slots cleanly into
        # the role="tool" history (in case the LLM wants to reference it
        # later) and so the workflow step shows a meaningful summary.
        question = (args.get("question") or "").strip()
        raw_options = args.get("options") or []
        options = [str(o).strip() for o in raw_options if str(o or "").strip()][:4]
        reason = (args.get("reason") or "").strip()
        return {
            "kind": "clarification_request",
            "question": question or "Could you give me a bit more detail?",
            "options": options,
            "reason": reason,
        }
    return {"error": f"Unknown tool: {name}"}


# ─── Coordinator (sync) ───────────────────────────────────────────────────────

async def run_coordinator(message: str, session_id: str) -> dict:
    if not settings.OPENAI_API_KEY:
        return {
            "reply": "Neural AI is not configured. Please set GEN_APAC_API_KEY in the Secrets panel.",
            "agents_called": [],
            "session_id": session_id,
            "error": "Unauthorized"
        }

    workflow = create_workflow(
        name="Chat Request",
        description=message[:80],
        user_message=message,
        session_id=session_id
    )

    client = _make_client()
    current_model = settings.OPENAI_MODEL

    history = _SESSION_HISTORY.get(_history_key(session_id), [])
    new_user_msg = {"role": "user", "content": message}
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT.format(
            today=datetime.date.today().isoformat(),
            focus_block=_focus_block(session_id),
        )},
        *history,
        new_user_msg,
    ]
    turn_messages: List[dict] = [new_user_msg]
    capture_succeeded = False

    reply = ""
    try:
        for _ in range(6):
            async def _planning_call(use_client, use_model):
                return await asyncio.wait_for(
                    use_client.chat.completions.create(
                        model=use_model,
                        messages=messages,
                        tools=TOOLS,
                        tool_choice="auto",
                        temperature=0.3,
                        max_tokens=4096,
                    ),
                    timeout=55.0,
                )

            try:
                response = await _planning_call(client, current_model)
            except Exception as e1:
                if not _is_quota_error(e1):
                    raise
                # Tier 2: OpenAI / OpenRouter fallback
                tier2_ok = False
                if settings.FALLBACK_AI_KEY and current_model != _fallback_model():
                    import logging
                    logging.getLogger("recall-x247").warning("Primary quota hit — falling back to OpenRouter.")
                    client = _make_client(tier="fallback")
                    current_model = _fallback_model()
                    try:
                        response = await _planning_call(client, current_model)
                        tier2_ok = True
                    except Exception as e2:
                        if not _is_quota_error(e2):
                            raise
                # Tier 3: Backup Gemini key
                if not tier2_ok:
                    if not settings.BACKUP_GEMINI_API_KEY:
                        raise
                    import logging
                    logging.getLogger("recall-x247").warning("Fallback exhausted — using BACKUP Gemini key.")
                    client = _make_client(tier="backup_gemini")
                    current_model = _backup_gemini_model()
                    response = await _planning_call(client, current_model)

            msg = response.choices[0].message
            messages.append(msg)
            serialized_assistant = _serialize_assistant_msg(msg)
            turn_messages.append(serialized_assistant)

            if not msg.tool_calls:
                reply = msg.content or ""
                break

            tool_results = []
            for tc in msg.tool_calls:
                tool_name = tc.function.name
                tool_args = json.loads(tc.function.arguments)
                agent_name = TOOL_AGENT_MAP.get(tool_name, "Orchestrator")
                display_name = TOOL_DISPLAY_NAMES.get(tool_name, tool_name)

                step = workflow.add_step(
                    name=display_name,
                    agent=agent_name,
                    tool=tool_name,
                    input_data=tool_args
                )
                step.start()

                try:
                    result = await run_tool(tool_name, tool_args)
                    step.complete(result)
                except Exception as e:
                    step.fail(str(e))
                    result = {"error": str(e)}

                _learn_focus_from_tool(session_id, tool_name, result)
                if tool_name == "capture_knowledge" and isinstance(result, dict) and "error" not in result:
                    capture_succeeded = True

                tr = {
                    "tool_call_id": tc.id,
                    "role": "tool",
                    "content": json.dumps(result, default=str)
                }
                tool_results.append(tr)
                turn_messages.append(tr)

                # Hard-stop the moment a capture lands. Any subsequent
                # tool calls the model batched in this same turn (e.g.
                # capture + create_task) must NOT execute — the user only
                # asked to capture.
                if capture_succeeded:
                    break

            messages.extend(tool_results)

            # Hard stop after a successful capture — don't let the LLM chain
            # into "want me to schedule it / make a task / generate flashcards"
            # on its own. The user came to capture; respect that.
            if capture_succeeded:
                focus = _get_focus(session_id)
                title = (focus or {}).get("title") if focus else None
                reply = f"Saved '{title}' to your Inbox." if title else "Saved to your Inbox."
                turn_messages.append({"role": "assistant", "content": reply})
                break

        if not reply:
            reply = "I've completed the requested actions. Let me know if you need anything else!"
            turn_messages.append({"role": "assistant", "content": reply})

        workflow.complete(reply)

    except Exception as e:
        print(f"Coordinator Error: {e}")
        reply = _friendly_ai_error(str(e))
        workflow.fail(str(e))
        turn_messages.append({"role": "assistant", "content": reply})

    # Persist this turn into session history
    _SESSION_HISTORY.setdefault(_history_key(session_id), []).extend(turn_messages)
    _trim_history(session_id)

    return {
        "reply": reply,
        "agents_called": workflow.agents_called,
        "session_id": session_id,
        "workflow_id": workflow.id
    }


# ─── Streaming Coordinator (SSE) ──────────────────────────────────────────────

async def run_coordinator_stream(message: str, session_id: str) -> AsyncGenerator[str, None]:
    """
    Streaming version of the coordinator.
    Yields SSE-formatted events as each agent step executes.
    """

    def sse(event_type: str, data: dict) -> str:
        return f"data: {json.dumps({'type': event_type, **data})}\n\n"

    if not settings.OPENAI_API_KEY:
        yield sse("error", {"message": "Neural AI not configured. Set GEN_APAC_API_KEY in Secrets."})
        return

    workflow = create_workflow(
        name="Chat Stream",
        description=message[:80],
        user_message=message,
        session_id=session_id
    )

    yield sse("workflow_start", {
        "workflow_id": workflow.id,
        "message": message,
        "timestamp": workflow.created_at
    })

    # ── Pre-LLM intent gate ────────────────────────────────────────────────────
    # If the user clearly wants to recall / list / open another page, redirect
    # there instead of running the planning loop. The dedicated pages handle
    # the search, render proper cards, and preserve focus for follow-ups.
    #
    # Per Apr 30 product update: instead of yanking the user to the page
    # silently, we attach a small `preview` of the top-N items + a friendly
    # `page_label` + `reason`. The frontend renders this as a "Redirecting…"
    # card with a 4-5s soft countdown the user can pre-empt. They get
    # immediate value (top 3-5 items) without us dumping the full list into
    # chat and without surprising them with a page switch.
    nav = _classify_navigate_intent(message)
    if nav:
        path, prefilled = nav
        # Map each canonical nav path to (frontend_path, page_label,
        # short_reason, preview_fetcher). Frontend paths point to the real
        # hub-tab URL the legacy single-page route now lives at — so the
        # client doesn't bounce through a RedirectWithBanner.
        nav_meta = {
            "/recall":   ("/recall",            "Recall",   "I'll search there with your phrase prefilled — Recall renders the full results with proper cards."),
            "/tasks":    ("/focus",             "Focus",    "Showing your top pending tasks — open Focus for the full list, filters and bulk actions."),
            "/calendar": ("/calendar",          "Calendar", "Showing your next few events — open Calendar for the full week and quick scheduling."),
            "/notes":    ("/library?tab=notes", "Library",  "Showing your latest notes — open Library for the full archive, tags and search."),
            "/vault":    ("/library?tab=vault", "Library",  "Showing your latest captures — open Library for tags, smart collections and bulk actions."),
            "/briefing": ("/briefing",          "Daily Briefing", "Pulling together today's briefing — opening the full view."),
        }
        front_path, page_label, reason = nav_meta.get(path, (path, path.lstrip("/").title() or "Page", "Opening the dedicated page for the full view."))

        # Best-effort preview fetch — each branch is wrapped in its own
        # try/except AND a tight `asyncio.wait_for` so a slow Firestore
        # call can never delay the redirect card. Preview is non-essential;
        # the destination page re-fetches on mount and will show the
        # full list either way.
        preview: list[dict] = []
        PREVIEW_TIMEOUT_S = 1.5
        try:
            if path == "/tasks":
                from app.task_agent import list_tasks as _list_tasks
                rows = await asyncio.wait_for(_list_tasks(status="pending", limit=3), timeout=PREVIEW_TIMEOUT_S)
                for r in rows:
                    title = (r.get("text") or r.get("title") or "Untitled task").strip()
                    due = r.get("due_date") or r.get("due") or ""
                    sub = f"due {due}" if due else (r.get("priority") and f"priority: {r['priority']}") or ""
                    preview.append({"id": r.get("id"), "title": title[:90], "subtitle": sub[:60] if sub else None, "icon": "task"})
            elif path == "/calendar":
                from app.calendar_agent import list_upcoming_events as _list_events
                rows = await asyncio.wait_for(_list_events(days=14), timeout=PREVIEW_TIMEOUT_S)
                for r in (rows or [])[:3]:
                    title = (r.get("title") or "Untitled event").strip()
                    when = " ".join(filter(None, [r.get("date"), r.get("time")])).strip()
                    preview.append({"id": r.get("id"), "title": title[:90], "subtitle": when[:60] if when else None, "icon": "event"})
            elif path == "/vault":
                from app.recall_agent import list_memories as _list_mem
                rows = await asyncio.wait_for(_list_mem(limit=3), timeout=PREVIEW_TIMEOUT_S)
                for r in (rows or [])[:3]:
                    title = (r.get("title") or "Untitled").strip()
                    src = (r.get("source_type") or "").upper()
                    domain = r.get("domain") or ""
                    sub = " · ".join([s for s in [src, domain] if s])
                    preview.append({"id": r.get("id"), "title": title[:90], "subtitle": sub[:60] if sub else None, "icon": "memory"})
            elif path == "/notes":
                # Notes don't have a dedicated module helper; skip preview
                # rather than reach into Firestore directly here.
                pass
        except asyncio.TimeoutError:
            # Slow backend — ship the redirect anyway, destination page
            # will load the real data on mount.
            print(f"[coordinator] nav preview fetch timed out for {path} (>{PREVIEW_TIMEOUT_S}s); shipping redirect without preview")
        except Exception as e:  # noqa: BLE001
            print(f"[coordinator] nav preview fetch failed for {path}: {e}")

        # Short header line that goes into the assistant bubble's content.
        # Kept ultra-terse because the NavRedirectCard already shows the
        # full reason + preview + button.
        nav_reply = f"Redirecting to {page_label}…"

        yield sse("navigate", {
            "path": front_path,
            "query": prefilled,
            "page_label": page_label,
            "reason": reason,
            "preview": preview,
            "message": nav_reply,
            "workflow_id": workflow.id,
            "reply": nav_reply,
        })
        # Persist a tiny placeholder turn so chat history reflects the redirect
        # (helps when the user switches back to /agent later).
        _SESSION_HISTORY.setdefault(_history_key(session_id), []).extend([
            {"role": "user", "content": message},
            {"role": "assistant", "content": nav_reply},
        ])
        _trim_history(session_id)
        workflow.complete(nav_reply)
        # NOTE: intentionally NOT yielding workflow_complete here. The
        # `navigate` event already inserts the assistant bubble and clears
        # the streaming/agent state on the client; emitting another
        # workflow_complete with the same `reply` text caused the same
        # message ("Opening today's Briefing…") to render twice in chat.
        return

    client = _make_client()
    current_model = settings.OPENAI_MODEL

    history = _SESSION_HISTORY.get(_history_key(session_id), [])
    new_user_msg = {"role": "user", "content": message}
    messages: List[dict] = [
        {"role": "system", "content": SYSTEM_PROMPT.format(
            today=datetime.date.today().isoformat(),
            focus_block=_focus_block(session_id),
        )},
        *history,
        new_user_msg,
    ]
    # Inject the scratchpad as a SECOND system message (right after the main
    # one) when there's anything in it. We re-inject on each iteration so
    # signals learned mid-turn (e.g. capture's last_memory_id) are visible
    # to the next planning call without us having to mutate the prior
    # assistant/tool messages.
    initial_pad_block = _scratchpad_block(session_id)
    if initial_pad_block:
        messages.insert(1, {"role": "system", "content": initial_pad_block})
    turn_messages: List[dict] = [new_user_msg]
    capture_succeeded = False
    clarification_emitted = False

    def _refresh_scratchpad_msg() -> None:
        """Replace (or insert) the scratchpad system message at index 1
        so the next planning call sees up-to-date hints. We always keep
        the main system prompt at index 0; the scratchpad block, when
        present, lives at index 1. No-op when scratchpad is empty."""
        block = _scratchpad_block(session_id)
        # Identify whether index 1 is the scratchpad sysmsg from before.
        is_pad_at_1 = (
            len(messages) > 1
            and messages[1].get("role") == "system"
            and isinstance(messages[1].get("content"), str)
            and messages[1]["content"].startswith("RECENT AGENT OUTPUTS")
        )
        if block:
            new_msg = {"role": "system", "content": block}
            if is_pad_at_1:
                messages[1] = new_msg
            else:
                messages.insert(1, new_msg)
        elif is_pad_at_1:
            messages.pop(1)

    reply = ""
    try:
        for iteration in range(6):
            yield sse("thinking", {"iteration": iteration})

            # ── Planning call (non-streaming, needs to inspect tool_calls) ──────
            async def _stream_planning_call(use_client, use_model):
                return await asyncio.wait_for(
                    use_client.chat.completions.create(
                        model=use_model,
                        messages=messages,
                        tools=TOOLS,
                        tool_choice="auto",
                        temperature=0.3,
                        max_tokens=4096,
                    ),
                    timeout=55.0,
                )

            try:
                try:
                    response = await _stream_planning_call(client, current_model)
                except Exception as e1:
                    if not _is_quota_error(e1):
                        raise
                    # Tier 2: OpenAI / OpenRouter fallback
                    tier2_ok = False
                    if settings.FALLBACK_AI_KEY and current_model != _fallback_model():
                        import logging
                        logging.getLogger("recall-x247").warning("Primary quota — falling back to OpenRouter.")
                        client = _make_client(tier="fallback")
                        current_model = _fallback_model()
                        try:
                            response = await _stream_planning_call(client, current_model)
                            tier2_ok = True
                        except Exception as e2:
                            if not _is_quota_error(e2):
                                raise
                    # Tier 3: Backup Gemini key
                    if not tier2_ok:
                        if not settings.BACKUP_GEMINI_API_KEY:
                            user_msg = _friendly_ai_error(str(e1))
                            yield sse("error", {"message": user_msg, "workflow_id": workflow.id})
                            workflow.fail(str(e1))
                            return
                        import logging
                        logging.getLogger("recall-x247").warning("Fallback exhausted — using BACKUP Gemini key.")
                        client = _make_client(tier="backup_gemini")
                        current_model = _backup_gemini_model()
                        response = await _stream_planning_call(client, current_model)
            except (asyncio.TimeoutError, APITimeoutError):
                yield sse("error", {
                    "message": "The AI took too long to respond. Please try again.",
                    "workflow_id": workflow.id
                })
                workflow.fail("LLM timeout")
                return
            except APIConnectionError as e:
                yield sse("error", {
                    "message": f"Connection to AI failed: {str(e)}",
                    "workflow_id": workflow.id
                })
                workflow.fail(str(e))
                return

            msg = response.choices[0].message
            messages.append(msg)
            serialized_assistant = _serialize_assistant_msg(msg)
            turn_messages.append(serialized_assistant)

            # ── No tool calls → stream final reply word-by-word ──────────────
            if not msg.tool_calls:
                raw = msg.content or "All done! Let me know if you need anything else."
                # Simulate streaming by yielding one word at a time so the
                # frontend can progressively render instead of waiting for
                # the full payload.  Then do a real stream call for subsequent
                # synthesis steps (when tools were already called).
                if iteration == 0:
                    # Direct answer — no tools used: stream word-by-word from content
                    words = raw.split(" ")
                    for i, word in enumerate(words):
                        chunk = word + (" " if i < len(words) - 1 else "")
                        reply += chunk
                        yield sse("token", {"text": chunk})
                        await asyncio.sleep(0.01)
                else:
                    # Post-tool synthesis: make a streaming call so the user
                    # sees the reply as it generates
                    try:
                        stream = await asyncio.wait_for(
                            client.chat.completions.create(
                                model=settings.OPENAI_MODEL,
                                messages=messages,
                                stream=True,
                                temperature=0.3,
                                max_tokens=4096,
                            ),
                            timeout=55.0
                        )
                        async for chunk in stream:
                            delta = chunk.choices[0].delta.content if chunk.choices else None
                            if delta:
                                reply += delta
                                yield sse("token", {"text": delta})
                    except Exception:
                        if not reply:
                            reply = raw
                            yield sse("token", {"text": raw})
                    # The serialized assistant msg from the planning call had
                    # empty content — replace it with the actual streamed reply
                    # so session history reflects what the user saw.
                    if turn_messages and turn_messages[-1].get("role") == "assistant":
                        turn_messages[-1]["content"] = reply
                break

            # ── Execute tool calls (parallel-aware) ───────────────────────────
            # Group consecutive tool_calls into "batches": a batch is either
            #   (a) one or more PARALLEL-SAFE tools → executed via
            #       asyncio.gather(), so e.g. list_tasks + get_daily_briefing
            #       fan out concurrently and the user waits the max of the
            #       two latencies, not the sum.
            #   (b) exactly one sequential tool (write/mutate/clarification) →
            #       executed alone so write effects land before any later
            #       tool sees them, and so a clarification request can break
            #       the loop cleanly.
            #
            # Batches preserve the LLM's emitted order — we never reorder
            # tools, only group adjacent ones with compatible safety.
            tool_calls_list = list(msg.tool_calls)
            batches: List[List[Any]] = []
            current_batch: List[Any] = []
            current_is_parallel: Optional[bool] = None
            for tc in tool_calls_list:
                is_par = tc.function.name in _PARALLEL_SAFE_TOOLS
                if not current_batch:
                    current_batch = [tc]
                    current_is_parallel = is_par
                elif is_par and current_is_parallel:
                    current_batch.append(tc)
                else:
                    batches.append(current_batch)
                    current_batch = [tc]
                    current_is_parallel = is_par
            if current_batch:
                batches.append(current_batch)

            short_circuit = False  # capture or clarification → stop the planning loop
            for bi, batch in enumerate(batches):
                if short_circuit:
                    break
                is_parallel = len(batch) > 1 and all(
                    t.function.name in _PARALLEL_SAFE_TOOLS for t in batch
                )
                # batch_id ties the agent_start/complete events for one
                # parallel batch together so the UI can render them as a
                # single row instead of a vertical stack. Use the loop
                # index `bi` rather than batches.index(batch) — the latter
                # returns the first equal-valued match and can collide
                # when two batches happen to be identical lists.
                batch_id = f"batch-{workflow.id}-{iteration}-{bi}"

                # Emit agent_start for ALL members of the batch up-front —
                # so the UI shows them as "queued/running" simultaneously.
                start_events: List[dict] = []
                for tc in batch:
                    tool_name = tc.function.name
                    try:
                        tool_args = json.loads(tc.function.arguments or "{}")
                    except Exception:
                        tool_args = {}
                    start_events.append({
                        "agent": TOOL_AGENT_MAP.get(tool_name, "Orchestrator"),
                        "tool": tool_name,
                        "name": TOOL_DISPLAY_NAMES.get(tool_name, tool_name),
                        "input": tool_args,
                        "tool_call_id": tc.id,
                        "batch_id": batch_id,
                        "parallel": is_parallel,
                    })
                if is_parallel:
                    yield sse("parallel_batch_start", {
                        "batch_id": batch_id,
                        "count": len(batch),
                        "agents": [{"agent": e["agent"], "tool": e["tool"], "name": e["name"]} for e in start_events],
                    })

                # Run the batch. For parallel batches we kick off all calls
                # via gather; for sequential batches (size 1) we just await.
                if is_parallel:
                    # Fire agent_start events for all members BEFORE awaiting
                    # gather so the UI sees them as concurrently running.
                    # We DON'T have step IDs yet though — _run_one_tool
                    # creates them. Solution: pre-create the steps here in
                    # the same order so we can emit start events with real
                    # step_ids, then pass the steps in.
                    pending = []
                    for tc, ev in zip(batch, start_events):
                        step = workflow.add_step(
                            name=ev["name"], agent=ev["agent"],
                            tool=ev["tool"], input_data=ev["input"],
                        )
                        step.start()
                        ev["step_id"] = step.id
                        yield sse("agent_start", {**ev})
                        # Wrap each call as a Task so we can use
                        # asyncio.as_completed to yield SSE events the
                        # moment each individual tool finishes — fast
                        # tools shouldn't have to wait for slow ones.
                        async def _do(_tc=tc, _step=step, _ev=ev):
                            try:
                                _r = await asyncio.wait_for(run_tool(_ev["tool"], _ev["input"]), timeout=20.0)
                                _step.complete(_r)
                                return ("ok", _r, _step, _ev, _tc)
                            except asyncio.TimeoutError:
                                _step.fail("Tool timed out")
                                return ("timeout", {"error": "Tool execution timed out"}, _step, _ev, _tc)
                            except Exception as _e:  # noqa: BLE001
                                _step.fail(str(_e))
                                return ("error", {"error": str(_e)}, _step, _ev, _tc)
                        pending.append(asyncio.create_task(_do()))
                    # Drain in completion order — the UI shows each pill
                    # flipping to "done" the instant its tool returns,
                    # not after the slowest peer finishes. We still
                    # serialize the SSE writes because the generator
                    # itself runs single-threaded.
                    results = []
                    for fut in asyncio.as_completed(pending):
                        item = await fut
                        results.append(item)
                        status, result, step, ev, tc = item
                        tool_name = ev["tool"]
                        agent_name = ev["agent"]
                        if status == "ok":
                            entity_meta = _extract_entity_meta(tool_name, result)
                            if entity_meta:
                                step.entity_count = entity_meta["count"]
                                step.entity_noun = entity_meta["noun"]
                                step.entity_verb = entity_meta["verb"]
                            inline_preview = _build_inline_preview(tool_name, result)
                            yield sse("agent_complete", {
                                "step_id": step.id, "agent": agent_name, "tool": tool_name,
                                "name": ev["name"], "batch_id": batch_id,
                                "output_summary": _summarize_output(result),
                                "duration_ms": round(step.duration_ms, 1),
                                "entity_count": step.entity_count,
                                "entity_noun": step.entity_noun,
                                "entity_verb": step.entity_verb,
                                "inline_preview": inline_preview,
                            })
                        else:
                            yield sse("agent_error", {
                                "step_id": step.id, "agent": agent_name,
                                "batch_id": batch_id,
                                "error": result.get("error") if isinstance(result, dict) else str(result),
                            })
                        tr = {
                            "tool_call_id": tc.id, "role": "tool",
                            "content": json.dumps(result, default=str),
                        }
                        messages.append(tr)
                        turn_messages.append(tr)
                        _learn_focus_from_tool(session_id, tool_name, result)
                        _learn_scratchpad_from_tool(session_id, tool_name, result)
                else:
                    # Sequential: single tool. Standard path.
                    tc = batch[0]
                    ev = start_events[0]
                    tool_name = ev["tool"]
                    agent_name = ev["agent"]
                    tool_args = ev["input"]
                    display_name = ev["name"]
                    step = workflow.add_step(
                        name=display_name, agent=agent_name,
                        tool=tool_name, input_data=tool_args,
                    )
                    step.start()
                    ev["step_id"] = step.id
                    yield sse("agent_start", {**ev})
                    try:
                        result = await asyncio.wait_for(run_tool(tool_name, tool_args), timeout=20.0)
                        step.complete(result)
                        # ── Clarification short-circuit ──────────────────
                        if tool_name == "ask_clarification" and isinstance(result, dict) and result.get("kind") == "clarification_request":
                            yield sse("agent_complete", {
                                "step_id": step.id, "agent": agent_name, "tool": tool_name,
                                "name": display_name, "output_summary": "Clarification requested",
                                "duration_ms": round(step.duration_ms, 1),
                            })
                            yield sse("clarification_needed", {
                                "step_id": step.id,
                                "question": result.get("question", ""),
                                "options": result.get("options", []),
                                "reason": result.get("reason", ""),
                                "workflow_id": workflow.id,
                            })
                            # Persist a placeholder assistant turn so the
                            # chat history reflects the question.
                            q = result.get("question", "")
                            ph = f"Just to confirm — {q}" if q else "Just to confirm — could you give me a bit more detail?"
                            turn_messages.append({"role": "assistant", "content": ph})
                            reply = ph
                            clarification_emitted = True
                            short_circuit = True
                            # Still record the tool reply so the LLM
                            # session history stays consistent.
                            tr = {
                                "tool_call_id": tc.id, "role": "tool",
                                "content": json.dumps(result, default=str),
                            }
                            messages.append(tr)
                            turn_messages.append(tr)
                            break
                        entity_meta = _extract_entity_meta(tool_name, result)
                        if entity_meta:
                            step.entity_count = entity_meta["count"]
                            step.entity_noun = entity_meta["noun"]
                            step.entity_verb = entity_meta["verb"]
                        inline_preview = _build_inline_preview(tool_name, result)
                        yield sse("agent_complete", {
                            "step_id": step.id, "agent": agent_name, "tool": tool_name,
                            "name": display_name,
                            "output_summary": _summarize_output(result),
                            "duration_ms": round(step.duration_ms, 1),
                            "entity_count": step.entity_count,
                            "entity_noun": step.entity_noun,
                            "entity_verb": step.entity_verb,
                            "inline_preview": inline_preview,
                        })
                    except asyncio.TimeoutError:
                        step.fail("Tool timed out")
                        result = {"error": "Tool execution timed out"}
                        yield sse("agent_error", {
                            "step_id": step.id, "agent": agent_name,
                            "error": "Tool execution timed out",
                        })
                    except Exception as e:  # noqa: BLE001
                        step.fail(str(e))
                        result = {"error": str(e)}
                        yield sse("agent_error", {
                            "step_id": step.id, "agent": agent_name, "error": str(e),
                        })

                    tr = {
                        "tool_call_id": tc.id, "role": "tool",
                        "content": json.dumps(result, default=str),
                    }
                    messages.append(tr)
                    turn_messages.append(tr)
                    _learn_focus_from_tool(session_id, tool_name, result)
                    _learn_scratchpad_from_tool(session_id, tool_name, result)
                    if tool_name == "capture_knowledge" and isinstance(result, dict) and "error" not in result:
                        capture_succeeded = True
                        short_circuit = True
                        break

            # Refresh the scratchpad system message between iterations so
            # the next planning call sees the IDs/titles we just learned.
            _refresh_scratchpad_msg()

            # Clarification short-circuit ends the whole turn here.
            if clarification_emitted:
                break
            # Hard stop after a successful capture (see non-streaming branch).
            if capture_succeeded:
                focus = _get_focus(session_id)
                title = (focus or {}).get("title") if focus else None
                stop_reply = f"Saved '{title}' to your Inbox." if title else "Saved to your Inbox."
                if not reply:
                    reply = stop_reply
                    yield sse("token", {"text": stop_reply})
                    turn_messages.append({"role": "assistant", "content": reply})
                break

        if not reply:
            reply = "All tasks completed successfully! Let me know if you need anything else."
            turn_messages.append({"role": "assistant", "content": reply})

        workflow.complete(reply)

        # Persist this turn into session history
        _SESSION_HISTORY.setdefault(_history_key(session_id), []).extend(turn_messages)
        _trim_history(session_id)

        # On clarification turns, the `clarification_needed` event has
        # already replaced the in-flight bubble with an interactive card
        # AND cleared agent statuses on the frontend. Emitting a normal
        # `workflow_complete` here would render a duplicate text bubble
        # below the card with the same placeholder ("Just to confirm…")
        # — confusing UX. Instead emit a lightweight terminator the
        # frontend can use to release the SSE stream without writing
        # any new message.
        if clarification_emitted:
            yield sse("workflow_clarification_pending", {
                "workflow_id": workflow.id,
                "agents_called": workflow.agents_called,
                "steps": [s.to_dict() for s in workflow.steps],
                "timestamp": workflow.completed_at,
            })
        else:
            yield sse("workflow_complete", {
                "workflow_id": workflow.id,
                "reply": reply,
                "agents_called": workflow.agents_called,
                "steps": [s.to_dict() for s in workflow.steps],
                "timestamp": workflow.completed_at
            })

    except Exception as e:
        print(f"Coordinator Stream Error: {e}")
        workflow.fail(str(e))
        yield sse("error", {"message": _friendly_ai_error(str(e)), "workflow_id": workflow.id})


def _summarize_output(result: Any) -> str:
    """Create a short human-readable summary of a tool result."""
    if isinstance(result, dict):
        if "error" in result:
            return f"Error: {result['error']}"
        if "title" in result:
            return f"'{result['title']}'"
        if "answer" in result:
            return result["answer"][:120] + "..." if len(result.get("answer", "")) > 120 else result.get("answer", "")
        if "reply" in result:
            return result["reply"][:120]
        keys = list(result.keys())
        return f"Returned {len(keys)} fields: {', '.join(keys[:4])}"
    if isinstance(result, list):
        return f"{len(result)} items returned"
    return str(result)[:100]


# ─── Entity audit metadata for the assistant's "done" chip ────────────────────
# Maps each tool to (verb, singular noun, plural noun, kind). The frontend joins
# these into phrases like "checked 3 memories, created 1 task". Tools without a
# meaningful entity count (e.g. stats lookups) are absent and produce no chip
# phrase — the chip falls back to the friendly agent path.
#
# kind:
#   "single" — tool always produces exactly one entity on success (creates).
#   "list"   — tool produces N entities; count is read from the actual result.
_TOOL_ENTITY_LABELS: Dict[str, tuple] = {
    "capture_knowledge":   ("saved",     "memory",     "memories",    "single"),
    "recall_knowledge":    ("checked",   "memory",     "memories",    "list"),
    "list_memories":       ("listed",    "memory",     "memories",    "list"),
    "create_task":         ("created",   "task",       "tasks",       "single"),
    "list_tasks":          ("listed",    "task",       "tasks",       "list"),
    "schedule_event":      ("scheduled", "event",      "events",      "single"),
    "list_schedule":       ("checked",   "event",      "events",      "list"),
    "get_daily_briefing":  ("prepared",  "briefing",   "briefings",   "single"),
    "generate_study_plan": ("drafted",   "study plan", "study plans", "single"),
}

# Known list keys to inspect on dict-shaped list-tool results, in priority order.
# `recall_knowledge` returns {answer, sources, count, follow_ups, ...} so
# "sources" must come before generic fallbacks. We never invent a count for
# list-tools whose result shape doesn't match any of these — the chip falls
# back to the friendly agent path instead.
_LIST_KEYS = ("memories", "sources", "tasks", "events", "items", "results")


_INLINE_PREVIEW_TOOLS = {
    "list_schedule":    "event",
    "list_tasks":       "task",
    "list_memories":    "memory",
    "recall_knowledge": "memory",
}


def _build_inline_preview(tool_name: str, result: Any) -> Optional[List[Dict[str, Any]]]:
    """Return up to 3 inline preview rows for list-type tools so the chat
    can render real items alongside the entity-count chip. Mirrors the
    shape of NavPreviewItem on the frontend ({title, subtitle, icon, id}).

    Best-effort: returns None on any unrecognised shape rather than
    invent rows. Never raises — this runs in the hot SSE loop.
    """
    icon = _INLINE_PREVIEW_TOOLS.get(tool_name)
    if not icon:
        return None
    if isinstance(result, dict) and "error" in result:
        return None

    rows: List[Any] = []
    try:
        if isinstance(result, list):
            rows = result
        elif isinstance(result, dict):
            for key in _LIST_KEYS:
                val = result.get(key)
                if isinstance(val, list):
                    rows = val
                    break
    except Exception:  # noqa: BLE001
        return None

    out: List[Dict[str, Any]] = []
    for r in rows[:3]:
        if not isinstance(r, dict):
            continue
        title = (r.get("title") or r.get("text") or r.get("name") or "Untitled").strip()
        subtitle: Optional[str] = None
        if tool_name == "list_schedule":
            when = " ".join(filter(None, [r.get("date"), r.get("time")])).strip()
            subtitle = when or None
        elif tool_name == "list_tasks":
            due = r.get("due_date") or r.get("due") or ""
            subtitle = f"due {due}" if due else (r.get("priority") and f"priority: {r['priority']}") or None
        elif tool_name in ("list_memories", "recall_knowledge"):
            src = (r.get("source_type") or "").upper()
            domain = r.get("domain") or ""
            joined = " · ".join([s for s in [src, domain] if s])
            subtitle = joined or None
        out.append({
            "id": r.get("id"),
            "title": title[:90],
            "subtitle": (subtitle or "")[:60] or None,
            "icon": icon,
        })
    return out or None


def _extract_entity_meta(tool_name: str, result: Any) -> Optional[Dict[str, Any]]:
    """Return {count, noun, verb} for a tool result, or None if no count fits.

    Counts come from the actual result shape — never fabricated:
      * single-tool dict (no error) → exactly 1
      * list-tool list result → len(list)
      * list-tool dict result → length of a known list key, or an explicit
        integer "count" field, otherwise None (so UI falls back gracefully)
      * any dict with "error" → None (failed steps don't contribute counts)
    """
    labels = _TOOL_ENTITY_LABELS.get(tool_name)
    if not labels:
        return None
    if isinstance(result, dict) and "error" in result:
        return None

    verb, singular, plural, kind = labels
    count: Optional[int] = None

    if kind == "single":
        # Creates always produce one entity on success. Allow either a dict or
        # any non-error truthy result; fall back to None if the tool returned
        # something falsy (defensive — shouldn't happen in practice).
        if result:
            count = 1
    else:  # kind == "list"
        if isinstance(result, list):
            count = len(result)
        elif isinstance(result, dict):
            for key in _LIST_KEYS:
                val = result.get(key)
                if isinstance(val, list):
                    count = len(val)
                    break
            # Some recall paths emit an explicit integer "count" alongside the
            # list — if we somehow didn't see a list (e.g. it was elided), use
            # that as the source of truth before giving up.
            if count is None:
                explicit = result.get("count")
                if isinstance(explicit, int) and explicit >= 0:
                    count = explicit

    if count is None or count < 0:
        return None

    return {
        "count": count,
        "noun": singular if count == 1 else plural,
        "verb": verb,
    }
