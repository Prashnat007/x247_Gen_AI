"""Gemini Live API relay.

Bridges a browser WebSocket to the Gemini Live API so users can have
real-time, multimodal (voice + camera + screen + text) conversations with
their Second Brain. The browser never sees the API key — every frame is
proxied through this relay.

Key responsibilities:
  - Open the upstream WebSocket to Google with the secret key.
  - Inject our system instruction + tool schema (so the Live model can
    invoke any of our agents: capture, recall, tasks, calendar, revisits,
    notes, bookmarks, habits, workspace) at the start of the session.
  - Pipe audio/video/text frames bidirectionally with low overhead.
  - When Gemini emits `toolCall`, run the matching local function with the
    current per-request user context (so Live respects per-user scoping)
    and stream the result back via `toolResponse`.

The Live model name is configurable via env (`GEMINI_LIVE_MODEL`); the
default is the current public Live preview model. A clear error is sent to
the browser if `GEMINI_LIVE_API_KEY` is missing.
"""
from __future__ import annotations

import os
import json
import base64
import asyncio
import logging
from typing import Any, Awaitable, Callable, Dict, Optional

try:
    import websockets
    from websockets.exceptions import ConnectionClosed
except Exception:  # pragma: no cover
    websockets = None
    ConnectionClosed = Exception

from fastapi import WebSocket, WebSocketDisconnect

from app.user_context import current_user_id_var, GUEST_UID

def set_uid(uid: str) -> None:
    """Stamp the current asyncio context with the user id so per-user data
    scoping works inside Live tool calls."""
    current_user_id_var.set(uid or GUEST_UID)

logger = logging.getLogger("recall-x247.live")

# ─── Upstream config ─────────────────────────────────────────────────────────
GEMINI_LIVE_API_KEY = os.getenv("GEMINI_LIVE_API_KEY", "")
# Preview models that support the Live API (bidiGenerateContent).
# `gemini-live-2.5-flash-preview` is the currently recommended public model.
GEMINI_LIVE_MODEL = os.getenv("GEMINI_LIVE_MODEL", "gemini-2.5-flash-native-audio-latest")
GEMINI_LIVE_WS_URL = (
    "wss://generativelanguage.googleapis.com/ws/"
    "google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent"
)

SYSTEM_INSTRUCTION = (
    "You are Recall X247, the user's AI Second Brain. The user is talking "
    "to you live (voice, optionally camera or screen). You have full access "
    "to their personal knowledge: memories, notes, bookmarks, tasks, "
    "calendar events, revisit reminders, habits, and workspace projects.\n\n"
    "RESPONSE STYLE — STRICT:\n"
    "1. Reply with ONLY the final spoken answer. Never narrate your thinking, "
    "planning, or process. Do NOT say things like 'Crafting initial response', "
    "'Let me think', 'Drafting reply', 'Considering', 'Analysing', 'I will now', "
    "'I have registered', or any meta-commentary about formulating an answer. "
    "If you catch yourself starting one of those, stop and just give the answer.\n"
    "2. Do not use markdown bold (**word**), headers (#), or stage directions "
    "in brackets — this is voice, those don't read well.\n"
    "3. Be concise. One or two short sentences for greetings, three to five for "
    "real questions. Never pad.\n"
    "4. Speak in the same language the user uses (English, Hindi, Hinglish, "
    "etc.) — match their tone and casualness.\n\n"
    "TOOLS:\n"
    "When the user asks to remember, save, schedule, plan, or recall anything, "
    "USE THE PROVIDED TOOLS instead of just acknowledging — that is the whole "
    "point. After any tool runs, briefly confirm what you did in one short "
    "sentence. If the user shows you something on camera or screen, describe "
    "what you see and offer to capture or summarise it."
)


