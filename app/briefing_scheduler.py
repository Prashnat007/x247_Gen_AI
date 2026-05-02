"""Background scheduler for daily briefing notifications.

Runs as a single asyncio task started by FastAPI's `startup_event`. Every
`TICK_INTERVAL_SECONDS` it scans `briefing_settings` for users who have
notifications enabled, and for each one whose local time has crossed their
configured send hour (and who hasn't been notified today) it pre-generates
the briefing and writes a notification doc the frontend can poll.

Design notes:
  * One process-wide task — no APScheduler dependency, no second worker.
  * Idempotent. `should_send_now` checks `last_notified_date`, and
    `mark_user_notified` is updated as soon as we deliver, so even if the
    tick interval is short or the task restarts mid-run we never push twice.
  * Errors per-user are swallowed so one bad account never blocks the others.

Operational note:
  This scheduler assumes a single process. The `last_notified_date` field
  in `briefing_settings` does provide cross-process de-duplication, but
  only at minute-level granularity — under heavy multi-instance scaling
  two workers ticking at the same second could both send before either
  records the marker. If we ever scale beyond one Cloud Run instance we
  should add a Firestore-backed lease (e.g. `briefing_scheduler_lock`
  doc + transactional check) to coordinate which instance owns the tick.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Optional

from app.briefing_agent import (
    deliver_briefing_notification,
    list_users_with_notifications_enabled,
    should_send_now,
)

logger = logging.getLogger(__name__)

# Tick every 5 minutes — small enough that a user who sets their hour to 8
# gets notified by 8:05 at the latest, large enough that the scan stays
# inexpensive even with many users.
TICK_INTERVAL_SECONDS = 5 * 60

_task: Optional[asyncio.Task] = None
_running = False


async def _tick_once() -> int:
    """Run a single scheduler pass. Returns the number of users we
    delivered to so callers (tests, the manual /briefing/scheduler/run
    endpoint) can observe the outcome."""
    delivered = 0
    try:
        users = await list_users_with_notifications_enabled()
    except Exception as e:
        logger.warning(f"briefing_scheduler list_users error: {e}")
        return 0
    for s in users:
        uid = s.get("user_id") or ""
        if not uid:
            continue
        try:
            if not should_send_now(s):
                continue
            await deliver_briefing_notification(uid)
            delivered += 1
        except Exception as e:
            logger.warning(f"briefing_scheduler delivery skipped for {uid}: {e}")
    if delivered:
        logger.info(f"briefing_scheduler: delivered {delivered} notifications")
    return delivered


async def _scheduler_loop() -> None:
    global _running
    _running = True
    logger.info(
        f"briefing_scheduler started (tick every {TICK_INTERVAL_SECONDS}s)"
    )
    # Small initial delay so we don't race the rest of the startup hooks.
    await asyncio.sleep(15)
    try:
        while _running:
            try:
                await _tick_once()
            except Exception as e:
                logger.warning(f"briefing_scheduler tick error: {e}")
            await asyncio.sleep(TICK_INTERVAL_SECONDS)
    except asyncio.CancelledError:
        logger.info("briefing_scheduler cancelled")
        raise


def start_scheduler() -> None:
    """Spawn the scheduler task. Safe to call multiple times — subsequent
    calls return immediately if the task is already running."""
    global _task
    if _task is not None and not _task.done():
        return
    try:
        loop = asyncio.get_event_loop()
    except RuntimeError:
        return
    _task = loop.create_task(_scheduler_loop())


async def run_once() -> int:
    """Manual trigger for tests / debugging. Returns the delivery count."""
    return await _tick_once()
