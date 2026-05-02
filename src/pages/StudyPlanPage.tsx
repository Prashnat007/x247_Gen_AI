import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  GraduationCap, Loader2, CheckCircle2, CalendarPlus, ListChecks, Sparkles,
  RefreshCw, Save, Compass, FolderTree, FolderPlus, Youtube, FileText,
  ExternalLink, ChevronDown, ChevronRight, Clock, Layers, Target,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import AgentPipeline, { AgentStep } from '../components/AgentPipeline';
import { card } from '../lib/ui';

interface Resource {
  title?: string;
  url?: string;
  type?: 'video' | 'article';
  thumbnail?: string;
  youtube_id?: string;
  channel_title?: string;
  duration_display?: string;
  domain?: string;
}

interface PlanDay {
  day: number;
  date: string;
  title: string;
  focus_area: string;
  focus_id: string;
  duration_minutes: number;
  activities: string[];
  resources?: Resource[];
}

interface FocusArea {
  id: string;
  title: string;
  description: string;
  weight: number;
  search_query: string;
}

interface Folder {
  id: string;
  name: string;
  description: string;
  weight: number;
  videos: Resource[];
  articles: Resource[];
  video_count: number;
  article_count: number;
}

interface PipelineMeta {
  agents: { name: string; status: 'queued' | 'running' | 'done' | 'error'; ms?: number; out?: string }[];
  total_ms?: number;
}

interface PlanResponse {
  topic: string;
  intent: string;
  goal_type: string;
  goal_label: string;
  days: number;
  minutes_per_day: number;
  focus_areas: FocusArea[];
  folders: Folder[];
  total_resources: number;
  plan: PlanDay[];
  pipeline: PipelineMeta;
}

interface GoalType { id: string; label: string; verb: string; lens: string }

const FALLBACK_GOAL_TYPES: GoalType[] = [
  { id: 'study', label: 'Study / Learn a topic', verb: 'master', lens: '' },
  { id: 'project', label: 'Ship a project', verb: 'ship', lens: '' },
  { id: 'research', label: 'Research deep-dive', verb: 'investigate', lens: '' },
  { id: 'career', label: 'Career / Interview prep', verb: 'land', lens: '' },
  { id: 'travel', label: 'Travel itinerary', verb: 'plan', lens: '' },
  { id: 'health', label: 'Health / Fitness', verb: 'achieve', lens: '' },
  { id: 'launch', label: 'Launch / GTM', verb: 'launch', lens: '' },
  { id: 'skill', label: 'Build a skill', verb: 'build', lens: '' },
];

const PLACEHOLDERS: Record<string, string> = {
  study: 'e.g., Transformer architecture from scratch',
  project: 'e.g., Ship a voice-controlled todo app',
  research: 'e.g., Survey of LLM evaluation benchmarks',
  career: 'e.g., Land a senior backend role',
  travel: 'e.g., 7-day Japan itinerary, $2k budget',
  health: 'e.g., 5K running base in 4 weeks',
  launch: 'e.g., Launch a paid newsletter for indie devs',
  skill: 'e.g., Become decent at watercolor painting',
};

const RUNNING_PIPELINE: AgentStep[] = [
  { name: 'ResearcherAgent', label: 'Researcher', status: 'running', out: 'Breaking goal into focus areas…' },
  { name: 'DiscoverAgent', label: 'Discover', status: 'queued', out: 'Will pull live videos + articles' },
  { name: 'OrganizerAgent', label: 'Organizer', status: 'queued', out: 'Will group into folders' },
  { name: 'SchedulerAgent', label: 'Scheduler', status: 'queued', out: 'Will lay out days' },
];

