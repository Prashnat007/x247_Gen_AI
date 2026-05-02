"""
Per-request user context. The frontend authenticates with Firebase and sends
a short-lived Firebase ID token in the 'Authorization: Bearer <token>' header
on every request. The middleware verifies the token's signature against
Firebase's public keys and places the validated UID into a ContextVar so any
data-layer function can scope reads/writes to the current user without changing
every endpoint signature.

Conventions:
  * Guests (no Authorization header) use the literal user_id "guest".
  * Authenticated users use the UID extracted from the verified Firebase token.
  * An Authorization header with an invalid or expired token yields HTTP 401.
  * Legacy documents that have no user_id field are treated as guest data
    so demo content keeps working for guests.
"""
import logging
from contextvars import ContextVar
from typing import Awaitable, Callable

from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response

logger = logging.getLogger("recall-x247.auth")

GUEST_UID = "guest"

current_user_id_var: ContextVar[str] = ContextVar("current_user_id", default=GUEST_UID)


def get_uid() -> str:
    """Return the user_id for the current request (defaults to 'guest')."""
    return current_user_id_var.get()


def is_guest(uid: str | None = None) -> bool:
    return (uid if uid is not None else get_uid()) == GUEST_UID


def require_auth() -> str:
    """Reject guest requests on endpoints that expose per-user state.

    GUEST_UID is a SHARED identity for every unauthenticated client, so
    any endpoint that scopes by `get_uid()` would still leak across all
    guests if it accepted them. Use this on debug/inspection surfaces
    (workflow trace, chat history, history clears, specialist history)
    where leakage between guests is not acceptable.

    Raises HTTPException(401) when the request has no Firebase token.
    """
    uid = get_uid()
    if uid == GUEST_UID:
        raise HTTPException(
            status_code=401,
            detail="Authentication required.",
        )
    return uid


def belongs_to_current_user(doc: dict) -> bool:
    """True if the document's user_id matches the current request's user.

    Checks both `user_id` and the legacy camelCase `userId` field that the
    capture pipeline writes. Untagged legacy docs fall back to guest ownership
    so demo content still surfaces for guests.
    """
    if not isinstance(doc, dict):
        return False
    owner = doc.get("user_id") or doc.get("userId") or GUEST_UID
    return owner == get_uid()


def stamp(doc: dict) -> dict:
    """Tag a doc with the current user_id (in place) and return it.

    Writes both snake_case and camelCase variants so legacy code that reads
    `userId` keeps working alongside the new scoping logic.
    """
    if isinstance(doc, dict):
        uid = get_uid()
        doc["user_id"] = uid
        doc["userId"] = uid
    return doc


# ─── Firebase Admin SDK (token verification) ─────────────────────────────────
_fb_app = None
_fb_init_attempted = False


def _get_firebase_auth():
    """Return the firebase_admin.auth module, initialising the app once.

    Returns None if firebase_admin is unavailable or initialisation fails,
    in which case all tokens are treated as invalid.
    """
    global _fb_app, _fb_init_attempted
    if _fb_init_attempted:
        return _fb_app

    _fb_init_attempted = True
    try:
        import json
        import os
        import firebase_admin
        from firebase_admin import auth as fb_auth

        # Resolve the Firebase project ID so token verification works even
        # when ADC does not carry it (e.g. when running with a key file that
        # belongs to a different project than the one hosting the app).
        project_id = os.getenv("FIREBASE_PROJECT_ID") or os.getenv("GCP_PROJECT_ID")
        if not project_id:
            config_path = "firebase-applet-config.json"
            if os.path.exists(config_path):
                try:
                    with open(config_path) as f:
                        project_id = json.load(f).get("projectId")
                except Exception:
                    pass

        try:
            firebase_admin.get_app()
        except ValueError:
            options = {"projectId": project_id} if project_id else {}
            firebase_admin.initialize_app(options=options)

        _fb_app = fb_auth
        logger.info("Firebase Admin SDK initialised (project=%s)", project_id)
    except Exception as exc:
        logger.error("Firebase Admin SDK init failed — token auth disabled: %s", exc)
        _fb_app = None

    return _fb_app


def verify_firebase_token(token: str) -> str | None:
    """Verify a Firebase ID token and return the uid, or None on failure."""
    fb_auth = _get_firebase_auth()
    if fb_auth is None:
        return None
    try:
        decoded = fb_auth.verify_id_token(token, check_revoked=False)
        return decoded.get("uid")
    except Exception as exc:
        logger.debug("Token verification failed: %s", exc)
        return None


# ─── Middleware ───────────────────────────────────────────────────────────────

class UserContextMiddleware(BaseHTTPMiddleware):
    async def dispatch(
        self, request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        auth_header = request.headers.get("Authorization", "")

        if auth_header.startswith("Bearer "):
            token = auth_header[7:].strip()
            uid = verify_firebase_token(token)
            if uid is None:
                return JSONResponse(
                    status_code=401,
                    content={"detail": "Invalid or expired authentication token."},
                )
        else:
            uid = GUEST_UID

        token_ctx = current_user_id_var.set(uid)
        try:
            return await call_next(request)
        finally:
            current_user_id_var.reset(token_ctx)
