import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Compass, Sparkles, Loader2, Search, FileText, Youtube, ExternalLink, BookmarkPlus, Globe, X, Eye, Clock, Calendar as CalendarIcon, NotebookPen, Save, ListChecks, Filter, ArrowUpDown, Zap, FolderPlus, ChevronDown, FolderTree, Brain, ArrowRight, Lightbulb, HelpCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { getYouTubeId } from '../lib/utils';
import AgentPipeline, { AgentStep } from '../components/AgentPipeline';

interface WsProjectLite { id: string; name: string; color: string }

interface DiscoverItem {
  title: string;
  url: string;
  type: 'article' | 'video';
  source: string;
  summary: string;
  domain?: string;
  youtube_id?: string;
  thumbnail?: string;
  channel_title?: string;
  channel_id?: string;
  view_count?: number;
  view_count_display?: string;
  duration_seconds?: number;
  duration_display?: string;
  published_at?: string;
  age_display?: string;
  kind_label?: string;
  like_count?: number;
}

interface DiscoverResponse {
  items: DiscoverItem[];
  count: number;
  video_count?: number;
  article_count?: number;
  youtube_api_used?: boolean;
}

const SUGGESTED_TOPICS = [
  'Transformer architecture', 'RAG pipelines', 'System design',
  'Distributed systems', 'Algorithms', 'Productivity habits',
];

type SortKey = 'relevance' | 'views' | 'recent' | 'shortest';

