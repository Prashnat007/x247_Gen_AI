import json
import re
import datetime
from typing import List, Dict, Any, Optional
from app.db import get_db
from app.config import settings
from app.ai_helper import chat_with_fallback, chat_json
from app.user_context import get_uid, belongs_to_current_user

STOPWORDS = {"the", "a", "an", "is", "are", "was", "were", "what", "how", "tell", "me", "find", "search", "recall", "about", "i", "my", "do", "did", "done", "know", "have", "can", "you", "to", "of", "in", "on", "for", "with", "and", "or"}
ALLOWED_DOMAINS = ["AI", "Technology", "Science", "Business", "Health", "History", "Philosophy", "Engineering", "Productivity", "Other"]

# Words that signal the user wants a time-ordered slice of their vault
# ("what did I save recently", "show me my latest captures", "anything new today")
RECENCY_KEYWORDS = {
    "recent", "recently", "latest", "lately", "newest", "new",
    "yesterday", "today", "tonight", "now", "just",
    "last", "past", "currently", "current",
    "save", "saved", "saves", "saving",
    "capture", "captured", "captures", "capturing",
    "added", "stored", "kept", "uploaded",
}

# Words that signal "show me everything / browse my vault" without a topic.
# When combined with no real keywords, we just dump recent memories instead
# of forcing a tag/domain/keyword match that returns nothing.
BROWSE_KEYWORDS = {
    "everything", "anything", "something", "stuff", "things",
    "all", "any", "list", "show", "give", "see", "view", "browse",
    "vault", "library", "memory", "memories", "captures", "items",
    "saved", "content",
}

SOURCE_TYPE_KEYWORDS = {
    "youtube": {"youtube", "video", "videos", "yt", "watch", "watched"},
    "web": {"article", "articles", "blog", "blogs", "post", "posts", "webpage", "website", "web", "url", "link", "links"},
    "note": {"note", "notes", "memo", "memos", "thought", "thoughts", "journal", "diary"},
    "pdf": {"pdf", "pdfs", "paper", "papers", "document", "documents", "doc", "docs"},
}

# Combined "non-topical" set — words that exist in queries but never describe
# what the user is actually looking for. Used to decide whether the query has
# any real topic at all (vs being a pure "give me anything" question).
_ALL_SOURCE_WORDS = set().union(*SOURCE_TYPE_KEYWORDS.values())
NON_TOPICAL_WORDS = STOPWORDS | RECENCY_KEYWORDS | BROWSE_KEYWORDS | _ALL_SOURCE_WORDS


def _normalise(word: str) -> str:
    return word.strip(".,!?;:'\"").lower()


def _is_recency_intent(query: str) -> bool:
    """True if the user is asking for time-ordered results."""
    qwords = {_normalise(w) for w in (query or "").split()}
    return bool(qwords & RECENCY_KEYWORDS)


def _is_browse_intent(query: str) -> bool:
    """True if the user is asking to browse their vault without a topic."""
    qwords = {_normalise(w) for w in (query or "").split()}
    return bool(qwords & BROWSE_KEYWORDS)


def _topical_keywords(keywords: List[str]) -> List[str]:
    """Strip recency/browse/source/stop words to leave only real topic words."""
    return [k for k in keywords if _normalise(k) not in NON_TOPICAL_WORDS]

SOURCE_LABELS = {
    "youtube": "YouTube video",
    "web": "web article",
    "note": "note",
    "pdf": "PDF/document",
}


def _detect_source_filter(query: str) -> Optional[str]:
    """Detect if user is asking for a specific source type (youtube/web/note/pdf)."""
    qwords = {w.strip(".,!?;:'\"").lower() for w in query.split()}
    for source_type, keywords in SOURCE_TYPE_KEYWORDS.items():
        if qwords & keywords:
            return source_type
    return None


def _yt_id(url: str) -> Optional[str]:
    """Extract YouTube video ID from a URL (returns None if not YouTube)."""
    if not url:
        return None
    import re
    patterns = [
        r"(?:youtube\.com/watch\?v=|youtu\.be/|youtube\.com/embed/)([0-9A-Za-z_-]{11})",
    ]
    for p in patterns:
        m = re.search(p, url)
        if m:
            return m.group(1)
    return None


