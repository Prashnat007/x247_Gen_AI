import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Zap, Plus, Check, Flame, Trash2, Brain, CheckCircle2, Sun, Moon,
  Database, BookOpen, Dumbbell, Coffee, Heart, Target, Award,
  Calendar as CalendarIcon, TrendingUp, X, Edit3, Sparkles,
  Link2, ArrowRight,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface Habit {
  id: string;
  name: string;
  icon: string;
  color: string;
  goal: string;
  completions: string[];
  streak: number;
  completed_today: boolean;
  created_at: string;
  // Cross-link slot populated by the W1 capture-enrichment flow when a
  // memory was attached to an existing habit on save. Empty / missing
  // when no captures have linked to this habit.
  linked_memory_ids?: string[];
}

const ICON_MAP: Record<string, any> = {
  Zap, Brain, CheckCircle2, Sun, Moon, Database, BookOpen,
  Dumbbell, Coffee, Heart, Target, Award, Sparkles, Flame,
};

const ICON_OPTIONS = ['Zap', 'Brain', 'CheckCircle2', 'Sun', 'Moon', 'Database', 'BookOpen', 'Dumbbell', 'Coffee', 'Heart', 'Target', 'Award', 'Sparkles', 'Flame'];
const COLOR_OPTIONS = ['#10b981', '#06b6d4', '#3b82f6', '#a78bfa', '#ec4899', '#f59e0b', '#ef4444', '#22d3ee'];

