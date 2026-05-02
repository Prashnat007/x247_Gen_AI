import re
import json
import base64
import httpx
import datetime
import io
import os
import hashlib
import asyncio
from urllib.parse import urlsplit, urlunsplit
from typing import Optional, List, Dict, Any
from bs4 import BeautifulSoup
from youtube_transcript_api import YouTubeTranscriptApi
from pypdf import PdfReader
from openai import AsyncOpenAI
from app.db import get_db
from app.config import settings
from app.ai_helper import chat_with_fallback, chat_json, get_primary_client, get_fallback_client
from app.url_safety import (
    safe_get,
    validate_url_shape,
    UnsafeURLError,
    DEFAULT_MAX_BYTES_WEB,
    DEFAULT_MAX_BYTES_PDF,
    DEFAULT_MAX_BYTES_JSON,
)


# Soft-fail timeout for the parallel "suggested enrichments" LLM call.
# Capture-flow critical path: never block the preview longer than this.
SUGGESTION_TIMEOUT_SECONDS = 8.0


# Empty / default suggestion payload returned when the suggestion call
# fails, times out, or the AI provider is offline. Keeps the response
# shape stable so the frontend never has to special-case missing keys.
EMPTY_SUGGESTIONS: Dict[str, Any] = {
    "suggested_folder_hint": "",
    "suggested_tasks": [],
    "suggested_event": None,
    "suggested_habit_link": None,
    "suggested_revisit": None,
}


# How big a PDF can be before we stop embedding it as base64 in the memory doc.
# Larger PDFs still work — we just don't store the bytes (vault detail won't render).
MAX_EMBED_PDF_BYTES = 700 * 1024  # 700 KB binary (~933 KB base64)
# Why 700 KB: Firestore enforces a hard 1 MiB-per-document limit. A
# base64-encoded PDF inflates by ~33% (3 MB binary -> ~4 MB base64),
# so anything larger than ~720 KB binary will silently fail to write
# along with the entire memory doc, leaving the user with a
# "captured but disappeared" PDF in their vault. Capping at 700 KB
# keeps the encoded payload under ~933 KB, leaving comfortable
# headroom for the rest of the doc fields (summary, key points,
# tags, etc.). Larger PDFs still get captured — the text is parsed
# and analyzed and saved as a normal memory; only the inline-embed
# bytes are dropped, and the UI shows a "PDF too large to embed"
# placeholder with the original file name.

# How much raw text to send to the LLM for richer analysis (PDFs in particular).
ANALYSIS_TEXT_BUDGET = 14000


def get_openai_client() -> AsyncOpenAI:
    return get_primary_client()


async def _ocr_image(data_url: str, *, caption_hint: str = "") -> str:
    """Extract any visible text from a base64 data-URL image using a
    vision-capable chat model (the primary AI client speaks the OpenAI
    image_url content schema, which both Gemini-2.0-flash and
    gpt-4o-mini honour). Returns the recognized text, or an empty string
    on failure / when the image has no readable text. Best-effort: never
    raises so the surrounding capture flow stays unblocked."""
    if not data_url or not data_url.startswith("data:image/"):
        return ""
    instruction = (
        "You are an OCR engine. Extract ALL legible text from this image, "
        "preserving line breaks and reading order. If the image contains "
        "slide bullets, lists, code, or table cells, keep that structure. "
        "Do NOT summarize, translate, or add commentary. If there is no "
        "readable text, reply with the single word: NONE."
    )
    if caption_hint:
        instruction += f"\n\nCaller-supplied caption (context only): {caption_hint[:120]}"
    try:
        client = get_primary_client()
        resp = await client.chat.completions.create(
            model=settings.OPENAI_MODEL,
            messages=[{
                "role": "user",
                "content": [
                    {"type": "text", "text": instruction},
                    {"type": "image_url", "image_url": {"url": data_url}},
                ],
            }],
            temperature=0.0,
        )
        text = (resp.choices[0].message.content or "").strip()
    except Exception as e:
        # Fall back to OpenAI/OpenRouter if the primary refused or rate-limited.
        print(f"_ocr_image primary error: {e}")
        try:
            from app.ai_helper import get_fallback_client
            fb_client, fb_model = get_fallback_client()
            if not fb_client:
                return ""
            resp = await fb_client.chat.completions.create(
                model=fb_model,
                messages=[{
                    "role": "user",
                    "content": [
                        {"type": "text", "text": instruction},
                        {"type": "image_url", "image_url": {"url": data_url}},
                    ],
                }],
                temperature=0.0,
            )
            text = (resp.choices[0].message.content or "").strip()
        except Exception as e2:
            print(f"_ocr_image fallback error: {e2}")
            return ""
    if not text:
        return ""
    # Normalize the model's "no text" sentinel.
    if text.strip().upper() in {"NONE", "NO TEXT", "(NONE)", "N/A"}:
        return ""
    # Cap so a noisy OCR pass can't bloat the memory doc beyond the
    # analysis budget downstream.
    return text[:ANALYSIS_TEXT_BUDGET]


# ─── Live "visually capture" analysis ────────────────────────────────────
# Single multimodal pass that looks at one frame and produces everything
# the vault card needs in one round-trip — title, summary, tags, a
# 1-line "what's in the picture" caption, and any visible text.
# Designed for the live preview tile's "Capture frame" path so we don't
# pay for two separate OCR + analysis calls.

async def analyze_visual_frame(data_url: str, *, spoken_hint: str = "") -> dict:
    """Inspect one base64 image and return a vault-ready analysis dict.

    Returns a dict with keys: title, summary, image_caption, ocr_text,
    tags (list[str]), key_points (list[str]), domain.

    Best-effort: on any failure returns a usable fallback dict so the
    caller can still save *something* (the user did ask for a capture).
    """
    fallback_title = (spoken_hint.strip()[:60] or "Captured frame")
    fallback = {
        "title": fallback_title,
        "summary": "Captured from your live camera. AI description was unavailable, you can edit this any time.",
        "image_caption": "",
        "ocr_text": "",
        "tags": ["captured", "live"],
        "key_points": [],
        "domain": "Other",
    }
    if not data_url or not data_url.startswith("data:image/"):
        return fallback

    instruction = (
        "You are analyzing ONE image that the user just captured from their "
        "live camera or screen. They want it saved to their personal "
        "knowledge vault, so be concrete and useful — describe what is "
        "actually visible, name the subject, and pull out any readable text.\n\n"
        "Return STRICT JSON with EXACTLY these keys:\n"
        "{\n"
        '  "title": "4-8 word title naming what this image is",\n'
        '  "summary": "2-3 sentences: what is shown, why it might matter later",\n'
        '  "image_caption": "ONE short sentence (max 18 words), literal description of what is visible",\n'
        '  "ocr_text": "ALL readable text in the image, preserving line breaks. Empty string if none.",\n'
        '  "tags": ["3-5 lowercase 1-2 word tags useful for search"],\n'
        '  "key_points": ["3-5 short bullet-style takeaways from what is visible"],\n'
        '  "domain": "single word from: AI, Technology, Science, Business, Health, History, Philosophy, Engineering, Productivity, Other"\n'
        "}\n"
        "Rules: never return null. If something is unknown, use an empty "
        "string or empty array. Do NOT wrap the JSON in markdown."
    )
    if spoken_hint:
        instruction += f"\n\nUser context (what they said when capturing): {spoken_hint[:240]}"

    async def _call(client, model_name: str) -> str:
        resp = await client.chat.completions.create(
            model=model_name,
            messages=[{
                "role": "user",
                "content": [
                    {"type": "text", "text": instruction},
                    {"type": "image_url", "image_url": {"url": data_url}},
                ],
            }],
            temperature=0.2,
            response_format={"type": "json_object"},
        )
        return (resp.choices[0].message.content or "").strip()

    raw = ""
    try:
        primary = get_primary_client()
        raw = await _call(primary, settings.OPENAI_MODEL)
    except Exception as e:
        print(f"analyze_visual_frame primary error: {e}")
        try:
            from app.ai_helper import get_fallback_client
            fb_client, fb_model = get_fallback_client()
            if fb_client:
                # Some fallbacks reject response_format json_object — retry without it.
                try:
                    raw = await _call(fb_client, fb_model)
                except Exception:
                    resp = await fb_client.chat.completions.create(
                        model=fb_model,
                        messages=[{
                            "role": "user",
                            "content": [
                                {"type": "text", "text": instruction + "\n\nReturn ONLY the JSON, nothing else."},
                                {"type": "image_url", "image_url": {"url": data_url}},
                            ],
                        }],
                        temperature=0.2,
                    )
                    raw = (resp.choices[0].message.content or "").strip()
        except Exception as e2:
            print(f"analyze_visual_frame fallback error: {e2}")

    if not raw:
        return fallback

    # Tolerate markdown-wrapped JSON ("```json ... ```")
    cleaned = raw.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.strip("`")
        # Drop optional language tag on the first line.
        if "\n" in cleaned:
            first, rest = cleaned.split("\n", 1)
            if first.strip().lower() in {"json", "javascript"}:
                cleaned = rest

    import json as _json
    try:
        data = _json.loads(cleaned)
    except Exception:
        # Last-ditch: salvage the first {...} block.
        import re as _re
        m = _re.search(r"\{[\s\S]*\}", cleaned)
        if not m:
            return fallback
        try:
            data = _json.loads(m.group(0))
        except Exception:
            return fallback

    if not isinstance(data, dict):
        return fallback

    def _str(v, cap: int) -> str:
        return str(v or "").strip()[:cap]

    def _list(v, cap_item: int, cap_len: int) -> list:
        if not isinstance(v, list):
            return []
        out = []
        for it in v[:cap_len]:
            s = str(it or "").strip()
            if s:
                out.append(s[:cap_item])
        return out

    return {
        "title": _str(data.get("title"), 120) or fallback_title,
        "summary": _str(data.get("summary"), 1200),
        "image_caption": _str(data.get("image_caption"), 240),
        "ocr_text": _str(data.get("ocr_text"), ANALYSIS_TEXT_BUDGET),
        "tags": _list(data.get("tags"), 32, 8) or ["captured", "live"],
        "key_points": _list(data.get("key_points"), 200, 7),
        "domain": _str(data.get("domain"), 32) or "Other",
    }


async def suggest_enrichments(
    raw_text: str,
    title: str = "",
    source_type: str = "note",
    existing_habits: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """One structured-JSON LLM call returning AI suggestions for the
    capture-enrichment chips: folder placement hint, follow-up tasks,
    a calendar event, an existing-habit link, and a spaced-repetition
    revisit cadence.

    Always returns the EMPTY_SUGGESTIONS shape on any error so callers
    can blindly merge into the preview response. Uses the cheap
    fallback model preferentially to keep cost + latency low. Caller
    is responsible for wrapping in `asyncio.wait_for` with a timeout
    if it needs to soft-fail; this helper itself never raises.
    """
    if not (raw_text or title):
        return dict(EMPTY_SUGGESTIONS)

    body = (raw_text or "").strip()
    if len(body) > 3500:
        body = body[:3500].rsplit(" ", 1)[0] + "…"

    habits_block = ""
    if existing_habits:
        habits_block = "\n\nUser's existing habits (only suggest a habit_link if the content CLEARLY relates to one of these):\n"
        for h in existing_habits[:12]:
            hid = h.get("id", "")
            hname = h.get("name", "")
            if hid and hname:
                habits_block += f"  - id={hid}  name={hname}\n"

    today = datetime.date.today().isoformat()
    prompt = f"""You suggest helpful follow-ups for a captured piece of content.
Today's date is {today}.

Content title: {title or "(untitled)"}
Content type: {source_type}

Content body:
\"\"\"
{body or "(empty)"}
\"\"\"
{habits_block}
Return ONLY a JSON object with EXACTLY these keys:

- "suggested_folder_hint": short 2-4 word folder name (e.g. "AI Research", "Workout Logs", "Meeting Notes"). "" if unclear.
- "suggested_tasks": array of AT MOST 3 follow-up actions, each {{"title": "verb-led short sentence", "priority": "low" | "medium" | "high"}}. [] if none make sense.
- "suggested_event": null OR {{"title": "...", "date": "YYYY-MM-DD", "time": "HH:MM" 24h, "duration_minutes": int}}. Only suggest if the content is review-worthy or time-sensitive. Default duration 30.
- "suggested_habit_link": null OR {{"habit_id": "...", "reason": "1 short sentence"}}. Only set if the content clearly maps to one of the user's existing habits listed above.
- "suggested_revisit": null OR {{"frequency": "once" | "daily" | "weekly" | "monthly", "next_due": "YYYY-MM-DD"}}. Suggest only when the content benefits from spaced re-reading.

Be conservative — empty / null is better than spammy. Return ONLY the JSON, no markdown."""

    client_pair = get_fallback_client()
    if client_pair[0]:
        client, model = client_pair
    else:
        client, model = get_primary_client(), settings.OPENAI_MODEL

    try:
        resp = await client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.2,
            response_format={"type": "json_object"},
        )
        raw = (resp.choices[0].message.content or "").strip()
        from app.ai_helper import _clean_json
        data = json.loads(_clean_json(raw))
    except Exception as e:
        print(f"suggest_enrichments error (soft-fail): {e}")
        return dict(EMPTY_SUGGESTIONS)

    # Normalise to the strict shape so the frontend never sees a wrong type.
    out = dict(EMPTY_SUGGESTIONS)
    hint = str(data.get("suggested_folder_hint") or "").strip()
    if hint:
        out["suggested_folder_hint"] = hint[:60]

    raw_tasks = data.get("suggested_tasks") or []
    tasks: List[Dict[str, Any]] = []
    if isinstance(raw_tasks, list):
        for t in raw_tasks[:3]:
            if not isinstance(t, dict):
                continue
            title_t = str(t.get("title") or "").strip()
            if not title_t:
                continue
            prio = str(t.get("priority") or "medium").strip().lower()
            if prio not in ("low", "medium", "high"):
                prio = "medium"
            tasks.append({"title": title_t[:160], "priority": prio})
    out["suggested_tasks"] = tasks

    ev = data.get("suggested_event")
    if isinstance(ev, dict) and ev.get("title") and ev.get("date") and ev.get("time"):
        try:
            dur = int(ev.get("duration_minutes") or 30)
        except (TypeError, ValueError):
            dur = 30
        out["suggested_event"] = {
            "title": str(ev.get("title"))[:160],
            "date": str(ev.get("date"))[:10],
            "time": str(ev.get("time"))[:5],
            "duration_minutes": max(5, min(dur, 480)),
        }

    hab = data.get("suggested_habit_link")
    if isinstance(hab, dict) and hab.get("habit_id"):
        out["suggested_habit_link"] = {
            "habit_id": str(hab.get("habit_id"))[:48],
            "reason": str(hab.get("reason") or "")[:200],
        }

    rev = data.get("suggested_revisit")
    if isinstance(rev, dict) and rev.get("frequency"):
        freq = str(rev.get("frequency")).strip().lower()
        if freq in ("once", "daily", "weekly", "monthly"):
            out["suggested_revisit"] = {
                "frequency": freq,
                "next_due": str(rev.get("next_due") or "")[:10],
            }

    return out


