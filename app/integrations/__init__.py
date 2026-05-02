"""
Integration credential abstraction.

`get_connection(name)` returns a normalised dict
`{access_token, source, ...}` for a third-party integration. It tries
the Replit credential proxy first (if the connector OAuth flow has
been completed by the user), then falls back to a manual
environment-secret token (for self-hosted or local-dev scenarios where
the Replit proxy isn't available).

Per-integration helpers may add more fields to the dict (workspace
name, scopes, expiry hint, etc.) — callers should treat the dict as a
read-only snapshot and re-call `get_connection` if a request 401s
rather than caching.

Errors:
  * `NotConnectedError` — the integration isn't authorised in any
    available source. UI should surface a Connect button.
  * `IntegrationError` — the external API itself returned a hard
    error (4xx/5xx after retries). Callers should propagate to the
    HTTP layer with a sensible status code.
"""
from __future__ import annotations

import asyncio
import logging
import os
from typing import Any, Awaitable, Callable, Dict, Optional, TypeVar

import httpx

logger = logging.getLogger(__name__)


class NotConnectedError(Exception):
    """Raised when no credential source is available for an integration."""

    def __init__(self, integration: str, hint: str = ""):
        self.integration = integration
        self.hint = hint
        super().__init__(
            f"{integration} is not connected." + (f" {hint}" if hint else "")
        )


class IntegrationError(Exception):
    """Raised when a third-party API call ultimately fails."""

    def __init__(self, message: str, status_code: int = 502):
        self.status_code = status_code
        super().__init__(message)


_REPLIT_HOSTNAME_ENV = "REPLIT_CONNECTORS_HOSTNAME"
_REPL_IDENTITY_ENV = "REPL_IDENTITY"
_WEB_REPL_RENEWAL_ENV = "WEB_REPL_RENEWAL"

# Task #81 — Integration credentials are app-global by design (one Replit
# OAuth grant per deployed app, or one shared env-secret token). That
# means *any* request to `/integrations/*` would otherwise let arbitrary
# callers act as the app owner against the connected Notion / Gmail /
# Slack workspace. To prevent that, every integration endpoint now
# checks the requesting Firebase UID against an explicit allowlist.
#
# `INTEGRATION_OWNER_UIDS` is a comma-separated list of Firebase UIDs
# that are permitted to use the app's connected integrations. Set it to
# a single UID for a single-owner deployment, or to several UIDs for a
# small team. **If the env var is unset or empty, no one is treated as
# the owner** — this is a deliberate fail-closed default so a fresh
# deploy doesn't accidentally hand the owner's mailbox to whoever signs
# up first. The owner-only check returns 403 in that case (and 401 for
# unauthenticated guests) so the UI can render a helpful "ask an admin
# to add your UID" message.
_INTEGRATION_OWNER_UIDS_ENV = "INTEGRATION_OWNER_UIDS"

# Module-level flag for throttling the "allowlist unset" warning. Reset
# on import (e.g. dev reload), so each fresh process logs the misconfig
# exactly once even if many clients hammer integration endpoints.
_empty_allowlist_warned: bool = False


_MANUAL_TOKEN_ENVS: Dict[str, str] = {
    "notion": "NOTION_INTEGRATION_TOKEN",
    # P5B — Gmail. Manual token path is rarely used (Google requires OAuth
    # access tokens that expire hourly), but kept for parity with notion so
    # local dev / cron jobs can paste a refreshed access token.
    "gmail": "GMAIL_ACCESS_TOKEN",
    # P5C — Slack. Bot tokens (xoxb-...) don't expire, so the manual path
    # is genuinely useful here for self-hosted or scripted setups. Needs
    # `channels:read`, `groups:read`, `channels:history`, `groups:history`
    # at minimum to list channels and read threads.
    "slack": "SLACK_BOT_TOKEN",
}

# P5B — Replit's connectors-v2 namespaces some providers under different
# names than what callers naturally use. We use friendly names internally
# ("gmail") and remap to the proxy's canonical name ("google-mail") when
# hitting the credentials endpoint.
_REPLIT_CONNECTOR_NAME_ALIASES: Dict[str, str] = {
    "gmail": "google-mail",
}


