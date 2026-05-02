import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FlipHorizontal, Loader2, Award, X, ChevronLeft, ChevronRight, Star, Brain, CheckCircle, XCircle, RotateCcw, Zap, BookOpen, TrendingUp, Search } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import type { Memory, Flashcard } from '../lib/types';
import { card } from '../lib/ui';

interface StudyCard extends Flashcard { status: 'unseen' | 'known' | 'unknown'; }

const SRC_CLR: Record<string, string> = { youtube: '#ef4444', web: '#00d4ff', pdf: '#f59e0b', note: '#10b981' };

const StudyModal = ({ memory, onClose }: { memory: Memory; onClose: (score?: number) => void }) => {
  const [cards, setCards] = useState<StudyCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [idx, setIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [done, setDone] = useState(false);
  const [known, setKnown] = useState(0);
  const [marked, setMarked] = useState(0);

  useEffect(() => {
    fetch(`/memories/${memory.id}/flashcards`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.flashcards) setCards(data.flashcards.map((c: Flashcard) => ({ ...c, status: 'unseen' }))); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [memory.id]);

  const markCard = (status: 'known' | 'unknown') => {
    setCards(prev => prev.map((c, i) => i === idx ? { ...c, status } : c));
    if (status === 'known') setKnown(k => k + 1);
    setMarked(m => m + 1);
    if (idx < cards.length - 1) { setIdx(i => i + 1); setFlipped(false); }
    else setDone(true);
  };

  const restart = () => { setIdx(0); setFlipped(false); setDone(false); setKnown(0); setMarked(0); setCards(prev => prev.map(c => ({ ...c, status: 'unseen' }))); };

  // Score always reflects what the user actually answered (known / marked-so-far)
  // so that partial sessions get a fair score and still count as "studied".
  const score = marked > 0 ? Math.round((known / marked) * 100) : 0;
  // Save progress whenever the user has touched any card, not only on the Done screen.
  const closeWithProgress = () => onClose(marked > 0 ? score : undefined);

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 110, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={closeWithProgress}
        style={{ position: 'absolute', inset: 0, background: 'rgba(5,5,15,0.85)', backdropFilter: 'blur(8px)' }} />

      <motion.div initial={{ opacity: 0, scale: 0.95, y: 24 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 24 }}
        style={{ position: 'relative', width: '100%', maxWidth: 560, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 22, overflow: 'hidden', boxShadow: '0 24px 64px rgba(0,0,0,0.5)' }}>

        {/* Header */}
        <div style={{ padding: '18px 22px', background: 'linear-gradient(135deg, rgba(245,158,11,0.15), rgba(249,115,22,0.08))', borderBottom: '1px solid rgba(245,158,11,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ color: '#f59e0b', fontSize: 9.5, fontWeight: 700, letterSpacing: '1.5px', textTransform: 'uppercase', marginBottom: 4 }}>AI FLASHCARDS · SPACED REPETITION</div>
            <div style={{ color: 'var(--text-1)', fontWeight: 700, fontSize: 14, maxWidth: 380, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{memory.title}</div>
          </div>
          <button onClick={closeWithProgress}
            style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--surface-2)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--text-2)' }}>
            <X size={14} />
          </button>
        </div>

        <div style={{ padding: '22px 24px' }}>
          {loading ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, padding: '40px 0' }}>
              <div style={{ width: 52, height: 52, borderRadius: '50%', background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Loader2 size={22} color="#f59e0b" style={{ animation: 'spin 1s linear infinite' }} />
              </div>
              <div>
                <div style={{ color: 'var(--text-1)', fontWeight: 600, textAlign: 'center', marginBottom: 4 }}>Generating flashcards with Neural AI...</div>
                <div style={{ color: 'var(--text-3)', fontSize: 12, textAlign: 'center' }}>Analyzing key concepts and creating Q&A pairs</div>
              </div>
            </div>
          ) : done ? (
            /* ── Results screen ── */
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
              style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20, padding: '12px 0 8px' }}>
              <div style={{ position: 'relative' }}>
                <div style={{ width: 90, height: 90, borderRadius: '50%', background: score >= 80 ? 'rgba(16,185,129,0.12)' : score >= 50 ? 'rgba(245,158,11,0.12)' : 'rgba(239,68,68,0.1)', border: `2px solid ${score >= 80 ? '#10b981' : score >= 50 ? '#f59e0b' : '#ef4444'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `0 0 30px ${score >= 80 ? 'rgba(16,185,129,0.25)' : score >= 50 ? 'rgba(245,158,11,0.25)' : 'rgba(239,68,68,0.15)'}` }}>
                  <span style={{ fontSize: 26, fontWeight: 900, color: score >= 80 ? '#10b981' : score >= 50 ? '#f59e0b' : '#ef4444' }}>{score}%</span>
                </div>
                <div style={{ position: 'absolute', top: -4, right: -4, width: 24, height: 24, borderRadius: '50%', background: score >= 80 ? '#10b981' : score >= 50 ? '#f59e0b' : '#ef4444', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 6px rgba(0,0,0,0.3)' }}>
                  {score >= 80 ? <Award size={13} color="#fff" /> : <Star size={12} color="#fff" />}
                </div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ color: 'var(--text-1)', fontSize: 18, fontWeight: 800, marginBottom: 4 }}>
                  {score >= 80 ? 'Excellent work!' : score >= 50 ? 'Good progress!' : 'Keep practicing!'}
                </div>
                <div style={{ color: 'var(--text-3)', fontSize: 13 }}>You got <span style={{ color: '#10b981', fontWeight: 700 }}>{known}</span> of <span style={{ fontWeight: 700, color: 'var(--text-2)' }}>{cards.length}</span> cards correct</div>
              </div>
              <div style={{ display: 'flex', gap: 10, width: '100%', flexWrap: 'wrap' }}>
                {cards.filter(c => c.status === 'unknown').length > 0 && (
                  <button onClick={restart}
                    style={{ flex: 1, padding: '11px 16px', background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 12, color: '#f59e0b', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                    <RotateCcw size={14} /> Retry missed
                  </button>
                )}
                <button onClick={() => onClose(score)}
                  style={{ flex: 1, padding: '11px 16px', background: 'linear-gradient(135deg,#f59e0b,#d97706)', border: 'none', borderRadius: 12, color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', boxShadow: '0 4px 12px rgba(245,158,11,0.4)' }}>
                  Done
                </button>
              </div>
            </motion.div>
          ) : cards.length > 0 ? (
            <div>
              {/* Progress */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                <div style={{ flex: 1, height: 4, background: 'var(--surface-3)', borderRadius: 4, overflow: 'hidden' }}>
                  <motion.div animate={{ width: `${((idx) / cards.length) * 100}%` }} transition={{ duration: 0.4 }}
                    style={{ height: '100%', background: 'linear-gradient(90deg,#f59e0b,#f97316)', borderRadius: 4 }} />
                </div>
                <span style={{ color: 'var(--text-3)', fontSize: 11, fontWeight: 600, flexShrink: 0 }}>{idx + 1}/{cards.length}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 3, padding: '2px 8px', background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: 20 }}>
                  <CheckCircle size={10} color="#10b981" />
                  <span style={{ color: '#10b981', fontSize: 10, fontWeight: 700 }}>{known}</span>
                </div>
              </div>

              {/* Card */}
              <motion.div key={`${idx}-${flipped}`}
                initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.2 }}
                onClick={() => setFlipped(!flipped)}
                style={{ minHeight: 180, borderRadius: 16, padding: '28px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', cursor: 'pointer', border: `2px solid ${flipped ? 'rgba(99,102,241,0.3)' : 'rgba(245,158,11,0.2)'}`, background: flipped ? 'rgba(99,102,241,0.06)' : 'rgba(245,158,11,0.05)', transition: 'all 0.2s', position: 'relative', overflow: 'hidden' }}>
                <div style={{ position: 'absolute', top: 12, left: 14, padding: '3px 9px', background: flipped ? 'rgba(99,102,241,0.15)' : 'rgba(245,158,11,0.15)', border: `1px solid ${flipped ? 'rgba(99,102,241,0.3)' : 'rgba(245,158,11,0.3)'}`, borderRadius: 20 }}>
                  <span style={{ color: flipped ? '#818cf8' : '#f59e0b', fontSize: 9, fontWeight: 700, letterSpacing: '1px' }}>{flipped ? 'ANSWER' : 'QUESTION'}</span>
                </div>
                <p style={{ color: 'var(--text-1)', fontSize: 16, fontWeight: 600, lineHeight: 1.55, margin: 0, marginTop: 24 }}>
                  {flipped ? cards[idx].answer : cards[idx].question}
                </p>
                <div style={{ position: 'absolute', bottom: 10, color: 'var(--text-3)', fontSize: 10 }}>
                  {flipped ? '✓ Tap to see question' : '→ Tap to reveal answer'}
                </div>
              </motion.div>

              {/* Actions */}
              {flipped ? (
                <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                  style={{ display: 'flex', gap: 10, marginTop: 14 }}>
                  <button onClick={() => markCard('unknown')}
                    style={{ flex: 1, padding: '12px 0', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 12, color: '#ef4444', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, transition: 'all 0.15s' }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.18)'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.1)'; }}>
                    <XCircle size={15} /> Don't know
                  </button>
                  <button onClick={() => markCard('known')}
                    style={{ flex: 1, padding: '12px 0', background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.35)', borderRadius: 12, color: '#10b981', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, transition: 'all 0.15s' }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'rgba(16,185,129,0.2)'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'rgba(16,185,129,0.12)'; }}>
                    <CheckCircle size={15} /> I know this!
                  </button>
                </motion.div>
              ) : (
                <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                  {idx > 0 && (
                    <button onClick={() => { setIdx(i => i - 1); setFlipped(false); }}
                      style={{ padding: '10px 16px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 11, color: 'var(--text-2)', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 5 }}>
                      <ChevronLeft size={14} /> Back
                    </button>
                  )}
                  <button onClick={() => setFlipped(true)}
                    style={{ flex: 1, padding: '12px 0', background: 'linear-gradient(135deg,#f59e0b,#d97706)', border: 'none', borderRadius: 11, color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', boxShadow: '0 4px 12px rgba(245,158,11,0.35)' }}>
                    Reveal Answer →
                  </button>
                </div>
              )}

              {/* Card dots */}
              <div style={{ display: 'flex', gap: 4, justifyContent: 'center', marginTop: 14 }}>
                {cards.map((c, i) => (
                  <div key={i} style={{ width: 6, height: 6, borderRadius: '50%', background: c.status === 'known' ? '#10b981' : c.status === 'unknown' ? '#ef4444' : i === idx ? '#f59e0b' : 'var(--border-2)', transition: 'all 0.3s' }} />
                ))}
              </div>
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '36px 0', color: 'var(--text-3)' }}>
              <FlipHorizontal size={36} color="var(--border-2)" style={{ margin: '0 auto 12px' }} />
              <p>Failed to generate flashcards for this memory.</p>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
};

interface FlashcardsViewProps { embedded?: boolean }
const FlashcardsView: React.FC<FlashcardsViewProps> = ({ embedded = false }) => {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedMemory, setSelectedMemory] = useState<Memory | null>(null);
  const [filter, setFilter] = useState('');
  const [scores, setScores] = useState<Record<string, number>>({});
  const [stats, setStats] = useState({ total: 0, studied: 0, avgScore: 0 });
  const [searchParams, setSearchParams] = useSearchParams();
  const deepLinkMemoryId = searchParams.get('memory_id') || '';
  const [missingDeepLink, setMissingDeepLink] = useState(false);
  const processedDeepLinkRef = useRef<string>('');

  useEffect(() => {
    fetch('/memories?limit=50').then(r => r.ok ? r.json() : []).then((data: unknown) => {
      setMemories(Array.isArray(data) ? data : []);
      setIsLoading(false);
    }).catch(() => setIsLoading(false));
    const savedScores = JSON.parse(localStorage.getItem('flashcard-scores') || '{}');
    setScores(savedScores);
  }, []);

  // Deep-link: when arriving via /learn?tab=flashcards&memory_id=<id> from
  // the memory detail Smart Action, jump straight into that deck. If the
  // memory isn't in the recent 50, we fall back to fetching it directly so
  // the modal can still open. Either way we strip the param afterwards so
  // a refresh stays on the grid.
  useEffect(() => {
    if (!deepLinkMemoryId || isLoading) return;
    if (processedDeepLinkRef.current === deepLinkMemoryId) return;
    processedDeepLinkRef.current = deepLinkMemoryId;

    const found = memories.find(m => m.id === deepLinkMemoryId);
    const stripParam = () => {
      const next = new URLSearchParams(searchParams);
      next.delete('memory_id');
      setSearchParams(next, { replace: true });
    };

    if (found) {
      setSelectedMemory(found);
      stripParam();
      return;
    }
    // Not in the cached list — try a direct fetch.
    fetch(`/memories/${encodeURIComponent(deepLinkMemoryId)}`)
      .then(r => r.ok ? r.json() : null)
      .then((m: Memory | null) => {
        if (m && m.id) {
          setMemories(prev => prev.some(x => x.id === m.id) ? prev : [m, ...prev]);
          setSelectedMemory(m);
        } else {
          setMissingDeepLink(true);
          setTimeout(() => setMissingDeepLink(false), 4000);
        }
      })
      .catch(() => {
        setMissingDeepLink(true);
        setTimeout(() => setMissingDeepLink(false), 4000);
      })
      .finally(stripParam);
  }, [deepLinkMemoryId, isLoading, memories, searchParams, setSearchParams]);

  useEffect(() => {
    const vals = Object.values(scores) as number[];
    setStats({ total: memories.length, studied: vals.length, avgScore: vals.length > 0 ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0 });
  }, [scores, memories]);

  const handleClose = useCallback((memId: string, score?: number) => {
    setSelectedMemory(null);
    if (score !== undefined) {
      const updated = { ...scores, [memId]: score };
      setScores(updated);
      localStorage.setItem('flashcard-scores', JSON.stringify(updated));
    }
  }, [scores]);

  const filtered = memories.filter(m =>
    m.title.toLowerCase().includes(filter.toLowerCase()) ||
    (m.domain || '').toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <div style={{ color: 'var(--text-1)' }}>
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} style={{ marginBottom: 22 }}>
        {!embedded && (
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 14, marginBottom: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 40, height: 40, borderRadius: 11, background: 'rgba(245,158,11,0.15)', border: '1px solid rgba(245,158,11,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 16px rgba(245,158,11,0.15)' }}>
                <FlipHorizontal size={18} color="#f59e0b" />
              </div>
              <div>
                <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0, letterSpacing: '-0.4px' }}>AI Flashcards</h1>
                <p style={{ color: 'var(--text-3)', fontSize: 12, margin: '2px 0 0' }}>Spaced repetition learning from your knowledge base</p>
              </div>
            </div>

            <div style={{ display: 'relative', width: 220 }}>
              <div style={{ position: 'relative' }}>
                <Search size={13} color="var(--text-3)" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)' }} />
                <input type="text" placeholder="Filter memories..." value={filter} onChange={e => setFilter(e.target.value)}
                  style={{ width: '100%', paddingLeft: 30, paddingRight: 12, paddingTop: 8, paddingBottom: 8, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 9, color: 'var(--text-1)', fontSize: 12, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }} />
              </div>
            </div>
          </div>
        )}
        {embedded && (
          <div style={{ marginBottom: 14, position: 'relative', maxWidth: 280 }}>
            <Search size={13} color="var(--text-3)" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)' }} />
            <input type="text" placeholder="Filter memories..." value={filter} onChange={e => setFilter(e.target.value)}
              style={{ width: '100%', paddingLeft: 30, paddingRight: 12, paddingTop: 8, paddingBottom: 8, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 9, color: 'var(--text-1)', fontSize: 12, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }} />
          </div>
        )}

        {/* Stats row */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginBottom: 18 }}>
          {[
            { icon: BookOpen, label: 'Total Decks', value: stats.total, color: '#f59e0b' },
            { icon: Brain, label: 'Studied', value: stats.studied, color: '#8b5cf6' },
            { icon: TrendingUp, label: 'Avg Score', value: `${stats.avgScore}%`, color: '#10b981' },
          ].map(s => (
            <div key={s.label} style={{ ...card, padding: '13px 16px', display: 'flex', alignItems: 'center', gap: 12, border: `1px solid ${s.color}18` }}>
              <div style={{ width: 32, height: 32, borderRadius: 9, background: `${s.color}12`, border: `1px solid ${s.color}20`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <s.icon size={15} color={s.color} />
              </div>
              <div>
                <div style={{ fontSize: 20, fontWeight: 800, color: s.color, lineHeight: 1 }}>{s.value}</div>
                <div style={{ fontSize: 10.5, color: 'var(--text-3)', marginTop: 2 }}>{s.label}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Deep-link error banner — memory_id from URL didn't resolve */}
        {missingDeepLink && (
          <div data-testid="banner-flashcard-deeplink-missing" style={{ padding: '10px 14px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.22)', borderRadius: 10, display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <XCircle size={14} color="#ef4444" />
            <div style={{ color: 'var(--text-2)', fontSize: 12 }}>
              Couldn't find that memory's flashcards — pick a deck from the list below.
            </div>
          </div>
        )}

        {/* How it works banner */}
        <div style={{ padding: '12px 16px', background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.18)', borderRadius: 12, display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 4 }}>
          <div style={{ width: 28, height: 28, borderRadius: 8, background: 'rgba(245,158,11,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Zap size={14} color="#f59e0b" />
          </div>
          <div>
            <div style={{ color: '#f59e0b', fontSize: 11, fontWeight: 700, marginBottom: 3 }}>How spaced repetition works</div>
            <div style={{ color: 'var(--text-3)', fontSize: 11.5, lineHeight: 1.5 }}>
              Neural AI generates 5 Q&A flashcards from any memory. Flip each card and mark yourself — <span style={{ color: '#10b981', fontWeight: 600 }}>Know it</span> or <span style={{ color: '#ef4444', fontWeight: 600 }}>Don't know</span>. Your score is saved for tracking.
            </div>
          </div>
        </div>
      </motion.div>

      {isLoading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '60px 0' }}>
          <Loader2 size={32} color="#f59e0b" style={{ animation: 'spin 1s linear infinite' }} />
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 0' }}>
          <FlipHorizontal size={40} color="var(--border-2)" style={{ margin: '0 auto 12px' }} />
          <p style={{ color: 'var(--text-3)', margin: 0 }}>{filter ? 'No memories match your filter.' : 'No memories yet — capture content to generate flashcards!'}</p>
        </div>
      ) : (
        <div className="flashcard-grid">
          {filtered.map((memory, i) => {
            const score = scores[memory.id];
            const clr = SRC_CLR[memory.source_type] ?? '#6366f1';
            const hasScore = score !== undefined;
            return (
              <motion.button key={memory.id} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}
                onClick={() => setSelectedMemory(memory)}
                style={{ ...card, padding: '16px', textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit', display: 'flex', flexDirection: 'column', gap: 12, border: `1px solid ${hasScore && score >= 80 ? 'rgba(16,185,129,0.2)' : hasScore ? 'rgba(245,158,11,0.15)' : 'var(--border)'}`, transition: 'all 0.18s' }}
                onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.boxShadow = `0 8px 24px ${clr}12`; e.currentTarget.style.borderColor = `${clr}30`; }}
                onMouseLeave={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.borderColor = hasScore && score >= 80 ? 'rgba(16,185,129,0.2)' : hasScore ? 'rgba(245,158,11,0.15)' : 'var(--border)'; }}>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ padding: '3px 8px', background: `${clr}12`, border: `1px solid ${clr}25`, borderRadius: 20 }}>
                    <span style={{ color: clr, fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.8px' }}>{memory.source_type}</span>
                  </div>
                  {hasScore && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 8px', background: score >= 80 ? 'rgba(16,185,129,0.1)' : 'rgba(245,158,11,0.1)', border: `1px solid ${score >= 80 ? 'rgba(16,185,129,0.25)' : 'rgba(245,158,11,0.25)'}`, borderRadius: 20 }}>
                      <Award size={9} color={score >= 80 ? '#10b981' : '#f59e0b'} />
                      <span style={{ color: score >= 80 ? '#10b981' : '#f59e0b', fontSize: 10, fontWeight: 700 }}>{score}%</span>
                    </div>
                  )}
                </div>

                <div style={{ flex: 1 }}>
                  <div style={{ color: 'var(--text-1)', fontSize: 13, fontWeight: 700, lineHeight: 1.4, marginBottom: 5, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{memory.title}</div>
                  <div style={{ color: 'var(--text-3)', fontSize: 11, lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{memory.summary}</div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 10, borderTop: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                    {memory.tags.slice(0, 2).map(t => (
                      <span key={t} style={{ padding: '2px 7px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 20, color: 'var(--text-3)', fontSize: 9.5 }}>#{t}</span>
                    ))}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#f59e0b', fontSize: 11, fontWeight: 700 }}>
                    <FlipHorizontal size={12} />
                    <span>{hasScore ? 'Retry' : 'Study'}</span>
                  </div>
                </div>
              </motion.button>
            );
          })}
        </div>
      )}

      <AnimatePresence>
        {selectedMemory && (
          <StudyModal memory={selectedMemory} onClose={(score) => handleClose(selectedMemory.id, score)} />
        )}
      </AnimatePresence>
    </div>
  );
};

export default FlashcardsView;
