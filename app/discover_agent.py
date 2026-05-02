"""
Discover Agent — fetches REAL YouTube videos via YouTube Data API v3
and uses LLM to surface high-signal articles for any topic.

Returns shape compatible with frontend cards:
  { items: [
      { title, url, type, source, summary, thumbnail, youtube_id?,
        channel_title?, channel_id?, view_count?, view_count_display?,
        duration_seconds?, duration_display?, published_at?, age_display? }
    ],
    count, error? }
"""
import os
import re
import time
import logging
import datetime
from typing import Dict, Any, List, Optional
from urllib.parse import urlparse

import httpx

from app.config import settings
from app.ai_helper import chat_json

logger = logging.getLogger("recall-x247")

YT_API_BASE = "https://www.googleapis.com/youtube/v3"
_YT_RE = re.compile(r"(?:youtube\.com/watch\?(?:.*&)?v=|youtu\.be/|youtube\.com/embed/)([A-Za-z0-9_-]{6,15})")
_ISO_DUR_RE = re.compile(r"PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?")

# Tiny in-process cache so repeat searches within 10 minutes are instant
_YT_CACHE: Dict[str, tuple[float, List[Dict[str, Any]]]] = {}
_ART_CACHE: Dict[str, tuple[float, List[Dict[str, Any]]]] = {}
_CACHE_TTL = 600.0  # 10 minutes


def _extract_yt_id(url: str) -> Optional[str]:
    if not url:
        return None
    m = _YT_RE.search(url)
    return m.group(1) if m else None


def _domain_of(url: str) -> str:
    try:
        host = urlparse(url).hostname or ""
        return host.replace("www.", "")
    except Exception:
        return ""


def _parse_iso8601_duration(d: str) -> int:
    """Convert PT4M37S → 277 seconds. Returns 0 on failure."""
    if not d:
        return 0
    m = _ISO_DUR_RE.match(d)
    if not m:
        return 0
    h, mn, s = m.groups()
    return int(h or 0) * 3600 + int(mn or 0) * 60 + int(s or 0)


def _format_duration(seconds: int) -> str:
    if seconds <= 0:
        return ""
    h, rem = divmod(seconds, 3600)
    m, s = divmod(rem, 60)
    if h:
        return f"{h}:{m:02d}:{s:02d}"
    return f"{m}:{s:02d}"


def _humanize_views(n: int) -> str:
    if n is None:
        return ""
    if n >= 1_000_000_000:
        return f"{n / 1_000_000_000:.1f}B views"
    if n >= 1_000_000:
        return f"{n / 1_000_000:.1f}M views"
    if n >= 1_000:
        return f"{n / 1_000:.1f}K views"
    return f"{n} views"


def _humanize_age(iso_date: str) -> str:
    """ISO8601 → '3 weeks ago' style. Returns '' on failure."""
    if not iso_date:
        return ""
    try:
        # Strip Z if present, parse as UTC
        dt = datetime.datetime.fromisoformat(iso_date.replace("Z", "+00:00"))
        now = datetime.datetime.now(datetime.timezone.utc)
        delta = now - dt
        secs = int(delta.total_seconds())
        if secs < 60:
            return "just now"
        if secs < 3600:
            return f"{secs // 60}m ago"
        if secs < 86400:
            return f"{secs // 3600}h ago"
        days = secs // 86400
        if days < 7:
            return f"{days}d ago"
        if days < 30:
            wks = days // 7
            return f"{wks} week{'s' if wks > 1 else ''} ago"
        if days < 365:
            mos = days // 30
            return f"{mos} month{'s' if mos > 1 else ''} ago"
        yrs = days // 365
        return f"{yrs} year{'s' if yrs > 1 else ''} ago"
    except Exception:
        return ""


def _classify_video_kind(seconds: int) -> str:
    """Quick heuristic: short / tutorial / talk / lecture."""
    if seconds <= 0:
        return ""
    if seconds < 90:
        return "Short"
    if seconds < 12 * 60:
        return "Quick watch"
    if seconds < 35 * 60:
        return "Tutorial"
    if seconds < 75 * 60:
        return "Talk"
    return "Lecture"