# ─── Tool schema exposed to Gemini Live ──────────────────────────────────────
# Keep the surface focused — too many tools dilutes selection accuracy.
LIVE_TOOLS_SCHEMA = [
    {
        "functionDeclarations": [
            {
                "name": "save_memory",
                "description": (
                    "Save a piece of text/insight/idea to the user's vault as a "
                    "memory. Use whenever the user says 'remember this', "
                    "'save this', 'note this down', 'add to my brain'."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "title": {"type": "string", "description": "Short title"},
                        "content": {"type": "string", "description": "Full text"},
                        "tags": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "Optional tags",
                        },
                    },
                    "required": ["content"],
                },
            },
            {
                "name": "capture_url",
                "description": (
                    "Capture a URL (article, YouTube, PDF link). Extracts and "
                    "saves the content as a memory with AI-generated summary."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "url": {"type": "string"},
                        "note": {"type": "string", "description": "Optional user note"},
                    },
                    "required": ["url"],
                },
            },
            {
                "name": "create_task",
                "description": "Create a to-do task.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "title": {"type": "string"},
                        "due_date": {
                            "type": "string",
                            "description": "ISO date YYYY-MM-DD, optional",
                        },
                        "priority": {
                            "type": "string",
                            "enum": ["low", "medium", "high"],
                        },
                    },
                    "required": ["title"],
                },
            },
            {
                "name": "list_tasks",
                "description": "List the user's pending tasks.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "limit": {"type": "integer", "description": "Default 10"}
                    },
                },
            },
            {
                "name": "complete_task",
                "description": "Mark a task as complete by id.",
                "parameters": {
                    "type": "object",
                    "properties": {"task_id": {"type": "string"}},
                    "required": ["task_id"],
                },
            },
            {
                "name": "create_calendar_event",
                "description": "Schedule an event on the user's calendar.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "title": {"type": "string"},
                        "start_time": {
                            "type": "string",
                            "description": "ISO datetime, e.g. 2026-05-01T14:30:00",
                        },
                        "duration_minutes": {"type": "integer"},
                        "description": {"type": "string"},
                    },
                    "required": ["title", "start_time"],
                },
            },
            {
                "name": "create_revisit",
                "description": (
                    "Create a spaced-repetition revisit reminder for a topic the "
                    "user wants to remember long-term."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "topic": {"type": "string"},
                        "frequency": {
                            "type": "string",
                            "description": "daily|weekly|monthly|spaced",
                        },
                    },
                    "required": ["topic"],
                },
            },
            {
                "name": "recall_memories",
                "description": (
                    "Semantic search the user's vault and return matching "
                    "memories. Use whenever the user asks 'do I have notes on…', "
                    "'what did I save about…', 'find my…'."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {"type": "string"},
                        "limit": {"type": "integer", "description": "Default 5"},
                    },
                    "required": ["query"],
                },
            },
            {
                "name": "create_note",
                "description": "Quick note (lighter than a memory).",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "title": {"type": "string"},
                        "body": {"type": "string"},
                    },
                    "required": ["body"],
                },
            },
            {
                "name": "create_bookmark",
                "description": "Save a bookmark URL with an optional title.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "url": {"type": "string"},
                        "title": {"type": "string"},
                    },
                    "required": ["url"],
                },
            },
            {
                "name": "daily_briefing",
                "description": (
                    "Get the user's daily AI briefing — what's pending today, "
                    "what to revisit, key insights from recent captures."
                ),
                "parameters": {"type": "object", "properties": {}},
            },
        ]
    }
]