interface HabitsPageProps { embedded?: boolean }
const HabitsPage: React.FC<HabitsPageProps> = ({ embedded = false }) => {
  const navigate = useNavigate();
  const [habits, setHabits] = useState<Habit[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const [newIcon, setNewIcon] = useState('Zap');
  const [newColor, setNewColor] = useState('#10b981');
  // Popover state — which habit's linked-memory list is open, plus
  // a memo of fetched memory titles so we don't re-hit the backend
  // every time the user re-opens the same popover.
  const [openLinksHabit, setOpenLinksHabit] = useState<Habit | null>(null);
  const [linkTitles, setLinkTitles] = useState<Record<string, string>>({});

  const load = () => {
    fetch('/habits')
      .then(r => r.ok ? r.json() : [])
      .then((data: unknown) => {
        setHabits(Array.isArray(data) ? (data as Habit[]) : []);
        setLoading(false);
      }).catch(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const stats = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const completedToday = habits.filter(h => h.completions?.includes(today)).length;
    const longestStreak = habits.reduce((max, h) => Math.max(max, h.streak || 0), 0);
    const totalCompletions = habits.reduce((sum, h) => sum + (h.completions?.length || 0), 0);
    const todayPct = habits.length ? Math.round((completedToday / habits.length) * 100) : 0;
    return { completedToday, totalHabits: habits.length, longestStreak, totalCompletions, todayPct };
  }, [habits]);

  // 7-day grid: today and 6 prior days
  const last7 = useMemo(() => {
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      days.push({
        date: d.toISOString().slice(0, 10),
        label: d.toLocaleDateString('en-US', { weekday: 'short' }).slice(0, 1),
        full: d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
        isToday: i === 0,
      });
    }
    return days;
  }, []);

  // 30-day overview
  const last30 = useMemo(() => {
    const days = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const iso = d.toISOString().slice(0, 10);
      const completedCount = habits.filter(h => h.completions?.includes(iso)).length;
      days.push({ date: iso, count: completedCount, total: habits.length });
    }
    return days;
  }, [habits]);

  const toggleHabit = async (h: Habit, dateIso: string) => {
    const r = await fetch(`/habits/${h.id}/toggle?date=${dateIso}`, { method: 'POST' });
    const updated = await r.json();
    setHabits(habits.map(x => x.id === h.id ? updated : x));
  };

  const addHabit = async () => {
    if (!newName.trim()) return;
    await fetch('/habits', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName, icon: newIcon, color: newColor })
    });
    setNewName(''); setNewIcon('Zap'); setNewColor('#10b981'); setShowAdd(false);
    load();
  };

  const deleteHabit = async (id: string) => {
    if (!confirm('Delete this habit and all its history?')) return;
    await fetch(`/habits/${id}`, { method: 'DELETE' });
    setHabits(habits.filter(h => h.id !== id));
  };

  // Lazy-fetch memory titles for the popover. Each id becomes a single
  // GET /memories/{id} — fine for the small N we expect (a habit links
  // to a handful of captures, not hundreds).
  useEffect(() => {
    if (!openLinksHabit) return;
    const ids = openLinksHabit.linked_memory_ids || [];
    const missing = ids.filter(id => !(id in linkTitles));
    if (missing.length === 0) return;
    let cancelled = false;
    Promise.all(missing.map(id =>
      fetch(`/memories/${id}`).then(r => r.ok ? r.json() : null).catch(() => null)
    )).then(results => {
      if (cancelled) return;
      setLinkTitles(prev => {
        const next = { ...prev };
        missing.forEach((id, i) => {
          next[id] = (results[i] && results[i].title) || 'Untitled memory';
        });
        return next;
      });
    });
    return () => { cancelled = true; };
  }, [openLinksHabit]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '14px 0 28px', minHeight: 'calc(100vh - 5rem)' }}>

      {/* HERO HEADER */}
      {!embedded && (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ width: 52, height: 52, borderRadius: 14, background: 'linear-gradient(135deg, rgba(16,185,129,0.25), rgba(5,150,105,0.18))', border: '1px solid rgba(16,185,129,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 28px rgba(16,185,129,0.2)' }}>
              <Flame size={24} color="#10b981" />
            </div>
            <div>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '4px 12px', background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: 20, marginBottom: 6 }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#10b981', boxShadow: '0 0 8px #10b981' }} />
                <span style={{ fontSize: 10.5, fontWeight: 700, color: '#10b981', letterSpacing: '0.5px' }}>{stats.todayPct}% TODAY · LONGEST STREAK {stats.longestStreak}D</span>
              </div>
              <h2 style={{ fontSize: 'clamp(22px,3.5vw,30px)', fontWeight: 900, color: 'var(--text-1)', margin: 0, letterSpacing: '-0.6px', lineHeight: 1.05 }}>
                Habits <span style={{ color: '#10b981' }}>✦</span>
              </h2>
              <p style={{ color: 'var(--text-3)', fontSize: 13.5, margin: '4px 0 0' }}>
                Build daily rituals, track streaks, train your second brain
              </p>
            </div>
          </div>
          <button onClick={() => setShowAdd(true)} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '10px 18px', background: 'linear-gradient(135deg,#10b981,#059669)', border: 'none', borderRadius: 10, color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', boxShadow: '0 4px 16px rgba(16,185,129,0.4)' }}>
            <Plus size={14} /> New habit
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
          {[
            { icon: Target, color: '#10b981', label: 'Today', value: `${stats.completedToday}/${stats.totalHabits}`, sub: `${stats.todayPct}% complete` },
            { icon: Flame, color: '#f59e0b', label: 'Longest streak', value: `${stats.longestStreak}d`, sub: 'consecutive days' },
            { icon: TrendingUp, color: '#3b82f6', label: 'Total completions', value: stats.totalCompletions, sub: 'all time' },
            { icon: CalendarIcon, color: '#a78bfa', label: 'Active habits', value: stats.totalHabits, sub: 'tracked daily' },
          ].map(stat => (
            <div key={stat.label} style={{ padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 13 }}>
              <div style={{ width: 40, height: 40, borderRadius: 10, background: `${stat.color}15`, border: `1px solid ${stat.color}30`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <stat.icon size={18} color={stat.color} />
              </div>
              <div>
                <div style={{ color: 'var(--text-3)', fontSize: 10.5, fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase' }}>{stat.label}</div>
                <div style={{ color: 'var(--text-1)', fontSize: 20, fontWeight: 800, lineHeight: 1.1 }}>{stat.value}</div>
                <div style={{ color: 'var(--text-3)', fontSize: 10.5, marginTop: 2 }}>{stat.sub}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
      )}

      {embedded && (
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={() => setShowAdd(true)} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '8px 14px', background: 'linear-gradient(135deg,#10b981,#059669)', border: 'none', borderRadius: 9, color: '#fff', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
            <Plus size={13} /> New habit
          </button>
        </div>
      )}

      {/* 30-day heatmap */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '14px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <CalendarIcon size={13} color="var(--primary)" />
          <h3 style={{ margin: 0, color: 'var(--text-1)', fontSize: 13, fontWeight: 800 }}>Last 30 days</h3>
          <span style={{ marginLeft: 'auto', color: 'var(--text-3)', fontSize: 10.5 }}>Darker = more completed</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(30, 1fr)', gap: 3 }}>
          {last30.map(d => {
            const intensity = d.total ? d.count / d.total : 0;
            const opacity = 0.15 + intensity * 0.85;
            return (
              <div key={d.date} title={`${d.date}: ${d.count}/${d.total}`}
                style={{ aspectRatio: '1', borderRadius: 4, background: intensity ? `rgba(16,185,129,${opacity})` : 'var(--surface-2)', border: '1px solid var(--border)' }} />
            );
          })}
        </div>
      </div>

      {/* HABITS LIST with 7-day grid */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Zap size={13} color="#10b981" />
          <h3 style={{ margin: 0, color: 'var(--text-1)', fontSize: 13, fontWeight: 800 }}>Daily habits</h3>
          <span style={{ marginLeft: 'auto', color: 'var(--text-3)', fontSize: 10.5 }}>Tap a circle to toggle</span>
        </div>
        {loading ? (
          <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-3)', fontSize: 12 }}>Loading habits...</div>
        ) : habits.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-3)' }}>
            <Flame size={36} style={{ margin: '0 auto 10px', opacity: 0.4 }} />
            <p style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>No habits yet</p>
            <p style={{ margin: '4px 0 12px', fontSize: 11.5 }}>Create your first daily ritual</p>
            <button onClick={() => setShowAdd(true)} style={{ padding: '7px 14px', background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: 9, color: '#10b981', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Add first habit</button>
          </div>
        ) : (
          <div className="habits-table-scroll">
            {/* day labels */}
            <div className="habits-grid-row" style={{ display: 'grid', gridTemplateColumns: 'minmax(180px, 1fr) repeat(7, 38px) 60px 40px', alignItems: 'center', padding: '10px 16px', borderBottom: '1px solid var(--border)', fontSize: 9.5, color: 'var(--text-3)', letterSpacing: '0.5px', textTransform: 'uppercase', fontWeight: 700, gap: 6 }}>
              <span>Habit</span>
              {last7.map(d => (
                <span key={d.date} title={d.full} style={{ textAlign: 'center', color: d.isToday ? 'var(--primary)' : 'var(--text-3)' }}>{d.label}</span>
              ))}
              <span style={{ textAlign: 'center' }}>Streak</span>
              <span></span>
            </div>
            {habits.map(h => {
              const Icon = ICON_MAP[h.icon] || Zap;
              return (
                <motion.div key={h.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                  className="habits-grid-row"
                  style={{ display: 'grid', gridTemplateColumns: 'minmax(180px, 1fr) repeat(7, 38px) 60px 40px', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid var(--border)', gap: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                    <div style={{ width: 32, height: 32, borderRadius: 9, background: `${h.color}15`, border: `1px solid ${h.color}30`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <Icon size={15} color={h.color} />
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ color: 'var(--text-1)', fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{h.name}</div>
                      <div style={{ color: 'var(--text-3)', fontSize: 10.5, marginTop: 1 }}>{h.goal}</div>
                      {(h.linked_memory_ids?.length ?? 0) > 0 && (
                        <button
                          type="button"
                          onClick={() => setOpenLinksHabit(h)}
                          data-testid={`badge-habit-memories-${h.id}`}
                          title="Show memories that linked to this habit"
                          style={{ marginTop: 4, display: 'inline-flex', alignItems: 'center', gap: 3, padding: '2px 8px', borderRadius: 20, background: 'rgba(6,182,212,0.12)', border: '1px solid rgba(6,182,212,0.3)', color: '#06b6d4', fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.4px', cursor: 'pointer', fontFamily: 'inherit' }}
                        >
                          <Link2 size={9} /> {h.linked_memory_ids!.length} {h.linked_memory_ids!.length === 1 ? 'memory' : 'memories'}
                        </button>
                      )}
                    </div>
                  </div>
                  {last7.map(d => {
                    const isCompleted = h.completions?.includes(d.date);
                    return (
                      <button key={d.date} onClick={() => toggleHabit(h, d.date)} title={`${h.name} · ${d.full}`}
                        style={{ width: 30, height: 30, borderRadius: '50%', background: isCompleted ? h.color : 'transparent', border: `2px solid ${isCompleted ? h.color : 'var(--border-2)'}`, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto', transition: 'all 0.15s' }}>
                        {isCompleted && <Check size={13} color="#fff" strokeWidth={3} />}
                      </button>
                    );
                  })}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, color: h.streak > 0 ? '#f59e0b' : 'var(--text-3)' }}>
                    {h.streak > 0 && <Flame size={12} />}
                    <span style={{ fontSize: 13, fontWeight: 800 }}>{h.streak}</span>
                  </div>
                  <button onClick={() => deleteHabit(h.id)} title="Delete habit"
                    style={{ padding: 6, background: 'transparent', border: 'none', borderRadius: 6, color: 'var(--text-3)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto' }}>
                    <Trash2 size={11} />
                  </button>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>

      {/* LINKED-MEMORIES POPOVER — opened from the per-habit "N memories"
          pill. Click-outside dismisses; clicking a row deep-links to the
          memory detail page. */}
      <AnimatePresence>
        {openLinksHabit && (
          <div onClick={() => setOpenLinksHabit(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9000, padding: 20 }}>
            <motion.div
              initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }}
              onClick={e => e.stopPropagation()}
              data-testid="popover-habit-memories"
              style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '16px 18px', maxWidth: 440, width: '100%' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <Link2 size={14} color="#06b6d4" />
                <h3 style={{ margin: 0, fontSize: 14, fontWeight: 800, color: 'var(--text-1)' }}>Linked memories</h3>
                <span style={{ marginLeft: 'auto', color: 'var(--text-3)', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 180 }}>{openLinksHabit.name}</span>
                <button onClick={() => setOpenLinksHabit(null)} aria-label="Close"
                  style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 7, padding: 5, cursor: 'pointer', color: 'var(--text-2)', display: 'flex', alignItems: 'center' }}>
                  <X size={13} />
                </button>
              </div>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 360, overflowY: 'auto' }}>
                {openLinksHabit.linked_memory_ids!.map(id => (
                  <li key={id}>
                    <button
                      onClick={() => { setOpenLinksHabit(null); navigate(`/memory/${id}`); }}
                      data-testid={`popover-habit-memory-${id}`}
                      style={{ width: '100%', textAlign: 'left', padding: '10px 12px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 9, color: 'var(--text-1)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 8 }}
                    >
                      <BookOpen size={12} color="var(--text-3)" />
                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {linkTitles[id] || 'Loading…'}
                      </span>
                      <ArrowRight size={11} color="var(--text-3)" />
                    </button>
                  </li>
                ))}
              </ul>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ADD MODAL */}
      <AnimatePresence>
        {showAdd && (
          <div onClick={() => setShowAdd(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9000, padding: 20 }}>
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} onClick={e => e.stopPropagation()}
              style={{ background: 'var(--surface)', border: '1px solid rgba(16,185,129,0.4)', borderRadius: 16, padding: '22px 24px', maxWidth: 480, width: '100%' }}>
              <h3 style={{ margin: '0 0 14px', color: 'var(--text-1)', fontSize: 16, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 8 }}>
                <Plus size={16} color="#10b981" /> New habit
              </h3>
              <label style={{ color: 'var(--text-3)', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase', marginBottom: 5, display: 'block' }}>Name</label>
              <input value={newName} onChange={e => setNewName(e.target.value)} autoFocus placeholder="e.g. Read 30 minutes"
                style={{ width: '100%', padding: '10px 12px', borderRadius: 9, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text-1)', fontSize: 13, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box', marginBottom: 12 }} />
              <label style={{ color: 'var(--text-3)', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase', marginBottom: 5, display: 'block' }}>Icon</label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 5, marginBottom: 12 }}>
                {ICON_OPTIONS.map(name => {
                  const Icon = ICON_MAP[name];
                  return (
                    <button key={name} onClick={() => setNewIcon(name)} title={name}
                      style={{ aspectRatio: '1', display: 'flex', alignItems: 'center', justifyContent: 'center', background: newIcon === name ? `${newColor}20` : 'var(--surface-2)', border: `1px solid ${newIcon === name ? newColor + '50' : 'var(--border)'}`, borderRadius: 9, cursor: 'pointer', color: newIcon === name ? newColor : 'var(--text-2)' }}>
                      <Icon size={15} />
                    </button>
                  );
                })}
              </div>
              <label style={{ color: 'var(--text-3)', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase', marginBottom: 5, display: 'block' }}>Color</label>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
                {COLOR_OPTIONS.map(c => (
                  <button key={c} onClick={() => setNewColor(c)} title={c}
                    style={{ width: 28, height: 28, borderRadius: '50%', background: c, border: `3px solid ${newColor === c ? 'var(--text-1)' : 'transparent'}`, cursor: 'pointer', boxShadow: newColor === c ? `0 0 0 1px ${c}` : 'none' }} />
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => setShowAdd(false)} style={{ flex: 1, padding: '10px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 9, color: 'var(--text-2)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
                <button onClick={addHabit} disabled={!newName.trim()} style={{ flex: 2, padding: '10px', background: newName.trim() ? `linear-gradient(135deg,${newColor},${newColor}cc)` : 'var(--surface-3)', border: 'none', borderRadius: 9, color: '#fff', fontSize: 12.5, fontWeight: 700, cursor: newName.trim() ? 'pointer' : 'default', fontFamily: 'inherit', opacity: newName.trim() ? 1 : 0.5 }}>Create habit</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default HabitsPage;