async def analyze_with_openai(raw_text: str, model: str, *, source_type: str = "note") -> dict:
    """Generate a rich, structured analysis. The schema is the same across source
    types so the UI can render any subset; PDFs/web articles especially benefit
    from action_items, glossary and study_questions."""
    prompt = f"""You are an expert knowledge analyst. Analyze the following content
and return a JSON object with EXACTLY these keys:

- "summary": 3-4 sentence high-signal overview
- "executive_summary": 1 short paragraph (~60 words) for a busy reader — what this is, why it matters, biggest takeaway
- "key_points": array of 5-7 strings, each a crisp one-line insight (no leading bullets/numbers)
- "action_items": array of 3-5 short imperative phrases the reader should DO after reading (e.g., "Implement X locally", "Read paper Y", "Try Z exercise")
- "glossary": array of 3-6 objects {{"term": "...", "definition": "1 short sentence"}} for important domain terms
- "study_questions": array of 4-6 self-test questions that probe genuine understanding (avoid trivia)
- "tags": array of 4-6 lowercase short tags (1-2 words, no #), useful for search
- "domain": single word from: AI, Technology, Science, Business, Health, History, Philosophy, Engineering, Productivity, Other

Source type: {source_type}

Content:
\"\"\"
{raw_text if raw_text else "No content available."}
\"\"\"

Return ONLY valid JSON. Do not wrap it in markdown."""
    return await chat_json(
        messages=[{"role": "user", "content": prompt}],
        model=model,
        temperature=0.25,
    )


async def _run_analysis_or_raise(raw_text: str, model: str, source_type: str) -> dict:
    """Wrap analyze_with_openai so asyncio.gather sees a normal coroutine.
    Re-raises the underlying exception so the caller can apply its own
    graceful-degradation logic (raw-text fallback + AI-pending flag).
    """
    return await analyze_with_openai(raw_text, model, source_type=source_type)


def _coerce_glossary(raw) -> list:
    """Normalize glossary into [{'term': str, 'definition': str}, ...]."""
    if not isinstance(raw, list):
        return []
    out = []
    for it in raw[:8]:
        if isinstance(it, dict):
            term = str(it.get("term") or it.get("name") or "").strip()
            defn = str(it.get("definition") or it.get("def") or it.get("desc") or "").strip()
            if term and defn:
                out.append({"term": term[:60], "definition": defn[:280]})
    return out


def _coerce_str_list(raw, max_items: int = 8, max_len: int = 240) -> list:
    if not isinstance(raw, list):
        return []
    out = []
    for it in raw[:max_items]:
        if it is None:
            continue
        s = str(it).strip()
        if s:
            out.append(s[:max_len])
    return out


async def capture(source_type: str, url: str = "", content: str = "", pdf_bytes: bytes = None, user_id: str = "", preview: bool = False) -> dict:
    """Capture knowledge from various sources using OpenAI for analysis."""
    # Resolve user_id from the request context if caller didn't override it.
    if not user_id:
        try:
            from app.user_context import get_uid
            user_id = get_uid()
        except Exception:
            user_id = "guest"
    api_key = settings.OPENAI_API_KEY
    if not api_key:
        return {"error": "OPENAI_API_KEY not found. Please set it in the Secrets panel."}

    model = settings.OPENAI_MODEL
    raw_text = ""
    title = "Untitled Content"
    # Optional PDF metadata that flows through to the saved memory document.
    pdf_meta: dict = {}

    try:
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }

        if source_type == "youtube":
            # Sanity-check the user-supplied URL even though the actual
            # fetch below targets youtube.com — the URL appears in the
            # query string (and in the analyzer prompt), so we still want
            # the scheme/length/no-credentials guardrails.
            try:
                if url:
                    validate_url_shape(url)
            except UnsafeURLError as e:
                return {"error": f"Invalid URL: {e}"}
            video_id_match = re.search(r"(?:v=|\/)([0-9A-Za-z_-]{11}).*", url)
            if video_id_match:
                video_id = video_id_match.group(1)
                try:
                    transcript_list = YouTubeTranscriptApi.get_transcript(video_id)
                    raw_text = " ".join([t['text'] for t in transcript_list])[:4000]
                    title = f"YouTube Video: {video_id}"
                except Exception as e:
                    # oembed fallback — fixed host (youtube.com) but we
                    # still go through safe_get for consistent timeouts,
                    # byte caps and content-type enforcement.
                    try:
                        resp = await safe_get(
                            url=f"https://www.youtube.com/oembed?url={url}&format=json",
                            timeout=10.0,
                            headers=headers,
                            max_bytes=DEFAULT_MAX_BYTES_JSON,
                            allowed_content_types=("application/json", "text/json"),
                        )
                        if resp.status_code == 200:
                            title = resp.json().get("title", "YouTube Video")
                    except Exception:
                        title = "YouTube Video (Title Unavailable)"
                    raw_text = f"Title: {title}\nTranscript unavailable. Error: {str(e)}"
            else:
                raw_text = f"Invalid YouTube URL: {url}"
                title = "Invalid YouTube Link"

        elif source_type == "web":
            try:
                resp = await safe_get(
                    url=url,
                    timeout=15.0,
                    headers=headers,
                    max_bytes=DEFAULT_MAX_BYTES_WEB,
                    allowed_content_types=(
                        "text/html",
                        "application/xhtml+xml",
                        "text/plain",
                        # Some CDNs serve articles under application/xml or
                        # text/xml (RSS/Atom previews); allow those too.
                        "application/xml",
                        "text/xml",
                    ),
                )
                soup = BeautifulSoup(resp.text, 'lxml')
                title = soup.title.string.strip() if soup.title else "Web Article"
                meta_desc = ""
                desc_tag = soup.find("meta", attrs={"name": "description"}) or soup.find("meta", attrs={"property": "og:description"})
                if desc_tag:
                    meta_desc = desc_tag.get("content", "").strip()
                paragraphs = [p.get_text().strip() for p in soup.find_all('p') if len(p.get_text().strip()) > 20]
                content_text = " ".join(paragraphs)
                raw_text = f"Title: {title}\nDescription: {meta_desc}\nContent: {content_text}"[:4000]
            except UnsafeURLError as e:
                # Surface as a clean 4xx-ish error string the endpoint
                # converts into HTTP 400 — never bubble the stack trace.
                return {"error": f"Refused to fetch URL: {e}"}
            except Exception as e:
                raw_text = f"Failed to scrape web article: {url}. Error: {str(e)}"
                title = "Web Scrape Failed"

        elif source_type == "pdf":
            pdf_source_bytes: Optional[bytes] = pdf_bytes
            if not pdf_source_bytes and url:
                try:
                    resp = await safe_get(
                        url=url,
                        timeout=20.0,
                        headers=headers,
                        max_bytes=DEFAULT_MAX_BYTES_PDF,
                        allowed_content_types=(
                            "application/pdf",
                            # Some servers mis-label PDFs as octet-stream;
                            # accept it and let pypdf reject if not a PDF.
                            "application/octet-stream",
                            "binary/octet-stream",
                        ),
                    )
                    pdf_source_bytes = resp.content
                except UnsafeURLError as e:
                    return {"error": f"Refused to fetch PDF: {e}"}
                except Exception as e:
                    raw_text = f"Failed to fetch PDF: {str(e)}"
                    title = "PDF Error"

            if pdf_source_bytes:
                try:
                    reader = PdfReader(io.BytesIO(pdf_source_bytes))
                    page_count = len(reader.pages)
                    # Try to use the embedded title from PDF metadata
                    try:
                        meta = reader.metadata or {}
                        meta_title = (getattr(meta, "title", None) or meta.get("/Title") or "").strip() if meta else ""
                        if meta_title:
                            title = meta_title[:140]
                        else:
                            title = "PDF Document"
                    except Exception:
                        title = "PDF Document"

                    text_parts = []
                    for i, page in enumerate(reader.pages):
                        try:
                            extracted = page.extract_text()
                        except Exception:
                            extracted = ""
                        if extracted:
                            text_parts.append(extracted)
                    raw_text = "\n\n".join(text_parts)[:ANALYSIS_TEXT_BUDGET]

                    pdf_meta["pdf_pages"] = page_count
                    pdf_meta["pdf_size_kb"] = round(len(pdf_source_bytes) / 1024, 1)
                    pdf_meta["pdf_word_count"] = len(raw_text.split())
                    # Embed the actual bytes as base64 only when small enough
                    # so Vault can render the original PDF inline.
                    if len(pdf_source_bytes) <= MAX_EMBED_PDF_BYTES:
                        b64 = base64.b64encode(pdf_source_bytes).decode("ascii")
                        pdf_meta["pdf_data"] = f"data:application/pdf;base64,{b64}"
                except Exception as e:
                    raw_text = f"Failed to parse PDF. Error: {str(e)}"
                    title = "PDF Parse Error"
            elif not raw_text:
                raw_text = "No PDF content provided."
                title = "Empty PDF"

        elif source_type == "note":
            raw_text = content[:4000]
            words = content.split()[:6]
            title = " ".join(words) + ("..." if len(content.split()) > 6 else "")
            if not title:
                title = "Quick Note"

        ai_analysis_pending = False
        ai_error_reason = ""

        # Pull the user's existing habits IN PARALLEL with analysis so the
        # suggestion call has context for its habit_link recommendation.
        # Best-effort: if the lookup fails, suggestions just won't include
        # a habit link.
        async def _safe_habits() -> List[Dict[str, Any]]:
            try:
                from app.extras_agent import list_habits
                return await list_habits()
            except Exception as e:
                print(f"suggest habits fetch failed: {e}")
                return []

        # Run the rich analysis AND the suggestion call in parallel.
        # Suggestions soft-fail (no exception) — they're a nice-to-have,
        # not a blocker. Capped at SUGGESTION_TIMEOUT_SECONDS so the
        # capture preview never stalls behind a slow AI call.
        async def _suggest_with_timeout() -> Dict[str, Any]:
            try:
                habits = await _safe_habits()
                return await asyncio.wait_for(
                    suggest_enrichments(
                        raw_text=raw_text,
                        title=title,
                        source_type=source_type,
                        existing_habits=habits,
                    ),
                    timeout=SUGGESTION_TIMEOUT_SECONDS,
                )
            except asyncio.TimeoutError:
                print(f"suggest_enrichments timed out after {SUGGESTION_TIMEOUT_SECONDS}s")
                return dict(EMPTY_SUGGESTIONS)
            except Exception as e:
                print(f"suggest_enrichments outer error: {e}")
                return dict(EMPTY_SUGGESTIONS)

        # Use return_exceptions so a failure in analyze_with_openai
        # doesn't cancel the suggestion task (and vice versa).
        analysis_result, suggestions = await asyncio.gather(
            asyncio.shield(_run_analysis_or_raise(raw_text, model, source_type)),
            _suggest_with_timeout(),
            return_exceptions=True,
        )
        if isinstance(suggestions, BaseException):
            suggestions = dict(EMPTY_SUGGESTIONS)

        try:
            if isinstance(analysis_result, BaseException):
                raise analysis_result
            analysis = analysis_result
        except Exception as e:
            err_str = str(e)
            print(f"OpenAI Analysis Error (degrading gracefully): {err_str}")
            ai_analysis_pending = True
            # Extract a clean human-readable reason — strip provider noise.
            if "402" in err_str or "Payment Required" in err_str or "credits" in err_str.lower():
                ai_error_reason = "AI provider out of credits"
            elif "429" in err_str or "rate" in err_str.lower() or "quota" in err_str.lower():
                ai_error_reason = "AI provider rate-limited (try again in a few minutes)"
            elif "401" in err_str or "API key" in err_str or "invalid" in err_str.lower():
                ai_error_reason = "AI API key invalid or missing"
            else:
                ai_error_reason = "AI analysis temporarily unavailable"

            # Use the raw captured content as a clean preview summary so the
            # user can still SEE what was saved, instead of an error dump.
            preview_text = (raw_text or "").strip()
            if len(preview_text) > 600:
                preview_text = preview_text[:600].rsplit(" ", 1)[0] + "…"

            # Default tags by source type — no scary "error" / "retry" tags.
            default_tags_by_type = {
                "youtube": ["video", "unanalyzed"],
                "web": ["article", "unanalyzed"],
                "pdf": ["document", "unanalyzed"],
                "note": ["note", "unanalyzed"],
            }
            analysis = {
                "summary": preview_text or "Saved without AI analysis. Click Re-analyze when ready.",
                "executive_summary": "",
                "key_points": [],
                "action_items": [],
                "glossary": [],
                "study_questions": [],
                "tags": default_tags_by_type.get(source_type, ["captured", "unanalyzed"]),
                "domain": "Other",
            }

        memory_doc = {
            "source_type": source_type,
            "source_url": url,
            "title": analysis.get("title", title),
            "summary": analysis.get("summary", ""),
            "executive_summary": str(analysis.get("executive_summary") or "").strip(),
            "key_points": _coerce_str_list(analysis.get("key_points"), max_items=8, max_len=320),
            "action_items": _coerce_str_list(analysis.get("action_items"), max_items=6, max_len=200),
            "glossary": _coerce_glossary(analysis.get("glossary")),
            "study_questions": _coerce_str_list(analysis.get("study_questions"), max_items=6, max_len=240),
            "tags": _coerce_str_list(analysis.get("tags"), max_items=8, max_len=40),
            "domain": analysis.get("domain", "Other"),
            "userId": user_id,
            "user_id": user_id,
            "created_at": datetime.datetime.now(datetime.timezone.utc),
            # Inbox-triage flags — newly captured items land in the Inbox
            # until the user reviews or archives them.
            "reviewed": False,
            "archived": False,
            # AI-degradation flags — set when analyze_with_openai failed and
            # the memory was saved with a raw-text preview instead. Frontend
            # uses these to render the "Re-analyze with AI" prompt.
            "ai_analysis_pending": ai_analysis_pending,
            "ai_error_reason": ai_error_reason,
            # Cross-link slots — empty by default, populated when the user
            # saves via /capture/save-bundle (W1) or links from the memory
            # detail page (W2). Always present so the frontend can iterate
            # them without conditional checks.
            "folder_ref": None,
            "linked_memory_ids": [],
            "linked_task_ids": [],
            "linked_event_ids": [],
            "linked_habit_ids": [],
            "linked_revisit_ids": [],
        }
        memory_doc["title"] = title
        # Attach PDF metadata (page count, size, embedded bytes) when available
        memory_doc.update(pdf_meta)
        # Surface the parallel AI suggestions to the frontend. These are
        # PREVIEW-ONLY hints — they're not persisted on the saved memory
        # doc. The capture page renders them as chip defaults; whatever
        # the user accepts becomes a real link via /capture/save-bundle.
        memory_doc.update(suggestions or EMPTY_SUGGESTIONS)

        duplicate_of = None
        if url:
            try:
                duplicate_of = await _find_duplicate_by_url(user_id, url)
            except Exception as dup_e:
                print(f"Duplicate check failed: {dup_e}")

        if not preview:
            if duplicate_of:
                memory_doc["id"] = duplicate_of["id"]
                memory_doc["duplicate"] = True
                memory_doc["existing"] = duplicate_of
            else:
                memory_doc = await _atomic_create_memory(memory_doc, user_id, url)
        else:
            memory_doc["id"] = "preview_id"
            if duplicate_of:
                memory_doc["duplicate_of"] = duplicate_of

        if hasattr(memory_doc["created_at"], "isoformat"):
            memory_doc["created_at"] = memory_doc["created_at"].isoformat()

        return memory_doc
    except Exception as e:
        print(f"General Capture Error: {e}")
        return {"error": str(e)}


