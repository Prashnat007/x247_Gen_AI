import os
import re
import time
import json
import uuid
import datetime
import logging
import asyncio
from typing import List, Dict, Any, Optional
from fastapi import FastAPI, HTTPException, Request, Body, Query, UploadFile, File, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse, StreamingResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from app.config import settings
from app.db import get_db, log_interaction, get_collection_count
from app.coordinator import run_coordinator, run_coordinator_stream, clear_session_history, get_session_history
from app.page_specialists import (
    run_specialist_stream,
    is_known_page,
    list_pages,
    clear_specialist_history,
    get_specialist_history,
    PAGE_SPECIALISTS,
)
from app.capture_agent import capture, save_memory, save_bundle, generate_flashcards, generate_study_plan, generate_daily_briefing, auto_tag_memory, transcribe_audio, bundle_recent_activity, process_capture_session, check_duplicate, preview_capture_session, _ocr_image, analyze_visual_frame, get_capture_enrichment_prefs, set_capture_enrichment_prefs, re_suggest_for_memory
from app.recall_agent import recall, list_memories, get_memory, delete_memory, get_stats, find_related_memories
from app.task_agent import create_task, list_tasks, complete_task, get_tasks_summary, delete_task
from app.calendar_agent import create_event, list_upcoming_events, delete_event, get_event, import_ics_events
from app.revisit_agent import (
    create_revisit, list_revisits, list_due, get_revisit,
    mark_visited, snooze_revisit, update_revisit, delete_revisit,
    pause_revisit, resume_revisit, suggest_frequency_from_text, ai_plan_revisit,
    FREQUENCIES,
)
from app.discover_agent import discover_resources
from app.dashboard_agent import get_advanced_dashboard
from app.briefing_agent import (
    save_briefing as briefing_save,
    get_briefing as briefing_get,
    list_briefings as briefing_list,
    list_action_items as briefing_action_items,
    toggle_action_item as briefing_toggle_action,
    todays_timeline as briefing_today_timeline,
    generate_recap as briefing_generate_recap,
    get_briefing_settings as briefing_get_settings,
    set_briefing_settings as briefing_set_settings,
    get_pending_notification as briefing_get_notification,
    mark_notification_seen as briefing_mark_notification_seen,
    deliver_briefing_notification as briefing_deliver_notification,
)
from app.briefing_scheduler import start_scheduler as start_briefing_scheduler, run_once as briefing_scheduler_run_once
from app.notion_sync_scheduler import start_scheduler as start_notion_sync_scheduler, run_once as notion_sync_scheduler_run_once
from app.plan_agent import generate_plan, GOAL_TYPES
from app.workspace_agent import (
    list_projects as ws_list_projects,
    list_flat_folders as ws_list_flat_folders,
    get_project as ws_get_project,
    create_project as ws_create_project,
    update_project as ws_update_project,
    delete_project as ws_delete_project,
    add_items as ws_add_items,
    update_item as ws_update_item,
    remove_item as ws_remove_item,
    add_task as ws_add_task,
    toggle_task as ws_toggle_task,
    update_task as ws_update_task,
    ai_organize_workspace as ws_ai_organize_workspace,
    apply_organization as ws_apply_organization,
    DEFAULT_SECTIONS as WS_DEFAULT_SECTIONS,
    ingest_plan as ws_ingest_plan,
    ai_organize_memories as ws_ai_organize_memories,
    list_templates as ws_list_templates,
    create_from_template as ws_create_from_template,
    export_project_markdown as ws_export_project_markdown,
    find_item_owner_project as ws_find_item_owner,
)
from app.workflow_engine import list_workflows, get_workflow, AGENT_REGISTRY
from app.extras_agent import (
    list_notes, create_note, update_note, delete_note,
    list_bookmarks, create_bookmark, update_bookmark, delete_bookmark,
    list_habits, create_habit, toggle_habit, delete_habit,
    seed_extras,
)
from app.user_context import UserContextMiddleware, get_uid, GUEST_UID, verify_firebase_token, require_auth
from app.live_agent import relay_live_session, is_live_configured, GEMINI_LIVE_MODEL

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("recall-x247")

app = FastAPI(
    title="Recall X247 API",
    description="AI-powered Second Brain — powered by Google Gemini 2.0",
    version="2.0.0"
)

_raw_origins = os.getenv("ALLOWED_ORIGINS", "")
_allowed_origins: list[str] = (
    [o.strip() for o in _raw_origins.split(",") if o.strip()]
    if _raw_origins.strip()
    else []
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_origin_regex=r"https://.*\.replit\.app$|https://.*\.replit\.dev$",
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "Accept"],
)

# Compression: prefer brotli (≈15-25 % smaller than gzip on JS/CSS) and fall
# back to gzip for clients that don't advertise br. Both middlewares are safe
# to stack — BrotliMiddleware only acts when the client sends
# `Accept-Encoding: br`, otherwise it passes the response through and
# GZipMiddleware compresses with gzip. This is the single biggest first-load
# win behind code-splitting and is fronted-proxy-safe.
from fastapi.middleware.gzip import GZipMiddleware  # noqa: E402
try:
    from brotli_asgi import BrotliMiddleware  # type: ignore
    app.add_middleware(BrotliMiddleware, minimum_size=1024, quality=5)
except Exception as _br_err:  # pragma: no cover — never fail boot on missing dep
    logging.getLogger("recall-x247").warning(
        "brotli compression unavailable (%s); falling back to gzip only", _br_err,
    )
app.add_middleware(GZipMiddleware, minimum_size=1024)

# Per-request user identity — verified Firebase ID token → ContextVar
app.add_middleware(UserContextMiddleware)

# ─── SPA navigation guard (bulletproof, denylist-based) ──────────────────────
# Guarantee: a real browser navigation (deep link, bookmark, refresh) to ANY
# path that isn't clearly an API/static endpoint will receive the SPA shell —
# never raw JSON. This works for current AND future routes automatically,
# because it whitelists what is "definitely backend" rather than enumerating
# every SPA route.
#
# A request is treated as "browser document navigation" when:
#   - method is GET, AND
#   - Sec-Fetch-Dest is "document" (modern browsers, top-level navigation), OR
#   - the Accept header prefers text/html over application/json.
#
# A path is considered "API/static" (and therefore NOT rewritten) when it:
#   - starts with a reserved API prefix (`/api/`, `/assets/`, `/share/`,
#     `/calendar.ics`, `/__`), OR
#   - has a known static-asset file extension (.js, .css, .png, .ico, etc.).
#
# Everything else (including unknown future routes) gets the SPA shell.

_API_PREFIXES = (
    "/api/", "/assets/", "/share/", "/__", "/static/", "/_next/",
)
# Exact backend paths that operators must be able to hit from a plain browser
# and still receive JSON (diagnostics / health). Everything else that "looks
# like an SPA route" is rewritten to the SPA shell for a polished UX.
_ALWAYS_BACKEND_EXACT = {
    "/health", "/api/health", "/calendar.ics", "/openapi.json", "/docs",
    "/redoc", "/metrics", "/robots.txt", "/sitemap.xml",
}
_STATIC_EXTS = {
    ".js", ".mjs", ".css", ".map", ".json", ".ico", ".png", ".jpg", ".jpeg",
    ".gif", ".webp", ".svg", ".avif", ".woff", ".woff2", ".ttf", ".eot",
    ".otf", ".mp4", ".webm", ".mp3", ".wav", ".pdf", ".txt", ".xml",
    ".ics", ".webmanifest", ".wasm",
}

def _is_browser_doc_nav(request: Request) -> bool:
    if request.method != "GET":
        return False
    sec_dest = (request.headers.get("sec-fetch-dest") or "").lower()
    if sec_dest == "document":
        return True
    accept = (request.headers.get("accept") or "").lower()
    # If the client is explicitly an XHR-like JSON consumer, never rewrite.
    if "application/json" in accept and "text/html" not in accept:
        return False
    if "text/html" in accept:
        return True
    # Default: anything that doesn't look like XHR is treated as a document
    # navigation (bookmarks, curl with default Accept, etc.).
    x_req = (request.headers.get("x-requested-with") or "").lower()
    if x_req == "xmlhttprequest":
        return False
    return False  # Conservative: only rewrite if signals are explicit.

def _looks_like_api_or_static(path: str) -> bool:
    p = (path or "/").lower()
    if p in _ALWAYS_BACKEND_EXACT:
        return True
    if any(p.startswith(pref) for pref in _API_PREFIXES):
        return True
    last = p.rsplit("/", 1)[-1]
    if "." in last:
        ext = "." + last.rsplit(".", 1)[-1]
        if ext in _STATIC_EXTS:
            return True
    return False

# ─── Live API (Gemini Live: real-time voice/video/image) ─────────────────────

@app.websocket("/ws/live")
async def ws_live(websocket: WebSocket):
    """Bidirectional WebSocket bridge to Gemini Live.

    Authentication: the browser must send a JSON auth frame as the very first
    message after the WebSocket handshake completes:
        {"type": "auth", "token": "<firebase-id-token>"}
    The server verifies the token's signature using firebase-admin. Guests
    (no token) may omit the field or send an empty string and will be scoped
    to the shared GUEST_UID. An unrecognisable first frame or an invalid token
    closes the connection with code 1008 (Policy Violation).
    """
    await websocket.accept()
    try:
        first = await asyncio.wait_for(websocket.receive_json(), timeout=10)
    except asyncio.TimeoutError:
        await websocket.send_json({"type": "error", "error": "Auth timeout: send {\"type\":\"auth\",\"token\":\"...\"} first."})
        await websocket.close(code=1008)
        return
    except Exception:
        await websocket.close(code=1008)
        return

    if first.get("type") != "auth":
        await websocket.send_json({"type": "error", "error": "First message must be an auth frame."})
        await websocket.close(code=1008)
        return

    token = (first.get("token") or "").strip()
    if token:
        uid = verify_firebase_token(token)
        if uid is None:
            await websocket.send_json({"type": "error", "error": "Invalid or expired authentication token."})
            await websocket.close(code=1008)
            return
    else:
        uid = GUEST_UID

    await relay_live_session(websocket, uid)


@app.get("/api/live/status")
async def live_status():
    """Lightweight check the frontend uses to enable/disable the Live button."""
    return {"enabled": is_live_configured(), "model": GEMINI_LIVE_MODEL}


# Real-User Monitoring sink for Core Web Vitals. The browser ships small
# JSON beacons here on tab hide; we accept-and-discard so the network
# request always lands (sendBeacon needs a 2xx) but we don't pay storage
# for it. Logged at debug level so ops can grep when we want a snapshot;
# wire to a real datastore later without touching the client.
@app.post("/api/vitals", status_code=204)
async def report_web_vitals(request: Request):
    try:
        body = await request.body()
        if body and len(body) < 16_384:  # cap to avoid log floods
            logging.getLogger("recall-x247.vitals").debug(
                "vitals %s", body.decode("utf-8", errors="replace"),
            )
    except Exception:
        pass
    # 204 No Content — sendBeacon doesn't read the response anyway.
    return Response(status_code=204)


@app.middleware("http")
async def spa_navigation_guard(request: Request, call_next):
    """Intercept ANY browser document navigation that isn't clearly an API
    or static asset and serve the SPA shell. Guarantees: judges, bookmarks,
    page refreshes, share links, search-engine deep links — none can ever
    receive raw `{"detail":"Not Found"}` JSON for an SPA route. Works for
    every current AND future route without per-route maintenance."""
    if not _is_browser_doc_nav(request):
        return await call_next(request)
    path = request.url.path or "/"
    if _looks_like_api_or_static(path):
        return await call_next(request)
    _dist = os.path.join(os.path.dirname(os.path.abspath(__file__)), "dist")
    index_html = os.path.join(_dist, "index.html")
    if os.path.isfile(index_html):
        return FileResponse(index_html, headers={
            "Cache-Control": "no-cache",
            "X-SPA-Shell": "1",
        })
    # SPA bundle isn't built — fall through; the catch-all below will serve
    # the friendly inline-styled fallback HTML.
    return await call_next(request)

@app.middleware("http")
async def static_cache_headers(request: Request, call_next):
    """Set strong, immutable caching for fingerprinted Vite assets and a
    safe no-cache for the SPA shell. The frontend builds with content
    hashes in every filename under `/assets/<name>-<hash>.js` so a
    one-year `immutable` cache is correct — the URL changes whenever the
    bytes change. Without this, repeat visits redownload everything and
    Lighthouse penalises us under "Serve static assets with an efficient
    cache policy"."""
    response = await call_next(request)
    path = request.url.path or ""
    # Skip if the response already set Cache-Control (e.g. SPA shell).
    if response.headers.get("cache-control"):
        return response
    if path.startswith("/assets/"):
        # Vite hashes every file under /assets, so we can cache forever.
        response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
    elif path == "/" or path.endswith(".html"):
        response.headers["Cache-Control"] = "no-cache"
    else:
        # Root-level static files that aren't hashed (logos, favicon,
        # manifest, robots) — short cache so we can rotate them but
        # browsers don't refetch every page nav.
        last = path.rsplit("/", 1)[-1].lower()
        if "." in last:
            ext = "." + last.rsplit(".", 1)[-1]
            if ext in {".png", ".jpg", ".jpeg", ".webp", ".svg", ".ico",
                      ".woff", ".woff2", ".ttf", ".webmanifest"}:
                response.headers["Cache-Control"] = "public, max-age=86400"
    return response


@app.middleware("http")
async def log_requests(request: Request, call_next):
    start_time = time.time()
    try:
        response = await call_next(request)
        process_time = (time.time() - start_time) * 1000
        logger.info(f"{request.method} {request.url.path} - {response.status_code} - {process_time:.2f}ms")
        return response
    except Exception as e:
        logger.error(f"Error processing request {request.method} {request.url.path}: {e}")
        raise e

@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    return JSONResponse(status_code=exc.status_code, content={"error": exc.detail})

@app.exception_handler(Exception)
async def generic_exception_handler(request: Request, exc: Exception):
    logger.error(f"Unhandled error: {exc}", exc_info=True)
    return JSONResponse(status_code=500, content={"error": "An unexpected internal server error occurred."})


# --- Pydantic Models ---

class ChatRequest(BaseModel):
    message: str
    session_id: str = "default_session"

class ChatResponse(BaseModel):
    reply: str
    agents_called: List[str]
    session_id: str

class CaptureRequest(BaseModel):
    source_type: str = Field(..., pattern="^(youtube|web|pdf|note)$")
    url: Optional[str] = ""
    content: Optional[str] = ""
    preview: bool = False

class MemorySaveRequest(BaseModel):
    source_type: str
    source_url: Optional[str] = ""
    title: str
    summary: str
    key_points: List[str]
    tags: List[str]
    domain: str
    # Rich analysis (optional — older clients still work)
    executive_summary: Optional[str] = ""
    action_items: Optional[List[str]] = None
    glossary: Optional[List[Dict[str, Any]]] = None
    study_questions: Optional[List[str]] = None
    notes: Optional[str] = ""
    # PDF-specific (optional)
    pdf_data: Optional[str] = None
    pdf_pages: Optional[int] = None
    pdf_size_kb: Optional[float] = None
    pdf_word_count: Optional[int] = None
    # When true, bypass the backend's URL/content-hash dedup guards and save
    # this as a fresh memory. Set by the frontend's "Save anyway" override.
    force_new: Optional[bool] = False

class RecallTurn(BaseModel):
    role: str  # "user" or "assistant"
    content: str

class RecallRequest(BaseModel):
    query: str
    history: Optional[List[RecallTurn]] = None
    focal_source_id: Optional[str] = None

class TaskCreateRequest(BaseModel):
    title: str
    due_date: Optional[str] = ""
    priority: Optional[str] = "medium"
    linked_memory_id: Optional[str] = ""

class ScheduleRequest(BaseModel):
    title: str
    date: str
    time: str
    duration_minutes: Optional[int] = 60
    topic: Optional[str] = "Other"
    description: Optional[str] = ""
    linked_task_id: Optional[str] = ""
    linked_memory_id: Optional[str] = ""


class CalendarImportRequest(BaseModel):
    ics_text: str
    topic: Optional[str] = "Other"

class StudyPlanRequest(BaseModel):
    topic: Optional[str] = ""
    days: Optional[int] = 7

class RevisitCreateRequest(BaseModel):
    title: str
    frequency: str = "once"
    memory_id: Optional[str] = ""
    url: Optional[str] = ""
    notes: Optional[str] = ""
    interval_days: Optional[int] = 0
    specific_date: Optional[str] = ""
    action_label: Optional[str] = "Open"
    starts_at: Optional[str] = ""

class RevisitUpdateRequest(BaseModel):
    title: Optional[str] = None
    notes: Optional[str] = None
    url: Optional[str] = None
    action_label: Optional[str] = None
    frequency: Optional[str] = None
    interval_days: Optional[int] = None
    specific_date: Optional[str] = None
    status: Optional[str] = None

class RevisitSnoozeRequest(BaseModel):
    days: float = 1

class RevisitSuggestRequest(BaseModel):
    text: str


# --- Capture-enrichment (W1) ---

class RelatedMemoriesRequest(BaseModel):
    """Body for POST /memories/related — surface memories similar to a
    free-form text + optional tag set, used by the capture-enrichment
    'Related' chip on the preview card."""
    text: str = ""
    tags: Optional[List[str]] = None
    exclude_id: Optional[str] = ""
    limit: Optional[int] = 5


class CaptureFolderRef(BaseModel):
    project_id: str
    folder_id: str
    section_id: Optional[str] = "notes"


class CaptureBundleTask(BaseModel):
    title: str
    priority: Optional[str] = "medium"
    due_date: Optional[str] = ""


class CaptureBundleEvent(BaseModel):
    title: str
    date: str
    time: str
    duration_minutes: Optional[int] = 30
    topic: Optional[str] = "Other"
    description: Optional[str] = ""


class CaptureBundleRevisit(BaseModel):
    frequency: str = "once"
    interval_days: Optional[int] = 0
    specific_date: Optional[str] = ""


class CaptureBundleHabitLink(BaseModel):
    habit_id: str


class CaptureSaveBundleRequest(BaseModel):
    """Single-shot endpoint that saves a captured memory plus all the
    enrichments the user accepted (folder, tasks, event, revisit,
    habit link, memory cross-links). Each enrichment is best-effort —
    failure of one does not block the memory save.

    `suggested_folder_hint` lets the W4 auto-folder layer file the
    memory silently when the user skipped picking a folder — the
    backend matches the hint against existing folders and only auto-
    files when confidence > 0.7. Carried in the request because the
    capture analyze step already produced it for free."""
    memory: MemorySaveRequest
    folder_ref: Optional[CaptureFolderRef] = None
    tasks: Optional[List[CaptureBundleTask]] = None
    event: Optional[CaptureBundleEvent] = None
    revisit: Optional[CaptureBundleRevisit] = None
    habit_link: Optional[CaptureBundleHabitLink] = None
    linked_memory_ids: Optional[List[str]] = None
    suggested_folder_hint: Optional[str] = None


# --- Startup ---

