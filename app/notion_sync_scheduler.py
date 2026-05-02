"""Background scheduler for Notion database sync mode.

Mirrors `briefing_scheduler.py`: a single asyncio task started from
FastAPI startup, ticks every `TICK_INTERVAL_SECONDS`, scans the
`notion_sync_state` collection and runs delta imports for any
`mode="sync"` entry whose last sync ran more than `SYNC_INTERVAL_HOURS`
ago.

Per-user errors are swallowed so one bad workspace never blocks the
others. The actual import is delegated to
`app.integrations.notion.import_page_as_memory` so this scheduler is
just a "when to run" wrapper.
"""
from __future__ import annotations

import asyncio
import datetime
import logging
from typing import Optional

logger = logging.getLogger(__name__)

# Tick every 1 hour. Combined with SYNC_INTERVAL_HOURS=24 below, we get
# a per-database refresh roughly once per day with at most an hour of
# extra delay. Cheap to scan even with thousands of entries.
TICK_INTERVAL_SECONDS = 60 * 60
SYNC_INTERVAL_HOURS = 24

_task: Optional[asyncio.Task] = None
_running = False

_COLLECTION = "notion_sync_state"


def _utcnow_iso() -> str:
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def _is_due(last_synced_at: str) -> bool:
    if not last_synced_at:
        return True
    try:
        last = datetime.datetime.fromisoformat(last_synced_at)
        if last.tzinfo is None:
            last = last.replace(tzinfo=datetime.timezone.utc)
    except Exception:
        return True
    delta = datetime.datetime.now(datetime.timezone.utc) - last
    return delta.total_seconds() >= SYNC_INTERVAL_HOURS * 3600


async def _list_due_entries() -> list:
    from app.db import get_db
    # Task #81 — The scheduler runs outside any HTTP request context, so
    # the per-request owner gate in main.py doesn't help here. We re-check
    # the allowlist on every tick: any sync row whose user_id is no longer
    # an integration owner (legacy rows from before the gate, or a UID that
    # was removed from INTEGRATION_OWNER_UIDS after revocation) gets
    # silently skipped instead of pulling fresh data with the shared
    # owner token. This matches the "fail-closed when allowlist is unset"
    # posture in app/integrations/__init__.py.
    from app.integrations import allowed_integration_owner_uids

    db = await get_db()
    snap = await db.collection(_COLLECTION).get()
    allowed = allowed_integration_owner_uids()
    due = []
    skipped_non_owner = 0
    for d in snap:
        data = (d.to_dict() or {}) | {"_doc_id": d.id}
        if (data.get("mode") or "").lower() != "sync":
            continue
        # Owner check — if the allowlist is empty (env var unset) this
        # excludes every row, which is the right fail-closed behavior:
        # without a configured owner, the scheduler should not be acting
        # on the shared token at all.
        uid = (data.get("user_id") or "").strip()
        if not uid or uid not in allowed:
            skipped_non_owner += 1
            continue
        if not _is_due(data.get("last_synced_at") or ""):
            continue
        due.append(data)
    if skipped_non_owner:
        # One log line per tick, not per row, so a misconfigured prod
        # doesn't spam the logs but the operator still notices.
        logger.info(
            "notion_sync_scheduler: skipped %d sync row(s) whose user_id "
            "is not in INTEGRATION_OWNER_UIDS",
            skipped_non_owner,
        )
    return due


async def _sync_one(entry: dict) -> int:
    """Run one delta import. Returns the number of pages refreshed."""
    from app.db import get_db
    from app.integrations import NotConnectedError, get_connection
    from app.integrations.notion import import_page_as_memory, list_pages
    from app.user_context import current_user_id_var

    user_id = (entry.get("user_id") or "").strip()
    database_id = (entry.get("database_id") or "").strip()
    if not user_id or not database_id:
        return 0

    token = current_user_id_var.set(user_id)
    try:
        try:
            conn = await get_connection("notion")
        except NotConnectedError:
            logger.info(
                f"notion_sync: user {user_id} no longer connected — skipping"
            )
            return 0
        since = entry.get("last_synced_at") or None
        pages = await list_pages(conn, database_id, since=since)
        refreshed = 0
        for p in pages:
            try:
                await import_page_as_memory(conn, p["page_id"], user_id)
                refreshed += 1
            except Exception as e:
                logger.warning(
                    f"notion_sync: import {p.get('page_id')} failed: {e}"
                )
        # Stamp last_synced_at + count regardless so we don't hammer a
        # broken database on every tick.
        db = await get_db()
        doc_id = entry.get("_doc_id")
        if doc_id:
            await db.collection(_COLLECTION).document(doc_id).set(
                {
                    "user_id": user_id,
                    "database_id": database_id,
                    "mode": "sync",
                    "last_synced_at": _utcnow_iso(),
                    "last_synced_count": refreshed,
                },
                merge=True,
            )
        return refreshed
    except Exception as e:
        logger.warning(f"notion_sync: tick error for {user_id}/{database_id}: {e}")
        return 0
    finally:
        current_user_id_var.reset(token)


async def _tick_once() -> int:
    """Run a single scan. Returns the total refreshed page count."""
    try:
        due = await _list_due_entries()
    except Exception as e:
        logger.warning(f"notion_sync_scheduler list error: {e}")
        return 0
    total = 0
    for entry in due:
        total += await _sync_one(entry)
    if total:
        logger.info(f"notion_sync_scheduler: refreshed {total} pages")
    return total


async def _scheduler_loop() -> None:
    global _running
    _running = True
    logger.info(
        f"notion_sync_scheduler started (tick every {TICK_INTERVAL_SECONDS}s)"
    )
    # Larger initial delay so we don't race the rest of the startup.
    await asyncio.sleep(60)
    try:
        while _running:
            try:
                await _tick_once()
            except Exception as e:
                logger.warning(f"notion_sync_scheduler tick error: {e}")
            await asyncio.sleep(TICK_INTERVAL_SECONDS)
    except asyncio.CancelledError:
        logger.info("notion_sync_scheduler cancelled")
        raise


def start_scheduler() -> None:
    global _task
    if _task is not None and not _task.done():
        return
    try:
        loop = asyncio.get_event_loop()
    except RuntimeError:
        return
    _task = loop.create_task(_scheduler_loop())


async def run_once() -> int:
    """Manual trigger for tests / debugging. Returns refreshed count."""
    return await _tick_once()