async def _youtube_search(topic: str, max_results: int = 8) -> tuple[List[Dict[str, Any]], str]:
    """Call YouTube Data API v3 search.list + videos.list to get rich metadata.
    Returns (videos, status) where status ∈ {'ok','no_key','blocked','error'}."""
    # Prefer dedicated YOUTUBE_API_KEY if set, else fall back to GOOGLE_API_KEY
    api_key = (
        os.environ.get("YOUTUBE_API_KEY")
        or os.environ.get("YT_API_KEY")
        or settings.GOOGLE_API_KEY
    )
    if not api_key:
        logger.warning("YouTube search skipped: no API key")
        return [], "no_key"

    cache_key = f"{topic.lower().strip()}::{max_results}"
    cached = _YT_CACHE.get(cache_key)
    if cached and (time.time() - cached[0]) < _CACHE_TTL:
        return cached[1], "ok"

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            search_res = await client.get(
                f"{YT_API_BASE}/search",
                params={
                    "key": api_key,
                    "q": topic,
                    "part": "snippet",
                    "type": "video",
                    "maxResults": max_results,
                    "safeSearch": "moderate",
                    "relevanceLanguage": "en",
                    "videoEmbeddable": "true",
                },
            )
            if search_res.status_code != 200:
                err_text = search_res.text[:300]
                logger.warning(f"YouTube search.list failed {search_res.status_code}: {err_text}")
                if search_res.status_code == 403 and "blocked" in err_text.lower():
                    return [], "blocked"
                return [], "error"
            search_data = search_res.json()
            video_ids = [
                it["id"]["videoId"]
                for it in search_data.get("items", [])
                if it.get("id", {}).get("videoId")
            ]
            if not video_ids:
                return [], "ok"

            # Hydrate stats + duration in one call
            details_res = await client.get(
                f"{YT_API_BASE}/videos",
                params={
                    "key": api_key,
                    "id": ",".join(video_ids),
                    "part": "snippet,contentDetails,statistics",
                },
            )
            if details_res.status_code != 200:
                logger.warning(f"YouTube videos.list failed {details_res.status_code}: {details_res.text[:200]}")
                return [], "error"
            items = details_res.json().get("items", [])
    except Exception as e:
        logger.warning(f"YouTube API request failed: {e}")
        return [], "error"

    out: List[Dict[str, Any]] = []
    for it in items:
        vid = it.get("id")
        sn = it.get("snippet", {})
        cd = it.get("contentDetails", {})
        st = it.get("statistics", {})
        if not vid or not sn.get("title"):
            continue
        thumbs = sn.get("thumbnails", {}) or {}
        thumb = (
            thumbs.get("maxres", {}).get("url")
            or thumbs.get("standard", {}).get("url")
            or thumbs.get("high", {}).get("url")
            or thumbs.get("medium", {}).get("url")
            or thumbs.get("default", {}).get("url")
            or f"https://img.youtube.com/vi/{vid}/hqdefault.jpg"
        )
        duration_s = _parse_iso8601_duration(cd.get("duration", ""))
        view_count = int(st.get("viewCount", 0) or 0)
        published_at = sn.get("publishedAt", "")
        out.append({
            "title": sn.get("title", "").strip(),
            "url": f"https://www.youtube.com/watch?v={vid}",
            "type": "video",
            "source": sn.get("channelTitle", "YouTube"),
            "domain": "youtube.com",
            "summary": (sn.get("description") or "").strip()[:280],
            "thumbnail": thumb,
            "youtube_id": vid,
            "channel_title": sn.get("channelTitle", ""),
            "channel_id": sn.get("channelId", ""),
            "view_count": view_count,
            "view_count_display": _humanize_views(view_count),
            "duration_seconds": duration_s,
            "duration_display": _format_duration(duration_s),
            "published_at": published_at,
            "age_display": _humanize_age(published_at),
            "kind_label": _classify_video_kind(duration_s),
            "like_count": int(st.get("likeCount", 0) or 0),
        })

    _YT_CACHE[cache_key] = (time.time(), out)
    return out, "ok"


