"""
Slack Web API client. Uses the public REST surface
(`https://slack.com/api/...`) directly via httpx — no SDK dependency.
The token is supplied by `app.integrations.get_connection("slack")`
(Replit OAuth proxy under the connector name `slack`, or fallback
`SLACK_BOT_TOKEN`).

Slack returns 200 with `{ok:false, error:"invalid_auth"}` on bad creds
rather than a 401, so `_request` translates the well-known
auth-failure errors into `NotConnectedError` and the rest into
`IntegrationError`. Callers should catch both — `NotConnectedError` is
a "show the Connect button" signal, `IntegrationError` is a real API
failure that's worth surfacing in a toast.

Thread URL parsing (`parse_thread_url`) accepts the standard Slack web
URL shape `https://<workspace>.slack.com/archives/<channel_id>/p<ts>`
where `p<ts>` is the message ts with the dot stripped (e.g.
`p1234567890123456` → `1234567890.123456`). When the URL has a
`?thread_ts=` query param (the case for a reply inside a thread) we
prefer that over the path ts so we always import the *parent* thread's
full conversation, not just the reply slice.
"""
from __future__ import annotations

import logging
import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import parse_qs, urlparse

import httpx

from app.integrations import (
    IntegrationError,
    NotConnectedError,
    with_backoff,
)

logger = logging.getLogger(__name__)


_SLACK_BASE = "https://slack.com/api"
_HTTP_TIMEOUT = 20.0
# Slack returns each `ok:false` with one of these well-known error
# codes when the bot token is bad/expired/scope-stripped. We want
# every one of them to surface to the UI as "Connect required" rather
# than a generic 502 — otherwise the user sees a useless "Slack API
# error" instead of a Connect button.
_AUTH_ERROR_CODES = {
    "invalid_auth",
    "not_authed",
    "account_inactive",
    "token_revoked",
    "token_expired",
    "no_permission",
    "missing_scope",
}
# Cap thread fetches at this many messages so an enormous thread
# (a long-running incident channel, etc.) can't blow the import
# request's response time. Slack's per-page max is 1000 but we never
# need more than ~200 to capture meaningful context.
_MAX_THREAD_MESSAGES = 200


def _client(conn: Dict[str, Any]) -> httpx.AsyncClient:
    """Build an authenticated httpx client. Caller owns the lifecycle
    (`async with _client(conn) as c:`)."""
    token = (conn or {}).get("access_token") or ""
    if not token:
        raise NotConnectedError(
            "slack", "Connection dict missing access_token."
        )
    return httpx.AsyncClient(
        base_url=_SLACK_BASE,
        timeout=_HTTP_TIMEOUT,
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
        },
    )


