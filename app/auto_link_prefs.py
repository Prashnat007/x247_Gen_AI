"""W4 — auto-link feature toggles.

Three booleans that let a user opt out of the AI auto-link layer
without touching the rest of the capture-enrichment pipeline:

  - auto_folder_enabled         — silent file-into-existing-folder on save.
  - habit_suggestions_enabled   — briefing scanner that proposes habit links.
  - cluster_suggestions_enabled — weekly topic-cluster bundle suggestions.

Defaults are all True so existing users keep the feature until they
explicitly turn one off. Persisted in `auto_link_prefs` keyed by uid.
"""

from __future__ import annotations

import datetime
from typing import Any, Dict, Optional

from app.db import get_db
from app.user_context import get_uid


_COLLECTION = "auto_link_prefs"

_DEFAULTS: Dict[str, bool] = {
    "auto_folder_enabled": True,
    "habit_suggestions_enabled": True,
    "cluster_suggestions_enabled": True,
}


def _normalize(raw: Optional[Dict[str, Any]]) -> Dict[str, bool]:
    """Coerce stored prefs to the strict 3-boolean shape, filling
    defaults for any missing key. Truthy non-bool values land as True
    (e.g. legacy `1` from a hand-edited doc) so we don't silently
    flip a feature off because of a serialiser quirk."""
    raw = raw or {}
    return {k: bool(raw.get(k, default)) for k, default in _DEFAULTS.items()}


async def get_prefs(uid: Optional[str] = None) -> Dict[str, Any]:
    """Read current toggles. Returns the defaults shape when nothing
    is saved yet so callers never have to None-check."""
    user_id = (uid or get_uid() or "").strip()
    out: Dict[str, Any] = {**_DEFAULTS, "user_id": user_id}
    if not user_id:
        return out
    try:
        db = await get_db()
        snap = await db.collection(_COLLECTION).document(user_id).get()
        if getattr(snap, "exists", False):
            stored = snap.to_dict() or {}
            out = {**_normalize(stored), "user_id": user_id}
            if stored.get("updated_at"):
                out["updated_at"] = stored["updated_at"]
    except Exception as e:
        print(f"auto_link_prefs.get_prefs error: {e}")
    return out


async def set_prefs(prefs: Dict[str, Any]) -> Dict[str, Any]:
    """Replace stored toggles. Always writes the full 3-key shape so
    a partial update never leaves a stale boolean in place."""
    uid = (get_uid() or "").strip()
    if not uid:
        raise ValueError("No user context for auto_link_prefs write.")
    cleaned = _normalize(prefs)
    cleaned["user_id"] = uid
    cleaned["updated_at"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    db = await get_db()
    await db.collection(_COLLECTION).document(uid).set(cleaned)
    return cleaned


# Convenience read used from inside scanner / save_bundle hooks. We
# centralise the "is feature X allowed?" question here so the gating
# logic doesn't drift across the three call sites.

async def is_auto_folder_enabled(uid: Optional[str] = None) -> bool:
    return bool((await get_prefs(uid)).get("auto_folder_enabled", True))


async def is_habit_suggestions_enabled(uid: Optional[str] = None) -> bool:
    return bool((await get_prefs(uid)).get("habit_suggestions_enabled", True))


async def is_cluster_suggestions_enabled(uid: Optional[str] = None) -> bool:
    return bool((await get_prefs(uid)).get("cluster_suggestions_enabled", True))