async def _llm_videos(topic: str, max_items: int = 6) -> List[Dict[str, Any]]:
    """Fallback: ask LLM to suggest well-known real YouTube videos when the
    Data API is unavailable. We don't fabricate metadata — only title + URL +
    a synthesized description. Used only when YouTube Data API is blocked."""
    system = (
        "You are a YouTube curator. Suggest only real, well-known YouTube videos "
        "from credible educational/professional channels (3Blue1Brown, MIT, Stanford, "
        "Andrej Karpathy, Yannic Kilcher, Computerphile, Two Minute Papers, freeCodeCamp, "
        "TED, conference talks). Never fabricate video IDs."
    )
    user = f"""Suggest {max_items} real YouTube videos about: "{topic}".
Use canonical YouTube URLs (https://www.youtube.com/watch?v=ID). Prefer popular,
high-quality educational videos. Order by likely usefulness.

Return strictly JSON:
{{ "items": [
  {{ "title": "...", "url": "https://www.youtube.com/watch?v=...", "channel": "Channel Name",
     "summary": "1-2 sentence value prop" }}
] }}"""
    try:
        result = await chat_json(
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            model=settings.OPENAI_MODEL,
            temperature=0.5,
        )
    except Exception as e:
        logger.warning(f"LLM videos call failed: {e}")
        return []

    raw_items = result.get("items") or []
    if not isinstance(raw_items, list):
        for v in result.values():
            if isinstance(v, list):
                raw_items = v
                break

    out: List[Dict[str, Any]] = []
    seen: set[str] = set()
    for raw in raw_items:
        if not isinstance(raw, dict):
            continue
        url = (raw.get("url") or "").strip()
        title = (raw.get("title") or "").strip()
        vid = _extract_yt_id(url)
        if not vid or not title or vid in seen:
            continue
        seen.add(vid)
        channel = (raw.get("channel") or "").strip()
        out.append({
            "title": title,
            "url": f"https://www.youtube.com/watch?v={vid}",
            "type": "video",
            "source": channel or "YouTube",
            "domain": "youtube.com",
            "summary": (raw.get("summary") or "").strip()[:240],
            "thumbnail": f"https://img.youtube.com/vi/{vid}/hqdefault.jpg",
            "youtube_id": vid,
            "channel_title": channel,
        })
    return out


async def _llm_articles(topic: str, max_items: int = 6) -> List[Dict[str, Any]]:
    """Use LLM to suggest reputable article-style resources for a topic."""
    cache_key = topic.lower().strip()
    cached = _ART_CACHE.get(cache_key)
    if cached and (time.time() - cached[0]) < _CACHE_TTL:
        return cached[1]

    system = (
        "You are a research curator. Suggest only well-known, real, publicly accessible "
        "article-style resources from reputable sources (Wikipedia, MIT OCW, freeCodeCamp, "
        "Khan Academy, official docs, well-known publications, arXiv abstracts). "
        "Never fabricate URLs. Prefer canonical homepages over deep links if unsure."
    )
    user = f"""Suggest {max_items} high-quality article-style learning resources about: "{topic}".
Articles only — no YouTube videos.

Return strictly JSON:
{{ "items": [
  {{ "title": "...", "url": "https://...", "source": "Channel/Publication", "summary": "1-2 sentence why-it-matters" }}
] }}

Order: highest-signal first. No duplicates."""

    try:
        result = await chat_json(
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            model=settings.OPENAI_MODEL,
            temperature=0.4,
        )
    except Exception as e:
        logger.warning(f"LLM articles call failed: {e}")
        return []

    raw_items = result.get("items") or []
    if not isinstance(raw_items, list):
        for v in result.values():
            if isinstance(v, list):
                raw_items = v
                break

    out: List[Dict[str, Any]] = []
    seen: set[str] = set()
    for raw in raw_items:
        if not isinstance(raw, dict):
            continue
        url = (raw.get("url") or "").strip()
        title = (raw.get("title") or "").strip()
        if not url or not title or url in seen:
            continue
        try:
            parsed = urlparse(url)
            if parsed.scheme not in ("http", "https") or not parsed.hostname:
                continue
        except Exception:
            continue
        # Skip YouTube URLs in the article path — they should come from the YT API
        if _extract_yt_id(url):
            continue
        seen.add(url)
        out.append({
            "title": title,
            "url": url,
            "type": "article",
            "source": (raw.get("source") or _domain_of(url) or "").strip(),
            "domain": _domain_of(url),
            "summary": (raw.get("summary") or "").strip()[:240],
        })

    # Enrich top items with og:image so cards render real thumbnails.
    if out:
        try:
            await _enrich_articles_with_og_image(out[:6])
        except Exception as e:
            logger.warning(f"og:image enrichment failed: {e}")

    _ART_CACHE[cache_key] = (time.time(), out)
    return out


# ─── og:image enrichment ──────────────────────────────────────────────────────