async def _request(
    conn: Dict[str, Any],
    method: str,
    path: str,
    *,
    params: Optional[Dict[str, Any]] = None,
    data: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Single Slack API call wrapped in `with_backoff`. Translates
    Slack's `ok:false` envelope into our typed exceptions so the HTTP
    layer can map them cleanly to 401 / 502."""

    async def _do() -> Dict[str, Any]:
        async with _client(conn) as c:
            r = await c.request(method, path, params=params, data=data)
            # Slack returns 200 even for auth failures — we have to
            # inspect the body, not the status. But we still treat raw
            # 5xx / 429 as transport errors so backoff retries them.
            if r.status_code == 429:
                raise IntegrationError(
                    f"slack {path} rate-limited", status_code=429
                )
            if r.status_code >= 500:
                raise IntegrationError(
                    f"slack {path} -> {r.status_code} {r.text[:240]}",
                    status_code=r.status_code,
                )
            try:
                body = r.json() or {}
            except ValueError:
                raise IntegrationError(
                    f"slack {path} returned non-JSON: {r.text[:200]}",
                    status_code=502,
                )
            if not body.get("ok"):
                err = (body.get("error") or "unknown_error").lower()
                if err in _AUTH_ERROR_CODES:
                    raise NotConnectedError(
                        "slack",
                        f"Slack returned {err} — reconnect required.",
                    )
                raise IntegrationError(
                    f"slack {path} -> ok=false error={err}",
                    status_code=502,
                )
            return body

    return await with_backoff(_do)


# ────────────────────────────────────────────────────────────────────
# Public helpers
# ────────────────────────────────────────────────────────────────────


async def auth_test(conn: Dict[str, Any]) -> Dict[str, Any]:
    """Confirm the token works and surface workspace metadata. Used by
    /integrations/slack/status to render `Connected as <user> at <team>`."""
    body = await _request(conn, "GET", "/auth.test")
    return {
        "team": body.get("team") or "",
        "team_id": body.get("team_id") or "",
        "user": body.get("user") or "",
        "user_id": body.get("user_id") or "",
        "url": body.get("url") or "",
    }


async def list_channels(
    conn: Dict[str, Any], limit: int = 200
) -> List[Dict[str, Any]]:
    """List channels visible to the bot. Public + private only — DMs
    and group DMs are intentionally excluded so the channel picker
    doesn't leak personal conversations into a "save thread" UX. Sorted
    so private channels follow public ones, alphabetical within each.
    """
    capped = max(1, min(int(limit or 200), 1000))
    body = await _request(
        conn,
        "GET",
        "/conversations.list",
        params={
            "types": "public_channel,private_channel",
            "exclude_archived": "true",
            "limit": capped,
        },
    )
    channels = body.get("channels") or []
    out: List[Dict[str, Any]] = []
    for ch in channels:
        out.append(
            {
                "id": ch.get("id") or "",
                "name": ch.get("name") or "",
                "is_private": bool(ch.get("is_private")),
                "is_member": bool(ch.get("is_member")),
                "topic": ((ch.get("topic") or {}).get("value") or "")[:160],
            }
        )
    out.sort(
        key=lambda c: (c.get("is_private", False), (c.get("name") or "").lower())
    )
    return out


async def fetch_thread(
    conn: Dict[str, Any], channel_id: str, thread_ts: str
) -> Dict[str, Any]:
    """Fetch every message in a thread plus a stable permalink.

    Returns `{messages: [{user, text, ts}], permalink, channel_id,
    thread_ts}`. `messages` is in chronological order (Slack returns
    them that way already). `user` is the raw user id — resolving to a
    display name would require an extra `users.info` round-trip per
    unique participant, which we skip in MVP for latency reasons; the
    memory body shows `<@UXXXX>` and Slack will resolve those to names
    when the user clicks the permalink back.
    """
    if not channel_id or not thread_ts:
        raise IntegrationError(
            "fetch_thread: channel_id and thread_ts are required",
            status_code=400,
        )
    messages: List[Dict[str, Any]] = []
    cursor: Optional[str] = None
    while True:
        params: Dict[str, Any] = {
            "channel": channel_id,
            "ts": thread_ts,
            "limit": 200,
        }
        if cursor:
            params["cursor"] = cursor
        body = await _request(
            conn, "GET", "/conversations.replies", params=params
        )
        for m in body.get("messages") or []:
            messages.append(
                {
                    "user": m.get("user") or m.get("bot_id") or "",
                    "text": m.get("text") or "",
                    "ts": m.get("ts") or "",
                }
            )
            if len(messages) >= _MAX_THREAD_MESSAGES:
                break
        if len(messages) >= _MAX_THREAD_MESSAGES:
            break
        cursor = ((body.get("response_metadata") or {}).get("next_cursor") or "")
        if not cursor:
            break

    # Permalink call uses the parent ts (= thread_ts) so the URL lands
    # at the top of the thread sidebar. We fall through with an empty
    # string when the call fails — the caller already has the inputs to
    # reconstruct a fallback URL if needed.
    permalink = ""
    try:
        plink = await _request(
            conn,
            "GET",
            "/chat.getPermalink",
            params={"channel": channel_id, "message_ts": thread_ts},
        )
        permalink = plink.get("permalink") or ""
    except (IntegrationError, NotConnectedError) as e:
        logger.warning(f"slack: chat.getPermalink failed: {e}")

    return {
        "messages": messages,
        "permalink": permalink,
        "channel_id": channel_id,
        "thread_ts": thread_ts,
    }


# ────────────────────────────────────────────────────────────────────
# URL parsing
# ────────────────────────────────────────────────────────────────────


_SLACK_URL_RE = re.compile(
    r"^https?://[^/]*\.slack\.com/archives/(?P<channel>[A-Z0-9]+)/p(?P<ts_no_dot>\d+)",
    re.IGNORECASE,
)

# Slack ts wire format is `<unix_seconds>.<microseconds>`, where the
# microseconds slice is exactly 6 digits. We use this to validate
# user-supplied `?thread_ts=` values *before* hitting the Slack API,
# so a copy-paste typo surfaces as 400 from our endpoint instead of
# bubbling up as a confusing 502 from a downstream Slack error.
_TS_RE = re.compile(r"^\d+\.\d{6}$")


def parse_thread_url(url: str) -> Tuple[str, str]:
    """Pull `(channel_id, thread_ts)` out of a Slack web URL.

    Examples accepted:
      * `https://acme.slack.com/archives/C0123ABCD/p1700000000123456`
      * Same URL with a `?thread_ts=1699999999.000200&cid=C0123ABCD`
        suffix (the case for a click on a reply — we prefer the query
        `thread_ts` so the import always anchors on the parent
        message, not the reply.)

    Raises `IntegrationError(status_code=400)` on malformed input —
    the endpoint translates that to a 400 Bad Request with the same
    message so the UI can show "Paste a Slack thread URL".
    """
    if not url or not isinstance(url, str):
        raise IntegrationError("Empty Slack URL.", status_code=400)
    m = _SLACK_URL_RE.match(url.strip())
    if not m:
        raise IntegrationError(
            "Not a Slack thread URL — expected "
            "https://<workspace>.slack.com/archives/<channel>/p<ts>",
            status_code=400,
        )
    channel_id = m.group("channel")
    ts_no_dot = m.group("ts_no_dot")
    # Slack ts is `seconds.microseconds`; the URL form drops the dot.
    # The dot always sits 6 digits from the right (microsecond part).
    if len(ts_no_dot) <= 6:
        raise IntegrationError(
            f"Slack URL ts looks malformed: {ts_no_dot}", status_code=400
        )
    path_ts = ts_no_dot[:-6] + "." + ts_no_dot[-6:]

    # Prefer the query-string thread_ts when present (links from inside
    # a reply expose the parent ts there). We strictly validate the
    # query value against the canonical `<seconds>.<microseconds>`
    # shape — a malformed query string would otherwise bypass our
    # parsing and surface as a downstream 502 from Slack.
    parsed = urlparse(url)
    qs = parse_qs(parsed.query or "")
    query_ts_list = qs.get("thread_ts") or []
    if query_ts_list:
        candidate = query_ts_list[0].strip()
        if not _TS_RE.match(candidate):
            raise IntegrationError(
                f"Slack URL ?thread_ts= value is malformed: {candidate}",
                status_code=400,
            )
        thread_ts = candidate
    else:
        thread_ts = path_ts
    return channel_id, thread_ts


# ────────────────────────────────────────────────────────────────────
# Memory import
# ────────────────────────────────────────────────────────────────────


def _format_thread_body(
    channel_name: str,
    started_at: str,
    permalink: str,
    messages: List[Dict[str, Any]],
) -> str:
    """Compose the markdown body stored on the memory. Quoted-line
    style mirrors Slack's "copy thread" output so the recall view
    feels familiar."""
    lines: List[str] = []
    if channel_name:
        lines.append(f"**Channel:** #{channel_name}")
    if started_at:
        lines.append(f"**Started:** {started_at}")
    if permalink:
        lines.append(f"**Thread:** {permalink}")
    lines.append("")
    for m in messages:
        user = m.get("user") or "unknown"
        text = (m.get("text") or "").strip()
        if not text:
            continue
        # Quoting each message keeps multi-line replies readable in
        # markdown renderers without each line bleeding into the next
        # speaker's turn.
        quoted = "\n> ".join(text.split("\n"))
        lines.append(f"> **<@{user}>:** {quoted}")
    return "\n".join(lines).strip()


def _ts_to_iso(ts: str) -> str:
    """Slack ts → ISO-8601 UTC. Falls back to the raw ts on parse
    failure so the field is never lost."""
    try:
        seconds = float(ts)
    except (TypeError, ValueError):
        return ts or ""
    try:
        return datetime.fromtimestamp(seconds, tz=timezone.utc).isoformat()
    except (OverflowError, OSError, ValueError):
        return ts or ""


async def import_thread_as_memory(
    conn: Dict[str, Any],
    channel_id: str,
    thread_ts: str,
    user_id: str,
) -> Dict[str, Any]:
    """Idempotent import of a Slack thread as a single memory.

    Identification:
      * `external_refs` row keyed by `source=slack`,
        `source_id=<channel_id>:<thread_ts>` so re-importing the same
        thread updates the same memory rather than duplicating it.
      * `source_url` is the Slack permalink (when available) so the
        URL-dedup in `save_memory` provides a second safety net.

    Returns `{memory_id, channel_id, thread_ts, title, url, created,
    updated, message_count}`.
    """
    # Local imports — these modules pull a lot of FastAPI / Firestore
    # state and create cycles if loaded at module import time.
    from app import external_refs as _ext
    from app.capture_agent import save_memory
    from app.db import get_db
    from app.user_context import current_user_id_var

    if not channel_id or not thread_ts:
        raise IntegrationError(
            "import_thread_as_memory: channel_id and thread_ts are required",
            status_code=400,
        )

    fetched = await fetch_thread(conn, channel_id, thread_ts)
    messages = fetched["messages"]
    permalink = fetched["permalink"]

    # Fall back to a workspace-qualified Slack URL if chat.getPermalink
    # fails (e.g. private channel + non-member bot). We derive the
    # workspace base URL from auth.test on demand because the bare
    # `slack.com/archives/...` shape doesn't reliably resolve to a
    # specific workspace's thread for users who are signed into
    # multiple workspaces.
    if not permalink:
        ts_no_dot = thread_ts.replace(".", "")
        workspace_base = ""
        try:
            who = await auth_test(conn)
            workspace_base = (who.get("url") or "").rstrip("/")
        except (IntegrationError, NotConnectedError) as e:
            logger.warning(f"slack: auth.test for fallback URL failed: {e}")
        if workspace_base:
            permalink = f"{workspace_base}/archives/{channel_id}/p{ts_no_dot}"
        else:
            permalink = f"https://slack.com/archives/{channel_id}/p{ts_no_dot}"

    # Resolve the channel name once so the memory title isn't a raw
    # `C0123ABCD` id. If the lookup fails we fall through with an
    # empty name — title will read "Slack thread (5 messages)".
    channel_name = ""
    try:
        info = await _request(
            conn, "GET", "/conversations.info", params={"channel": channel_id}
        )
        channel_name = ((info.get("channel") or {}).get("name") or "")
    except (IntegrationError, NotConnectedError) as e:
        logger.warning(f"slack: conversations.info failed: {e}")

    started_at = _ts_to_iso(thread_ts)
    first_msg = messages[0] if messages else {}
    first_text = (first_msg.get("text") or "").strip().split("\n", 1)[0]
    snippet = first_text[:120] if first_text else ""
    title = (
        f"#{channel_name}: {snippet}"
        if channel_name and snippet
        else f"#{channel_name} thread"
        if channel_name
        else f"Slack thread ({len(messages)} messages)"
    )
    composed = _format_thread_body(channel_name, started_at, permalink, messages)
    source_id = f"{channel_id}:{thread_ts}"

    token = None
    if user_id:
        token = current_user_id_var.set(user_id)
    try:
        existing_ref = await _find_existing_ref(source_id)
        existing_memory_id = (existing_ref or {}).get("memory_id") or ""
        memory_id = ""
        created = False
        updated = False

        if existing_memory_id:
            db = await get_db()
            await db.collection("memories").document(existing_memory_id).update(
                {
                    "title": title,
                    "summary": composed[:4000],
                    "executive_summary": (composed or title)[:500],
                    "source_type": "slack_thread",
                    "source_url": permalink,
                    "slack_channel_id": channel_id,
                    "slack_channel_name": channel_name,
                    "slack_thread_ts": thread_ts,
                    "slack_message_count": len(messages),
                }
            )
            memory_id = existing_memory_id
            updated = True
        else:
            saved = await save_memory(
                {
                    "title": title,
                    "summary": composed or title,
                    "source_type": "slack_thread",
                    "source_url": permalink,
                    "tags": ["slack", "thread"],
                    "slack_channel_id": channel_id,
                    "slack_channel_name": channel_name,
                    "slack_thread_ts": thread_ts,
                    "slack_message_count": len(messages),
                },
                user_id=user_id,
            )
            memory_id = saved.get("id") or saved.get("memory_id") or ""
            if saved.get("duplicate"):
                updated = True
            else:
                created = True

        if not existing_ref and memory_id:
            try:
                await _ext.create_external_ref(
                    memory_id=memory_id,
                    source="slack",
                    source_id=source_id,
                    title=title,
                    url=permalink,
                    snippet=(composed or "")[:500],
                )
            except Exception as e:
                logger.warning(f"slack: external_ref create failed: {e}")
    finally:
        if token is not None:
            current_user_id_var.reset(token)

    return {
        "memory_id": memory_id,
        "channel_id": channel_id,
        "thread_ts": thread_ts,
        "title": title,
        "url": permalink,
        "created": created,
        "updated": updated,
        "message_count": len(messages),
    }


async def _find_existing_ref(source_id: str) -> Optional[Dict[str, Any]]:
    """Find an external_ref row whose source=slack +
    source_id=<channel>:<thread_ts> for the *current* user (caller
    ensures the user_context is set)."""
    from app.db import get_db
    from app.user_context import belongs_to_current_user

    if not source_id:
        return None
    db = await get_db()
    snap = await db.collection("external_refs").get()
    for d in snap:
        data = (d.to_dict() or {}) | {"id": d.id}
        if not belongs_to_current_user(data):
            continue
        if data.get("source") != "slack":
            continue
        if data.get("source_id") != source_id:
            continue
        return data
    return None
