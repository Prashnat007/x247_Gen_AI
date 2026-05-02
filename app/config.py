import os
import json
from pydantic_settings import BaseSettings
from typing import Optional

OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
OPENAI_BASE_URL = "https://api.openai.com/v1"
GEMINI_COMPAT_URL = "https://generativelanguage.googleapis.com/v1beta/openai/"


def _is_openrouter_key(key: Optional[str]) -> bool:
    return bool(key and key.startswith("sk-or-v1"))


class Settings(BaseSettings):
    GCP_PROJECT_ID: Optional[str] = None
    FIREBASE_DATABASE_ID: Optional[str] = None
    GOOGLE_APPLICATION_CREDENTIALS: Optional[str] = None
    GEMINI_MODEL: str = "gemini-2.0-flash"
    GEMINI_API_KEY: Optional[str] = None
    GOOGLE_API_KEY: Optional[str] = None
    GOOGLE_CALENDAR_ID: Optional[str] = None
    GOOGLE_SA_KEY_PATH: Optional[str] = None
    GOOGLE_CSE_CX: Optional[str] = None
    GEN_API_KEY: Optional[str] = None
    OPENAI_API_KEY: Optional[str] = None
    OPENAI_MODEL: str = "gemini-2.0-flash"
    USE_OPENROUTER: bool = False
    USE_GEMINI: bool = False

    # Primary client key (Gemini or fallback)
    PRIMARY_AI_KEY: Optional[str] = None
    PRIMARY_AI_BASE_URL: Optional[str] = None
    PRIMARY_AI_MODEL: Optional[str] = None

    # Fallback key (real OpenAI or OpenRouter) — used when primary 429s
    FALLBACK_AI_KEY: Optional[str] = None
    FALLBACK_AI_BASE_URL: str = OPENAI_BASE_URL
    FALLBACK_AI_MODEL: str = "gpt-4o-mini"

    # Backup Gemini key — final tier, used when BOTH primary Gemini and the
    # OpenAI/OpenRouter fallback are exhausted (rate-limited or out of credits).
    # Same Gemini OpenAI-compatible endpoint, separate Google Cloud project /
    # billing account so it has its own independent quota.
    BACKUP_GEMINI_API_KEY: Optional[str] = None
    BACKUP_GEMINI_BASE_URL: str = GEMINI_COMPAT_URL
    BACKUP_GEMINI_MODEL: str = "gemini-2.0-flash"

    def __init__(self, **kwargs):
        super().__init__(**kwargs)

        config_path = "firebase-applet-config.json"
        if os.path.exists(config_path):
            try:
                with open(config_path, "r") as f:
                    config = json.load(f)
                    if not self.GCP_PROJECT_ID:
                        self.GCP_PROJECT_ID = config.get("projectId")
                    if not self.FIREBASE_DATABASE_ID:
                        self.FIREBASE_DATABASE_ID = config.get("firestoreDatabaseId")
            except Exception as e:
                print(f"Error loading firebase config: {e}")

        if not self.GCP_PROJECT_ID:
            self.GCP_PROJECT_ID = os.getenv(
                "FIREBASE_PROJECT_ID", os.getenv("GCP_PROJECT_ID", "demo-project")
            )
        if not self.FIREBASE_DATABASE_ID:
            self.FIREBASE_DATABASE_ID = os.getenv("FIREBASE_DATABASE_ID", "(default)")

        # ── Primary AI key ────────────────────────────────────────────────
        # OPENAI_API_KEY can hold either a real OpenAI key (sk-proj-…/sk-…)
        # OR an OpenRouter key (sk-or-v1…); base URL is auto-detected.
        raw_openai_key = (
            os.getenv("OPENAI_API_KEY")
            or os.getenv("OPENAI_API_KEY_1")
            or os.getenv("GEN_APAC_API_KEY")
            or os.getenv("GEN_API_KEY")
        )

        # Gemini tiers stay disabled — we use OpenAI/OpenRouter exclusively.
        self.GEMINI_API_KEY = None
        self.GOOGLE_API_KEY = None
        self.USE_GEMINI = False
        self.BACKUP_GEMINI_API_KEY = None

        if raw_openai_key:
            self.PRIMARY_AI_KEY = raw_openai_key
            if _is_openrouter_key(raw_openai_key):
                self.PRIMARY_AI_BASE_URL = OPENROUTER_BASE_URL
                # PRIMARY = paid OpenAI model (fast: 1-2s per capture).
                # User pays per token but quality + latency is best.
                self.PRIMARY_AI_MODEL = "openai/gpt-4o-mini"
                self.USE_OPENROUTER = True
            else:
                self.PRIMARY_AI_BASE_URL = OPENAI_BASE_URL
                self.PRIMARY_AI_MODEL = "gpt-4o-mini"
                self.USE_OPENROUTER = False
            self.OPENAI_API_KEY = raw_openai_key
            self.OPENAI_MODEL = self.PRIMARY_AI_MODEL

        # ── Fallback AI key ───────────────────────────────────────────────
        # OPENAI_API_KEY_FALLBACK kicks in when the primary returns 429 / 402
        # / quota errors. Same auto-detection: sk-or-v1… → OpenRouter,
        # otherwise real OpenAI. Use a key from a different account /
        # billing source than the primary so they have independent quotas.
        raw_fallback_key = (
            os.getenv("OPENAI_API_KEY_FALLBACK")
            or os.getenv("FALLBACK_AI_KEY")
        )
        if raw_fallback_key:
            self.FALLBACK_AI_KEY = raw_fallback_key
            if _is_openrouter_key(raw_fallback_key):
                self.FALLBACK_AI_BASE_URL = OPENROUTER_BASE_URL
                # FALLBACK = NVIDIA Nemotron 3 Super, FREE tier on OpenRouter
                # ($0/M input, $0/M output, 262K context). Used only when the
                # paid primary returns 402 / 429 / quota — free tier is
                # slower (10-90s) but always available.
                self.FALLBACK_AI_MODEL = "nvidia/nemotron-3-super-120b-a12b:free"
            else:
                self.FALLBACK_AI_BASE_URL = OPENAI_BASE_URL
                self.FALLBACK_AI_MODEL = "gpt-4o-mini"
        else:
            self.FALLBACK_AI_KEY = None

    @property
    def openai_base_url(self) -> str:
        return self.PRIMARY_AI_BASE_URL or (GEMINI_COMPAT_URL if self.USE_GEMINI else OPENAI_BASE_URL)

    @property
    def openai_extra_headers(self) -> dict:
        if self.USE_GEMINI:
            return {}
        if self.USE_OPENROUTER:
            return {
                "HTTP-Referer": "https://recall-x247.replit.app",
                "X-Title": "Recall X247",
            }
        return {}

    @property
    def active_ai_key(self) -> Optional[str]:
        return self.PRIMARY_AI_KEY or self.OPENAI_API_KEY or self.GEMINI_API_KEY

    @property
    def using_openai(self) -> bool:
        return bool(self.OPENAI_API_KEY)

    @property
    def has_fallback(self) -> bool:
        return bool(self.FALLBACK_AI_KEY)

    @property
    def has_backup_gemini(self) -> bool:
        return bool(self.BACKUP_GEMINI_API_KEY)

    @property
    def ai_provider_name(self) -> str:
        tiers = []
        if self.has_fallback:
            tiers.append(f"fallback={self.FALLBACK_AI_MODEL}")
        if self.has_backup_gemini:
            tiers.append(f"backup={self.BACKUP_GEMINI_MODEL}")
        extra = f" [+{', +'.join(tiers)}]" if tiers else ""
        if self.USE_GEMINI:
            return f"Google Gemini ({self.GEMINI_MODEL}){extra}"
        if self.USE_OPENROUTER:
            return f"OpenRouter ({self.OPENAI_MODEL}){extra}"
        return f"OpenAI ({self.OPENAI_MODEL}){extra}"

    class Config:
        env_file = ".env"


settings = Settings()
print(f"AI Provider: {settings.ai_provider_name}")
if settings.has_fallback:
    print(f"Fallback AI: OpenAI ({settings.FALLBACK_AI_MODEL}) ready")
else:
    print("Warning: No fallback AI key configured (set OPENAI_API_KEY for 429 resilience)")