const DiscoverPage: React.FC = () => {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [topic, setTopic] = useState(params.get('topic') || '');
  const [items, setItems] = useState<DiscoverItem[]>([]);
  const [meta, setMeta] = useState<{ youtube_api_used: boolean; video_count: number; article_count: number }>({ youtube_api_used: false, video_count: 0, article_count: 0 });
  const [isLoading, setIsLoading] = useState(false);
  const [filter, setFilter] = useState<'all' | 'video' | 'article'>('all');
  const [sortKey, setSortKey] = useState<SortKey>('relevance');
  const [savedUrls, setSavedUrls] = useState<Set<string>>(new Set());
  const [playingYt, setPlayingYt] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');
  const [notesFor, setNotesFor] = useState<DiscoverItem | null>(null);
  const [notesText, setNotesText] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);
  const [pipeline, setPipeline] = useState<AgentStep[] | null>(null);
  const [pipelineMs, setPipelineMs] = useState<number | undefined>(undefined);
  const [wsProjects, setWsProjects] = useState<WsProjectLite[]>([]);
  const [targetWs, setTargetWs] = useState<string>('');
  const [showWsPicker, setShowWsPicker] = useState(false);
  const [savingBulk, setSavingBulk] = useState(false);
  const [savedToWs, setSavedToWs] = useState<Set<string>>(new Set());
  const [digest, setDigest] = useState<{
    tldr: string;
    themes: { title: string; why: string }[];
    must_read: { title: string; url: string; reason: string }[];
    watch_first?: string;
    contrarian?: string;
    next_questions: string[];
    total: number;
  } | null>(null);
  const [digestLoading, setDigestLoading] = useState(false);

  const refreshWsProjects = useCallback(async () => {
    try {
      const r = await fetch('/workspace/projects');
      if (!r.ok) return;
      const d = await r.json();
      setWsProjects((d.projects || []).map((p: any) => ({ id: p.id, name: p.name, color: p.color })));
    } catch {}
  }, []);

  useEffect(() => { refreshWsProjects(); }, [refreshWsProjects]);

  const runDiscover = useCallback(async (q: string) => {
    if (!q.trim()) return;
    setIsLoading(true);
    setError('');
    setItems([]);
    setParams({ topic: q });
    setPipeline([
      { name: 'YouTubeAgent', label: 'YouTube Search', status: 'running', out: 'Querying Data API v3…' },
      { name: 'ArticleAgent', label: 'Article Fetcher', status: 'running', out: 'Curating articles…' },
      { name: 'RankerAgent', label: 'Ranker', status: 'queued', out: 'Will rank by signal' },
    ]);
    setPipelineMs(undefined);
    const t0 = performance.now();
    const stage1 = setTimeout(() => setPipeline(prev => prev ? [{ ...prev[0], status: 'done' }, { ...prev[1], status: 'done' }, { ...prev[2], status: 'running' }] : null), 900);
    try {
      const res = await fetch('/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic: q.trim() })
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        setError(e.error || e.detail || 'Failed to load resources');
        setPipeline(prev => prev ? prev.map(s => ({ ...s, status: 'error' as const })) : null);
        return;
      }
      const data: DiscoverResponse = await res.json();
      setItems(data.items || []);
      setMeta({
        youtube_api_used: !!data.youtube_api_used,
        video_count: data.video_count || 0,
        article_count: data.article_count || 0,
      });
      const totalMs = Math.round(performance.now() - t0);
      setPipelineMs(totalMs);
      const vCount = (data.items || []).filter(i => i.type === 'video').length;
      const aCount = (data.items || []).filter(i => i.type === 'article').length;
      setPipeline([
        { name: 'YouTubeAgent', label: 'YouTube Search', status: 'done', ms: Math.round(totalMs * 0.55), out: `${vCount} videos · ${data.youtube_api_used ? 'live API' : 'fallback'}` },
        { name: 'ArticleAgent', label: 'Article Fetcher', status: 'done', ms: Math.round(totalMs * 0.30), out: `${aCount} articles` },
        { name: 'RankerAgent', label: 'Ranker', status: 'done', ms: Math.round(totalMs * 0.10), out: `${(data.items || []).length} ranked` },
      ]);
    } catch {
      setError('Network error — please try again');
      setPipeline(prev => prev ? prev.map(s => ({ ...s, status: 'error' as const })) : null);
    } finally {
      clearTimeout(stage1);
      setIsLoading(false);
    }
  }, [setParams]);

  const ensureWsTarget = async (): Promise<string | null> => {
    if (targetWs) return targetWs;
    // No project chosen — create one named after the topic
    const name = topic.trim() || 'Discover collection';
    const r = await fetch('/workspace/projects', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, description: `Saved from Discover: ${topic}`, goal_type: 'general' }),
    });
    if (!r.ok) {
      window.dispatchEvent(new CustomEvent('recall-toast', { detail: { msg: 'Could not create workspace project', type: 'error' } }));
      return null;
    }
    const proj = await r.json();
    setWsProjects(prev => [{ id: proj.id, name: proj.name, color: proj.color }, ...prev]);
    setTargetWs(proj.id);
    return proj.id;
  };

  const saveItemToWorkspace = async (item: DiscoverItem) => {
    const pid = await ensureWsTarget();
    if (!pid) return;
    const isVideo = item.type === 'video' || !!item.youtube_id;
    const r = await fetch(`/workspace/projects/${pid}/items`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: [{
          kind: 'resource',
          ref_id: item.youtube_id || item.url,
          title: item.title,
          url: item.url,
          meta: {
            type: isVideo ? 'video' : 'article',
            thumbnail: item.thumbnail,
            youtube_id: item.youtube_id,
            channel_title: item.channel_title,
            duration_display: item.duration_display,
            domain: item.domain || item.source,
          },
        }],
      }),
    });
    if (r.ok) {
      setSavedToWs(prev => new Set(prev).add(item.url));
      const proj = wsProjects.find(p => p.id === pid);
      window.dispatchEvent(new CustomEvent('recall-toast', { detail: { msg: `Added to ${proj?.name || 'workspace'}`, type: 'success' } }));
    }
  };

  const saveAllVisibleToWorkspace = async () => {
    const visible = items.filter(it => filter === 'all' || it.type === filter);
    if (!visible.length) return;
    setSavingBulk(true);
    try {
      const pid = await ensureWsTarget();
      if (!pid) return;
      const payload = visible.map(item => {
        const isVideo = item.type === 'video' || !!item.youtube_id;
        return {
          kind: 'resource',
          ref_id: item.youtube_id || item.url,
          title: item.title,
          url: item.url,
          meta: {
            type: isVideo ? 'video' : 'article',
            thumbnail: item.thumbnail,
            youtube_id: item.youtube_id,
            channel_title: item.channel_title,
            duration_display: item.duration_display,
            domain: item.domain || item.source,
          },
        };
      });
      const r = await fetch(`/workspace/projects/${pid}/items`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: payload }),
      });
      if (r.ok) {
        setSavedToWs(prev => { const n = new Set(prev); visible.forEach(v => n.add(v.url)); return n; });
        const proj = wsProjects.find(p => p.id === pid) || { name: topic.trim() };
        window.dispatchEvent(new CustomEvent('recall-toast', { detail: { msg: `${visible.length} items saved to ${proj.name}`, type: 'success' } }));
      }
    } finally {
      setSavingBulk(false);
    }
  };

  useEffect(() => {
    const initial = params.get('topic');
    if (initial) runDiscover(initial);
  }, []); // eslint-disable-line

  const handleSave = async (item: DiscoverItem) => {
    if (savedUrls.has(item.url)) return;
    try {
      const isVideo = item.type === 'video' || !!item.youtube_id;
      const res = await fetch('/memories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_type: isVideo ? 'youtube' : 'web',
          source_url: item.url,
          title: item.title,
          summary: item.summary,
          domain: item.source || item.domain || 'Other',
          tags: [topic.toLowerCase().split(/\s+/)[0]].filter(Boolean),
          key_points: [],
        })
      });
      if (res.ok) {
        setSavedUrls(prev => new Set(prev).add(item.url));
        window.dispatchEvent(new CustomEvent('recall-toast', { detail: { msg: `Saved "${item.title.slice(0, 40)}…" to Vault`, type: 'success' } }));
      }
    } catch {
      window.dispatchEvent(new CustomEvent('recall-toast', { detail: { msg: 'Save failed', type: 'error' } }));
    }
  };

  const openNotes = (item: DiscoverItem) => {
    setNotesFor(item);
    setNotesText(`# Notes on: ${item.title}\n\n## Key takeaways\n- \n\n## Questions\n- \n\n## Action items\n- `);
  };

  const saveNotes = async () => {
    if (!notesFor || !notesText.trim()) return;
    setSavingNotes(true);
    try {
      const isVideo = notesFor.type === 'video' || !!notesFor.youtube_id;
      const res = await fetch('/memories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_type: isVideo ? 'youtube' : 'web',
          source_url: notesFor.url,
          title: `Notes — ${notesFor.title}`,
          summary: notesText.trim().slice(0, 500),
          notes: notesText.trim(),
          domain: notesFor.source || notesFor.domain || 'Notes',
          tags: ['notes', topic.toLowerCase().split(/\s+/)[0]].filter(Boolean),
          key_points: [],
        })
      });
      if (res.ok) {
        setSavedUrls(prev => new Set(prev).add(notesFor.url));
        window.dispatchEvent(new CustomEvent('recall-toast', { detail: { msg: 'Notes saved to Vault', type: 'success' } }));
        setNotesFor(null);
        setNotesText('');
      } else {
        window.dispatchEvent(new CustomEvent('recall-toast', { detail: { msg: 'Notes save failed', type: 'error' } }));
      }
    } catch {
      window.dispatchEvent(new CustomEvent('recall-toast', { detail: { msg: 'Notes save failed', type: 'error' } }));
    } finally {
      setSavingNotes(false);
    }
  };

  const generatePlan = (item: DiscoverItem) => {
    navigate(`/plan?topic=${encodeURIComponent(item.title)}`);
  };

  const runDigest = async () => {
    const visible = items.filter(it => filter === 'all' || it.type === filter).slice(0, 10);
    if (!topic.trim() || visible.length === 0) return;
    setDigestLoading(true);
    setDigest(null);
    try {
      const r = await fetch('/discover/digest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic: topic.trim(), items: visible }),
      });
      const data = await r.json();
      if (!r.ok || data?.error) {
        window.dispatchEvent(new CustomEvent('recall-toast', { detail: { msg: data?.error || data?.detail || 'Digest failed', type: 'error' } }));
        return;
      }
      setDigest(data);
    } catch {
      window.dispatchEvent(new CustomEvent('recall-toast', { detail: { msg: 'Digest failed — network error', type: 'error' } }));
    } finally {
      setDigestLoading(false);
    }
  };

  const filtered = useMemo(() => {
    const base = items.filter(it => filter === 'all' || it.type === filter);
    if (sortKey === 'views') return [...base].sort((a, b) => (b.view_count || 0) - (a.view_count || 0));
    if (sortKey === 'recent') return [...base].sort((a, b) => (b.published_at || '').localeCompare(a.published_at || ''));
    if (sortKey === 'shortest') return [...base].sort((a, b) => (a.duration_seconds || 99999) - (b.duration_seconds || 99999));
    return base;
  }, [items, filter, sortKey]);

  const videoCount = items.filter(i => i.type === 'video').length;
  const articleCount = items.filter(i => i.type === 'article').length;

  const card: React.CSSProperties = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14 };
  const inputStyle: React.CSSProperties = { width: '100%', padding: '13px 16px 13px 44px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 12, color: 'var(--text-1)', fontSize: 14, outline: 'none', fontFamily: 'inherit' };

  return (
    <div style={{ color: 'var(--text-1)', padding: '14px 0' }}>
      {/* Premium header with live source badge */}
      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
        className="page-header" style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 42, height: 42, borderRadius: 12, background: 'linear-gradient(135deg,#06b6d4,#0891b2)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 6px 20px rgba(6,182,212,0.4)' }}>
            <Compass size={20} color="#fff" />
          </div>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0, letterSpacing: '-0.4px' }}>Discover</h1>
            <p style={{ color: 'var(--text-3)', fontSize: 12, margin: '2px 0 0' }}>Real YouTube videos + curated articles · take notes, save, or turn any video into a study plan</p>
          </div>
        </div>
        {meta.youtube_api_used && items.length > 0 && (
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, padding: '5px 11px', background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.28)', borderRadius: 20, fontSize: 11, fontWeight: 700, color: '#dc2626' }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#ef4444', boxShadow: '0 0 0 3px rgba(239,68,68,0.20)' }} />
            Live YouTube Data API v3
          </div>
        )}
      </motion.div>

      {/* Search */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
        style={{ ...card, padding: '20px 22px', marginBottom: 14 }}>
        <div className="discover-search-wrap" style={{ position: 'relative' }}>
          <Search size={17} color="var(--text-3)" className="discover-search-icon" style={{ position: 'absolute', left: 15, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
          <input type="text" value={topic} onChange={e => setTopic(e.target.value)}
            placeholder="What do you want to learn? e.g., Transformer architecture, RAG…"
            className="discover-search-input"
            style={inputStyle}
            onKeyDown={e => { if (e.key === 'Enter') runDiscover(topic); }} />
          <button onClick={() => runDiscover(topic)} disabled={!topic.trim() || isLoading}
            className="discover-search-btn"
            style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', padding: '8px 16px', background: 'linear-gradient(135deg,#06b6d4,#0891b2)', border: 'none', borderRadius: 9, color: '#fff', fontSize: 12, fontWeight: 700, cursor: (!topic.trim() || isLoading) ? 'not-allowed' : 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 6, opacity: (!topic.trim() || isLoading) ? 0.6 : 1, boxShadow: '0 4px 14px rgba(6,182,212,0.35)' }}>
            {isLoading ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Sparkles size={13} />}
            Discover
          </button>
        </div>

        {/* Suggested topics */}
        {!items.length && !isLoading && (
          <div style={{ marginTop: 14, display: 'flex', flexWrap: 'wrap', gap: 7 }}>
            <span style={{ fontSize: 10.5, color: 'var(--text-3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', alignSelf: 'center', marginRight: 4 }}>Try:</span>
            {SUGGESTED_TOPICS.map(t => (
              <button key={t} onClick={() => { setTopic(t); runDiscover(t); }}
                style={{ padding: '6px 13px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 16, color: 'var(--text-2)', fontSize: 11.5, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 500 }}>
                {t}
              </button>
            ))}
          </div>
        )}
      </motion.div>

      {/* Live multi-agent pipeline (visible during/after run) */}
      {pipeline && (
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} style={{ marginBottom: 12 }}>
          <AgentPipeline agents={pipeline} totalMs={pipelineMs} title="Discover pipeline" />
        </motion.div>
      )}

      {/* Filters + Sort */}
      {items.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
          <Filter size={13} color="var(--text-3)" style={{ marginRight: 2 }} />
          {(['all', 'video', 'article'] as const).map(f => {
            const isActive = filter === f;
            const cnt = f === 'all' ? items.length : f === 'video' ? videoCount : articleCount;
            const Icon = f === 'video' ? Youtube : f === 'article' ? FileText : Sparkles;
            return (
              <button key={f} onClick={() => setFilter(f)}
                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', background: isActive ? 'var(--primary-bg)' : 'var(--surface-2)', border: `1px solid ${isActive ? 'var(--primary-border)' : 'var(--border)'}`, borderRadius: 18, color: isActive ? 'var(--primary)' : 'var(--text-3)', fontSize: 11.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', textTransform: 'capitalize' }}>
                <Icon size={12} /> {f === 'all' ? 'All' : f}s · {cnt}
              </button>
            );
          })}
          <div style={{ width: 1, height: 18, background: 'var(--border)', margin: '0 4px' }} />
          <ArrowUpDown size={12} color="var(--text-3)" />
          <select value={sortKey} onChange={e => setSortKey(e.target.value as SortKey)}
            style={{ padding: '5px 10px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 18, color: 'var(--text-2)', fontSize: 11.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', outline: 'none' }}>
            <option value="relevance">Relevance</option>
            <option value="views">Most viewed</option>
            <option value="recent">Newest first</option>
            <option value="shortest">Shortest first</option>
          </select>
          <span style={{ fontSize: 11, color: 'var(--text-3)', marginLeft: 'auto' }}>Topic: <strong style={{ color: 'var(--text-2)' }}>{topic}</strong></span>

          {/* Workspace target picker + bulk save */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, position: 'relative' }}>
            <button onClick={() => setShowWsPicker(s => !s)}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 11px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 18, color: 'var(--text-2)', fontSize: 11.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
              <FolderTree size={11} />
              {targetWs ? (wsProjects.find(p => p.id === targetWs)?.name || 'Workspace') : 'Choose workspace'}
              <ChevronDown size={10} />
            </button>
            {showWsPicker && (
              <div style={{ position: 'absolute', top: 'calc(100% + 4px)', right: 0, zIndex: 20, minWidth: 220, maxHeight: 260, overflowY: 'auto', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.18)', padding: 6 }}>
                <button onClick={() => { setTargetWs(''); setShowWsPicker(false); }}
                  style={{ width: '100%', textAlign: 'left', padding: '7px 10px', background: !targetWs ? 'var(--surface-2)' : 'transparent', border: 'none', borderRadius: 6, color: 'var(--text-2)', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <FolderPlus size={11} /> New project from topic
                </button>
                {wsProjects.length > 0 && <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />}
                {wsProjects.map(p => (
                  <button key={p.id} onClick={() => { setTargetWs(p.id); setShowWsPicker(false); }}
                    style={{ width: '100%', textAlign: 'left', padding: '7px 10px', background: targetWs === p.id ? p.color + '20' : 'transparent', border: 'none', borderRadius: 6, color: 'var(--text-1)', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 7 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: p.color }} />
                    {p.name}
                  </button>
                ))}
              </div>
            )}
            <button onClick={saveAllVisibleToWorkspace} disabled={savingBulk}
              style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 11px', background: 'linear-gradient(135deg,#10b981,#059669)', border: 'none', borderRadius: 18, color: '#fff', fontSize: 11.5, fontWeight: 700, cursor: savingBulk ? 'wait' : 'pointer', fontFamily: 'inherit', opacity: savingBulk ? 0.7 : 1 }}>
              {savingBulk ? <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} /> : <FolderPlus size={11} />}
              Save all
            </button>
          </div>
          <button onClick={runDigest} disabled={digestLoading || filtered.length === 0}
            title="Synthesize an AI brief over the visible items"
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 12px', background: digest ? 'rgba(168,85,247,0.12)' : 'linear-gradient(135deg,#a855f7,#7c3aed)', border: digest ? '1px solid rgba(168,85,247,0.3)' : 'none', borderRadius: 18, color: digest ? '#a855f7' : '#fff', fontSize: 11.5, fontWeight: 700, cursor: (digestLoading || filtered.length === 0) ? 'not-allowed' : 'pointer', fontFamily: 'inherit', opacity: (digestLoading || filtered.length === 0) ? 0.6 : 1, boxShadow: digest ? 'none' : '0 4px 12px rgba(168,85,247,0.35)' }}>
            {digestLoading ? <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} /> : <Brain size={11} />}
            {digest ? 'Re-synthesize' : 'AI Digest'}
          </button>
        </div>
      )}

      {/* AI Digest panel */}
      <AnimatePresence>
        {digest && (
          <motion.div initial={{ opacity: 0, y: -6, height: 0 }} animate={{ opacity: 1, y: 0, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
            style={{ ...card, marginBottom: 14, overflow: 'hidden', borderColor: 'rgba(168,85,247,0.3)', background: 'linear-gradient(135deg, rgba(168,85,247,0.08), rgba(124,58,237,0.05))' }}>
            <div style={{ padding: '14px 18px 10px', display: 'flex', alignItems: 'center', gap: 10, borderBottom: '1px solid rgba(168,85,247,0.15)' }}>
              <div style={{ width: 30, height: 30, borderRadius: 9, background: 'linear-gradient(135deg,#a855f7,#7c3aed)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 12px rgba(168,85,247,0.4)' }}>
                <Brain size={15} color="#fff" />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-1)' }}>AI Digest · synthesized over {digest.total} items</div>
                <div style={{ fontSize: 11, color: 'var(--text-3)' }}>Topic: {topic}</div>
              </div>
              <button onClick={() => setDigest(null)} aria-label="Close"
                style={{ width: 26, height: 26, borderRadius: 7, background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-3)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <X size={12} />
              </button>
            </div>
            <div style={{ padding: '14px 18px 16px', display: 'grid', gap: 14 }}>
              {digest.tldr && (
                <div>
                  <div style={{ fontSize: 10, fontWeight: 800, color: '#a855f7', textTransform: 'uppercase', letterSpacing: '0.7px', marginBottom: 6 }}>TL;DR</div>
                  <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: 'var(--text-1)' }}>{digest.tldr}</p>
                </div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14 }}>
                {digest.themes.length > 0 && (
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 7 }}>
                      <Lightbulb size={12} color="#f59e0b" />
                      <span style={{ fontSize: 10, fontWeight: 800, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.6px' }}>Themes</span>
                    </div>
                    <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {digest.themes.map((t, i) => (
                        <li key={i} style={{ padding: '8px 11px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12, color: 'var(--text-2)', lineHeight: 1.45 }}>
                          <strong style={{ color: 'var(--text-1)' }}>{t.title}.</strong> {t.why}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {digest.must_read.length > 0 && (
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 7 }}>
                      <ArrowRight size={12} color="#10b981" />
                      <span style={{ fontSize: 10, fontWeight: 800, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.6px' }}>Must read · in order</span>
                    </div>
                    <ol style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {digest.must_read.map((m, i) => (
                        <li key={i} style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.45 }}>
                          <a href={m.url} target="_blank" rel="noreferrer" style={{ color: '#22d3ee', fontWeight: 700, textDecoration: 'none' }}>{m.title}</a>
                          <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>{m.reason}</div>
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
              </div>
              {(digest.watch_first || digest.contrarian) && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 10 }}>
                  {digest.watch_first && (
                    <div style={{ padding: '10px 12px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.22)', borderRadius: 9 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, fontWeight: 800, color: '#ef4444', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 4 }}>
                        <Youtube size={11} /> Watch first
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-1)', fontWeight: 600, lineHeight: 1.4 }}>{digest.watch_first}</div>
                    </div>
                  )}
                  {digest.contrarian && (
                    <div style={{ padding: '10px 12px', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.22)', borderRadius: 9 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, fontWeight: 800, color: '#f59e0b', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 4 }}>
                        <Zap size={11} /> Contrarian view
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.45 }}>{digest.contrarian}</div>
                    </div>
                  )}
                </div>
              )}
              {digest.next_questions.length > 0 && (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 7 }}>
                    <HelpCircle size={12} color="#818cf8" />
                    <span style={{ fontSize: 10, fontWeight: 800, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.6px' }}>Questions to explore next</span>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {digest.next_questions.map((q, i) => (
                      <button key={i} onClick={() => { setTopic(q); runDiscover(q); setDigest(null); }}
                        style={{ padding: '5px 11px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 16, color: 'var(--text-2)', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', maxWidth: '100%' }}>
                        {q}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Error */}
      {error && (
        <div style={{ ...card, padding: '14px 18px', borderColor: 'rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.05)', color: '#dc2626', fontSize: 12.5 }}>
          {error}
        </div>
      )}

      {/* Loading skeleton */}
      {isLoading && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
          {[0, 1, 2, 3, 4, 5].map(i => (
            <div key={i} style={{ ...card, height: 320, opacity: 0.5, animation: `pulse 1.5s ease-in-out ${i * 0.08}s infinite` }} />
          ))}
        </div>
      )}

      {/* Results grid */}
      {!isLoading && filtered.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
          <AnimatePresence>
            {filtered.map((item, i) => {
              const isVideo = item.type === 'video' || !!item.youtube_id;
              const ytId = item.youtube_id || (isVideo ? getYouTubeId(item.url) : null);
              const isSaved = savedUrls.has(item.url);
              const isPlaying = ytId ? playingYt.has(item.url) : false;
              const thumbSrc = item.thumbnail || (ytId ? `https://img.youtube.com/vi/${ytId}/hqdefault.jpg` : '');
              return (
                <motion.div key={item.url} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ delay: i * 0.03 }}
                  className="discover-card"
                  style={{ ...card, overflow: 'hidden', display: 'flex', flexDirection: 'column', borderColor: ytId ? 'rgba(239,68,68,0.22)' : 'var(--border)' }}>
                  {/* Thumbnail / player */}
                  {ytId ? (
                    isPlaying ? (
                      <div style={{ position: 'relative', width: '100%', paddingBottom: '56.25%', background: '#000' }}>
                        <iframe src={`https://www.youtube.com/embed/${ytId}?autoplay=1&rel=0&modestbranding=1`} title={item.title}
                          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen
                          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0 }} />
                        <button onClick={(e) => { e.stopPropagation(); setPlayingYt(prev => { const n = new Set(prev); n.delete(item.url); return n; }); }}
                          style={{ position: 'absolute', top: 6, right: 6, width: 26, height: 26, borderRadius: '50%', background: 'rgba(0,0,0,0.75)', border: '1px solid rgba(255,255,255,0.2)', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, zIndex: 2 }}>
                          <X size={13} />
                        </button>
                      </div>
                    ) : (
                      <button onClick={() => setPlayingYt(prev => { const n = new Set(prev); n.add(item.url); return n; })}
                        title={`Play "${item.title}"`} aria-label={`Play ${item.title}`}
                        style={{ position: 'relative', width: '100%', paddingBottom: '56.25%', background: '#000', overflow: 'hidden', border: 0, padding: 0, cursor: 'pointer', display: 'block' }}>
                        <img src={thumbSrc} alt="" loading="lazy"
                          data-fb="0"
                          onError={e => {
                            const el = e.currentTarget as HTMLImageElement;
                            const step = parseInt(el.dataset.fb || '0', 10);
                            const chain = [
                              `https://img.youtube.com/vi/${ytId}/hqdefault.jpg`,
                              `https://img.youtube.com/vi/${ytId}/mqdefault.jpg`,
                              `https://img.youtube.com/vi/${ytId}/0.jpg`,
                            ];
                            if (step < chain.length) {
                              el.dataset.fb = String(step + 1);
                              el.src = chain[step];
                            }
                          }}
                          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none' }} />
                        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(0,0,0,0.05) 0%, rgba(0,0,0,0.55) 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
                          <div style={{ width: 50, height: 50, borderRadius: '50%', background: 'rgba(239,68,68,0.95)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 6px 22px rgba(239,68,68,0.55)' }}>
                            <svg viewBox="0 0 24 24" fill="white" width="20" height="20"><path d="M8 5v14l11-7z" /></svg>
                          </div>
                        </div>
                        <div style={{ position: 'absolute', top: 7, left: 7, padding: '3px 8px', background: 'rgba(239,68,68,0.95)', borderRadius: 4, color: '#fff', fontSize: 9.5, fontWeight: 800, letterSpacing: '0.8px', pointerEvents: 'none' }}>YOUTUBE</div>
                        {item.kind_label && (
                          <div style={{ position: 'absolute', top: 7, right: 7, padding: '3px 8px', background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(8px)', borderRadius: 4, color: '#fff', fontSize: 9.5, fontWeight: 700, letterSpacing: '0.5px', pointerEvents: 'none' }}>{item.kind_label}</div>
                        )}
                        {item.duration_display && (
                          <div style={{ position: 'absolute', bottom: 7, right: 7, padding: '3px 7px', background: 'rgba(0,0,0,0.85)', borderRadius: 4, color: '#fff', fontSize: 11, fontWeight: 700, fontVariantNumeric: 'tabular-nums', pointerEvents: 'none', display: 'flex', alignItems: 'center', gap: 4 }}>
                            <Clock size={10} /> {item.duration_display}
                          </div>
                        )}
                      </button>
                    )
                  ) : (
                    <div style={{ position: 'relative', width: '100%', paddingBottom: '52%', background: 'linear-gradient(135deg, rgba(6,182,212,0.18), rgba(99,102,241,0.12))', overflow: 'hidden' }}>
                      {item.thumbnail ? (
                        <img src={item.thumbnail} alt="" loading="lazy"
                          onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
                      ) : (
                        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <FileText size={36} color="rgba(99,102,241,0.45)" />
                        </div>
                      )}
                      {item.thumbnail && (
                        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(0,0,0,0) 35%, rgba(0,0,0,0.55) 100%)' }} />
                      )}
                      <div style={{ position: 'absolute', top: 7, left: 7, padding: '3px 8px', background: 'rgba(6,182,212,0.95)', borderRadius: 4, color: '#fff', fontSize: 9.5, fontWeight: 800, letterSpacing: '0.8px' }}>ARTICLE</div>
                      <div style={{ position: 'absolute', bottom: 7, right: 9, color: 'rgba(255,255,255,0.85)', fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4, padding: '3px 7px', background: 'rgba(0,0,0,0.5)', borderRadius: 4, backdropFilter: 'blur(6px)' }}>
                        <Globe size={10} /> {item.domain || item.source}
                      </div>
                    </div>
                  )}

                  {/* Body */}
                  <div style={{ padding: '12px 14px 13px', display: 'flex', flexDirection: 'column', gap: 7, flex: 1 }}>
                    {/* Channel/Source row */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                      {item.channel_title ? (
                        <>
                          <div style={{ width: 22, height: 22, borderRadius: '50%', background: 'linear-gradient(135deg,#ef4444,#dc2626)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 10, fontWeight: 800, color: '#fff' }}>
                            {item.channel_title.charAt(0).toUpperCase()}
                          </div>
                          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 }}>{item.channel_title}</div>
                        </>
                      ) : (
                        <div style={{ fontSize: 9.5, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{item.source || item.domain}</div>
                      )}
                    </div>
                    <h4 style={{ margin: 0, fontSize: 13.5, fontWeight: 700, lineHeight: 1.32, color: 'var(--text-1)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{item.title}</h4>
                    {/* Stats row */}
                    {(item.view_count_display || item.age_display) && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 10.5, color: 'var(--text-3)', fontWeight: 600 }}>
                        {item.view_count_display && (
                          <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}><Eye size={10} /> {item.view_count_display}</span>
                        )}
                        {item.age_display && (
                          <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}><CalendarIcon size={10} /> {item.age_display}</span>
                        )}
                      </div>
                    )}
                    {item.summary && (
                      <p style={{ margin: 0, fontSize: 11.5, color: 'var(--text-3)', lineHeight: 1.45, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{item.summary}</p>
                    )}
                    {/* Action row */}
                    <div style={{ display: 'flex', gap: 6, marginTop: 'auto', paddingTop: 8, flexWrap: 'wrap' }}>
                      <a href={item.url} target="_blank" rel="noreferrer"
                        title="Open in new tab"
                        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, padding: '7px 10px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-2)', fontSize: 11, fontWeight: 700, textDecoration: 'none', fontFamily: 'inherit' }}>
                        <ExternalLink size={11} />
                      </a>
                      {isVideo && (
                        <>
                          <button onClick={() => openNotes(item)} title="Open Watch & Note mode"
                            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, padding: '7px 10px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-2)', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                            <NotebookPen size={11} />
                          </button>
                          <button onClick={() => generatePlan(item)} title="Generate study plan from this video"
                            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, padding: '7px 10px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-2)', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                            <ListChecks size={11} />
                          </button>
                        </>
                      )}
                      <button onClick={() => handleSave(item)} disabled={isSaved}
                        style={{ flex: 1, minWidth: 90, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, padding: '7px 10px', background: isSaved ? 'rgba(16,185,129,0.15)' : 'linear-gradient(135deg,#6366f1,#4f46e5)', border: isSaved ? '1px solid rgba(16,185,129,0.4)' : 'none', borderRadius: 8, color: isSaved ? '#10b981' : '#fff', fontSize: 11, fontWeight: 700, cursor: isSaved ? 'default' : 'pointer', fontFamily: 'inherit' }}>
                        <BookmarkPlus size={11} /> {isSaved ? 'Saved' : 'Vault'}
                      </button>
                      <button onClick={() => saveItemToWorkspace(item)} disabled={savedToWs.has(item.url)}
                        title={savedToWs.has(item.url) ? 'In workspace' : 'Save to workspace project'}
                        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, padding: '7px 10px', background: savedToWs.has(item.url) ? 'rgba(16,185,129,0.15)' : 'var(--surface-2)', border: savedToWs.has(item.url) ? '1px solid rgba(16,185,129,0.4)' : '1px solid var(--border)', borderRadius: 8, color: savedToWs.has(item.url) ? '#10b981' : 'var(--text-2)', fontSize: 11, fontWeight: 700, cursor: savedToWs.has(item.url) ? 'default' : 'pointer', fontFamily: 'inherit' }}>
                        <FolderPlus size={11} />
                      </button>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}

      {/* Empty state */}
      {!isLoading && items.length === 0 && !error && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.15 }}
          style={{ ...card, borderStyle: 'dashed', padding: '60px 24px', textAlign: 'center' }}>
          <div style={{ width: 60, height: 60, borderRadius: 14, background: 'rgba(6,182,212,0.1)', border: '1px solid rgba(6,182,212,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px' }}>
            <Compass size={28} color="#22d3ee" />
          </div>
          <h3 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 6px' }}>Discover external knowledge</h3>
          <p style={{ color: 'var(--text-3)', fontSize: 12.5, margin: '0 auto 14px', maxWidth: 460, lineHeight: 1.55 }}>
            Type a topic above. Recall pulls real YouTube videos via the YouTube Data API plus AI-curated articles. Watch + take notes, save to your Vault, or generate a multi-day study plan from any video — all in one place.
          </p>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 12, flexWrap: 'wrap', marginTop: 6 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600, color: 'var(--text-3)' }}><Zap size={11} color="#06b6d4" /> Real YT data</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600, color: 'var(--text-3)' }}><NotebookPen size={11} color="#6366f1" /> Watch & Note</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600, color: 'var(--text-3)' }}><ListChecks size={11} color="#10b981" /> Plan from video</span>
          </div>
        </motion.div>
      )}

      {/* Watch & Note Drawer */}
      <AnimatePresence>
        {notesFor && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => !savingNotes && setNotesFor(null)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)', zIndex: 1000, display: 'flex', alignItems: 'stretch', justifyContent: 'flex-end' }}>
            <motion.div
              initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ type: 'spring', damping: 28, stiffness: 240 }}
              onClick={e => e.stopPropagation()}
              style={{ width: 'min(720px, 100%)', height: '100%', background: 'var(--surface)', borderLeft: '1px solid var(--border)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              {/* Drawer header */}
              <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 32, height: 32, borderRadius: 9, background: 'linear-gradient(135deg,#6366f1,#4f46e5)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 12px rgba(99,102,241,0.35)' }}>
                  <NotebookPen size={16} color="#fff" />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-1)' }}>Watch & Note</div>
                  <div style={{ fontSize: 11, color: 'var(--text-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{notesFor.title}</div>
                </div>
                <button onClick={() => !savingNotes && setNotesFor(null)} aria-label="Close"
                  style={{ width: 30, height: 30, borderRadius: 8, background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-2)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <X size={14} />
                </button>
              </div>
              {/* Player */}
              {notesFor.youtube_id || getYouTubeId(notesFor.url) ? (
                <div style={{ position: 'relative', width: '100%', paddingBottom: '40%', background: '#000', flexShrink: 0 }}>
                  <iframe src={`https://www.youtube.com/embed/${notesFor.youtube_id || getYouTubeId(notesFor.url)}?autoplay=1&rel=0&modestbranding=1`}
                    title={notesFor.title}
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen
                    style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0 }} />
                </div>
              ) : null}
              {/* Notes editor */}
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '12px 16px', gap: 8, minHeight: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.6px' }}>Your Notes (Markdown)</div>
                  <div style={{ fontSize: 10.5, color: 'var(--text-3)' }}>{notesText.length} chars</div>
                </div>
                <textarea value={notesText} onChange={e => setNotesText(e.target.value)}
                  placeholder="Type as you watch — use markdown (# heading, - bullet, **bold**)…"
                  style={{ flex: 1, padding: '12px 14px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--text-1)', fontSize: 13, lineHeight: 1.55, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', outline: 'none', resize: 'none', minHeight: 0 }} />
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', paddingTop: 6 }}>
                  <button onClick={() => !savingNotes && setNotesFor(null)}
                    style={{ padding: '9px 16px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 9, color: 'var(--text-2)', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                    Cancel
                  </button>
                  <button onClick={saveNotes} disabled={savingNotes || !notesText.trim()}
                    style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 16px', background: savingNotes || !notesText.trim() ? 'var(--surface-2)' : 'linear-gradient(135deg,#6366f1,#4f46e5)', border: 'none', borderRadius: 9, color: savingNotes || !notesText.trim() ? 'var(--text-3)' : '#fff', fontSize: 12, fontWeight: 700, cursor: savingNotes || !notesText.trim() ? 'not-allowed' : 'pointer', fontFamily: 'inherit', boxShadow: savingNotes || !notesText.trim() ? 'none' : '0 4px 14px rgba(99,102,241,0.4)' }}>
                    {savingNotes ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <Save size={12} />}
                    {savingNotes ? 'Saving…' : 'Save to Vault'}
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default DiscoverPage;
