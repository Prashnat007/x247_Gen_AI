"""
Folder matcher — fuzzy match an AI-suggested folder hint against the
user's existing flat folder list. Used by the W1 capture-enrichment
flow to auto-fill the "where should this memory live?" chip.

Returns either the best existing folder (with score) or a hint that
the caller should offer to create a new folder with the suggested
name.
"""
from __future__ import annotations

from typing import List, Dict, Any, Union

try:
    from rapidfuzz import fuzz
    _HAS_RAPIDFUZZ = True
except ImportError:
    _HAS_RAPIDFUZZ = False


# Below this similarity score (0.0-1.0) we don't suggest reusing an
# existing folder — better to propose creating one with the AI's name.
DEFAULT_THRESHOLD = 0.55

# Folders touched within this many days get a small score boost so the
# user's currently-active workspace wins ties over a stale alphabetical
# match. Keeps the matcher feeling like it knows what you're doing now.
RECENT_USE_BOOST_DAYS = 7
RECENT_USE_BOOST = 0.10


def _basic_similarity(a: str, b: str) -> float:
    """Cheap fallback when rapidfuzz isn't installed: token-set jaccard."""
    a_tokens = {t for t in (a or "").lower().split() if t}
    b_tokens = {t for t in (b or "").lower().split() if t}
    if not a_tokens or not b_tokens:
        return 0.0
    inter = len(a_tokens & b_tokens)
    union = len(a_tokens | b_tokens)
    return inter / union if union else 0.0


def _similarity(a: str, b: str) -> float:
    """Returns 0.0-1.0 similarity score."""
    if _HAS_RAPIDFUZZ:
        return fuzz.token_set_ratio(a or "", b or "") / 100.0
    return _basic_similarity(a, b)


def _is_recently_used(recent_use_at: str) -> bool:
    """True if the folder was touched within RECENT_USE_BOOST_DAYS."""
    if not recent_use_at:
        return False
    try:
        import datetime
        ts = datetime.datetime.fromisoformat(recent_use_at.replace("Z", "+00:00"))
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=datetime.timezone.utc)
        delta = datetime.datetime.now(datetime.timezone.utc) - ts
        return delta.days <= RECENT_USE_BOOST_DAYS
    except Exception:
        return False


def match_folder(
    suggested_hint: str,
    folders: List[Dict[str, Any]],
    threshold: float = DEFAULT_THRESHOLD,
) -> Dict[str, Any]:
    """Match an AI folder hint against existing folders.

    Args:
        suggested_hint: e.g. "AI Research" or "Workout Logs"
        folders: list of flat folder dicts each with at least
            `folder_id`, `folder_name`, optional `recent_use_at`,
            `project_id`, `project_name`.
        threshold: minimum score to accept an existing folder.

    Returns:
        Best match: `{folder_id, project_id, folder_name, score}`
        OR a create hint: `{create: True, suggested_name}`.
    """
    hint = (suggested_hint or "").strip()
    if not hint:
        return {"create": True, "suggested_name": ""}

    if not folders:
        return {"create": True, "suggested_name": hint[:60]}

    # Iterate folders in deterministic alphabetical order so any score
    # ties break to the alphabetically-first folder. Spec order:
    #   1. Higher fuzzy score wins.
    #   2. Recently-used folder gets a +RECENT_USE_BOOST nudge so it
    #      beats a stale near-match of the same raw similarity.
    #   3. On a true tie, alphabetical name wins (handled by the sort
    #      below — first match through the loop is kept because we
    #      compare strictly with `>`).
    sorted_folders = sorted(
        folders,
        key=lambda f: (f.get("folder_name") or f.get("name") or "").lower(),
    )

    best: Dict[str, Any] = {"score": -1.0}
    for f in sorted_folders:
        name = f.get("folder_name") or f.get("name") or ""
        if not name:
            continue
        score = _similarity(hint, name)
        if _is_recently_used(f.get("recent_use_at", "")):
            score = min(1.0, score + RECENT_USE_BOOST)
        if score > best["score"]:
            best = {
                "folder_id": f.get("folder_id"),
                "project_id": f.get("project_id"),
                "folder_name": name,
                "project_name": f.get("project_name", ""),
                "score": round(score, 3),
            }

    if best.get("score", 0) >= threshold:
        return best

    return {"create": True, "suggested_name": hint[:60]}