# ─── Tool dispatch ────────────────────────────────────────────────────────────
async def _dispatch_tool(name: str, args: Dict[str, Any]) -> Dict[str, Any]:
    """Run a Live tool call against our existing agents. Imports are lazy so
    we don't drag heavy deps into module import time, and so a missing agent
    doesn't break the whole Live session."""
    try:
        if name == "save_memory":
            from app.capture_agent import save_memory
            res = await save_memory({
                "content": args.get("content", ""),
                "title": args.get("title") or "Voice note",
                "tags": args.get("tags") or [],
                "source_type": "voice",
            })
            return {"ok": True, "memory_id": (res or {}).get("id"),
                    "title": (res or {}).get("title")}

        if name == "capture_url":
            from app.capture_agent import capture
            url = args.get("url", "")
            stype = "youtube" if ("youtube.com" in url or "youtu.be" in url) else "web"
            res = await capture(source_type=stype, url=url)
            return {"ok": True, "summary": (res or {}).get("summary"),
                    "memory_id": (res or {}).get("memory_id") or (res or {}).get("id")}

        if name == "create_task":
            from app.task_agent import create_task
            res = await create_task(
                title=args.get("title", ""),
                due_date=args.get("due_date") or "",
                priority=args.get("priority") or "medium",
            )
            return {"ok": True, "task_id": (res or {}).get("id"),
                    "title": (res or {}).get("title")}

        if name == "list_tasks":
            from app.task_agent import list_tasks
            limit = int(args.get("limit") or 10)
            tasks = await list_tasks()
            tasks = (tasks or [])[:limit]
            return {
                "tasks": [
                    {"id": t.get("id"), "title": t.get("title"),
                     "status": t.get("status"), "due_date": t.get("due_date")}
                    for t in tasks
                ]
            }

        if name == "complete_task":
            from app.task_agent import complete_task
            await complete_task(args.get("task_id", ""))
            return {"ok": True}

        if name == "create_calendar_event":
            from app.calendar_agent import create_event
            iso = args.get("start_time", "")
            date_part, _, time_part = iso.partition("T")
            time_part = (time_part or "09:00")[:5]
            res = await create_event(
                title=args.get("title", ""),
                date=date_part,
                time=time_part,
                duration_minutes=int(args.get("duration_minutes") or 30),
                description=args.get("description") or "",
            )
            return {"ok": True, "event_id": (res or {}).get("id")}

        if name == "create_revisit":
            from app.revisit_agent import create_revisit
            res = await create_revisit(
                topic=args.get("topic", ""),
                frequency=args.get("frequency") or "weekly",
            )
            return {"ok": True, "revisit_id": (res or {}).get("id")}

        if name == "recall_memories":
            from app.recall_agent import recall
            limit = int(args.get("limit") or 5)
            res = await recall(query=args.get("query", ""))
            # recall() returns {answer, sources, count}; sources is the list.
            if isinstance(res, list):
                hits = res
                answer = ""
            else:
                hits = (res or {}).get("sources") or (res or {}).get("results") or []
                answer = (res or {}).get("answer") or ""
            return {
                "answer": answer,
                "results": [
                    {"id": m.get("id"), "title": m.get("title"),
                     "snippet": (m.get("content") or m.get("summary") or m.get("snippet") or "")[:240]}
                    for m in hits[:limit]
                ],
            }

        if name == "create_note":
            from app.extras_agent import create_note
            res = await create_note(
                title=args.get("title") or "Voice note",
                content=args.get("body", ""),
                tags=[],
            )
            return {"ok": True, "note_id": (res or {}).get("id")}

        if name == "create_bookmark":
            from app.extras_agent import create_bookmark
            res = await create_bookmark(
                url=args.get("url", ""),
                title=args.get("title") or args.get("url", ""),
            )
            return {"ok": True, "bookmark_id": (res or {}).get("id")}

        if name == "daily_briefing":
            from app.capture_agent import generate_daily_briefing
            res = await generate_daily_briefing()
            return {"briefing": (res or {}).get("briefing") or str(res)[:1200]}

        return {"error": f"unknown tool: {name}"}

    except Exception as e:
        logger.exception("Live tool '%s' failed", name)
        return {"error": str(e)}


# ─── Setup payload ───────────────────────────────────────────────────────────
def _build_setup_message(voice_name: str = "Aoede") -> Dict[str, Any]:
    """Initial `setup` frame the Gemini Live API requires before any audio.
    The v1beta JSON dialect uses camelCase keys."""
    return {
        "setup": {
            "model": f"models/{GEMINI_LIVE_MODEL}",
            "generationConfig": {
                "responseModalities": ["AUDIO"],
                "speechConfig": {
                    "voiceConfig": {
                        "prebuiltVoiceConfig": {"voiceName": voice_name}
                    }
                },
            },
            "systemInstruction": {
                "parts": [{"text": SYSTEM_INSTRUCTION}]
            },
            "tools": LIVE_TOOLS_SCHEMA,
            "outputAudioTranscription": {},
            "inputAudioTranscription": {},
        }
    }