def _normalize_url(raw: str) -> str:
    """Lowercase scheme/host, strip default ports, drop trailing slash on path,
    drop common tracking params (utm_*, fbclid, gclid, ref, ref_src). Returns ''
    if input is falsy or unparseable."""
    if not raw:
        return ""
    try:
        s = raw.strip()
        if not s:
            return ""
        parts = urlsplit(s)
        scheme = (parts.scheme or "https").lower()
        netloc = parts.netloc.lower()
        # strip default ports
        if netloc.endswith(":80") and scheme == "http":
            netloc = netloc[:-3]
        if netloc.endswith(":443") and scheme == "https":
            netloc = netloc[:-4]
        path = parts.path or ""
        if path.endswith("/") and len(path) > 1:
            path = path[:-1]
        # filter tracking params
        TRACKER_PREFIXES = ("utm_",)
        TRACKER_KEYS = {"fbclid", "gclid", "ref", "ref_src", "mc_cid", "mc_eid"}
        if parts.query:
            kept = []
            for kv in parts.query.split("&"):
                if not kv:
                    continue
                k = kv.split("=", 1)[0].lower()
                if k in TRACKER_KEYS or any(k.startswith(p) for p in TRACKER_PREFIXES):
                    continue
                kept.append(kv)
            query = "&".join(kept)
        else:
            query = ""
        # drop fragment for dedup purposes
        return urlunsplit((scheme, netloc, path, query, ""))
    except Exception:
        return raw.strip()


def _memory_doc_id(user_id: str, source_url: str) -> Optional[str]:
    """Return a deterministic Firestore document ID for a (user, normalized_url)
    pair, or None if URL is empty (notes/voice/PDF without URL get random IDs)."""
    norm = _normalize_url(source_url)
    if not norm:
        return None
    digest = hashlib.sha1(f"{user_id}|{norm}".encode("utf-8")).hexdigest()[:24]
    return f"u_{digest}"


async def _doc_to_memory_dict(doc) -> Optional[dict]:
    """Convert a Firestore snapshot to the standard duplicate metadata dict, or None."""
    if not getattr(doc, "exists", False):
        return None
    data = doc.to_dict() or {}
    created = data.get("created_at")
    if hasattr(created, "isoformat"):
        created = created.isoformat()
    return {
        "id": doc.id,
        "title": data.get("title", "Untitled"),
        "domain": data.get("domain", ""),
        "source_type": data.get("source_type", ""),
        "source_url": data.get("source_url", ""),
        "created_at": created,
    }


def _content_hash(title: str, summary: str) -> str:
    """SHA1 of normalized (title + first 400 chars of summary).
    Used to detect duplicate note-type memories so the vault doesn't get cluttered
    with near-identical entries when the user re-saves the same insight."""
    import hashlib, re as _re
    norm_title = _re.sub(r"\s+", " ", (title or "").lower().strip())[:200]
    norm_summary = _re.sub(r"\s+", " ", (summary or "").lower().strip())[:400]
    blob = f"{norm_title}|{norm_summary}".encode("utf-8")
    return hashlib.sha1(blob).hexdigest()


async def _find_duplicate_by_content_hash(
    user_id: str, title: str, summary: str, days_window: int = 90
) -> Optional[dict]:
    """Return existing memory dict if same (title+summary) hash already saved
    by this user in the last `days_window` days. Tolerant of legacy memories
    without a content_hash field (it's computed lazily on read)."""
    if not title and not summary:
        return None
    target_hash = _content_hash(title, summary)
    cutoff = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=days_window)
    try:
        db = await get_db()
        # In-memory store doesn't support compound indexed queries cleanly, so we
        # do a userId scan + Python-side filter. Bounded to 200 most-recent.
        snap = await db.collection("memories") \
            .where("userId", "==", user_id) \
            .order_by("created_at", direction="DESCENDING") \
            .limit(200).get()
        for d in snap:
            data = d.to_dict() or {}
            created = data.get("created_at")
            if hasattr(created, "isoformat"):
                created_dt = created if isinstance(created, datetime.datetime) else None
            else:
                try:
                    created_dt = datetime.datetime.fromisoformat(str(created).replace("Z", "+00:00"))
                except Exception:
                    created_dt = None
            if created_dt and created_dt < cutoff:
                continue
            stored = data.get("content_hash")
            if not stored:
                stored = _content_hash(data.get("title", ""), data.get("summary", ""))
            if stored == target_hash:
                return {
                    "id": d.id,
                    "title": data.get("title", "Untitled"),
                    "domain": data.get("domain", ""),
                    "source_type": data.get("source_type", ""),
                    "source_url": data.get("source_url", ""),
                    "created_at": created.isoformat() if hasattr(created, "isoformat") else created,
                }
    except Exception as e:
        print(f"_find_duplicate_by_content_hash error: {e}")
    return None


async def _find_duplicate_by_url(user_id: str, source_url: str) -> Optional[dict]:
    """Return an existing memory dict (id+title+created_at) matching userId+source_url.
    Fast path: deterministic doc lookup. Fallback: legacy `where(userId, source_url)` query
    for older docs with random IDs."""
    if not source_url:
        return None
    try:
        db = await get_db()
        # Fast path: deterministic ID
        det_id = _memory_doc_id(user_id, source_url)
        if det_id:
            doc = await db.collection("memories").document(det_id).get()
            md = await _doc_to_memory_dict(doc)
            if md:
                return md
        # Legacy fallback for memories saved before deterministic IDs existed,
        # and for URLs that share normalized form but were stored with raw URL
        norm = _normalize_url(source_url)
        for candidate_url in {source_url, norm}:
            if not candidate_url:
                continue
            query = db.collection("memories") \
                .where("userId", "==", user_id) \
                .where("source_url", "==", candidate_url) \
                .limit(1)
            docs = await query.get()
            for d in docs:
                data = d.to_dict() or {}
                created = data.get("created_at")
                if hasattr(created, "isoformat"):
                    created = created.isoformat()
                return {
                    "id": d.id,
                    "title": data.get("title", "Untitled"),
                    "domain": data.get("domain", ""),
                    "source_type": data.get("source_type", ""),
                    "source_url": data.get("source_url", ""),
                    "created_at": created,
                }
    except Exception as e:
        print(f"_find_duplicate_by_url error: {e}")
    return None


async def _atomic_create_memory(memory_doc: dict, user_id: str, source_url: str, force_new: bool = False) -> dict:
    """Insert a memory doc atomically. For URL-bearing memories we use a deterministic
    document ID (sha1 of userId|normalized_url) so two concurrent saves of the same URL
    end up overwriting the SAME doc instead of creating two records. For URL-less
    memories (notes, voice, PDF without URL) we fall back to auto-generated IDs.

    When `force_new=True` (the frontend's "Save anyway" override), we skip the
    deterministic-ID path entirely so a duplicate URL still produces a fresh
    document with a new auto-generated ID — otherwise the URL collision would
    silently overwrite/return the existing doc and "Save anyway" would be a
    no-op for URL captures."""
    # Heavy fields that we'll drop on a retry if Firestore rejects the
    # write for being too large. These are inline binary payloads that
    # blow past the 1 MiB doc limit when the source file is bigger than
    # our cap or when multiple attached binaries pile up.
    _HEAVY_FIELDS = ("pdf_data", "image_data", "image_thumbnail")

    async def _do_write(doc: dict) -> dict:
        det_id = None if force_new else _memory_doc_id(user_id, source_url)
        if det_id:
            doc_ref = db.collection("memories").document(det_id)
            existing = await doc_ref.get()
            if getattr(existing, "exists", False):
                md = await _doc_to_memory_dict(existing) or {"id": det_id}
                doc["id"] = det_id
                doc["duplicate"] = True
                doc["existing"] = md
                return doc
            # Persist a normalized source_url so legacy `where` queries also hit this row
            doc["source_url"] = _normalize_url(source_url) or source_url
            await doc_ref.set(doc)
            doc["id"] = det_id
            return doc
        _, doc_ref = await db.collection("memories").add(doc)
        doc["id"] = doc_ref.id
        return doc

    try:
        db = await get_db()
        try:
            return await _do_write(memory_doc)
        except Exception as first_err:
            # If the initial write failed AND we have heavy inline fields,
            # retry once with those stripped so the memory still lands in
            # the vault (with text + summary + metadata). Better than the
            # silent "mock_id_*" fake-success path that used to leave the
            # PDF entirely missing from the user's library.
            heavy_present = [k for k in _HEAVY_FIELDS if memory_doc.get(k)]
            if not heavy_present:
                raise
            print(
                f"Firestore Save Retry: dropping heavy fields {heavy_present} "
                f"after first attempt failed: {first_err}"
            )
            slim = {k: v for k, v in memory_doc.items() if k not in _HEAVY_FIELDS}
            slim["embed_dropped"] = True
            slim["embed_dropped_reason"] = "doc_too_large"
            slim["embed_dropped_fields"] = heavy_present
            return await _do_write(slim)
    except Exception as db_e:
        # Last-ditch fallback so the frontend doesn't completely lose
        # the capture. The mock_id makes it obvious this didn't persist.
        print(f"Firestore Save Error (final): {db_e}")
        memory_doc["id"] = f"mock_id_{int(datetime.datetime.now().timestamp())}"
        memory_doc["save_failed"] = True
        memory_doc["save_error"] = str(db_e)
        return memory_doc


