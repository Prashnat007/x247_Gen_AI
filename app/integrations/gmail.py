"""
Gmail API client. Uses the public REST surface
(`https://gmail.googleapis.com/gmail/v1/users/me`) directly via httpx —
no SDK dependency. The token is supplied by
`app.integrations.get_connection("gmail")` (Replit OAuth proxy under
the connector name `google-mail`, or fallback `GMAIL_ACCESS_TOKEN`).

Body decoding: Gmail returns MIME parts as base64url-encoded blobs in
either a single part (for plain-text-only messages) or a recursive
parts tree (for multipart/alternative + multipart/mixed). We walk the
tree and prefer text/plain over text/html for the memory body, falling
back to a stripped-down version of text/html when no plain part exists.
Attachments are surfaced as metadata only — the actual byte fetch is
gated behind the import endpoint to keep `list_messages` snappy.
"""
from __future__ import annotations

import base64
import logging
import re
from email.utils import parseaddr
from typing import Any, Dict, List, Optional

import httpx

from app.integrations import (
    IntegrationError,
    NotConnectedError,
    with_backoff,
)

logger = logging.getLogger(__name__)


_GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me"
_HTTP_TIMEOUT = 20.0
# Snippet shown in capture pickers — Gmail returns ~200 chars natively
# but trimming further keeps the picker rows compact.
_SEARCH_SNIPPET_MAX = 160


def _client(conn: Dict[str, Any]) -> httpx.AsyncClient:
    """Build an authenticated httpx client. Caller owns the lifecycle
    (use as `async with _client(conn) as c:`)."""
    token = (conn or {}).get("access_token") or ""
    if not token:
        raise NotConnectedError(
            "gmail", "Connection dict missing access_token."
        )
    return httpx.AsyncClient(
        base_url=_GMAIL_BASE,
        timeout=_HTTP_TIMEOUT,
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
        },
    )


async def _request(
    conn: Dict[str, Any], method: str, path: str, **kwargs
) -> Dict[str, Any]:
    """Single Gmail API call wrapped in `with_backoff` so transient
    429/5xx are retried."""

    async def _do() -> Dict[str, Any]:
        async with _client(conn) as c:
            r = await c.request(method, path, **kwargs)
            if r.status_code == 401:
                raise NotConnectedError(
                    "gmail",
                    "Gmail returned 401 — the token expired or was revoked.",
                )
            if r.status_code >= 400:
                raise IntegrationError(
                    f"gmail {method} {path} -> {r.status_code} {r.text[:240]}",
                    status_code=r.status_code,
                )
            return r.json() or {}

    return await with_backoff(_do)


def _b64url_decode(data: str) -> bytes:
    """Gmail uses base64url without padding. Re-pad before decoding."""
    if not data:
        return b""
    # Replace - with + and _ with / per RFC 4648 §5; pad to multiple of 4.
    s = data.replace("-", "+").replace("_", "/")
    pad = (-len(s)) % 4
    s += "=" * pad
    try:
        return base64.b64decode(s)
    except Exception:
        return b""


def _strip_html(html: str) -> str:
    """Cheap HTML→text fallback when no text/plain part exists. Strips
    tags, collapses whitespace, decodes a handful of common entities.
    Good enough for capturing into a memory; the user can always click
    the back-link to see the rich version in Gmail."""
    if not html:
        return ""
    no_script = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", html, flags=re.S | re.I)
    no_tags = re.sub(r"<[^>]+>", " ", no_script)
    decoded = (
        no_tags.replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", '"')
        .replace("&#39;", "'")
    )
    return re.sub(r"\s+", " ", decoded).strip()