# ─── Relay ───────────────────────────────────────────────────────────────────
async def relay_live_session(client_ws: WebSocket, user_id: str) -> None:
    """Bidirectional relay between browser and Gemini Live."""
    if not GEMINI_LIVE_API_KEY:
        await client_ws.send_json({
            "type": "error",
            "error": "GEMINI_LIVE_API_KEY not configured on server.",
        })
        await client_ws.close(code=1011)
        return
    if websockets is None:
        await client_ws.send_json({
            "type": "error",
            "error": "Server is missing the 'websockets' Python package.",
        })
        await client_ws.close(code=1011)
        return

    set_uid(user_id or GUEST_UID)
    upstream_url = f"{GEMINI_LIVE_WS_URL}?key={GEMINI_LIVE_API_KEY}"
    logger.info(f"Live: opening upstream for uid={user_id} model={GEMINI_LIVE_MODEL}")

    try:
        upstream = await websockets.connect(
            upstream_url,
            max_size=10 * 1024 * 1024,
            ping_interval=20,
            ping_timeout=20,
        )
    except Exception as e:
        logger.exception(f"Live: upstream connect FAILED ({type(e).__name__})")
        try:
            await client_ws.send_json({
                "type": "error",
                "error": "Could not connect to live model. Please try again.",
            })
            await client_ws.close(code=1011)
        except Exception:
            pass
        return

    try:
        async with upstream:
            # 1) Send setup, then wait for setupComplete before doing anything else.
            setup_msg = _build_setup_message()
            await upstream.send(json.dumps(setup_msg))
            try:
                first = await asyncio.wait_for(upstream.recv(), timeout=15)
                first_text = first.decode("utf-8") if isinstance(first, (bytes, bytearray)) else first
                first_json = json.loads(first_text) if first_text else {}
                logger.info(f"Live: upstream first frame keys={list(first_json.keys())[:6]}")
                if first_json.get("setupComplete") is None and first_json.get("setup_complete") is None:
                    logger.warning(f"Live: unexpected first frame: {str(first)[:400]}")
            except asyncio.TimeoutError:
                logger.error("Live: upstream did not send setupComplete within 15s")
                await client_ws.send_json({
                    "type": "error",
                    "error": "Gemini Live did not respond to setup. Check API key / model.",
                })
                await client_ws.close(code=1011)
                return
            except ConnectionClosed as e:
                logger.error(f"Live: upstream closed during setup: code={getattr(e,'code',None)} reason={getattr(e,'reason',None)}")
                await client_ws.send_json({
                    "type": "error",
                    "error": f"Gemini closed during setup: {getattr(e,'code','?')} {getattr(e,'reason','')}",
                })
                await client_ws.close(code=1011)
                return

            await client_ws.send_json({
                "type": "ready",
                "model": GEMINI_LIVE_MODEL,
                "user_id": user_id,
            })
            await client_ws.send_json({"type": "setup_complete"})

            async def browser_to_upstream() -> None:
                """Browser → Gemini. Re-stamps user context on every frame
                because async tasks don't share ContextVars otherwise."""
                try:
                    while True:
                        msg = await client_ws.receive()
                        if msg.get("type") == "websocket.disconnect":
                            break
                        if "bytes" in msg and msg["bytes"] is not None:
                            # Treat raw binary as a PCM audio chunk: wrap in the
                            # realtimeInput format Gemini expects.
                            payload = {
                                "realtimeInput": {
                                    "mediaChunks": [{
                                        "mimeType": "audio/pcm;rate=16000",
                                        "data": base64.b64encode(msg["bytes"]).decode(),
                                    }]
                                }
                            }
                            await upstream.send(json.dumps(payload))
                            continue
                        text = msg.get("text")
                        if not text:
                            continue
                        try:
                            obj = json.loads(text)
                        except Exception:
                            continue
                        kind = obj.get("type")
                        if kind == "text":
                            # User typed text in the Live panel
                            await upstream.send(json.dumps({
                                "clientContent": {
                                    "turns": [{
                                        "role": "user",
                                        "parts": [{"text": obj.get("text", "")}],
                                    }],
                                    "turnComplete": True,
                                }
                            }))
                        elif kind == "audio":
                            data_b64 = obj.get("data")
                            if data_b64:
                                await upstream.send(json.dumps({
                                    "realtimeInput": {
                                        "mediaChunks": [{
                                            "mimeType": "audio/pcm;rate=16000",
                                            "data": data_b64,
                                        }]
                                    }
                                }))
                        elif kind == "image":
                            # Camera/screen frame as base64 jpeg/png
                            mime = obj.get("mime_type", "image/jpeg")
                            data_b64 = obj.get("data")
                            if data_b64:
                                await upstream.send(json.dumps({
                                    "realtimeInput": {
                                        "mediaChunks": [{
                                            "mimeType": mime, "data": data_b64,
                                        }]
                                    }
                                }))
                        elif kind == "tool_response":
                            # Forwarded tool result if the browser ever needs to
                            # answer a tool call directly (we normally answer
                            # server-side via _dispatch_tool).
                            await upstream.send(json.dumps(obj.get("payload", {})))
                        elif kind == "interrupt":
                            # Cancel current model turn (barge-in)
                            await upstream.send(json.dumps({
                                "clientContent": {
                                    "turns": [], "turnComplete": True,
                                }
                            }))
                except WebSocketDisconnect:
                    pass
                except Exception as e:
                    logger.warning(f"Live: browser->upstream ended: {e}")
                finally:
                    try:
                        await upstream.close()
                    except Exception:
                        pass

            async def upstream_to_browser() -> None:
                """Gemini → Browser. Handles tool calls by dispatching locally
                and sending tool responses back upstream."""
                try:
                    async for raw in upstream:
                        # Gemini Live returns JSON inside binary WS frames in some
                        # versions of the websockets library — decode either form.
                        text: Optional[str] = None
                        if isinstance(raw, (bytes, bytearray)):
                            try:
                                text = raw.decode("utf-8")
                            except Exception:
                                await client_ws.send_bytes(bytes(raw))
                                continue
                        else:
                            text = raw
                        try:
                            data = json.loads(text) if text else {}
                        except Exception:
                            continue

                        # Tool call from Gemini → run locally, send response.
                        tool_call = data.get("toolCall") or data.get("tool_call")
                        if tool_call:
                            fcs = tool_call.get("functionCalls") or tool_call.get("function_calls") or []
                            logger.info(f"Live: tool_call uid={user_id} fns={[f.get('name') for f in fcs]}")
                            await client_ws.send_json({
                                "type": "tool_call_started",
                                "calls": fcs,
                            })
                            responses = []
                            for fc in tool_call.get("functionCalls", []) or []:
                                fc_id = fc.get("id")
                                fname = fc.get("name", "")
                                fargs = fc.get("args") or {}
                                # Re-stamp user context inside the dispatch task
                                set_uid(user_id or GUEST_UID)
                                result = await _dispatch_tool(fname, fargs)
                                responses.append({
                                    "id": fc_id,
                                    "name": fname,
                                    "response": {"result": result},
                                })
                                await client_ws.send_json({
                                    "type": "tool_call_done",
                                    "name": fname,
                                    "args": fargs,
                                    "result": result,
                                })
                            await upstream.send(json.dumps({
                                "toolResponse": {"functionResponses": responses}
                            }))
                            continue

                        # Server-content (audio out, partial text, transcripts)
                        sc = data.get("serverContent") or data.get("server_content")
                        if sc:
                            mt = sc.get("modelTurn") or sc.get("model_turn") or {}
                            for part in mt.get("parts", []) or []:
                                inline = part.get("inlineData") or part.get("inline_data")
                                if inline and inline.get("data"):
                                    await client_ws.send_json({
                                        "type": "audio",
                                        "mime_type": inline.get("mimeType")
                                                     or inline.get("mime_type")
                                                     or "audio/pcm;rate=24000",
                                        "data": inline["data"],
                                    })
                                if part.get("text"):
                                    await client_ws.send_json({
                                        "type": "text",
                                        "text": part["text"],
                                    })
                            it = sc.get("inputTranscription") or sc.get("input_transcription")
                            if it and it.get("text"):
                                await client_ws.send_json({
                                    "type": "user_transcript",
                                    "text": it["text"],
                                })
                            ot = sc.get("outputTranscription") or sc.get("output_transcription")
                            if ot and ot.get("text"):
                                await client_ws.send_json({
                                    "type": "model_transcript",
                                    "text": ot["text"],
                                })
                            if sc.get("turnComplete") or sc.get("turn_complete"):
                                await client_ws.send_json({"type": "turn_complete"})
                            if sc.get("interrupted"):
                                await client_ws.send_json({"type": "interrupted"})
                            continue

                        # Setup ack or anything else — pass meta upstream.
                        if data.get("setupComplete") or data.get("setup_complete"):
                            await client_ws.send_json({"type": "setup_complete"})
                            continue

                        # Unknown frame — forward as raw debug.
                        await client_ws.send_json({"type": "raw", "payload": data})
                except ConnectionClosed:
                    pass
                except Exception as e:
                    logger.warning(f"Live: upstream->browser ended: {e}")
                finally:
                    try:
                        await client_ws.close()
                    except Exception:
                        pass

            await asyncio.gather(
                browser_to_upstream(),
                upstream_to_browser(),
            )
    except Exception as e:
        logger.exception("Live: relay failed")
        try:
            await client_ws.send_json({
                "type": "error",
                "error": f"Live relay failed: {e}",
            })
        except Exception:
            pass
        try:
            await client_ws.close()
        except Exception:
            pass


def is_live_configured() -> bool:
    return bool(GEMINI_LIVE_API_KEY)