interface PlanGeneratorPageProps { embedded?: boolean }
const PlanGeneratorPage: React.FC<PlanGeneratorPageProps> = ({ embedded = false }) => {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [topic, setTopic] = useState(params.get('topic') || '');
  const [goalType, setGoalType] = useState<string>(params.get('goal') || 'study');
  const [days, setDays] = useState(7);
  const [minutesPerDay, setMinutesPerDay] = useState(60);
  const [includeResources, setIncludeResources] = useState(true);
  const [startTime, setStartTime] = useState('18:00');
  const [createEvents, setCreateEvents] = useState(true);
  const [createTasks, setCreateTasks] = useState(true);

  const [goalTypes, setGoalTypes] = useState<GoalType[]>(FALLBACK_GOAL_TYPES);
  const [plan, setPlan] = useState<PlanResponse | null>(null);
  const [pipelineLive, setPipelineLive] = useState<AgentStep[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [savingToWorkspace, setSavingToWorkspace] = useState(false);
  const [openFolders, setOpenFolders] = useState<Set<string>>(new Set());
  const [savedSummary, setSavedSummary] = useState<{ events: number; tasks: number } | null>(null);
  const [regeneratingDay, setRegeneratingDay] = useState<number | null>(null);

  useEffect(() => {
    fetch('/plan/goal-types').then(r => r.ok ? r.json() : null).then(d => {
      if (d?.goal_types?.length) setGoalTypes(d.goal_types);
    }).catch(() => {});
    const cached = localStorage.getItem('plan-draft-v2');
    if (cached) {
      try {
        const d = JSON.parse(cached);
        if (d.topic) setTopic(d.topic);
        if (d.goalType) setGoalType(d.goalType);
        if (d.plan) setPlan(d.plan);
      } catch {}
    }
  }, []);

  const advancePipeline = (idx: number) => {
    setPipelineLive(prev => {
      const base = prev ? [...prev] : RUNNING_PIPELINE.map(s => ({ ...s }));
      base.forEach((s, i) => {
        if (i < idx) s.status = 'done';
        else if (i === idx) s.status = 'running';
        else s.status = 'queued';
      });
      return base;
    });
  };

  const handleGenerate = async () => {
    if (!topic.trim()) return;
    setIsLoading(true);
    setSavedSummary(null);
    setPipelineLive(RUNNING_PIPELINE.map(s => ({ ...s })));
    // Optimistic stage progression — agents typically each finish in <2s
    const stageTimer1 = setTimeout(() => advancePipeline(1), 600);
    const stageTimer2 = setTimeout(() => advancePipeline(2), 1800);
    const stageTimer3 = setTimeout(() => advancePipeline(3), 2400);
    try {
      const res = await fetch('/plan/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: topic.trim(),
          goal_type: goalType,
          days,
          minutes_per_day: minutesPerDay,
          include_resources: includeResources,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        const msg = data?.detail || data?.error || `Plan failed (${res.status})`;
        window.dispatchEvent(new CustomEvent('recall-toast', { detail: { msg, type: 'error' } }));
        setPipelineLive(prev => prev?.map(s => s.status === 'queued' || s.status === 'running' ? { ...s, status: 'error' } : s) || null);
        return;
      }
      setPlan(data);
      // Map server pipeline timings into AgentStep format
      const liveSteps: AgentStep[] = (data.pipeline?.agents || []).map((a: any) => ({
        name: a.name,
        label: a.name.replace('Agent', ''),
        status: a.status as AgentStep['status'],
        ms: a.ms,
        out: a.out,
      }));
      setPipelineLive(liveSteps);
      setOpenFolders(new Set((data.folders || []).slice(0, 1).map((f: Folder) => f.id)));
      localStorage.setItem('plan-draft-v2', JSON.stringify({ topic, goalType, plan: data }));
    } catch (e) {
      window.dispatchEvent(new CustomEvent('recall-toast', { detail: { msg: 'Plan failed — network error', type: 'error' } }));
      setPipelineLive(prev => prev?.map(s => s.status === 'queued' || s.status === 'running' ? { ...s, status: 'error' } : s) || null);
    } finally {
      clearTimeout(stageTimer1); clearTimeout(stageTimer2); clearTimeout(stageTimer3);
      setIsLoading(false);
    }
  };

  const handleSaveToCalendar = async () => {
    if (!plan) return;
    setIsSaving(true);
    try {
      const res = await fetch('/study-plan/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: plan.topic,
          plan: plan.plan,
          create_events: createEvents,
          create_tasks: createTasks,
          start_time: startTime,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        window.dispatchEvent(new CustomEvent('recall-toast', { detail: { msg: data?.detail || 'Save failed', type: 'error' } }));
        return;
      }
      setSavedSummary({ events: data.events_created || 0, tasks: data.tasks_created || 0 });
      window.dispatchEvent(new CustomEvent('recall-toast', { detail: { msg: `Synced — ${data.events_created} events, ${data.tasks_created} tasks`, type: 'success' } }));
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveToWorkspace = async () => {
    if (!plan) return;
    setSavingToWorkspace(true);
    try {
      const res = await fetch('/plan/save-to-workspace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan, project_name: plan.topic }),
      });
      const data = await res.json();
      if (!res.ok) {
        window.dispatchEvent(new CustomEvent('recall-toast', { detail: { msg: data?.detail || 'Workspace save failed', type: 'error' } }));
        return;
      }
      window.dispatchEvent(new CustomEvent('recall-toast', { detail: { msg: `Project "${data.name}" created in Workspace`, type: 'success' } }));
      navigate(`/workspace?project=${data.id}`);
    } finally {
      setSavingToWorkspace(false);
    }
  };

  const regenerateDay = async (dayIndex: number) => {
    if (!plan) return;
    setRegeneratingDay(dayIndex);
    try {
      const res = await fetch('/plan/regenerate-day', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: plan.topic,
          day_index: dayIndex,
          plan: plan.plan,
          goal_type: plan.goal_type,
          minutes_per_day: plan.minutes_per_day,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data?.day) {
        window.dispatchEvent(new CustomEvent('recall-toast', { detail: { msg: data?.error || data?.detail || 'Regenerate failed', type: 'error' } }));
        return;
      }
      const next = { ...plan, plan: plan.plan.map((d, i) => i === dayIndex ? { ...d, ...data.day } : d) };
      setPlan(next);
      localStorage.setItem('plan-draft-v2', JSON.stringify({ topic, goalType, plan: next }));
      window.dispatchEvent(new CustomEvent('recall-toast', { detail: { msg: `Day ${dayIndex + 1} regenerated`, type: 'success' } }));
    } catch {
      window.dispatchEvent(new CustomEvent('recall-toast', { detail: { msg: 'Regenerate failed — network error', type: 'error' } }));
    } finally {
      setRegeneratingDay(null);
    }
  };

  const toggleFolder = (id: string) => {
    setOpenFolders(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  const inputStyle: React.CSSProperties = { width: '100%', padding: '10px 14px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--text-1)', fontSize: 13, outline: 'none', fontFamily: 'inherit' };
  const labelStyle: React.CSSProperties = { fontSize: 10.5, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase' as const, letterSpacing: '0.5px', display: 'block', marginBottom: 5 };

  const goalDef = useMemo(() => goalTypes.find(g => g.id === goalType) || goalTypes[0], [goalTypes, goalType]);
  const placeholder = PLACEHOLDERS[goalType] || PLACEHOLDERS.study;

  return (
    <div style={{ color: 'var(--text-1)', padding: '14px 0' }}>
      {/* Header */}
      {!embedded && (
        <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
          className="page-header" style={{ marginBottom: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 40, height: 40, borderRadius: 11, background: 'linear-gradient(135deg,#6366f1,#7c3aed)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 14px rgba(99,102,241,0.35)' }}>
              <Sparkles size={19} color="#fff" />
            </div>
            <div>
              <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0, letterSpacing: '-0.4px' }}>Plan Generator</h1>
              <p style={{ color: 'var(--text-3)', fontSize: 12, margin: '2px 0 0' }}>Multi-agent — Researcher · Discover · Organizer · Scheduler. Pulls live web data, organizes into folders, schedules to your calendar.</p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => navigate(`/discover${topic ? `?topic=${encodeURIComponent(topic)}` : ''}`)}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--text-2)', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
              <Compass size={13} /> Discover
            </button>
          </div>
        </motion.div>
      )}

      {/* Inputs card */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
        style={{ ...card, padding: '20px 22px', marginBottom: 14 }}>
        <div className="studyplan-input-grid">
          <div>
            <label style={labelStyle}>Goal / Topic</label>
            <input type="text" value={topic} onChange={e => setTopic(e.target.value)}
              placeholder={placeholder} style={inputStyle}
              onKeyDown={e => { if (e.key === 'Enter') handleGenerate(); }} />
          </div>
          <div>
            <label style={labelStyle}>Goal type</label>
            <select value={goalType} onChange={e => setGoalType(e.target.value)} style={inputStyle}>
              {goalTypes.map(g => <option key={g.id} value={g.id}>{g.label}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Days</label>
            <input type="number" value={days} onChange={e => setDays(Math.max(1, Math.min(30, parseInt(e.target.value) || 7)))}
              min={1} max={30} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Min/day</label>
            <input type="number" value={minutesPerDay} onChange={e => setMinutesPerDay(Math.max(15, Math.min(480, parseInt(e.target.value) || 60)))}
              min={15} max={480} step={15} style={inputStyle} />
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 14, flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: 'var(--text-2)', cursor: 'pointer', fontWeight: 600 }}>
            <input type="checkbox" checked={includeResources} onChange={e => setIncludeResources(e.target.checked)} />
            Pull live videos + articles per focus area
          </label>
          {goalDef?.lens && (
            <span style={{ fontSize: 11, color: 'var(--text-3)' }}>Lens: <strong style={{ color: 'var(--text-2)' }}>{goalDef.lens}</strong></span>
          )}
          <button onClick={handleGenerate} disabled={isLoading || !topic.trim()}
            style={{ marginLeft: 'auto', padding: '10px 20px', background: 'linear-gradient(135deg,#6366f1,#4f46e5)', border: 'none', borderRadius: 10, color: '#fff', fontSize: 13, fontWeight: 700, cursor: (isLoading || !topic.trim()) ? 'not-allowed' : 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 7, opacity: (isLoading || !topic.trim()) ? 0.6 : 1, boxShadow: '0 4px 14px rgba(99,102,241,0.35)', whiteSpace: 'nowrap' }}>
            {isLoading ? <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Running…</>
              : plan ? <><RefreshCw size={14} /> Regenerate</> : <><Sparkles size={14} /> Run multi-agent plan</>}
          </button>
        </div>
      </motion.div>

      {/* Live pipeline */}
      {pipelineLive && pipelineLive.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} style={{ marginBottom: 14 }}>
          <AgentPipeline agents={pipelineLive} totalMs={plan?.pipeline?.total_ms} title="Plan Generator pipeline" />
        </motion.div>
      )}

      {/* Plan output */}
      {plan && (
        <>
          {/* Intent + meta strip */}
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
            style={{ ...card, padding: '14px 18px', marginBottom: 14, background: 'linear-gradient(135deg, rgba(99,102,241,0.08), rgba(124,58,237,0.06))', borderColor: 'rgba(99,102,241,0.25)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <Target size={13} color="var(--primary)" />
              <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Intent</span>
              <span style={{ fontSize: 10.5, color: 'var(--text-3)', marginLeft: 'auto' }}>{plan.goal_label}</span>
            </div>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-1)', lineHeight: 1.45 }}>{plan.intent}</div>
            <div style={{ display: 'flex', gap: 14, marginTop: 10, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11.5, color: 'var(--text-2)', display: 'flex', alignItems: 'center', gap: 5 }}><Layers size={12} /> {plan.focus_areas.length} focus areas</span>
              <span style={{ fontSize: 11.5, color: 'var(--text-2)', display: 'flex', alignItems: 'center', gap: 5 }}><FolderTree size={12} /> {plan.folders.length} folders</span>
              <span style={{ fontSize: 11.5, color: 'var(--text-2)', display: 'flex', alignItems: 'center', gap: 5 }}><Youtube size={12} /> {plan.total_resources} live resources</span>
              <span style={{ fontSize: 11.5, color: 'var(--text-2)', display: 'flex', alignItems: 'center', gap: 5 }}><Clock size={12} /> {plan.days} days × {plan.minutes_per_day} min</span>
            </div>
          </motion.div>

          {/* Folders / organized resources */}
          <div style={{ display: 'grid', gap: 10, marginBottom: 14 }}>
            {plan.folders.map((f, i) => {
              const open = openFolders.has(f.id);
              return (
                <motion.div key={f.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}
                  style={{ ...card, overflow: 'hidden' }}>
                  <button onClick={() => toggleFolder(f.id)}
                    style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>
                    {open ? <ChevronDown size={14} color="var(--text-3)" /> : <ChevronRight size={14} color="var(--text-3)" />}
                    <FolderTree size={15} color="var(--primary)" />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text-1)' }}>{f.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>{f.description}</div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, fontSize: 10.5, color: 'var(--text-3)' }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}><Youtube size={11} /> {f.video_count}</span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}><FileText size={11} /> {f.article_count}</span>
                    </div>
                  </button>
                  <AnimatePresence>
                    {open && (
                      <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                        style={{ overflow: 'hidden', borderTop: '1px solid var(--border)' }}>
                        <div style={{ padding: '12px 16px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
                          {f.videos.map((v, vi) => (
                            <a key={`v${vi}`} href={v.url} target="_blank" rel="noopener noreferrer"
                              style={{ ...card, padding: 0, overflow: 'hidden', textDecoration: 'none', color: 'inherit', display: 'block' }}>
                              {v.thumbnail && (
                                <div style={{ width: '100%', aspectRatio: '16/9', background: '#000', overflow: 'hidden' }}>
                                  <img src={v.thumbnail} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                </div>
                              )}
                              <div style={{ padding: '8px 10px' }}>
                                <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-1)', lineHeight: 1.3, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const, overflow: 'hidden' }}>{v.title}</div>
                                <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 5 }}>
                                  <Youtube size={10} color="#ef4444" />{v.channel_title}{v.duration_display ? ` · ${v.duration_display}` : ''}
                                </div>
                              </div>
                            </a>
                          ))}
                          {f.articles.map((a, ai) => (
                            <a key={`a${ai}`} href={a.url} target="_blank" rel="noopener noreferrer"
                              style={{ ...card, padding: '10px 12px', textDecoration: 'none', color: 'inherit', display: 'block', minHeight: 78 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 5 }}>
                                <FileText size={11} color="var(--primary)" />
                                <span style={{ fontSize: 9.5, color: 'var(--text-3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.4px' }}>{a.domain}</span>
                                <ExternalLink size={9} color="var(--text-3)" style={{ marginLeft: 'auto' }} />
                              </div>
                              <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-1)', lineHeight: 1.35, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' as const, overflow: 'hidden' }}>{a.title}</div>
                            </a>
                          ))}
                          {f.videos.length === 0 && f.articles.length === 0 && (
                            <p style={{ fontSize: 11.5, color: 'var(--text-3)', margin: 0 }}>No live resources for this focus area.</p>
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              );
            })}
          </div>

          {/* Save bar */}
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
            style={{ ...card, padding: '14px 18px', marginBottom: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: 'var(--text-2)', cursor: 'pointer', fontWeight: 600 }}>
                <input type="checkbox" checked={createEvents} onChange={e => setCreateEvents(e.target.checked)} />
                <CalendarPlus size={13} color="var(--primary)" /> Calendar
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: 'var(--text-2)', cursor: 'pointer', fontWeight: 600 }}>
                <input type="checkbox" checked={createTasks} onChange={e => setCreateTasks(e.target.checked)} />
                <ListChecks size={13} color="var(--primary)" /> Tasks
              </label>
              <input type="time" value={startTime} onChange={e => setStartTime(e.target.value)}
                style={{ padding: '6px 10px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-1)', fontSize: 12, outline: 'none', fontFamily: 'inherit' }} />
              {savedSummary && (
                <span style={{ fontSize: 11.5, color: '#10b981', fontWeight: 700 }}>
                  Synced — {savedSummary.events} events · {savedSummary.tasks} tasks
                </span>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={handleSaveToCalendar} disabled={isSaving || (!createEvents && !createTasks)}
                style={{ padding: '8px 14px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 9, color: 'var(--text-1)', fontSize: 12, fontWeight: 700, cursor: isSaving ? 'wait' : 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 6, opacity: (isSaving || (!createEvents && !createTasks)) ? 0.55 : 1 }}>
                {isSaving ? <><Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> Syncing…</> : <><Save size={13} /> Sync to Calendar</>}
              </button>
              <button onClick={handleSaveToWorkspace} disabled={savingToWorkspace}
                style={{ padding: '8px 16px', background: 'linear-gradient(135deg,#10b981,#059669)', border: 'none', borderRadius: 9, color: '#fff', fontSize: 12, fontWeight: 700, cursor: savingToWorkspace ? 'wait' : 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 6, opacity: savingToWorkspace ? 0.7 : 1, boxShadow: '0 3px 10px rgba(16,185,129,0.3)' }}>
                {savingToWorkspace ? <><Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> Creating…</> : <><FolderPlus size={13} /> Save to Workspace</>}
              </button>
            </div>
          </motion.div>

          {/* Day-by-day plan */}
          <div style={{ display: 'grid', gap: 10 }}>
            {plan.plan.map((day, i) => (
              <motion.div key={day.day} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.05 + i * 0.03 }}
                style={{ ...card, padding: '14px 18px', borderRadius: 12 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 10, gap: 12 }}>
                  <div style={{ minWidth: 0 }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--primary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Day {day.day} · {day.date}</span>
                    <h5 style={{ fontWeight: 700, fontSize: 15, margin: '3px 0 0', color: 'var(--text-1)' }}>{day.title}</h5>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{day.duration_minutes} min</div>
                      <div style={{ fontSize: 9.5, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.5px', marginTop: 2 }}>{day.focus_area}</div>
                    </div>
                    <button onClick={() => regenerateDay(i)} disabled={regeneratingDay !== null}
                      title="Regenerate this day with a fresh angle and new resources"
                      style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 10px', background: regeneratingDay === i ? 'rgba(99,102,241,0.12)' : 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--primary)', fontSize: 10.5, fontWeight: 700, cursor: regeneratingDay !== null ? 'wait' : 'pointer', fontFamily: 'inherit', opacity: regeneratingDay !== null && regeneratingDay !== i ? 0.5 : 1 }}>
                      {regeneratingDay === i ? <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} /> : <RefreshCw size={11} />}
                      {regeneratingDay === i ? 'Regen…' : 'Regen'}
                    </button>
                  </div>
                </div>
                <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {day.activities?.map((a, idx) => (
                    <li key={idx} style={{ display: 'flex', alignItems: 'flex-start', gap: 7, fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.5 }}>
                      <CheckCircle2 size={12} color="var(--primary)" style={{ flexShrink: 0, marginTop: 3 }} />
                      <span>{a}</span>
                    </li>
                  ))}
                </ul>
                {day.resources && day.resources.length > 0 && (
                  <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                    {day.resources.map((r, ri) => (
                      <a key={ri} href={r.url} target="_blank" rel="noopener noreferrer"
                        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 16, fontSize: 11, color: 'var(--text-2)', textDecoration: 'none', maxWidth: 280 }}>
                        {r.type === 'video' ? <Youtube size={11} color="#ef4444" /> : <FileText size={11} color="var(--primary)" />}
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.title}</span>
                        {r.duration_display && <span style={{ color: 'var(--text-3)', fontSize: 10 }}>{r.duration_display}</span>}
                      </a>
                    ))}
                  </div>
                )}
              </motion.div>
            ))}
          </div>
        </>
      )}

      {!plan && !isLoading && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.15 }}
          style={{ ...card, borderStyle: 'dashed', padding: '50px 24px', textAlign: 'center' }}>
          <div style={{ width: 56, height: 56, borderRadius: 14, background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px' }}>
            <GraduationCap size={26} color="#818cf8" />
          </div>
          <h3 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 6px' }}>Run your first multi-agent plan</h3>
          <p style={{ color: 'var(--text-3)', fontSize: 12.5, margin: 0, maxWidth: 440, marginInline: 'auto' }}>
            Pick a goal type, type what you want to achieve, and four agents will research, discover live resources, organize folders, and schedule your days.
          </p>
        </motion.div>
      )}
    </div>
  );
};

export default PlanGeneratorPage;
