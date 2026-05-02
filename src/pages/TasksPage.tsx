import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Plus, Loader2, CheckCircle2, Clock, Trash2, CheckSquare, Zap, AlertTriangle, ArrowDown, Calendar, Filter, X, Link2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { card } from '../lib/ui';

const PRI_CONFIG: Record<string, { color: string; bg: string; border: string; icon: any; label: string }> = {
  high:   { color: '#ef4444', bg: 'rgba(239,68,68,0.1)',   border: 'rgba(239,68,68,0.25)',   icon: AlertTriangle, label: 'High' },
  medium: { color: '#f59e0b', bg: 'rgba(245,158,11,0.1)',  border: 'rgba(245,158,11,0.25)',  icon: Zap,           label: 'Medium' },
  low:    { color: '#10b981', bg: 'rgba(16,185,129,0.1)',  border: 'rgba(16,185,129,0.25)',  icon: ArrowDown,     label: 'Low' },
};

interface TasksPageProps { embedded?: boolean }
const TasksModule: React.FC<TasksPageProps> = ({ embedded = false }) => {
  const [tasks, setTasks] = useState<any[]>([]);
  const [completedTasks, setCompletedTasks] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showNewTask, setShowNewTask] = useState(false);
  const [newTask, setNewTask] = useState({ title: '', priority: 'medium', due_date: '' });
  const [tab, setTab] = useState<'pending' | 'completed'>('pending');
  const [filter, setFilter] = useState<string>('all');
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest');
  const [creating, setCreating] = useState(false);
  const [completingId, setCompletingId] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const focusId = searchParams.get('focus') || '';
  const [highlightId, setHighlightId] = useState<string>('');

  const fetchTasks = useCallback(() => {
    setIsLoading(true);
    Promise.all([
      fetch('/tasks?status=pending&limit=50').then(r => r.ok ? r.json() : []),
      fetch('/tasks?status=completed&limit=20').then(r => r.ok ? r.json() : [])
    ]).then(([pending, completed]) => {
      setTasks(pending); setCompletedTasks(completed); setIsLoading(false);
    }).catch(() => setIsLoading(false));
  }, []);

  useEffect(() => { fetchTasks(); }, [fetchTasks]);
  useEffect(() => { if (showNewTask) setTimeout(() => titleRef.current?.focus(), 80); }, [showNewTask]);

  // Calendar (or any other page) can deep-link to a specific task via ?focus=<id>.
  // Scroll it into view, briefly highlight, then strip the param so reloads stay clean.
  // A ref guards against re-running for the same id when fetchTasks re-fires.
  const processedFocusRef = useRef<string>('');
  const [missingFocus, setMissingFocus] = useState<string>('');
  useEffect(() => {
    if (!focusId || isLoading) return;
    if (processedFocusRef.current === focusId) return;
    const all = [...tasks, ...completedTasks];
    const target = all.find(t => t.id === focusId);
    processedFocusRef.current = focusId;

    if (!target) {
      // Linked task no longer exists (deleted, or in a different scope).
      setMissingFocus(focusId);
      const next = new URLSearchParams(searchParams);
      next.delete('focus');
      setSearchParams(next, { replace: true });
      const t = setTimeout(() => setMissingFocus(''), 4000);
      return () => clearTimeout(t);
    }

    if (target.status === 'completed' && tab !== 'completed') setTab('completed');
    if (target.status !== 'completed' && tab !== 'pending') setTab('pending');
    setHighlightId(focusId);
    requestAnimationFrame(() => {
      const el = document.getElementById(`task-row-${focusId}`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    const t = setTimeout(() => {
      setHighlightId('');
      const next = new URLSearchParams(searchParams);
      next.delete('focus');
      setSearchParams(next, { replace: true });
    }, 2400);
    return () => clearTimeout(t);
  }, [focusId, isLoading, tasks.length, completedTasks.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCreate = async () => {
    if (!newTask.title.trim() || creating) return;
    setCreating(true);
    try {
      await fetch('/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newTask) });
      setShowNewTask(false); setNewTask({ title: '', priority: 'medium', due_date: '' }); fetchTasks();
    } catch (err) { console.error(err); }
    finally { setCreating(false); }
  };

  const handleComplete = async (id: string) => {
    setCompletingId(id);
    try { await fetch(`/tasks/${id}/complete`, { method: 'POST' }); fetchTasks(); }
    catch (err) { console.error(err); }
    finally { setCompletingId(null); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this task?')) return;
    try { await fetch(`/tasks/${id}`, { method: 'DELETE' }); fetchTasks(); }
    catch (err) { console.error(err); }
  };

  // Robust epoch parser: backend returns created_at as ISO string, but legacy
  // rows can have a Firestore-style {seconds,nanoseconds} object or a number.
  // Anything we can't parse sinks to 0 so it stacks at the bottom of "newest".
  const epochOf = (t: any): number => {
    const v = t?.created_at ?? t?.createdAt ?? t?.created;
    if (!v) return 0;
    if (typeof v === 'number') return v < 1e12 ? v * 1000 : v;
    if (typeof v === 'string') { const n = Date.parse(v); return isNaN(n) ? 0 : n; }
    if (typeof v === 'object' && typeof v.seconds === 'number') return v.seconds * 1000;
    return 0;
  };

  // The priority filter chips only render in the Pending tab, so applying
  // the filter to Completed would silently hide rows the user can't see why
  // they're hidden. Scope it to pending only — Completed always shows all.
  const displayTasks = (tab === 'pending' ? tasks : completedTasks)
    .filter(t => tab !== 'pending' || filter === 'all' || t.priority === filter)
    .slice()
    .sort((a, b) => sortOrder === 'newest' ? epochOf(b) - epochOf(a) : epochOf(a) - epochOf(b));

  const overdue = tasks.filter(t => t.due_date && new Date(t.due_date) < new Date()).length;
  const today = tasks.filter(t => t.due_date && new Date(t.due_date).toDateString() === new Date().toDateString()).length;

  return (
    <div style={{ color: 'var(--text-1)' }}>
      {/* Header */}
      {!embedded && (
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 38, height: 38, borderRadius: 11, background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <CheckSquare size={17} color="#10b981" />
                </div>
                <div>
                  <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0, letterSpacing: '-0.4px' }}>Tasks</h1>
                  <p style={{ color: 'var(--text-3)', fontSize: 12, margin: '2px 0 0' }}>
                    {tasks.length} pending · {completedTasks.length} completed
                    {overdue > 0 && <span style={{ color: '#ef4444', marginLeft: 6, fontWeight: 600 }}>· {overdue} overdue</span>}
                  </p>
                </div>
              </div>
            </div>
            <button onClick={() => setShowNewTask(true)}
              style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '9px 16px', background: 'linear-gradient(135deg,#10b981,#059669)', border: 'none', borderRadius: 10, color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', boxShadow: '0 4px 12px rgba(16,185,129,0.35)', transition: 'all 0.15s' }}
              onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 6px 18px rgba(16,185,129,0.45)'; }}
              onMouseLeave={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = '0 4px 12px rgba(16,185,129,0.35)'; }}>
              <Plus size={15} /> New Task
            </button>
          </div>
        </motion.div>
      )}

      {/* Summary cards (always visible) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: 8, marginBottom: 14 }}>
        {[
          { label: 'Pending', value: tasks.length, color: '#6366f1' },
          { label: 'Due Today', value: today, color: '#f59e0b' },
          { label: 'Overdue', value: overdue, color: '#ef4444' },
          { label: 'Completed', value: completedTasks.length, color: '#10b981' },
        ].map(s => (
          <div key={s.label} style={{ ...card, padding: '12px 14px', border: `1px solid ${s.color}18`, textAlign: 'center' }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: s.color, lineHeight: 1 }}>{s.value}</div>
            <div style={{ fontSize: 10.5, color: 'var(--text-3)', marginTop: 3 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {embedded && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
          <button onClick={() => setShowNewTask(true)} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '8px 14px', background: 'linear-gradient(135deg,#10b981,#059669)', border: 'none', borderRadius: 9, color: '#fff', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
            <Plus size={13} /> New Task
          </button>
        </div>
      )}

      {/* Tab bar + filter */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, marginBottom: 14 }}>
        <div style={{ display: 'flex', background: 'var(--surface-3)', borderRadius: 10, padding: 3, border: '1px solid var(--border)' }}>
          {(['pending', 'completed'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              style={{ padding: '6px 16px', borderRadius: 7, border: 'none', cursor: 'pointer', fontFamily: 'inherit', background: tab === t ? 'var(--surface)' : 'transparent', color: tab === t ? 'var(--text-1)' : 'var(--text-3)', fontSize: 12, fontWeight: tab === t ? 700 : 500, transition: 'all 0.18s', boxShadow: tab === t ? 'var(--shadow-sm)' : 'none' }}>
              {t === 'pending' ? `Pending (${tasks.length})` : `Done (${completedTasks.length})`}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 5, alignItems: 'center', flexWrap: 'wrap' }}>
          {tab === 'pending' && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '5px 8px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-3)', fontSize: 10.5 }}>
                <Filter size={11} />
              </div>
              {['all', 'high', 'medium', 'low'].map(p => (
                <button key={p} onClick={() => setFilter(p)}
                  style={{ padding: '4px 10px', borderRadius: 8, border: `1px solid ${filter === p ? (PRI_CONFIG[p]?.border ?? 'var(--border)') : 'var(--border)'}`, background: filter === p ? (PRI_CONFIG[p]?.bg ?? 'var(--surface-2)') : 'var(--surface-2)', color: filter === p ? (PRI_CONFIG[p]?.color ?? 'var(--text-1)') : 'var(--text-3)', fontSize: 11, fontWeight: filter === p ? 700 : 500, cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.15s', textTransform: 'capitalize' }}>
                  {p === 'all' ? 'All' : p}
                </button>
              ))}
              <div style={{ width: 1, height: 18, background: 'var(--border)', margin: '0 4px' }} />
            </>
          )}
          {/* Sort: newest / oldest. Visible on both tabs so the user can browse
              recent vs early completions too. Active button is filled. */}
          <div title="Sort order" style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '5px 8px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-3)', fontSize: 10.5 }}>
            <Clock size={11} />
          </div>
          {(['newest', 'oldest'] as const).map(o => (
            <button key={o} onClick={() => setSortOrder(o)} data-testid={`button-sort-${o}`}
              style={{ padding: '4px 10px', borderRadius: 8, border: `1px solid ${sortOrder === o ? 'var(--primary-border)' : 'var(--border)'}`, background: sortOrder === o ? 'var(--primary-bg)' : 'var(--surface-2)', color: sortOrder === o ? 'var(--primary)' : 'var(--text-3)', fontSize: 11, fontWeight: sortOrder === o ? 700 : 500, cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.15s', textTransform: 'capitalize' }}>
              {o}
            </button>
          ))}
        </div>
      </div>

      {/* Inline new task form */}
      <AnimatePresence>
        {showNewTask && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
            style={{ overflow: 'hidden', marginBottom: 10 }}>
            <div style={{ ...card, padding: '16px 18px', border: '1px solid rgba(16,185,129,0.25)', background: 'rgba(16,185,129,0.03)', marginBottom: 2 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <Plus size={14} color="#10b981" />
                <span style={{ color: '#10b981', fontSize: 12, fontWeight: 700 }}>New Task</span>
              </div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <input ref={titleRef} type="text" placeholder="What needs to be done?" value={newTask.title}
                  onChange={e => setNewTask({ ...newTask, title: e.target.value })}
                  onKeyDown={e => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') setShowNewTask(false); }}
                  style={{ flex: 2, minWidth: 200, padding: '9px 12px', background: 'var(--surface)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: 9, color: 'var(--text-1)', fontSize: 13, outline: 'none', fontFamily: 'inherit' }}
                />
                <select value={newTask.priority} onChange={e => setNewTask({ ...newTask, priority: e.target.value })}
                  style={{ flex: 1, minWidth: 100, padding: '9px 10px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 9, color: 'var(--text-1)', fontSize: 12, outline: 'none', fontFamily: 'inherit' }}>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
                <input type="date" value={newTask.due_date} onChange={e => setNewTask({ ...newTask, due_date: e.target.value })}
                  style={{ flex: 1, minWidth: 130, padding: '9px 10px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 9, color: 'var(--text-1)', fontSize: 12, outline: 'none', fontFamily: 'inherit' }}
                />
                <button onClick={handleCreate} disabled={!newTask.title.trim() || creating}
                  style={{ padding: '9px 18px', background: 'linear-gradient(135deg,#10b981,#059669)', border: 'none', borderRadius: 9, color: '#fff', fontSize: 12, fontWeight: 700, cursor: newTask.title.trim() ? 'pointer' : 'default', fontFamily: 'inherit', opacity: newTask.title.trim() ? 1 : 0.5, display: 'flex', alignItems: 'center', gap: 5 }}>
                  {creating ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Plus size={13} />} Add
                </button>
                <button onClick={() => setShowNewTask(false)}
                  style={{ padding: '9px 9px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 9, color: 'var(--text-3)', cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center' }}>
                  <X size={14} />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {missingFocus && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
            style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 10, marginBottom: 10, fontSize: 12.5, color: '#b45309' }}>
            <AlertTriangle size={14} color="#f59e0b" />
            <span>The linked task isn't here anymore — it may have been deleted or completed and archived.</span>
            <button onClick={() => setMissingFocus('')} style={{ marginLeft: 'auto', background: 'transparent', border: 'none', cursor: 'pointer', color: '#b45309', display: 'flex' }}>
              <X size={13} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {isLoading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '60px 0' }}>
          <Loader2 size={28} color="#10b981" style={{ animation: 'spin 1s linear infinite' }} />
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          <AnimatePresence>
            {displayTasks.map((task, i) => {
              const pri = PRI_CONFIG[task.priority] ?? PRI_CONFIG.medium;
              const PriIcon = pri.icon;
              const isOverdue = task.due_date && new Date(task.due_date) < new Date() && tab === 'pending';
              return (
                <motion.div key={task.id} id={`task-row-${task.id}`} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: -30 }} transition={{ delay: i * 0.02 }}
                  style={{ ...card, padding: '13px 16px', display: 'flex', alignItems: 'center', gap: 12, transition: 'all 0.25s', position: 'relative', overflow: 'hidden', borderLeft: `3px solid ${tab === 'pending' ? pri.color : '#10b981'}`, boxShadow: highlightId === task.id ? '0 0 0 2px var(--primary), 0 8px 24px rgba(99,102,241,0.35)' : undefined, background: highlightId === task.id ? 'var(--primary-bg)' : undefined }}
                  onMouseEnter={e => { if (highlightId !== task.id) e.currentTarget.style.background = 'var(--surface-2)'; }}
                  onMouseLeave={e => { if (highlightId !== task.id) e.currentTarget.style.background = 'var(--surface)'; }}>

                  {/* Checkbox / check */}
                  {tab === 'pending' ? (
                    <button onClick={() => handleComplete(task.id)} disabled={completingId === task.id}
                      style={{ width: 24, height: 24, borderRadius: '50%', border: `2px solid ${pri.color}50`, background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'all 0.15s' }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor = '#10b981'; e.currentTarget.style.background = 'rgba(16,185,129,0.1)'; }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = `${pri.color}50`; e.currentTarget.style.background = 'transparent'; }}>
                      {completingId === task.id ? <Loader2 size={12} color="#10b981" style={{ animation: 'spin 1s linear infinite' }} /> : <CheckCircle2 size={12} color="transparent" />}
                    </button>
                  ) : (
                    <CheckCircle2 size={20} color="#10b981" style={{ flexShrink: 0 }} />
                  )}

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ color: tab === 'completed' ? 'var(--text-3)' : 'var(--text-1)', fontSize: 13.5, fontWeight: 600, margin: 0, textDecoration: tab === 'completed' ? 'line-through' : 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task.title}</p>
                    {task.due_date && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 3 }}>
                        {isOverdue ? <AlertTriangle size={10} color="#ef4444" /> : <Clock size={10} color="var(--text-3)" />}
                        <span style={{ fontSize: 10.5, color: isOverdue ? '#ef4444' : 'var(--text-3)', fontWeight: isOverdue ? 600 : 400 }}>
                          {isOverdue ? 'Overdue — ' : 'Due: '}{task.due_date}
                        </span>
                      </div>
                    )}
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexShrink: 0 }}>
                    {task.priority && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 9px', background: pri.bg, border: `1px solid ${pri.border}`, borderRadius: 20 }}>
                        <PriIcon size={9} color={pri.color} />
                        <span style={{ color: pri.color, fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{pri.label}</span>
                      </div>
                    )}
                    {task.linked_memory_id && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); navigate(`/memory/${task.linked_memory_id}`); }}
                        data-testid={`badge-task-from-memory-${task.id}`}
                        title="Open the memory this task came from"
                        style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 9px', background: 'rgba(6,182,212,0.12)', border: '1px solid rgba(6,182,212,0.3)', borderRadius: 20, color: '#06b6d4', cursor: 'pointer', fontFamily: 'inherit' }}
                      >
                        <Link2 size={9} />
                        <span style={{ fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px' }}>from memory</span>
                      </button>
                    )}
                    <button onClick={() => handleDelete(task.id)}
                      style={{ width: 28, height: 28, borderRadius: 7, border: '1px solid transparent', background: 'transparent', cursor: 'pointer', color: 'var(--text-3)', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.15s', opacity: 0 }}
                      className="task-delete-btn"
                      onMouseEnter={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.1)'; e.currentTarget.style.color = '#ef4444'; e.currentTarget.style.borderColor = 'rgba(239,68,68,0.2)'; }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-3)'; e.currentTarget.style.borderColor = 'transparent'; }}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>

          {displayTasks.length === 0 && (
            <div style={{ textAlign: 'center', padding: '52px 0' }}>
              <CheckSquare size={38} color="var(--border-2)" style={{ margin: '0 auto 12px' }} />
              <p style={{ color: 'var(--text-3)', margin: 0, fontSize: 14 }}>
                {tab === 'pending' ? (filter !== 'all' ? `No ${filter} priority tasks.` : 'All done! Add a new task to get started.') : 'No completed tasks yet.'}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default TasksModule;