def _enrich_source(m: dict) -> dict:
    """Build a richer source object for the frontend card."""
    out = {
        "id": m["id"],
        "title": m.get("title"),
        "source_url": m.get("source_url"),
        "source_type": m.get("source_type"),
        "domain": m.get("domain"),
        "summary": (m.get("summary") or "")[:280],
        "key_points": (m.get("key_points") or [])[:5],
        "tags": (m.get("tags") or [])[:6],
    }
    created = m.get("created_at")
    if hasattr(created, "isoformat"):
        out["created_at"] = created.isoformat()
    elif created:
        out["created_at"] = str(created)
    if m.get("source_type") == "youtube":
        yid = _yt_id(m.get("source_url") or "")
        if yid:
            out["youtube_id"] = yid
            out["thumbnail_url"] = f"https://img.youtube.com/vi/{yid}/mqdefault.jpg"
    elif m.get("source_url"):
        try:
            from urllib.parse import urlparse
            host = urlparse(m["source_url"]).netloc
            if host:
                out["favicon_url"] = f"https://www.google.com/s2/favicons?sz=64&domain={host}"
                out["host"] = host.replace("www.", "")
        except Exception:
            pass
    return out


_BATCH_RX = re.compile(
    r"\b("
    r"all|sare|saare|sab|saari|every|"
    r"list|show me (all|every|my)|give me (all|every)|"
    r"top\s*\d+|first\s*\d+|"
    r"\d+\s+(memories|videos|articles|notes|pdfs|results|cards|items|captures)|"
    r"several|multiple|both|"
    r"compare|vs\.?|versus|side[- ]by[- ]side"
    r")\b",
    re.IGNORECASE,
)


def _is_batch_query(query: str) -> bool:
    """Return True iff the user explicitly asked for a list / multiple items.

    By default /recall returns ONE focal card so the answer reads like a
    direct reply, not a search-results dump. When the user says "sare /
    all / list / top N / compare", we widen to a batch (capped at 8).
    """
    if not query:
        return False
    return bool(_BATCH_RX.search(query))


