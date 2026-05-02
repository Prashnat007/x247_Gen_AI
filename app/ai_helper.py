"""
Shared AI helper: primary client (Gemini) + automatic OpenAI fallback on 429.
"""
import json
from openai import AsyncOpenAI
from app.config import settings


def get_primary_client() -> AsyncOpenAI:
    return AsyncOpenAI(
        api_key=settings.PRIMARY_AI_KEY or settings.OPENAI_API_KEY,
        base_url=settings.openai_base_url,
        default_headers=settings.openai_extra_headers,
    )


def get_fallback_client():
    """Return (AsyncOpenAI, model_name) for the fallback provider, or (None, None)."""
    key = settings.FALLBACK_AI_KEY
    if not key:
        return None, None
    base_url = settings.FALLBACK_AI_BASE_URL
    model = settings.FALLBACK_AI_MODEL
    headers = {}
    if "openrouter" in base_url:
        headers = {
            "HTTP-Referer": "https://recall-x247.replit.app",
            "X-Title": "Recall X247",
        }
    client = AsyncOpenAI(api_key=key, base_url=base_url, default_headers=headers)
    return client, model


def get_backup_gemini_client():
    """Return (AsyncOpenAI, model_name) for the BACKUP Gemini key, or (None, None).

    Used as the final tier when both the primary Gemini key and the
    OpenAI/OpenRouter fallback are exhausted (rate-limited or out of credits).
    Hits the same Gemini OpenAI-compatible endpoint with an independent key
    backed by a separate Google Cloud billing account."""
    key = settings.BACKUP_GEMINI_API_KEY
    if not key:
        return None, None
    client = AsyncOpenAI(
        api_key=key,
        base_url=settings.BACKUP_GEMINI_BASE_URL,
        default_headers={},
    )
    return client, settings.BACKUP_GEMINI_MODEL


def is_rate_limit(err: Exception) -> bool:
    raw = str(err)
    msg = raw.lower()
    return (
        "429" in raw
        or "402" in raw
        or "quota" in msg
        or "rate" in msg
        or "resource_exhausted" in msg
        or "too many requests" in msg
        or "credits" in msg
        or "billing" in msg
    )


def _clean_json(raw: str) -> str:
    """Strip markdown code fences if the model wrapped the JSON."""
    s = raw.strip()
    if s.startswith("```"):
        lines = s.split("\n")
        s = "\n".join(lines[1:])
        s = s.rsplit("```", 1)[0].strip()
    return s


DEFAULT_MAX_TOKENS = 4096


async def chat_with_fallback(
    messages: list,
    model: str,
    response_format=None,
    temperature: float = 0.3,
    max_tokens: int = None,
) -> tuple[str, str]:
    """
    Call primary AI. On 429 / 402 / quota errors, auto-retry with the
    OpenAI/OpenRouter fallback (and Gemini backup if configured).
    Returns (content_str, provider_name).

    NOTE on max_tokens: when not explicitly provided we cap the request at
    DEFAULT_MAX_TOKENS (4096). Many gpt-4o-mini-class models otherwise
    advertise a 16384-token completion ceiling, which OpenRouter's billing
    layer then refuses up-front when account credits are tight ("requires
    more credits, or fewer max_tokens"). Capping keeps everything within
    typical fallback budgets without hurting analysis quality.
    """
    primary = get_primary_client()
    kwargs = dict(model=model, messages=messages, temperature=temperature)
    if response_format:
        kwargs["response_format"] = response_format
    kwargs["max_tokens"] = max_tokens or DEFAULT_MAX_TOKENS

    primary_err: Exception | None = None
    try:
        resp = await primary.chat.completions.create(**kwargs)
        return resp.choices[0].message.content, "primary"
    except Exception as e:
        primary_err = e
        if not is_rate_limit(e):
            raise

    # ── Fallback (OpenAI / OpenRouter) ────────────────────────────────────
    fb_client, fb_model = get_fallback_client()
    if fb_client:
        kwargs["model"] = fb_model
        try:
            resp = await fb_client.chat.completions.create(**kwargs)
            return resp.choices[0].message.content, "fallback"
        except Exception as e2:
            # Some endpoints don't support response_format — retry without it
            if response_format and (
                "response_format" in str(e2).lower()
                or "unsupported" in str(e2).lower()
            ):
                kwargs.pop("response_format", None)
                try:
                    resp = await fb_client.chat.completions.create(**kwargs)
                    return resp.choices[0].message.content, "fallback"
                except Exception as e2b:
                    if not is_rate_limit(e2b):
                        raise
            elif not is_rate_limit(e2):
                raise

    # ── Backup Gemini (final tier) ────────────────────────────────────────
    bg_client, bg_model = get_backup_gemini_client()
    if bg_client:
        kwargs["model"] = bg_model
        resp = await bg_client.chat.completions.create(**kwargs)
        return resp.choices[0].message.content, "backup_gemini"

    # No fallback / backup configured — re-raise the ORIGINAL primary error
    # so callers can inspect status codes (402 / 429 / 401) and degrade
    # gracefully with accurate user-facing messaging.
    if primary_err is not None:
        raise primary_err
    raise RuntimeError("AI provider unavailable and no fallback configured.")


async def chat_json(
    messages: list,
    model: str,
    temperature: float = 0.3,
) -> dict:
    """Convenience: call chat_with_fallback and parse JSON response."""
    raw, _ = await chat_with_fallback(
        messages=messages,
        model=model,
        response_format={"type": "json_object"},
        temperature=temperature,
    )
    return json.loads(_clean_json(raw))
