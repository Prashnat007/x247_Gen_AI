import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Kanban, PlusCircle, Plus, CheckCheck, Trash2, Loader2, Sparkles, FolderTree,
  Youtube, FileText, ExternalLink, Wand2, X, FolderPlus, Save,
  StickyNote, CheckSquare, Lightbulb, Link2, Tag, Layers, GitBranch,
  TrendingUp, Search, Activity, ListTree, Folder, ArrowRight, Clock,
  Calendar as CalendarIcon, Zap, GripVertical, Download, LayoutTemplate,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import AgentPipeline, { AgentStep } from '../components/AgentPipeline';
import type {
  WorkspaceProject as WsProject,
  WorkspaceItem as WsItem,
  WorkspaceFolder as WsFolder,
  WorkspaceGroup as WsGroup,
  WorkspaceSectionId,
  WorkspaceOrganizeResult,
} from '../lib/types';

type WsTask = WsProject['tasks'][number];

type WsTemplate = {
  id: string;
  name: string;
  description: string;
  color: string;
  folder_count: number;
  starter_task_count: number;
};

type WsOverview = {
  totals: { projects: number; items: number; tasks: number; tasks_done: number };
  completion_pct: number;
  top_projects: { id: string; name: string; color: string; items: number; tasks: number; done: number; done_pct: number; updated_at: string }[];
  section_breakdown: Record<string, number>;
  top_tags: { tag: string; count: number }[];
  recent_activity: { kind: string; title: string; project_id: string; project_name: string; color: string; ts: string }[];
  activity_30d: { date: string; count: number }[];
};

type WsAnalytics = {
  project_id: string;
  name: string;
  color: string;
  totals: { items: number; tasks: number; tasks_done: number; folders: number; groups: number };
  completion_pct: number;
  section_breakdown: Record<string, number>;
  kind_breakdown: Record<string, number>;
  top_tags: { tag: string; count: number }[];
  activity_30d: { date: string; count: number }[];
  activity_max: number;
  age_days: number;
  last_updated: string;
};

type WsRecallSource = {
  kind: string;
  id?: string;
  title: string;
  url?: string;
  snippet?: string;
  project_id?: string;
  project_name?: string;
};

type WsRecallResult = {
  ok: boolean;
  answer?: string;
  citations?: number[];
  sources?: WsRecallSource[];
  counts?: { memories?: number; items?: number; tasks?: number; projects?: number; total?: number };
  error?: string;
};

const flattenRecallSources = (raw: any): WsRecallSource[] => {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw as WsRecallSource[];
  if (typeof raw !== 'object') return [];
  const out: WsRecallSource[] = [];
  const buckets: Array<[string, any]> = [
    ['memory', raw.memories],
    ['item', raw.items],
    ['task', raw.tasks],
    ['project', raw.projects],
  ];
  for (const [defaultKind, arr] of buckets) {
    if (!Array.isArray(arr)) continue;
    for (const s of arr) {
      out.push({
        kind: s?.kind || defaultKind,
        id: s?.id,
        title: s?.title || s?.text || s?.name || 'Untitled',
        url: s?.url || s?.source_url,
        snippet: s?.snippet || s?.summary,
        project_id: s?.project_id,
        project_name: s?.project_name,
      });
    }
  }
  return out;
};

