"""
Notion API client. Uses the public REST surface
(`https://api.notion.com/v1/...`) directly via httpx — no SDK
dependency. The token is supplied by `app.integrations.get_connection`
(either Replit OAuth proxy or NOTION_INTEGRATION_TOKEN secret).

Block → markdown rendering covers the common types (paragraph,
heading_1/2/3, bulleted_list_item, numbered_list_item, to_do, code,
quote, divider, callout). Unknown types render as a comment line so
the user knows something was skipped without breaking the import.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

import httpx

from app.integrations import (
    IntegrationError,
    NotConnectedError,
    with_backoff,
)

logger = logging.getLogger(__name__)


_NOTION_BASE = "https://api.notion.com/v1"
_NOTION_VERSION = "2022-06-28"
_HTTP_TIMEOUT = 20.0


def _client(conn: Dict[str, Any]) -> httpx.AsyncClient:
    """Build an authenticated httpx client. Caller owns the lifecycle
    (use as `async with _client(conn) as c:`)."""
    token = (conn or {}).get("access_token") or ""
    if not token:
        raise NotConnectedError(
            "notion", "Connection dict missing access_token."
        )
    return httpx.AsyncClient(
        base_url=_NOTION_BASE,
        timeout=_HTTP_TIMEOUT,
        headers={
            "Authorization": f"Bearer {token}",
            "Notion-Version": _NOTION_VERSION,
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
    )


async def _request(
    conn: Dict[str, Any], method: str, path: str, **kwargs
) -> Dict[str, Any]:
    """Single Notion API call wrapped in `with_backoff` so transient
    429/5xx are retried."""

    async def _do() -> Dict[str, Any]:
        async with _client(conn) as c:
            r = await c.request(method, path, **kwargs)
            if r.status_code == 401:
                raise NotConnectedError(
                    "notion",
                    "Notion returned 401 — the token is invalid or revoked.",
                )
            if r.status_code >= 400:
                raise IntegrationError(
                    f"notion {method} {path} -> {r.status_code} {r.text[:240]}",
                    status_code=r.status_code,
                )
            return r.json() or {}

    return await with_backoff(_do)


def _plain_text(rich_text: List[Dict[str, Any]]) -> str:
    """Notion rich_text array → plain string. Annotations (bold, italic,
    code, strikethrough, links) are rendered as markdown inline."""
    out: List[str] = []
    for rt in rich_text or []:
        text = (rt.get("plain_text") or "")
        if not text:
            continue
        ann = rt.get("annotations") or {}
        href = rt.get("href") or ""
        if ann.get("code"):
            text = f"`{text}`"
        if ann.get("bold"):
            text = f"**{text}**"
        if ann.get("italic"):
            text = f"*{text}*"
        if ann.get("strikethrough"):
            text = f"~~{text}~~"
        if href:
            text = f"[{text}]({href})"
        out.append(text)
    return "".join(out)


def _title_of(page: Dict[str, Any]) -> str:
    """Best-effort title from a Notion page object. Notion stores the
    title in different property names depending on whether the page
    lives in a database (named property of type 'title') or stand-alone
    (the page object's `properties.title`)."""
    props = (page or {}).get("properties") or {}
    for prop in props.values():
        if (prop or {}).get("type") == "title":
            return _plain_text(prop.get("title") or []) or "(untitled)"
    return "(untitled)"


def _block_to_md(block: Dict[str, Any]) -> Optional[str]:
    """Render one Notion block to a markdown string. Returns None to
    skip (e.g. unsupported types we don't want to surface as noise)."""
    btype = block.get("type") or ""
    body = block.get(btype) or {}
    rt = body.get("rich_text") or []
    text = _plain_text(rt)
    if btype == "paragraph":
        return text or ""
    if btype == "heading_1":
        return f"# {text}" if text else ""
    if btype == "heading_2":
        return f"## {text}" if text else ""
    if btype == "heading_3":
        return f"### {text}" if text else ""
    if btype == "bulleted_list_item":
        return f"- {text}" if text else "-"
    if btype == "numbered_list_item":
        return f"1. {text}" if text else "1."
    if btype == "to_do":
        checked = bool(body.get("checked"))
        marker = "[x]" if checked else "[ ]"
        return f"- {marker} {text}".rstrip()
    if btype == "quote":
        return f"> {text}" if text else ">"
    if btype == "divider":
        return "---"
    if btype == "callout":
        icon = ((body.get("icon") or {}).get("emoji")) or ""
        prefix = f"{icon} " if icon else ""
        return f"> {prefix}{text}".rstrip()
    if btype == "code":
        lang = body.get("language") or ""
        return f"```{lang}\n{text}\n```"
    if btype == "image":
        f = body.get("file") or body.get("external") or {}
        url = f.get("url") or ""
        cap = _plain_text(body.get("caption") or [])
        if url:
            return f"![{cap}]({url})"
        return None
    if btype == "bookmark":
        url = body.get("url") or ""
        if url:
            return f"<{url}>"
        return None
    if btype == "child_page":
        title = body.get("title") or ""
        return f"_subpage:_ **{title}**" if title else None
    if btype == "unsupported":
        return None
    # Fallback — surface the type so the user knows something was skipped.
    if text:
        return text
    return None


async def list_databases(conn: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Return every database the integration can see. Notion's
    `/v1/search` is paginated; we follow `next_cursor` until exhausted
    to give the user the full picture in one shot."""
    out: List[Dict[str, Any]] = []
    cursor: Optional[str] = None
    while True:
        body: Dict[str, Any] = {
            "filter": {"value": "database", "property": "object"},
            "page_size": 100,
        }
        if cursor:
            body["start_cursor"] = cursor
        data = await _request(conn, "POST", "/search", json=body)
        for db in data.get("results") or []:
            title = _plain_text(db.get("title") or []) or "(untitled)"
            out.append(
                {
                    "id": db.get("id") or "",
                    "title": title,
                    "last_edited_time": db.get("last_edited_time") or "",
                }
            )
        if not data.get("has_more"):
            break
        cursor = data.get("next_cursor")
        if not cursor:
            break
    out.sort(key=lambda r: r.get("last_edited_time") or "", reverse=True)
    return out


async def list_pages(
    conn: Dict[str, Any],
    database_id: str,
    since: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Return every page in the database, optionally filtered to pages
    edited after `since` (ISO 8601 string)."""
    if not database_id:
        return []
    out: List[Dict[str, Any]] = []
    cursor: Optional[str] = None
    while True:
        body: Dict[str, Any] = {"page_size": 100}
        if cursor:
            body["start_cursor"] = cursor
        if since:
            body["filter"] = {
                "timestamp": "last_edited_time",
                "last_edited_time": {"on_or_after": since},
            }
        data = await _request(
            conn, "POST", f"/databases/{database_id}/query", json=body
        )
        for pg in data.get("results") or []:
            out.append(
                {
                    "page_id": pg.get("id") or "",
                    "title": _title_of(pg),
                    "url": pg.get("url") or "",
                    "last_edited_time": pg.get("last_edited_time") or "",
                }
            )
        if not data.get("has_more"):
            break
        cursor = data.get("next_cursor")
        if not cursor:
            break
    return out


async def fetch_page_content(
    conn: Dict[str, Any], page_id: str
) -> Dict[str, Any]:
    """Fetch a page + walk its top-level children to markdown.
    We don't recurse into nested children — Notion's structure is too
    arbitrary and the markdown gets unreadable; the source URL preserves
    the full original."""
    if not page_id:
        raise IntegrationError("fetch_page_content: empty page_id", 400)
    page = await _request(conn, "GET", f"/pages/{page_id}")
    title = _title_of(page)
    url = page.get("url") or ""
    last_edited_time = page.get("last_edited_time") or ""
    blocks: List[str] = []
    cursor: Optional[str] = None
    while True:
        params = {"page_size": 100}
        if cursor:
            params["start_cursor"] = cursor
        data = await _request(
            conn, "GET", f"/blocks/{page_id}/children", params=params
        )
        for b in data.get("results") or []:
            md = _block_to_md(b)
            if md is None:
                continue
            blocks.append(md)
        if not data.get("has_more"):
            break
        cursor = data.get("next_cursor")
        if not cursor:
            break
    return {
        "title": title,
        "blocks_md": "\n\n".join(b for b in blocks if b),
        "url": url,
        "last_edited_time": last_edited_time,
    }


async def import_page_as_memory(
    conn: Dict[str, Any],
    page_id: str,
    user_id: str,
) -> Dict[str, Any]:
    """Idempotent import. Re-importing the same Notion page updates the
    existing memory's content rather than creating a duplicate. The
    memory↔page mapping is identified two ways:

      1. The Notion page URL is used as `source_url`, so
         `save_memory`'s URL dedup auto-collapses re-imports onto the
         existing doc id derived from `_memory_doc_id(user_id, url)`.
      2. We additionally maintain an `external_refs` row per page so
         the user can navigate memory→page from `MemoryLinksPanel`.

    Returns `{memory_id, page_id, title, url, created: bool, updated: bool}`.
    """
    # Local imports — these modules import a *lot* of FastAPI / Firestore
    # state, and pulling them at module import time creates an import
    # cycle (capture_agent imports from `app/__init__.py` indirectly).
    from app import external_refs as _ext
    from app.capture_agent import save_memory
    from app.db import get_db
    from app.user_context import current_user_id_var

    page = await fetch_page_content(conn, page_id)
    title = page["title"]
    url = page["url"]
    blocks_md = page["blocks_md"]
    last_edited_time = page["last_edited_time"]

    # Per-call user scoping — the sync scheduler runs outside any
    # request, so the ContextVar default ('guest') would otherwise
    # write the imported memory to the wrong workspace.
    token = None
    if user_id:
        token = current_user_id_var.set(user_id)
    try:
        # 1) Check for an existing external_ref → memory mapping. If
        #    found we update that memory's content/title in place and
        #    skip the save_memory write — save_memory's URL dedup would
        #    return the existing doc unchanged, which is wrong for
        #    sync mode where we explicitly want fresh content.
        existing_ref = await _find_existing_ref(page_id)
        existing_memory_id = (existing_ref or {}).get("memory_id") or ""
        memory_id = ""
        created = False
        updated = False

        if existing_memory_id:
            db = await get_db()
            await db.collection("memories").document(existing_memory_id).update(
                {
                    "title": title,
                    "summary": blocks_md[:2000],
                    "executive_summary": blocks_md[:500],
                    "source_type": "notion",
                    "source_url": url,
                    "notion_page_id": page_id,
                    "notion_last_edited_time": last_edited_time,
                }
            )
            memory_id = existing_memory_id
            updated = True
        else:
            saved = await save_memory(
                {
                    "title": title,
                    "summary": blocks_md or title,
                    "source_type": "notion",
                    "source_url": url,
                    "tags": ["notion"],
                    "notion_page_id": page_id,
                    "notion_last_edited_time": last_edited_time,
                },
                user_id=user_id,
            )
            memory_id = saved.get("id") or saved.get("memory_id") or ""
            # save_memory may return an existing memory if our URL dedup
            # already covers this page (no external_ref yet, but the
            # memory exists from a prior capture). Treat that as "updated".
            if saved.get("duplicate"):
                updated = True
            else:
                created = True

        # 2) Ensure an external_ref exists (create only if absent).
        if not existing_ref and memory_id:
            try:
                await _ext.create_external_ref(
                    memory_id=memory_id,
                    source="notion",
                    source_id=page_id,
                    title=title,
                    url=url,
                    snippet=(blocks_md or "")[:500],
                )
            except Exception as e:
                logger.warning(f"notion: external_ref create failed: {e}")
    finally:
        if token is not None:
            current_user_id_var.reset(token)

    return {
        "memory_id": memory_id,
        "page_id": page_id,
        "title": title,
        "url": url,
        "created": created,
        "updated": updated,
    }


async def _find_existing_ref(page_id: str) -> Optional[Dict[str, Any]]:
    """Find an external_ref row whose source=notion + source_id=page_id
    for the *current* user (caller ensures the user_context is set)."""
    from app import external_refs as _ext
    from app.db import get_db
    from app.user_context import belongs_to_current_user

    if not page_id:
        return None
    db = await get_db()
    snap = await db.collection("external_refs").get()
    for d in snap:
        data = (d.to_dict() or {}) | {"id": d.id}
        if not belongs_to_current_user(data):
            continue
        if data.get("source") != "notion":
            continue
        if data.get("source_id") != page_id:
            continue
        return data
    return None