async def _try_replit_proxy(connector_name: str) -> Optional[Dict[str, Any]]:
    """Hit the Replit credentials proxy. Returns the raw connection
    dict on success, None when the proxy isn't reachable / has no
    matching connection. Never raises — proxy unavailability is a
    normal "fall back to manual token" signal."""
    hostname = os.environ.get(_REPLIT_HOSTNAME_ENV)
    token = os.environ.get(_REPL_IDENTITY_ENV) or os.environ.get(
        _WEB_REPL_RENEWAL_ENV
    )
    if not hostname or not token:
        return None
    url = (
        f"https://{hostname}/api/v2/connection"
        f"?connector_names={connector_name}&include_secrets=true"
    )
    headers = {
        "Accept": "application/json",
        "X_REPLIT_TOKEN": token,
    }
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            r = await client.get(url, headers=headers)
            if r.status_code != 200:
                return None
            data = r.json() or {}
    except (httpx.HTTPError, ValueError) as e:
        logger.info(f"replit proxy unreachable for {connector_name}: {e}")
        return None
    items = data.get("items") if isinstance(data, dict) else None
    if not items:
        return None
    # Items is a list of {connector_name, settings:{...}, ...}. We grab
    # the first matching connector and surface its settings as our
    # connection dict — Notion lives under settings.access_token.
    for it in items:
        cn = (it.get("connector_name") or "").lower()
        if cn != connector_name.lower():
            continue
        settings = it.get("settings") or {}
        access_token = settings.get("access_token") or settings.get(
            "oauth", {}
        ).get("credentials", {}).get("access_token")
        if not access_token:
            continue
        meta = settings.get("oauth", {}).get("metadata", {}) or {}
        # Google connectors stash the user's email under metadata.email
        # rather than workspace_name; surface it via the same field so
        # the UI doesn't need to special-case providers.
        workspace_name = meta.get("workspace_name", "") or meta.get(
            "email", ""
        ) or meta.get("name", "")
        return {
            "access_token": access_token,
            "source": "replit_oauth",
            "workspace_name": workspace_name,
            "workspace_icon": meta.get("workspace_icon", ""),
            "workspace_id": meta.get("workspace_id", ""),
            "scopes": settings.get("oauth", {}).get("scopes", []) or [],
            "email": meta.get("email", ""),
        }
    return None


def _try_env_token(integration: str) -> Optional[Dict[str, Any]]:
    env_key = _MANUAL_TOKEN_ENVS.get(integration)
    if not env_key:
        return None
    raw = (os.environ.get(env_key) or "").strip()
    if not raw:
        return None
    return {
        "access_token": raw,
        "source": "manual_token",
        "workspace_name": "",
        "scopes": [],
    }


async def get_connection(name: str) -> Dict[str, Any]:
    """Return a credential dict for `name` or raise NotConnectedError.

    Resolution order:
      1. Replit credentials proxy (OAuth completed via proposeIntegration)
      2. Manual env-secret token (e.g. NOTION_INTEGRATION_TOKEN)
    """
    integration = (name or "").strip().lower()
    if not integration:
        raise NotConnectedError("(unknown)", "Empty integration name.")
    # The credentials proxy uses provider-specific names that don't always
    # match our internal label (e.g. "google-mail" vs "gmail"). Resolve
    # via the alias table before hitting the proxy.
    proxy_name = _REPLIT_CONNECTOR_NAME_ALIASES.get(integration, integration)
    proxy_conn = await _try_replit_proxy(proxy_name)
    if proxy_conn:
        return proxy_conn
    env_conn = _try_env_token(integration)
    if env_conn:
        return env_conn
    hint = (
        "Connect via the Integrations page or set the "
        f"{_MANUAL_TOKEN_ENVS.get(integration, '')} environment secret."
    ).strip()
    raise NotConnectedError(integration, hint)


def allowed_integration_owner_uids() -> set[str]:
    """Parse `INTEGRATION_OWNER_UIDS` into a set of stripped UIDs.
    Empty/unset env var → empty set (fail-closed: nobody is an owner).

    Public so both the per-request gate (`require_integration_owner`)
    and out-of-request consumers (e.g. notion_sync_scheduler) can share
    the same ownership policy without reaching into a private helper.
    """
    raw = (os.environ.get(_INTEGRATION_OWNER_UIDS_ENV) or "").strip()
    if not raw:
        return set()
    return {part.strip() for part in raw.split(",") if part.strip()}