async def find_related_memories(
    text: str,
    tags: Optional[List[str]] = None,
    exclude_id: str = "",
    limit: int = 5,
) -> List[Dict[str, Any]]:
    """Find memories related to a given text + optional tag set.

    Used by the capture-enrichment "Related" chip to surface memories
    the user might want to link to the new capture. Reuses the same
    3-tier strategy as `recall` but tailored for "find similar to THIS
    text" instead of "answer THIS query":
      Tier 1 — tag overlap (array_contains_any over the supplied tags
               OR keywords mined from the text)
      Tier 2 — domain match via cheap LLM classification
      Tier 3 — recency fallback if both above are empty

    Returns up to `limit` items, each shaped as
    `{id, title, snippet, score, reason}`. Excludes the memory whose id
    is `exclude_id` (the in-progress capture itself).
    """
    db = await get_db()
    text = (text or "").strip()
    tags_in = [t.strip().lower() for t in (tags or []) if t and t.strip()]
    exclude_id = (exclude_id or "").strip()

    # Mine candidate keywords from the body if no tags were provided.
    if not tags_in and text:
        words = [_normalise(w) for w in text.split() if w]
        tags_in = [w for w in words if w and w not in NON_TOPICAL_WORDS][:8]
    tags_in = list(dict.fromkeys(tags_in))[:10]  # dedup, cap

    candidates: Dict[str, Dict[str, Any]] = {}

    def _add(m: Dict[str, Any], score: float, reason: str) -> None:
        mid = m.get("id")
        if not mid or mid == exclude_id:
            return
        existing = candidates.get(mid)
        if existing and existing.get("score", 0) >= score:
            return
        candidates[mid] = {**m, "_score": score, "_reason": reason}

    # Tier 1: tag overlap
    if tags_in:
        try:
            snapshot = await db.collection("memories") \
                .where("tags", "array_contains_any", tags_in[:10]) \
                .limit(40).get()
            for doc in snapshot:
                data = doc.to_dict() or {}
                if not belongs_to_current_user(data):
                    continue
                m = data | {"id": doc.id}
                m_tags = [str(t).lower() for t in (m.get("tags") or [])]
                overlap = len(set(tags_in) & set(m_tags))
                if overlap:
                    score = min(1.0, 0.4 + 0.15 * overlap)
                    _add(m, score, f"shares {overlap} tag" + ("s" if overlap > 1 else ""))
        except Exception as e:
            print(f"find_related_memories tier-1 error: {e}")

    # Tier 2: domain match (cheap LLM classify) — only if we don't have enough yet
    if len(candidates) < limit and text:
        try:
            domain_content, _ = await chat_with_fallback(
                messages=[{
                    "role": "user",
                    "content": (
                        "Classify this content into exactly one of these domains: "
                        f"{', '.join(ALLOWED_DOMAINS)}. Content: '{text[:600]}'. "
                        "Return only the domain name, nothing else."
                    ),
                }],
                model=settings.OPENAI_MODEL,
                temperature=0,
                max_tokens=20,
            )
            classified = (domain_content or "").strip()
            if classified in ALLOWED_DOMAINS:
                snapshot = await db.collection("memories") \
                    .where("domain", "==", classified) \
                    .limit(30).get()
                for doc in snapshot:
                    data = doc.to_dict() or {}
                    if not belongs_to_current_user(data):
                        continue
                    m = data | {"id": doc.id}
                    _add(m, 0.35, f"same domain: {classified}")
        except Exception as e:
            print(f"find_related_memories tier-2 error: {e}")

    # Tier 3: recency fallback so we always return something useful
    if len(candidates) < min(3, limit):
        try:
            snapshot = await db.collection("memories") \
                .order_by("created_at", direction="DESCENDING") \
                .limit(20).get()
            for doc in snapshot:
                data = doc.to_dict() or {}
                if not belongs_to_current_user(data):
                    continue
                m = data | {"id": doc.id}
                _add(m, 0.20, "recent capture")
        except Exception as e:
            print(f"find_related_memories tier-3 error: {e}")

    ranked = sorted(candidates.values(), key=lambda x: x.get("_score", 0), reverse=True)
    out: List[Dict[str, Any]] = []
    for m in ranked[:limit]:
        snippet = (m.get("summary") or "").strip()
        if len(snippet) > 220:
            snippet = snippet[:220].rsplit(" ", 1)[0] + "…"
        out.append({
            "id": m.get("id"),
            "title": m.get("title") or "Untitled",
            "snippet": snippet,
            "score": round(float(m.get("_score", 0)), 3),
            "reason": m.get("_reason", ""),
        })
    return out