async def save_memory(memory_data: dict, user_id: str = "") -> dict:
    if not user_id:
        try:
            from app.user_context import get_uid
            user_id = get_uid()
        except Exception:
            user_id = "guest"
    try:
        source_url = memory_data.get("source_url", "")
        # When the frontend's "Save anyway" override is set, skip BOTH dedup
        # guards (URL + content-hash) so the user gets a fresh memory ID even
        # if a near-duplicate already exists.
        force_new = bool(memory_data.get("force_new", False))

        if not force_new:
            # Duplicate guard #1: same URL → return existing
            existing = await _find_duplicate_by_url(user_id, source_url) if source_url else None
            if existing:
                return {
                    **existing,
                    "duplicate": True,
                    "existing": existing,
                }

            # Duplicate guard #2 (anti-clutter for notes): same content hash within 90 days.
            # Skips when there IS a URL — _find_duplicate_by_url already covers that case.
            if not source_url:
                content_dup = await _find_duplicate_by_content_hash(
                    user_id,
                    memory_data.get("title", ""),
                    memory_data.get("summary", ""),
                )
                if content_dup:
                    return {
                        **content_dup,
                        "duplicate": True,
                        "duplicate_reason": "content_hash",
                        "existing": content_dup,
                    }

        memory_doc = {
            "source_type": memory_data.get("source_type", "note"),
            "source_url": source_url,
            "title": memory_data.get("title", "Untitled"),
            "summary": memory_data.get("summary", ""),
            "executive_summary": memory_data.get("executive_summary", ""),
            "key_points": memory_data.get("key_points", []) or [],
            "action_items": memory_data.get("action_items", []) or [],
            "glossary": memory_data.get("glossary", []) or [],
            "study_questions": memory_data.get("study_questions", []) or [],
            "tags": memory_data.get("tags", []) or [],
            "domain": memory_data.get("domain", "Other"),
            "content_hash": _content_hash(
                memory_data.get("title", ""), memory_data.get("summary", "")
            ),
            "userId": user_id,
            "user_id": user_id,
            "created_at": datetime.datetime.now(datetime.timezone.utc),
            # Inbox-triage flags — newly captured items land in the Inbox
            # until the user reviews or archives them.
            "reviewed": False,
            "archived": False,
            # Cross-link slots — caller (typically /capture/save-bundle)
            # can pre-populate these via memory_data; otherwise they stay
            # empty so the memory detail page can iterate them safely.
            "folder_ref": memory_data.get("folder_ref") or None,
            "linked_memory_ids": list(memory_data.get("linked_memory_ids") or []),
            "linked_task_ids": list(memory_data.get("linked_task_ids") or []),
            "linked_event_ids": list(memory_data.get("linked_event_ids") or []),
            "linked_habit_ids": list(memory_data.get("linked_habit_ids") or []),
            "linked_revisit_ids": list(memory_data.get("linked_revisit_ids") or []),
        }
        # PDF-only optional fields
        for k in ("pdf_data", "pdf_pages", "pdf_size_kb", "pdf_word_count"):
            if memory_data.get(k) is not None:
                memory_doc[k] = memory_data.get(k)
        # Image-only optional fields (session-tray OCR'd images).
        # `image_data` is the base64 data URL so vault detail can render the
        # original image; `image_caption` is the user-supplied label;
        # `ocr_text` is the recognized text body so search and reading work.
        for k in ("image_data", "image_thumbnail", "image_caption", "ocr_text"):
            if memory_data.get(k) is not None:
                memory_doc[k] = memory_data.get(k)
        # Free-form note from the user
        if memory_data.get("notes"):
            memory_doc["notes"] = memory_data.get("notes")
        memory_doc = await _atomic_create_memory(memory_doc, user_id, source_url, force_new=force_new)

        if hasattr(memory_doc.get("created_at"), "isoformat"):
            memory_doc["created_at"] = memory_doc["created_at"].isoformat()
        return memory_doc
    except Exception as e:
        return {"error": str(e)}


async def save_bundle(payload: Dict[str, Any]) -> Dict[str, Any]:
    """Save a captured memory PLUS any user-accepted enrichments (folder
    placement, follow-up tasks, calendar event, revisit cadence,
    explicit memory→memory links) in one transactional-ish call.

    Each enrichment is best-effort: a single failure (e.g. invalid
    folder_id) does NOT roll back the memory itself — the memory is
    the source of truth. Failures are surfaced in the response under
    `errors` so the frontend can show a partial-success toast.

    Payload shape:
      memory: dict (same shape as MemorySaveRequest)
      folder_ref: optional {project_id, folder_id, section_id}
      tasks: optional list of {title, priority, due_date}
      event: optional {title, date, time, duration_minutes, topic, description}
      revisit: optional {frequency, interval_days, specific_date}
      habit_link: optional {habit_id}
      linked_memory_ids: optional list of memory IDs this capture refers to
    """
    from app.user_context import get_uid
    user_id = get_uid()

    memory_payload = dict(payload.get("memory") or {})
    folder_ref = payload.get("folder_ref") or None
    tasks_in = payload.get("tasks") or []
    event_in = payload.get("event") or None
    revisit_in = payload.get("revisit") or None
    habit_link_in = payload.get("habit_link") or None
    linked_memory_ids = list(payload.get("linked_memory_ids") or [])
    # W4-1 auto-folder hint — used only when caller didn't pick a
    # folder. Always passed by the capture analyze() flow; safe to
    # ignore for legacy clients.
    suggested_folder_hint = str(payload.get("suggested_folder_hint") or "").strip()

    # Stage 1: persist the memory FIRST so we have a stable id to link
    # everything else against. Inject any pre-known links from the
    # caller so they end up on the doc directly.
    memory_payload["folder_ref"] = folder_ref
    memory_payload["linked_memory_ids"] = linked_memory_ids
    saved = await save_memory(memory_payload, user_id=user_id)
    if "error" in saved:
        return {"error": saved["error"]}
    memory_id = saved.get("id") or saved.get("memory_id") or ""

    created_task_ids: List[str] = []
    created_event_ids: List[str] = []
    created_revisit_ids: List[str] = []
    linked_habit_ids: List[str] = []
    errors: List[str] = []
    auto_filed: Optional[Dict[str, Any]] = None  # W4-1 response field

    # W4-1 — auto-folder placement.
    # If the caller didn't pick a folder but capture analyze handed us
    # a hint (or we can derive one from the primary tag), match it
    # against the user's existing folders. Above the 0.7 confidence
    # bar we file silently and tell the UI via `auto_filed` so it can
    # show an "auto-filed → undo" toast. We also rewrite folder_ref
    # in-place so Stage 2 below picks it up and the regular code path
    # handles the actual write — keeps the placement logic in one
    # place.
    if not (folder_ref and folder_ref.get("project_id") and folder_ref.get("folder_id")):
        # P4B — respect the per-user auto-folder opt-out toggle. Soft-fails
        # to "enabled" so a prefs read error never silently disables the
        # feature for the user without their consent.
        try:
            from app.auto_link_prefs import is_auto_folder_enabled
            _af_on = await is_auto_folder_enabled()
        except Exception:
            _af_on = True
        hint = suggested_folder_hint if _af_on else ""
        if _af_on and not hint:
            # Fall back to the primary tag — cheap, deterministic.
            tags = memory_payload.get("tags") or saved.get("tags") or []
            for t in tags:
                t = str(t or "").strip()
                if t:
                    hint = t.replace("_", " ")[:60]
                    break
        if hint:
            try:
                from app.workspace_agent import list_projects as ws_list_projects
                from app.folder_matcher import match_folder
                projects = await ws_list_projects()
                # Flatten {project_id, folder_id, folder_name, recent_use_at}
                # for the matcher's expected shape.
                flat: List[Dict[str, Any]] = []
                for p in projects or []:
                    pid = p.get("id") or ""
                    for f in p.get("folders") or []:
                        flat.append({
                            "folder_id": f.get("id") or "",
                            "project_id": pid,
                            "folder_name": f.get("name") or "",
                            "recent_use_at": f.get("recent_use_at") or "",
                        })
                if flat:
                    match = match_folder(hint, flat, threshold=0.7)
                    if match and match.get("folder_id") and match.get("score", 0) >= 0.7:
                        # Rewrite folder_ref so Stage 2 fires the same
                        # placement code path. Section "notes" is the
                        # default for memories.
                        folder_ref = {
                            "project_id": match["project_id"],
                            "folder_id": match["folder_id"],
                            "section_id": "notes",
                        }
                        auto_filed = {
                            "folder_id": match["folder_id"],
                            "folder_name": match.get("folder_name", ""),
                            "project_id": match["project_id"],
                            "project_name": match.get("project_name", ""),
                            "score": round(float(match.get("score", 0)), 3),
                            "hint": hint,
                        }
            except Exception as e:
                # Auto-folder is best-effort; never break the save.
                errors.append(f"auto_folder: {e}")

    # Stage 2: optional folder placement (workspace project items).
    # Skipped if caller didn't supply a folder_ref or if essential keys
    # are missing — no project_id means the memory still saved fine.
    if folder_ref and folder_ref.get("project_id") and folder_ref.get("folder_id"):
        try:
            from app.workspace_agent import add_items as ws_add_items
            await ws_add_items(
                folder_ref["project_id"],
                items=[{
                    "memory_id": memory_id,
                    "title": saved.get("title") or memory_payload.get("title") or "Untitled",
                    "type": "memory",
                }],
                folder_id=folder_ref["folder_id"],
                section_id=folder_ref.get("section_id") or "notes",
            )
        except Exception as e:
            errors.append(f"folder_placement: {e}")

    # Stage 3: tasks
    if tasks_in:
        try:
            from app.task_agent import create_task
            for t in tasks_in[:5]:
                if not isinstance(t, dict):
                    continue
                t_title = str(t.get("title") or "").strip()
                if not t_title:
                    continue
                t_res = await create_task(
                    title=t_title[:160],
                    due_date=str(t.get("due_date") or ""),
                    priority=str(t.get("priority") or "medium"),
                    linked_memory_id=memory_id,
                )
                if isinstance(t_res, dict) and t_res.get("id"):
                    created_task_ids.append(t_res["id"])
        except Exception as e:
            errors.append(f"tasks: {e}")

    # Stage 4: calendar event
    if event_in and isinstance(event_in, dict) and event_in.get("title"):
        try:
            from app.calendar_agent import create_event
            ev_res = await create_event(
                title=str(event_in.get("title"))[:160],
                date=str(event_in.get("date") or ""),
                time=str(event_in.get("time") or ""),
                duration_minutes=int(event_in.get("duration_minutes") or 30),
                description=str(event_in.get("description") or ""),
                linked_task_id="",
                topic=str(event_in.get("topic") or "Other"),
                linked_memory_id=memory_id,
            )
            if isinstance(ev_res, dict) and ev_res.get("id"):
                created_event_ids.append(ev_res["id"])
        except Exception as e:
            errors.append(f"event: {e}")

    # Stage 5: revisit cadence
    if revisit_in and isinstance(revisit_in, dict) and revisit_in.get("frequency"):
        try:
            from app.revisit_agent import create_revisit
            rv_res = await create_revisit(
                title=str(saved.get("title") or memory_payload.get("title") or "Revisit")[:160],
                frequency=str(revisit_in.get("frequency") or "once"),
                memory_id=memory_id,
                url=str(memory_payload.get("source_url") or ""),
                notes="",
                interval_days=int(revisit_in.get("interval_days") or 0),
                specific_date=str(revisit_in.get("specific_date") or ""),
                action_label="Open",
                starts_at="",
            )
            if isinstance(rv_res, dict) and rv_res.get("id"):
                created_revisit_ids.append(rv_res["id"])
        except Exception as e:
            errors.append(f"revisit: {e}")

    # Stage 6: habit link (we just record the habit_id on the memory; the
    # habit doc itself isn't mutated here — that's W4 territory).
    if habit_link_in and isinstance(habit_link_in, dict) and habit_link_in.get("habit_id"):
        linked_habit_ids.append(str(habit_link_in["habit_id"]))

    # Stage 7: backfill the memory doc with the IDs we just created so a
    # single read of the memory has the full link map. Best-effort.
    if memory_id and (created_task_ids or created_event_ids or created_revisit_ids or linked_habit_ids):
        try:
            db = await get_db()
            existing_doc = await db.collection("memories").document(memory_id).get()
            existing = existing_doc.to_dict() if existing_doc.exists else {}
            updates = {
                "linked_task_ids": list(set((existing.get("linked_task_ids") or []) + created_task_ids)),
                "linked_event_ids": list(set((existing.get("linked_event_ids") or []) + created_event_ids)),
                "linked_revisit_ids": list(set((existing.get("linked_revisit_ids") or []) + created_revisit_ids)),
                "linked_habit_ids": list(set((existing.get("linked_habit_ids") or []) + linked_habit_ids)),
            }
            await db.collection("memories").document(memory_id).update(updates)
            saved.update(updates)
        except Exception as e:
            errors.append(f"link_backfill: {e}")

    return {
        "memory": saved,
        "memory_id": memory_id,
        "created_task_ids": created_task_ids,
        "created_event_ids": created_event_ids,
        "created_revisit_ids": created_revisit_ids,
        "linked_habit_ids": linked_habit_ids,
        "linked_memory_ids": linked_memory_ids,
        "auto_filed": auto_filed,
        "errors": errors,
    }