# Backwards-compat alias — older imports may still reference the
# underscore-prefixed name. Safe to delete once no caller imports it.
_allowed_integration_owner_uids = allowed_integration_owner_uids


def is_integration_owner() -> bool:
    """True if the current request's Firebase UID is in the integration
    owner allowlist. False for guests and for authenticated users not on
    the list. Status endpoints use this to silently downgrade their
    response to `{connected: false}` for non-owners — that way the UI
    never has to special-case "you're authed but not the owner" vs
    "integration genuinely not connected", AND we don't leak the fact
    that the app owner has connected a particular integration to other
    signed-in users.
    """
    # Local import to avoid a circular dependency at module load
    # (`app.user_context` imports `fastapi` which is also imported here
    # transitively in some scheduler entrypoints).
    from app.user_context import get_uid, GUEST_UID

    uid = get_uid()
    if uid == GUEST_UID:
        return False
    allowed = allowed_integration_owner_uids()
    if not allowed:
        return False
    return uid in allowed


def require_integration_owner() -> str:
    """Raise an HTTPException unless the current request is from an
    authenticated user on the integration-owner allowlist. Returns the
    owner UID on success so callers can use it for downstream scoping
    without re-importing `get_uid`.

    Raises:
      * 401 — unauthenticated (guest). Distinct from 403 so the frontend
        can prompt for sign-in vs surface "ask an admin" messaging.
      * 403 — authenticated but not in the allowlist (or allowlist is
        unset/empty, which is the fail-closed default).
    """
    # Imported lazily — see is_integration_owner() above.
    from fastapi import HTTPException

    from app.user_context import get_uid, GUEST_UID

    uid = get_uid()
    if uid == GUEST_UID:
        raise HTTPException(
            status_code=401,
            detail="Authentication required to use integrations.",
        )
    allowed = allowed_integration_owner_uids()
    if not allowed:
        # Fail-closed: don't tell non-owners *which* env var to ask the
        # admin to set — that's an internal-ops detail. The ops-side log
        # below makes it easy for the owner to discover the misconfig
        # from the server logs without exposing config to clients.
        # Throttled to once per process so a probing client (or normal
        # IntegrationsPage polling for non-owners) can't flood the log.
        global _empty_allowlist_warned
        if not _empty_allowlist_warned:
            _empty_allowlist_warned = True
            logger.warning(
                "integrations: %s is unset — every integration call will "
                "be rejected with 403 until an owner UID is configured. "
                "(further occurrences suppressed)",
                _INTEGRATION_OWNER_UIDS_ENV,
            )
        raise HTTPException(
            status_code=403,
            detail=(
                "Integrations are restricted to the app owner. "
                "Ask an administrator to grant your account access."
            ),
        )
    if uid not in allowed:
        raise HTTPException(
            status_code=403,
            detail=(
                "Integrations are restricted to the app owner. "
                "Ask an administrator to grant your account access."
            ),
        )
    return uid


T = TypeVar("T")


async def with_backoff(
    fn: Callable[[], Awaitable[T]],
    *,
    retries: int = 3,
    base_delay: float = 0.5,
    retry_status: tuple = (429, 500, 502, 503, 504),
) -> T:
    """Retry an async API call with exponential backoff. Retries on
    httpx network errors and on `IntegrationError` whose status_code
    is in `retry_status`. Re-raises the last error after `retries`
    attempts."""
    last_err: Optional[Exception] = None
    for attempt in range(max(1, retries)):
        try:
            return await fn()
        except IntegrationError as e:
            last_err = e
            if e.status_code not in retry_status:
                raise
        except (httpx.HTTPError, asyncio.TimeoutError) as e:
            last_err = e
        delay = base_delay * (2 ** attempt)
        logger.info(f"integration backoff sleep={delay:.2f}s after {last_err}")
        await asyncio.sleep(delay)
    if last_err:
        raise last_err
    raise IntegrationError("with_backoff: exhausted retries")
