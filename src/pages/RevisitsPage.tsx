import React, { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import {
  Bell, Plus, ExternalLink, Check, RotateCw, PauseCircle, PlayCircle, Trash2,
  Loader2, Filter, Search, ChevronRight, Calendar as CalIcon, AlarmClock,
} from 'lucide-react';
import { showToast } from '../App';
import { RevisitScheduler } from '../components/RevisitScheduler';

type Revisit = {
  id: string;
  title: string;
  memory_id: string;
  url: string;
  notes: string;
  frequency: string;
  interval_days: number;
  specific_date: string;
  next_due: string;
  last_visited: string;
  visit_count: number;
  status: 'active' | 'paused' | 'completed';
  action_label: string;
};

const FREQ_LABEL: Record<string, string> = {
  once: 'Once',
  daily: 'Daily',
  twice_weekly: 'Twice a week',
  weekly: 'Weekly',
  biweekly: 'Twice a month',
  monthly: 'Monthly',
  custom_days: 'Custom interval',
  specific_date: 'Specific date',
};

interface RevisitsPageProps { embedded?: boolean }
const RevisitsPage: React.FC<RevisitsPageProps> = ({ embedded = false }) => {
  const navigate = useNavigate();
  const [items, setItems] = useState<Revisit[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [filter, setFilter] = useState<'all' | 'due' | 'upcoming' | 'paused' | 'completed'>('all');
  const [search, setSearch] = useState('');

  const reload = async () => {
    setLoading(true);
    try {
      // Fetch active + paused + completed in one go using status=all
      const r = await fetch('/revisits?status=all&limit=500');
      const data = r.ok ? await r.json() : [];
      setItems(Array.isArray(data) ? data : []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); }, []);

  const now = Date.now();
  const enriched = useMemo(() => items.map(it => {
    const nd = it.next_due ? Date.parse(it.next_due) : NaN;
    const overdue = !isNaN(nd) && nd <= now && it.status === 'active';
    const upcoming = !isNaN(nd) && nd > now && it.status === 'active';
    const hours = !isNaN(nd) ? Math.round((nd - now) / 36e5) : 0;
    return { ...it, _overdue: overdue, _upcoming: upcoming, _hours: hours };
  }), [items, now]);

  const filtered = useMemo(() => {
    let list = enriched;
    if (filter === 'due') list = list.filter(x => x._overdue);
    else if (filter === 'upcoming') list = list.filter(x => x._upcoming);
    else if (filter === 'paused') list = list.filter(x => x.status === 'paused');
    else if (filter === 'completed') list = list.filter(x => x.status === 'completed');
    const q = search.trim().toLowerCase();
    if (q) list = list.filter(x =>
      (x.title || '').toLowerCase().includes(q) ||
      (x.url || '').toLowerCase().includes(q) ||
      (x.notes || '').toLowerCase().includes(q));
    return list;
  }, [enriched, filter, search]);

  const counts = useMemo(() => ({
    all: enriched.length,
    due: enriched.filter(x => x._overdue).length,
    upcoming: enriched.filter(x => x._upcoming).length,
    paused: enriched.filter(x => x.status === 'paused').length,
    completed: enriched.filter(x => x.status === 'completed').length,
  }), [enriched]);

  const goTo = async (rv: Revisit) => {
    if (rv.url) window.open(rv.url, '_blank', 'noopener,noreferrer');
    else if (rv.memory_id) navigate(`/memory/${rv.memory_id}`);
    try { await fetch(`/revisits/${rv.id}/visit`, { method: 'POST' }); } catch {}
    reload();
  };

  const markDone = async (rv: Revisit) => {
    try { await fetch(`/revisits/${rv.id}/visit`, { method: 'POST' }); showToast('Marked done'); } catch {}
    reload();
  };

  const snooze = async (rv: Revisit, days: number) => {
    try {
      await fetch(`/revisits/${rv.id}/snooze`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ days }),
      });
      showToast(`Snoozed ${days >= 1 ? days + 'd' : Math.round(days * 24) + 'h'}`);
    } catch {}
    reload();
  };

  const togglePause = async (rv: Revisit) => {
    try {
      await fetch(`/revisits/${rv.id}/${rv.status === 'paused' ? 'resume' : 'pause'}`, { method: 'POST' });
      showToast(rv.status === 'paused' ? 'Resumed' : 'Paused');
    } catch {}
    reload();
  };

  const remove = async (rv: Revisit) => {
    if (!confirm(`Delete revisit "${rv.title}"?`)) return;
    try { await fetch(`/revisits/${rv.id}`, { method: 'DELETE' }); showToast('Deleted'); } catch {}
    reload();
  };

  const fmtDue = (rv: Revisit & { _overdue?: boolean; _hours?: number }) => {
    if (!rv.next_due) return 'No upcoming';
    const h = rv._hours ?? 0;
    if (rv._overdue) {
      const oh = Math.abs(h);
      return oh < 24 ? `Overdue by ${oh}h` : `Overdue by ${Math.round(oh / 24)}d`;
    }
    return h < 24 ? `In ${Math.max(1, h)}h` : `In ${Math.round(h / 24)}d`;
  };

  return (
    <div style={{ maxWidth: 980, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* Header */}
      {!embedded && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ width: 42, height: 42, borderRadius: 12, background: 'linear-gradient(135deg, rgba(245,158,11,0.18), rgba(244,114,182,0.12))', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Bell size={20} color="#f59e0b" />
          </div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: 'var(--text-1)' }}>Revisit Reminders</h1>
            <p style={{ margin: '4px 0 0', color: 'var(--text-3)', fontSize: 13 }}>
              Schedule "come back later" reminders for captured items, links, and ideas.
            </p>
          </div>
          <button onClick={() => setShowCreate(s => !s)} style={btnPrimary}>
            <Plus size={13} /> New revisit
          </button>
        </div>
      )}
      {embedded && (
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={() => setShowCreate(s => !s)} style={btnPrimary}>
            <Plus size={13} /> New revisit
          </button>
        </div>
      )}

      {/* Inline create */}
      <AnimatePresence>
        {showCreate && (
          <RevisitScheduler
            onCreated={() => { setShowCreate(false); reload(); }}
            onCancel={() => setShowCreate(false)}
          />
        )}
      </AnimatePresence>

      {/* Filter strip */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Filter size={13} color="var(--text-3)" />
        {(['all', 'due', 'upcoming', 'paused', 'completed'] as const).map(k => {
          const active = filter === k;
          return (
            <button key={k} onClick={() => setFilter(k)} style={{
              padding: '6px 11px', borderRadius: 999, fontSize: 11.5, fontWeight: 700, cursor: 'pointer',
              fontFamily: 'inherit', border: active ? '1px solid var(--primary)' : '1px solid var(--border)',
              background: active ? 'var(--primary-bg)' : 'var(--surface)',
              color: active ? 'var(--primary)' : 'var(--text-2)', textTransform: 'capitalize',
            }}>
              {k} <span style={{ marginLeft: 6, opacity: 0.7 }}>{counts[k]}</span>
            </button>
          );
        })}
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, minWidth: 200 }}>
          <Search size={12} color="var(--text-3)" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search..."
            className="bare-input"
            style={{ flex: 1, color: 'var(--text-1)', fontSize: 12, fontFamily: 'inherit' }} />
        </div>
      </div>

      {/* List */}
      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
          <Loader2 size={26} color="#f59e0b" style={{ animation: 'spin 1s linear infinite' }} />
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 20px', background: 'var(--surface)', border: '1px dashed var(--border)', borderRadius: 14 }}>
          <AlarmClock size={32} color="var(--text-3)" style={{ marginBottom: 10 }} />
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-1)' }}>
            {filter === 'all' ? 'No revisits yet' : `No ${filter} revisits`}
          </div>
          <p style={{ color: 'var(--text-3)', fontSize: 12, margin: '6px 0 14px', maxWidth: 380, marginInline: 'auto' }}>
            Capture a link or memory and schedule a revisit so future-you knows when to return.
          </p>
          {filter === 'all' && (
            <button onClick={() => setShowCreate(true)} style={btnPrimary}><Plus size={13} /> Create your first</button>
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {filtered.map(rv => (
            <motion.div key={rv.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
              className="revisit-card"
              style={{
                display: 'grid', gridTemplateColumns: '1fr auto', gap: 12,
                padding: '14px 16px', background: 'var(--surface)',
                border: `1px solid ${rv._overdue ? 'rgba(239,68,68,0.4)' : 'var(--border)'}`,
                borderRadius: 12,
              }}>
              <div className="revisit-card-body" style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                  <Bell size={13} color={rv._overdue ? '#ef4444' : '#f59e0b'} />
                  <strong className="revisit-card-title" style={{ fontSize: 14, color: 'var(--text-1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 460 }}>{rv.title}</strong>
                  <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-2)' }}>
                    {FREQ_LABEL[rv.frequency] || rv.frequency}
                    {rv.frequency === 'custom_days' && rv.interval_days ? ` · ${rv.interval_days}d` : ''}
                  </span>
                  {rv.status === 'paused' && <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: 'rgba(148,163,184,0.18)', color: '#64748b' }}>Paused</span>}
                  {rv.status === 'completed' && <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: 'rgba(16,185,129,0.18)', color: '#059669' }}>Completed</span>}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, fontSize: 11.5, color: 'var(--text-3)' }}>
                  <span style={{ color: rv._overdue ? '#ef4444' : 'var(--text-3)', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <CalIcon size={11} /> {fmtDue(rv as any)}
                  </span>
                  {rv.visit_count > 0 && <span>· Visited {rv.visit_count}×</span>}
                  {rv.url && <span>· {rv.url.replace(/^https?:\/\//, '').slice(0, 50)}</span>}
                  {rv.memory_id && !rv.url && <span>· Linked memory</span>}
                </div>
                {rv.notes && (
                  <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--text-2)', lineHeight: 1.5 }}>{rv.notes}</p>
                )}
              </div>
              <div className="revisit-card-actions" style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                {rv.status !== 'completed' && (
                  <button onClick={() => goTo(rv)} className="revisit-card-primary-action" style={btnAccent} title="Open + count visit">
                    {rv.url ? <ExternalLink size={11} /> : <ChevronRight size={11} />} Go to
                  </button>
                )}
                {rv.status === 'active' && <button onClick={() => markDone(rv)} style={iconBtn} title="Mark done"><Check size={13} /></button>}
                {rv.status === 'active' && <button onClick={() => snooze(rv, 1)} style={iconBtn} title="Snooze 1 day"><RotateCw size={13} /></button>}
                {rv.status === 'active' && <button onClick={() => snooze(rv, 7)} style={iconBtn} title="Snooze 1 week" >+7d</button>}
                {rv.status !== 'completed' && (
                  <button onClick={() => togglePause(rv)} style={iconBtn} title={rv.status === 'paused' ? 'Resume' : 'Pause'}>
                    {rv.status === 'paused' ? <PlayCircle size={13} /> : <PauseCircle size={13} />}
                  </button>
                )}
                <button onClick={() => remove(rv)} style={{ ...iconBtn, color: '#ef4444' }} title="Delete"><Trash2 size={13} /></button>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
};

const btnPrimary: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px',
  borderRadius: 9, border: 'none', cursor: 'pointer',
  background: 'linear-gradient(135deg,#f59e0b,#ef4444)', color: '#fff',
  fontSize: 12.5, fontWeight: 700, fontFamily: 'inherit',
};

const btnAccent: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 11px',
  borderRadius: 8, border: 'none', cursor: 'pointer',
  background: 'linear-gradient(135deg,#a78bfa,#7c3aed)', color: '#fff',
  fontSize: 11.5, fontWeight: 700, fontFamily: 'inherit',
};

const iconBtn: React.CSSProperties = {
  width: 30, height: 28, padding: 0, borderRadius: 7,
  border: '1px solid var(--border)', background: 'var(--surface-2)',
  color: 'var(--text-2)', cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  fontSize: 11, fontWeight: 700, fontFamily: 'inherit',
};

export default RevisitsPage;