async def generate_flashcards(memory_id: str) -> dict:
    """Generate Q&A flashcards from a saved memory (current user only)."""
    from app.user_context import belongs_to_current_user
    if not (settings.PRIMARY_AI_KEY or settings.OPENAI_API_KEY):
        return {"error": "No AI key configured. Set OPENAI_API_KEY in Secrets."}

    try:
        db = await get_db()
        doc = await db.collection("memories").document(memory_id).get()
        if not doc.exists:
            return {"error": f"Memory {memory_id} not found."}

        memory = doc.to_dict()
        if not belongs_to_current_user(memory):
            return {"error": f"Memory {memory_id} not found."}
        content = f"Title: {memory.get('title')}\nSummary: {memory.get('summary')}\nKey Points: {', '.join(memory.get('key_points', []))}"

        prompt = f"""Create 5 educational flashcards from this content. Return JSON with key "flashcards" containing an array of objects with "question" and "answer" fields.

Content:
{content}"""

        result = await chat_json(
            messages=[{"role": "user", "content": prompt}],
            model=settings.OPENAI_MODEL,
            temperature=0.4,
        )
        cards = result.get("flashcards", [])
        if not cards:
            for v in result.values():
                if isinstance(v, list) and v:
                    cards = v
                    break
        return {
            "memory_title": memory.get("title"),
            "flashcards": cards,
        }
    except Exception as e:
        return {"error": str(e)}


async def generate_study_plan(topic: str = "", days: int = 7) -> dict:
    """Generate a structured study plan based on the current user's saved memories."""
    from app.user_context import belongs_to_current_user
    try:
        db = await get_db()
        snapshot = await db.collection("memories").order_by("created_at", direction="DESCENDING").limit(60).get()
        memories = [doc.to_dict() for doc in snapshot if belongs_to_current_user(doc.to_dict())][:10]

        memory_summary = "\n".join([f"- {m.get('title')}: {m.get('summary', '')[:100]}" for m in memories])

        prompt = f"""Create a {days}-day study plan based on these saved knowledge items{f' focusing on: {topic}' if topic else ''}.

Saved Knowledge:
{memory_summary if memory_summary else 'No memories saved yet.'}

Return JSON with key "plan" containing an array of objects with:
- day (number)
- date (string, starting from today {datetime.date.today().isoformat()})
- title (string)
- activities (array of strings, 2-3 activities)
- duration_minutes (number)
- focus_area (string)"""

        result = await chat_json(
            messages=[{"role": "user", "content": prompt}],
            model=settings.OPENAI_MODEL,
            temperature=0.5,
        )
        return {
            "topic": topic or "General Knowledge Review",
            "days": days,
            "plan": result.get("plan", [])
        }
    except Exception as e:
        return {"error": str(e)}


async def generate_daily_briefing() -> dict:
    """Generate an AI daily briefing grounded in the user's actual vault content.

    Pulls real titles, summaries, key tags, and source distribution so the
    briefing references specific topics the user has captured — never claims
    "no data" when memories exist.

    Side-effect: W4 briefing scanners run here so a briefing trigger
    populates `/suggestions/inbox` with fresh habit-link suggestions
    and surfaces stale linked tasks. Both are best-effort — scanner
    failures are logged but never block the briefing itself.
    """
    from app.user_context import belongs_to_current_user, get_uid
    from collections import Counter

    # W4-2 + W4-5 — fire-and-forget scanners. Run BEFORE the LLM call
    # so a downstream UI fetch of /suggestions/inbox lands on the
    # newest data when the user opens the briefing.
    stale_pending: list = []
    try:
        from app.briefing_agent import scan_habit_memory_links, scan_stale_linked_tasks
        uid_for_scans = get_uid()
        try:
            await scan_habit_memory_links(uid_for_scans)
        except Exception as e:
            print(f"scan_habit_memory_links error: {e}")
        try:
            stale_pending = await scan_stale_linked_tasks(uid_for_scans)
        except Exception as e:
            print(f"scan_stale_linked_tasks error: {e}")
    except Exception as e:
        print(f"briefing scanners import error: {e}")
    try:
        db = await get_db()
        memories_snap = await db.collection("memories").order_by("created_at", direction="DESCENDING").limit(60).get()
        tasks_snap = await db.collection("tasks").where("status", "==", "pending").limit(40).get()

        all_memories = [doc.to_dict() for doc in memories_snap if belongs_to_current_user(doc.to_dict())]
        tasks = [doc.to_dict() for doc in tasks_snap if belongs_to_current_user(doc.to_dict())][:6]

        total_memories = len(all_memories)
        # Top 6 most recent for context — include short summary + first key point
        recent_memories = all_memories[:6]

        # Stats: domain spread, top tags, days since last capture
        domain_counts = Counter(m.get("domain") or "General" for m in all_memories)
        top_domains = [d for d, _ in domain_counts.most_common(3)]
        all_tags = []
        for m in all_memories:
            for t in (m.get("tags") or [])[:5]:
                if t:
                    all_tags.append(str(t).lower())
        top_tags = [t for t, _ in Counter(all_tags).most_common(5)]

        last_capture_days = None
        if recent_memories:
            ts = _parse_iso(recent_memories[0].get("created_at"))
            if ts:
                delta = datetime.datetime.now(datetime.timezone.utc) - ts
                last_capture_days = max(0, delta.days)

        # Source-type spread
        type_counts = Counter((m.get("source_type") or "note").lower() for m in all_memories)
        source_breakdown = ", ".join(f"{c} {k}" for k, c in type_counts.most_common(4)) or "no captures yet"

        # Build a content-rich memory block
        if recent_memories:
            mem_lines = []
            for m in recent_memories:
                title = (m.get("title") or "Untitled").strip()
                summary = (m.get("summary") or "").strip().replace("\n", " ")
                if len(summary) > 180:
                    summary = summary[:177] + "…"
                domain = m.get("domain") or "General"
                mem_lines.append(f"- [{domain}] {title} — {summary}")
            memories_block = "\n".join(mem_lines)
        else:
            memories_block = "(empty — first-time user, no memories captured yet)"

        if tasks:
            tasks_block = "\n".join(
                f"- {t.get('title')} (priority: {t.get('priority', 'medium')})" for t in tasks
            )
        else:
            tasks_block = "(no pending tasks)"

        stats_block = (
            f"Total memories in vault: {total_memories}\n"
            f"Domain spread: {', '.join(top_domains) or '—'}\n"
            f"Top tags: {', '.join(top_tags) or '—'}\n"
            f"Source mix: {source_breakdown}\n"
            f"Last capture: {('today' if last_capture_days == 0 else f'{last_capture_days} days ago') if last_capture_days is not None else 'never'}"
        )

        if total_memories > 0:
            rules_block = (
                f"1. Mention at least ONE specific topic by name from the recent list above.\n"
                f"2. Acknowledge their dominant domain ({top_domains[0] if top_domains else 'learning'}).\n"
                f"3. Suggest one concrete focus action for today (a task to tackle OR a memory to revisit).\n"
                f"4. Do NOT say 'I have no data' or 'no memories' — there are {total_memories} memories above.\n"
                f"5. Tone: warm, energetic, concrete. No filler. No emojis. Plain English only."
            )
        else:
            rules_block = (
                "1. The vault is empty — this is a brand-new user.\n"
                "2. Welcome them warmly and suggest capturing their first knowledge item "
                "(YouTube video, web article, or quick note) to seed the Brain.\n"
                "3. Tone: warm, encouraging, concrete. No filler. No emojis. Plain English only."
            )

        # Longer, structured briefing for the standalone Daily Briefing page.
        # The output is parsed into four named paragraphs so the page can show
        # them as separate sections while the dashboard keeps showing the
        # short executive summary.
        prompt = f"""You are the user's personal AI Second Brain assistant. Generate today's structured daily briefing for {datetime.date.today().strftime('%A, %B %d, %Y')}.

USER'S VAULT STATS:
{stats_block}

RECENT KNOWLEDGE (most recent first — use SPECIFIC titles where you can):
{memories_block}

PENDING TASKS:
{tasks_block}

Output FORMAT — return EXACTLY these five labelled blocks, each on its own line, in this order. No extra text before or after.

SUMMARY: <1-2 sentences, energetic, no filler, the headline takeaway for today>
FOCUS: <2-3 sentences naming the single most important thing to do today and why>
NEW: <2-3 sentences on what is new or trending in their vault, referencing 1-2 specific titles>
REVISIT: <2-3 sentences on what they should revisit today, referencing a specific topic if one stands out>
AT_RISK: <1-2 sentences on what is slipping (overdue task, stalled topic, missed revisit) — be honest but kind>

Rules:
{rules_block}
"""

        # LLM call is best-effort — if the model is unavailable (no API key,
        # rate-limit, network error) we fall back to a deterministic summary
        # composed from the gathered stats so the page still feels alive,
        # especially for the demo seed where rich content exists but the AI
        # provider may not be configured. Without this, every blank-key
        # environment shipped a generic "Welcome back. Open the vault…"
        # summary with empty stats, even though 12 demo memories were loaded.
        sections: dict = {"summary": "", "focus": "", "new": "", "revisit": "", "at_risk": ""}
        raw_llm_content = ""
        try:
            raw_llm_content, _ = await chat_with_fallback(
                messages=[{"role": "user", "content": prompt}],
                model=settings.OPENAI_MODEL,
                temperature=0.6,
                max_tokens=800,
            )
            sections = _parse_briefing_sections(raw_llm_content)
        except Exception as llm_e:
            print(f"[briefing] LLM error: {llm_e} — using deterministic fallback")

        # Deterministic fill — any section the LLM left blank (or the whole
        # set, when the LLM call failed) gets a stats-grounded default so
        # the page never renders a hollow "no data" view when memories exist.
        if not sections.get("summary"):
            if total_memories > 0:
                first_title = (recent_memories[0].get("title") or "Untitled")[:80]
                top_dom = top_domains[0] if top_domains else "your topics"
                sections["summary"] = (
                    f"Welcome back. {total_memories} memories in your vault, "
                    f"mostly in {top_dom}. Most recent: \"{first_title}\"."
                )
            else:
                sections["summary"] = (
                    "Welcome back. Capture your first memory to seed your Second Brain."
                )
        if not sections.get("focus"):
            if tasks:
                first_task = (tasks[0].get("title") or "")[:120]
                sections["focus"] = f"Top priority today: {first_task}."
            elif top_domains:
                sections["focus"] = f"Pick one {top_domains[0]} memory and dig deeper today."
            else:
                sections["focus"] = "Pick one memory and dig deeper today."
        if not sections.get("new") and recent_memories:
            new_titles = " and ".join(
                f"\"{(m.get('title') or 'Untitled')[:60]}\"" for m in recent_memories[:2]
            )
            sections["new"] = f"Newest in your vault: {new_titles}."
        if not sections.get("revisit") and len(recent_memories) > 1:
            rev_title = (recent_memories[-1].get("title") or "Untitled")[:80]
            sections["revisit"] = f"Worth a revisit today: \"{rev_title}\"."
        if not sections.get("at_risk"):
            sections["at_risk"] = "Nothing slipping right now — keep the streak going."

        # Stitch the four detail paragraphs into the longer `briefing` string,
        # so callers that only read `briefing` (e.g. legacy Dashboard usage)
        # still get the full text.
        long_paragraphs = [
            f"Focus: {sections['focus']}" if sections['focus'] else "",
            f"What's new: {sections['new']}" if sections['new'] else "",
            f"Revisit: {sections['revisit']}" if sections['revisit'] else "",
            f"At risk: {sections['at_risk']}" if sections['at_risk'] else "",
        ]
        long_briefing = "\n\n".join(p for p in long_paragraphs if p) or (raw_llm_content or "").strip() or sections["summary"]
        return {
            "briefing": long_briefing,
            "executive_summary": sections["summary"] or long_briefing[:160],
            "sections": sections,
            "date": datetime.date.today().isoformat(),
            "stats": {
                "total_memories": total_memories,
                "top_domains": top_domains,
                "top_tags": top_tags,
                "last_capture_days": last_capture_days,
                "source_breakdown": dict(type_counts),
            },
            # W4-5 — stale pending tasks the briefing UI renders inline
            # under "Still pending from your {date} capture".
            "stale_pending_from_captures": stale_pending,
        }
    except Exception as e:
        print(f"[briefing] generation error: {e}")
        fallback = "Welcome back. Open the vault to pick up where you left off."
        return {
            "briefing": fallback,
            "executive_summary": fallback,
            "sections": {"summary": fallback, "focus": "", "new": "", "revisit": "", "at_risk": ""},
            "date": datetime.date.today().isoformat(),
            "stats": {},
            "stale_pending_from_captures": stale_pending,
        }