async def recall(
    query: str,
    history: Optional[List[Dict[str, str]]] = None,
    focal_source_id: Optional[str] = None,
) -> dict:
    """
    Semantic knowledge recall with 3-tier search + AI synthesis.
    Auto-falls back to OpenAI if primary (Gemini) rate-limits.
    Honours source-type intent: if user mentions "YouTube videos",
    only YouTube memories are returned.

    `history` is an optional list of {role, content} prior turns so that
    follow-up questions ("tell me more about that") can use earlier context.

    `focal_source_id` pins a specific memory as the primary (first) card so
    that follow-up turns on the same topic keep the same focal card visible
    instead of flipping to whatever ranks highest for the new sub-question.
    The pinned card is deduplicated from the rest of the result set.
    """
    db = await get_db()
    memories = []
    history = history or []

    # If this looks like a follow-up ("tell me more", "what about", "and that?"),
    # blend the previous user turn into the effective query so search has signal.
    effective_query = query
    follow_up_markers = {"more", "tell", "what", "about", "that", "and", "those", "it", "this", "explain", "why", "how", "elaborate"}
    qwords = {w.lower().strip(".,!?'\"") for w in query.split()}
    is_short_followup = len(query.split()) <= 6 and bool(qwords & follow_up_markers)
    if history and is_short_followup:
        last_user = next((h for h in reversed(history) if h.get("role") == "user"), None)
        if last_user and last_user.get("content"):
            effective_query = f"{last_user['content']} — {query}"

    source_filter = _detect_source_filter(effective_query)

    def _matches_filter(data: dict) -> bool:
        if not source_filter:
            return True
        return data.get("source_type") == source_filter

    keywords = [w.lower() for w in effective_query.split() if w.lower() not in STOPWORDS]
    # If we have a source filter, also strip the source-type words from keyword list
    if source_filter:
        all_source_words = set().union(*SOURCE_TYPE_KEYWORDS.values())
        keywords = [k for k in keywords if k.strip(".,!?;:'\"") not in all_source_words]

    # Detect intent. If the user is asking a generic "what did I save recently"
    # / "show me anything" question, we DON'T want to force a tag/domain match
    # (which would return nothing because their query has no real topic words).
    # Instead, jump straight to the recency tier.
    is_recency = _is_recency_intent(effective_query)
    is_browse = _is_browse_intent(effective_query)
    topical_kws = _topical_keywords(keywords)
    no_topic = not topical_kws and not source_filter
    fallback_used = False  # set when we serve recent memories instead of a match

    def _safe_ts(m):
        ts = m.get("created_at")
        if ts is None:
            return ""
        if hasattr(ts, "isoformat"):
            return ts.isoformat()
        return str(ts)

    # Tier -1: pure recency / browse intent → return the latest captures
    # directly, no LLM scan, no tag matching. This is the "what did I save
    # recently?" path. It must work whether or not the memory has tags
    # matching any word in the query.
    if no_topic and (is_recency or is_browse):
        try:
            snapshot = await db.collection("memories") \
                .order_by("created_at", direction="DESCENDING") \
                .limit(40).get()
            memories = [
                doc.to_dict() | {"id": doc.id}
                for doc in snapshot
                if belongs_to_current_user(doc.to_dict())
            ][:12]
        except Exception as e:
            print(f"Recency-intent fetch error: {e}")

    # Tier 0: when user explicitly mentions a source type (youtube/web/note/pdf),
    # ALWAYS pull the matching items first. This guarantees we never return a note
    # when they asked for YouTube videos.
    if not memories and source_filter:
        try:
            snapshot = await db.collection("memories") \
                .where("source_type", "==", source_filter) \
                .limit(40).get()
            source_items = sorted(
                [doc.to_dict() | {"id": doc.id} for doc in snapshot if belongs_to_current_user(doc.to_dict())],
                key=_safe_ts,
                reverse=True,
            )

            if keywords:
                # Rank by overlap with remaining keywords (title/summary/tags)
                kw_set = {k.lower() for k in keywords}
                def _score(m):
                    text = " ".join([
                        m.get("title", ""), m.get("summary", ""),
                        " ".join(m.get("key_points", []) or []),
                        " ".join(m.get("tags", []) or []),
                    ]).lower()
                    return sum(1 for k in kw_set if k in text)
                source_items.sort(key=lambda m: (_score(m), _safe_ts(m)), reverse=True)

            memories = source_items[:10]
        except Exception as e:
            print(f"Tier 0 Source Filter Error: {e}")

        # If source filter detected but the user has zero items of that type,
        # treat it as a false-positive (e.g. "how to film a video for marketing")
        # and fall through to a general search instead of returning nothing.
        if not memories:
            source_filter = None
            keywords = [w.lower() for w in effective_query.split() if w.lower() not in STOPWORDS]

    if not memories and keywords:
        search_kw = keywords[:10]
        try:
            snapshot = await db.collection("memories") \
                .where("tags", "array_contains_any", search_kw) \
                .limit(40).get()
            memories = [
                doc.to_dict() | {"id": doc.id}
                for doc in snapshot
                if belongs_to_current_user(doc.to_dict()) and _matches_filter(doc.to_dict())
            ][:10]
        except Exception as e:
            print(f"Tier 1 Search Error: {e}")

    if len(memories) < 3:
        try:
            domain_content, _ = await chat_with_fallback(
                messages=[{
                    "role": "user",
                    "content": f"Classify this query into exactly one of these domains: {', '.join(ALLOWED_DOMAINS)}. Query: '{effective_query}'. Return only the domain name, nothing else."
                }],
                model=settings.OPENAI_MODEL,
                temperature=0,
                max_tokens=20,
            )
            classified_domain = domain_content.strip()
            if classified_domain in ALLOWED_DOMAINS:
                snapshot = await db.collection("memories") \
                    .where("domain", "==", classified_domain) \
                    .limit(40).get()
                existing_ids = {m["id"] for m in memories}
                for doc in snapshot:
                    data = doc.to_dict()
                    if doc.id not in existing_ids and belongs_to_current_user(data) and _matches_filter(data):
                        memories.append(data | {"id": doc.id})
        except Exception as e:
            print(f"Tier 2 Search Error: {e}")

    if len(memories) < 2:
        try:
            snapshot = await db.collection("memories") \
                .order_by("created_at", direction="DESCENDING") \
                .limit(60).get()
            recent = [
                doc.to_dict() | {"id": doc.id}
                for doc in snapshot
                if belongs_to_current_user(doc.to_dict()) and _matches_filter(doc.to_dict())
            ][:15]  # cap at 15 to keep AI scan payload small (avoids token-quota errors)
            if recent:
                scan_data = [{"index": i, "title": m.get("title"), "summary": (m.get("summary") or "")[:80]} for i, m in enumerate(recent)]
                raw_scan = await chat_json(
                    messages=[{
                        "role": "user",
                        "content": f"Which of these memories are most relevant to the query: '{effective_query}'? Return a JSON object with key 'indices' containing an array of the top 3 index numbers. Memories: {json.dumps(scan_data)}"
                    }],
                    model=settings.OPENAI_MODEL,
                    temperature=0,
                )
                indices = raw_scan.get("indices", [])
                if not indices:
                    for v in raw_scan.values():
                        if isinstance(v, list):
                            indices = v
                            break
                existing_ids = {m["id"] for m in memories}
                for idx in indices:
                    if isinstance(idx, int) and 0 <= idx < len(recent):
                        m = recent[idx]
                        if m["id"] not in existing_ids:
                            memories.append(m)
        except Exception as e:
            print(f"Tier 3 Search Error: {e}")

    # Final safety net: if NOTHING matched across all tiers, fall back to the
    # most recent memories so the user always gets something useful instead of
    # a "capture more content" dead-end. This makes the agent feel like a real
    # personal assistant — it answers questions about whatever's in the vault,
    # not only the items whose tags happen to match the query words.
    if not memories:
        try:
            snapshot = await db.collection("memories") \
                .order_by("created_at", direction="DESCENDING") \
                .limit(20).get()
            memories = [
                doc.to_dict() | {"id": doc.id}
                for doc in snapshot
                if belongs_to_current_user(doc.to_dict()) and _matches_filter(doc.to_dict())
            ][:8]
            if memories:
                fallback_used = True
        except Exception as e:
            print(f"Empty-result recency fallback error: {e}")

    if not memories:
        # Truly empty vault (or source-filter with zero matches and no general
        # captures either). Be honest and inviting, not blamey.
        if source_filter:
            label = SOURCE_LABELS.get(source_filter, source_filter)
            msg = f"No {label} captures found yet. Capture one first!"
        else:
            msg = "I couldn't find anything matching that. Try capturing more content."
        return {
            "answer": msg,
            "sources": [],
            "count": 0,
            "follow_ups": [],
        }

    # Default: return ONE focal card. The user gets a clean, single-topic
    # answer instead of a wall of search hits. Widen to a batch (cap 8) when
    # the user explicitly asks for "all / sare / list / top N / compare", OR
    # when this is a TOPIC-LESS recency/browse query (e.g. "what did I save
    # recently?") or a no-match fallback. Crucially, "save"/"saved" alone
    # does NOT widen — only when there's no real topic — so questions like
    # "what did I save about retrieval pipelines" still return a focal card.
    pure_recency_or_browse = (is_recency or is_browse) and no_topic
    wants_list = _is_batch_query(query) or pure_recency_or_browse or fallback_used
    cap = 8 if wants_list else 1

    # Honour the focal_source_id pin: if the caller (typically the /recall
    # follow-up flow) tells us the user is still on the same focal card,
    # fetch it fresh and put it FIRST, then dedupe from the rest.
    pinned: Optional[dict] = None
    if focal_source_id:
        try:
            doc = await db.collection("memories").document(focal_source_id).get()
            if doc.exists:
                data = doc.to_dict() or {}
                if belongs_to_current_user(data):
                    pinned = data | {"id": doc.id}
        except Exception as e:
            print(f"Focal pin fetch error: {e}")

    if pinned:
        memories = [pinned] + [m for m in memories if m.get("id") != pinned.get("id")]

    top_memories = memories[:cap]
    formatted = ""
    for i, m in enumerate(top_memories, 1):
        created = m.get("created_at", "")
        if hasattr(created, "isoformat"):
            created = created.isoformat()
        st = m.get("source_type", "unknown")
        formatted += (
            f"[{i}] Title: {m.get('title')}\n"
            f"    Type: {st}\n"
            f"    Summary: {(m.get('summary') or '')[:300]}\n"
            f"    Key Points: {', '.join((m.get('key_points') or [])[:4])}\n---\n"
        )

    source_constraint = ""
    if source_filter:
        label = SOURCE_LABELS.get(source_filter, source_filter)
        source_constraint = (
            f"\nNOTE: The user asked about their {label} captures. "
            f"All memories below are {label}s — refer to them as such.\n"
        )

    # Recency / browse / fallback intent → tell the model the cards below are
    # the user's most recent captures (not topical search hits) so the answer
    # frames them correctly instead of pretending they precisely match the query.
    # Only applied when there's no real topic in the query — topical queries
    # like "what did I save about retrieval pipelines" still get a normal
    # search-result framing even though "save" is a recency word.
    intent_constraint = ""
    if fallback_used:
        intent_constraint = (
            "\nIMPORTANT: No memory directly matched the query. The cards below "
            "are the user's MOST RECENT captures. Open with: 'Couldn't find an "
            "exact match — here are your most recent saves:' then briefly name "
            "1-2 of the latest items. Don't pretend they answer the question.\n"
        )
    elif pure_recency_or_browse:
        intent_constraint = (
            "\nIMPORTANT: The user is asking to see recent / latest captures. "
            "The cards below are sorted newest-first. Open with a quick recap "
            "like 'Your latest saves include…' and name the 2-3 most recent "
            "titles in plain language. Don't apologise or say there's no match.\n"
        )

    # Optional history block (last 4 turns max) — keeps follow-ups natural
    history_block = ""
    if history:
        recent = history[-4:]
        history_lines = []
        for h in recent:
            role = "User" if h.get("role") == "user" else "Assistant"
            txt = (h.get("content") or "").strip()
            if txt:
                history_lines.append(f"{role}: {txt[:300]}")
        if history_lines:
            history_block = (
                "\nPRIOR CONVERSATION (most recent first below — for follow-up context only):\n"
                + "\n".join(history_lines) + "\n"
            )

    synthesis_prompt = f"""You are the user's personal Second Brain assistant.
The user asks: '{query}'
{source_constraint}{intent_constraint}{history_block}
Top memories from their vault:
{formatted}

Write a SHORT, direct answer:
- 2-3 sentences MAX (~50 words). No bullet points, no markdown headings.
- Lead with the direct answer, then ONE concrete pointer (e.g. "see the Vertex AI Agent Builder video").
- Do NOT list every memory — the UI shows them as cards below your text.
- Do NOT invent facts not in the memories above.
- If this is a follow-up (history present), connect to the prior turn naturally."""

    try:
        answer_raw, _ = await chat_with_fallback(
            messages=[{"role": "user", "content": synthesis_prompt}],
            model=settings.OPENAI_MODEL,
            temperature=0.3,
            max_tokens=160,
        )
        answer = answer_raw.strip()
    except Exception as e:
        print(f"Synthesis Error: {e}")
        if fallback_used:
            answer = f"Couldn't find an exact match — here are your {len(top_memories)} most recent saves."
        elif pure_recency_or_browse:
            answer = f"Your {len(top_memories)} most recent saves are below."
        else:
            answer = f"Found {len(top_memories)} relevant memories — see the cards below."

    # Generate 3 follow-up suggestions based on the top memories
    follow_ups: List[str] = []
    titles = [m.get("title", "") for m in top_memories[:5] if m.get("title")]
    try:
        fu_prompt = (
            f"The user asked: '{query}'. The system returned memories about: "
            f"{'; '.join(titles)}. "
            f"Suggest exactly 3 SHORT follow-up questions (under 9 words each) "
            f"the user might want to ask next, related to these topics. "
            f"Return JSON: {{\"questions\": [\"q1\", \"q2\", \"q3\"]}}"
        )
        fu_raw = await chat_json(
            messages=[{"role": "user", "content": fu_prompt}],
            model=settings.OPENAI_MODEL,
            temperature=0.5,
        )
        qs = fu_raw.get("questions", [])
        if isinstance(qs, list):
            follow_ups = [str(q).strip() for q in qs if str(q).strip()][:3]
    except Exception as e:
        print(f"Follow-up gen error: {e}")

    # Always pad to exactly 3 follow-ups using deterministic fallbacks
    if titles:
        short_title = titles[0][:50]
        defaults = [
            f"Tell me more about {short_title}",
            "What are the key takeaways?",
            "How do these connect to each other?",
        ]
    else:
        defaults = [
            "Show me my most recent captures",
            "What are the top topics in my vault?",
            "Summarize my knowledge base",
        ]
    seen_lc = {q.lower() for q in follow_ups}
    for d in defaults:
        if len(follow_ups) >= 3:
            break
        if d.lower() not in seen_lc:
            follow_ups.append(d)
            seen_lc.add(d.lower())
    follow_ups = follow_ups[:3]

    return {
        "answer": answer,
        "sources": [_enrich_source(m) for m in top_memories],
        "count": len(top_memories),
        "follow_ups": follow_ups,
        "source_filter": source_filter,
    }