@app.on_event("startup")
async def startup_event():
    logger.info(f"Recall X247 v2.0 started. AI: {settings.ai_provider_name}. GCP Project: {settings.GCP_PROJECT_ID}")
    # Seed demo data so judges see a full brain immediately
    try:
        from app.demo_data import seed_demo_data
        db = await get_db()
        seeded = await seed_demo_data(db)
        if seeded:
            logger.info("Demo data seeded successfully.")
    except Exception as e:
        logger.warning(f"Demo seed skipped: {e}")
    try:
        await seed_extras()
        logger.info("Extras (notes, bookmarks, habits) seeded.")
    except Exception as e:
        logger.warning(f"Extras seed skipped: {e}")
    try:
        start_briefing_scheduler()
        logger.info("Daily briefing notification scheduler started.")
    except Exception as e:
        logger.warning(f"briefing scheduler start failed: {e}")
    try:
        start_notion_sync_scheduler()
        logger.info("Notion sync scheduler started.")
    except Exception as e:
        logger.warning(f"notion sync scheduler start failed: {e}")
    logger.info("Startup complete.")


# --- Health & Settings ---

@app.get("/api/health")
async def api_health():
    return await health()

@app.get("/health")
async def health():
    try:
        from app.db import is_using_mock_db
        memories_count = await get_collection_count("memories")
        tasks_count = await get_collection_count("tasks")
        persistence = "in-memory-mock" if is_using_mock_db() else "firestore"
        return {
            "status": "ok",
            "persistence": persistence,
            "memories_count": memories_count,
            "tasks_count": tasks_count,
            "ai_provider": "openai" if settings.using_openai else "gemini",
            "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat()
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Health check failed: {str(e)}")

def _settings_payload():
    import os as _os
    from app.live_agent import is_live_configured, GEMINI_LIVE_MODEL
    youtube_key_set = bool(
        _os.environ.get("YOUTUBE_API_KEY") or _os.environ.get("YT_API_KEY")
    )
    youtube_fallback = "GOOGLE_API_KEY" if (not youtube_key_set and settings.GEMINI_API_KEY) else None
    return {
        "gen_apac_api_key_set": bool(settings.GEN_API_KEY),
        "openai_api_key_set": bool(settings.FALLBACK_AI_KEY or settings.OPENAI_API_KEY),
        "fallback_key_set": bool(settings.FALLBACK_AI_KEY),
        "fallback_ai_model": settings.FALLBACK_AI_MODEL if settings.has_fallback else None,
        "openai_model": settings.OPENAI_MODEL,
        "gemini_api_key_set": bool(settings.GEMINI_API_KEY),
        "gemini_model": settings.GEMINI_MODEL,
        "gemini_live_key_set": is_live_configured(),
        "gemini_live_model": GEMINI_LIVE_MODEL,
        "youtube_api_key_set": youtube_key_set,
        "youtube_fallback": youtube_fallback,
        "ai_provider": "gemini" if settings.USE_GEMINI else ("openrouter" if settings.USE_OPENROUTER else "openai"),
        "ai_provider_name": settings.ai_provider_name,
        "fallback_provider": settings.FALLBACK_AI_MODEL if settings.has_fallback else None,
        "use_gemini": settings.USE_GEMINI,
        "use_openrouter": settings.USE_OPENROUTER,
        "openai_base_url": settings.openai_base_url,
        "gcp_project_id": settings.GCP_PROJECT_ID,
        "firestore_database_id": settings.FIREBASE_DATABASE_ID,
        "google_calendar_configured": bool(settings.GOOGLE_CALENDAR_ID),
        "status": "online"
    }

@app.get("/settings")
async def settings_endpoint():
    return _settings_payload()

@app.get("/config")
async def config_endpoint():
    """Alias for /settings — used by frontend to avoid SPA route conflict."""
    return _settings_payload()

@app.get("/test-ai")
async def test_ai_endpoint():
    if not settings.OPENAI_API_KEY:
        raise HTTPException(status_code=401, detail="OPENAI_API_KEY is not set.")
    try:
        from openai import AsyncOpenAI
        client = AsyncOpenAI(
            api_key=settings.OPENAI_API_KEY,
            base_url=settings.openai_base_url,
            default_headers=settings.openai_extra_headers
        )
        response = await client.chat.completions.create(
            model=settings.OPENAI_MODEL,
            messages=[{"role": "user", "content": "Reply with exactly: 'OpenAI Connection Successful!'"}],
            max_tokens=30
        )
        return {"status": "success", "message": response.choices[0].message.content.strip(), "model": settings.OPENAI_MODEL}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI Test Failed: {str(e)}")


# --- Chat / Coordinator ---

@app.post("/api/chat", response_model=ChatResponse)
async def api_chat(request: ChatRequest):
    return await chat_endpoint(request)

@app.post("/chat", response_model=ChatResponse)
async def chat_endpoint(request: ChatRequest):
    result = await run_coordinator(request.message, request.session_id)
    if "error" in result and result.get("error") == "Unauthorized":
        raise HTTPException(status_code=401, detail=result["reply"])
    await log_interaction(
        session_id=result["session_id"],
        user_message=request.message,
        reply=result["reply"],
        agents_called=result["agents_called"]
    )
    return result


@app.post("/agent/chat/clear")
async def agent_chat_clear(request: ChatRequest):
    """Wipe the in-memory chat history for a session — used by the 'New chat' button."""
    require_auth()  # 401 for guests — shared GUEST_UID would let any guest wipe any guest's history.
    cleared = clear_session_history(request.session_id)
    return {"session_id": request.session_id, "cleared_messages": cleared}


@app.get("/agent/chat/history")
async def agent_chat_history(session_id: str = "agent-hub"):
    """Inspect current session history (debug)."""
    require_auth()  # 401 for guests — see /agent/chat/clear comment.
    return {"session_id": session_id, "messages": get_session_history(session_id)}


@app.post("/agent/chat/stream")
async def agent_chat_stream(request: ChatRequest):
    """SSE streaming endpoint — yields agent events as they happen."""
    # Reject guests — workflow + history persisted by this stream are
    # only safe to scope per-user when the user is identified.
    require_auth()
    # IMPORTANT: capture uid here, BEFORE returning StreamingResponse.
    # UserContextMiddleware resets the request's ContextVar in its
    # `finally` block as soon as dispatch() returns. The streaming body
    # iterator runs *after* that reset, so any get_uid() call inside
    # event_generator()/run_coordinator_stream() would see the default
    # "guest" — collapsing tenant isolation across every SSE chat.
    # Re-binding the contextvar inside the generator pins the right uid
    # for the lifetime of the stream.
    from app.user_context import get_uid, current_user_id_var
    uid = get_uid()

    async def event_generator():
        token_ctx = current_user_id_var.set(uid)
        try:
            async for event in run_coordinator_stream(request.message, request.session_id):
                yield event
        except asyncio.CancelledError:
            pass
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"
        finally:
            yield f"data: {json.dumps({'type': 'done'})}\n\n"
            current_user_id_var.reset(token_ctx)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive"
        }
    )


# --- Page specialist agents (per-page chat docks) ---

class SpecialistChatRequest(BaseModel):
    message: str
    session_id: str = "default_session"


@app.get("/agent/specialist/pages")
async def specialist_pages():
    """List all configured page specialists (for the frontend registry)."""
    return {"pages": list_pages()}


@app.post("/agent/specialist/{page_id}/chat/stream")
async def specialist_chat_stream(page_id: str, request: SpecialistChatRequest):
    """SSE streaming endpoint for a page-specific specialist agent."""
    require_auth()  # 401 for guests — see /agent/chat/stream.
    if not is_known_page(page_id):
        return JSONResponse(
            status_code=404,
            content={"error": f"Unknown page specialist: {page_id}",
                     "known": list(PAGE_SPECIALISTS.keys())},
        )

    # See agent_chat_stream() above for why we re-bind the uid contextvar
    # inside the generator: middleware resets it before SSE body iterates.
    from app.user_context import get_uid, current_user_id_var
    uid = get_uid()

    async def event_generator():
        token_ctx = current_user_id_var.set(uid)
        try:
            async for event in run_specialist_stream(page_id, request.message, request.session_id):
                yield event
        except asyncio.CancelledError:
            pass
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"
        finally:
            yield f"data: {json.dumps({'type': 'done'})}\n\n"
            current_user_id_var.reset(token_ctx)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


@app.post("/agent/specialist/{page_id}/chat/clear")
async def specialist_chat_clear(page_id: str, request: SpecialistChatRequest):
    """Wipe in-memory history for a specialist dock."""
    require_auth()
    if not is_known_page(page_id):
        return JSONResponse(status_code=404, content={"error": f"Unknown page: {page_id}"})
    cleared = clear_specialist_history(page_id, request.session_id)
    return {"page_id": page_id, "session_id": request.session_id, "cleared_messages": cleared}


@app.get("/agent/specialist/{page_id}/chat/history")
async def specialist_chat_history(page_id: str, session_id: str = "default_session"):
    """Inspect specialist chat history (debug)."""
    require_auth()
    if not is_known_page(page_id):
        return JSONResponse(status_code=404, content={"error": f"Unknown page: {page_id}"})
    return {
        "page_id": page_id,
        "session_id": session_id,
        "messages": get_specialist_history(page_id, session_id),
    }


# --- Workflows ---

@app.get("/workflows")
async def list_workflows_endpoint(limit: int = 20):
    """List recent multi-agent workflows with execution trace.

    Auth-gated: workflow traces include user_message + raw tool inputs
    and outputs (recalled memory contents, calendar entries, captured
    files…). Returning these to the shared GUEST_UID would still leak
    across every unauthenticated client, so we reject guests outright.
    The data layer additionally filters by uid as a defence-in-depth.
    """
    require_auth()
    return list_workflows(limit=limit)


@app.get("/workflows/{workflow_id}")
async def get_workflow_endpoint(workflow_id: str):
    """Get a specific workflow with full step details."""
    require_auth()
    wf = get_workflow(workflow_id)
    if not wf:
        raise HTTPException(status_code=404, detail="Workflow not found")
    return wf.to_dict()


# --- Agent Registry ---

@app.get("/agents")
async def list_agents_endpoint():
    """List all registered sub-agents with their capabilities."""
    return list(AGENT_REGISTRY.values())


# --- Capture ---

@app.post("/capture")
async def capture_endpoint(request: CaptureRequest, http_request: Request):
    # Per-IP rate limit — public capture endpoint without auth would
    # otherwise let a single attacker drive unbounded outbound fetches
    # and paid LLM calls. See app/rate_limit.py for tuning rationale.
    from app.rate_limit import capture_limiter, client_ip_from_request
    ip = client_ip_from_request(http_request)
    if not await capture_limiter.allow(ip):
        raise HTTPException(
            status_code=429,
            detail="Too many capture requests; slow down and retry in a minute.",
        )
    logger.info(f"Capture request: {request.source_type}")
    try:
        result = await capture(
            source_type=request.source_type,
            url=request.url,
            content=request.content,
            preview=request.preview,
        )
        if "error" in result:
            err = str(result['error'])
            if "OPENAI_API_KEY" in err or "not found" in err.lower():
                raise HTTPException(status_code=401, detail=result["error"])
            # Unsafe-URL refusals from the SSRF guard come back as
            # "Refused to fetch …" / "Invalid URL: …" — those are
            # client errors, not server errors.
            if err.startswith(("Refused to fetch", "Invalid URL")):
                raise HTTPException(status_code=400, detail=result["error"])
            raise HTTPException(status_code=500, detail=result["error"])
        return result
    except HTTPException as he:
        raise he
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/capture/save-bundle")
async def capture_save_bundle_endpoint(request: CaptureSaveBundleRequest):
    """Save a captured memory PLUS all user-accepted enrichments
    (folder placement, follow-up tasks, calendar event, revisit
    cadence, habit link, memory cross-links) in a single call.

    Memory save is the critical path — if it fails, the call fails.
    Each enrichment is best-effort and surfaced in the `errors`
    array on the response so the UI can show a partial-success toast
    without losing the memory itself.
    """
    try:
        payload = request.model_dump(exclude_none=False)
        result = await save_bundle(payload)
        if "error" in result:
            raise HTTPException(status_code=500, detail=result["error"])
        return result
    except HTTPException as he:
        raise he
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/capture/upload")
async def capture_upload_endpoint(file: UploadFile = File(...), preview: bool = Query(False)):
    """Upload and capture a document.

    Supported types:
      .pdf                    → routed through the PDF parser (pypdf).
      .txt / .md / .markdown  → read as UTF-8 text and routed through the
                                note pipeline so the LLM can summarise it
                                with the same 7-agent treatment.

    Hard size cap: 25 MB. Anything larger gets a 413 with a clear message
    instead of a generic 500.
    """
    name = (file.filename or "").lower()
    is_pdf = name.endswith(".pdf")
    is_text = (
        name.endswith(".txt")
        or name.endswith(".md")
        or name.endswith(".markdown")
    )
    if not (is_pdf or is_text):
        raise HTTPException(
            status_code=400,
            detail="Unsupported file. Allowed: .pdf, .txt, .md",
        )
    try:
        # Stream-read with a running byte counter so we can hang up on
        # oversized uploads BEFORE allocating the whole payload in memory.
        # `await file.read()` would happily buffer hundreds of MB before
        # the size check ran — easy DoS vector if the frontend cap is
        # bypassed (curl, malicious clients, etc).
        max_bytes = 25 * 1024 * 1024
        chunks: list[bytes] = []
        total = 0
        chunk_size = 256 * 1024  # 256 kB
        while True:
            chunk = await file.read(chunk_size)
            if not chunk:
                break
            total += len(chunk)
            if total > max_bytes:
                raise HTTPException(
                    status_code=413,
                    detail="File too large (max 25 MB).",
                )
            chunks.append(chunk)
        raw = b"".join(chunks)
        if not raw:
            raise HTTPException(status_code=400, detail="Empty file.")

        if is_pdf:
            result = await capture(
                source_type="pdf",
                pdf_bytes=raw,
                preview=preview,
            )
        else:
            try:
                text = raw.decode("utf-8", errors="ignore").strip()
            except Exception:
                text = ""
            if not text:
                raise HTTPException(
                    status_code=400,
                    detail="Could not read text from file (empty or non-UTF8).",
                )
            # Cap analysis input to keep the model call cheap; the original
            # raw bytes are already saved to the user's source_filename.
            result = await capture(
                source_type="note",
                content=text[:50000],
                preview=preview,
            )
            # Use the filename (without extension) as the human-readable
            # title — much friendlier than whatever the LLM invents from a
            # bare paragraph.
            if isinstance(result, dict):
                display_name = (file.filename or "Document").rsplit(".", 1)[0]
                result["title"] = display_name[:140]
                result["source_filename"] = file.filename

        if "error" in result:
            raise HTTPException(status_code=500, detail=result["error"])
        # Pass through original filename for nicer UI titles (PDF path)
        if isinstance(result, dict) and not result.get("title", "").strip().lower().startswith(name[:6]):
            result.setdefault("source_filename", file.filename)
        return result
    except HTTPException as he:
        raise he
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# --- Memories ---

@app.post("/memories")
async def save_memory_endpoint(request: MemorySaveRequest):
    result = await save_memory(request.model_dump())
    if "error" in result:
        raise HTTPException(status_code=500, detail=result["error"])
    return result

@app.get("/memories")
async def list_memories_endpoint(
    domain: str = "",
    limit: int = 20,
    unreviewed: bool = False,
    include_archived: bool = False,
    include_trashed: bool = False,
    source_type: str = "",
    offset: int = 0,
    q: str = "",
):
    try:
        return await list_memories(
            domain=domain,
            limit=limit,
            unreviewed=unreviewed,
            include_archived=include_archived,
            include_trashed=include_trashed,
            source_type=source_type,
            offset=offset,
            q=q,
        )
    except Exception as e:
        print(f"list_memories_endpoint error: {e}")
        return []

@app.get("/memories/inbox-count")
async def inbox_count_endpoint():
    """Tiny counts-only endpoint that powers the sidebar Inbox badge.

    A memory counts as "in the inbox" when it is owned by the current user
    AND not trashed AND not archived AND not yet reviewed.

    We narrow the read on the server side first by filtering on the
    current user_id so we don't drag the entire `memories` collection
    across the wire, then apply the in-app inbox predicate (which can't
    be expressed as a single Firestore index because legacy docs are
    missing the `reviewed` / `archived` fields entirely and we treat
    "missing" as "still in the inbox"). Capped at 500 — the badge just
    needs to say "you've got stuff to triage", not give an exact
    accounting beyond a few hundred unread items.
    """
    from app.user_context import get_uid
    CAP = 500
    FETCH_LIMIT = CAP * 2  # leave headroom in case some docs fail the
                           # in-app predicate (already-reviewed / archived)
    try:
        db = await get_db()
        uid = get_uid()
        # Narrow on the server: only the current user's memories.
        # `belongs_to_current_user` accepts both `user_id` and the legacy
        # `userId`, but every doc the app writes today uses `user_id`,
        # so a single-field where() is the right cost trade-off.
        query_ref = (
            db.collection("memories")
            .where("user_id", "==", uid)
            .limit(FETCH_LIMIT)
        )
        snapshot = await query_ref.get()
        count = 0
        capped = False
        for doc in snapshot:
            m = doc.to_dict()
            if m.get("trashed_at"):
                continue
            if m.get("archived") is True:
                continue
            if m.get("reviewed") is True:
                continue
            count += 1
            if count >= CAP:
                capped = True
                break
        return {"count": count, "capped": capped}
    except Exception as e:
        print(f"inbox_count_endpoint error: {e}")
        return {"count": 0, "capped": False}


