import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Brain, Send, Search, Sparkles, Clock, Bot,
  Youtube, Globe, FileText, StickyNote, Loader2,
  ArrowRight, Mic, MicOff, X, Hash, History, Radio,
  ChevronUp, ChevronDown, ExternalLink, Check, Edit2,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { LazyMarkdownMessage as MarkdownMessage } from '../components/LazyMarkdownMessage';
import { LiveInlineGate } from '../components/LiveChatPanel';
import AutoGrowTextarea from '../components/AutoGrowTextarea';
import MemoryEditModal from '../components/MemoryEditModal';
import type { Memory } from '../lib/types';

interface Source {
  id: string;
  title?: string;
  source_url?: string;
  source_type?: 'youtube' | 'web' | 'note' | 'pdf' | string;
  domain?: string;
  summary?: string;
  key_points?: string[];
  tags?: string[];
  thumbnail_url?: string;
  youtube_id?: string;
  favicon_url?: string;
  host?: string;
  created_at?: string;
}

interface RecallMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: Source[];
  follow_ups?: string[];
  ts: string;
  streaming?: boolean;
}

const SRC_ICON: Record<string, any> = { youtube: Youtube, web: Globe, pdf: FileText, note: StickyNote };
const SRC_CLR: Record<string, string> = { youtube: '#ef4444', web: '#00d4ff', pdf: '#f59e0b', note: '#10b981' };

const QUICK_PROMPTS = [
  { icon: Sparkles, label: 'Top insights', q: 'Give me my top 5 insights from across everything I have saved.' },
  { icon: Youtube,  label: 'YouTube key points', q: 'What are the key points from my YouTube video captures?' },
  { icon: Globe,    label: 'Article highlights', q: 'Summarize the most important points from my saved articles.' },
  { icon: StickyNote, label: 'Action items', q: 'List the action items and todos from my notes.' },
  { icon: Clock,    label: 'Last 7 days', q: 'What did I capture in the last 7 days, grouped by theme?' },
  { icon: Brain,    label: 'Connect ideas', q: 'Find non-obvious connections between the topics I have studied.' },
];

const formatRelativeDate = (iso?: string): string => {
  if (!iso) return '';
  try {
    const then = new Date(iso).getTime();
    const days = Math.round((Date.now() - then) / 86400000);
    if (days === 0) return 'today';
    if (days === 1) return 'yesterday';
    if (days < 7) return `${days}d ago`;
    if (days < 30) return `${Math.round(days / 7)}w ago`;
    return `${Math.round(days / 30)}mo ago`;
  } catch { return ''; }
};