async def list_memories(
    domain: str = "",
    limit: int = 20,
    unreviewed: bool = False,
    include_archived: bool = False,
    include_trashed: bool = False,
    source_type: str = "",
    offset: int = 0,
    q: str = "",
) -> List[dict]:
    """List the current user's memories, newest first.

    `unreviewed=True` returns only items that have not yet been reviewed
    or archived from the Inbox — a memory is considered "in the inbox"
    when neither `reviewed` nor `archived` is true on the document.
    Older docs created before these fields existed are treated as
    unreviewed (the field is missing) so legacy captures still show up.

    By default, items in Trash (`trashed_at` set) and items in Archive
    (`archived=True`) are excluded from the main list. Pass
    `include_archived=True` to merge archived items back in. Trashed items
    only appear via the dedicated /trash endpoints.

    `source_type` narrows the result set to a single capture type
    (`web` / `youtube` / `pdf` / `note`). Unknown values are ignored so a
    bad query string can't make the inbox silently empty.

    `offset` skips the first N items in the post-filter, post-sort
    candidate list and is used by the Inbox "Load more" pagination — the
    candidate window we read from Firestore is widened proportionally
    so deep pages still see enough rows to satisfy `limit`.

    `q` is a case-insensitive substring match against `title` and
    `summary`. It runs in-app (Firestore can't do substring search) and
    is applied AFTER the user / unreviewed / archived predicates but
    BEFORE the offset/limit slice, so the Inbox can fall back to a true
    server-side search across the entire candidate window when the
    client-side text filter on the loaded page returns nothing.
    """
    db = await get_db()
    query_ref = db.collection("memories")
    if domain and domain in ALLOWED_DOMAINS:
        query_ref = query_ref.where("domain", "==", domain)
    # Over-fetch then filter to current user (and optionally unreviewed)
    # Pull a wide window so pinned items further back can still float into
    # the returned page even when many newer items exist. We also widen the
    # window to cover the requested `offset` so pagination doesn't run out
    # of candidates after page 1.
    safe_offset = max(0, int(offset or 0))
    safe_limit = max(1, int(limit or 20))
    # Widen the candidate window further when a text query is active so
    # the substring match has plenty of docs to scan across.
    base_window = max(safe_limit * 6, 120) + safe_offset
    fetch_window = base_window * (3 if q else 1)
    snapshot = await query_ref.order_by("created_at", direction="DESCENDING").limit(fetch_window).get()
    allowed_sources = {"youtube", "web", "pdf", "note"}
    src_filter = source_type if source_type in allowed_sources else ""
    needle = (q or "").strip().lower()
    candidates = []
    for doc in snapshot:
        m = doc.to_dict()
        if not belongs_to_current_user(m):
            continue
        # Exclude trashed unless explicitly requested
        if not include_trashed and m.get("trashed_at"):
            continue
        # Exclude archived unless explicitly requested
        if not include_archived and m.get("archived") is True:
            continue
        if unreviewed and (m.get("reviewed") is True or m.get("archived") is True):
            continue
        if src_filter and m.get("source_type") != src_filter:
            continue
        if needle:
            hay = f"{m.get('title') or ''} {m.get('summary') or ''}".lower()
            if needle not in hay:
                continue
        m["id"] = doc.id
        if "created_at" in m and hasattr(m["created_at"], "isoformat"):
            m["created_at"] = m["created_at"].isoformat()
        # Strip heavy inline blobs from list responses — full
        # `image_data` (often 200 KB+) and `pdf_data` (can hit megabytes)
        # would balloon /memories payloads as soon as a user has a few
        # captures. Vault list/grid cards only need `image_thumbnail`
        # for previews; the detail page (/memories/{id}) still returns
        # the full blob so MemoryDetailPage can render the original.
        m.pop("image_data", None)
        m.pop("pdf_data", None)
        candidates.append(m)
    # Pinned items float to the top first, THEN we apply the page window
    # so pinned docs anywhere in the candidate window still surface on
    # page 1. Pagination skips the first `offset` rows of this sorted list.
    candidates.sort(key=lambda x: 0 if x.get("pinned") else 1)
    return candidates[safe_offset:safe_offset + safe_limit]