# Tiny module-level cache so repeat lookups within an hour are instant
_OG_IMG_CACHE: Dict[str, tuple[float, str]] = {}
_OG_TTL = 3600.0  # 1 hour

_OG_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml",
}


def _absolutize(maybe_relative: str, base: str) -> str:
    if not maybe_relative:
        return ""
    if maybe_relative.startswith("//"):
        return "https:" + maybe_relative
    if maybe_relative.startswith("http://") or maybe_relative.startswith("https://"):
        return maybe_relative
    try:
        from urllib.parse import urljoin
        return urljoin(base, maybe_relative)
    except Exception:
        return maybe_relative


async def _fetch_og_image(client: httpx.AsyncClient, url: str) -> str:
    """Return og:image / twitter:image for a single URL, '' on failure.
    Times out fast; we never block discover on this."""
    cache = _OG_IMG_CACHE.get(url)
    if cache and (time.time() - cache[0]) < _OG_TTL:
        return cache[1]
    try:
        # Stream just enough HTML to find the head meta tags
        resp = await client.get(url, follow_redirects=True, timeout=4.0)
        if resp.status_code >= 400 or not resp.text:
            _OG_IMG_CACHE[url] = (time.time(), "")
            return ""
        # Only parse first 64KB — og tags live in <head>
        snippet = resp.text[:64 * 1024]
        # Quick regex first to avoid heavy soup parsing on huge pages
        m = re.search(
            r'<meta[^>]+(?:property|name)\s*=\s*"(?:og:image(?::secure_url)?|twitter:image(?::src)?)"[^>]*content\s*=\s*"([^"]+)"',
            snippet, flags=re.IGNORECASE,
        )
        if not m:
            m = re.search(
                r'<meta[^>]+content\s*=\s*"([^"]+)"[^>]*(?:property|name)\s*=\s*"(?:og:image(?::secure_url)?|twitter:image(?::src)?)"',
                snippet, flags=re.IGNORECASE,
            )
        img = (m.group(1).strip() if m else "")
        img = _absolutize(img, str(resp.url))
        _OG_IMG_CACHE[url] = (time.time(), img)
        return img
    except Exception:
        _OG_IMG_CACHE[url] = (time.time(), "")
        return ""


async def _enrich_articles_with_og_image(articles: List[Dict[str, Any]]) -> None:
    """Mutate the list in-place, attaching `thumbnail` when og:image is found."""
    if not articles:
        return
    import asyncio as _asyncio
    async with httpx.AsyncClient(headers=_OG_HEADERS, timeout=4.0) as client:
        results = await _asyncio.gather(
            *[_fetch_og_image(client, a.get("url", "")) for a in articles],
            return_exceptions=True,
        )
    for art, res in zip(articles, results):
        if isinstance(res, str) and res:
            art["thumbnail"] = res


async def discover_resources(topic: str, kinds: List[str] | None = None) -> Dict[str, Any]:
    """Hybrid: real YouTube videos via Data API v3 + LLM-curated articles."""
    topic = (topic or "").strip()
    if not topic:
        return {"topic": "", "items": [], "error": "topic required"}

    kinds = kinds or ["article", "video"]
    want_articles = "article" in kinds
    want_videos = "video" in kinds

    videos: List[Dict[str, Any]] = []
    articles: List[Dict[str, Any]] = []
    yt_status = "skipped"

    # Run both in parallel where applicable
    import asyncio
    tasks = []
    if want_videos:
        tasks.append(_youtube_search(topic, max_results=8))
    else:
        tasks.append(asyncio.sleep(0, result=([], "skipped")))
    if want_articles:
        tasks.append(_llm_articles(topic, max_items=6))
    else:
        tasks.append(asyncio.sleep(0, result=[]))
    try:
        yt_result, articles = await asyncio.gather(*tasks)
        if want_videos:
            videos, yt_status = yt_result
        else:
            yt_status = "skipped"
    except Exception as e:
        logger.warning(f"discover gather failed: {e}")
        videos, articles, yt_status = [], [], "error"

    # If YouTube Data API is blocked / errored, fall back to LLM-suggested videos
    if want_videos and not videos and yt_status in ("blocked", "error", "no_key"):
        try:
            videos = await _llm_videos(topic, max_items=6)
        except Exception as e:
            logger.warning(f"LLM video fallback failed: {e}")
            videos = []

    # Interleave articles and videos so the grid feels mixed (3 vids, 1 article, repeat)
    items: List[Dict[str, Any]] = []
    vi = ai = 0
    while vi < len(videos) or ai < len(articles):
        for _ in range(2):
            if vi < len(videos):
                items.append(videos[vi]); vi += 1
        if ai < len(articles):
            items.append(articles[ai]); ai += 1

    return {
        "topic": topic,
        "items": items,
        "count": len(items),
        "video_count": len(videos),
        "article_count": len(articles),
        "youtube_api_used": yt_status == "ok",
        "youtube_api_status": yt_status,
    }