/* ----------------------------------------------------------------------- */
/* Source Card — richer than before, with YouTube banner / web favicon     */
/* ----------------------------------------------------------------------- */
const SourceCard: React.FC<{
  src: Source;
  onAsk: (q: string) => void;
  onPlay?: (id: string) => void;
  isPlaying?: boolean;
  onStop?: () => void;
  onEdit?: (src: Source) => void;
}> = ({ src, onAsk, onPlay, isPlaying, onStop, onEdit }) => {
  const navigate = useNavigate();
  const Icon = SRC_ICON[src.source_type || 'note'] ?? Brain;
  const clr = SRC_CLR[src.source_type || 'note'] ?? '#6366f1';
  const isYt = src.source_type === 'youtube' && src.youtube_id;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="recall-card"
      style={{
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 14,
        overflow: 'hidden',
        transition: 'all 0.18s',
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLDivElement).style.borderColor = `${clr}55`;
        (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-2px)';
        (e.currentTarget as HTMLDivElement).style.boxShadow = `0 8px 24px ${clr}1a`;
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border)';
        (e.currentTarget as HTMLDivElement).style.transform = 'translateY(0)';
        (e.currentTarget as HTMLDivElement).style.boxShadow = 'none';
      }}
    >
      {/* Banner: YouTube thumb / player */}
      {isYt && (
        <div style={{ position: 'relative', width: '100%', paddingBottom: '56.25%', background: '#000' }}>
          {isPlaying ? (
            <>
              <iframe
                src={`https://www.youtube.com/embed/${src.youtube_id}?autoplay=1&rel=0&modestbranding=1`}
                title={src.title}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0 }}
              />
              <button onClick={(e) => { e.stopPropagation(); onStop?.(); }}
                title="Stop"
                style={{ position: 'absolute', top: 8, right: 8, width: 26, height: 26, borderRadius: '50%', background: 'rgba(0,0,0,0.75)', border: '1px solid rgba(255,255,255,0.25)', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, zIndex: 2 }}>
                <X size={13} />
              </button>
            </>
          ) : (
            <button
              onClick={() => onPlay?.(src.id)}
              title={`Play "${src.title}"`}
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', background: '#000', overflow: 'hidden', border: 0, padding: 0, cursor: 'pointer' }}>
              <img
                src={src.thumbnail_url}
                alt={src.title}
                loading="lazy"
                onError={(e) => { (e.currentTarget as HTMLImageElement).src = `https://img.youtube.com/vi/${src.youtube_id}/hqdefault.jpg`; }}
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              />
              <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.5) 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'rgba(239,68,68,0.95)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 16px rgba(239,68,68,0.5)' }}>
                  <svg viewBox="0 0 24 24" fill="white" width="20" height="20"><path d="M8 5v14l11-7z" /></svg>
                </div>
              </div>
              <div style={{ position: 'absolute', top: 8, left: 8, padding: '3px 8px', background: 'rgba(239,68,68,0.95)', borderRadius: 4, color: '#fff', fontSize: 9.5, fontWeight: 800, letterSpacing: '0.8px' }}>
                YOUTUBE
              </div>
            </button>
          )}
        </div>
      )}

      {/* Body — compact spacing so cards stay small */}
      <div style={{ padding: 11, display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
        {/* Header row: type + date */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {src.favicon_url ? (
              <img src={src.favicon_url} alt="" width={14} height={14} style={{ borderRadius: 3 }} />
            ) : (
              <Icon size={13} color={clr} />
            )}
            <span style={{ color: clr, fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.6px' }}>
              {src.host || src.source_type || 'memory'}
            </span>
          </div>
          {src.created_at && (
            <span style={{ color: 'var(--text-3)', fontSize: 10.5, fontWeight: 500 }}>
              {formatRelativeDate(src.created_at)}
            </span>
          )}
        </div>

        {/* Title */}
        <div style={{ color: 'var(--text-1)', fontSize: 13, fontWeight: 700, lineHeight: 1.3, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
          {src.title || 'Untitled'}
        </div>

        {/* Summary */}
        {src.summary && (
          <div style={{ color: 'var(--text-2)', fontSize: 11.5, lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
            {src.summary}
          </div>
        )}

        {/* Tags */}
        {src.tags && src.tags.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {src.tags.slice(0, 4).map((t) => (
              <span key={t} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '2px 7px', background: `${clr}10`, border: `1px solid ${clr}22`, borderRadius: 10, color: clr, fontSize: 10, fontWeight: 600 }}>
                <Hash size={8} />{t}
              </span>
            ))}
          </div>
        )}

        {/* Footer actions */}
        <CardActions src={src} clr={clr} onAsk={onAsk} navigate={navigate} onEdit={onEdit} />
      </div>
    </motion.div>
  );
};

/**
 * Compact footer-actions row for a SourceCard. Pulled out so the
 * "Mark as read" optimistic state lives in its own tiny component
 * instead of bloating SourceCard's signature. The user explicitly
 * asked for an inline way to mark a memory as finished/read from
 * the recall answer, so it sits right next to Open/Ask.
 *
 * Posts to PATCH /memories/{id} with {reviewed: true}. On success
 * the button flips to a green check + "Read" label and disables.
 * Failure silently reverts so the user can retry.
 */
const CardActions: React.FC<{
  src: Source;
  clr: string;
  onAsk: (q: string) => void;
  navigate: (to: string) => void;
  onEdit?: (src: Source) => void;
}> = ({ src, clr, onAsk, navigate, onEdit }) => {
  const [reading, setReading] = useState(false);
  const [done, setDone] = useState(false);

  const markRead = async () => {
    if (done || reading || !src.id) return;
    setReading(true);
    try {
      const r = await fetch(`/memories/${encodeURIComponent(src.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewed: true }),
      });
      if (r.ok) {
        setDone(true);
        try {
          window.dispatchEvent(new CustomEvent('recall-toast', {
            detail: { msg: 'Marked as read', type: 'success' },
          }));
        } catch {}
      }
    } catch {
      // silent — user can retry
    } finally {
      setReading(false);
    }
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 'auto', paddingTop: 4, flexWrap: 'wrap' }}>
      <button onClick={() => navigate(`/memory/${src.id}`)}
        style={{ flex: '1 1 70px', padding: '6px 8px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 7, color: 'var(--text-2)', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
        Open <ArrowRight size={10} />
      </button>
      <button onClick={() => onAsk(`Tell me more about "${src.title}". What are the key takeaways?`)}
        title="Ask follow-up about this memory"
        style={{ flex: '1 1 70px', padding: '6px 8px', background: `${clr}14`, border: `1px solid ${clr}30`, borderRadius: 7, color: clr, fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
        Ask AI
      </button>
      <button onClick={markRead} disabled={done || reading}
        title={done ? 'Already marked as read' : 'Mark this memory as read / finished'}
        style={{
          flex: '1 1 70px', padding: '6px 8px',
          background: done ? 'rgba(34,197,94,0.14)' : 'var(--surface-2)',
          border: done ? '1px solid rgba(34,197,94,0.35)' : '1px solid var(--border)',
          borderRadius: 7,
          color: done ? '#22c55e' : 'var(--text-2)',
          fontSize: 11, fontWeight: 600,
          cursor: done ? 'default' : (reading ? 'wait' : 'pointer'),
          fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
          opacity: reading ? 0.7 : 1,
          transition: 'all 0.15s',
        }}>
        {reading ? <Loader2 size={10} className="spin" /> : <Check size={11} />}
        {done ? 'Read' : 'Mark read'}
      </button>
      {onEdit && (
        <button onClick={() => onEdit(src)}
          title="Edit memory"
          data-testid={`button-edit-source-${src.id}`}
          style={{ width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 7, background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-3)', cursor: 'pointer', flexShrink: 0, transition: 'all 0.15s' }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(167,139,250,0.14)'; (e.currentTarget as HTMLButtonElement).style.color = '#a78bfa'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(167,139,250,0.3)'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--surface-2)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-3)'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border)'; }}>
          <Edit2 size={11} />
        </button>
      )}
      {src.source_url && (
        <a href={src.source_url} target="_blank" rel="noreferrer"
          title={src.source_url}
          style={{ width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 7, background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-3)', textDecoration: 'none', flexShrink: 0 }}>
          <ExternalLink size={11} />
        </a>
      )}
    </div>
  );
};

/* ----------------------------------------------------------------------- */
/* Card-show ledger helpers                                                */
/*                                                                         */
/* The render layer used to dedupe with one monotonic Set: any source ID   */
/* shown once was hidden forever in that chat. That was too aggressive —   */
/* re-asking a broad question or coming back to a topic later should re-   */
/* surface the relevant card. Now we keep a per-card ledger of WHEN it     */
/* was last shown and WHAT topic the query was about, then make a per-     */
/* card show/suppress decision on each new turn.                           */
/*                                                                         */
/* Tweak these thresholds in one place; they're intentionally lightweight. */
/* ----------------------------------------------------------------------- */

// Common English filler words. We strip these from queries and card text
// before computing the topic fingerprint — they aren't what the user is
// actually asking about. Mirrors the backend list in app/recall_agent.py
// so client and server agree on what counts as "topic" wording.
const RECALL_STOPWORDS: Set<string> = new Set([
  'the','a','an','is','are','was','were','be','been','being',
  'what','how','why','when','where','who','which',
  'tell','find','search','recall','show','give','see','view','list','get','look','look up','lookup',
  'me','my','mine','i','we','our','you','your','they','them',
  'about','around','from','into','onto',
  'do','did','does','done','doing','have','has','had','can','could','would','should','will','shall','may','might',
  'to','of','in','on','for','with','and','or','but','as','at','by','if','so','than','that','this','these','those',
  'it','its','here','there',
  'all','any','some','every','each','both','few','many','more','most','other',
  'just','only','really','very','also','still','again','please',
  'recent','recently','latest','lately','newest','new','today','yesterday','tonight','now','last','past',
  'save','saved','saves','saving','capture','captured','captures','capturing','added','stored','kept','uploaded',
  'thing','things','stuff','item','items','one','ones',
  'memory','memories','vault','library','content','note','notes',
  // common source-type words — present in many queries, but not topic words
  'youtube','video','videos','yt','watch','watched',
  'article','articles','blog','blogs','post','posts','webpage','website','web','url','link','links',
  'pdf','pdfs','paper','papers','document','documents','doc','docs',
]);

// Jaccard overlap below this counts as "topic changed" → re-surface the
// card. Set low enough that a couple of shared filler-survivor words
// don't lock a card in suppression after a real topic switch.
const TOPIC_CHANGED_OVERLAP = 0.2;
// Jaccard at-or-above this counts as "strong same-topic" overlap, which
// is one of three conditions that have to all hold to suppress.
const STRONG_TOPIC_OVERLAP = 0.5;
// A response with this many or more distinct source IDs is treated as a
// "broad" answer → show all of them, ignore prior-show suppression.
// Set deliberately low (2): if the backend returned more than one card,
// honour the breadth — collapsing one of them is what created the
// "ABC card never came back" complaint that triggered this rework.
const BROAD_RESPONSE_MIN_DISTINCT = 2;
// A response with this many or fewer distinct source IDs is treated as
// "narrow" — one of three conditions that have to all hold to suppress.
// Symmetric with the broad threshold above: only single-card responses
// are eligible for suppression.
const NARROW_RESPONSE_MAX_DISTINCT = 1;
// If the card was last shown strictly more than this many assistant turns
// ago, we always re-surface — long enough that re-showing is welcome.
const LONG_AGO_TURN_GAP = 4;
// Fraction of meaningful words in THIS turn's query (raw fingerprint,
// not blended) that have to appear in a card's title/tags before we
// treat the user as explicitly naming the card and force a re-show.
// We use the raw fp on purpose so that pronouny follow-ups (which would
// inherit the prior topic and thus look "specific" against any card from
// that topic) do not accidentally trip this override during a streak.
const EXPLICIT_CARD_MATCH_RATIO = 0.5;

// Pronouny / continuation tokens. A short user turn that's mostly these
// words ("what else about it", "tell me more") is a follow-up, not a
// topic switch — we inherit the prior turn's topic fingerprint so the
// streak suppression keeps holding.
const FOLLOW_UP_MARKERS: Set<string> = new Set([
  'tell','more','what','about','that','and','those','it','this','explain',
  'why','how','elaborate','else','yeah','yes','ok','okay','too','also',
  'next','then','same','still','they','them',
]);

interface ShowLedgerEntry {
  turnIndex: number;       // assistant-turn index (1-based) when shown
  topicFingerprint: Set<string>;
}

/** Lowercase, strip punctuation, drop stopwords, dedupe → keyword set. */
const fingerprint = (text: string | undefined | null): Set<string> => {
  if (!text) return new Set();
  const out = new Set<string>();
  const cleaned = text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ');
  for (const raw of cleaned.split(/\s+/)) {
    if (raw.length < 2) continue;
    if (RECALL_STOPWORDS.has(raw)) continue;
    out.add(raw);
  }
  return out;
};

/** Set Jaccard. Empty-vs-empty returns 1; empty-vs-nonempty returns 0. */
const jaccard = (a: Set<string>, b: Set<string>): number => {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
};

/** Build a fingerprint of the card's identifying words (title + tags). */
const cardFingerprint = (src: Source): Set<string> => {
  const out = new Set<string>();
  const merge = (fp: Set<string>) => { for (const w of fp) out.add(w); };
  merge(fingerprint(src.title));
  for (const t of (src.tags || [])) merge(fingerprint(t));
  return out;
};

/** True if the user turn is a short pronouny follow-up like "what else
 *  about it" or "tell me more" — a continuation of the prior topic, not a
 *  topic switch. We use this to inherit the prior turn's fingerprint so
 *  same-topic streak suppression keeps holding even when the follow-up
 *  text itself has no topic words of its own. */
const isShortFollowUp = (text: string | undefined | null): boolean => {
  const words = (text || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 6) return false;
  return words.some(w => FOLLOW_UP_MARKERS.has(w.replace(/[^\p{L}\p{N}]/gu, '')));
};

/**
 * Build the topic fingerprint that represents what the user is currently
 * asking about. Plain `fingerprint()` of the raw query is not enough:
 * pronouny follow-ups like "what else about it" strip down to nothing
 * after stopwords, which would falsely look like a topic switch. So when
 * the current turn is a short follow-up (or its fingerprint comes out
 * empty), we walk back to the most recent prior user turn whose
 * fingerprint has real content and inherit that as the topic. This
 * mirrors the backend's "blend prior user turn into the effective query"
 * behaviour in app/recall_agent.py.
 */
const queryTopicFingerprint = (
  messages: RecallMessage[],
  assistantIdx: number,
): Set<string> => {
  // Find the most recent user message at or before this assistant turn.
  let userIdx = -1;
  for (let j = assistantIdx - 1; j >= 0; j--) {
    if (messages[j].role === 'user') { userIdx = j; break; }
  }
  if (userIdx < 0) return new Set();
  const currentText = messages[userIdx].content || '';
  const currentFp = fingerprint(currentText);
  const isFollowUp = isShortFollowUp(currentText);

  // If the turn looks like a follow-up OR its fp is empty, inherit topic
  // words from the nearest prior user turn that has any. Cap the look-back
  // at 3 prior user turns to avoid pulling in stale topic words from much
  // earlier in the chat.
  if (isFollowUp || currentFp.size === 0) {
    let lookbacks = 0;
    for (let j = userIdx - 1; j >= 0 && lookbacks < 3; j--) {
      if (messages[j].role !== 'user') continue;
      lookbacks++;
      const priorFp = fingerprint(messages[j].content || '');
      if (priorFp.size === 0) continue;
      // Merge prior fp into current. Current's own (non-empty) words still
      // count, so a follow-up that names a NEW topic word still nudges the
      // fingerprint toward the new topic.
      for (const w of priorFp) currentFp.add(w);
      break;
    }
  }
  return currentFp;
};

/**
 * Decide whether `candidate` should render as a card on THIS turn.
 *
 * Override (always show) when ANY of these is true:
 *  - Card was never shown before in this chat.
 *  - The current response has multiple distinct sources (broad answer
 *    like "all youtube captures" — show all, don't collapse).
 *  - The user explicitly identifies this card on THIS turn — measured
 *    using the raw fingerprint of the current query (not the blended
 *    follow-up fingerprint), so that pronouny continuations don't trip
 *    this override during a same-topic streak.
 *  - The current query's topic differs sharply from the topic that
 *    caused this card's last show (Jaccard < TOPIC_CHANGED_OVERLAP).
 *  - The card was last shown more than LONG_AGO_TURN_GAP turns ago.
 *
 * Suppress (return false) only when ALL of these hold simultaneously:
 *  - Card was last shown in the immediately previous 1–3 assistant turns.
 *  - Strong topic overlap with that prior show (>= STRONG_TOPIC_OVERLAP).
 *  - Current response is narrow (<= NARROW_RESPONSE_MAX_DISTINCT distinct
 *    source IDs) and this card is the dominant one (rank 0).
 */
const shouldShowSource = (
  candidate: Source,
  candidateRank: number,
  currentTurnIndex: number,
  blendedFp: Set<string>,
  rawFp: Set<string>,
  ledger: Map<string, ShowLedgerEntry>,
  responseDistinctCount: number,
): boolean => {
  if (!candidate.id) return false;
  const prior = ledger.get(candidate.id);
  if (!prior) return true;

  // Broad-response override: more than one distinct source in this
  // response → honour the breadth and show them all. Re-asking
  // "all youtube captures" must surface every relevant card again,
  // even ones whose IDs were displayed earlier in the chat.
  if (responseDistinctCount >= BROAD_RESPONSE_MIN_DISTINCT) return true;

  const turnsSince = currentTurnIndex - prior.turnIndex;
  if (turnsSince > LONG_AGO_TURN_GAP) return true;

  // Explicit-identification override. Uses the RAW (this-turn-only)
  // fingerprint on purpose: the blended fingerprint inherits topic words
  // from the prior turn for follow-up classification, which would make
  // every same-topic follow-up look "explicit" against the focal card.
  // Raw-fp keeps this honest: only counts words the user actually typed
  // on this turn that match the card's title or tags.
  if (rawFp.size > 0) {
    const cardFp = cardFingerprint(candidate);
    if (cardFp.size > 0) {
      let matched = 0;
      for (const w of rawFp) if (cardFp.has(w)) matched++;
      if (matched / rawFp.size >= EXPLICIT_CARD_MATCH_RATIO) return true;
    }
  }

  const overlap = jaccard(blendedFp, prior.topicFingerprint);
  if (overlap < TOPIC_CHANGED_OVERLAP) return true;

  // Suppress only when ALL three conditions hold.
  const recentlyShown = turnsSince >= 1 && turnsSince <= 3;
  const strongOverlap = overlap >= STRONG_TOPIC_OVERLAP;
  const narrowAndDominant =
    responseDistinctCount <= NARROW_RESPONSE_MAX_DISTINCT && candidateRank === 0;

  if (recentlyShown && strongOverlap && narrowAndDominant) return false;

  // Default: show. Cards are useful — only suppress when we're sure.
  return true;
};

/* ----------------------------------------------------------------------- */
/* Main Recall View                                                        */
/* ----------------------------------------------------------------------- */
const RecallView = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [messages, setMessages] = useState<RecallMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [memCount, setMemCount] = useState<number | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [playingYt, setPlayingYt] = useState<Set<string>>(new Set());
  const [liveOpen, setLiveOpen] = useState(false);
  // Editing state for the "Edit memory" inline action on each source card.
  // We adapt a Source into the minimal Memory shape the modal expects.
  const [editingSource, setEditingSource] = useState<Source | null>(null);

  // When the modal saves we update every message that references this
  // source id, so the title/summary/tags/url change is visible without
  // a full re-fetch of the conversation. We trust the server-confirmed
  // shape — including an explicitly cleared source_url (undefined) —
  // and never fall back to the stale value, otherwise a clear+save
  // round-trip would silently re-introduce the old URL.
  const applySourceUpdate = useCallback((updated: Memory) => {
    setMessages(prev => prev.map(msg => {
      if (!msg.sources) return msg;
      let touched = false;
      const next = msg.sources.map(s => {
        if (s.id !== updated.id) return s;
        touched = true;
        return {
          ...s,
          title: updated.title,
          summary: updated.summary,
          tags: updated.tags,
          source_url: updated.source_url,
        };
      });
      return touched ? { ...msg, sources: next } : msg;
    }));
  }, []);

  // Adapt the Source we have in chat to the Memory shape MemoryEditModal
  // expects. We only carry the fields the modal actually edits/displays.
  const editingMemoryAdapter: Memory | null = editingSource ? ({
    id: editingSource.id,
    title: editingSource.title || '',
    summary: editingSource.summary || '',
    key_points: [],
    tags: editingSource.tags || [],
    domain: editingSource.domain || '',
    source_type: (editingSource.source_type as Memory['source_type']) || 'note',
    source_url: editingSource.source_url,
    created_at: editingSource.created_at || '',
  }) : null;
  const [history, setHistory] = useState<string[]>(() => {
    try {
      const parsed = JSON.parse(localStorage.getItem('recall-x247-history') || '[]');
      return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === 'string').slice(0, 5) : [];
    } catch { return []; }
  });

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    fetch('/stats').then(r => r.ok ? r.json() : null).then(s => { if (s) setMemCount(s.total_memories); }).catch(() => {});
  }, []);

  useEffect(() => {
    if (messages.length === 0) return;
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages]);

  // ?q=… auto-send: lets the agent chat redirect users here with a prefilled
  // query (e.g. "recall my AI Engineering World's Fair notes" → /recall?q=…).
  // Fires once per arriving query string and then strips ?q from the URL so
  // it doesn't re-fire on re-renders or browser back/forward.
  const lastAutoQueryRef = useRef<string>('');
  useEffect(() => {
    const q = (searchParams.get('q') || '').trim();
    if (!q) return;
    if (q === lastAutoQueryRef.current) return;
    lastAutoQueryRef.current = q;
    handleSend(q);
    const next = new URLSearchParams(searchParams);
    next.delete('q');
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const conversationHistory = useMemo(() => {
    return messages
      .filter(m => !m.streaming && (m.content || '').trim().length > 0)
      .map(m => ({ role: m.role, content: m.content }));
  }, [messages]);

  // Card-show decisions, computed by replaying the whole `messages` array
  // from scratch each render. For each assistant message we record:
  //   - displayedIds: source IDs that should render as cards
  //   - suppressedIds: source IDs the backend returned but we hid because
  //     the user is in a same-topic streak and this card just appeared
  // The ledger threading uses the assistant turn index + the prior user
  // query's topic fingerprint, so a topic switch (or a broad re-ask)
  // naturally re-surfaces previously-shown cards. See helpers above.
  // Rebuilt purely from `messages`, so a "New chat" (which clears
  // messages) resets all suppression to zero — no extra persistence.
  const cardShowDecisions = useMemo(() => {
    const displayed = new Map<string, Set<string>>();
    const suppressed = new Map<string, Set<string>>();
    const ledger = new Map<string, ShowLedgerEntry>();
    let assistantTurn = 0;

    for (let i = 0; i < messages.length; i++) {
      const m = messages[i];
      if (m.role !== 'assistant') continue;
      assistantTurn++;
      const displayedSet = new Set<string>();
      const suppressedSet = new Set<string>();

      const sources = m.sources || [];
      if (sources.length === 0) {
        displayed.set(m.id, displayedSet);
        suppressed.set(m.id, suppressedSet);
        continue;
      }

      // Two fingerprints for this turn:
      //   - blendedFp: topic-overlap fingerprint, inherits prior topic
      //     words for pronouny follow-ups so they don't look like a
      //     topic switch during a streak.
      //   - rawFp: just THIS turn's words, used to detect when the user
      //     explicitly named a card (so the explicit-identification
      //     override doesn't trigger on every same-topic follow-up).
      const blendedFp = queryTopicFingerprint(messages, i);
      let userText = '';
      for (let j = i - 1; j >= 0; j--) {
        if (messages[j].role === 'user') { userText = messages[j].content || ''; break; }
      }
      const rawFp = fingerprint(userText);

      // Distinct source IDs in THIS response — used to decide whether the
      // response is broad (show all) or narrow (eligible for suppression).
      const distinct = new Set<string>();
      for (const s of sources) if (s.id) distinct.add(s.id);
      const distinctCount = distinct.size;

      // Walk the response in order. Rank 0 = the first/dominant source.
      const localSeen = new Set<string>();
      let rank = -1;
      for (const s of sources) {
        if (!s.id || localSeen.has(s.id)) continue;
        localSeen.add(s.id);
        rank++;
        const show = shouldShowSource(s, rank, assistantTurn, blendedFp, rawFp, ledger, distinctCount);
        if (show) {
          displayedSet.add(s.id);
          // Update the ledger with this fresh show. Store the BLENDED
          // fingerprint so future overlap comparisons see the full topic
          // context (including any words inherited from prior turns).
          ledger.set(s.id, { turnIndex: assistantTurn, topicFingerprint: blendedFp });
        } else {
          suppressedSet.add(s.id);
        }
      }

      displayed.set(m.id, displayedSet);
      suppressed.set(m.id, suppressedSet);
    }

    return { displayed, suppressed };
  }, [messages]);

  const toggleVoice = useCallback(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;
    if (isListening) { recognitionRef.current?.stop(); setIsListening(false); return; }
    const rec = new SR();
    rec.continuous = false; rec.interimResults = true; rec.lang = 'en-US';
    rec.onresult = (e: any) => setInput(Array.from(e.results).map((r: any) => r[0].transcript).join(''));
    rec.onend = () => setIsListening(false);
    rec.onerror = () => setIsListening(false);
    recognitionRef.current = rec;
    rec.start(); setIsListening(true);
  }, [isListening]);

  const handleSend = async (text?: string) => {
    const msg = (text || input).trim();
    if (!msg || isLoading) return;

    setHistory(prev => {
      const next = [msg, ...prev.filter(h => h !== msg)].slice(0, 5);
      try { localStorage.setItem('recall-x247-history', JSON.stringify(next)); } catch {}
      return next;
    });

    const userId = `u-${Date.now()}`;
    const aiId = `a-${Date.now()}`;
    const priorHistory = conversationHistory;

    setMessages(prev => [...prev,
      { id: userId, role: 'user', content: msg, ts: new Date().toISOString() },
      { id: aiId, role: 'assistant', content: '', ts: new Date().toISOString(), streaming: true }
    ]);
    setInput(''); setIsLoading(true);

    try {
      const res = await fetch('/recall', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: msg,
          history: priorHistory,
        }),
      });
      const data = await res.json();
      const sources: Source[] = data.sources || [];
      setMessages(prev => prev.map(m => m.id === aiId
        ? {
          ...m,
          content: data.answer || data.error || 'No response received.',
          sources,
          follow_ups: data.follow_ups || [],
          streaming: false,
        }
        : m
      ));
    } catch {
      setMessages(prev => prev.map(m => m.id === aiId
        ? { ...m, content: 'Connection error — please try again.', streaming: false }
        : m
      ));
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const card: React.CSSProperties = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14 };
  const isEmpty = messages.length === 0;

  return (
    <div className="recall-shell" style={{ display: 'flex', flexDirection: 'column', minHeight: 'calc(100vh - 5rem)', gap: 14, padding: '6px 0 0', maxWidth: 980, margin: '0 auto', width: '100%' }}>

      {/* Combined upper card — header + Ask-your-Second-Brain hero + prompt
          chips, all in one box so the chips and recent questions never get
          hidden under the sticky input bar at the bottom. */}
      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
        style={{ ...card, padding: '14px 16px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
            <div style={{ width: 42, height: 42, borderRadius: 12, background: 'linear-gradient(135deg, rgba(99,102,241,0.25), rgba(147,51,234,0.15))', border: '1px solid rgba(99,102,241,0.32)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 16px rgba(99,102,241,0.22)' }}>
              <Brain size={20} color="#818cf8" />
            </div>
            <div>
              <h1 style={{ color: 'var(--text-1)', fontSize: 19, fontWeight: 800, margin: 0, letterSpacing: '-0.3px', lineHeight: 1.15 }}>Ask your Second Brain</h1>
              <div style={{ color: 'var(--text-3)', fontSize: 12, marginTop: 3 }}>
                {memCount ?? '—'} memories · type, speak, or pick a prompt below
              </div>
            </div>
          </div>
          {messages.length > 0 && (
            <button onClick={() => { setMessages([]); setPlayingYt(new Set()); }}
              style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 12px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-2)', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
              <X size={11} /> New chat
            </button>
          )}
        </div>

        {/* Prompt chips — only shown when conversation is empty. Live INSIDE
            the upper card so they're always visible without scrolling. */}
        {isEmpty && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8, marginTop: 14 }}>
            {QUICK_PROMPTS.map((p) => {
              const Icon = p.icon;
              return (
                <button key={p.label} onClick={() => handleSend(p.q)}
                  className="recall-prompt-btn"
                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 11, cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit', transition: 'all 0.15s' }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(99,102,241,0.45)'; (e.currentTarget as HTMLButtonElement).style.background = 'rgba(99,102,241,0.08)'; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border)'; (e.currentTarget as HTMLButtonElement).style.background = 'var(--surface-2)'; }}>
                  <div style={{ width: 28, height: 28, borderRadius: 8, background: 'rgba(99,102,241,0.14)', border: '1px solid rgba(99,102,241,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <Icon size={13} color="#818cf8" />
                  </div>
                  <span style={{ color: 'var(--text-2)', fontSize: 13, fontWeight: 600 }}>{p.label}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Recent questions — also inside the upper card */}
        {isEmpty && history.length > 0 && (
          <div style={{ paddingTop: 12, marginTop: 12, borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-3)', fontSize: 11, fontWeight: 700, letterSpacing: '0.8px', textTransform: 'uppercase' }}>
              <History size={11} /> Recent questions
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {history.slice(0, 5).map((q, i) => (
                <button key={`${q}-${i}`} onClick={() => handleSend(q)} title={q}
                  style={{ padding: '6px 11px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 16, cursor: 'pointer', color: 'var(--text-2)', fontSize: 11.5, fontWeight: 500, fontFamily: 'inherit', maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}
      </motion.div>

      {/* Live Voice Recall — collapsible card with REAL-TIME badge */}
      <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
        style={{ ...card, overflow: 'hidden', border: liveOpen ? '1px solid rgba(34,211,238,0.3)' : '1px solid var(--border)' }}>
        <button
          onClick={() => setLiveOpen(o => !o)}
          aria-expanded={liveOpen}
          style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 16px', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: 9, background: 'rgba(34,211,238,0.14)', border: '1px solid rgba(34,211,238,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Radio size={14} color="#22d3ee" />
            </div>
            <div style={{ textAlign: 'left' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <span style={{ color: 'var(--text-1)', fontSize: 13.5, fontWeight: 700 }}>Voice Recall</span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 7px', background: 'rgba(239,68,68,0.14)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 10, color: '#f87171', fontSize: 9, fontWeight: 800, letterSpacing: '0.5px' }}>
                  <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#ef4444', animation: 'pulse 1.5s ease-in-out infinite' }} />
                  REAL-TIME
                </span>
              </div>
              <div style={{ color: 'var(--text-3)', fontSize: 11.5, marginTop: 2 }}>
                Talk to your Second Brain — answers stream back in real time
              </div>
            </div>
          </div>
          {liveOpen ? <ChevronUp size={16} color="var(--text-3)" /> : <ChevronDown size={16} color="var(--text-3)" />}
        </button>
        <AnimatePresence>
          {liveOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              style={{ overflow: 'hidden' }}>
              <div style={{ padding: '0 14px 14px' }}>
                <LiveInlineGate active={liveOpen} compact />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      {/* Content area — flows naturally with the page. Input bar below is
          NOT sticky any more; user asked for it to scroll with the content. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

      {/* Empty state hero, prompt chips and recent questions now live INSIDE
          the upper card above. Only the message thread renders down here. */}

      {/* Messages thread */}
      {messages.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {messages.map((msg) => (
            <motion.div key={msg.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
              style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

              {msg.role === 'user' ? (
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <div style={{ maxWidth: '85%', padding: '10px 15px', borderRadius: '14px 4px 14px 14px', background: 'linear-gradient(135deg,#6366f1,#4f46e5)', color: '#fff', fontSize: 13.5, lineHeight: 1.55, boxShadow: '0 2px 12px rgba(99,102,241,0.3)', whiteSpace: 'pre-wrap' }}>
                    {msg.content}
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {/* Short answer chip */}
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                    <div style={{ width: 30, height: 30, borderRadius: 9, background: 'linear-gradient(135deg,#1e1b4b,#312e81)', border: '1px solid rgba(99,102,241,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <Brain size={14} color="#818cf8" />
                    </div>
                    <div style={{ flex: 1, padding: '11px 15px', borderRadius: '4px 14px 14px 14px', background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-1)', fontSize: 13.5, lineHeight: 1.6 }}>
                      {msg.streaming ? (
                        <div style={{ display: 'flex', gap: 4, alignItems: 'center', height: 18 }}>
                          {[0,1,2].map(i => (
                            <div key={i} style={{ width: 6, height: 6, borderRadius: '50%', background: '#818cf8', animation: `bounce 1.2s ease-in-out ${i * 0.18}s infinite` }} />
                          ))}
                          <span style={{ color: '#818cf8', fontSize: 11, marginLeft: 6 }}>Searching your vault…</span>
                        </div>
                      ) : (
                        <MarkdownMessage content={msg.content} onActionClick={(t) => handleSend(t)} />
                      )}
                    </div>
                  </div>

                  {/* Source cards grid. Decisions about which cards to
                      render come from cardShowDecisions, which is the
                      smart, context-aware ledger described above. We
                      drop pure intra-response duplicates here too so a
                      backend payload with the same ID twice doesn't
                      render duplicate React keys. */}
                  {(() => {
                    const allSources = msg.sources || [];
                    if (allSources.length === 0) return null;
                    const displayedIds = cardShowDecisions.displayed.get(msg.id) || new Set<string>();
                    const suppressedIds = cardShowDecisions.suppressed.get(msg.id) || new Set<string>();
                    const localSeen = new Set<string>();
                    const visibleSources = allSources.filter(s => {
                      if (!s.id || localSeen.has(s.id)) return false;
                      localSeen.add(s.id);
                      return displayedIds.has(s.id);
                    });
                    const suppressedCount = suppressedIds.size;

                    // Nothing new and nothing suppressed → render nothing.
                    if (visibleSources.length === 0 && suppressedCount === 0) return null;

                    // Nothing new but we hid some on this turn because the
                    // user is in a same-topic streak. Show a tiny inline
                    // cue instead of a full card grid — keeps the answer
                    // text uncluttered while still pointing at the card
                    // that's already visible just above.
                    if (visibleSources.length === 0) {
                      return (
                        <div style={{ paddingLeft: 40, color: 'var(--text-3)', fontSize: 11, fontStyle: 'italic' }}>
                          (see card above)
                        </div>
                      );
                    }

                    // Standard render: visible cards + an honest subtitle.
                    // The new "Y already shown just above" copy is more
                    // truthful than the old "Y reused from above" — the
                    // backend didn't reuse anything; the client just
                    // chose not to repeat the card on this turn. When
                    // nothing is suppressed, we omit the subtitle too.
                    return (
                      <div style={{ paddingLeft: 40 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8 }}>
                          <span style={{ color: 'var(--text-3)', fontSize: 10, fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase' }}>
                            {visibleSources.length} {visibleSources.length === 1 ? 'memory' : 'memories'} from your vault
                            {suppressedCount > 0 && (
                              <span style={{ marginLeft: 6, color: 'var(--text-3)', fontWeight: 500, textTransform: 'none', letterSpacing: 0 }}>
                                · {suppressedCount} already shown just above
                              </span>
                            )}
                          </span>
                          <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 9 }}>
                          {visibleSources.map((src) => {
                            const playKey = `${msg.id}:${src.id}`;
                            return (
                              <SourceCard
                                key={src.id}
                                src={src}
                                onAsk={(q) => handleSend(q)}
                                onPlay={() => setPlayingYt(prev => { const n = new Set(prev); n.add(playKey); return n; })}
                                isPlaying={playingYt.has(playKey)}
                                onStop={() => setPlayingYt(prev => { const n = new Set(prev); n.delete(playKey); return n; })}
                                onEdit={(s) => setEditingSource(s)}
                              />
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}

                  {/* Follow-up chips */}
                  {msg.follow_ups && msg.follow_ups.length > 0 && !msg.streaming && (
                    <div style={{ paddingLeft: 40, display: 'flex', flexDirection: 'column', gap: 7 }}>
                      <div style={{ color: 'var(--text-3)', fontSize: 10.5, fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase' }}>
                        Ask a follow-up
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
                        {msg.follow_ups.map((f, i) => (
                          <button key={`${f}-${i}`} onClick={() => handleSend(f)}
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 13px', background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.25)', borderRadius: 18, color: '#a5b4fc', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', maxWidth: 360, textAlign: 'left', transition: 'all 0.15s' }}
                            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(99,102,241,0.18)'; }}
                            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(99,102,241,0.08)'; }}>
                            <Sparkles size={11} />
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Agent attribution */}
                  {!msg.streaming && (
                    <div style={{ paddingLeft: 40, display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-3)', fontSize: 10 }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                        <Bot size={9} color="#818cf8" /> RecallAgent
                      </span>
                      <span>·</span>
                      <span>{new Date(msg.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                  )}
                </div>
              )}
            </motion.div>
          ))}
          <div ref={bottomRef} />
        </div>
      )}

      </div>{/* end flex-1 content area */}

      {/* Input — flows with the page (no sticky). Sits below the message
          thread so the whole page scrolls naturally. */}
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}
        style={{
          ...card,
          padding: '12px 14px 14px',
        }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', background: 'var(--surface-2)', border: `1px solid ${isListening ? 'rgba(239,68,68,0.4)' : 'rgba(99,102,241,0.2)'}`, borderRadius: 12, padding: '9px 11px', transition: 'border-color 0.2s' }}>
          <Search size={14} color="#818cf8" style={{ alignSelf: 'center', flexShrink: 0 }} />
          <AutoGrowTextarea ref={inputRef} value={input} onChange={e => setInput(e.target.value)} onKeyDown={handleKeyDown}
            placeholder={isListening ? 'Listening…' : isEmpty ? 'Ask your Second Brain anything…' : 'Ask a follow-up…'}
            disabled={isLoading}
            rows={1}
            maxHeight={160}
            className="bare-input"
            style={{ flex: 1, color: 'var(--text-1)', fontSize: 13.5, fontFamily: 'inherit', lineHeight: 1.5, minHeight: 22 }}
            title="Enter to send, Shift+Enter for newline"
          />
          <button onClick={toggleVoice}
            title={isListening ? 'Stop listening' : 'Voice input'}
            style={{ width: 32, height: 32, borderRadius: 8, border: 'none', cursor: 'pointer', background: isListening ? 'rgba(239,68,68,0.14)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            {isListening ? <MicOff size={14} color="#ef4444" style={{ animation: 'pulse 1s ease-in-out infinite' }} /> : <Mic size={14} color="var(--text-3)" />}
          </button>
          <button onClick={() => handleSend()} disabled={!input.trim() || isLoading}
            style={{ width: 36, height: 36, borderRadius: 9, border: 'none', cursor: input.trim() && !isLoading ? 'pointer' : 'default', background: input.trim() && !isLoading ? 'linear-gradient(135deg,#6366f1,#4f46e5)' : 'var(--surface-3)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: input.trim() && !isLoading ? '0 2px 10px rgba(99,102,241,0.4)' : 'none' }}>
            {isLoading ? <Loader2 size={14} color="var(--text-3)" style={{ animation: 'spin 1s linear infinite' }} /> : <Send size={14} color={input.trim() ? '#fff' : 'var(--text-3)'} />}
          </button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 7, paddingLeft: 4, paddingRight: 4 }}>
          <div style={{ color: 'var(--text-3)', fontSize: 10.5 }}>
            Enter to send · Shift+Enter for newline · Tap mic for voice
          </div>
          <button onClick={() => navigate('/agent')}
            style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', cursor: 'pointer', color: '#a78bfa', fontSize: 10.5, fontWeight: 600, fontFamily: 'inherit' }}
            title="Need multi-step workflows? Try Agent Hub">
            Agent Hub <ArrowRight size={10} />
          </button>
        </div>
      </motion.div>

      <MemoryEditModal
        memory={editingMemoryAdapter}
        onClose={() => setEditingSource(null)}
        onSaved={(updated) => { applySourceUpdate(updated); setEditingSource(null); }}
      />
    </div>
  );
};

export default RecallView;