async def get_memory(memory_id: str) -> dict:
    db = await get_db()
    doc = await db.collection("memories").document(memory_id).get()
    if not doc.exists:
        raise ValueError(f"Memory '{memory_id}' not found.")
    m = doc.to_dict()
    if not belongs_to_current_user(m):
        raise ValueError(f"Memory '{memory_id}' not found.")
    m["id"] = doc.id
    if "created_at" in m and hasattr(m["created_at"], "isoformat"):
        m["created_at"] = m["created_at"].isoformat()
    return m


async def delete_memory(memory_id: str, hard: bool = False) -> dict:
    """Soft-delete by default — set `trashed_at` so the item moves to Trash
    and can be restored. Pass `hard=True` to permanently remove the doc
    (used by the trash purge endpoint)."""
    db = await get_db()
    doc_ref = db.collection("memories").document(memory_id)
    doc = await doc_ref.get()
    if not doc.exists or not belongs_to_current_user(doc.to_dict()):
        raise ValueError(f"Memory '{memory_id}' not found.")
    if hard:
        await doc_ref.delete()
        return {"success": True, "message": f"Memory {memory_id} permanently deleted.", "hard": True}
    import datetime as _dt
    now_iso = _dt.datetime.now(_dt.timezone.utc).isoformat()
    await doc_ref.update({"trashed_at": now_iso})
    return {"success": True, "message": f"Memory {memory_id} moved to Trash.", "trashed_at": now_iso}


async def get_stats() -> dict:
    """Per-user stats. We iterate (rather than .count()) so we can filter by user_id."""
    db = await get_db()
    stats = {"by_source": {}, "by_domain": {}, "total": 0}
    try:
        snap = await db.collection("memories").get()
        for s_type in ["youtube", "web", "pdf", "note"]:
            stats["by_source"][s_type] = 0
        for d in ALLOWED_DOMAINS:
            stats["by_domain"][d] = 0
        for doc in snap:
            data = doc.to_dict()
            if not belongs_to_current_user(data):
                continue
            stats["total"] += 1
            st = data.get("source_type")
            if st in stats["by_source"]:
                stats["by_source"][st] += 1
            dm = data.get("domain")
            if dm in stats["by_domain"]:
                stats["by_domain"][dm] += 1
    except Exception as e:
        print(f"Stats error: {e}")
    return stats
