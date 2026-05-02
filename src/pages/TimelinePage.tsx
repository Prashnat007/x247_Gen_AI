import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { card as cardBase } from '../lib/ui';
import {
  GitBranch, Search, Plus, Loader2, Globe, StickyNote, FileText, Brain, Youtube,
  Sparkles, CheckSquare, Lightbulb, Calendar, Folder, ArrowRight, Layers, ExternalLink,
} from 'lucide-react';
import { motion } from 'motion/react';
import type { Memory } from '../lib/types';

const SRC_CLR: Record<string, string> = { youtube: '#ef4444', web: '#00d4ff', pdf: '#f59e0b', note: '#10b981' };
const SRC_ICON: Record<string, any> = { youtube: Youtube, web: Globe, pdf: FileText, note: StickyNote };

const FILTERS = [
  { id: 'all',     label: 'All',     color: '#f472b6' },
  { id: 'youtube', label: 'YouTube', color: '#ef4444' },
  { id: 'web',     label: 'Web',     color: '#00d4ff' },
  { id: 'pdf',     label: 'PDF',     color: '#f59e0b' },
  { id: 'note',    label: 'Notes',   color: '#10b981' },
];

const card: React.CSSProperties = { ...cardBase, transition: 'all 0.18s' };

// ─── Memory-only timeline view (existing behaviour) ────────────────────────────
const MemoryTimelineView = () => {
  const navigate = useNavigate();
  const [memories, setMemories] = useState<Memory[]>([]);
  const [filter, setFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/memories?limit=50')
      .then(r => r.ok ? r.json() : [])
      .then(m => { setMemories(m); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const filtered = memories.filter(m =>
    (filter === 'all' || m.source_type === filter) &&
    (search === '' ||
      m.title.toLowerCase().includes(search.toLowerCase()) ||
      m.summary.toLowerCase().includes(search.toLowerCase()) ||
      m.domain.toLowerCase().includes(search.toLowerCase()))
  );

  const grouped: Record<string, Memory[]> = {};
  filtered.forEach(m => {
    const d = new Date(m.created_at);
    const key = isNaN(d.getTime())
      ? 'Unknown Date'
      : d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    (grouped[key] = grouped[key] || []).push(m);
  });

  return (
    <>
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
        style={{ ...card, padding: '12px 16px', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 180 }}>
          <Search size={13} color="var(--text-3)" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search timeline…"
            style={{ width: '100%', paddingLeft: 32, paddingRight: 12, paddingTop: 8, paddingBottom: 8, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-1)', fontSize: 13, outline: 'none', fontFamily: 'inherit' }} />
        </div>
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
          {FILTERS.map(f => (
            <button key={f.id} onClick={() => setFilter(f.id)}
              style={{ padding: '5px 12px', borderRadius: 20, border: `1px solid ${filter === f.id ? f.color + '55' : 'var(--border)'}`, background: filter === f.id ? `${f.color}18` : 'transparent', color: filter === f.id ? f.color : 'var(--text-3)', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.15s' }}>
              {f.label}
            </button>
          ))}
        </div>
      </motion.div>

      {loading ? (
        <div className="loading-center">
          <Loader2 size={28} color="#f472b6" style={{ animation: 'spin 1s linear infinite' }} />
          <p style={{ color: 'var(--text-3)', fontSize: 13, margin: 0 }}>Loading timeline…</p>
        </div>
      ) : filtered.length === 0 ? (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="empty-state" style={card}>
          <div style={{ width: 56, height: 56, borderRadius: 14, background: 'rgba(244,114,182,0.1)', border: '1px solid rgba(244,114,182,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <GitBranch size={24} color="#f472b6" />
          </div>
          <div>
            <p style={{ color: 'var(--text-1)', fontSize: 15, fontWeight: 600, margin: '0 0 4px' }}>No memories found</p>
            <p style={{ color: 'var(--text-3)', fontSize: 13, margin: 0 }}>
              {search || filter !== 'all' ? 'Try adjusting your filters' : 'Start capturing to build your timeline'}
            </p>
          </div>
          <button onClick={() => navigate('/capture')}
            style={{ padding: '8px 20px', background: 'linear-gradient(135deg,#f472b6,#c026a1)', border: 'none', borderRadius: 9, color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
            Capture Knowledge →
          </button>
        </motion.div>
      ) : (
        <div style={{ position: 'relative' }}>
          <div style={{ position: 'absolute', left: 100, top: 0, bottom: 0, width: 1, background: 'linear-gradient(180deg,rgba(244,114,182,0.4) 0%,rgba(139,92,246,0.15) 100%)', pointerEvents: 'none' }} />
          {Object.entries(grouped).map(([date, items], gi) => (
            <motion.div key={date} initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: gi * 0.04 }}
              style={{ display: 'flex', gap: 0, marginBottom: 28 }}>
              <div style={{ width: 100, flexShrink: 0, paddingRight: 16, paddingTop: 10, textAlign: 'right' }}>
                <span style={{ color: 'var(--text-2)', fontSize: 11, lineHeight: 1.4, display: 'block' }}>{date.split(',')[0]}</span>
                <span style={{ color: 'var(--text-3)', fontSize: 10 }}>{date.split(',').slice(1).join(',').trim()}</span>
              </div>
              <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 12, zIndex: 1 }}>
                <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#f472b6', boxShadow: '0 0 10px rgba(244,114,182,0.6)', flexShrink: 0 }} />
              </div>
              <div style={{ flex: 1, paddingLeft: 16, display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
                {items.map(m => {
                  const Icon = SRC_ICON[m.source_type] ?? Brain;
                  const clr = SRC_CLR[m.source_type] ?? '#6366f1';
                  return (
                    <motion.div key={m.id} whileHover={{ x: 2 }}
                      onClick={() => navigate(`/memory/${m.id}`)}
                      style={{ ...card, padding: '12px 16px', display: 'flex', gap: 12, alignItems: 'flex-start', cursor: 'pointer' }}
                      onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.borderColor = `${clr}35`; (e.currentTarget as HTMLDivElement).style.boxShadow = `0 4px 16px ${clr}10`; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border)'; (e.currentTarget as HTMLDivElement).style.boxShadow = 'none'; }}>
                      <div style={{ width: 32, height: 32, borderRadius: 9, background: `${clr}15`, border: `1px solid ${clr}28`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <Icon size={14} color={clr} />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ color: 'var(--text-1)', fontSize: 13, fontWeight: 600, marginBottom: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.title}</div>
                        <div style={{ color: 'var(--text-3)', fontSize: 11, lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{m.summary}</div>
                        <div style={{ display: 'flex', gap: 5, marginTop: 7, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 9.5, color: clr, background: `${clr}15`, padding: '2px 8px', borderRadius: 20, fontWeight: 600, textTransform: 'uppercase' }}>{m.source_type}</span>
                          <span style={{ fontSize: 9.5, color: 'var(--text-3)', background: 'var(--surface-2)', padding: '2px 8px', borderRadius: 20, border: '1px solid var(--border)' }}>{m.domain}</span>
                          {m.tags.slice(0, 2).map(t => (
                            <span key={t} style={{ fontSize: 9.5, color: 'var(--text-3)', background: 'var(--surface-2)', padding: '2px 8px', borderRadius: 20, border: '1px solid var(--border)' }}>#{t}</span>
                          ))}
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </>
  );
};

// ─── Workspace folder timeline view (NEW) ──────────────────────────────────────
type EvType = 'capture' | 'insight' | 'task' | 'memory' | 'plan';

interface TimelineEvent {
  id: string;
  type: EvType;
  timestamp: string;
  title: string;
  summary?: string;
  source_type?: string;
  source_id?: string;
  source_url?: string;
  status?: string;
  priority?: string;
  due_date?: string;
  insight_type?: string;
  source?: string;
  tags?: string[];
  folder_id?: string;
  linked_from?: { event_id: string; type: string; label: string; action: string };
  linked_to?: Array<{ event_id: string; type: string; label: string; action: string; applied_at: string }>;
  deeplink: { route: string; params: Record<string, string> };
}

interface TimelineResponse {
  ok: boolean;
  scope: { project_id: string; project_name: string; folder_id?: string | null; folder_name?: string };
  events: TimelineEvent[];
  counts: { capture: number; insight: number; task: number; memory: number; plan: number; total: number };
  edges: number;
}

interface WsProjectStub {
  id: string;
  name: string;
  folders?: Array<{ id: string; name: string }>;
}

const EV_META: Record<EvType, { color: string; bg: string; icon: any; label: string }> = {
  capture: { color: '#00d4ff', bg: 'rgba(0,212,255,0.12)',  icon: Layers,      label: 'Capture' },
  insight: { color: '#a78bfa', bg: 'rgba(167,139,250,0.14)', icon: Lightbulb,   label: 'Insight' },
  task:    { color: '#10b981', bg: 'rgba(16,185,129,0.12)',  icon: CheckSquare, label: 'Task' },
  memory:  { color: '#f472b6', bg: 'rgba(244,114,182,0.12)', icon: Brain,       label: 'Memory' },
  plan:    { color: '#f59e0b', bg: 'rgba(245,158,11,0.12)',  icon: Calendar,    label: 'Plan' },
};

const WorkspaceTimelineView = () => {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const initialPid = params.get('project_id') || '';
  const initialFid = params.get('folder_id');

  const [projects, setProjects] = useState<WsProjectStub[]>([]);
  const [pid, setPid] = useState<string>(initialPid);
  const [fid, setFid] = useState<string | null>(initialFid);  // null = whole project, '' = root, 'f_x' = folder
  const [filter, setFilter] = useState<'all' | EvType>('all');
  const [data, setData] = useState<TimelineResponse | null>(null);
  const [loading, setLoading] = useState(false);

  // 1. Load project list once
  useEffect(() => {
    fetch('/workspace/projects')
      .then(r => r.ok ? r.json() : { projects: [] })
      .then(d => {
        const list: WsProjectStub[] = d.projects || [];
        setProjects(list);
        if (!pid && list.length > 0) setPid(list[0].id);
      })
      .catch(() => {});
  }, []);

  // 2. When project changes, hydrate folders (project list strips them)
  const project = projects.find(p => p.id === pid);
  useEffect(() => {
    if (!pid) return;
    const have = projects.find(p => p.id === pid);
    if (have && have.folders) return;
    fetch(`/workspace/projects/${pid}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setProjects(prev => prev.map(p => p.id === pid ? { ...p, folders: d.folders || [] } : p)); })
      .catch(() => {});
  }, [pid]);

  // 3. Fetch timeline whenever scope changes
  useEffect(() => {
    if (!pid) { setData(null); return; }
    setLoading(true);
    const qs = fid === null ? '' : `?folder_id=${encodeURIComponent(fid)}`;
    fetch(`/workspace/projects/${pid}/timeline${qs}`)
      .then(r => r.ok ? r.json() : null)
      .then((d: TimelineResponse | null) => { setData(d); setLoading(false); })
      .catch(() => { setData(null); setLoading(false); });
    // sync URL so the view is shareable / refreshable
    const np = new URLSearchParams();
    np.set('mode', 'workspace');
    np.set('project_id', pid);
    if (fid !== null) np.set('folder_id', fid);
    setParams(np, { replace: true });
  }, [pid, fid]);

  const events = useMemo(() => {
    if (!data) return [];
    return filter === 'all' ? data.events : data.events.filter(e => e.type === filter);
  }, [data, filter]);

  // Date grouping
  const grouped: Record<string, TimelineEvent[]> = {};
  events.forEach(e => {
    const d = e.timestamp ? new Date(e.timestamp) : null;
    const key = (!d || isNaN(d.getTime())) ? 'Unknown Date'
      : d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    (grouped[key] = grouped[key] || []).push(e);
  });

  const onJump = (ev: TimelineEvent) => {
    const route = ev.deeplink?.route;
    if (!route) return;
    const qp = new URLSearchParams(ev.deeplink?.params || {});
    navigate(qp.toString() ? `${route}?${qp.toString()}` : route);
  };

  const folderOptions: Array<{ id: string | null | ''; label: string }> = [
    { id: null, label: 'Whole project' },
    { id: '',   label: 'Root (un-foldered)' },
    ...((project?.folders || []).map(f => ({ id: f.id, label: f.name }))),
  ];

  return (
    <>
      {/* Project + folder pickers */}
      <div style={{ ...card, padding: '12px 16px', marginBottom: 14, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-3)', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>
          <Folder size={12} /> Project
        </div>
        <select value={pid} onChange={e => { setPid(e.target.value); setFid(null); }}
          style={{ padding: '6px 10px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-1)', fontSize: 12, fontFamily: 'inherit', minWidth: 160 }}>
          <option value="" disabled>Select…</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>

        <div style={{ width: 1, height: 22, background: 'var(--border)' }} />

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-3)', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>
          Scope
        </div>
        <select value={fid === null ? '__none__' : (fid || '__root__')}
          onChange={e => {
            const v = e.target.value;
            setFid(v === '__none__' ? null : v === '__root__' ? '' : v);
          }}
          style={{ padding: '6px 10px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-1)', fontSize: 12, fontFamily: 'inherit', minWidth: 160 }}>
          {folderOptions.map(opt => (
            <option key={opt.id ?? '__none__'}
              value={opt.id === null ? '__none__' : opt.id === '' ? '__root__' : opt.id}>
              {opt.label}
            </option>
          ))}
        </select>

        <div style={{ flex: 1 }} />

        {data && (
          <div style={{ display: 'flex', gap: 6, fontSize: 10.5, color: 'var(--text-3)' }}>
            <span><strong style={{ color: '#00d4ff' }}>{data.counts.capture}</strong> captures</span>
            <span>·</span>
            <span><strong style={{ color: '#a78bfa' }}>{data.counts.insight}</strong> insights</span>
            <span>·</span>
            <span><strong style={{ color: '#10b981' }}>{data.counts.task}</strong> tasks</span>
            <span>·</span>
            <span><strong style={{ color: '#f472b6' }}>{data.counts.memory}</strong> memories</span>
            {data.counts.plan > 0 && <><span>·</span><span><strong style={{ color: '#f59e0b' }}>{data.counts.plan}</strong> plans</span></>}
            <span>·</span>
            <span><strong style={{ color: 'var(--text-2)' }}>{data.edges}</strong> connections</span>
          </div>
        )}
      </div>

      {/* Type filter pills */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 18, flexWrap: 'wrap' }}>
        <button onClick={() => setFilter('all')}
          style={{ padding: '5px 12px', borderRadius: 20, border: `1px solid ${filter === 'all' ? '#f472b655' : 'var(--border)'}`, background: filter === 'all' ? 'rgba(244,114,182,0.12)' : 'transparent', color: filter === 'all' ? '#f472b6' : 'var(--text-3)', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
          All
        </button>
        {(Object.keys(EV_META) as EvType[]).map(t => {
          const m = EV_META[t];
          const active = filter === t;
          const count = data?.counts[t] || 0;
          return (
            <button key={t} onClick={() => setFilter(t)}
              style={{ padding: '5px 12px', borderRadius: 20, border: `1px solid ${active ? m.color + '55' : 'var(--border)'}`, background: active ? m.bg : 'transparent', color: active ? m.color : 'var(--text-3)', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              {m.label} <span style={{ opacity: 0.7 }}>{count}</span>
            </button>
          );
        })}
      </div>

      {/* Body */}
      {!pid ? (
        <div style={{ ...card, padding: 32, textAlign: 'center', color: 'var(--text-3)', fontSize: 13 }}>
          Pick a workspace project above to see its timeline.
        </div>
      ) : loading ? (
        <div className="loading-center">
          <Loader2 size={28} color="#a78bfa" style={{ animation: 'spin 1s linear infinite' }} />
          <p style={{ color: 'var(--text-3)', fontSize: 13, margin: 0 }}>Loading timeline…</p>
        </div>
      ) : !data || data.events.length === 0 ? (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="empty-state" style={card}>
          <div style={{ width: 56, height: 56, borderRadius: 14, background: 'rgba(167,139,250,0.1)', border: '1px solid rgba(167,139,250,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Sparkles size={24} color="#a78bfa" />
          </div>
          <div>
            <p style={{ color: 'var(--text-1)', fontSize: 15, fontWeight: 600, margin: '0 0 4px' }}>No events yet in this scope</p>
            <p style={{ color: 'var(--text-3)', fontSize: 13, margin: 0 }}>
              Capture items into this folder, extract insights, and apply actions to populate the timeline.
            </p>
          </div>
          <button onClick={() => navigate(`/workspace?project=${pid}`)}
            style={{ padding: '8px 20px', background: 'linear-gradient(135deg,#a78bfa,#7c3aed)', border: 'none', borderRadius: 9, color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
            Open Workspace →
          </button>
        </motion.div>
      ) : (
        <div style={{ position: 'relative' }}>
          <div style={{ position: 'absolute', left: 100, top: 0, bottom: 0, width: 1, background: 'linear-gradient(180deg,rgba(167,139,250,0.4) 0%,rgba(0,212,255,0.15) 100%)', pointerEvents: 'none' }} />
          {Object.entries(grouped).map(([date, items], gi) => (
            <motion.div key={date} initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: gi * 0.04 }}
              style={{ display: 'flex', gap: 0, marginBottom: 28 }}>
              <div style={{ width: 100, flexShrink: 0, paddingRight: 16, paddingTop: 10, textAlign: 'right' }}>
                <span style={{ color: 'var(--text-2)', fontSize: 11, lineHeight: 1.4, display: 'block' }}>{date.split(',')[0]}</span>
                <span style={{ color: 'var(--text-3)', fontSize: 10 }}>{date.split(',').slice(1).join(',').trim()}</span>
              </div>
              <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 12, zIndex: 1 }}>
                <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#a78bfa', boxShadow: '0 0 10px rgba(167,139,250,0.6)', flexShrink: 0 }} />
              </div>
              <div style={{ flex: 1, paddingLeft: 16, display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
                {items.map(ev => {
                  const m = EV_META[ev.type];
                  const Icon = m.icon;
                  return (
                    <motion.div key={ev.id} whileHover={{ x: 2 }}
                      onClick={() => onJump(ev)}
                      title="Open source"
                      style={{ ...card, padding: '12px 16px', display: 'flex', gap: 12, alignItems: 'flex-start', cursor: 'pointer' }}
                      onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.borderColor = `${m.color}40`; (e.currentTarget as HTMLDivElement).style.boxShadow = `0 4px 16px ${m.color}10`; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border)'; (e.currentTarget as HTMLDivElement).style.boxShadow = 'none'; }}>
                      <div style={{ width: 32, height: 32, borderRadius: 9, background: m.bg, border: `1px solid ${m.color}28`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <Icon size={14} color={m.color} />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                          <span style={{ fontSize: 9.5, color: m.color, background: m.bg, padding: '2px 8px', borderRadius: 20, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>{m.label}</span>
                          {ev.priority && (
                            <span style={{ fontSize: 9.5, color: ev.priority === 'high' ? '#ef4444' : ev.priority === 'low' ? 'var(--text-3)' : '#f59e0b', background: ev.priority === 'high' ? 'rgba(239,68,68,0.1)' : ev.priority === 'low' ? 'var(--surface-2)' : 'rgba(245,158,11,0.1)', padding: '2px 8px', borderRadius: 20, fontWeight: 600, textTransform: 'uppercase' }}>{ev.priority}</span>
                          )}
                          {ev.status && (
                            <span style={{ fontSize: 9.5, color: ev.status === 'completed' ? '#10b981' : 'var(--text-3)', background: ev.status === 'completed' ? 'rgba(16,185,129,0.1)' : 'var(--surface-2)', padding: '2px 8px', borderRadius: 20, fontWeight: 600 }}>{ev.status}</span>
                          )}
                          {ev.due_date && (
                            <span style={{ fontSize: 9.5, color: 'var(--text-3)', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                              <Calendar size={9} /> due {ev.due_date}
                            </span>
                          )}
                          <span style={{ flex: 1 }} />
                          <ExternalLink size={11} color="var(--text-3)" />
                        </div>
                        <div style={{ color: 'var(--text-1)', fontSize: 13, fontWeight: 600, marginBottom: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ev.title}</div>
                        {ev.summary && (
                          <div style={{ color: 'var(--text-3)', fontSize: 11, lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', marginBottom: 6 }}>{ev.summary}</div>
                        )}

                        {/* Edges */}
                        {ev.linked_from && (
                          <button onClick={(e) => { e.stopPropagation(); const tgt = data?.events.find(x => x.id === ev.linked_from!.event_id); if (tgt) document.getElementById(`ev-${tgt.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }}
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, color: '#a78bfa', background: 'rgba(167,139,250,0.08)', border: '1px dashed rgba(167,139,250,0.4)', borderRadius: 6, padding: '3px 8px', cursor: 'pointer', fontFamily: 'inherit', marginRight: 4 }}>
                            <ArrowRight size={10} style={{ transform: 'rotate(180deg)' }} /> from {ev.linked_from.label}
                          </button>
                        )}
                        {(ev.linked_to || []).map(lt => (
                          <button key={lt.event_id} onClick={(e) => { e.stopPropagation(); const tgt = data?.events.find(x => x.id === lt.event_id); if (tgt) document.getElementById(`ev-${tgt.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }}
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, color: EV_META[lt.type as EvType]?.color || '#10b981', background: EV_META[lt.type as EvType]?.bg || 'rgba(16,185,129,0.08)', border: `1px dashed ${EV_META[lt.type as EvType]?.color || '#10b981'}55`, borderRadius: 6, padding: '3px 8px', cursor: 'pointer', fontFamily: 'inherit', marginRight: 4 }}>
                            <ArrowRight size={10} /> {lt.action} → {lt.label}
                          </button>
                        ))}
                      </div>
                      <span id={`ev-${ev.id}`} style={{ position: 'absolute' }} />
                    </motion.div>
                  );
                })}
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </>
  );
};

// ─── Top-level page with tab switcher ──────────────────────────────────────────
interface TimelinePageProps { embedded?: boolean }
const TimelinePage: React.FC<TimelinePageProps> = ({ embedded = false }) => {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const initialMode = params.get('mode') === 'workspace' || !!params.get('project_id') ? 'workspace' : 'memories';
  const [mode, setMode] = useState<'memories' | 'workspace'>(initialMode);

  return (
    <div style={{ color: 'var(--text-1)' }}>
      {!embedded && (
        <div className="page-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 38, height: 38, borderRadius: 11, background: 'rgba(244,114,182,0.15)', border: '1px solid rgba(244,114,182,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <GitBranch size={17} color="#f472b6" />
            </div>
            <div>
              <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0, letterSpacing: '-0.4px' }}>Timeline</h1>
              <p style={{ color: 'var(--text-3)', fontSize: 12, margin: '2px 0 0' }}>
                {mode === 'memories' ? 'Chronological view of your captured knowledge' : 'How your work flows: capture → insight → task → memory'}
              </p>
            </div>
          </div>
          <button onClick={() => navigate(mode === 'memories' ? '/capture' : '/workspace')}
            style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '9px 16px', background: 'linear-gradient(135deg,#f472b6,#c026a1)', border: 'none', borderRadius: 10, color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', boxShadow: '0 4px 14px rgba(244,114,182,0.35)', fontFamily: 'inherit', whiteSpace: 'nowrap', flexShrink: 0 }}>
            <Plus size={14} /> {mode === 'memories' ? 'Add Memory' : 'Open Workspace'}
          </button>
        </div>
      )}

      {/* Mode switcher */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
        <div style={{ display: 'inline-flex', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 3 }}>
          {([
            { id: 'memories', label: 'Memories', color: '#f472b6' },
            { id: 'workspace', label: 'Workspace flow', color: '#a78bfa' },
          ] as const).map(t => {
            const active = mode === t.id;
            return (
              <button key={t.id} onClick={() => setMode(t.id)}
                style={{ padding: '6px 14px', borderRadius: 8, border: 'none', background: active ? t.color : 'transparent', color: active ? '#fff' : 'var(--text-2)', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.15s' }}>
                {t.label}
              </button>
            );
          })}
        </div>
        {embedded && (
          <button onClick={() => navigate(mode === 'memories' ? '/capture' : '/workspace')}
            style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '8px 14px', background: 'linear-gradient(135deg,#f472b6,#c026a1)', border: 'none', borderRadius: 9, color: '#fff', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
            <Plus size={13} /> {mode === 'memories' ? 'Add Memory' : 'Open Workspace'}
          </button>
        )}
      </div>

      {mode === 'memories' ? <MemoryTimelineView /> : <WorkspaceTimelineView />}
    </div>
  );
};

export default TimelinePage;