def _walk_parts(payload: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Flatten the recursive parts tree to a single list. Each entry is
    the raw part dict (mimeType, body, headers, filename...)."""
    out: List[Dict[str, Any]] = []
    if not payload:
        return out
    out.append(payload)
    for sub in payload.get("parts") or []:
        out.extend(_walk_parts(sub))
    return out


def _header(headers: List[Dict[str, str]], name: str) -> str:
    """Pull a single header value (case-insensitive)."""
    n = (name or "").lower()
    for h in headers or []:
        if (h.get("name") or "").lower() == n:
            return h.get("value") or ""
    return ""


def _extract_bodies_and_attachments(
    payload: Dict[str, Any],
) -> Dict[str, Any]:
    """Return `{body_text, body_html, attachments}` from a Gmail payload."""
    text_parts: List[str] = []
    html_parts: List[str] = []
    attachments: List[Dict[str, Any]] = []
    for part in _walk_parts(payload):
        mime = (part.get("mimeType") or "").lower()
        body = part.get("body") or {}
        filename = part.get("filename") or ""
        attachment_id = body.get("attachmentId") or ""
        # Real attachments always have a filename + attachmentId. Inline
        # images sometimes have a filename but no attachmentId — skip.
        if attachment_id and filename:
            attachments.append(
                {
                    "filename": filename,
                    "mime_type": part.get("mimeType") or "application/octet-stream",
                    "attachment_id": attachment_id,
                    "size": int(body.get("size") or 0),
                }
            )
            continue
        # Text bodies — base64url-decoded UTF-8.
        raw = body.get("data") or ""
        if not raw:
            continue
        decoded = _b64url_decode(raw).decode("utf-8", errors="replace")
        if mime == "text/plain":
            text_parts.append(decoded)
        elif mime == "text/html":
            html_parts.append(decoded)
    body_text = "\n\n".join(t.strip() for t in text_parts if t.strip())
    body_html = "\n".join(html_parts)
    if not body_text and body_html:
        body_text = _strip_html(body_html)
    return {
        "body_text": body_text,
        "body_html": body_html,
        "attachments": attachments,
    }


async def list_labels(conn: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Return every Gmail label visible to the connection. Labels include
    system labels (INBOX, STARRED, IMPORTANT, ...) and user-created labels.
    Sorted by name with system labels first so the UI can render a stable
    picker without a second sort."""
    data = await _request(conn, "GET", "/labels")
    out: List[Dict[str, Any]] = []
    for lab in data.get("labels") or []:
        out.append(
            {
                "id": lab.get("id") or "",
                "name": lab.get("name") or "",
                "type": (lab.get("type") or "user").lower(),
            }
        )
    # System labels (INBOX, STARRED, ...) first, then user labels alpha.
    out.sort(
        key=lambda l: (l.get("type") != "system", (l.get("name") or "").lower())
    )
    return out


async def list_messages(
    conn: Dict[str, Any],
    label_id: Optional[str] = None,
    query: Optional[str] = None,
    max_results: int = 20,
) -> List[Dict[str, Any]]:
    """Return up to `max_results` messages matching `label_id` and/or
    `query` (Gmail search syntax — `from:`, `is:starred`, `subject:`,
    etc). Each entry has light metadata (subject, from, date, snippet)
    suitable for rendering in a picker without needing an extra round-trip
    per row.

    Implementation note: Gmail's `messages.list` only returns the
    `(id, threadId)` pair, so we fan out to `messages.get?format=metadata`
    in a tight per-message loop. For 20 rows this is acceptable; for
    larger pages we'd batch with the BatchGet endpoint, but the picker
    UX caps at 20 anyway."""
    max_results = max(1, min(int(max_results or 20), 50))
    params: Dict[str, Any] = {"maxResults": max_results}
    if label_id:
        params["labelIds"] = label_id
    if query:
        params["q"] = query
    listing = await _request(conn, "GET", "/messages", params=params)
    msg_ids = [m.get("id") for m in (listing.get("messages") or []) if m.get("id")]
    out: List[Dict[str, Any]] = []
    for mid in msg_ids:
        try:
            meta = await _request(
                conn,
                "GET",
                f"/messages/{mid}",
                params={
                    "format": "metadata",
                    "metadataHeaders": ["Subject", "From", "Date", "To"],
                },
            )
        except (IntegrationError, NotConnectedError) as e:
            logger.warning(f"gmail list_messages: skip {mid}: {e}")
            continue
        headers = (meta.get("payload") or {}).get("headers") or []
        snippet = (meta.get("snippet") or "")[:_SEARCH_SNIPPET_MAX]
        out.append(
            {
                "id": meta.get("id") or mid,
                "thread_id": meta.get("threadId") or "",
                "subject": _header(headers, "Subject") or "(no subject)",
                "from": _header(headers, "From") or "",
                "to": _header(headers, "To") or "",
                "date": _header(headers, "Date") or "",
                "snippet": snippet,
                "label_ids": meta.get("labelIds") or [],
            }
        )
    return out


async def fetch_message(
    conn: Dict[str, Any], message_id: str
) -> Dict[str, Any]:
    """Fetch a full message including bodies + attachment metadata.
    Returns `{id, thread_id, from, to, subject, date, body_text,
    body_html, attachments, url, label_ids}`."""
    if not message_id:
        raise IntegrationError("fetch_message: empty message_id", 400)
    data = await _request(
        conn, "GET", f"/messages/{message_id}", params={"format": "full"}
    )
    headers = (data.get("payload") or {}).get("headers") or []
    bodies = _extract_bodies_and_attachments(data.get("payload") or {})
    thread_id = data.get("threadId") or ""
    # Build a stable Gmail web URL. The `#all/<thread_id>` form works
    # regardless of which label the message currently sits under (inbox,
    # archive, trash, etc) — using `#inbox/...` would 404 once the user
    # archives the message, which would break our back-link permanently.
    url = (
        f"https://mail.google.com/mail/u/0/#all/{thread_id}"
        if thread_id
        else f"https://mail.google.com/mail/u/0/#inbox/{message_id}"
    )
    return {
        "id": data.get("id") or message_id,
        "thread_id": thread_id,
        "from": _header(headers, "From"),
        "to": _header(headers, "To"),
        "subject": _header(headers, "Subject") or "(no subject)",
        "date": _header(headers, "Date"),
        "body_text": bodies["body_text"],
        "body_html": bodies["body_html"],
        "attachments": bodies["attachments"],
        "url": url,
        "label_ids": data.get("labelIds") or [],
    }


def _sender_name_email(from_header: str) -> Dict[str, str]:
    """Split `Name <addr@host>` into `{name, email}`. Best-effort —
    a handful of real-world headers look like `addr@host` only."""
    name, addr = parseaddr(from_header or "")
    return {"name": (name or "").strip(), "email": (addr or "").strip()}


async def import_message_as_memory(
    conn: Dict[str, Any],
    message_id: str,
    user_id: str,
) -> Dict[str, Any]:
    """Idempotent import of a single Gmail message. Re-importing the
    same message updates the existing memory's content rather than
    creating a duplicate.

    Mapping is identified two ways:
      1. `source_url` is the deterministic gmail.com URL, so
         `save_memory`'s URL dedup auto-collapses re-imports onto the
         same doc id.
      2. We additionally maintain an `external_refs` row per message so
         the user can navigate memory→Gmail from `MemoryLinksPanel`.

    Returns `{memory_id, message_id, subject, url, created, updated,
    attachments_count}`. Attachments are stored as metadata only — the
    actual byte download happens lazily and isn't part of the MVP.
    """
    # Local imports — these modules pull a lot of FastAPI / Firestore
    # state and create cycles if loaded at module import time.
    from app import external_refs as _ext
    from app.capture_agent import save_memory
    from app.db import get_db
    from app.user_context import current_user_id_var

    msg = await fetch_message(conn, message_id)
    subject = msg["subject"]
    body_text = msg["body_text"] or msg["body_html"] or ""
    url = msg["url"]
    sender = _sender_name_email(msg["from"])
    pretty_from = sender["name"] or sender["email"] or msg["from"]
    attachment_meta = [
        {
            "filename": a.get("filename") or "",
            "mime_type": a.get("mime_type") or "",
            "size": int(a.get("size") or 0),
            "attachment_id": a.get("attachment_id") or "",
        }
        for a in (msg.get("attachments") or [])
    ]

    token = None
    if user_id:
        token = current_user_id_var.set(user_id)
    try:
        existing_ref = await _find_existing_ref(message_id)
        existing_memory_id = (existing_ref or {}).get("memory_id") or ""
        memory_id = ""
        created = False
        updated = False

        # Markdown header gives the memory a familiar email-like preview
        # in the Vault list — sender + subject up top, body underneath.
        composed_body = (
            f"**From:** {pretty_from}\n"
            f"**Subject:** {subject}\n"
            f"**Date:** {msg.get('date') or ''}\n\n"
            f"{body_text}"
        ).strip()

        if existing_memory_id:
            db = await get_db()
            await db.collection("memories").document(existing_memory_id).update(
                {
                    "title": subject,
                    "summary": composed_body[:2000],
                    "executive_summary": (body_text or subject)[:500],
                    "source_type": "email",
                    "source_url": url,
                    "gmail_message_id": message_id,
                    "gmail_thread_id": msg.get("thread_id") or "",
                    "gmail_from": pretty_from,
                    "gmail_from_email": sender["email"],
                    "gmail_subject": subject,
                    "gmail_date": msg.get("date") or "",
                    "gmail_attachments": attachment_meta,
                }
            )
            memory_id = existing_memory_id
            updated = True
        else:
            saved = await save_memory(
                {
                    "title": subject,
                    "summary": composed_body or subject,
                    "source_type": "email",
                    "source_url": url,
                    "tags": ["email", "gmail"],
                    "gmail_message_id": message_id,
                    "gmail_thread_id": msg.get("thread_id") or "",
                    "gmail_from": pretty_from,
                    "gmail_from_email": sender["email"],
                    "gmail_subject": subject,
                    "gmail_date": msg.get("date") or "",
                    "gmail_attachments": attachment_meta,
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
                    source="gmail",
                    source_id=message_id,
                    title=subject,
                    url=url,
                    snippet=(body_text or "")[:500],
                )
            except Exception as e:
                logger.warning(f"gmail: external_ref create failed: {e}")
    finally:
        if token is not None:
            current_user_id_var.reset(token)

    return {
        "memory_id": memory_id,
        "message_id": message_id,
        "subject": subject,
        "url": url,
        "created": created,
        "updated": updated,
        "attachments_count": len(attachment_meta),
    }


async def _find_existing_ref(message_id: str) -> Optional[Dict[str, Any]]:
    """Find an external_ref row whose source=gmail + source_id=message_id
    for the *current* user (caller ensures the user_context is set)."""
    from app.db import get_db
    from app.user_context import belongs_to_current_user

    if not message_id:
        return None
    db = await get_db()
    snap = await db.collection("external_refs").get()
    for d in snap:
        data = (d.to_dict() or {}) | {"id": d.id}
        if not belongs_to_current_user(data):
            continue
        if data.get("source") != "gmail":
            continue
        if data.get("source_id") != message_id:
            continue
        return data
    return None