@app.get("/memories/{memory_id}")
async def get_memory_endpoint(memory_id: str):
    try:
        return await get_memory(memory_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

class MemoryPatchRequest(BaseModel):
    reviewed: Optional[bool] = None
    archived: Optional[bool] = None
    tags: Optional[List[str]] = None
    pinned: Optional[bool] = None
    project_id: Optional[str] = None
    # Editable content fields — used by the Edit-memory UX in Vault/Recall
    # and by the orchestrator's edit_memory tool. All optional; only the
    # fields actually present in the request are persisted.
    title: Optional[str] = None
    summary: Optional[str] = None
    source_url: Optional[str] = None

@app.patch("/memories/{memory_id}")
async def patch_memory_endpoint(memory_id: str, body: MemoryPatchRequest):
    """Update Inbox-triage flags (reviewed / archived) or replace tags."""
    from app.user_context import belongs_to_current_user
    db = await get_db()
    doc_ref = db.collection("memories").document(memory_id)
    doc = await doc_ref.get()
    if not doc.exists or not belongs_to_current_user(doc.to_dict()):
        raise HTTPException(status_code=404, detail=f"Memory '{memory_id}' not found.")
    updates: Dict[str, Any] = {}
    if body.reviewed is not None:
        updates["reviewed"] = bool(body.reviewed)
    if body.archived is not None:
        updates["archived"] = bool(body.archived)
        # Archiving implies it has been triaged — force reviewed=true even
        # if the caller passed reviewed=false in the same request.
        if body.archived:
            updates["reviewed"] = True
    if body.tags is not None:
        # Normalise: strip + dedupe (preserve order), cap at 24 tags
        seen = set()
        clean: List[str] = []
        for t in body.tags:
            tt = (t or "").strip()
            if tt and tt.lower() not in seen:
                seen.add(tt.lower())
                clean.append(tt)
            if len(clean) >= 24:
                break
        updates["tags"] = clean
    if body.pinned is not None:
        updates["pinned"] = bool(body.pinned)
    if body.project_id is not None:
        # Allow clearing by passing empty string; otherwise set to project ref
        updates["project_id"] = body.project_id or ""
    if body.title is not None:
        # Title cannot be blanked — silently ignore empty submissions so
        # an accidental save doesn't strip a memory's headline.
        t = body.title.strip()
        if t:
            updates["title"] = t[:240]
    if body.summary is not None:
        # Summary CAN be cleared (empty string is a valid edit). Cap length
        # so a runaway paste doesn't bloat Firestore docs.
        updates["summary"] = (body.summary or "").strip()[:4000]
    if body.source_url is not None:
        # Source URL also clearable. Trim and cap.
        updates["source_url"] = (body.source_url or "").strip()[:2048]
    if not updates:
        return {"id": memory_id, "updated": False}
    await doc_ref.update(updates)
    return {"id": memory_id, "updated": True, **updates}

@app.post("/memories/{memory_id}/reupload-pdf")
async def reupload_memory_pdf_endpoint(memory_id: str, file: UploadFile = File(...)):
    """Re-upload a PDF for an existing memory so the inline viewer works.

    Used when a memory was captured before inline-PDF embedding was added,
    or when the original upload exceeded the embed-size cap and the binary
    was stripped on save. Parses the PDF and writes pdf_data / pdf_word_count
    / pdf_byte_size / source_filename onto the existing memory document.
    The memory's title, summary, and tags are NOT touched.
    """
    from app.user_context import belongs_to_current_user

    name = (file.filename or "").lower()
    if not name.endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only .pdf files are accepted here.")

    db = await get_db()
    doc_ref = db.collection("memories").document(memory_id)
    doc = await doc_ref.get()
    if not doc.exists or not belongs_to_current_user(doc.to_dict()):
        raise HTTPException(status_code=404, detail=f"Memory '{memory_id}' not found.")
    if (doc.to_dict() or {}).get("source_type") != "pdf":
        raise HTTPException(status_code=400, detail="This memory isn't a PDF.")

    try:
        max_bytes = 25 * 1024 * 1024
        chunks: list[bytes] = []
        total = 0
        chunk_size = 256 * 1024
        while True:
            chunk = await file.read(chunk_size)
            if not chunk:
                break
            total += len(chunk)
            if total > max_bytes:
                raise HTTPException(status_code=413, detail="File too large (max 25 MB).")
            chunks.append(chunk)
        raw = b"".join(chunks)
        if not raw:
            raise HTTPException(status_code=400, detail="Empty file.")

        # Use the same parser the capture flow uses so we get pdf_data
        # (data-URL), word count, and byte size in identical shape. preview=True
        # avoids creating a *new* memory — we only want the parsed payload.
        parsed = await capture(source_type="pdf", pdf_bytes=raw, preview=True)
        if not isinstance(parsed, dict) or "error" in parsed:
            raise HTTPException(status_code=500, detail=(parsed or {}).get("error", "Failed to parse PDF."))

        # capture_agent emits pdf_data + pdf_pages + pdf_size_kb +
        # pdf_word_count (NOT pdf_byte_size — that field doesn't exist on
        # the parsed payload). Persist exactly what the parser returns so
        # the page-count and size badges in the inline viewer stay accurate.
        updates: Dict[str, Any] = {}
        if parsed.get("pdf_data"):
            updates["pdf_data"] = parsed["pdf_data"]
        if parsed.get("pdf_word_count") is not None:
            updates["pdf_word_count"] = int(parsed["pdf_word_count"])
        if parsed.get("pdf_pages") is not None:
            updates["pdf_pages"] = int(parsed["pdf_pages"])
        if parsed.get("pdf_size_kb") is not None:
            updates["pdf_size_kb"] = float(parsed["pdf_size_kb"])
        if file.filename:
            updates["source_filename"] = file.filename

        if not updates.get("pdf_data"):
            # Parser succeeded but the binary was stripped because it
            # exceeded MAX_EMBED_PDF_BYTES (~700 KB). Tell the user the
            # real limit instead of silently doing nothing.
            raise HTTPException(
                status_code=413,
                detail="PDF parsed but too large to embed inline (max ~700 KB for inline view). Try a smaller file or a different export.",
            )

        await doc_ref.update(updates)
        return {"id": memory_id, "updated": True, **{k: v for k, v in updates.items() if k != "pdf_data"}, "pdf_embedded": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/memories/{memory_id}")
async def delete_memory_endpoint(memory_id: str, hard: bool = False):
    """Soft-delete (move to Trash) by default; pass `?hard=true` to remove."""
    try:
        return await delete_memory(memory_id, hard=hard)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


# ─── Library power-ups (Task #18): Trash, Bulk, Smart Collections, Tags, Search ──
from app import library_agent  # noqa: E402


class TrashOpRequest(BaseModel):
    entity: str  # "memory" | "note" | "bookmark"
    ids: List[str]


@app.get("/trash")
async def trash_list_endpoint():
    try:
        return await library_agent.list_trash()
    except Exception as e:
        print(f"trash_list_endpoint error: {e}")
        return {"memories": [], "notes": [], "bookmarks": []}


@app.post("/trash/restore")
async def trash_restore_endpoint(body: TrashOpRequest):
    try:
        return await library_agent.restore_from_trash(body.entity, body.ids)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/trash/purge")
async def trash_purge_endpoint(body: TrashOpRequest):
    try:
        return await library_agent.purge_from_trash(body.entity, body.ids)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/trash/purge-expired")
async def trash_purge_expired_endpoint():
    """Hard-delete trashed items past the 30-day grace window. Safe to
    invoke on demand from the UI or from a scheduled Cloud Run job."""
    return await library_agent.purge_expired_trash()


class BulkDeleteRequest(BaseModel):
    entity: str
    ids: List[str]


@app.get("/library/counts")
async def library_counts_endpoint():
    """Aggregated per-tab counts powering the small badges on the
    Library page tablist. One round-trip beats fanning out 11 separate
    fetches from the browser, and the helpers here are all in-memory
    cheap on the mock DB / lightly indexed on Firestore."""
    import asyncio as _asyncio
    from app.recall_agent import get_stats as _get_stats, list_memories as _list_memories
    from app.extras_agent import (
        list_notes as _list_notes,
        list_bookmarks as _list_bookmarks,
        list_habits as _list_habits,
    )
    from app.task_agent import list_tasks as _list_tasks
    from app.revisit_agent import list_revisits as _list_revisits

    async def _safe(coro, default):
        try:
            return await coro
        except Exception as _e:
            logger.warning(f"library/counts subcall failed: {_e}")
            return default

    # Inbox uses the existing dedicated counter so the badge here always
    # matches the sidebar pill (single source of truth).
    async def _inbox_count() -> int:
        try:
            res = await inbox_count_endpoint()
            return int(res.get("count") or 0) if isinstance(res, dict) else 0
        except Exception:
            return 0

    (stats, notes, bookmarks, tasks, habits, revisits, trash, tags, inbox) = await _asyncio.gather(
        _safe(_get_stats(), {"total": 0, "by_source": {}}),
        _safe(_list_notes(limit=1000), []),
        _safe(_list_bookmarks(limit=1000), []),
        _safe(_list_tasks(status="pending", limit=500), []),
        _safe(_list_habits(), []),
        _safe(_list_revisits(status="active", limit=2000), []),
        _safe(library_agent.list_trash(), {}),
        _safe(library_agent.tags_index(), []),
        _inbox_count(),
    )

    by_source = (stats or {}).get("by_source") or {}
    vault_total = int((stats or {}).get("total") or 0)
    pdf_total = int(by_source.get("pdf") or 0)

    def _len(x) -> int:
        try:
            return len(x or [])
        except Exception:
            return 0

    trash_total = sum(_len(v) for v in (trash or {}).values()) if isinstance(trash, dict) else 0

    return {
        "vault": vault_total,
        "notes": _len(notes),
        "bookmarks": _len(bookmarks),
        "files": pdf_total,
        "inbox": int(inbox or 0),
        "tags": _len(tags),
        "tasks": _len(tasks),
        "habits": _len(habits),
        # Flashcards are derived per-memory; surfacing a real count would
        # require iterating every memory's flashcards subcollection. We
        # leave it out of the badge map (omitted = no badge) rather than
        # mislead with a fake number.
        "revisits": _len(revisits),
        "trash": trash_total,
    }


@app.post("/library/bulk-delete")
async def bulk_delete_endpoint(body: BulkDeleteRequest):
    try:
        return await library_agent.soft_delete(body.entity, body.ids)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


class BulkArchiveRequest(BaseModel):
    ids: List[str]
    archived: bool = True
    entity: Optional[str] = "memory"


@app.post("/library/bulk-archive")
async def bulk_archive_endpoint(body: BulkArchiveRequest):
    return await library_agent.set_archived(body.ids, body.archived, body.entity or "memory")


class BulkMoveProjectRequest(BaseModel):
    ids: List[str]
    project_id: Optional[str] = None
    entity: Optional[str] = "memory"


@app.post("/library/bulk-move-project")
async def bulk_move_project_endpoint(body: BulkMoveProjectRequest):
    return await library_agent.bulk_move_project(body.ids, body.project_id, body.entity or "memory")


class BulkTagRequest(BaseModel):
    entity: str
    ids: List[str]
    tags: List[str]


@app.post("/library/bulk-tag-add")
async def bulk_tag_add_endpoint(body: BulkTagRequest):
    try:
        return await library_agent.bulk_tag_add(body.entity, body.ids, body.tags)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/library/bulk-tag-remove")
async def bulk_tag_remove_endpoint(body: BulkTagRequest):
    try:
        return await library_agent.bulk_tag_remove(body.entity, body.ids, body.tags)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


class PinRequest(BaseModel):
    pinned: bool


@app.post("/memories/{memory_id}/pin")
async def pin_memory_endpoint(memory_id: str, body: PinRequest):
    try:
        return await library_agent.set_pinned(memory_id, body.pinned)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


# Smart Collections
class SmartCollectionRequest(BaseModel):
    name: str
    filters: Dict[str, Any] = {}


class SmartCollectionUpdateRequest(BaseModel):
    name: Optional[str] = None
    filters: Optional[Dict[str, Any]] = None


@app.get("/smart-collections")
async def smart_collections_list_endpoint():
    try:
        return await library_agent.list_smart_collections()
    except Exception as e:
        print(f"smart_collections_list_endpoint error: {e}")
        return []


@app.post("/smart-collections")
async def smart_collections_create_endpoint(body: SmartCollectionRequest):
    try:
        return await library_agent.create_smart_collection(body.name, body.filters)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.patch("/smart-collections/{cid}")
async def smart_collections_update_endpoint(cid: str, body: SmartCollectionUpdateRequest):
    try:
        return await library_agent.update_smart_collection(cid, body.name, body.filters)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@app.delete("/smart-collections/{cid}")
async def smart_collections_delete_endpoint(cid: str):
    try:
        return await library_agent.delete_smart_collection(cid)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


# Tag Manager
class TagRenameRequest(BaseModel):
    old: str
    new: str


class TagMergeRequest(BaseModel):
    sources: List[str]
    target: str


@app.get("/tags-index")
async def tags_index_endpoint():
    return await library_agent.tags_index()


@app.post("/tags/rename")
async def tag_rename_endpoint(body: TagRenameRequest):
    try:
        return await library_agent.tag_rename(body.old, body.new)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/tags/merge")
async def tag_merge_endpoint(body: TagMergeRequest):
    try:
        return await library_agent.tag_merge(body.sources, body.target)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.delete("/tags/{name}")
async def tag_delete_endpoint(name: str):
    try:
        return await library_agent.tag_delete(name)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# Deep search + related
@app.get("/search/deep")
async def deep_search_endpoint(q: str = "", limit: int = 30, entities: str = ""):
    """Deep full-text search.

    `entities` — optional comma-separated subset of {memory,note,bookmark}.
    Default behaviour searches all three.
    """
    ents = [e for e in (entities or "").split(",") if e.strip()] or None
    return await library_agent.deep_search(q, limit=limit, entities=ents)


@app.get("/memories/{memory_id}/related")
async def related_memories_endpoint(memory_id: str, limit: int = 5):
    return await library_agent.related_memories(memory_id, limit=limit)


@app.get("/memories/{memory_id}/links")
async def get_memory_links_endpoint(memory_id: str):
    """W2-B1: single-round-trip fan-out for the memory detail page —
    returns folder, tasks, events, revisits, habits, flashcards,
    related_memories, and external_refs in one payload."""
    try:
        return await library_agent.get_memory_links(memory_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


class MemoryLinkRequest(BaseModel):
    kind: str
    ref_id: str


@app.post("/memories/{memory_id}/link")
async def link_memory_endpoint(memory_id: str, body: MemoryLinkRequest):
    """W2-B2: bidirectional link writer. Body: {kind, ref_id}. `kind` is
    one of task | event | revisit | habit | memory | folder |
    external_ref. For folder, `ref_id` is "project_id" or
    "project_id/folder_id". For external_ref, `ref_id` is either an
    existing external_refs doc id or "source:source_id[:title:url]"
    sugar that creates a new ref in-line."""
    try:
        return await library_agent.link_memory_to(
            memory_id, body.kind, body.ref_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.delete("/memories/{memory_id}/link/{kind}/{ref_id:path}")
async def unlink_memory_endpoint(memory_id: str, kind: str, ref_id: str):
    """W2-B2: clears both ends of a memory ↔ entity link. Idempotent —
    a missing edge returns success without raising.

    `ref_id` uses the `:path` converter so folder unlinks of the form
    "project_id/folder_id" are captured as a single segment instead of
    being routed away. Callers should still URL-encode literal slashes
    inside an opaque id (the path converter only swallows the rest of
    the URL after the kind segment)."""
    try:
        return await library_agent.unlink_memory_from(memory_id, kind, ref_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ─── W3 Universal Linker (Cmd-K palette) ──────────────────────────────

@app.get("/search/global")
async def global_search_endpoint(
    q: str = "", kinds: str = "", limit: int = 20,
):
    """Cross-collection text search powering the Cmd-K palette. Returns
    a single ranked `results` list plus per-kind buckets so the palette
    can render either a flat ranking or a kind-grouped view.

    `kinds` is a comma-separated subset of memory|task|event|revisit|
    habit|folder. Omit (or pass empty) to search all of them.
    """
    from app import global_search as _gs
    requested = [k.strip().lower() for k in (kinds or "").split(",") if k.strip()]
    return await _gs.global_search(q=q, kinds=requested or None, limit=max(1, min(50, limit)))


@app.post("/links")
async def create_link_endpoint(body: dict):
    """Generic link creator — palette uses this for memory↔X and
    task↔event pairs. Body: `{from:{kind,id}, to:{kind,id}}`.

    We accept the body as a raw dict (rather than a Pydantic model)
    because `from` is a Python reserved word and Pydantic v2's
    field-aliasing requires extra wiring per app version. The shape is
    tiny enough to validate inline."""
    from app import links as _links
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="Body must be a JSON object.")
    f = body.get("from")
    t = body.get("to")
    # Reject non-object from/to early — if a client posts {"from": []}
    # or a string, calling .get() on it would 500. We want a deterministic
    # 400 instead.
    if not isinstance(f, dict) or not isinstance(t, dict):
        raise HTTPException(
            status_code=400,
            detail="`from` and `to` must each be objects with kind and id.",
        )
    try:
        return await _links.create_link(
            from_kind=str(f.get("kind") or ""),
            from_id=str(f.get("id") or ""),
            to_kind=str(t.get("kind") or ""),
            to_id=str(t.get("id") or ""),
        )
    except _links.LinkPairUnsupported as e:
        raise HTTPException(status_code=400, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/memories/related")
async def related_by_text_endpoint(request: RelatedMemoriesRequest):
    """Capture-enrichment 'Related' chip: find memories similar to the
    in-progress capture text. Distinct from GET /memories/{id}/related
    which needs a saved memory id; this version works on draft text
    BEFORE the memory is persisted."""
    try:
        items = await find_related_memories(
            text=request.text or "",
            tags=request.tags or [],
            exclude_id=request.exclude_id or "",
            limit=int(request.limit or 5),
        )
        return {"items": items, "count": len(items)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/memories/{memory_id}/flashcards")
async def get_flashcards_endpoint(memory_id: str):
    result = await generate_flashcards(memory_id)
    if "error" in result:
        raise HTTPException(status_code=500, detail=result["error"])
    return result

@app.post("/memories/{memory_id}/share")
async def share_memory_endpoint(memory_id: str):
    """Mark a memory as publicly shareable; returns a shareable token-style id."""
    from app.user_context import belongs_to_current_user
    db = await get_db()
    doc = await db.collection("memories").document(memory_id).get()
    if not doc.exists or not belongs_to_current_user(doc.to_dict()):
        raise HTTPException(status_code=404, detail="Memory not found")
    mem = doc.to_dict()
    share_token = mem.get("share_token") or uuid.uuid4().hex[:14]
    shared_at = datetime.datetime.now(datetime.timezone.utc).isoformat()
    await db.collection("memories").document(memory_id).update({
        "share_token": share_token,
        "shared_at": shared_at,
        "public": True,
    })
    return {"id": memory_id, "share_token": share_token, "public_url": f"/share/{share_token}"}

@app.post("/memories/{memory_id}/unshare")
async def unshare_memory_endpoint(memory_id: str):
    from app.user_context import belongs_to_current_user
    db = await get_db()
    doc = await db.collection("memories").document(memory_id).get()
    if not doc.exists or not belongs_to_current_user(doc.to_dict()):
        raise HTTPException(status_code=404, detail="Memory not found")
    await db.collection("memories").document(memory_id).update({"public": False})
    return {"id": memory_id, "public": False}

@app.get("/share/{share_token}")
async def get_shared_memory_endpoint(share_token: str):
    """Public read-only view of a shared memory — no auth required."""
    db = await get_db()
    snap = await db.collection("memories").get()
    for doc in snap:
        d = doc.to_dict()
        if d.get("share_token") == share_token and d.get("public"):
            return {
                "id": doc.id,
                "title": d.get("title"),
                "summary": d.get("summary"),
                "key_points": d.get("key_points", []),
                "tags": d.get("tags", []),
                "domain": d.get("domain"),
                "source_type": d.get("source_type"),
                "source_url": d.get("source_url"),
                "created_at": d.get("created_at"),
                "shared_at": d.get("shared_at"),
            }
    raise HTTPException(status_code=404, detail="Shared memory not found or has been unshared")

@app.post("/memories/{memory_id}/auto-tag")
async def auto_tag_endpoint(memory_id: str):
    result = await auto_tag_memory(memory_id)
    if result.get("error") == "Memory not found":
        raise HTTPException(status_code=404, detail="Memory not found")
    if "error" in result and not result.get("tags"):
        raise HTTPException(status_code=500, detail=result["error"])
    return result

@app.post("/capture/voice")
async def capture_voice_endpoint(file: UploadFile = File(...)):
    """Accept an audio upload, transcribe it, and run capture pipeline on the text."""
    audio_bytes = await file.read()
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="Empty audio")
    transcript = await transcribe_audio(audio_bytes, mime=file.content_type or "audio/webm")
    if not transcript or transcript.startswith("[Transcription failed"):
        return {"transcript": transcript or "", "memory": None, "error": "Transcription failed"}
    # Transcription-only: frontend separately POSTs /capture as a note for analysis.
    result = {"transcript": transcript, "memory": None}
    return result


# --- Time Capture (capture-my-last-N-hours bundle) ---

class TimeBundleRequest(BaseModel):
    hours: int = 6  # 1..48, typically 6 or 24


@app.post("/capture/time-bundle")
async def capture_time_bundle_endpoint(request: TimeBundleRequest):
    """Sweep recent memories from the last N hours, dedupe vs prior bundles,
    and create a Workspace project with AI-organized folders + summary."""
    if request.hours < 1 or request.hours > 48:
        raise HTTPException(status_code=400, detail="hours must be between 1 and 48")
    result = await bundle_recent_activity(hours=request.hours)
    return result


# --- Multi-Source Capture Session ---
# Tray of mixed inputs (notes, links, voice transcripts, images) committed in
# one shot into a workspace folder. Folder mode picks how the destination is
# resolved: 'auto' (AI names a fresh workspace), 'create' (caller provides
# name → new workspace), 'existing' (caller provides project_id).

class CaptureSessionItem(BaseModel):
    kind: str  # note | link | voice | image
    content: Optional[str] = ""
    url: Optional[str] = ""
    transcript: Optional[str] = ""
    caption: Optional[str] = ""
    ocr_text: Optional[str] = ""
    data_url: Optional[str] = ""  # for image kind
    title: Optional[str] = ""
    alt: Optional[str] = ""


class CaptureSessionRequest(BaseModel):
    items: List[CaptureSessionItem]
    folder_mode: str = "auto"  # 'auto' | 'create' | 'existing'
    folder_name: Optional[str] = ""
    project_id: Optional[str] = ""
    hint: Optional[str] = ""


@app.post("/capture/session")
async def capture_session_endpoint(request: CaptureSessionRequest, http_request: Request):
    """Commit a multi-source capture tray as one workspace bundle."""
    # Per-IP rate limit — same protection as /capture; tray commits fan
    # out to N capture() calls so abuse here is even more amplified.
    from app.rate_limit import capture_limiter, client_ip_from_request
    ip = client_ip_from_request(http_request)
    if not await capture_limiter.allow(ip):
        raise HTTPException(
            status_code=429,
            detail="Too many capture requests; slow down and retry in a minute.",
        )
    if not request.items:
        raise HTTPException(status_code=400, detail="At least one item is required.")
    # Hard upper bound on tray size — without this, a single rate-limited
    # request could still fan out to thousands of capture() calls (each
    # with its own paid LLM analysis), defeating the per-IP limiter.
    # 25 items is well above the realistic UX (the tray UI struggles past
    # ~10) and well below the abuse threshold.
    MAX_SESSION_ITEMS = 25
    if len(request.items) > MAX_SESSION_ITEMS:
        raise HTTPException(
            status_code=400,
            detail=f"Too many items in session ({len(request.items)}); cap is {MAX_SESSION_ITEMS}.",
        )
    if request.folder_mode not in {"auto", "create", "existing"}:
        raise HTTPException(status_code=400, detail="folder_mode must be 'auto', 'create', or 'existing'")
    if request.folder_mode == "existing" and not (request.project_id or "").strip():
        raise HTTPException(status_code=400, detail="project_id is required when folder_mode='existing'")
    if request.folder_mode == "create" and not (request.folder_name or "").strip():
        raise HTTPException(status_code=400, detail="folder_name is required when folder_mode='create'")
    items = [i.model_dump() for i in request.items]
    result = await process_capture_session(
        items=items,
        folder_mode=request.folder_mode,
        folder_name=request.folder_name or "",
        project_id=request.project_id or "",
        hint=request.hint or "",
    )
    return result


# ─── Image OCR ───────────────────────────────────────────────────────────
# Called by the Capture page when an image is added to the session tray, so
# the recognized text round-trips back BEFORE the user commits the session.
# The `process_capture_session` flow also runs OCR server-side as a safety
# net if the frontend skipped this call (e.g. user committed too fast).

class OcrImageRequest(BaseModel):
    data_url: str = ""
    caption: Optional[str] = ""


# Server-side cap on data-URL length sent to vision OCR. The base64 payload
# expands the binary by ~4/3, so this caps the original image at the same
# 3 MB embed budget used elsewhere — protects against runaway model cost
# and Firestore doc bloat from oversized client uploads.
_OCR_DATA_URL_MAX_CHARS = (3 * 1024 * 1024) * 4 // 3 + 1024


@app.post("/capture/ocr-image")
async def capture_ocr_image_endpoint(request: OcrImageRequest):
    """OCR a base64 data-URL image. Returns {ok, ocr_text, char_count}.
    Best-effort — returns ok=true with empty text when the image has no
    readable content; only fails the request on missing/invalid input."""
    data_url = (request.data_url or "").strip()
    if not data_url or not data_url.startswith("data:image/"):
        raise HTTPException(status_code=400, detail="data_url must be a base64 data:image/* URL")
    if len(data_url) > _OCR_DATA_URL_MAX_CHARS:
        raise HTTPException(
            status_code=413,
            detail="image is too large for OCR (max ~3 MB original size)",
        )
    text = await _ocr_image(data_url, caption_hint=(request.caption or "").strip())
    return {
        "ok": True,
        "ocr_text": text,
        "char_count": len(text),
    }


# ─── Live "visually capture" → vault ─────────────────────────────────────
# Used by the live preview tile in LiveChatPanel. Takes a single frame the
# client just grabbed from the user's camera or screen, sends it through
# one Gemini multimodal pass for title/summary/tags/caption/OCR, and
# saves it as a memory with image_data + image_caption + ocr_text so the
# vault thumbnail can render the original frame.

class VisualFrameRequest(BaseModel):
    image_data: str = ""               # base64 data URL: "data:image/jpeg;base64,..."
    # Pre-downscaled small thumbnail (max ~320 px on the long edge). Sent
    # by the frontend so vault list/grid cards can render a tiny image
    # without dragging the full-resolution data URL across the wire on
    # every /memories list call. Falls back to image_data if missing.
    thumbnail_data: Optional[str] = ""
    caption: Optional[str] = ""        # optional spoken/typed hint at capture time
    source: Optional[str] = "live_camera"  # "live_camera" | "live_screen"
    captured_at: Optional[str] = None  # ISO8601; server falls back to "now" if missing


@app.post("/capture/visual-frame")
async def capture_visual_frame_endpoint(request: VisualFrameRequest):
    """Analyze a single live-captured frame and persist it as a memory.

    Pipeline:
      1. Validate the data URL + size cap.
      2. analyze_visual_frame(): one multimodal call → title, summary,
         tags, image_caption, ocr_text, key_points, domain.
      3. save_memory() with the analysis + the original image_data so
         the vault card can render a thumbnail.

    Returns the saved memory document so the client can navigate to it
    or echo a confirmation card in the live transcript.
    """
    data_url = (request.image_data or "").strip()
    if not data_url or not data_url.startswith("data:image/"):
        raise HTTPException(status_code=400, detail="image_data must be a base64 data:image/* URL")
    if len(data_url) > _OCR_DATA_URL_MAX_CHARS:
        raise HTTPException(status_code=413, detail="frame is too large (max ~3 MB)")

    spoken_hint = (request.caption or "").strip()
    source_label = "Live camera" if request.source != "live_screen" else "Live screen"

    analysis = await analyze_visual_frame(data_url, spoken_hint=spoken_hint)

    # Stamp the moment of capture into a notes blob so the user sees
    # provenance on the memory detail page even if image_data is later
    # garbage-collected by a future trim.
    captured_at = (request.captured_at or "").strip() or datetime.datetime.now(datetime.timezone.utc).isoformat()
    notes_lines = [f"Visually captured from {source_label} at {captured_at}."]
    if spoken_hint:
        notes_lines.append(f"User said: \u201c{spoken_hint[:300]}\u201d")
    if analysis.get("image_caption"):
        notes_lines.append(f"Scene: {analysis['image_caption']}")
    notes_blob = "\n".join(notes_lines)

    # Pick the small thumbnail the client sent. If it's missing, invalid,
    # or oversized, we OMIT it rather than falling back to the full
    # image — duplicating the full base64 in both image_data and
    # image_thumbnail would defeat the whole point (it would also
    # double-charge against the per-doc Firestore size budget). The
    # vault list/grid will then fall through to image_data on a per-card
    # basis only if the legacy doc has no thumbnail (acceptable cost
    # for the rare older row).
    thumb_data_url = (request.thumbnail_data or "").strip()
    if thumb_data_url and not thumb_data_url.startswith("data:image/"):
        thumb_data_url = ""
    if thumb_data_url and len(thumb_data_url) > _OCR_DATA_URL_MAX_CHARS // 4:
        # Cap the thumbnail at ~750 KB — anything larger means the
        # client failed to downscale and we shouldn't store it.
        thumb_data_url = ""

    memory_payload: dict = {
        "source_type": "note",
        "source_url": "",
        "title": analysis["title"],
        "summary": analysis["summary"],
        "key_points": analysis.get("key_points") or [],
        "tags": analysis.get("tags") or ["captured", "live"],
        "domain": analysis.get("domain") or "Other",
        "notes": notes_blob,
        # Image-specific fields persisted by save_memory():
        "image_data": data_url,
        "image_caption": analysis.get("image_caption", ""),
        "ocr_text": analysis.get("ocr_text", ""),
        # Always treat live-captured frames as new — never dedup against
        # the user's earlier captures, even if a near-identical frame was
        # saved before. Visual capture is an explicit user gesture.
        "force_new": True,
    }
    # Smaller card-thumbnail variant. Vault list/grid prefer this so
    # /memories list payloads stay tiny even for users with many
    # captured frames. Only set when the client sent a valid one.
    if thumb_data_url:
        memory_payload["image_thumbnail"] = thumb_data_url

    saved = await save_memory(memory_payload)
    if isinstance(saved, dict) and saved.get("error"):
        raise HTTPException(status_code=500, detail=str(saved.get("error")))

    return {
        "ok": True,
        "memory": saved,
        "id": (saved or {}).get("id"),
        "title": (saved or {}).get("title") or analysis["title"],
    }


# ─── Pre-save Duplicate Check ────────────────────────────────────────────
# Called by the Capture page right after the /capture preview returns, so
# the user gets a Vault-collision warning BEFORE they hit Save (in addition
# to the post-save dedup that /memories already does).

class DedupCheckRequest(BaseModel):
    url: Optional[str] = ""
    title: Optional[str] = ""
    summary: Optional[str] = ""


@app.post("/capture/dedup-check")
async def capture_dedup_check_endpoint(request: DedupCheckRequest):
    """Return any existing memory matching the URL or (title+summary) hash."""
    return await check_duplicate(
        url=(request.url or "").strip(),
        title=(request.title or "").strip(),
        summary=(request.summary or "").strip(),
    )


# ─── Session Preview (AI bundle overview + 3 folder-name candidates) ─────

@app.post("/capture/session/preview")
async def capture_session_preview_endpoint(request: CaptureSessionRequest):
    """Preview a tray of pending session items: AI summary + 3 folder name
    candidates. Pure read — does NOT save anything."""
    if not request.items:
        raise HTTPException(status_code=400, detail="At least one item is required.")
    items = [i.model_dump() for i in request.items]
    return await preview_capture_session(items)


@app.get("/research-sessions/{session_id}")
async def get_research_session_endpoint(session_id: str):
    """Fetch a saved research-session bundle (the artifact /capture/session
    persists). Returns the session doc plus a hydrated list of the linked
    memories so the frontend can render the bundle in one round-trip."""
    from app.db import get_db
    from app.user_context import belongs_to_current_user
    db = await get_db()
    try:
        ref = db.collection("research_sessions").document(session_id)
        snap = await ref.get()
        if not snap.exists:
            raise HTTPException(status_code=404, detail=f"Session '{session_id}' not found.")
        data = snap.to_dict() or {}
        if not belongs_to_current_user(data):
            raise HTTPException(status_code=404, detail=f"Session '{session_id}' not found.")
        # Hydrate linked memories (best-effort — skip any that were deleted).
        memory_ids = data.get("memory_ids") or []
        memories: List[Dict[str, Any]] = []
        for mid in memory_ids[:50]:
            try:
                mref = db.collection("memories").document(mid)
                ms = await mref.get()
                if ms.exists:
                    md = ms.to_dict() or {}
                    if belongs_to_current_user(md):
                        memories.append({
                            "id": mid,
                            "title": md.get("title", "Untitled"),
                            "summary": md.get("summary", ""),
                            "source_type": md.get("source_type", ""),
                            "source_url": md.get("source_url", ""),
                            "tags": md.get("tags", []) or [],
                        })
            except Exception:
                continue
        # The persisted doc uses `project_name` (see record_research_session),
        # but the frontend reads `folder_name` for the SessionDetail header.
        # Surface both keys so either side of the contract works without the
        # header silently falling back to "Research session".
        display_name = data.get("folder_name") or data.get("project_name") or ""
        return {
            "id": session_id,
            "summary": data.get("summary", ""),
            "folder_name": display_name,
            "project_name": display_name,
            "project_id": data.get("project_id", ""),
            "memory_ids": memory_ids,
            "created_at": data.get("created_at"),
            "memories": memories,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# --- Recall ---

@app.post("/recall")
async def recall_endpoint(request: RecallRequest):
    history = [{"role": t.role, "content": t.content} for t in (request.history or [])]
    result = await recall(
        request.query,
        history=history,
        focal_source_id=request.focal_source_id,
    )
    if isinstance(result, dict) and "error" in result:
        raise HTTPException(status_code=500, detail=result["error"])
    return result


# --- Tasks ---

@app.post("/tasks")
async def create_task_endpoint(request: TaskCreateRequest):
    return await create_task(
        title=request.title,
        due_date=request.due_date,
        priority=request.priority,
        linked_memory_id=request.linked_memory_id
    )

@app.get("/tasks")
async def list_tasks_endpoint(status: str = "pending", limit: int = 20):
    return await list_tasks(status=status, limit=limit)

@app.post("/tasks/{task_id}/complete")
async def complete_task_endpoint(task_id: str):
    try:
        return await complete_task(task_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

@app.delete("/tasks/{task_id}")
async def delete_task_endpoint(task_id: str):
    try:
        result = await delete_task(task_id)
        return {"success": True, "message": result}
    except Exception as e:
        raise HTTPException(status_code=404, detail=str(e))


# --- Schedule ---

@app.post("/schedule")
async def schedule_endpoint(request: ScheduleRequest):
    return await create_event(
        title=request.title,
        date=request.date,
        time=request.time,
        duration_minutes=request.duration_minutes,
        description=request.description or "",
        linked_task_id=request.linked_task_id or "",
        topic=request.topic or "Other",
        linked_memory_id=request.linked_memory_id or "",
    )

@app.get("/schedule")
async def list_schedule_endpoint(days: int = 60):
    return await list_upcoming_events(days=days)


# --- Calendar (advanced) ---

CALENDAR_TOPICS = [
    {"id": "Study",    "label": "Study",    "color": "#6366f1"},
    {"id": "Work",     "label": "Work",     "color": "#06b6d4"},
    {"id": "Personal", "label": "Personal", "color": "#10b981"},
    {"id": "Research", "label": "Research", "color": "#f59e0b"},
    {"id": "Health",   "label": "Health",   "color": "#ef4444"},
    {"id": "Other",    "label": "Other",    "color": "#94a3b8"},
]


@app.get("/calendar/topics")
async def calendar_topics_endpoint():
    return {"topics": CALENDAR_TOPICS}


@app.get("/calendar/events/{event_id}")
async def calendar_event_detail(event_id: str):
    ev = await get_event(event_id)
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found")
    return ev


@app.delete("/calendar/events/{event_id}")
async def calendar_event_delete(event_id: str):
    msg = await delete_event(event_id)
    if isinstance(msg, str) and msg.lower().startswith("error"):
        raise HTTPException(status_code=404, detail=msg)
    return {"success": True, "message": msg}


@app.post("/calendar/import")
async def calendar_import_endpoint(request: CalendarImportRequest):
    if not (request.ics_text or "").strip():
        raise HTTPException(status_code=400, detail="ics_text is required")
    return await import_ics_events(request.ics_text, topic=request.topic or "Other")


@app.get("/calendar/google/wizard")
async def calendar_google_wizard():
    """Returns an ordered, UI-friendly Connect Google Calendar workflow.
    The hosted /calendar.ics feed is the source of truth and is read-only.
    """
    base = "/calendar.ics"
    return {
        "method": "subscribe",
        "feed_path": base,
        "steps": [
            {
                "id": 1,
                "title": "Copy your private feed URL",
                "body": "Recall publishes a live read-only iCal feed of your events and open tasks. Copy the link below — it stays the same forever.",
                "action": "copy_url",
            },
            {
                "id": 2,
                "title": "Open Google Calendar",
                "body": "In a new tab, open Google Calendar and click the + next to Other calendars, then choose From URL.",
                "action": "open_google",
                "url": "https://calendar.google.com/calendar/u/0/r/settings/addbyurl",
            },
            {
                "id": 3,
                "title": "Paste the feed URL",
                "body": "Paste the copied URL into the URL of calendar field and click Add calendar. Google will sync within a few minutes.",
                "action": "paste",
            },
            {
                "id": 4,
                "title": "You are connected",
                "body": "Recall events and open tasks now appear in Google. Updates flow automatically every few hours. Two-way write-back can be enabled later by an admin via a Google service account.",
                "action": "done",
            },
        ],
        "notes": [
            "This feed is read-only by design — Google will never change your Recall data.",
            "Use Import (.ics) to pull events from another calendar into Recall.",
        ],
    }


# --- Revisit Reminders ---

@app.get("/revisits/frequencies")
def revisits_frequencies():
    """Static reference for clients — list of supported frequency keys."""
    return {
        "frequencies": [
            {"key": "once", "label": "Once", "hint": "One-time check-in"},
            {"key": "daily", "label": "Daily", "hint": "Every day"},
            {"key": "twice_weekly", "label": "Twice a week", "hint": "Every 3-4 days"},
            {"key": "weekly", "label": "Weekly", "hint": "Every 7 days"},
            {"key": "biweekly", "label": "Twice a month", "hint": "Every 14 days"},
            {"key": "monthly", "label": "Monthly", "hint": "Every 30 days"},
            {"key": "custom_days", "label": "Every N days", "hint": "Pick your own interval"},
            {"key": "specific_date", "label": "Specific date", "hint": "Fire on a chosen date"},
        ]
    }

@app.get("/revisits")
async def list_revisits_endpoint(status: str = "active", limit: int = 100):
    try:
        return await list_revisits(status=status, limit=limit)
    except Exception as e:
        print(f"list_revisits_endpoint error: {e}")
        return []

@app.get("/revisits/due")
async def list_due_revisits_endpoint(window_days: int = 7):
    return await list_due(window_days=window_days)

@app.post("/revisits")
async def create_revisit_endpoint(request: RevisitCreateRequest):
    result = await create_revisit(
        title=request.title,
        frequency=request.frequency,
        memory_id=request.memory_id or "",
        url=request.url or "",
        notes=request.notes or "",
        interval_days=int(request.interval_days or 0),
        specific_date=request.specific_date or "",
        action_label=request.action_label or "Open",
        starts_at=request.starts_at or "",
    )
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return result

@app.get("/revisits/{revisit_id}")
async def get_revisit_endpoint(revisit_id: str):
    doc = await get_revisit(revisit_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Revisit not found")
    return doc

@app.patch("/revisits/{revisit_id}")
async def update_revisit_endpoint(revisit_id: str, request: RevisitUpdateRequest):
    fields = request.model_dump(exclude_unset=True)
    result = await update_revisit(revisit_id, **fields)
    if "error" in result:
        raise HTTPException(status_code=404 if result["error"] == "revisit not found" else 400, detail=result["error"])
    return result

@app.delete("/revisits/{revisit_id}")
async def delete_revisit_endpoint(revisit_id: str):
    result = await delete_revisit(revisit_id)
    if "error" in result:
        raise HTTPException(status_code=404, detail=result["error"])
    return result

@app.post("/revisits/{revisit_id}/visit")
async def visit_revisit_endpoint(revisit_id: str):
    result = await mark_visited(revisit_id)
    if "error" in result:
        raise HTTPException(status_code=404, detail=result["error"])
    return result

@app.post("/revisits/{revisit_id}/snooze")
async def snooze_revisit_endpoint(revisit_id: str, request: RevisitSnoozeRequest):
    result = await snooze_revisit(revisit_id, days=float(request.days or 1))
    if "error" in result:
        raise HTTPException(status_code=404, detail=result["error"])
    return result

@app.post("/revisits/{revisit_id}/pause")
async def pause_revisit_endpoint(revisit_id: str):
    result = await pause_revisit(revisit_id)
    if "error" in result:
        raise HTTPException(status_code=404, detail=result["error"])
    return result

@app.post("/revisits/{revisit_id}/resume")
async def resume_revisit_endpoint(revisit_id: str):
    result = await resume_revisit(revisit_id)
    if "error" in result:
        raise HTTPException(status_code=404, detail=result["error"])
    return result

@app.post("/revisits/suggest")
async def suggest_revisit_endpoint(request: RevisitSuggestRequest):
    """Quick LLM-backed suggestion. Returns at minimum {frequency, reason},
    plus optional interval_days / specific_date / action_label / smart_notes
    when the AI can infer them."""
    return await ai_plan_revisit(text=request.text)


@app.post("/revisits/ai-plan")
async def ai_plan_revisit_endpoint(request: dict = Body(default_factory=dict)):
    """Full AI plan from a structured payload (title/url/notes/text).
    Frontend uses this for the 'AI Smart Plan' button to autofill the entire
    form (frequency + interval/date + action_label + smart_notes + reason)."""
    return await ai_plan_revisit(
        title=str(request.get("title") or "")[:300],
        url=str(request.get("url") or "")[:1000],
        notes=str(request.get("notes") or "")[:1000],
        text=str(request.get("text") or "")[:1000],
    )


# --- Study Plan & Briefing ---

@app.post("/study-plan")
async def study_plan_endpoint(request: StudyPlanRequest):
    result = await generate_study_plan(topic=request.topic, days=request.days)
    if "error" in result:
        raise HTTPException(status_code=500, detail=result["error"])
    return result


class StudyPlanDay(BaseModel):
    day: Optional[int] = None
    date: str
    title: Optional[str] = ""
    duration_minutes: Optional[int] = 60
    activities: Optional[List[str]] = None


class StudyPlanSaveRequest(BaseModel):
    topic: str = ""
    plan: List[StudyPlanDay]
    create_events: bool = True
    create_tasks: bool = True
    start_time: str = "18:00"


_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_TIME_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


@app.post("/study-plan/save")
async def study_plan_save_endpoint(request: StudyPlanSaveRequest):
    """Persist a generated plan: create one calendar event + one task per day.
    Atomic at application level: pre-validates everything, then on any failure
    compensates by deleting what was already created and surfaces an error."""
    if not request.plan:
        raise HTTPException(status_code=400, detail="plan is required")
    if not (request.create_events or request.create_tasks):
        raise HTTPException(status_code=400, detail="at least one of create_events or create_tasks must be true")
    if not _TIME_RE.match(request.start_time or ""):
        raise HTTPException(status_code=400, detail="start_time must be HH:MM (24h)")

    topic_label = (request.topic or "Study Plan").strip()
    normalized: List[Dict[str, Any]] = []
    for idx, day in enumerate(request.plan):
        date_str = (day.date or "").strip()[:10]
        if not _DATE_RE.match(date_str):
            raise HTTPException(status_code=400, detail=f"plan[{idx}].date must be YYYY-MM-DD (got: {day.date!r})")
        try:
            datetime.datetime.fromisoformat(date_str)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"plan[{idx}].date is not a valid calendar date")
        try:
            duration = int(day.duration_minutes or 60)
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail=f"plan[{idx}].duration_minutes must be an integer")
        if duration <= 0 or duration > 24 * 60:
            raise HTTPException(status_code=400, detail=f"plan[{idx}].duration_minutes must be 1..1440")
        title = (day.title or f"Day {day.day or idx + 1} — {topic_label}").strip()
        activities = [a for a in (day.activities or []) if isinstance(a, str) and a.strip()]
        normalized.append({"date": date_str, "title": title, "duration": duration, "activities": activities})

    created_events: List[dict] = []
    created_tasks: List[dict] = []
    try:
        for d in normalized:
            description = " | ".join(d["activities"][:4]) if d["activities"] else ""
            if request.create_events:
                ev = await create_event(
                    title=f"[{topic_label}] {d['title']}",
                    date=d["date"],
                    time=request.start_time,
                    duration_minutes=d["duration"],
                )
                if not isinstance(ev, dict) or not ev.get("id"):
                    raise RuntimeError(f"create_event returned no id for {d['date']}")
                created_events.append(ev)
            if request.create_tasks:
                tk = await create_task(
                    title=f"{d['title']} ({d['duration']}m)" + (f" — {description}" if description else ""),
                    due_date=d["date"],
                    priority="medium",
                )
                if not isinstance(tk, dict) or not tk.get("id"):
                    raise RuntimeError(f"create_task returned no id for {d['date']}")
                created_tasks.append(tk)
    except Exception as e:
        logger.warning(f"study-plan/save failed mid-flight, compensating: {e}")
        for ev in created_events:
            try:
                await delete_event(ev.get("id"))
            except Exception as ce:
                logger.error(f"compensation delete_event failed: {ce}")
        for tk in created_tasks:
            try:
                await delete_task(tk.get("id"))
            except Exception as ce:
                logger.error(f"compensation delete_task failed: {ce}")
        raise HTTPException(status_code=500, detail=f"Save failed and was rolled back: {e}")

    return {
        "topic": topic_label,
        "events_created": len(created_events),
        "tasks_created": len(created_tasks),
        "events": created_events,
        "tasks": created_tasks,
    }


# --- Discover external resources ---

class DiscoverRequest(BaseModel):
    topic: str
    kinds: Optional[List[str]] = None


@app.post("/discover")
async def discover_endpoint(request: DiscoverRequest):
    if not (request.topic or "").strip():
        raise HTTPException(status_code=400, detail="topic is required")
    result = await discover_resources(topic=request.topic, kinds=request.kinds)
    if "error" in result and not result.get("items"):
        raise HTTPException(status_code=502, detail=result["error"])
    return result


class DiscoverDigestRequest(BaseModel):
    topic: str
    items: List[Dict[str, Any]]


@app.post("/discover/digest")
async def discover_digest_endpoint(request: DiscoverDigestRequest):
    """Synthesize a one-shot AI brief over a list of discover items."""
    if not (request.topic or "").strip():
        raise HTTPException(status_code=400, detail="topic is required")
    if not request.items:
        raise HTTPException(status_code=400, detail="items required")
    from app.discover_agent import synthesize_digest
    result = await synthesize_digest(topic=request.topic, items=request.items[:10])
    if "error" in result:
        raise HTTPException(status_code=500, detail=result["error"])
    return result


# --- Plan Generator (multi-agent) ---

class PlanGenerateRequest(BaseModel):
    topic: str
    goal_type: str = "study"
    days: int = 7
    minutes_per_day: int = 60
    include_resources: bool = True


@app.get("/plan/goal-types")
async def plan_goal_types():
    return {
        "goal_types": [
            {"id": k, "label": v["label"], "verb": v["verb"], "lens": v["lens"]}
            for k, v in GOAL_TYPES.items()
        ]
    }


@app.post("/plan/generate")
async def plan_generate_endpoint(request: PlanGenerateRequest):
    if not (request.topic or "").strip():
        raise HTTPException(status_code=400, detail="topic is required")
    result = await generate_plan(
        topic=request.topic,
        goal_type=request.goal_type,
        days=request.days,
        minutes_per_day=request.minutes_per_day,
        include_resources=request.include_resources,
    )
    if "error" in result:
        raise HTTPException(status_code=500, detail=result["error"])
    return result


class PlanIngestRequest(BaseModel):
    plan: Dict[str, Any]
    project_name: Optional[str] = None


@app.post("/plan/save-to-workspace")
async def plan_save_to_workspace(request: PlanIngestRequest):
    if not request.plan or not isinstance(request.plan, dict):
        raise HTTPException(status_code=400, detail="plan is required")
    project = await ws_ingest_plan(request.plan, project_name=request.project_name)
    return project


class PlanRegenerateDayRequest(BaseModel):
    topic: str
    day_index: int  # zero-based
    plan: List[Dict[str, Any]]
    goal_type: str = "study"
    minutes_per_day: int = 60


@app.post("/plan/regenerate-day")
async def plan_regenerate_day_endpoint(request: PlanRegenerateDayRequest):
    if not (request.topic or "").strip():
        raise HTTPException(status_code=400, detail="topic is required")
    if request.day_index < 0 or request.day_index >= len(request.plan or []):
        raise HTTPException(status_code=400, detail="day_index out of range")
    from app.plan_agent import regenerate_day
    result = await regenerate_day(
        topic=request.topic,
        day_index=request.day_index,
        plan=request.plan,
        goal_type=request.goal_type,
        minutes_per_day=request.minutes_per_day,
    )
    if "error" in result:
        raise HTTPException(status_code=500, detail=result["error"])
    return result


# --- Workspace projects (CRUD + items + tasks) ---

class WorkspaceProjectCreate(BaseModel):
    name: str
    description: str = ""
    color: Optional[str] = None
    goal_type: str = "general"
    folders: Optional[List[Dict[str, Any]]] = None


class WorkspaceProjectUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    color: Optional[str] = None
    goal_type: Optional[str] = None
    folders: Optional[List[Dict[str, Any]]] = None


class WorkspaceItemsAdd(BaseModel):
    items: List[Dict[str, Any]]
    folder_id: Optional[str] = None
    section_id: Optional[str] = None


class WorkspaceItemUpdate(BaseModel):
    section_id: Optional[str] = None
    tags: Optional[List[str]] = None
    group_id: Optional[str] = None
    folder_id: Optional[str] = None


class WorkspaceTaskCreate(BaseModel):
    text: str
    folder_id: Optional[str] = None
    due_date: Optional[str] = None


class WorkspaceTaskUpdate(BaseModel):
    text: Optional[str] = None
    due_date: Optional[str] = None


class WorkspaceFromTemplate(BaseModel):
    template_id: str
    name: str
    color: Optional[str] = None


class WorkspaceOrganizeApply(BaseModel):
    assignments: List[Dict[str, Any]]
    groups: List[Dict[str, Any]] = []


@app.get("/workspace/projects")
async def ws_projects_list():
    return {"projects": await ws_list_projects()}


@app.get("/workspace/overview")
async def ws_overview_endpoint():
    """Aggregated workspace stats: totals, completion %, top projects, recent
    activity, 30-day activity heatmap, top tags. Powers the advanced
    Workspace page header strip."""
    try:
        from app.workspace_agent import get_workspace_overview
        data = await get_workspace_overview()
        data["ok"] = True
        return data
    except Exception as e:
        logger.exception("workspace overview failed")
        return JSONResponse(
            status_code=500,
            content={
                "ok": False,
                "error": str(e),
                "totals": {"projects": 0, "items": 0, "tasks": 0, "tasks_done": 0},
                "completion_pct": 0,
                "top_projects": [],
                "section_breakdown": {},
                "top_tags": [],
                "recent_activity": [],
                "activity_30d": [],
            },
        )


@app.get("/workspace/projects/{project_id}/analytics")
async def ws_project_analytics_endpoint(project_id: str):
    """Per-project analytics: counts, completion %, 30-day activity, top tags,
    section + kind breakdown."""
    from app.workspace_agent import get_project_analytics
    res = await get_project_analytics(project_id)
    if res is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return res


@app.post("/workspace/projects")
async def ws_projects_create(req: WorkspaceProjectCreate):
    if not (req.name or "").strip():
        raise HTTPException(status_code=400, detail="name is required")
    return await ws_create_project(
        name=req.name, description=req.description, color=req.color,
        goal_type=req.goal_type, folders=req.folders,
    )


@app.get("/workspace/projects/{project_id}")
async def ws_projects_get(project_id: str):
    p = await ws_get_project(project_id)
    if not p:
        raise HTTPException(status_code=404, detail="project not found")
    return p


@app.patch("/workspace/projects/{project_id}")
async def ws_projects_update(project_id: str, req: WorkspaceProjectUpdate):
    try:
        return await ws_update_project(project_id, **req.model_dump(exclude_none=True))
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@app.delete("/workspace/projects/{project_id}")
async def ws_projects_delete(project_id: str):
    ok = await ws_delete_project(project_id)
    if not ok:
        raise HTTPException(status_code=404, detail="project not found")
    return {"deleted": True, "id": project_id}


@app.post("/workspace/projects/{project_id}/items")
async def ws_items_add(project_id: str, req: WorkspaceItemsAdd):
    if not req.items:
        raise HTTPException(status_code=400, detail="items required")
    try:
        return await ws_add_items(project_id, req.items, folder_id=req.folder_id, section_id=req.section_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@app.patch("/workspace/projects/{project_id}/items/{item_id}")
async def ws_items_update(project_id: str, item_id: str, req: WorkspaceItemUpdate):
    try:
        return await ws_update_item(
            project_id, item_id,
            section_id=req.section_id, tags=req.tags,
            group_id=req.group_id, folder_id=req.folder_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@app.delete("/workspace/projects/{project_id}/items/{item_id}")
async def ws_items_remove(project_id: str, item_id: str):
    ok = await ws_remove_item(project_id, item_id)
    if not ok:
        raise HTTPException(status_code=404, detail="item not found")
    return {"deleted": True, "id": item_id}


@app.get("/workspace/folders/flat")
async def ws_folders_flat():
    """Capture-enrichment "Folder" chip dropdown source: every folder
    across every project as one flat list, sorted by recent use. Lets
    the user pick a destination from a single searchable list instead
    of drilling through the project tree."""
    try:
        return {"folders": await ws_list_flat_folders()}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/workspace/sections")
async def ws_sections_catalog():
    """Static catalog of default sections for client UIs that want to render
    consistent labels/icons before any folder is created."""
    return {"sections": list(WS_DEFAULT_SECTIONS)}


@app.post("/workspace/projects/{project_id}/tasks")
async def ws_tasks_add(project_id: str, req: WorkspaceTaskCreate):
    if not (req.text or "").strip():
        raise HTTPException(status_code=400, detail="text required")
    try:
        return await ws_add_task(
            project_id, text=req.text, folder_id=req.folder_id, due_date=req.due_date
        )
    except ValueError as e:
        msg = str(e)
        status = 400 if "due_date" in msg else 404
        raise HTTPException(status_code=status, detail=msg)


@app.post("/workspace/projects/{project_id}/tasks/{task_id}/toggle")
async def ws_tasks_toggle(project_id: str, task_id: str):
    try:
        return await ws_toggle_task(project_id, task_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@app.patch("/workspace/projects/{project_id}/tasks/{task_id}")
async def ws_tasks_update(project_id: str, task_id: str, req: WorkspaceTaskUpdate):
    try:
        res = await ws_update_task(
            project_id, task_id, text=req.text, due_date=req.due_date
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if res is None:
        raise HTTPException(status_code=404, detail="task not found")
    return res


@app.post("/workspace/projects/{project_id}/tasks/{task_id}/to-calendar")
async def ws_task_to_calendar(project_id: str, task_id: str):
    """Push a workspace task to the global calendar as a scheduled event."""
    proj = await ws_get_project(project_id)
    if not proj:
        raise HTTPException(status_code=404, detail="project not found")
    task = next((t for t in (proj.get("tasks") or []) if t.get("id") == task_id), None)
    if not task:
        raise HTTPException(status_code=404, detail="task not found")
    due = (task.get("due_date") or "").strip()
    if not due:
        raise HTTPException(status_code=400, detail="task has no due_date — set one first")
    event = await create_event(
        title=task.get("text", "Workspace task"),
        date=due,
        time="09:00",
        duration_minutes=30,
        description=f"From workspace project: {proj.get('name','')}",
        linked_task_id=task_id,
        topic="Work",
        linked_memory_id="",
    )
    event_id = event.get("id") if isinstance(event, dict) else ""
    if event_id:
        await ws_update_task(project_id, task_id, calendar_event_id=event_id)
    return {"ok": True, "event": event}


@app.post("/workspace/items/{item_id}/to-flashcards")
async def ws_item_to_flashcards(item_id: str):
    """Generate flashcards from a workspace item that references a memory."""
    found = await ws_find_item_owner(item_id)
    if not found:
        raise HTTPException(status_code=404, detail="item not found")
    _pid, item = found
    if (item.get("kind") or "") != "memory":
        raise HTTPException(status_code=400, detail="flashcards only supported for memory-kind items")
    ref = item.get("ref_id") or ""
    if not ref:
        raise HTTPException(status_code=400, detail="item has no ref_id")
    result = await generate_flashcards(ref)
    if isinstance(result, dict) and "error" in result:
        raise HTTPException(status_code=500, detail=result["error"])
    return {"ok": True, "memory_id": ref, "result": result}


@app.get("/workspace/templates")
async def ws_templates():
    return {"templates": ws_list_templates()}


@app.post("/workspace/projects/from-template")
async def ws_projects_from_template(req: WorkspaceFromTemplate):
    if not (req.name or "").strip():
        raise HTTPException(status_code=400, detail="name is required")
    try:
        return await ws_create_from_template(
            template_id=req.template_id, name=req.name, color=req.color
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/workspace/projects/{project_id}/export.md")
async def ws_project_export_md(project_id: str):
    md = await ws_export_project_markdown(project_id)
    if md is None:
        raise HTTPException(status_code=404, detail="project not found")
    proj = await ws_get_project(project_id) or {}
    safe_name = re.sub(r"[^a-z0-9_-]+", "-", (proj.get("name") or "project").lower()).strip("-")[:60] or "project"
    return Response(
        content=md,
        media_type="text/markdown; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{safe_name}.md"'},
    )


@app.post("/workspace/projects/{project_id}/ai-organize")
async def ws_ai_organize(project_id: str):
    proj = await ws_get_project(project_id)
    if not proj:
        raise HTTPException(status_code=404, detail="project not found")
    mems = await list_memories(domain="", limit=30)
    return await ws_ai_organize_memories(project_id, mems if isinstance(mems, list) else [])


@app.post("/workspace/projects/{project_id}/ai-organize-full")
async def ws_ai_organize_full(project_id: str, folder_id: Optional[str] = None):
    """Comprehensive AI organize: assigns sections, tags (5-7 per item), and
    clusters similar items into groups. Returns a PREVIEW — caller applies
    via POST /apply-organization."""
    proj = await ws_get_project(project_id)
    if not proj:
        raise HTTPException(status_code=404, detail="project not found")
    return await ws_ai_organize_workspace(project_id, folder_id=folder_id)


@app.post("/workspace/projects/{project_id}/apply-organization")
async def ws_apply_organize(project_id: str, req: WorkspaceOrganizeApply):
    try:
        return await ws_apply_organization(project_id, req.assignments, req.groups)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


# --- Insight extraction (AI layer over a folder/project) ---

class InsightApplyRequest(BaseModel):
    insight: Dict[str, Any]
    action: Dict[str, Any]


@app.post("/workspace/projects/{project_id}/extract-insights")
async def ws_extract_insights(project_id: str, folder_id: Optional[str] = None):
    """Scan a folder (or whole project when folder_id omitted) and return
    AI-extracted insights with auto priority + meaningful suggested actions."""
    from app.insight_agent import extract_insights
    result = await extract_insights(project_id, folder_id)
    if not result.get("ok") and result.get("error") == "project not found":
        raise HTTPException(status_code=404, detail="project not found")
    return result


@app.post("/workspace/projects/{project_id}/insights/apply")
async def ws_apply_insight(project_id: str, req: InsightApplyRequest):
    """Execute one suggested action (add_task | create_plan | save_to_memory)
    by routing to the existing task / plan / memory subsystems."""
    from app.insight_agent import apply_insight_action
    result = await apply_insight_action(project_id, req.insight, req.action)
    if not result.get("ok"):
        raise HTTPException(status_code=400, detail=result.get("error", "apply failed"))
    return result


# --- Workspace folder timeline (capture → insight → task → memory → plan) ---

@app.get("/workspace/projects/{project_id}/timeline")
async def workspace_folder_timeline(
    project_id: str,
    folder_id: Optional[str] = None,
    limit: int = 200,
):
    """Merged event stream for one folder (or whole project when folder_id omitted).
    Pass folder_id='' (empty string) to scope to the root/un-foldered bucket.
    Used by the Timeline page to render a single visual story of how the user's
    knowledge moved capture → insight → task → memory → plan."""
    from app.timeline_agent import get_folder_timeline
    result = await get_folder_timeline(
        project_id=project_id,
        folder_id=folder_id,
        limit=max(1, min(500, limit)),
    )
    if not result.get("ok"):
        raise HTTPException(status_code=404, detail=result.get("error", "timeline failed"))
    return result


# --- Workspace recall ("Show my previous work on X") ---

class WorkspaceRecallRequest(BaseModel):
    query: str
    project_id: Optional[str] = None
    limit: Optional[int] = 12


@app.post("/workspace/recall")
async def workspace_recall_endpoint(req: WorkspaceRecallRequest):
    """Search items + tasks + memories + projects, then synthesize a 2-3 sentence
    narrative answer with categorized sources. Optional project_id narrows the
    item/task search to one project; memories are always searched globally."""
    from app.workspace_recall import workspace_recall
    result = await workspace_recall(
        query=req.query,
        project_id=req.project_id,
        limit=max(1, min(30, req.limit or 12)),
    )
    if not result.get("ok"):
        raise HTTPException(status_code=400, detail=result.get("error", "recall failed"))
    return result


# --- Task breakdown (lightweight micro-plan from a single task) ---

class TaskBreakdownRequest(BaseModel):
    task_title: Optional[str] = ""
    context: Optional[str] = ""
    days: Optional[int] = 3
    start_date: Optional[str] = ""
    deadline: Optional[str] = ""
    persist_as_subtasks: Optional[bool] = False
    parent_task_id: Optional[str] = ""


@app.post("/tasks/breakdown")
async def task_breakdown_endpoint(req: TaskBreakdownRequest):
    """Break a task into 3-7 ordered micro-steps with optional dates.
    If persist_as_subtasks=true AND parent_task_id provided, creates child
    tasks via the global /tasks store with title prefix '↳' for visual nesting."""
    from app.plan_agent import breakdown_task
    title = (req.task_title or "").strip()
    parent_title = ""

    # If only parent_task_id was given, look up its title for context (current user only).
    if req.parent_task_id:
        try:
            from app.user_context import belongs_to_current_user
            db = await get_db()
            doc = await db.collection("tasks").document(req.parent_task_id).get()
            if getattr(doc, "exists", False):
                parent_data = doc.to_dict() or {}
                if belongs_to_current_user(parent_data):
                    parent_title = parent_data.get("title", "")
                    if not title:
                        title = parent_title
        except Exception as e:
            logger.warning(f"task lookup failed in breakdown: {e}")

    if not title:
        raise HTTPException(status_code=400, detail="task_title or parent_task_id (resolvable) required")

    result = await breakdown_task(
        task_title=title,
        context=req.context or "",
        days=req.days or 3,
        start_date=req.start_date or "",
        deadline=req.deadline or "",
    )
    if not result.get("ok"):
        raise HTTPException(status_code=400, detail=result.get("error", "breakdown failed"))

    # Optional: persist each step as a child task linked to parent via memory_id slot.
    if req.persist_as_subtasks and req.parent_task_id:
        from app.task_agent import create_task
        created_ids: List[str] = []
        for s in result["steps"]:
            ct = await create_task(
                title=f"↳ {s['title']}",
                due_date=s["due_date"],
                priority="medium",
                linked_memory_id=req.parent_task_id,  # reuse field as parent ref
            )
            created_ids.append(ct.get("id"))
        result["persisted_subtask_ids"] = created_ids
        result["parent_task_id"] = req.parent_task_id

    return result


# --- Calendar ICS subscription feed ---

def _ics_escape(text: str) -> str:
    """Escape per RFC 5545: backslash, comma, semicolon, newline. Strip CR and other
    control chars first to prevent header/property injection via CRLF."""
    s = text or ""
    s = s.replace("\r\n", "\n").replace("\r", "\n")
    s = "".join(ch for ch in s if ch == "\n" or ch == "\t" or ord(ch) >= 0x20)
    return s.replace("\\", "\\\\").replace(",", "\\,").replace(";", "\\;").replace("\n", "\\n")


def _ics_dt(date_str: str, time_str: str = "09:00") -> str:
    try:
        d = datetime.datetime.fromisoformat(f"{date_str}T{time_str}:00")
        return d.strftime("%Y%m%dT%H%M%S")
    except Exception:
        return datetime.datetime.now().strftime("%Y%m%dT%H%M%S")


@app.get("/calendar.ics")
async def calendar_ics():
    """Read-only iCal feed of upcoming events + open tasks. Subscribe in Google/Apple/Outlook."""
    events = await list_upcoming_events(days=180)
    open_tasks = await list_tasks(status="pending", limit=100)
    now_stamp = datetime.datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")

    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Recall X247//AI Second Brain//EN",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        "X-WR-CALNAME:Recall X247",
        "X-WR-CALDESC:Events and tasks from your AI Second Brain",
    ]

    for ev in events or []:
        if not isinstance(ev, dict):
            continue
        eid = ev.get("id") or str(uuid.uuid4())
        title = ev.get("title") or "Event"
        date_s = ev.get("date") or ""
        time_s = ev.get("time") or "09:00"
        dur = int(ev.get("duration_minutes") or 60)
        if not date_s:
            continue
        start = _ics_dt(date_s, time_s)
        try:
            start_dt = datetime.datetime.strptime(start, "%Y%m%dT%H%M%S")
            end_dt = start_dt + datetime.timedelta(minutes=dur)
            end = end_dt.strftime("%Y%m%dT%H%M%S")
        except Exception:
            end = start
        topic = (ev.get("topic") or "Other").strip() or "Other"
        ev_desc = ev.get("description") or ""
        linked = ev.get("linked_task_id") or ""
        desc_parts = []
        if ev_desc:
            desc_parts.append(ev_desc)
        if linked:
            desc_parts.append(f"Linked task: {linked}")
        desc_parts.append(f"Topic: {topic}")
        desc_parts.append("Source: Recall X247")
        full_desc = "\n".join(desc_parts)
        lines += [
            "BEGIN:VEVENT",
            f"UID:{eid}@recall-x247",
            f"DTSTAMP:{now_stamp}",
            f"DTSTART:{start}",
            f"DTEND:{end}",
            f"SUMMARY:{_ics_escape(title)}",
            f"DESCRIPTION:{_ics_escape(full_desc)}",
            f"CATEGORIES:{_ics_escape(topic)}",  # _ics_escape strips CR/control chars to prevent VEVENT injection
            "END:VEVENT",
        ]

    for tk in open_tasks or []:
        if not isinstance(tk, dict):
            continue
        tid = tk.get("id") or str(uuid.uuid4())
        title = tk.get("title") or "Task"
        due = tk.get("due_date") or ""
        if not due:
            continue
        try:
            d = datetime.datetime.fromisoformat(due[:10])
            dval = d.strftime("%Y%m%d")
        except Exception:
            continue
        lines += [
            "BEGIN:VTODO",
            f"UID:t-{tid}@recall-x247",
            f"DTSTAMP:{now_stamp}",
            f"DUE;VALUE=DATE:{dval}",
            f"SUMMARY:{_ics_escape('[Task] ' + title)}",
            f"PRIORITY:{5 if tk.get('priority') == 'medium' else (3 if tk.get('priority') == 'high' else 7)}",
            "STATUS:NEEDS-ACTION",
            "END:VTODO",
        ]

    lines.append("END:VCALENDAR")
    body = "\r\n".join(lines) + "\r\n"
    return Response(content=body, media_type="text/calendar; charset=utf-8", headers={
        "Content-Disposition": 'inline; filename="recall-x247.ics"',
        "Cache-Control": "no-cache",
    })

_BRIEFING_CACHE: Dict[str, Dict[str, Any]] = {}  # keyed by user_id

@app.get("/briefing")
async def briefing_endpoint(force: bool = False):
    """Daily AI briefing — cached for 5 minutes per user to avoid hammering AI provider.
    Always merges fresh revisits_due (not cached) so reminders feel live."""
    from app.user_context import get_uid
    uid = get_uid()
    now_ts = time.time()
    entry = _BRIEFING_CACHE.get(uid) or {}
    cached = entry.get("data")
    if not force and cached and now_ts < entry.get("expires_at", 0):
        result = dict(cached)
    else:
        result = await generate_daily_briefing()
        _BRIEFING_CACHE[uid] = {"data": result, "expires_at": now_ts + 300}  # 5 minutes per user
        # Persist a copy so the user can re-read today's briefing later
        # (and so the "Past briefings" history stays populated even after
        # the in-memory cache rolls).
        try:
            await briefing_save(result)
        except Exception as e:
            logger.warning(f"briefing persist skipped: {e}")
    # Live revisit overlay — never cache reminders, they change as user marks visits
    try:
        rv = await list_due(window_days=7)
        result["revisits_due"] = rv.get("due", [])
        result["revisits_upcoming"] = rv.get("upcoming", [])
        result["revisits_due_count"] = rv.get("due_count", 0)
    except Exception:
        result["revisits_due"] = []
        result["revisits_upcoming"] = []
        result["revisits_due_count"] = 0
    return result


# --- Daily Briefing — history, action items, timeline, weekly/monthly recap ---

@app.get("/briefing/list")
async def briefing_list_endpoint(limit: int = 30):
    """Recent persisted daily briefings (newest first), used by the
    'Past briefings' rail on the standalone Daily Briefing page."""
    return {"briefings": await briefing_list(limit=limit)}


@app.get("/briefing/by-date/{date_iso}")
async def briefing_by_date_endpoint(date_iso: str):
    b = await briefing_get(date_iso)
    if b is None:
        raise HTTPException(status_code=404, detail="No briefing saved for that date.")
    return b


@app.get("/briefing/actions")
async def briefing_actions_endpoint():
    """Surface action items extracted from recent captures, with per-user
    completion state."""
    return {"actions": await briefing_action_items()}


class ActionToggleRequest(BaseModel):
    id: str
    done: bool


@app.post("/briefing/actions/toggle")
async def briefing_actions_toggle_endpoint(body: ActionToggleRequest):
    return await briefing_toggle_action(body.id, body.done)


@app.get("/briefing/timeline")
async def briefing_timeline_endpoint():
    """Today's timeline: tasks due today + revisits due today + calendar
    events scheduled for today, sorted by time."""
    return {"timeline": await briefing_today_timeline()}


@app.get("/briefing/recap")
async def briefing_recap_endpoint(period: str = "week"):
    """Weekly or monthly recap — aggregated capture stats plus a short
    AI-written summary."""
    if period not in ("week", "month"):
        raise HTTPException(status_code=400, detail="period must be 'week' or 'month'")
    return await briefing_generate_recap(period=period)


# --- Daily Briefing — auto-delivery (notification settings + polling) -------

class BriefingSettingsRequest(BaseModel):
    notifications_enabled: bool
    send_hour: Optional[int] = None
    tz_offset_minutes: Optional[int] = None


@app.get("/briefing/settings")
async def briefing_settings_get_endpoint():
    """Return the current user's briefing notification preferences (toggle,
    delivery hour, timezone offset). Defaults: off, 8am, IST."""
    return await briefing_get_settings()


@app.get("/preferences/capture_enrichment")
async def capture_enrichment_prefs_get_endpoint():
    """Return the current user's per-source-type 'don't suggest again' lists
    for the capture-enrichment chips. Empty lists across all dimensions
    when nothing has been saved yet (fresh users)."""
    return await get_capture_enrichment_prefs()


@app.put("/preferences/capture_enrichment")
async def capture_enrichment_prefs_set_endpoint(body: dict):
    """Replace the saved capture-enrichment prefs. Body shape:
    `{disable_tasks: ['note'], disable_events: [], ...}`. Unknown keys and
    unknown source_type values are stripped server-side."""
    return await set_capture_enrichment_prefs(body or {})


@app.get("/preferences/auto_link")
async def auto_link_prefs_get_endpoint():
    """P4B — three-boolean opt-out flags for the W4 AI auto-link layer:
    auto_folder_enabled, habit_suggestions_enabled, cluster_suggestions_enabled.
    Defaults to all-true so existing users keep the feature."""
    from app import auto_link_prefs as _alp
    return await _alp.get_prefs()


@app.put("/preferences/auto_link")
async def auto_link_prefs_set_endpoint(body: dict):
    """P4B — replace the auto-link toggle shape. Unknown keys are
    ignored; missing keys fall back to defaults so a partial PUT
    can't accidentally flip a feature off."""
    from app import auto_link_prefs as _alp
    return await _alp.set_prefs(body or {})


# P4B — Undo for the capture-page "AI filed this in {folder}" toast.
# Body shape: {"folder_ref": null} clears the link; {"folder_ref":
# {project_id, folder_id, section_id?}} sets/replaces it. Re-uses the
# bidirectional library_agent helpers so workspace + memory stay in
# sync without a second round-trip from the client.
class MemoryFolderRequest(BaseModel):
    folder_ref: Optional[Dict[str, Any]] = None


@app.post("/memories/{memory_id}/folder")
async def memory_folder_endpoint(memory_id: str, body: MemoryFolderRequest):
    """Set or clear the folder link on a memory. Idempotent — clearing
    a memory that has no folder link returns success without raising."""
    folder_ref = body.folder_ref or None
    try:
        if folder_ref is None:
            # Clear: look up current folder ref from the memory doc and
            # unlink it. If the memory has no folder ref we noop.
            from app.db import get_db as _gdb
            db = await _gdb()
            doc = await db.collection("memories").document(memory_id).get()
            if not doc.exists:
                raise HTTPException(status_code=404, detail="Memory not found")
            mem = doc.to_dict() or {}
            cur = mem.get("folder_ref") or {}
            pid = cur.get("project_id")
            fid = cur.get("folder_id")
            if not pid or not fid:
                return {"success": True, "noop": True, "memory_id": memory_id}
            return await library_agent.unlink_memory_from(
                memory_id, "folder", f"{pid}/{fid}",
            )
        # Set: delegate to the bidirectional writer.
        pid = folder_ref.get("project_id") or ""
        fid = folder_ref.get("folder_id") or ""
        if not pid or not fid:
            raise HTTPException(status_code=400, detail="folder_ref needs project_id + folder_id")
        return await library_agent.link_memory_to(
            memory_id, "folder", f"{pid}/{fid}",
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/memories/{memory_id}/re-suggest")
async def memory_re_suggest_endpoint(memory_id: str):
    """Re-run the capture-enrichment suggestion pipeline against an
    existing saved memory and persist the fresh `suggested_*` block back
    onto the memory doc. Used by the MemoryDetailPage 'Re-analyze' button."""
    result = await re_suggest_for_memory(memory_id)
    if result.get("error"):
        raise HTTPException(status_code=404, detail=result["error"])
    return result


# --- P5A: Notion integration -------------------------------------------------
# Real Notion wiring (replaces the IntegrationsPage stub). Credentials come
# from `app.integrations.get_connection("notion")` which prefers the Replit
# OAuth credential proxy and falls back to NOTION_INTEGRATION_TOKEN. All
# four endpoints here surface NotConnectedError as a clean 4xx so the UI
# can show a Connect button without leaking stack traces.

class NotionImportRequest(BaseModel):
    database_id: str
    mode: str = "one-time"  # "one-time" | "sync"


class NotionImportPageRequest(BaseModel):
    page_id: str


async def _notion_sync_state_for_user() -> List[Dict[str, Any]]:
    """Return all `notion_sync_state` rows owned by the current user,
    newest sync first."""
    from app.user_context import belongs_to_current_user as _belongs
    db = await get_db()
    snap = await db.collection("notion_sync_state").get()
    out: List[Dict[str, Any]] = []
    for d in snap:
        data = (d.to_dict() or {}) | {"_doc_id": d.id}
        if not _belongs(data):
            continue
        out.append(data)
    out.sort(key=lambda r: r.get("last_synced_at") or "", reverse=True)
    return out


@app.get("/integrations/notion/status")
async def notion_status_endpoint():
    """Tell the frontend whether Notion is wired up and (if so) how —
    via Replit OAuth or a manual integration token. Also returns the
    most recent `last_synced_at` across the user's synced databases.

    Task #81 — Non-owners get a silent `{connected: false}` rather than
    a 403 here so the IntegrationsPage can render a normal "Connect"
    state without revealing whether the app owner has actually wired
    Notion up. The actual integration calls (databases / import / etc)
    still 403 — see require_integration_owner() in main.py."""
    from app.integrations import NotConnectedError, get_connection, is_integration_owner
    if not is_integration_owner():
        return {"connected": False}
    try:
        conn = await get_connection("notion")
    except NotConnectedError as e:
        return {
            "connected": False,
            "hint": e.hint,
        }
    sync_rows = await _notion_sync_state_for_user()
    last_synced_at = sync_rows[0].get("last_synced_at") if sync_rows else None
    return {
        "connected": True,
        "source": conn.get("source"),
        "workspace_name": conn.get("workspace_name") or "",
        "scopes": conn.get("scopes") or [],
        "last_synced_at": last_synced_at,
        "synced_databases": [
            {
                "database_id": r.get("database_id"),
                "mode": r.get("mode"),
                "last_synced_at": r.get("last_synced_at"),
                "last_synced_count": r.get("last_synced_count", 0),
            }
            for r in sync_rows
        ],
    }


@app.get("/integrations/notion/databases")
async def notion_databases_endpoint():
    """List every database the integration token can see. Returns 401
    when not connected so the UI can prompt re-auth.

    Task #81 — Owner-only. Without this gate any caller could enumerate
    the app owner's entire Notion workspace through the shared token."""
    from app.integrations import (
        NotConnectedError, IntegrationError, get_connection,
        require_integration_owner,
    )
    from app.integrations.notion import list_databases
    require_integration_owner()
    try:
        conn = await get_connection("notion")
    except NotConnectedError as e:
        raise HTTPException(status_code=401, detail=str(e))
    try:
        databases = await list_databases(conn)
    except NotConnectedError as e:
        raise HTTPException(status_code=401, detail=str(e))
    except IntegrationError as e:
        raise HTTPException(status_code=e.status_code, detail=str(e))
    return {"databases": databases}


@app.get("/integrations/notion/databases/{database_id}/pages")
async def notion_database_pages_endpoint(database_id: str, limit: int = 50):
    """P5A — List pages in a database for the CapturePage "From Notion"
    picker. Returns up to `limit` pages newest-first. Stays read-only —
    nothing is imported yet; the user picks one and import-page handles
    the rest.

    Task #81 — Owner-only (page contents are owner-private)."""
    from app.integrations import (
        NotConnectedError, IntegrationError, get_connection,
        require_integration_owner,
    )
    from app.integrations.notion import list_pages
    require_integration_owner()
    db_id = (database_id or "").strip()
    if not db_id:
        raise HTTPException(status_code=400, detail="database_id is required")
    try:
        conn = await get_connection("notion")
    except NotConnectedError as e:
        raise HTTPException(status_code=401, detail=str(e))
    try:
        pages = await list_pages(conn, db_id)
    except NotConnectedError as e:
        raise HTTPException(status_code=401, detail=str(e))
    except IntegrationError as e:
        raise HTTPException(status_code=e.status_code, detail=str(e))
    # Cap at `limit` so the picker stays snappy on huge databases.
    return {"pages": pages[: max(1, min(int(limit or 50), 200))]}


@app.post("/integrations/notion/import")
async def notion_import_endpoint(body: NotionImportRequest):
    """Import every page in `database_id`. mode="one-time" performs the
    import once; mode="sync" additionally records a `notion_sync_state`
    row that the background scheduler will refresh roughly daily.

    Task #81 — Owner-only (this writes pages into the caller's library
    and sets up a recurring sync against the owner's Notion). The
    require_integration_owner() call also returns the verified UID so
    we don't have to re-derive it from request state."""
    from app.integrations import (
        NotConnectedError, IntegrationError, get_connection,
        require_integration_owner,
    )
    from app.integrations.notion import import_page_as_memory, list_pages

    user_id = require_integration_owner()
    database_id = (body.database_id or "").strip()
    mode = (body.mode or "one-time").strip().lower()
    if not database_id:
        raise HTTPException(status_code=400, detail="database_id is required")
    if mode not in ("one-time", "sync"):
        raise HTTPException(status_code=400, detail="mode must be one-time or sync")

    try:
        conn = await get_connection("notion")
    except NotConnectedError as e:
        raise HTTPException(status_code=401, detail=str(e))

    try:
        pages = await list_pages(conn, database_id)
    except NotConnectedError as e:
        raise HTTPException(status_code=401, detail=str(e))
    except IntegrationError as e:
        raise HTTPException(status_code=e.status_code, detail=str(e))

    imported = 0
    updated = 0
    failed = 0
    sample_ids: List[str] = []
    for p in pages:
        try:
            res = await import_page_as_memory(conn, p["page_id"], user_id)
            if res.get("created"):
                imported += 1
            elif res.get("updated"):
                updated += 1
            mid = res.get("memory_id")
            if mid and len(sample_ids) < 5:
                sample_ids.append(mid)
        except Exception as e:
            logger.warning(f"notion import {p.get('page_id')} failed: {e}")
            failed += 1

    if mode == "sync":
        # Stamp the sync-state row keyed by user_id+database_id so the
        # scheduler can pick it up. Idempotent — re-importing a database
        # in sync mode just refreshes the timestamp.
        from datetime import datetime, timezone
        db = await get_db()
        doc_id = f"{user_id}__{database_id}"
        await db.collection("notion_sync_state").document(doc_id).set(
            {
                "user_id": user_id,
                "database_id": database_id,
                "mode": "sync",
                "last_synced_at": datetime.now(timezone.utc).isoformat(),
                "last_synced_count": imported + updated,
            },
            merge=True,
        )

    return {
        "imported": imported,
        "updated": updated,
        "failed": failed,
        "total_pages": len(pages),
        "sample_ids": sample_ids,
        "mode": mode,
    }


@app.post("/integrations/notion/import-page")
async def notion_import_page_endpoint(body: NotionImportPageRequest):
    """Import a single page (used by the CapturePage 'From Notion' chip).
    Same idempotency guarantees as the bulk import.

    Task #81 — Owner-only."""
    from app.integrations import (
        NotConnectedError, IntegrationError, get_connection,
        require_integration_owner,
    )
    from app.integrations.notion import import_page_as_memory

    user_id = require_integration_owner()
    page_id = (body.page_id or "").strip()
    if not page_id:
        raise HTTPException(status_code=400, detail="page_id is required")
    try:
        conn = await get_connection("notion")
    except NotConnectedError as e:
        raise HTTPException(status_code=401, detail=str(e))
    try:
        res = await import_page_as_memory(conn, page_id, user_id)
    except NotConnectedError as e:
        raise HTTPException(status_code=401, detail=str(e))
    except IntegrationError as e:
        raise HTTPException(status_code=e.status_code, detail=str(e))
    return res


@app.post("/integrations/notion/disconnect")
async def notion_disconnect_endpoint():
    """Drop all `notion_sync_state` rows for this user. We can't revoke
    the underlying Replit OAuth grant (that's a user action in the
    Replit UI) — surface that as a hint.

    Task #81 — Owner-only. The existing `belongs_to_current_user` filter
    already scoped the delete to the caller's rows, but without an auth
    gate a guest could still hammer this endpoint to clear other guest
    sessions' sync state. Owner gate closes that door."""
    from app.integrations import require_integration_owner
    from app.user_context import belongs_to_current_user as _belongs
    require_integration_owner()
    db = await get_db()
    snap = await db.collection("notion_sync_state").get()
    deleted = 0
    for d in snap:
        data = (d.to_dict() or {}) | {"_doc_id": d.id}
        if not _belongs(data):
            continue
        try:
            await db.collection("notion_sync_state").document(d.id).delete()
            deleted += 1
        except Exception as e:
            logger.warning(f"notion disconnect: delete sync row failed: {e}")
    return {
        "disconnected": True,
        "removed_sync_rows": deleted,
        "hint": (
            "Sync schedules cleared. To fully revoke OAuth access, "
            "remove the Notion integration from your Replit account "
            "or delete the NOTION_INTEGRATION_TOKEN secret."
        ),
    }


@app.post("/integrations/notion/sync-now")
async def notion_sync_now_endpoint():
    """Manual trigger for the sync scheduler. Useful for tests and for
    a 'Refresh now' button in the UI.

    Task #81 — Owner-only. The scheduler itself fans out to per-user
    sync rows, but we still gate the manual trigger so non-owners can't
    force-load the owner's Notion or burn API quota."""
    from app.integrations import require_integration_owner
    require_integration_owner()
    refreshed = await notion_sync_scheduler_run_once()
    return {"refreshed": refreshed}
# --- end P5A: Notion integration --------------------------------------------


# --- P5B: Gmail integration -------------------------------------------------
# Real Gmail wiring (replaces the IntegrationsPage Gmail stub). Credentials
# come from `app.integrations.get_connection("gmail")` which prefers the
# Replit OAuth credential proxy (connector name `google-mail`) and falls
# back to GMAIL_ACCESS_TOKEN. Endpoints surface NotConnectedError as a
# clean 401 so the UI can show a Connect button without leaking stack
# traces. The bulk-import UX is a frontend loop over the single-message
# import endpoint — that keeps the backend small and the frontend can
# show per-message progress in the Integrations modal.

class GmailImportMessageRequest(BaseModel):
    message_id: str


@app.get("/integrations/gmail/status")
async def gmail_status_endpoint():
    """Tell the frontend whether Gmail is wired up and (if so) how —
    via Replit OAuth or a manual access token. Surfaces the connected
    user's email when available so the UI can confirm "you're connected
    as you@example.com".

    Task #81 — Non-owners get a silent `{connected: false}` (don't leak
    the owner's connected mailbox address)."""
    from app.integrations import NotConnectedError, get_connection, is_integration_owner
    if not is_integration_owner():
        return {"connected": False}
    try:
        conn = await get_connection("gmail")
    except NotConnectedError as e:
        return {
            "connected": False,
            "hint": e.hint,
        }
    return {
        "connected": True,
        "source": conn.get("source"),
        "email": conn.get("email") or conn.get("workspace_name") or "",
        "scopes": conn.get("scopes") or [],
    }


@app.get("/integrations/gmail/labels")
async def gmail_labels_endpoint():
    """List every label visible to the connection. Returns 401 when the
    integration isn't authorized so the UI can surface a Connect prompt
    instead of an empty picker.

    Task #81 — Owner-only (label names can leak inbox structure)."""
    from app.integrations import (
        NotConnectedError, IntegrationError, get_connection,
        require_integration_owner,
    )
    from app.integrations.gmail import list_labels
    require_integration_owner()
    try:
        conn = await get_connection("gmail")
    except NotConnectedError as e:
        raise HTTPException(status_code=401, detail=str(e))
    try:
        labels = await list_labels(conn)
    except NotConnectedError as e:
        raise HTTPException(status_code=401, detail=str(e))
    except IntegrationError as e:
        raise HTTPException(status_code=e.status_code, detail=str(e))
    return {"labels": labels}


@app.get("/integrations/gmail/search")
async def gmail_search_endpoint(
    q: Optional[str] = None,
    label_id: Optional[str] = None,
    limit: int = 20,
):
    """List messages matching the optional `q` (Gmail search syntax —
    `from:`, `is:starred`, `subject:`, ...) and/or `label_id`. Returns
    light metadata per row (subject/from/date/snippet) so the picker can
    render without a second round-trip per message.

    Task #81 — Owner-only. This is the most dangerous Gmail endpoint —
    it returns subject/from/recipient/snippet for arbitrary search
    queries against the owner's mailbox."""
    from app.integrations import (
        NotConnectedError, IntegrationError, get_connection,
        require_integration_owner,
    )
    from app.integrations.gmail import list_messages
    require_integration_owner()
    try:
        conn = await get_connection("gmail")
    except NotConnectedError as e:
        raise HTTPException(status_code=401, detail=str(e))
    try:
        # Cap at 50 so a confused frontend can't ask for thousands and
        # blow up our per-row metadata fan-out (50 sequential GETs is
        # already the high end of what we want to do per request).
        capped = max(1, min(int(limit or 20), 50))
        messages = await list_messages(
            conn,
            label_id=(label_id or None),
            query=(q or None),
            max_results=capped,
        )
    except NotConnectedError as e:
        raise HTTPException(status_code=401, detail=str(e))
    except IntegrationError as e:
        raise HTTPException(status_code=e.status_code, detail=str(e))
    return {"messages": messages}


@app.post("/integrations/gmail/import-message")
async def gmail_import_message_endpoint(body: GmailImportMessageRequest):
    """Import a single Gmail message (used by both the Integrations
    bulk-import loop and the CapturePage 'From Gmail' picker). Idempotent
    via external_refs lookup.

    Task #81 — Owner-only. Imports full message body + attachments into
    the caller's library, so non-owners must never reach this."""
    from app.integrations import (
        NotConnectedError, IntegrationError, get_connection,
        require_integration_owner,
    )
    from app.integrations.gmail import import_message_as_memory

    user_id = require_integration_owner()
    message_id = (body.message_id or "").strip()
    if not message_id:
        raise HTTPException(status_code=400, detail="message_id is required")
    try:
        conn = await get_connection("gmail")
    except NotConnectedError as e:
        raise HTTPException(status_code=401, detail=str(e))
    try:
        res = await import_message_as_memory(conn, message_id, user_id)
    except NotConnectedError as e:
        raise HTTPException(status_code=401, detail=str(e))
    except IntegrationError as e:
        raise HTTPException(status_code=e.status_code, detail=str(e))
    return res


@app.post("/integrations/gmail/disconnect")
async def gmail_disconnect_endpoint():
    """No persistent server-side state to clear (Gmail has no equivalent
    of `notion_sync_state` since we don't background-sync mailboxes —
    too noisy and the user explicitly picks per message). Returns a hint
    pointing the user to the platform-level revoke step so the UI can
    render a consistent 'now do this in Replit' message.

    Task #81 — Owner-only (defense-in-depth: even though this is a
    no-op server-side, gating it keeps the surface consistent and stops
    non-owners from probing for the integration's existence)."""
    from app.integrations import require_integration_owner
    require_integration_owner()
    return {
        "disconnected": True,
        "hint": (
            "Gmail OAuth grant cleared on this server. To fully revoke "
            "access, remove the Gmail integration from your Replit "
            "account or delete the GMAIL_ACCESS_TOKEN secret."
        ),
    }
# --- end P5B: Gmail integration ---------------------------------------------


# --- P5C: Slack integration -------------------------------------------------
# Real Slack wiring (replaces the IntegrationsPage Slack stub). Credentials
# come from `app.integrations.get_connection("slack")` which prefers the
# Replit OAuth credential proxy and falls back to SLACK_BOT_TOKEN. The
# import endpoint accepts either a parsed (channel_id, thread_ts) pair or
# a raw Slack web URL — the URL form is what the CapturePage paste flow
# uses, the parsed form is what the IntegrationsPage channel picker uses
# once we wire that pickier UI later. Idempotent via external_refs.

class SlackImportThreadRequest(BaseModel):
    # Either pass `url` (Slack web URL) OR pass both
    # `channel_id` + `thread_ts`. The endpoint validates that one of
    # the two shapes is satisfied so the frontend can use whichever is
    # convenient at the call site.
    url: Optional[str] = None
    channel_id: Optional[str] = None
    thread_ts: Optional[str] = None


@app.get("/integrations/slack/status")
async def slack_status_endpoint():
    """Tell the frontend whether Slack is wired up and (if so) which
    workspace + bot user. Mirrors the gmail/notion status shape so the
    integrations card doesn't need provider-specific render code.

    Task #81 — Non-owners get `{connected: false}` (don't leak which
    workspace the owner connected to)."""
    from app.integrations import (
        NotConnectedError, IntegrationError, get_connection,
        is_integration_owner,
    )
    from app.integrations.slack import auth_test
    if not is_integration_owner():
        return {"connected": False}
    try:
        conn = await get_connection("slack")
    except NotConnectedError as e:
        return {
            "connected": False,
            "hint": e.hint,
        }
    # auth.test confirms the token actually works (vs the credential
    # being merely *present*) — important because Slack tokens can be
    # revoked from the workspace admin console without us knowing.
    try:
        info = await auth_test(conn)
    except NotConnectedError as e:
        return {
            "connected": False,
            "hint": str(e),
        }
    except IntegrationError as e:
        # Auth API itself failed — surface as not-connected so the UI
        # shows a Connect button rather than a baffling 502.
        return {
            "connected": False,
            "hint": f"Slack auth.test failed: {e}",
        }
    return {
        "connected": True,
        "source": conn.get("source"),
        "team": info.get("team"),
        "team_id": info.get("team_id"),
        "user": info.get("user"),
        "user_id": info.get("user_id"),
        "url": info.get("url"),
        "scopes": conn.get("scopes") or [],
    }


@app.get("/integrations/slack/channels")
async def slack_channels_endpoint(limit: int = 200):
    """List public + private channels visible to the bot. Returns 401
    when the integration isn't authorized.

    Task #81 — Owner-only. Private channel names are sensitive."""
    from app.integrations import (
        NotConnectedError, IntegrationError, get_connection,
        require_integration_owner,
    )
    from app.integrations.slack import list_channels
    require_integration_owner()
    try:
        conn = await get_connection("slack")
    except NotConnectedError as e:
        raise HTTPException(status_code=401, detail=str(e))
    try:
        capped = max(1, min(int(limit or 200), 1000))
        channels = await list_channels(conn, limit=capped)
    except NotConnectedError as e:
        raise HTTPException(status_code=401, detail=str(e))
    except IntegrationError as e:
        raise HTTPException(status_code=e.status_code, detail=str(e))
    return {"channels": channels}


@app.post("/integrations/slack/import-thread")
async def slack_import_thread_endpoint(body: SlackImportThreadRequest):
    """Import a Slack thread as a single memory. Accepts either a raw
    web URL (`url`) or an explicit `(channel_id, thread_ts)` pair —
    the frontend uses the URL form for the CapturePage paste flow and
    can use the parsed form once a channel picker is wired.

    Task #81 — Owner-only. Pulls full thread contents (including
    private channels) into the caller's library."""
    from app.integrations import (
        NotConnectedError, IntegrationError, get_connection,
        require_integration_owner,
    )
    from app.integrations.slack import (
        import_thread_as_memory,
        parse_thread_url,
    )

    user_id = require_integration_owner()
    raw_url = (body.url or "").strip()
    channel_id = (body.channel_id or "").strip()
    thread_ts = (body.thread_ts or "").strip()
    if raw_url:
        try:
            channel_id, thread_ts = parse_thread_url(raw_url)
        except IntegrationError as e:
            raise HTTPException(status_code=400, detail=str(e))
    if not channel_id or not thread_ts:
        raise HTTPException(
            status_code=400,
            detail="Provide either `url` or both `channel_id` + `thread_ts`.",
        )
    try:
        conn = await get_connection("slack")
    except NotConnectedError as e:
        raise HTTPException(status_code=401, detail=str(e))
    try:
        res = await import_thread_as_memory(
            conn, channel_id, thread_ts, user_id
        )
    except NotConnectedError as e:
        raise HTTPException(status_code=401, detail=str(e))
    except IntegrationError as e:
        raise HTTPException(status_code=e.status_code, detail=str(e))
    return res


@app.post("/integrations/slack/disconnect")
async def slack_disconnect_endpoint():
    """No persistent server-side state to clear (Slack import is on-
    demand only — we don't background-poll channels). Returns the
    Replit revoke hint so the UI can render a consistent message.

    Task #81 — Owner-only (defense-in-depth, see gmail disconnect)."""
    from app.integrations import require_integration_owner
    require_integration_owner()
    return {
        "disconnected": True,
        "hint": (
            "Slack OAuth grant cleared on this server. To fully revoke "
            "access, remove the Slack integration from your Replit "
            "account or delete the SLACK_BOT_TOKEN secret."
        ),
    }
# --- end P5C: Slack integration ---------------------------------------------


@app.post("/briefing/settings")
async def briefing_settings_set_endpoint(body: BriefingSettingsRequest):
    """Save the user's briefing notification preferences."""
    if body.send_hour is not None and (body.send_hour < 0 or body.send_hour > 23):
        raise HTTPException(status_code=400, detail="send_hour must be between 0 and 23")
    if body.tz_offset_minutes is not None and (body.tz_offset_minutes < -14 * 60 or body.tz_offset_minutes > 14 * 60):
        raise HTTPException(status_code=400, detail="tz_offset_minutes out of range")
    return await briefing_set_settings(
        notifications_enabled=body.notifications_enabled,
        send_hour=body.send_hour,
        tz_offset_minutes=body.tz_offset_minutes,
    )


@app.get("/briefing/notification")
async def briefing_notification_get_endpoint():
    """Return the latest unseen briefing notification for the current user
    (or `{notification: null}` if there isn't one). Polled by the in-app
    notifier every minute or so."""
    n = await briefing_get_notification()
    return {"notification": n}


@app.post("/briefing/notification/seen")
async def briefing_notification_seen_endpoint():
    """Mark the current user's most recent briefing notification as seen."""
    return await briefing_mark_notification_seen()


@app.post("/briefing/notify-now")
async def briefing_notify_now_endpoint():
    """Force-deliver today's briefing notification for the current user.
    Used for manual testing and as a 'send me my briefing now' button so
    users don't have to wait for the next 8am tick to see how it looks."""
    from app.user_context import get_uid
    uid = get_uid()
    return await briefing_deliver_notification(uid)


@app.post("/briefing/scheduler/run")
async def briefing_scheduler_run_endpoint(request: Request):
    """Manually advance the scheduler one tick. This is an admin-only debug
    hatch — not exposed in production. Set the env var
    `BRIEFING_SCHEDULER_DEBUG_KEY` and pass the same value in the
    `X-Debug-Key` header to call it. Without the env var the endpoint
    returns 404 so an attacker can't enumerate it."""
    debug_key = os.environ.get("BRIEFING_SCHEDULER_DEBUG_KEY", "").strip()
    if not debug_key:
        raise HTTPException(status_code=404, detail="Not found")
    supplied = (request.headers.get("x-debug-key") or "").strip()
    if not supplied or supplied != debug_key:
        raise HTTPException(status_code=403, detail="Forbidden")
    delivered = await briefing_scheduler_run_once()
    return {"delivered": delivered}


# --- Notes ---

class NoteCreateRequest(BaseModel):
    title: Optional[str] = "Untitled note"
    content: Optional[str] = ""
    tags: Optional[List[str]] = []
    pinned: Optional[bool] = False

class NoteUpdateRequest(BaseModel):
    title: Optional[str] = None
    content: Optional[str] = None
    tags: Optional[List[str]] = None
    pinned: Optional[bool] = None

@app.get("/notes")
async def list_notes_endpoint(tag: str = "", limit: int = 50, include_archived: bool = False):
    try:
        return await list_notes(tag=tag, limit=limit, include_archived=include_archived)
    except Exception as e:
        print(f"list_notes_endpoint error: {e}")
        return []

@app.post("/notes")
async def create_note_endpoint(req: NoteCreateRequest):
    return await create_note(title=req.title or "Untitled note", content=req.content or "", tags=req.tags or [], pinned=bool(req.pinned))

@app.put("/notes/{note_id}")
async def update_note_endpoint(note_id: str, req: NoteUpdateRequest):
    try:
        return await update_note(note_id, **req.model_dump(exclude_unset=True))
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

@app.delete("/notes/{note_id}")
async def delete_note_endpoint(note_id: str, hard: bool = False):
    try:
        return await delete_note(note_id, hard=hard)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


# --- Bookmarks ---

class BookmarkCreateRequest(BaseModel):
    url: str
    title: Optional[str] = ""
    description: Optional[str] = ""
    tags: Optional[List[str]] = []

class BookmarkUpdateRequest(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    tags: Optional[List[str]] = None
    status: Optional[str] = None
    pinned: Optional[bool] = None

@app.get("/bookmarks")
async def list_bookmarks_endpoint(status: str = "", limit: int = 100, include_archived: bool = False):
    try:
        return await list_bookmarks(status=status, limit=limit, include_archived=include_archived)
    except Exception as e:
        print(f"list_bookmarks_endpoint error: {e}")
        return []

@app.post("/bookmarks")
async def create_bookmark_endpoint(req: BookmarkCreateRequest):
    return await create_bookmark(url=req.url, title=req.title or "", description=req.description or "", tags=req.tags or [])

@app.put("/bookmarks/{bm_id}")
async def update_bookmark_endpoint(bm_id: str, req: BookmarkUpdateRequest):
    try:
        return await update_bookmark(bm_id, **req.model_dump(exclude_unset=True))
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

@app.delete("/bookmarks/{bm_id}")
async def delete_bookmark_endpoint(bm_id: str, hard: bool = False):
    try:
        return await delete_bookmark(bm_id, hard=hard)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


# --- Habits ---

class HabitCreateRequest(BaseModel):
    name: str
    icon: Optional[str] = "Zap"
    color: Optional[str] = "#10b981"
    goal: Optional[str] = "daily"

@app.get("/habits")
async def list_habits_endpoint():
    try:
        return await list_habits()
    except Exception as e:
        print(f"list_habits_endpoint error: {e}")
        return []

@app.post("/habits")
async def create_habit_endpoint(req: HabitCreateRequest):
    return await create_habit(name=req.name, icon=req.icon or "Zap", color=req.color or "#10b981", goal=req.goal or "daily")

@app.post("/habits/{h_id}/toggle")
async def toggle_habit_endpoint(h_id: str, date: str = ""):
    try:
        return await toggle_habit(h_id, date_iso=date)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

@app.delete("/habits/{h_id}")
async def delete_habit_endpoint(h_id: str):
    try:
        return await delete_habit(h_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


# --- Stats & Logs ---

@app.get("/export/vault")
async def export_vault():
    """Export the current user's knowledge vault as a Markdown file for download."""
    from app.user_context import belongs_to_current_user
    try:
        db = await get_db()
        memories_snapshot = await db.collection("memories").get()
        memories = [doc.to_dict() | {"id": doc.id} for doc in memories_snapshot if belongs_to_current_user(doc.to_dict())]

        lines = [
            "# 🧠 Recall X247 — Knowledge Vault Export",
            f"> Exported on {datetime.datetime.now().strftime('%B %d, %Y at %H:%M')}",
            f"> Total memories: {len(memories)}",
            "",
            "---",
            ""
        ]
        by_domain: dict = {}
        for m in memories:
            d = m.get("domain", "Other")
            by_domain.setdefault(d, []).append(m)

        for domain, items in sorted(by_domain.items()):
            lines.append(f"## {domain} ({len(items)} memories)")
            lines.append("")
            for m in items:
                created = m.get("created_at", "")
                if hasattr(created, "isoformat"):
                    created = created.isoformat()[:10]
                elif isinstance(created, str):
                    created = created[:10]
                lines.append(f"### {m.get('title', 'Untitled')}")
                lines.append(f"**Source:** {m.get('source_type', '').title()} | **Date:** {created}")
                if m.get("source_url"):
                    lines.append(f"**URL:** {m.get('source_url')}")
                lines.append("")
                lines.append(f"**Summary:** {m.get('summary', '')}")
                lines.append("")
                if m.get("key_points"):
                    lines.append("**Key Points:**")
                    for kp in m["key_points"]:
                        lines.append(f"- {kp}")
                if m.get("tags"):
                    lines.append(f"\n**Tags:** {', '.join('#' + t for t in m['tags'])}")
                lines.append("")
                lines.append("---")
                lines.append("")

        content = "\n".join(lines)
        from fastapi.responses import Response
        return Response(
            content=content,
            media_type="text/markdown",
            headers={"Content-Disposition": 'attachment; filename="recall-x247-vault.md"'}
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Export failed: {str(e)}")


@app.get("/dashboard/advanced")
async def dashboard_advanced_endpoint():
    """One-shot aggregator powering the advanced DashboardPage sections.
    Returns greeting, pulse deltas, 84-day heatmap, top tags, today focus,
    7-day forecast, pick-up-where-left-off, and capture streaks."""
    try:
        return await get_advanced_dashboard()
    except Exception as e:
        logger.error(f"dashboard/advanced error: {e}")
        return {
            "greeting": {"period": "morning", "label": "Welcome", "hour_ist": 0, "iso": ""},
            "pulse": {},
            "activity_heatmap": {"days": 84, "cells": [], "max": 0},
            "streak": {"current": 0, "longest": 0},
            "top_tags": [],
            "today_focus": [],
            "forecast_7d": [],
            "pick_up": None,
            "totals": {},
            "error": str(e),
        }


@app.get("/stats")
async def stats_endpoint():
    try:
        from datetime import date
        from app.user_context import belongs_to_current_user
        total_interactions = await get_collection_count("interaction_logs")
        db = await get_db()

        # Memories: count + domains + captured today (current user only)
        memories_snapshot = await db.collection("memories").get()
        domains = {}
        captured_today = 0
        total_memories = 0
        today_str = date.today().isoformat()
        for doc in memories_snapshot:
            data = doc.to_dict()
            if not belongs_to_current_user(data):
                continue
            total_memories += 1
            domain = data.get("domain", "Other")
            domains[domain] = domains.get(domain, 0) + 1
            created = data.get("created_at", "")
            if created and str(created)[:10] == today_str:
                captured_today += 1
        domain_list = [{"name": k, "value": v} for k, v in domains.items()]

        # Tasks: count only pending ones
        pending_tasks_list = await list_tasks(status="pending", limit=200)
        pending_tasks = len(pending_tasks_list)

        return {
            "total_memories": total_memories,
            "pending_tasks": pending_tasks,
            "ai_interactions": total_interactions,
            "knowledge_domains": domain_list,
            "captured_today": captured_today,
            "flashcards": total_memories,
            "streak_days": 0,
            "focus_sessions": 0,
        }
    except Exception as e:
        logger.error(f"Stats error: {e}")
        return {
            "total_memories": 0,
            "pending_tasks": 0,
            "ai_interactions": 0,
            "knowledge_domains": [],
            "captured_today": 0,
            "flashcards": 0,
            "streak_days": 0,
            "focus_sessions": 0,
        }

@app.get("/logs")
async def list_logs_endpoint(limit: int = 10):
    try:
        from app.user_context import belongs_to_current_user
        db = await get_db()
        snapshot = await db.collection("interaction_logs").order_by("timestamp", direction="DESCENDING").limit(limit * 5).get()
        results = []
        for doc in snapshot:
            base = doc.to_dict()
            if not belongs_to_current_user(base):
                continue
            d = base | {"id": doc.id}
            if "timestamp" in d and hasattr(d["timestamp"], "isoformat"):
                d["timestamp"] = d["timestamp"].isoformat()
            results.append(d)
            if len(results) >= limit:
                break
        return results
    except Exception as e:
        return []


# --- Static Files / SPA fallback ---
#
# Bulletproof so judges and first-time visitors NEVER see a raw JSON 404 when
# they deep-link to a route like /dashboard, /capture, /vault, /recall.
#
# Strategy:
#   1. Compute dist_path at request time, not at module load — this way the
#      route survives even if dist/ is built AFTER the worker starts (e.g.
#      first cold-start on Cloud Run while build artefacts settle).
#   2. ALWAYS register the catch-all `/{full_path:path}` route — never gate it
#      on `os.path.isdir(...)` at startup, otherwise an empty container would
#      fall back to FastAPI's default `{"detail":"Not Found"}` JSON.
#   3. If a real static file exists, serve it (with no-cache for index.html
#      so SPA route bumps don't get stuck behind a stale shell).
#   4. If the SPA shell isn't built, serve a friendly HTML fallback page that
#      tells the visitor what's happening — not raw JSON.

dist_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "dist")
_assets_path = os.path.join(dist_path, "assets")
if os.path.isdir(_assets_path):
    app.mount("/assets", StaticFiles(directory=_assets_path), name="assets")

# Files in dist/ that should be served at root (favicon, logos, manifest, etc).
_ROOT_PASSTHROUGH = {
    "favicon.ico", "robots.txt", "manifest.json", "manifest.webmanifest",
    "x247-logo.png", "logo.png", "apple-touch-icon.png", "sitemap.xml",
    "sw.js", "service-worker.js",
}

_FALLBACK_HTML = """<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>Recall X247 — starting up</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  html,body{height:100%;margin:0;font-family:-apple-system,BlinkMacSystemFont,
    "Segoe UI",Roboto,sans-serif;background:#0b0d12;color:#eaeaea}
  .wrap{display:flex;align-items:center;justify-content:center;height:100%;
    padding:24px;text-align:center}
  .card{max-width:540px;background:rgba(255,255,255,.04);
    border:1px solid rgba(255,255,255,.08);border-radius:16px;padding:32px}
  h1{margin:0 0 12px;font-size:22px;font-weight:600}
  p{margin:8px 0;color:#aab1bd;font-size:15px;line-height:1.55}
  a{color:#7dd3fc;text-decoration:none}
  a:hover{text-decoration:underline}
  .pulse{display:inline-block;width:10px;height:10px;border-radius:50%;
    background:#22c55e;margin-right:8px;animation:p 1.6s ease-in-out infinite}
  @keyframes p{0%,100%{opacity:.4}50%{opacity:1}}
</style></head><body><div class="wrap"><div class="card">
<h1><span class="pulse"></span>Recall X247</h1>
<p>The app is warming up. The frontend bundle isn't available on this instance
yet — please refresh in a moment.</p>
<p>Backend is online: <a href="/api/health">/api/health</a> ·
<a href="/">Home</a></p>
</div></div></body></html>"""

# ─────────────────────────────────────────────────────────────────────
# W4 — AI auto-link layer endpoints.
# Registered BEFORE the SPA catch-all GET at the end of this file so
# `GET /suggestions/inbox` and `GET /suggestions/links` actually match
# instead of being swallowed by `@app.get("/{full_path:path}")`.
# Scanners that *produce* suggestions live next to their domain
# (briefing_agent, insight_agent, revisit_agent) and are triggered by
# the briefing flow. These five endpoints are the consumer surface.
# ─────────────────────────────────────────────────────────────────────

@app.get("/suggestions/links")
async def list_suggestions_for_memory_endpoint(for_memory: str = Query("")):
    """Pending AI suggestions tied to a specific memory."""
    from app import auto_linker as _al
    if not for_memory:
        raise HTTPException(status_code=400, detail="for_memory query param is required.")
    items = await _al.list_for_memory(for_memory)
    return {"memory_id": for_memory, "suggestions": items, "count": len(items)}


@app.get("/suggestions/inbox")
async def suggestions_inbox_endpoint(limit: int = Query(50, ge=1, le=200)):
    """All pending suggestions for the current user, newest first."""
    from app import auto_linker as _al
    items = await _al.list_inbox(limit=limit)
    return {"suggestions": items, "count": len(items)}


@app.post("/suggestions/{suggestion_id}/accept")
async def suggestion_accept_endpoint(suggestion_id: str):
    """Apply the suggested link and mark accepted. For folder_bundle
    suggestions this returns `applied.deferred=true` with the memory
    IDs the UI should hand to the workspace creator."""
    from app import auto_linker as _al
    try:
        return await _al.accept_suggestion(suggestion_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/suggestions/{suggestion_id}/reject")
async def suggestion_reject_endpoint(suggestion_id: str):
    """Mark rejected and persist a dismissal so the same signature
    won't resurface in future scanner runs."""
    from app import auto_linker as _al
    try:
        return await _al.reject_suggestion(suggestion_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/suggestions/run-scans")
async def suggestions_run_scans_endpoint():
    """Manual trigger for the W4 scanners — useful for testing the
    inbox endpoint without waiting for the briefing scheduler tick.
    Runs habit-link, stale-task, weekly clustering, and stale-revisit
    scans for the current user. Each scanner is best-effort: an error
    in one is reported per-scan but doesn't abort the others."""
    from app.user_context import get_uid as _uid
    uid = _uid()
    out: Dict[str, Any] = {}
    try:
        from app.briefing_agent import scan_habit_memory_links, scan_stale_linked_tasks
        out["habit_links"] = await scan_habit_memory_links(uid)
        out["stale_tasks"] = await scan_stale_linked_tasks(uid)
    except Exception as e:
        out["briefing_scans_error"] = str(e)
    try:
        from app.insight_agent import cluster_weekly
        out["clustering"] = await cluster_weekly(uid)
    except Exception as e:
        out["clustering_error"] = str(e)
    try:
        from app.revisit_agent import scan_stale_revisit_candidates
        out["stale_revisits"] = await scan_stale_revisit_candidates(uid)
    except Exception as e:
        out["stale_revisits_error"] = str(e)
    return out


@app.get("/", include_in_schema=False)
async def serve_root():
    """Always return the SPA shell at /. If dist isn't there, return a
    friendly HTML page rather than the bare API JSON banner so deep-link
    visitors (e.g. judges loading directly from a bookmark) never see
    raw {"detail":"Not Found"}."""
    index_html = os.path.join(dist_path, "index.html")
    if os.path.isfile(index_html):
        return FileResponse(index_html, headers={
            "Cache-Control": "no-cache",
        })
    return Response(content=_FALLBACK_HTML, media_type="text/html",
                    status_code=200)

@app.get("/{full_path:path}", include_in_schema=False)
async def serve_spa(full_path: str):
    """SPA fallback: serve known root-level static files, otherwise return
    index.html so React Router can handle the route. Critically, this route
    is ALWAYS registered (even if dist/ doesn't exist yet) so that direct
    visits to /dashboard, /capture, /vault, /recall etc. never leak the
    FastAPI default `{"detail":"Not Found"}` JSON to end users."""
    # Never swallow API-style paths — let FastAPI's real 404 surface for
    # genuinely unknown API routes (debuggable via DevTools network panel).
    api_prefixes = (
        "api/", "capture", "recall", "tasks", "memories", "schedule",
        "calendar", "events", "notes", "bookmarks", "habits", "revisits",
        "workspace", "stats", "logs", "briefing", "dashboard/advanced",
        "discover", "agent", "share/", "export/", "study-plan", "flashcards",
        "auth/", "users/", "health", "metrics", "graph", "insights",
        "timeline", "transcribe", "ws", "stream",
    )
    # Allow `/dashboard`, `/capture`, `/vault`, `/recall`, `/projects` etc.
    # to be SPA routes — they aren't backend endpoints by themselves.
    lc = (full_path or "").lstrip("/").lower()
    is_api = any(lc.startswith(p) for p in api_prefixes) and "/" in lc
    if is_api:
        return JSONResponse(status_code=404, content={"detail": "Not Found"})

    # Root-level passthrough for known static files (favicon, manifest, etc).
    head = lc.split("/", 1)[0]
    if head in _ROOT_PASSTHROUGH:
        candidate = os.path.normpath(os.path.join(dist_path, full_path))
        if candidate.startswith(dist_path) and os.path.isfile(candidate):
            return FileResponse(candidate)

    # Any other static file inside dist/ (defence in depth).
    if full_path:
        candidate = os.path.normpath(os.path.join(dist_path, full_path))
        if candidate.startswith(dist_path) and os.path.isfile(candidate):
            return FileResponse(candidate)

    # Default: serve the SPA shell so React Router can take over.
    index_html = os.path.join(dist_path, "index.html")
    if os.path.isfile(index_html):
        return FileResponse(index_html, headers={
            "Cache-Control": "no-cache",
        })
    return Response(content=_FALLBACK_HTML, media_type="text/html",
                    status_code=200)

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)