const ProgressRing: React.FC<{ pct: number; color: string; size?: number; stroke?: number; showLabel?: boolean }> = ({ pct, color, size = 64, stroke = 6, showLabel = true }) => {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const safe = Math.max(0, Math.min(100, pct || 0));
  const dash = (safe / 100) * c;
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={r} stroke="var(--border)" strokeWidth={stroke} fill="none" />
        <circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={stroke} fill="none"
          strokeLinecap="round" strokeDasharray={`${dash} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: 'stroke-dasharray 600ms ease-out' }} />
      </svg>
      {showLabel && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', lineHeight: 1 }}>
          <div style={{ fontSize: size * 0.28, fontWeight: 800, color: 'var(--text-1)', letterSpacing: '-0.5px' }}>{safe}</div>
          <div style={{ fontSize: 8.5, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700, marginTop: 2 }}>%</div>
        </div>
      )}
    </div>
  );
};

const SECTION_META: Record<WorkspaceSectionId, { name: string; icon: any; color: string }> = {
  notes:     { name: 'Notes',     icon: StickyNote, color: '#6366f1' },
  tasks:     { name: 'Tasks',     icon: CheckSquare, color: '#22c55e' },
  ideas:     { name: 'Ideas',     icon: Lightbulb,  color: '#f59e0b' },
  resources: { name: 'Resources', icon: Link2,      color: '#06b6d4' },
};
const SECTION_ORDER: WorkspaceSectionId[] = ['notes', 'tasks', 'ideas', 'resources'];

const WorkspacePage: React.FC = () => {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [projects, setProjects] = useState<WsProject[]>([]);
  const [activeId, setActiveId] = useState<string>(params.get('project') || '');
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showNewProject, setShowNewProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectDesc, setNewProjectDesc] = useState('');
  const [newTaskText, setNewTaskText] = useState('');
  const [newTaskDue, setNewTaskDue] = useState('');
  const [activeFolder, setActiveFolder] = useState<string>('');
  const [activeSection, setActiveSection] = useState<WorkspaceSectionId | ''>('');
  const [templates, setTemplates] = useState<WsTemplate[]>([]);
  const [templateChoice, setTemplateChoice] = useState<string>('blank');
  const [draggedItemId, setDraggedItemId] = useState<string>('');
  const [dragOverSection, setDragOverSection] = useState<string>('');
  const [flashing, setFlashing] = useState<string>('');
  const [groupBy, setGroupBy] = useState(false);
  const [organizing, setOrganizing] = useState(false);
  const [organizePipeline, setOrganizePipeline] = useState<AgentStep[] | null>(null);
  const [organizeFull, setOrganizeFull] = useState<WorkspaceOrganizeResult | null>(null);
  const [overview, setOverview] = useState<WsOverview | null>(null);
  const [analytics, setAnalytics] = useState<WsAnalytics | null>(null);
  const [recallQuery, setRecallQuery] = useState('');
  const [recallScope, setRecallScope] = useState<'global' | 'project'>('project');
  const [recallLoading, setRecallLoading] = useState(false);
  const [recallResult, setRecallResult] = useState<WsRecallResult | null>(null);

  const loadProjects = useCallback(async () => {
    try {
      const res = await fetch('/workspace/projects');
      const data = await res.json();
      const list: WsProject[] = data.projects || [];
      setProjects(list);
      if (list.length && !list.find(p => p.id === activeId)) {
        setActiveId(list[0].id);
      }
    } finally {
      setLoading(false);
    }
  }, [activeId]);

  useEffect(() => { loadProjects(); }, []);  // eslint-disable-line

  useEffect(() => {
    fetch('/workspace/templates')
      .then(r => r.ok ? r.json() : { templates: [] })
      .then(d => setTemplates(d.templates || []))
      .catch(() => { /* silent */ });
  }, []);

  useEffect(() => {
    if (activeId) setParams(p => { const np = new URLSearchParams(p); np.set('project', activeId); return np; }, { replace: true });
  }, [activeId, setParams]);

  const loadOverview = useCallback(async () => {
    try {
      const res = await fetch('/workspace/overview');
      if (res.ok) setOverview(await res.json());
    } catch { /* silent */ }
  }, []);

  useEffect(() => { loadOverview(); }, [loadOverview, projects.length]);

  const loadAnalytics = useCallback(async (pid: string) => {
    try {
      const res = await fetch(`/workspace/projects/${pid}/analytics`);
      if (res.ok) setAnalytics(await res.json());
      else setAnalytics(null);
    } catch { setAnalytics(null); }
  }, []);

  useEffect(() => {
    if (activeId) loadAnalytics(activeId);
    else setAnalytics(null);
  }, [activeId, loadAnalytics, projects]);

  const runRecall = async () => {
    const q = recallQuery.trim();
    if (!q) return;
    setRecallLoading(true);
    setRecallResult(null);
    try {
      const body: any = { query: q, limit: 12 };
      if (recallScope === 'project' && activeId) body.project_id = activeId;
      const res = await fetch('/workspace/recall', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setRecallResult({
          ok: true,
          answer: data?.answer,
          citations: data?.citations,
          counts: data?.counts,
          sources: flattenRecallSources(data?.sources),
        });
      } else setRecallResult({ ok: false, error: data?.detail || data?.error || 'recall failed' });
    } catch (e: any) {
      setRecallResult({ ok: false, error: e?.message || 'network error' });
    } finally {
      setRecallLoading(false);
    }
  };

  const project = projects.find(p => p.id === activeId);

  const refreshProject = async (id: string) => {
    const res = await fetch(`/workspace/projects/${id}`);
    if (!res.ok) return;
    const data = await res.json();
    setProjects(prev => prev.map(p => p.id === id ? data : p));
  };

  const createProject = async () => {
    if (!newProjectName.trim()) return;
    setCreating(true);
    try {
      let data: any;
      let res: Response;
      if (templateChoice && templateChoice !== 'blank') {
        res = await fetch('/workspace/projects/from-template', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ template_id: templateChoice, name: newProjectName.trim() }),
        });
      } else {
        res = await fetch('/workspace/projects', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: newProjectName.trim(), description: newProjectDesc.trim(), goal_type: 'general' }),
        });
      }
      data = await res.json();
      if (res.ok) {
        setProjects(prev => [data, ...prev]);
        setActiveId(data.id);
        setNewProjectName(''); setNewProjectDesc(''); setShowNewProject(false);
        setTemplateChoice('blank');
        const tmplName = templates.find(t => t.id === templateChoice)?.name;
        const note = tmplName && tmplName !== 'Blank project' ? ` from "${tmplName}" template` : '';
        window.dispatchEvent(new CustomEvent('recall-toast', { detail: { msg: `Project "${data.name}" created${note}`, type: 'success' } }));
      }
    } finally { setCreating(false); }
  };

  const quickStartFromTemplate = async (tmpl: WsTemplate) => {
    setCreating(true);
    try {
      const res = await fetch('/workspace/projects/from-template', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ template_id: tmpl.id, name: tmpl.name }),
      });
      if (res.ok) {
        const data = await res.json();
        setProjects(prev => [data, ...prev]);
        setActiveId(data.id);
        window.dispatchEvent(new CustomEvent('recall-toast', { detail: { msg: `Started "${data.name}" from template`, type: 'success' } }));
      }
    } finally { setCreating(false); }
  };

  const deleteProject = async (id: string) => {
    if (!confirm('Delete this project?')) return;
    const res = await fetch(`/workspace/projects/${id}`, { method: 'DELETE' });
    if (res.ok) {
      setProjects(prev => prev.filter(p => p.id !== id));
      if (activeId === id) {
        const remaining = projects.filter(p => p.id !== id);
        setActiveId(remaining[0]?.id || '');
      }
    }
  };

  const addTask = async () => {
    if (!project || !newTaskText.trim()) return;
    const res = await fetch(`/workspace/projects/${project.id}/tasks`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: newTaskText.trim(),
        folder_id: activeFolder || undefined,
        due_date: newTaskDue || undefined,
      }),
    });
    if (res.ok) {
      setNewTaskText('');
      setNewTaskDue('');
      await refreshProject(project.id);
      loadOverview();
      if (activeId === project.id) loadAnalytics(project.id);
    }
  };

  const toggleTask = async (taskId: string) => {
    if (!project) return;
    await fetch(`/workspace/projects/${project.id}/tasks/${taskId}/toggle`, { method: 'POST' });
    await refreshProject(project.id);
    loadOverview();
    if (activeId === project.id) loadAnalytics(project.id);
  };

  const sendTaskToCalendar = async (task: WsTask) => {
    if (!project) return;
    if (!task.due_date) {
      window.dispatchEvent(new CustomEvent('recall-toast', { detail: { msg: 'Set a due date first to send to calendar', type: 'error' } }));
      return;
    }
    const res = await fetch(`/workspace/projects/${project.id}/tasks/${task.id}/to-calendar`, { method: 'POST' });
    if (res.ok) {
      await refreshProject(project.id);
      window.dispatchEvent(new CustomEvent('recall-toast', { detail: { msg: `"${task.text}" added to calendar`, type: 'success' } }));
    } else {
      const err = await res.json().catch(() => ({}));
      window.dispatchEvent(new CustomEvent('recall-toast', { detail: { msg: err.detail || 'Could not push to calendar', type: 'error' } }));
    }
  };

  const generateFlashcardsForItem = async (itemId: string) => {
    setFlashing(itemId);
    try {
      const res = await fetch(`/workspace/items/${itemId}/to-flashcards`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        const cards = data?.result?.flashcards?.length || 0;
        window.dispatchEvent(new CustomEvent('recall-toast', { detail: { msg: `Generated ${cards} flashcard${cards === 1 ? '' : 's'}`, type: 'success' } }));
      } else {
        window.dispatchEvent(new CustomEvent('recall-toast', { detail: { msg: data.detail || 'Could not generate flashcards', type: 'error' } }));
      }
    } finally { setFlashing(''); }
  };

  const exportProjectMarkdown = () => {
    if (!project) return;
    const url = `/workspace/projects/${project.id}/export.md`;
    window.open(url, '_blank');
  };

  const onItemDragStart = (e: React.DragEvent, itemId: string) => {
    e.dataTransfer.setData('text/plain', itemId);
    e.dataTransfer.effectAllowed = 'move';
    setDraggedItemId(itemId);
  };

  const onItemDragEnd = () => {
    setDraggedItemId('');
    setDragOverSection('');
  };

  const onSectionDrop = async (e: React.DragEvent, sid: WorkspaceSectionId) => {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/plain');
    setDragOverSection('');
    setDraggedItemId('');
    if (id) await moveItemToSection(id, sid);
  };

  const removeItem = async (itemId: string) => {
    if (!project) return;
    await fetch(`/workspace/projects/${project.id}/items/${itemId}`, { method: 'DELETE' });
    await refreshProject(project.id);
    loadOverview();
    if (activeId === project.id) loadAnalytics(project.id);
  };

  const runAiOrganize = async () => {
    if (!project) return;
    setOrganizing(true);
    setOrganizeFull(null);
    setOrganizePipeline([
      { name: 'Scanner', label: 'Scanner', status: 'running', out: 'Reading items, kinds, sources…' },
      { name: 'Sectioner', label: 'Sectioner', status: 'queued', out: 'Will route to sections' },
      { name: 'Tagger', label: 'Tagger', status: 'queued', out: 'Will generate 5-7 tags per item' },
      { name: 'Clusterer', label: 'Clusterer', status: 'queued', out: 'Will group similar items' },
    ]);
    const t1 = setTimeout(() => setOrganizePipeline(prev => prev ? [
      { ...prev[0], status: 'done' as const },
      { ...prev[1], status: 'running' as const },
      prev[2], prev[3],
    ] : null), 600);
    const t2 = setTimeout(() => setOrganizePipeline(prev => prev ? [
      prev[0], { ...prev[1], status: 'done' as const },
      { ...prev[2], status: 'running' as const }, prev[3],
    ] : null), 1400);
    const t3 = setTimeout(() => setOrganizePipeline(prev => prev ? [
      prev[0], prev[1], { ...prev[2], status: 'done' as const },
      { ...prev[3], status: 'running' as const },
    ] : null), 2200);
    try {
      const url = activeFolder
        ? `/workspace/projects/${project.id}/ai-organize-full?folder_id=${encodeURIComponent(activeFolder)}`
        : `/workspace/projects/${project.id}/ai-organize-full`;
      const res = await fetch(url, { method: 'POST' });
      const data: WorkspaceOrganizeResult = await res.json();
      [t1, t2, t3].forEach(clearTimeout);
      if (res.ok && data.ok) {
        setOrganizeFull(data);
        setOrganizePipeline(prev => prev ? prev.map(s => ({ ...s, status: 'done' as const })).concat([
          { name: 'Result', label: 'Result', status: 'done', out: `${data.stats?.assigned || 0} items · ${data.stats?.groups || 0} groups` },
        ]) : null);
      } else {
        setOrganizePipeline(prev => prev ? prev.map(s => ({ ...s, status: 'error' as const })) : null);
        window.dispatchEvent(new CustomEvent('recall-toast', { detail: { msg: data.error || 'AI organize failed', type: 'error' } }));
      }
    } catch (e: any) {
      [t1, t2, t3].forEach(clearTimeout);
      setOrganizePipeline(prev => prev ? prev.map(s => ({ ...s, status: 'error' as const })) : null);
      window.dispatchEvent(new CustomEvent('recall-toast', { detail: { msg: e?.message || 'Network error', type: 'error' } }));
    } finally {
      setOrganizing(false);
    }
  };

  const applyOrganization = async () => {
    if (!project || !organizeFull) return;
    const res = await fetch(`/workspace/projects/${project.id}/apply-organization`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assignments: organizeFull.assignments, groups: organizeFull.groups }),
    });
    const data = await res.json();
    if (res.ok && data.ok) {
      await refreshProject(project.id);
      loadOverview();
      if (activeId === project.id) loadAnalytics(project.id);
      setOrganizeFull(null);
      setOrganizePipeline(null);
      window.dispatchEvent(new CustomEvent('recall-toast', { detail: { msg: `Organized ${data.updated_items} items into ${data.groups?.length || 0} groups`, type: 'success' } }));
    } else {
      window.dispatchEvent(new CustomEvent('recall-toast', { detail: { msg: 'Apply failed', type: 'error' } }));
    }
  };

  const moveItemToSection = async (itemId: string, section: WorkspaceSectionId) => {
    if (!project) return;
    const res = await fetch(`/workspace/projects/${project.id}/items/${itemId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ section_id: section }),
    });
    if (res.ok) await refreshProject(project.id);
  };

  const card: React.CSSProperties = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14 };

  const itemsForFolder = (folderId: string): WsItem[] =>
    (project?.items || []).filter(it => (folderId === '' ? !it.folder_id : it.folder_id === folderId));

  const tasksForFolder = (folderId: string): WsTask[] =>
    (project?.tasks || []).filter(t => (folderId === '' ? !t.folder_id : t.folder_id === folderId));

  // Folder filter, then optional section filter.
  const baseItems = activeFolder ? itemsForFolder(activeFolder) : (project?.items || []);
  const visibleItems = activeSection
    ? baseItems.filter(it => (it.section_id || 'notes') === activeSection)
    : baseItems;
  const visibleTasks = activeFolder ? tasksForFolder(activeFolder) : (project?.tasks || []);

  // Section counts for the chip strip.
  const sectionCounts: Record<string, number> = {};
  for (const it of baseItems) {
    const s = it.section_id || 'notes';
    sectionCounts[s] = (sectionCounts[s] || 0) + 1;
  }

  // When grouping is on, bucket visible items by group_id (or "_ungrouped").
  const groupBuckets: { id: string; title: string; summary?: string; items: WsItem[] }[] = (() => {
    if (!groupBy) return [];
    const groupCatalog = project?.groups || [];
    const titleById: Record<string, { title: string; summary?: string }> =
      Object.fromEntries(groupCatalog.map(g => [g.id, { title: g.title, summary: g.summary }]));
    const buckets: Record<string, WsItem[]> = {};
    for (const it of visibleItems) {
      const gid = it.group_id || '_ungrouped';
      (buckets[gid] = buckets[gid] || []).push(it);
    }
    return Object.entries(buckets)
      .sort((a, b) => b[1].length - a[1].length)
      .map(([gid, items]) => ({
        id: gid,
        title: gid === '_ungrouped' ? 'Ungrouped' : (titleById[gid]?.title || gid),
        summary: gid === '_ungrouped' ? undefined : titleById[gid]?.summary,
        items,
      }));
  })();

  return (
    <div style={{ color: 'var(--text-1)', padding: '14px 0' }}>
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
        className="page-header" style={{ marginBottom: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 40, height: 40, borderRadius: 11, background: 'linear-gradient(135deg,#f59e0b,#d97706)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 14px rgba(245,158,11,0.35)' }}>
            <Kanban size={19} color="#fff" />
          </div>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0, letterSpacing: '-0.4px' }}>Workspace</h1>
            <p style={{ color: 'var(--text-3)', fontSize: 12, margin: '2px 0 0' }}>Agent-powered projects — folders, live resources, tasks. All persisted on backend.</p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => navigate('/plan')}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--text-2)', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
            <Sparkles size={13} /> Plan Generator
          </button>
        </div>
      </motion.div>

      {/* ── Workspace overview KPI strip ─────────────────────────────────── */}
      {overview && overview.totals.projects > 0 && (
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
          className="workspace-kpi-strip"
          style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 14 }}>
          {[
            { label: 'Projects',   value: overview.totals.projects,   icon: FolderTree,  color: '#6366f1' },
            { label: 'Items',      value: overview.totals.items,      icon: ListTree,    color: '#06b6d4' },
            { label: 'Tasks',      value: overview.totals.tasks,      icon: CheckSquare, color: '#22c55e' },
            { label: 'Done',       value: `${overview.totals.tasks_done}/${overview.totals.tasks}`, icon: CheckCheck, color: '#10b981', sub: `${overview.completion_pct}%` },
            { label: 'Done in 30d', value: overview.activity_30d.reduce((s, c) => s + c.count, 0), icon: Activity, color: '#f59e0b' },
          ].map((m, i) => {
            const Icon = m.icon as any;
            return (
              <motion.div key={m.label} initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: i * 0.04 }}
                style={{ ...card, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 6, borderTop: `2px solid ${m.color}55` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: m.color, fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700 }}>
                  <Icon size={12} /> {m.label}
                </div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                  <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-1)', letterSpacing: '-0.5px' }}>{m.value}</div>
                  {m.sub && <div style={{ fontSize: 11, fontWeight: 700, color: m.color }}>{m.sub}</div>}
                </div>
              </motion.div>
            );
          })}
        </motion.div>
      )}

      {/* ── Workspace Recall search bar ──────────────────────────────────── */}
      {projects.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
          style={{ ...card, padding: '12px 14px', marginBottom: 14, borderColor: 'rgba(99,102,241,0.25)', background: 'linear-gradient(135deg, rgba(99,102,241,0.04), rgba(124,58,237,0.03))' }}>
          <div className="workspace-recall-row" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Search size={14} color="#6366f1" />
            <span style={{ fontSize: 11, color: 'var(--text-2)', fontWeight: 700 }}>Workspace Recall</span>
            <div style={{ display: 'flex', gap: 4 }}>
              {(['project', 'global'] as const).map(s => (
                <button key={s} onClick={() => setRecallScope(s)} disabled={s === 'project' && !activeId}
                  style={{ padding: '3px 9px', background: recallScope === s ? 'rgba(99,102,241,0.15)' : 'transparent', border: `1px solid ${recallScope === s ? 'rgba(99,102,241,0.4)' : 'var(--border)'}`, borderRadius: 999, color: recallScope === s ? '#6366f1' : 'var(--text-3)', fontSize: 10, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', textTransform: 'capitalize', opacity: (s === 'project' && !activeId) ? 0.4 : 1 }}>
                  {s === 'project' ? `This project` : 'Everything'}
                </button>
              ))}
            </div>
            <input value={recallQuery} onChange={e => setRecallQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') runRecall(); }}
              placeholder='Ask anything — "what did I learn about retrieval pipelines?"'
              className="workspace-recall-input"
              style={{ flex: 1, minWidth: 0, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-1)', fontSize: 12, padding: '7px 11px', outline: 'none', fontFamily: 'inherit' }} />
            <button onClick={runRecall} disabled={recallLoading || !recallQuery.trim()}
              style={{ padding: '7px 14px', background: 'linear-gradient(135deg,#6366f1,#7c3aed)', border: 'none', borderRadius: 8, color: '#fff', fontSize: 11.5, fontWeight: 700, cursor: recallLoading ? 'wait' : 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 5, opacity: (recallLoading || !recallQuery.trim()) ? 0.6 : 1 }}>
              {recallLoading ? <><Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} /> Recalling…</> : <>Ask <ArrowRight size={11} /></>}
            </button>
          </div>
          {recallResult && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
              style={{ marginTop: 12, padding: '12px 14px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10 }}>
              {recallResult.ok ? (
                <>
                  {recallResult.answer && (
                    <p style={{ margin: '0 0 10px', color: 'var(--text-1)', fontSize: 13, lineHeight: 1.55 }}>
                      {recallResult.answer}
                    </p>
                  )}
                  {recallResult.sources && recallResult.sources.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <div style={{ fontSize: 10, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700 }}>
                        Sources · {recallResult.sources.length}
                      </div>
                      {recallResult.sources.slice(0, 6).map((s, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: 'var(--surface-2)', borderRadius: 8, fontSize: 11.5 }}>
                          <span style={{ width: 18, height: 18, borderRadius: 4, background: 'rgba(99,102,241,0.18)', color: '#6366f1', fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, flexShrink: 0 }}>{i + 1}</span>
                          <span style={{ fontSize: 9.5, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700, flexShrink: 0 }}>{s.kind}</span>
                          <span style={{ flex: 1, color: 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.title}</span>
                          {s.project_name && <span style={{ fontSize: 10, color: 'var(--text-3)' }}>{s.project_name}</span>}
                          {s.url && <a href={s.url} target="_blank" rel="noreferrer" style={{ color: '#6366f1', display: 'flex', alignItems: 'center' }}><ExternalLink size={11} /></a>}
                        </div>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <div style={{ fontSize: 12, color: '#ef4444' }}>Recall failed: {recallResult.error}</div>
              )}
            </motion.div>
          )}
        </motion.div>
      )}

      {loading ? (
        <div style={{ ...card, padding: '40px 24px', textAlign: 'center', color: 'var(--text-3)' }}>
          <Loader2 size={20} style={{ animation: 'spin 1s linear infinite', display: 'inline-block', marginBottom: 8 }} />
          <div style={{ fontSize: 12 }}>Loading projects…</div>
        </div>
      ) : projects.length === 0 ? (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          style={{ ...card, padding: '34px 24px 28px', textAlign: 'center' }}>
          <div style={{ width: 56, height: 56, borderRadius: 14, background: 'linear-gradient(135deg, rgba(245,158,11,0.18), rgba(217,119,6,0.10))', border: '1px solid rgba(245,158,11,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px' }}>
            <FolderPlus size={26} color="#f59e0b" />
          </div>
          <h3 style={{ fontSize: 17, fontWeight: 800, margin: '0 0 6px', color: 'var(--text-1)' }}>Your second brain starts here</h3>
          <p style={{ color: 'var(--text-2)', fontSize: 13, margin: '0 0 18px', maxWidth: 480, marginInline: 'auto', lineHeight: 1.5 }}>
            A workspace project keeps your captures, tasks, and insights together. Start blank, pick a template, or let the Plan Generator do the heavy lifting.
          </p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap', marginBottom: 18 }}>
            <button onClick={() => navigate('/plan')} style={{ padding: '9px 16px', background: 'linear-gradient(135deg,#6366f1,#4f46e5)', border: 'none', borderRadius: 10, color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Sparkles size={13} /> Open Plan Generator
            </button>
            <button onClick={() => setShowNewProject(true)} style={{ padding: '9px 16px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--text-1)', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 6 }}>
              <PlusCircle size={13} /> New blank project
            </button>
          </div>
          {templates.length > 1 && (
            <div>
              <div style={{ fontSize: 10, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.14em', fontWeight: 700, marginBottom: 10 }}>Or try a template</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, maxWidth: 720, marginInline: 'auto' }}>
                {templates.filter(t => t.id !== 'blank').map(t => (
                  <button key={t.id} onClick={() => quickStartFromTemplate(t)} disabled={creating}
                    style={{ padding: '12px 14px', background: 'var(--surface-2)', border: `1px solid ${t.color}40`, borderRadius: 12, color: 'var(--text-1)', cursor: creating ? 'wait' : 'pointer', fontFamily: 'inherit', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, fontSize: 12.5 }}>
                      <LayoutTemplate size={12} color={t.color} /> {t.name}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-3)', lineHeight: 1.4 }}>{t.description}</div>
                    <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 3 }}>
                      {t.folder_count} folders · {t.starter_task_count} starter tasks
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </motion.div>
      ) : (
        <div className="workspace-layout">
          {/* Left: project list */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {projects.map((p, i) => {
              const taskCount = p.tasks?.length || 0;
              const doneCount = p.tasks?.filter(t => t.done).length || 0;
              const itemCount = p.items?.length || 0;
              const pct = taskCount > 0 ? Math.round((doneCount / taskCount) * 100) : 0;
              const isActive = activeId === p.id;
              return (
                <motion.button key={p.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.04 }}
                  onClick={() => { setActiveId(p.id); setActiveFolder(''); }}
                  style={{ ...card, padding: '12px 14px', cursor: 'pointer', border: `1px solid ${isActive ? p.color + '40' : 'var(--border)'}`, background: isActive ? `${p.color}10` : 'var(--surface)', textAlign: 'left', fontFamily: 'inherit', transition: 'all 0.2s', position: 'relative', display: 'flex', alignItems: 'center', gap: 11 }}>
                  <ProgressRing pct={pct} color={p.color} size={42} stroke={4} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                      <div style={{ width: 6, height: 6, borderRadius: '50%', background: p.color, boxShadow: isActive ? `0 0 8px ${p.color}` : 'none', flexShrink: 0 }} />
                      <span style={{ color: isActive ? 'var(--text-1)' : 'var(--text-2)', fontSize: 13, fontWeight: isActive ? 700 : 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 6, fontSize: 10, color: 'var(--text-3)' }}>
                      <span>{itemCount} items</span>
                      <span>·</span>
                      <span>{taskCount} tasks</span>
                      {taskCount > 0 && <><span>·</span><span>{doneCount}/{taskCount} done</span></>}
                    </div>
                  </div>
                </motion.button>
              );
            })}
            {showNewProject ? (
              <div style={{ ...card, padding: '12px 14px' }}>
                <input autoFocus value={newProjectName} onChange={e => setNewProjectName(e.target.value)}
                  placeholder="Project name…"
                  style={{ width: '100%', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 7, color: 'var(--text-1)', fontSize: 12, padding: '6px 10px', outline: 'none', fontFamily: 'inherit', marginBottom: 6 }} />
                <input value={newProjectDesc} onChange={e => setNewProjectDesc(e.target.value)}
                  placeholder="Short description (optional)"
                  style={{ width: '100%', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 7, color: 'var(--text-1)', fontSize: 11.5, padding: '6px 10px', outline: 'none', fontFamily: 'inherit', marginBottom: 8 }} />
                {templates.length > 0 && (
                  <div style={{ marginBottom: 8 }}>
                    <div style={{ fontSize: 9.5, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.12em', fontWeight: 700, marginBottom: 5 }}>Template</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {templates.map(t => {
                        const sel = templateChoice === t.id;
                        return (
                          <button key={t.id} onClick={() => setTemplateChoice(t.id)} title={t.description}
                            style={{ padding: '4px 8px', background: sel ? t.color + '25' : 'var(--surface-2)', border: `1px solid ${sel ? t.color + '60' : 'var(--border)'}`, borderRadius: 12, color: sel ? 'var(--text-1)' : 'var(--text-3)', fontSize: 10.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                            {t.id === 'blank' ? 'Blank' : t.name}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={createProject} disabled={creating || !newProjectName.trim()}
                    style={{ flex: 1, padding: '6px 0', background: 'rgba(245,158,11,0.15)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 7, color: '#f59e0b', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                    {creating ? 'Creating…' : 'Add'}
                  </button>
                  <button onClick={() => { setShowNewProject(false); setTemplateChoice('blank'); }}
                    style={{ flex: 1, padding: '6px 0', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 7, color: 'var(--text-3)', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
                </div>
              </div>
            ) : (
              <button onClick={() => setShowNewProject(true)}
                style={{ padding: '10px 14px', background: 'transparent', border: '1px dashed var(--border-2)', borderRadius: 12, color: 'var(--text-3)', fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 7, fontFamily: 'inherit' }}>
                <PlusCircle size={13} /> New Project
              </button>
            )}
          </div>

          {/* Right: project detail */}
          {project && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Project hero */}
              <motion.div key={project.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                style={{ ...card, padding: '16px 20px', border: `1px solid ${project.color}30` }}>
                <div className="workspace-hero-actions" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <div style={{ width: 10, height: 10, borderRadius: '50%', background: project.color, boxShadow: `0 0 12px ${project.color}`, flexShrink: 0 }} />
                  <h2 style={{ color: 'var(--text-1)', fontSize: 16, fontWeight: 800, margin: 0, flex: 1, minWidth: 120 }}>{project.name}</h2>
                  <button onClick={runAiOrganize} disabled={organizing}
                    style={{ padding: '7px 12px', background: 'linear-gradient(135deg,#6366f1,#7c3aed)', border: 'none', borderRadius: 9, color: '#fff', fontSize: 11.5, fontWeight: 700, cursor: organizing ? 'wait' : 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 6, opacity: organizing ? 0.7 : 1 }}>
                    {organizing ? <><Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> Organizing…</> : <><Wand2 size={12} /> AI Organize</>}
                  </button>
                  <button onClick={() => {
                      const qs = new URLSearchParams({ mode: 'workspace', project_id: project.id });
                      if (activeFolder) qs.set('folder_id', activeFolder);
                      navigate(`/timeline?${qs.toString()}`);
                    }}
                    style={{ padding: '7px 12px', background: 'var(--surface-2)', border: '1px solid rgba(167,139,250,0.4)', borderRadius: 9, color: '#a78bfa', fontSize: 11.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 6 }}
                    title="See how capture → insight → task → memory connect for this project">
                    <GitBranch size={12} /> Timeline
                  </button>
                  <button onClick={exportProjectMarkdown}
                    style={{ padding: '7px 12px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 9, color: 'var(--text-2)', fontSize: 11.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 6 }}
                    title="Download a Markdown summary of this project">
                    <Download size={12} /> Export .md
                  </button>
                  <button onClick={() => deleteProject(project.id)}
                    style={{ padding: '7px 9px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 9, color: '#ef4444', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 5 }}
                    title="Delete project">
                    <Trash2 size={12} />
                  </button>
                </div>
                {project.description && <p style={{ color: 'var(--text-3)', fontSize: 12, margin: '8px 0 0 20px' }}>{project.description}</p>}
              </motion.div>

              {/* ── Per-project analytics: KPIs + 30-day heatmap + top tags ── */}
              {analytics && (
                <motion.div key={`an-${analytics.project_id}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                  className="workspace-analytics-grid"
                  style={{ ...card, padding: '14px 18px', display: 'grid', gridTemplateColumns: 'minmax(200px, 280px) 1fr', gap: 18, alignItems: 'stretch' }}>
                  {/* Left: progress ring + key metrics */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                    <ProgressRing pct={analytics.completion_pct} color={analytics.color} size={68} />
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
                      <div style={{ fontSize: 10, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.12em', fontWeight: 700 }}>Project pulse</div>
                      <div style={{ fontSize: 13, color: 'var(--text-1)', fontWeight: 700 }}>
                        {analytics.totals.tasks_done}/{analytics.totals.tasks} tasks · {analytics.totals.items} items
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-3)', display: 'flex', alignItems: 'center', gap: 5 }}>
                        <Clock size={10} /> {analytics.age_days}d old · {analytics.totals.folders} folder{analytics.totals.folders === 1 ? '' : 's'}
                      </div>
                      {analytics.totals.groups > 0 && (
                        <div style={{ fontSize: 10.5, color: '#6366f1', display: 'flex', alignItems: 'center', gap: 5, fontWeight: 700 }}>
                          <Layers size={10} /> {analytics.totals.groups} AI group{analytics.totals.groups === 1 ? '' : 's'}
                        </div>
                      )}
                    </div>
                  </div>
                  {/* Right: 30-day mini heatmap + top tags */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.12em', fontWeight: 700 }}>
                          <Activity size={10} /> Last 30 days
                        </div>
                        <div style={{ fontSize: 10.5, color: 'var(--text-3)' }}>
                          {analytics.activity_30d.reduce((s, d) => s + d.count, 0)} events
                        </div>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(30, 1fr)', gap: 3 }}>
                        {analytics.activity_30d.map((d, i) => {
                          const intensity = analytics.activity_max ? Math.min(d.count / Math.max(1, analytics.activity_max), 1) : 0;
                          const bg = d.count === 0
                            ? 'var(--surface-2)'
                            : `${analytics.color}${Math.round(40 + intensity * 80).toString(16).padStart(2, '0')}`;
                          return (
                            <div key={i} title={`${d.date} · ${d.count} event${d.count === 1 ? '' : 's'}`}
                              style={{ aspectRatio: '1 / 1', borderRadius: 3, background: bg, border: '1px solid var(--border)' }} />
                          );
                        })}
                      </div>
                    </div>
                    {analytics.top_tags.length > 0 && (
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.12em', fontWeight: 700, marginBottom: 5 }}>
                          <Tag size={10} /> Top tags
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                          {analytics.top_tags.slice(0, 8).map(t => (
                            <span key={t.tag} style={{ padding: '3px 9px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 999, fontSize: 10.5, color: 'var(--text-2)', fontWeight: 600 }}>
                              {t.tag} <span style={{ color: 'var(--text-3)', fontWeight: 700 }}>{t.count}</span>
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </motion.div>
              )}

              {/* Organize pipeline + result */}
              {organizePipeline && (
                <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
                  <AgentPipeline agents={organizePipeline} title="AI Organize pipeline" />
                </motion.div>
              )}
              {organizeFull && organizeFull.assignments.length > 0 && (
                <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
                  style={{ ...card, padding: '14px 18px', borderColor: 'rgba(99,102,241,0.3)', background: 'linear-gradient(135deg, rgba(99,102,241,0.06), rgba(124,58,237,0.04))' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
                    <Wand2 size={14} color="#6366f1" />
                    <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-1)' }}>
                      AI proposal · {organizeFull.stats?.assigned || 0} item{(organizeFull.stats?.assigned || 0) === 1 ? '' : 's'} · {organizeFull.stats?.groups || 0} group{(organizeFull.stats?.groups || 0) === 1 ? '' : 's'}
                    </span>
                    <button onClick={applyOrganization}
                      style={{ marginLeft: 'auto', padding: '5px 12px', background: '#6366f1', border: 'none', borderRadius: 8, color: '#fff', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 5 }}>
                      <Save size={11} /> Apply
                    </button>
                    <button onClick={() => { setOrganizeFull(null); setOrganizePipeline(null); }}
                      style={{ padding: '5px 8px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-3)', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>
                      <X size={11} />
                    </button>
                  </div>
                  {/* Section breakdown */}
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                    {SECTION_ORDER.map(sid => {
                      const cnt = organizeFull.assignments.filter(a => a.section_id === sid).length;
                      if (cnt === 0) return null;
                      const Sec = SECTION_META[sid];
                      const Icon = Sec.icon;
                      return (
                        <div key={sid} style={{ padding: '4px 10px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, fontSize: 11, color: 'var(--text-2)', display: 'flex', alignItems: 'center', gap: 5 }}>
                          <Icon size={10} color={Sec.color} />{Sec.name} ({cnt})
                        </div>
                      );
                    })}
                  </div>
                  {/* Group catalog */}
                  {organizeFull.groups.length > 0 && (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {organizeFull.groups.map(g => (
                        <div key={g.id} title={g.summary || ''}
                          style={{ padding: '4px 10px', background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.2)', borderRadius: 14, fontSize: 11, color: '#818cf8', display: 'flex', alignItems: 'center', gap: 5 }}>
                          <Layers size={10} />{g.title}
                        </div>
                      ))}
                    </div>
                  )}
                </motion.div>
              )}

              {/* Folders strip */}
              {project.folders && project.folders.length > 0 && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                  <FolderTree size={13} color="var(--text-3)" />
                  <button onClick={() => setActiveFolder('')}
                    style={{ padding: '5px 11px', background: activeFolder === '' ? project.color + '20' : 'var(--surface-2)', border: `1px solid ${activeFolder === '' ? project.color + '40' : 'var(--border)'}`, borderRadius: 14, color: activeFolder === '' ? 'var(--text-1)' : 'var(--text-3)', fontSize: 11.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                    All ({project.items?.length || 0})
                  </button>
                  {project.folders.map(f => {
                    const cnt = itemsForFolder(f.id).length;
                    const isAct = activeFolder === f.id;
                    return (
                      <button key={f.id} onClick={() => setActiveFolder(f.id)}
                        style={{ padding: '5px 11px', background: isAct ? project.color + '20' : 'var(--surface-2)', border: `1px solid ${isAct ? project.color + '40' : 'var(--border)'}`, borderRadius: 14, color: isAct ? 'var(--text-1)' : 'var(--text-3)', fontSize: 11.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                        {f.name} ({cnt})
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Two-column inner: Items + Tasks */}
              <div className="workspace-inner">
                {/* Items */}
                <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} style={{ ...card, padding: '14px 18px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                    <div style={{ color: 'var(--text-2)', fontWeight: 700, fontSize: 13 }}>
                      Resources & memories <span style={{ color: 'var(--text-3)', fontWeight: 500 }}>· {visibleItems.length}</span>
                    </div>
                    <button onClick={() => navigate('/discover')}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)', display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, fontFamily: 'inherit' }}>
                      <Plus size={12} /> Discover
                    </button>
                  </div>
                  {/* Section chip strip — also drop targets for drag-and-drop */}
                  <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 10 }}>
                    <button onClick={() => setActiveSection('')}
                      style={{ padding: '4px 10px', background: activeSection === '' ? 'var(--surface-3)' : 'var(--surface-2)', border: `1px solid ${activeSection === '' ? 'var(--border-2)' : 'var(--border)'}`, borderRadius: 12, color: activeSection === '' ? 'var(--text-1)' : 'var(--text-3)', fontSize: 10.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                      All
                    </button>
                    {SECTION_ORDER.map(sid => {
                      const Sec = SECTION_META[sid];
                      const Icn = Sec.icon;
                      const cnt = sectionCounts[sid] || 0;
                      const sel = activeSection === sid;
                      const dragOver = dragOverSection === sid;
                      return (
                        <button key={sid}
                          onClick={() => setActiveSection(sid === activeSection ? '' : sid)}
                          onDragOver={e => { if (draggedItemId) { e.preventDefault(); setDragOverSection(sid); } }}
                          onDragLeave={() => setDragOverSection('')}
                          onDrop={e => onSectionDrop(e, sid)}
                          title={`Drop items here to mark as "${Sec.name}"`}
                          style={{
                            padding: '4px 10px',
                            background: dragOver ? Sec.color + '30' : (sel ? Sec.color + '20' : 'var(--surface-2)'),
                            border: `1px solid ${dragOver ? Sec.color : (sel ? Sec.color + '50' : 'var(--border)')}`,
                            borderRadius: 12,
                            color: sel || dragOver ? 'var(--text-1)' : 'var(--text-3)',
                            fontSize: 10.5,
                            fontWeight: 700,
                            cursor: 'pointer',
                            fontFamily: 'inherit',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 4,
                            transform: dragOver ? 'scale(1.05)' : 'scale(1)',
                            transition: 'transform 120ms ease',
                          }}>
                          <Icn size={10} color={Sec.color} /> {Sec.name} {cnt > 0 && <span style={{ opacity: 0.7 }}>({cnt})</span>}
                        </button>
                      );
                    })}
                    {draggedItemId && (
                      <span style={{ fontSize: 10, color: 'var(--text-3)', alignSelf: 'center', marginLeft: 6 }}>Drop on a section</span>
                    )}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 7, maxHeight: 480, overflowY: 'auto' }}>
                    <AnimatePresence>
                      {visibleItems.map(it => {
                        const isVid = it.meta?.type === 'video' || !!it.meta?.youtube_id;
                        const isMem = it.kind === 'memory';
                        const dragging = draggedItemId === it.id;
                        return (
                          <motion.div key={it.id} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 6 }}>
                          <div
                            draggable
                            onDragStart={e => onItemDragStart(e, it.id)}
                            onDragEnd={onItemDragEnd}
                            style={{ display: 'flex', gap: 8, padding: '7px 9px', borderRadius: 8, background: 'var(--surface-2)', alignItems: 'center', position: 'relative', opacity: dragging ? 0.5 : 1, cursor: 'grab' }}>
                            <GripVertical size={12} color="var(--text-3)" style={{ flexShrink: 0, opacity: 0.6 }} />
                            {isVid && it.meta?.thumbnail ? (
                              <img src={it.meta.thumbnail} alt="" style={{ width: 56, height: 32, objectFit: 'cover', borderRadius: 4, flexShrink: 0 }} />
                            ) : (
                              <div style={{ width: 24, height: 24, borderRadius: 5, background: 'var(--surface-3)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                {isVid ? <Youtube size={12} color="#ef4444" /> : <FileText size={12} color="var(--primary)" />}
                              </div>
                            )}
                            <div style={{ minWidth: 0, flex: 1 }}>
                              <div style={{ color: 'var(--text-1)', fontSize: 12, lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600 }}>{it.title}</div>
                              <div style={{ color: 'var(--text-3)', fontSize: 10, marginTop: 2, display: 'flex', gap: 5 }}>
                                {it.meta?.channel_title && <span>{it.meta.channel_title}</span>}
                                {it.meta?.duration_display && <span>· {it.meta.duration_display}</span>}
                                {it.meta?.domain && <span>{it.meta.domain}</span>}
                              </div>
                            </div>
                            {isMem && it.ref_id && (
                              <button onClick={() => generateFlashcardsForItem(it.id)} disabled={flashing === it.id}
                                style={{ background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.3)', color: '#f59e0b', cursor: flashing === it.id ? 'wait' : 'pointer', padding: '3px 7px', display: 'flex', alignItems: 'center', gap: 3, borderRadius: 6, fontSize: 10, fontWeight: 700, fontFamily: 'inherit' }}
                                title="Generate flashcards from this memory">
                                {flashing === it.id ? <Loader2 size={10} style={{ animation: 'spin 1s linear infinite' }} /> : <Zap size={10} />}
                                Cards
                              </button>
                            )}
                            {it.url && (
                              <a href={it.url} target="_blank" rel="noopener noreferrer"
                                style={{ color: 'var(--text-3)', display: 'flex', alignItems: 'center', padding: 4 }}>
                                <ExternalLink size={11} />
                              </a>
                            )}
                            <button onClick={() => removeItem(it.id)}
                              style={{ background: 'transparent', border: 'none', color: 'var(--text-3)', cursor: 'pointer', padding: 4, display: 'flex' }}
                              title="Remove">
                              <Trash2 size={11} />
                            </button>
                          </div>
                          </motion.div>
                        );
                      })}
                    </AnimatePresence>
                    {visibleItems.length === 0 && (
                      <div style={{ textAlign: 'center', padding: '24px 8px', color: 'var(--text-3)' }}>
                        <FileText size={20} style={{ opacity: 0.4, marginBottom: 8 }} />
                        <p style={{ fontSize: 12, margin: '0 0 4px', fontWeight: 600, color: 'var(--text-2)' }}>
                          {activeFolder ? 'This folder is empty' : activeSection ? `Nothing tagged "${SECTION_META[activeSection as WorkspaceSectionId]?.name}" yet` : 'No resources yet'}
                        </p>
                        <p style={{ fontSize: 11, margin: 0 }}>
                          Try Discover, Plan Generator, or drag items here from another section.
                        </p>
                      </div>
                    )}
                  </div>
                </motion.div>

                {/* Tasks */}
                <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} style={{ ...card, padding: '14px 18px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                    <div style={{ color: 'var(--text-2)', fontWeight: 700, fontSize: 13 }}>
                      Tasks <span style={{ color: 'var(--text-3)', fontWeight: 500 }}>· {visibleTasks.length}</span>
                    </div>
                    <span style={{ color: project.color, fontSize: 11, fontWeight: 700 }}>
                      {visibleTasks.length > 0 ? Math.round((visibleTasks.filter(t => t.done).length / visibleTasks.length) * 100) : 0}% done
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
                    <input value={newTaskText} onChange={e => setNewTaskText(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') addTask(); }}
                      placeholder={activeFolder ? `New task in folder…` : 'New task…'}
                      style={{ flex: '1 1 140px', minWidth: 0, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-1)', fontSize: 12, padding: '6px 10px', outline: 'none', fontFamily: 'inherit' }} />
                    <input type="date" value={newTaskDue} onChange={e => setNewTaskDue(e.target.value)}
                      title="Optional due date"
                      style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-2)', fontSize: 11, padding: '6px 8px', outline: 'none', fontFamily: 'inherit', colorScheme: 'dark light' }} />
                    <button onClick={addTask} disabled={!newTaskText.trim()}
                      style={{ padding: '6px 12px', background: 'var(--primary)', border: 'none', borderRadius: 8, color: '#fff', fontSize: 11, fontWeight: 700, cursor: !newTaskText.trim() ? 'not-allowed' : 'pointer', fontFamily: 'inherit', opacity: !newTaskText.trim() ? 0.5 : 1 }}>
                      Add
                    </button>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5, maxHeight: 480, overflowY: 'auto' }}>
                    <AnimatePresence>
                      {visibleTasks.map(t => {
                        const due = t.due_date || '';
                        const todayStr = new Date().toISOString().slice(0, 10);
                        const overdue = !!due && !t.done && due < todayStr;
                        const dueSoon = !!due && !t.done && due === todayStr;
                        const onCal = !!t.calendar_event_id;
                        return (
                          <motion.div key={t.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', borderRadius: 8, background: overdue ? 'rgba(239,68,68,0.07)' : 'var(--surface-2)', border: overdue ? '1px solid rgba(239,68,68,0.25)' : '1px solid transparent' }}>
                            <div onClick={() => toggleTask(t.id)} style={{ width: 16, height: 16, borderRadius: 4, border: `1.5px solid ${t.done ? project.color : 'var(--border-2)'}`, background: t.done ? project.color : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, cursor: 'pointer' }}>
                              {t.done && <CheckCheck size={10} color="#fff" />}
                            </div>
                            <span onClick={() => toggleTask(t.id)}
                              style={{ color: t.done ? 'var(--text-3)' : 'var(--text-2)', fontSize: 12, textDecoration: t.done ? 'line-through' : 'none', flex: 1, cursor: 'pointer', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {t.text}
                            </span>
                            {due && (
                              <span title={overdue ? 'Overdue' : dueSoon ? 'Due today' : `Due ${due}`}
                                style={{
                                  fontSize: 10,
                                  fontWeight: 700,
                                  padding: '2px 6px',
                                  borderRadius: 6,
                                  background: overdue ? 'rgba(239,68,68,0.15)' : dueSoon ? 'rgba(245,158,11,0.15)' : 'var(--surface-3)',
                                  color: overdue ? '#ef4444' : dueSoon ? '#f59e0b' : 'var(--text-3)',
                                  border: `1px solid ${overdue ? 'rgba(239,68,68,0.3)' : dueSoon ? 'rgba(245,158,11,0.3)' : 'var(--border)'}`,
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 3,
                                  flexShrink: 0,
                                }}>
                                <Clock size={9} /> {due.slice(5)}
                              </span>
                            )}
                            {due && !t.done && (
                              <button onClick={() => sendTaskToCalendar(t)}
                                title={onCal ? 'Already on calendar — re-send' : 'Send to calendar'}
                                style={{ background: onCal ? 'rgba(34,197,94,0.12)' : 'var(--surface-3)', border: `1px solid ${onCal ? 'rgba(34,197,94,0.3)' : 'var(--border)'}`, color: onCal ? '#22c55e' : 'var(--text-3)', cursor: 'pointer', padding: '3px 6px', display: 'flex', alignItems: 'center', borderRadius: 6, flexShrink: 0 }}>
                                <CalendarIcon size={10} />
                              </button>
                            )}
                          </motion.div>
                        );
                      })}
                    </AnimatePresence>
                    {visibleTasks.length === 0 && (
                      <div style={{ textAlign: 'center', padding: '20px 8px', color: 'var(--text-3)' }}>
                        <CheckSquare size={18} style={{ opacity: 0.4, marginBottom: 6 }} />
                        <p style={{ fontSize: 12, margin: '0 0 3px', fontWeight: 600, color: 'var(--text-2)' }}>Inbox zero</p>
                        <p style={{ fontSize: 11, margin: 0 }}>Add a task with a due date and push it straight to your calendar.</p>
                      </div>
                    )}
                  </div>
                </motion.div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default WorkspacePage;