def _parse_briefing_sections(raw: str) -> dict:
    """Split a LABELLED briefing string into its named sections. Robust to
    extra whitespace, missing labels, and the model occasionally using
    lowercase or markdown around the labels."""
    import re
    out = {"summary": "", "focus": "", "new": "", "revisit": "", "at_risk": ""}
    if not raw:
        return out
    text = raw.strip()
    # Map of keyword -> output key, in the order they appear.
    labels = [
        ("summary", "summary"),
        ("focus", "focus"),
        ("new", "new"),
        ("revisit", "revisit"),
        ("at[ _]?risk", "at_risk"),
    ]
    # Make the colon optional so a missing punctuation in the model output
    # does not silently swallow a whole section.
    pattern = re.compile(
        r"(?im)^\s*\**\s*(summary|focus|new|revisit|at[ _]?risk)\b\s*\**\s*:?\s*",
    )
    matches = list(pattern.finditer(text))
    if not matches:
        # No labels found — treat the whole thing as the summary so the user
        # still sees something coherent.
        out["summary"] = text
        return out
    for i, m in enumerate(matches):
        key_raw = m.group(1).lower()
        key = "at_risk" if key_raw.startswith("at") else key_raw
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        out[key] = text[start:end].strip().strip("*").strip()
    return out


# ─── Capture-enrichment user preferences ─────────────────────────────────────
# Stores per-user "don't suggest again" lists keyed by source_type so the
# frontend can render the chip empty (with a manual-add button) instead of
# repeating an AI suggestion the user already rejected once. Mirrors the
# briefing_settings flat-collection pattern: one Firestore doc per user.
_PREFS_COLLECTION = "capture_enrichment_prefs"

# Source-type keys we know about. Anything outside this set is silently
# dropped on save so a stale frontend can't poison the doc with garbage.
# NOTE: must mirror the source_type strings the frontend actually emits
# from CapturePage (`web`, `youtube`, `note`, `pdf`, `voice`, `image`,
# `session`, `code`, `clipboard`, `twitter`, `manual`, `url`). Adding a
# new capture surface? Add it here too or its prefs will silently drop.
_KNOWN_SOURCE_TYPES = {
    "note", "url", "web", "pdf", "youtube", "voice", "image",
    "session", "manual", "code", "clipboard", "twitter",
}

# Chip dimensions a user can disable per source-type. Adding a new chip?
# Add it here and the get/set helpers + the frontend will pick it up.
_PREF_KEYS = (
    "disable_tasks",
    "disable_events",
    "disable_habits",
    "disable_revisits",
    "disable_folders",
    "disable_related",
)


def _normalize_prefs(raw: Optional[dict], uid: str) -> dict:
    """Return a strict-shape prefs dict so callers never see a missing key
    or a non-list value. Unknown source_type strings are filtered out."""
    raw = raw or {}
    out: Dict[str, Any] = {"user_id": uid}
    for key in _PREF_KEYS:
        val = raw.get(key) or []
        cleaned: List[str] = []
        if isinstance(val, list):
            for item in val:
                s = str(item or "").strip().lower()
                if s in _KNOWN_SOURCE_TYPES and s not in cleaned:
                    cleaned.append(s)
        out[key] = cleaned
    out["updated_at"] = str(raw.get("updated_at") or "")
    return out


async def get_capture_enrichment_prefs(uid: Optional[str] = None) -> dict:
    """Return the current user's capture-enrichment "don't suggest again"
    preferences. Empty lists across all dimensions when nothing is saved."""
    from app.db import get_db
    from app.user_context import get_uid
    user_id = uid or get_uid()
    db = await get_db()
    try:
        snap = await db.collection(_PREFS_COLLECTION).document(user_id).get()
        if getattr(snap, "exists", False):
            return _normalize_prefs(snap.to_dict() or {}, user_id)
    except Exception as e:
        print(f"get_capture_enrichment_prefs error: {e}")
    return _normalize_prefs(None, user_id)