# ─── AI Digest synthesis ──────────────────────────────────────────────────────

async def synthesize_digest(topic: str, items: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Produce a concise AI brief over a list of discover items.

    Returns: { tldr, themes:[{title,why}], must_read:[{title,url,reason}],
               watch_first, contrarian, next_questions, total }
    """
    topic = (topic or "").strip()
    if not topic or not items:
        return {"error": "topic and items required"}

    # Build a compact, model-friendly catalog (cap to 10 items, trim summaries)
    catalog_lines: List[str] = []
    for i, it in enumerate(items[:10], 1):
        kind = (it.get("type") or "item").upper()
        title = (it.get("title") or "")[:160]
        src = it.get("source") or it.get("channel_title") or it.get("domain") or ""
        summ = (it.get("summary") or it.get("description") or "")[:220]
        url = it.get("url") or ""
        catalog_lines.append(
            f"{i}. [{kind}] {title}\n   source: {src}\n   url: {url}\n   note: {summ}"
        )
    catalog = "\n".join(catalog_lines)

    system = (
        "You are a senior research editor synthesizing a curated brief for a learner. "
        "You receive a numbered catalog of articles and videos on a single topic. "
        "Identify themes, recommend a reading order, and surface contrarian takes. "
        "Always return valid JSON matching the requested schema. Be specific, no fluff."
    )
    user = (
        f"Topic: {topic}\n\n"
        f"Catalog ({len(items[:10])} items):\n{catalog}\n\n"
        "Return JSON with this schema:\n"
        "{\n"
        '  "tldr": "2-3 sentence executive summary of the topic landscape (specific, not generic)",\n'
        '  "themes": [{"title": "theme name", "why": "1-sentence why it matters"}],\n'
        '  "must_read": [{"title": "...", "url": "...", "reason": "1-sentence why this one"}],\n'
        '  "watch_first": "title of best video to watch first, or empty string",\n'
        '  "contrarian": "1-2 sentence contrarian or surprising angle from the catalog",\n'
        '  "next_questions": ["3-5 sharp follow-up questions to explore next"]\n'
        "}\n"
        "Pick must_read URLs ONLY from the catalog above. 3 themes, 3 must_read, 4 questions."
    )

    try:
        result = await chat_json(
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            model=settings.OPENAI_MODEL,
            temperature=0.4,
        )
    except Exception as e:
        logger.warning(f"discover digest failed: {e}")
        return {"error": str(e)}

    if not isinstance(result, dict):
        return {"error": "invalid model output"}

    # Coerce shapes defensively
    def _str_list(v: Any, n: int) -> List[str]:
        if not isinstance(v, list):
            return []
        out: List[str] = []
        for x in v:
            if isinstance(x, str) and x.strip():
                out.append(x.strip()[:240])
            if len(out) >= n:
                break
        return out

    themes_raw = result.get("themes") or []
    themes = []
    for t in themes_raw[:5]:
        if isinstance(t, dict) and t.get("title"):
            themes.append({
                "title": str(t.get("title"))[:80],
                "why": str(t.get("why") or "")[:200],
            })

    must_raw = result.get("must_read") or []
    must = []
    for m in must_raw[:5]:
        if isinstance(m, dict) and m.get("title") and m.get("url"):
            must.append({
                "title": str(m.get("title"))[:160],
                "url": str(m.get("url"))[:600],
                "reason": str(m.get("reason") or "")[:200],
            })

    return {
        "topic": topic,
        "tldr": str(result.get("tldr") or "")[:700],
        "themes": themes,
        "must_read": must,
        "watch_first": str(result.get("watch_first") or "")[:160],
        "contrarian": str(result.get("contrarian") or "")[:400],
        "next_questions": _str_list(result.get("next_questions"), 5),
        "total": len(items[:10]),
    }