async def set_capture_enrichment_prefs(prefs: dict) -> dict:
    """Replace the saved prefs with the supplied shape. Unknown keys + bad
    source_type values are stripped via _normalize_prefs so we never write
    garbage back. Returns the persisted (normalised) shape.

    Raises on DB failures so the frontend's optimistic-update rollback
    path is actually reachable — silently returning a "cleaned" payload
    on a Firestore write error would let the UI believe the mute
    persisted while the server forgot it on the next read."""
    from app.db import get_db
    from app.user_context import get_uid
    uid = get_uid()
    cleaned = _normalize_prefs(prefs, uid)
    cleaned["updated_at"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    db = await get_db()
    await db.collection(_PREFS_COLLECTION).document(uid).set(cleaned)
    return cleaned


async def re_suggest_for_memory(memory_id: str) -> dict:
    """Re-run `suggest_enrichments` against an existing saved memory and
    persist the fresh `suggested_*` block back onto the memory document.
    Used by the MemoryDetailPage "Re-analyze" button so chips repaint
    with current suggestions even days after the original capture."""
    from app.db import get_db
    from app.user_context import belongs_to_current_user
    db = await get_db()
    doc = await db.collection("memories").document(memory_id).get()
    if not doc.exists:
        return {"error": "Memory not found"}
    mem = doc.to_dict() or {}
    if not belongs_to_current_user(mem):
        return {"error": "Memory not found"}

    body_text = " ".join(filter(None, [
        mem.get("title", ""),
        mem.get("summary", ""),
        " ".join(mem.get("key_points", []) or []),
        mem.get("transcript", "")[:1500] if isinstance(mem.get("transcript"), str) else "",
    ])).strip()

    # Look up existing habits so suggest_enrichments can propose a link
    # only when the content actually maps to one of them.
    try:
        habits_snap = await db.collection("habits").where("user_id", "==", mem.get("user_id", "")).limit(20).get()
        existing_habits = [{"id": h.id, "name": (h.to_dict() or {}).get("name", "")} for h in habits_snap]
    except Exception:
        existing_habits = []

    suggestions = await suggest_enrichments(
        raw_text=body_text,
        title=mem.get("title", ""),
        source_type=mem.get("source_type", "note"),
        existing_habits=existing_habits,
    )

    # Persist the suggestion block onto the memory doc so any future page
    # reads immediately see the fresh suggestions without an extra call.
    update_payload = {
        "suggested_folder_hint": suggestions.get("suggested_folder_hint") or "",
        "suggested_tasks": suggestions.get("suggested_tasks") or [],
        "suggested_event": suggestions.get("suggested_event"),
        "suggested_habit_link": suggestions.get("suggested_habit_link"),
        "suggested_revisit": suggestions.get("suggested_revisit"),
        "suggestions_refreshed_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    }
    try:
        await db.collection("memories").document(memory_id).update(update_payload)
    except Exception as e:
        print(f"re_suggest_for_memory persist error: {e}")
    return {"id": memory_id, **suggestions}


# ─── Auto-tag & share helpers ─────────────────────────────────────────────────

async def auto_tag_memory(memory_id: str) -> dict:
    """Use AI to suggest 3-5 additional tags for an existing memory (current user only)."""
    from app.db import get_db
    from app.user_context import belongs_to_current_user
    db = await get_db()
    doc = await db.collection("memories").document(memory_id).get()
    if not doc.exists:
        return {"error": "Memory not found", "tags": []}
    mem = doc.to_dict()
    if not belongs_to_current_user(mem):
        return {"error": "Memory not found", "tags": []}
    existing = mem.get("tags", []) or []
    text = f"{mem.get('title','')}\n\n{mem.get('summary','')}\n\nKey points: {' | '.join(mem.get('key_points', []) or [])}"

    prompt = (
        f"Suggest 5 short lowercase tags (1-2 words each) for this memory. "
        f"Avoid duplicates of existing tags: {existing}. "
        f"Return ONLY a JSON array like [\"tag1\",\"tag2\"]. No prose.\n\n{text[:1500]}"
    )
    try:
        content, _ = await chat_with_fallback(
            messages=[{"role": "user", "content": prompt}],
            model=settings.OPENAI_MODEL, temperature=0.4, max_tokens=120,
        )
        import json, re
        m = re.search(r"\[[^\]]+\]", content)
        new_tags = []
        if m:
            try:
                new_tags = [str(t).strip().lower() for t in json.loads(m.group(0))]
            except Exception:
                new_tags = [t.strip(' "\'').lower() for t in m.group(0).strip("[]").split(",")]
        new_tags = [t for t in new_tags if t and t not in existing][:5]
        merged = existing + new_tags
        await db.collection("memories").document(memory_id).update({"tags": merged})
        return {"id": memory_id, "added": new_tags, "tags": merged}
    except Exception as e:
        return {"error": str(e), "tags": existing}


async def transcribe_audio(audio_bytes: bytes, mime: str = "audio/webm") -> str:
    """Transcribe audio bytes to text using OpenAI Whisper (with graceful fallback)."""
    try:
        client = get_openai_client()
        import io
        ext = "webm"
        if "wav" in mime: ext = "wav"
        elif "mp3" in mime or "mpeg" in mime: ext = "mp3"
        elif "ogg" in mime: ext = "ogg"
        elif "m4a" in mime or "mp4" in mime: ext = "m4a"
        f = io.BytesIO(audio_bytes); f.name = f"voice.{ext}"
        resp = await client.audio.transcriptions.create(model="whisper-1", file=f)
        return getattr(resp, "text", "") or ""
    except Exception as e:
        return f"[Transcription failed: {e}] (Recorded {len(audio_bytes)} bytes)"


# ─── Time-Capture Bundle ────────────────────────────────────────────────────
# Sweep recent memories (e.g. last 6 / 24 hours), dedupe vs prior bundles,
# AI-synthesize a workspace, and persist as a Workspace project so all the
# scattered captures live as one organized Folder with summary + highlights.

def _parse_iso(ts) -> Optional[datetime.datetime]:
    if ts is None:
        return None
    if isinstance(ts, datetime.datetime):
        return ts if ts.tzinfo else ts.replace(tzinfo=datetime.timezone.utc)
    if not isinstance(ts, str):
        return None
    s = ts.strip()
    if not s:
        return None
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    try:
        dt = datetime.datetime.fromisoformat(s)
        return dt if dt.tzinfo else dt.replace(tzinfo=datetime.timezone.utc)
    except Exception:
        return None


async def list_memories_in_window(hours_back: int, limit: int = 200) -> list[dict]:
    """Return memories whose created_at falls inside [now - hours_back, now],
    scoped to the current user."""
    from app.user_context import belongs_to_current_user
    db = await get_db()
    snap = await db.collection("memories").order_by("created_at", direction="DESCENDING").limit(limit * 2).get()
    cutoff = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(hours=max(1, hours_back))
    out: list[dict] = []
    for doc in snap:
        m = doc.to_dict() or {}
        if not belongs_to_current_user(m):
            continue
        m["id"] = doc.id
        ts = _parse_iso(m.get("created_at"))
        if ts is None or ts < cutoff:
            continue
        if hasattr(m.get("created_at"), "isoformat"):
            m["created_at"] = m["created_at"].isoformat()
        out.append(m)
        if len(out) >= limit:
            break
    return out


async def _already_bundled_memory_ids() -> set[str]:
    """Collect every memory id that's already been packed into a previous
    time-capture workspace for the *current user*, so reruns within the same
    window don't duplicate. Other users' bundles must not interfere."""
    from app.user_context import belongs_to_current_user
    try:
        db = await get_db()
        snap = await db.collection("workspace_projects").get()
        seen: set[str] = set()
        for doc in snap:
            d = doc.to_dict() or {}
            if not belongs_to_current_user(d):
                continue
            if (d.get("goal_type") or "") != "time_capture":
                continue
            for it in (d.get("items") or []):
                rid = it.get("ref_id")
                if rid:
                    seen.add(rid)
            meta = d.get("meta") or {}
            for rid in (meta.get("memory_ids") or []):
                if rid:
                    seen.add(rid)
        return seen
    except Exception as e:
        print(f"_already_bundled_memory_ids error: {e}")
        return set()


async def bundle_recent_activity(hours: int = 6) -> dict:
    """Capture-my-last-N-hours: fetches recent memories, dedupes vs prior
    bundles, asks the LLM to title + summarize + group into folders, then
    creates a Workspace project containing the items.

    Returns: { ok, project, summary, key_learnings, highlights, included, skipped }
    """
    from app.workspace_agent import create_project as _ws_create, add_items as _ws_add
    hours = max(1, min(48, int(hours or 6)))
    window_end = datetime.datetime.now(datetime.timezone.utc)
    window_start = window_end - datetime.timedelta(hours=hours)

    recent = await list_memories_in_window(hours_back=hours, limit=200)
    if not recent:
        return {
            "ok": False,
            "reason": "no_recent",
            "message": f"No captures found in the last {hours} hours.",
            "hours": hours,
            "window_start": window_start.isoformat(),
            "window_end": window_end.isoformat(),
        }

    already = await _already_bundled_memory_ids()
    fresh = [m for m in recent if m.get("id") not in already]
    skipped_ids = [m.get("id") for m in recent if m.get("id") in already]

    if not fresh:
        return {
            "ok": False,
            "reason": "all_bundled",
            "message": f"All {len(recent)} captures from the last {hours} hours are already in a workspace.",
            "hours": hours,
            "window_start": window_start.isoformat(),
            "window_end": window_end.isoformat(),
            "skipped": skipped_ids,
        }

    # Build a compact catalog for the LLM
    catalog_lines = []
    for i, m in enumerate(fresh[:40]):  # cap LLM input
        st = (m.get("source_type") or "note")
        title = (m.get("title") or "Untitled")[:120]
        summ = (m.get("summary") or "")[:240]
        tags = ", ".join((m.get("tags") or [])[:5])
        dom = m.get("domain") or "general"
        catalog_lines.append(
            f"[{i}] id={m.get('id')} | source={st} | domain={dom} | tags={tags}\n    title: {title}\n    summary: {summ}"
        )
    catalog = "\n".join(catalog_lines) or "(no items)"

    when_label = "the last 6 hours" if hours <= 6 else (f"the last {hours} hours" if hours < 24 else "today")
    prompt = f"""You are organizing a knowledge worker's scattered captures from {when_label} into ONE structured workspace.

Captures ({len(fresh)} total, indexed 0..{len(fresh)-1}):
{catalog}

Return STRICT JSON with these keys:
- "title": string, <=60 chars, descriptive workspace name (e.g. "Morning research: GenAI agents")
- "summary": string, 3-5 sentences synthesizing what the user worked on
- "key_learnings": array of 4-6 concise bullet strings (the takeaways across captures)
- "highlights": array of up to 3 objects {{"index": int, "why": "<one-line reason this item matters most>"}}
- "folders": array of 2-5 objects {{"name": "<short topical folder name>", "description": "<one-line>", "indexes": [<capture indexes that belong here>]}}

Rules:
- Every capture index 0..{len(fresh)-1} MUST appear in exactly one folder's "indexes".
- Folder names should be topical (e.g. "Agent design", "Python tooling"), not source-type names.
- Be specific and concrete, not generic. Use Hinglish words only if titles already used them.
- No emojis."""

    try:
        result = await chat_json(
            messages=[{"role": "user", "content": prompt}],
            model=settings.OPENAI_MODEL,
            temperature=0.3,
        )
    except Exception as e:
        return {"ok": False, "reason": "ai_failed", "message": f"AI synthesis failed: {e}"}

    title = (result.get("title") or f"Activity bundle · last {hours}h").strip()[:80]
    summary = (result.get("summary") or "").strip()
    learnings = [str(x).strip() for x in (result.get("key_learnings") or []) if str(x).strip()][:6]
    highlights_raw = result.get("highlights") or []
    folders_raw = result.get("folders") or []

    # ── Validate folder mapping: ensure every capture is bucketed exactly once.
    def _safe_idx(v):
        try:
            i = int(v)
            return i if 0 <= i < len(fresh) else None
        except Exception:
            return None

    folder_specs = []
    seen_idxs: set[int] = set()
    for fi, f in enumerate(folders_raw):
        name = (f.get("name") or f"Folder {fi+1}").strip()[:48]
        desc = (f.get("description") or "").strip()[:120]
        idxs = []
        for v in (f.get("indexes") or []):
            i = _safe_idx(v)
            if i is not None and i not in seen_idxs:
                idxs.append(i)
                seen_idxs.add(i)
        folder_specs.append({"name": name, "description": desc, "indexes": idxs})

    # Catch any captures the AI dropped → put in a misc folder
    leftovers = [i for i in range(len(fresh)) if i not in seen_idxs]
    if leftovers:
        if not folder_specs:
            folder_specs.append({"name": "Captures", "description": "Recent items", "indexes": leftovers})
        else:
            folder_specs.append({"name": "Other", "description": "Additional captures", "indexes": leftovers})

    # ── Create the workspace project with the AI-suggested folders.
    folders_payload = [
        {"id": _short_folder_id(spec["name"], i), "name": spec["name"], "description": spec["description"]}
        for i, spec in enumerate(folder_specs)
    ]
    project = await _ws_create(
        name=title,
        description=summary[:240],
        goal_type="time_capture",
        folders=folders_payload,
    )

    # Stamp dedup metadata directly onto the project doc.
    try:
        db = await get_db()
        pdoc = await db.collection("workspace_projects").document(project["id"]).get()
        pdata = pdoc.to_dict() or project
        pdata["meta"] = {
            "bundle_type": "time_capture",
            "hours": hours,
            "window_start": window_start.isoformat(),
            "window_end": window_end.isoformat(),
            "memory_ids": [m["id"] for m in fresh],
            "key_learnings": learnings,
            "summary": summary,
        }
        await db.collection("workspace_projects").document(project["id"]).set(pdata)
    except Exception as e:
        print(f"bundle_recent_activity meta-stamp error: {e}")

    # Add captures into their assigned folders.
    highlight_ids: set[str] = set()
    for h in highlights_raw[:3]:
        i = _safe_idx(h.get("index") if isinstance(h, dict) else h)
        if i is not None:
            highlight_ids.add(fresh[i]["id"])

    for spec, fp in zip(folder_specs, folders_payload):
        items = []
        for i in spec["indexes"]:
            m = fresh[i]
            items.append({
                "kind": "memory",
                "ref_id": m["id"],
                "title": m.get("title") or "Untitled",
                "url": m.get("source_url") or "",
                "meta": {
                    "source_type": m.get("source_type"),
                    "domain": m.get("domain"),
                    "created_at": m.get("created_at"),
                    "highlight": m["id"] in highlight_ids,
                    "tags": (m.get("tags") or [])[:5],
                },
            })
        if items:
            try:
                await _ws_add(project["id"], items, folder_id=fp["id"])
            except Exception as e:
                print(f"bundle_recent_activity add_items error: {e}")

    # Refresh project so we return the populated version.
    try:
        db = await get_db()
        pdoc = await db.collection("workspace_projects").document(project["id"]).get()
        if pdoc.exists:
            project = pdoc.to_dict() | {"id": pdoc.id}
    except Exception:
        pass

    highlights_out = [
        {
            "memory_id": fresh[_safe_idx(h.get("index") if isinstance(h, dict) else h)]["id"],
            "title": fresh[_safe_idx(h.get("index") if isinstance(h, dict) else h)].get("title"),
            "why": (h.get("why") if isinstance(h, dict) else "")[:160],
        }
        for h in highlights_raw[:3]
        if _safe_idx(h.get("index") if isinstance(h, dict) else h) is not None
    ]

    return {
        "ok": True,
        "hours": hours,
        "window_start": window_start.isoformat(),
        "window_end": window_end.isoformat(),
        "project": project,
        "summary": summary,
        "key_learnings": learnings,
        "highlights": highlights_out,
        "included": [m["id"] for m in fresh],
        "skipped": skipped_ids,
        "stats": {
            "captured": len(fresh),
            "skipped_already_bundled": len(skipped_ids),
            "folders": len(folders_payload),
        },
    }


def _short_folder_id(name: str, idx: int) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", (name or "").lower()).strip("-")[:24] or f"folder-{idx}"
    return f"f_{base}_{idx}"


# ─── Multi-Source Capture Session ───────────────────────────────────────────
# A session is a tray of mixed inputs (notes, links, voice transcripts, images)
# that the user assembles, then commits as ONE bundle into a target workspace.
# Folder modes: 'auto' (AI names a fresh workspace), 'create' (caller-provided
# name → new workspace), 'existing' (caller-provided project_id).
#
# Each item is funneled through the existing single-capture pipeline so the
# original /capture flow remains the source of truth — this is purely an
# orchestration layer.

async def process_capture_session(
    items: list[dict],
    folder_mode: str = "auto",
    folder_name: str = "",
    project_id: str = "",
    hint: str = "",
    user_id: str = "",
) -> dict:
    """Run a batch of mixed-source capture items, then route results into one
    workspace. Returns { ok, session_id, project, memories, summary, errors }."""
    from app.workspace_agent import (
        create_project as _ws_create,
        get_project as _ws_get,
        add_items as _ws_add,
    )
    if not items:
        return {"ok": False, "reason": "empty", "message": "Session has no items."}

    session_id = f"sess_{uuid_hex8()}"
    saved_memories: list[dict] = []
    errors: list[dict] = []

    # ── Phase 1: ingest each item via the existing capture path ──────────
    for idx, raw in enumerate(items):
        kind = (raw.get("kind") or "").strip().lower()
        try:
            if kind == "note":
                content = (raw.get("content") or "").strip()
                if not content:
                    errors.append({"index": idx, "kind": kind, "error": "empty content"})
                    continue
                result = await capture(source_type="note", content=content, user_id=user_id)
            elif kind == "link":
                url = (raw.get("url") or "").strip()
                if not url:
                    errors.append({"index": idx, "kind": kind, "error": "empty url"})
                    continue
                source_type = "youtube" if ("youtube.com" in url or "youtu.be" in url) else "web"
                result = await capture(source_type=source_type, url=url, user_id=user_id)
            elif kind == "voice":
                # Voice items arrive as already-transcribed text (the client uses
                # the existing /capture/voice transcription endpoint first).
                transcript = (raw.get("content") or raw.get("transcript") or "").strip()
                if not transcript:
                    errors.append({"index": idx, "kind": kind, "error": "empty transcript"})
                    continue
                result = await capture(source_type="note", content=f"[Voice memo]\n{transcript}", user_id=user_id)
            elif kind == "image":
                # Image items: caller passes caption + a base64 data URL, optionally
                # plus pre-computed `ocr_text` (frontend may have already kicked off
                # OCR via /capture/ocr-image while the user was still building the
                # tray). If no OCR was supplied we run vision OCR here so a slide /
                # whiteboard / receipt screenshot becomes searchable text instead
                # of an opaque caption.
                #
                # We treat the caption + OCR as a note so it flows through the same
                # analysis pipeline, then attach the FULL data URL to the resulting
                # memory doc under `image_data` so vault detail can render the
                # original image (mirrors how PDFs use `pdf_data`). Cap at
                # MAX_EMBED_PDF_BYTES to avoid Firestore doc bloat.
                caption = (raw.get("caption") or raw.get("alt") or raw.get("title") or "Captured image").strip()
                data_url = (raw.get("data_url") or "").strip()
                ocr = (raw.get("ocr_text") or "").strip()
                # Server-side cap on data-URL length sent to vision OCR —
                # mirrors the /capture/ocr-image endpoint guard so a giant
                # client upload can't run up model cost via this safety-net
                # path either. Oversized images skip OCR but still get the
                # caption-only / "too large to embed" handling below.
                _ocr_cap = MAX_EMBED_PDF_BYTES * 4 // 3 + 1024
                if not ocr and data_url and len(data_url) <= _ocr_cap:
                    try:
                        ocr = await _ocr_image(data_url, caption_hint=caption)
                    except Exception as ocr_e:
                        print(f"process_capture_session OCR error: {ocr_e}")
                        ocr = ""
                body = caption + (f"\n\nExtracted text:\n{ocr}" if ocr else "")
                result = await capture(source_type="note", content=body, user_id=user_id)
                if isinstance(result, dict):
                    if ocr:
                        result["ocr_text"] = ocr
                    # Rough byte estimate from base64 length (4 chars ≈ 3 bytes)
                    embed_image = bool(data_url) and len(data_url) <= MAX_EMBED_PDF_BYTES * 4 // 3
                    if embed_image:
                        result["image_data"] = data_url
                        result["image_caption"] = caption
                        marker = f"[image attached · {caption}"
                        if ocr:
                            marker += f" · {len(ocr.split())} words OCR'd"
                        marker += "]"
                        result["notes"] = ((result.get("notes") or "") + f"\n\n{marker}").strip()
                    elif data_url:
                        # Too big to embed — store caption + OCR only and warn caller.
                        result["notes"] = ((result.get("notes") or "") + f"\n\n[image too large to embed · {caption}]").strip()
                    # capture() above already persisted the memory doc (no URL →
                    # auto-id), so the downstream save_memory() call would only
                    # see a content-hash duplicate and never write `image_data`
                    # / `ocr_text` to the existing row. Patch the saved doc
                    # directly so vault detail can render the image and the
                    # recognized text. Best-effort — never fails the session.
                    saved_id = result.get("id")
                    if saved_id and (embed_image or ocr):
                        try:
                            db = await get_db()
                            patch = {}
                            if embed_image:
                                patch["image_data"] = data_url
                                patch["image_caption"] = caption
                            if ocr:
                                patch["ocr_text"] = ocr
                            if result.get("notes"):
                                patch["notes"] = result["notes"]
                            doc_ref = db.collection("memories").document(saved_id)
                            existing = await doc_ref.get()
                            if getattr(existing, "exists", False):
                                merged = (existing.to_dict() or {}) | patch
                                await doc_ref.set(merged)
                        except Exception as patch_e:
                            print(f"process_capture_session image patch error: {patch_e}")
            else:
                errors.append({"index": idx, "kind": kind, "error": f"unsupported kind: {kind!r}"})
                continue

            if not isinstance(result, dict) or "error" in result:
                errors.append({"index": idx, "kind": kind, "error": str(result.get("error") if isinstance(result, dict) else result)})
                continue

            # Persist to memories collection (capture() returns a structured
            # analysis but does NOT auto-save; mirrors the single /capture flow).
            saved = await save_memory(result, user_id=user_id)
            if isinstance(saved, dict) and saved.get("id"):
                saved_memories.append(saved)
            else:
                errors.append({"index": idx, "kind": kind, "error": "save returned no id"})
        except Exception as e:
            errors.append({"index": idx, "kind": kind, "error": str(e)})

    if not saved_memories:
        return {
            "ok": False,
            "reason": "all_failed",
            "message": "No items in this session could be captured.",
            "errors": errors,
            "session_id": session_id,
        }

    # ── Phase 2: resolve target workspace ───────────────────────────────
    project: Optional[dict] = None
    folder_mode = (folder_mode or "auto").lower()

    if folder_mode == "existing" and project_id:
        project = await _ws_get(project_id)
        if not project:
            return {"ok": False, "reason": "missing_project", "message": f"Workspace {project_id} not found.", "session_id": session_id}
    elif folder_mode == "create":
        name = (folder_name or "").strip() or "Capture session"
        project = await _ws_create(
            name=name,
            description=hint or f"Session of {len(saved_memories)} captures",
            goal_type="capture_session",
        )
    else:
        # auto: ask AI for a topical folder name + short description
        catalog_lines = []
        for i, m in enumerate(saved_memories[:30]):
            t = (m.get("title") or "Untitled")[:120]
            s = (m.get("summary") or "")[:200]
            st = m.get("source_type") or "note"
            catalog_lines.append(f"[{i}] {st} :: {t}\n    {s}")
        catalog = "\n".join(catalog_lines) or "(no items)"
        prompt = f"""You are naming a workspace folder for a batch of captures the user just collected{f' (user hint: {hint})' if hint else ''}.

Captures ({len(saved_memories)}):
{catalog}

Return STRICT JSON:
- "name": string, <=48 chars, descriptive topical folder name (NOT generic like "Notes" — be specific to the content)
- "description": string, <=140 chars, one-sentence summary of what this folder contains
- "summary": string, 2-3 sentences synthesizing what the user captured
No emojis."""
        try:
            ai = await chat_json(
                messages=[{"role": "user", "content": prompt}],
                model=settings.OPENAI_MODEL,
                temperature=0.3,
            )
        except Exception as e:
            ai = {"name": "Capture session", "description": f"AI naming failed: {e}", "summary": ""}
        # Sanitize AI output: blank/whitespace/junk -> deterministic fallback so
        # workspace_agent doesn't silently rename to "Untitled project".
        fallback_name = (hint.strip()[:48] if hint else "") or f"Capture session · {len(saved_memories)} items"
        name = _sanitize_ai_name(ai.get("name"), fallback_name, max_len=48)
        description = (ai.get("description") or "").strip()[:240]
        summary_text = (ai.get("summary") or "").strip()
        project = await _ws_create(
            name=name,
            description=description or summary_text[:240],
            goal_type="capture_session",
        )
        # Stamp session metadata on the project for traceability.
        try:
            db = await get_db()
            pdoc = await db.collection("workspace_projects").document(project["id"]).get()
            pdata = pdoc.to_dict() or project
            pdata["meta"] = {
                "bundle_type": "capture_session",
                "session_id": session_id,
                "summary": summary_text,
                "memory_ids": [m["id"] for m in saved_memories],
                "created_at": _utcnow_session(),
            }
            await db.collection("workspace_projects").document(project["id"]).set(pdata)
            project = pdata | {"id": project["id"]}
        except Exception as e:
            print(f"process_capture_session meta-stamp error: {e}")

    # ── Phase 3: add memories as workspace items ────────────────────────
    items_payload = [
        {
            "kind": "memory",
            "ref_id": m["id"],
            "title": m.get("title") or "Untitled",
            "url": m.get("source_url") or "",
            "meta": {
                "source_type": m.get("source_type"),
                "domain": m.get("domain"),
                "tags": (m.get("tags") or [])[:5],
                "session_id": session_id,
            },
        }
        for m in saved_memories
    ]
    routing_ok = True
    routing_error = ""
    try:
        await _ws_add(project["id"], items_payload)
    except Exception as e:
        routing_ok = False
        routing_error = str(e) or "add_items failed"
        errors.append({"index": -1, "kind": "routing", "error": routing_error})
        print(f"process_capture_session add_items error: {e}")

    # Refresh project to return populated state.
    try:
        db = await get_db()
        pdoc = await db.collection("workspace_projects").document(project["id"]).get()
        if pdoc.exists:
            project = pdoc.to_dict() | {"id": pdoc.id}
    except Exception:
        pass

    # ── Phase 4: persist a `research_sessions` record so future Library /
    # Workspace views can group "items captured together" without scanning
    # workspace_projects metadata. Best-effort — never fails the request.
    summary_for_record = (project.get("meta") or {}).get("summary", "") if isinstance(project, dict) else ""
    try:
        await record_research_session(
            session_id=session_id,
            project_id=project.get("id", "") if isinstance(project, dict) else "",
            project_name=project.get("name", "") if isinstance(project, dict) else "",
            memory_ids=[m["id"] for m in saved_memories],
            summary=summary_for_record,
            folder_mode=folder_mode,
            user_id=user_id,
        )
    except Exception as e:
        print(f"process_capture_session record_research_session error: {e}")

    return {
        "ok": routing_ok,
        "session_id": session_id,
        "project": project,
        "memories": [{"id": m["id"], "title": m.get("title"), "source_type": m.get("source_type")} for m in saved_memories],
        "summary": summary_for_record,
        "routing_error": routing_error,
        "stats": {
            "captured": len(saved_memories),
            "failed": len(errors),
            "routed": len(items_payload) if routing_ok else 0,
            "folder_mode": folder_mode,
        },
        "errors": errors,
    }


# ─── Pre-save Duplicate Check (called before /memories save) ──────────────
async def check_duplicate(
    url: str = "",
    title: str = "",
    summary: str = "",
    user_id: str = "",
) -> dict:
    """Look up an existing memory matching either the normalized URL or the
    (title+summary) content hash. Returns {duplicate: {...} | None, by: 'url'|'content'|None}.
    Used by the Capture page to warn the user BEFORE they hit Save."""
    from app.user_context import get_uid as _get_uid
    uid = (user_id or "").strip() or _get_uid()
    # 1) URL match
    if url:
        try:
            d = await _find_duplicate_by_url(uid, url)
            if d:
                return {"duplicate": d, "by": "url"}
        except Exception as e:
            print(f"check_duplicate url error: {e}")
    # 2) Content-hash match (fallback for notes / re-captures)
    if title or summary:
        try:
            d = await _find_duplicate_by_content_hash(uid, title or "", summary or "")
            if d:
                return {"duplicate": d, "by": "content"}
        except Exception as e:
            print(f"check_duplicate content error: {e}")
    return {"duplicate": None, "by": None}


# ─── Session Preview (AI bundle overview + 3 folder name candidates) ──────
async def preview_capture_session(items: list[dict]) -> dict:
    """Given a tray of pending session items, return an AI bundle overview and
    3 candidate folder-name suggestions WITHOUT saving anything. Lets the user
    decide a destination before committing the session."""
    if not items:
        return {"ok": False, "reason": "empty", "summary": "", "folder_names": []}

    catalog_lines: list[str] = []
    for i, raw in enumerate(items[:30]):
        kind = (raw.get("kind") or "").strip().lower()
        if kind == "note":
            preview = (raw.get("content") or "").strip()[:200]
            catalog_lines.append(f"[{i}] note :: {preview}")
        elif kind == "link":
            url = (raw.get("url") or "").strip()
            host = ""
            try:
                host = urlsplit(url).netloc.replace("www.", "")
            except Exception:
                pass
            catalog_lines.append(f"[{i}] link :: {host or url}")
        elif kind == "voice":
            preview = (raw.get("transcript") or raw.get("content") or "").strip()[:200]
            catalog_lines.append(f"[{i}] voice :: {preview}")
        elif kind == "image":
            cap = (raw.get("caption") or raw.get("alt") or "image").strip()[:120]
            catalog_lines.append(f"[{i}] image :: {cap}")
        else:
            catalog_lines.append(f"[{i}] {kind} :: (unsupported)")
    catalog = "\n".join(catalog_lines) or "(empty)"

    prompt = f"""You are previewing a multi-source capture bundle the user is about to commit.
Look at what they've staged and propose:

1. A 2-3 sentence summary of what this bundle is about (no fluff, no emojis).
2. THREE distinct candidate folder names (each <=48 chars, descriptive, NOT generic).
   Make them genuinely different angles — e.g., topic-focused, project-focused, theme-focused.

Items ({len(items)}):
{catalog}

Return STRICT JSON:
- "summary": string
- "folder_names": array of EXACTLY 3 strings
No emojis, no markdown."""
    try:
        ai = await chat_json(
            messages=[{"role": "user", "content": prompt}],
            model=settings.OPENAI_MODEL,
            temperature=0.4,
        )
    except Exception as e:
        return {
            "ok": False,
            "reason": "ai_failed",
            "summary": "",
            "folder_names": [],
            "error": str(e),
        }

    summary = (ai.get("summary") or "").strip()
    raw_names = ai.get("folder_names") or []
    if not isinstance(raw_names, list):
        raw_names = []
    names: list[str] = []
    for n in raw_names[:3]:
        s = _sanitize_ai_name(n, "", max_len=48)
        if s and s not in names:
            names.append(s)
    # Pad with reasonable fallbacks if AI returned fewer than 3
    while len(names) < 3:
        names.append(f"Capture session · {len(items)} items" + (f" #{len(names)+1}" if names else ""))
    return {
        "ok": True,
        "summary": summary,
        "folder_names": names[:3],
        "item_count": len(items),
    }


# ─── Research Session record (links memory IDs from /capture/session) ─────
async def record_research_session(
    session_id: str,
    project_id: str,
    project_name: str,
    memory_ids: list[str],
    summary: str = "",
    folder_mode: str = "auto",
    user_id: str = "",
) -> Optional[dict]:
    """Persist a `research_sessions` doc that links the saved memory IDs to
    their target workspace. Allows a future Library/Workspace view to surface
    "X items from your morning research session" groupings."""
    if not memory_ids:
        return None
    from app.user_context import get_uid as _get_uid
    uid = (user_id or "").strip() or _get_uid()
    try:
        db = await get_db()
        doc_data = {
            "session_id": session_id,
            "project_id": project_id,
            # Write both keys so the read endpoint and any downstream
            # consumers see a consistent display name. `project_name` is
            # kept for backwards compatibility with older docs.
            "project_name": project_name,
            "folder_name": project_name,
            "memory_ids": memory_ids[:200],
            "summary": (summary or "")[:600],
            "folder_mode": folder_mode,
            "user_id": uid,
            "userId": uid,
            "created_at": _utcnow_session(),
            "item_count": len(memory_ids),
        }
        ref = db.collection("research_sessions").document(session_id)
        await ref.set(doc_data)
        return {"id": session_id, **doc_data}
    except Exception as e:
        print(f"record_research_session error: {e}")
        return None


def _sanitize_ai_name(raw, fallback: str, max_len: int = 48) -> str:
    """Coerce an AI-generated title/folder name into a usable string.
    Returns `fallback` when the AI value is missing, non-string, blank,
    or a generic placeholder that would lead to "Untitled project"."""
    if not isinstance(raw, str):
        return fallback
    cleaned = raw.strip().strip('"').strip("'").strip()
    if not cleaned:
        return fallback
    low = cleaned.lower()
    junk = {"untitled", "untitled project", "notes", "note", "n/a", "none", "tbd"}
    if low in junk:
        return fallback
    return cleaned[:max_len]


def uuid_hex8() -> str:
    import uuid as _uuid
    return _uuid.uuid4().hex[:8]


def _utcnow_session() -> str:
    return datetime.datetime.now(datetime.timezone.utc).isoformat()
