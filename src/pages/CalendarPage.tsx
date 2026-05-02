import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import AutoGrowTextarea from '../components/AutoGrowTextarea';
import {
  Calendar as CalIcon, Plus, Loader2, GraduationCap, X, Compass, Link as LinkIcon,
  Check, Copy, ChevronLeft, ChevronRight, LayoutGrid, List as ListIcon, Upload, Download,
  Tag, ArrowRight, Trash2, AlertCircle, ExternalLink,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

type EventItem = {
  id?: string;
  title: string;
  date: string;
  time: string;
  duration_minutes?: number;
  topic?: string;
  description?: string;
  linked_task_id?: string;
  linked_memory_id?: string;
  source?: string;
};

type Topic = { id: string; label: string; color: string };

const FALLBACK_TOPICS: Topic[] = [
  { id: 'Study',    label: 'Study',    color: '#6366f1' },
  { id: 'Work',     label: 'Work',     color: '#06b6d4' },
  { id: 'Personal', label: 'Personal', color: '#10b981' },
  { id: 'Research', label: 'Research', color: '#f59e0b' },
  { id: 'Health',   label: 'Health',   color: '#ef4444' },
  { id: 'Other',    label: 'Other',    color: '#94a3b8' },
];

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const card: React.CSSProperties = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16 };
const inputStyle: React.CSSProperties = { width: '100%', padding: '10px 14px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--text-1)', fontSize: 13, outline: 'none', fontFamily: 'inherit' };
const labelStyle: React.CSSProperties = { fontSize: 10.5, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'block', marginBottom: 5 };

const fmtDateLong = (d: Date) => d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
const isoDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const sameYMD = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

const CalendarModule: React.FC = () => {
  const navigate = useNavigate();
  const today = useMemo(() => new Date(), []);

  // Data
  const [events, setEvents] = useState<EventItem[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);
  const [topics, setTopics] = useState<Topic[]>(FALLBACK_TOPICS);
  const [isLoading, setIsLoading] = useState(true);

  // View state
  const [cursor, setCursor] = useState<Date>(new Date(today.getFullYear(), today.getMonth(), 1));
  // Default to "agenda" on phone-sized screens — the 7-column month grid
  // becomes too cramped (~50px per day cell) at 390px-wide viewports.
  // Users can still flip back to "month" via the toggle.
  const [view, setView] = useState<'month' | 'agenda'>(() =>
    typeof window !== 'undefined' && window.innerWidth <= 640 ? 'agenda' : 'month'
  );
  const [activeTopics, setActiveTopics] = useState<Set<string>>(new Set());

  // Modals
  const [showNewEvent, setShowNewEvent] = useState(false);
  const [showConnect, setShowConnect] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [dayDetail, setDayDetail] = useState<Date | null>(null);
  const [eventDetail, setEventDetail] = useState<EventItem | null>(null);

  // New event form
  const [newEvent, setNewEvent] = useState<EventItem>({
    title: '', date: isoDate(today), time: '09:00', duration_minutes: 60,
    topic: 'Study', description: '', linked_task_id: '',
  });
  const [creating, setCreating] = useState(false);

  // Connect wizard
  const [wizard, setWizard] = useState<any>(null);
  const [wizardStep, setWizardStep] = useState(1);
  const [icsCopied, setIcsCopied] = useState(false);

  // Import
  const [importText, setImportText] = useState('');
  const [importing, setImporting] = useState(false);
  const [importTopic, setImportTopic] = useState('Other');
  const [importResult, setImportResult] = useState<{ imported: number; failed: number; total_parsed: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const icsUrl = `${window.location.origin}/calendar.ics`;
  const webcalUrl = icsUrl.replace(/^https?:/, 'webcal:');

  // ------- Data fetching ----------
  const fetchAll = useCallback(() => {
    setIsLoading(true);
    Promise.all([
      fetch('/schedule?days=120').then(r => r.ok ? r.json() : []).catch(() => []),
      fetch('/tasks?status=pending&limit=100').then(r => r.ok ? r.json() : []).catch(() => []),
      fetch('/calendar/topics').then(r => r.ok ? r.json() : { topics: FALLBACK_TOPICS }).catch(() => ({ topics: FALLBACK_TOPICS })),
    ]).then(([evs, tks, tp]) => {
      setEvents(Array.isArray(evs) ? evs : []);
      setTasks(Array.isArray(tks) ? tks : []);
      setTopics(tp?.topics?.length ? tp.topics : FALLBACK_TOPICS);
    }).finally(() => setIsLoading(false));
  }, []);
  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Load wizard once when first opened
  useEffect(() => {
    if (showConnect && !wizard) {
      fetch('/calendar/google/wizard').then(r => r.ok ? r.json() : null).then(d => d && setWizard(d)).catch(() => {});
    }
  }, [showConnect, wizard]);

  // ------- Derived ----------
  const topicById = useMemo(() => {
    const m: Record<string, Topic> = {};
    topics.forEach(t => { m[t.id] = t; });
    return m;
  }, [topics]);

  const colorOf = (ev: EventItem): string => topicById[ev.topic || 'Other']?.color || '#94a3b8';

  const filteredEvents = useMemo(() => {
    if (activeTopics.size === 0) return events;
    return events.filter(e => activeTopics.has(e.topic || 'Other'));
  }, [events, activeTopics]);

  const eventsByDate = useMemo(() => {
    const map: Record<string, EventItem[]> = {};
    filteredEvents.forEach(e => {
      if (!e.date) return;
      (map[e.date] = map[e.date] || []).push(e);
    });
    Object.values(map).forEach(arr => arr.sort((a, b) => (a.time || '').localeCompare(b.time || '')));
    return map;
  }, [filteredEvents]);

  const upcoming = useMemo(() => {
    const todayStr = isoDate(today);
    return [...filteredEvents]
      .filter(e => e.date >= todayStr)
      .sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')))
      .slice(0, 12);
  }, [filteredEvents, today]);

  const monthLabel = cursor.toLocaleString('default', { month: 'long', year: 'numeric' });
  const daysInMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
  const firstWeekday = new Date(cursor.getFullYear(), cursor.getMonth(), 1).getDay();

  // ------- Handlers ----------
  const goPrev = () => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1));
  const goNext = () => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1));
  const goToday = () => setCursor(new Date(today.getFullYear(), today.getMonth(), 1));

  const toggleTopic = (id: string) => {
    setActiveTopics(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };

  const handleCreateEvent = async () => {
    if (!newEvent.title || !newEvent.date || !newEvent.time || creating) return;
    setCreating(true);
    try {
      await fetch('/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newEvent),
      });
      setShowNewEvent(false);
      setNewEvent({ title: '', date: isoDate(today), time: '09:00', duration_minutes: 60, topic: 'Study', description: '', linked_task_id: '' });
      fetchAll();
    } catch (err) { console.error(err); }
    finally { setCreating(false); }
  };

  const handleEventClick = (ev: EventItem) => {
    if (ev.linked_task_id) {
      navigate(`/tasks?focus=${encodeURIComponent(ev.linked_task_id)}`);
      return;
    }
    setEventDetail(ev);
  };

  const handleDeleteEvent = async (id?: string) => {
    if (!id) return;
    if (!confirm('Delete this event?')) return;
    try {
      await fetch(`/calendar/events/${id}`, { method: 'DELETE' });
      setEventDetail(null);
      fetchAll();
    } catch (err) { console.error(err); }
  };

  const copyIcs = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setIcsCopied(true);
      setTimeout(() => setIcsCopied(false), 2000);
    } catch {}
  };

  const onPickFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = e => setImportText(String(e.target?.result || ''));
    reader.readAsText(file);
  };

  const handleImport = async () => {
    if (!importText.trim() || importing) return;
    setImporting(true);
    setImportResult(null);
    try {
      const res = await fetch('/calendar/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ics_text: importText, topic: importTopic }),
      });
      const data = await res.json();
      setImportResult({ imported: data.imported || 0, failed: data.failed || 0, total_parsed: data.total_parsed || 0 });
      fetchAll();
    } catch (err) { console.error(err); }
    finally { setImporting(false); }
  };

  // ------- Render ----------
  return (
    <div style={{ color: 'var(--text-1)' }}>
      {/* Header */}
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 38, height: 38, borderRadius: 11, background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <CalIcon size={17} color="var(--primary)" />
          </div>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0, letterSpacing: '-0.4px' }}>Calendar</h1>
            <p style={{ color: 'var(--text-3)', fontSize: 12, margin: '2px 0 0' }}>
              {events.length} event{events.length === 1 ? '' : 's'} · {tasks.length} open task{tasks.length === 1 ? '' : 's'}
            </p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={() => navigate('/discover')} title="Find external articles & videos"
            style={btnGhost}>
            <Compass size={14} /> Discover
          </button>
          <button onClick={() => setShowConnect(true)} title="Connect Google / Apple / Outlook"
            style={{ ...btnGhost, color: '#06b6d4', borderColor: 'rgba(6,182,212,0.3)' }}>
            <LinkIcon size={14} /> Connect
          </button>
          <button onClick={() => setShowImport(true)} title="Import .ics file"
            style={btnGhost}>
            <Upload size={14} /> Import
          </button>
          <a href="/calendar.ics" download="recall-x247.ics" title="Download .ics" style={{ ...btnGhost, textDecoration: 'none' }}>
            <Download size={14} /> Export
          </a>
          <button onClick={() => navigate('/plan')} style={{ ...btnGhost, color: 'var(--primary)', borderColor: 'var(--primary-border)', background: 'var(--primary-bg)' }}>
            <GraduationCap size={14} /> AI Plan
          </button>
          <button onClick={() => setShowNewEvent(true)} style={btnPrimary}>
            <Plus size={14} /> New Event
          </button>
        </div>
      </div>

      {/* Toolbar: month nav + view toggle + topic chips */}
      <div style={{ ...card, padding: '12px 16px', marginBottom: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button onClick={goPrev} aria-label="Previous month" style={iconBtn}><ChevronLeft size={16} /></button>
            <button onClick={goToday} style={{ ...btnGhost, padding: '6px 12px', fontSize: 11.5 }}>Today</button>
            <button onClick={goNext} aria-label="Next month" style={iconBtn}><ChevronRight size={16} /></button>
            <h2 style={{ fontSize: 16, fontWeight: 800, margin: '0 0 0 8px', letterSpacing: '-0.3px' }}>{monthLabel}</h2>
          </div>
          <div style={{ display: 'flex', background: 'var(--surface-3)', borderRadius: 10, padding: 3, border: '1px solid var(--border)' }}>
            {([
              { id: 'month', label: 'Month', icon: LayoutGrid },
              { id: 'agenda', label: 'Agenda', icon: ListIcon },
            ] as const).map(v => {
              const VIcon = v.icon;
              const active = view === v.id;
              return (
                <button key={v.id} onClick={() => setView(v.id)}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 7, border: 'none', cursor: 'pointer', fontFamily: 'inherit', background: active ? 'var(--surface)' : 'transparent', color: active ? 'var(--text-1)' : 'var(--text-3)', fontSize: 11.5, fontWeight: active ? 700 : 500, transition: 'all 0.15s', boxShadow: active ? 'var(--shadow-sm)' : 'none' }}>
                  <VIcon size={12} /> {v.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Topic chips */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Tag size={12} color="var(--text-3)" />
          <span style={{ fontSize: 10.5, color: 'var(--text-3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', marginRight: 4 }}>Topics</span>
          {topics.map(t => {
            const active = activeTopics.has(t.id);
            const count = events.filter(e => (e.topic || 'Other') === t.id).length;
            return (
              <button key={t.id} onClick={() => toggleTopic(t.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 20,
                  background: active ? `${t.color}25` : 'var(--surface-2)',
                  border: `1px solid ${active ? t.color : 'var(--border)'}`,
                  color: active ? t.color : 'var(--text-2)', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                  transition: 'all 0.15s',
                }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: t.color }} />
                {t.label}
                <span style={{ fontSize: 10, opacity: 0.7 }}>{count}</span>
              </button>
            );
          })}
          {activeTopics.size > 0 && (
            <button onClick={() => setActiveTopics(new Set())}
              style={{ padding: '4px 10px', borderRadius: 20, background: 'transparent', border: '1px dashed var(--border)', color: 'var(--text-3)', fontSize: 10.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
              Clear filter
            </button>
          )}
        </div>
      </div>

      {/* Layout: calendar grid + sidebar */}
      <div className="calendar-layout">
        {/* Main view */}
        {view === 'month' ? (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} style={{ ...card, padding: '20px 24px' }}>
            {/* Day headers */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 4, marginBottom: 8 }}>
              {DAY_NAMES.map(d => (
                <div key={d} style={{ textAlign: 'center', fontSize: 10, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', padding: '4px 0' }}>{d}</div>
              ))}
            </div>
            {/* Day cells */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 4 }}>
              {Array.from({ length: firstWeekday }).map((_, i) => <div key={`e-${i}`} />)}
              {Array.from({ length: daysInMonth }).map((_, i) => {
                const day = i + 1;
                const date = new Date(cursor.getFullYear(), cursor.getMonth(), day);
                const isToday = sameYMD(date, today);
                const dayKey = isoDate(date);
                const dayEvs = eventsByDate[dayKey] || [];
                return (
                  <button key={day}
                    onClick={() => setDayDetail(date)}
                    style={{
                      minHeight: 78, borderRadius: 10, padding: 6, textAlign: 'left',
                      display: 'flex', flexDirection: 'column', gap: 4,
                      background: isToday ? 'var(--primary)' : 'var(--surface-2)',
                      border: `1px solid ${isToday ? 'transparent' : 'var(--border)'}`,
                      cursor: 'pointer', transition: 'all 0.15s', overflow: 'hidden',
                      fontFamily: 'inherit',
                    }}
                    onMouseEnter={e => { if (!isToday) (e.currentTarget as HTMLButtonElement).style.background = 'var(--surface-3)'; }}
                    onMouseLeave={e => { if (!isToday) (e.currentTarget as HTMLButtonElement).style.background = 'var(--surface-2)'; }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: isToday ? '#fff' : 'var(--text-2)' }}>{day}</span>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      {dayEvs.slice(0, 3).map((ev, ei) => (
                        <span key={ei}
                          onClick={e => { e.stopPropagation(); handleEventClick(ev); }}
                          style={{
                            fontSize: 9.5, lineHeight: 1.2, padding: '2px 5px', borderRadius: 5,
                            background: isToday ? 'rgba(255,255,255,0.2)' : `${colorOf(ev)}20`,
                            color: isToday ? '#fff' : colorOf(ev),
                            fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            borderLeft: `2px solid ${isToday ? 'rgba(255,255,255,0.6)' : colorOf(ev)}`,
                          }}>
                          {ev.title}
                        </span>
                      ))}
                      {dayEvs.length > 3 && (
                        <span style={{ fontSize: 9, color: isToday ? 'rgba(255,255,255,0.7)' : 'var(--text-3)', fontWeight: 600 }}>
                          +{dayEvs.length - 3} more
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </motion.div>
        ) : (
          /* AGENDA VIEW */
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} style={{ ...card, padding: '18px 22px' }}>
            <h3 style={{ fontWeight: 800, fontSize: 15, margin: '0 0 14px' }}>Agenda — {monthLabel}</h3>
            {(() => {
              const monthEvents = filteredEvents
                .filter(e => {
                  if (!e.date) return false;
                  const d = new Date(e.date);
                  return d.getFullYear() === cursor.getFullYear() && d.getMonth() === cursor.getMonth();
                })
                .sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));
              if (monthEvents.length === 0) {
                return (
                  <div style={{ textAlign: 'center', padding: '40px 0' }}>
                    <CalIcon size={28} color="var(--text-3)" style={{ margin: '0 auto 10px' }} />
                    <p style={{ color: 'var(--text-3)', fontSize: 13, margin: 0 }}>No events match the current filters this month.</p>
                  </div>
                );
              }
              const groups: Record<string, EventItem[]> = {};
              monthEvents.forEach(e => { (groups[e.date] = groups[e.date] || []).push(e); });
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {Object.entries(groups).map(([date, evs]) => {
                    const d = new Date(date);
                    return (
                      <div key={date}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>
                          {d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          {evs.map(ev => <AgendaRow key={ev.id || ev.title + ev.time} ev={ev} color={colorOf(ev)} onClick={() => handleEventClick(ev)} />)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </motion.div>
        )}

        {/* Sidebar: upcoming events.

            Layout trick (works only at >=860px when grid is 2-col):
            the OUTER motion.div is `position:relative` and intrinsically
            short — it just contains the small header. The INNER `.cal-upcoming-list`
            uses `position:absolute; inset:32px 0 0` so it stretches to fill
            whatever vertical space the grid row gives it (= calendar column
            height, since CSS-grid stretches both columns to the tallest
            sibling). Internal `overflow-y:auto` keeps a long event list
            from pushing the calendar down. On mobile (<860px) the absolute
            block falls back to normal flow via the media query. */}
        <motion.div className="cal-upcoming" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2, height: 22 }}>
            <h3 style={{ fontWeight: 700, fontSize: 14, margin: 0 }}>Upcoming</h3>
            {upcoming.length > 0 && <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{upcoming.length}</span>}
          </div>

          <div className="cal-upcoming-list">
          {isLoading ? (
            <div className="loading-center">
              <Loader2 size={22} color="var(--primary)" style={{ animation: 'spin 1s linear infinite' }} />
            </div>
          ) : upcoming.length > 0 ? upcoming.map((ev, idx) => (
            <motion.div key={(ev.id || idx) + ev.date}
              initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: idx * 0.03 }}
              onClick={() => handleEventClick(ev)}
              style={{ ...card, padding: '11px 13px', borderRadius: 12, cursor: 'pointer', borderLeft: `3px solid ${colorOf(ev)}`, transition: 'all 0.15s' }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface-2)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'var(--surface)'; }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 3 }}>
                <p style={{ fontSize: 10.5, fontWeight: 700, color: colorOf(ev), margin: 0 }}>
                  {ev.date} · {ev.time}
                </p>
                <span style={{ fontSize: 9, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.4px', fontWeight: 700 }}>
                  {ev.topic || 'Other'}
                </span>
              </div>
              <h4 style={{ fontWeight: 700, fontSize: 13, margin: '0 0 4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ev.title}</h4>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: 'var(--text-3)', flexWrap: 'wrap' }}>
                <span>{ev.duration_minutes || 60} min</span>
                {ev.linked_task_id && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); navigate(`/tasks?focus=${encodeURIComponent(ev.linked_task_id!)}`); }}
                    data-testid={`badge-event-task-${ev.id}`}
                    title="Open the linked task"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '2px 8px', borderRadius: 20, background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.3)', color: '#10b981', fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.4px', cursor: 'pointer', fontFamily: 'inherit' }}
                  >
                    <LinkIcon size={9} /> task
                  </button>
                )}
                {ev.linked_memory_id && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); navigate(`/memory/${ev.linked_memory_id}`); }}
                    data-testid={`badge-event-from-memory-${ev.id}`}
                    title="Open the memory this event came from"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '2px 8px', borderRadius: 20, background: 'rgba(6,182,212,0.12)', border: '1px solid rgba(6,182,212,0.3)', color: '#06b6d4', fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.4px', cursor: 'pointer', fontFamily: 'inherit' }}
                  >
                    <LinkIcon size={9} /> from memory
                  </button>
                )}
              </div>
            </motion.div>
          )) : (
            <div className="empty-state" style={{ ...card, borderStyle: 'dashed', borderRadius: 12, padding: '36px 16px' }}>
              <CalIcon size={28} color="var(--text-3)" />
              <p style={{ color: 'var(--text-3)', fontSize: 13, margin: 0 }}>No upcoming events</p>
              <button onClick={() => navigate('/plan')} style={{ padding: '6px 14px', background: 'var(--primary-bg)', border: '1px solid var(--primary-border)', borderRadius: 8, color: 'var(--primary)', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                Generate study plan
              </button>
            </div>
          )}
          </div>
        </motion.div>
      </div>

      {/* ------- New Event Modal ------- */}
      <AnimatePresence>
        {showNewEvent && (
          <ModalShell onClose={() => setShowNewEvent(false)} maxWidth={460}>
            <ModalHeader title="Schedule Event" onClose={() => setShowNewEvent(false)} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={labelStyle}>Event Title</label>
                <input autoFocus type="text" value={newEvent.title} onChange={e => setNewEvent({ ...newEvent, title: e.target.value })} placeholder="Study session, review, etc." style={inputStyle} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={labelStyle}>Date</label>
                  <input type="date" value={newEvent.date} onChange={e => setNewEvent({ ...newEvent, date: e.target.value })} style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>Time</label>
                  <input type="time" value={newEvent.time} onChange={e => setNewEvent({ ...newEvent, time: e.target.value })} style={inputStyle} />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={labelStyle}>Duration (min)</label>
                  <input type="number" value={newEvent.duration_minutes} onChange={e => setNewEvent({ ...newEvent, duration_minutes: parseInt(e.target.value) || 60 })} style={inputStyle} min={15} step={15} />
                </div>
                <div>
                  <label style={labelStyle}>Topic</label>
                  <select value={newEvent.topic} onChange={e => setNewEvent({ ...newEvent, topic: e.target.value })} style={{ ...inputStyle, padding: '10px 12px' }}>
                    {topics.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label style={labelStyle}>Link to Task (optional)</label>
                <select value={newEvent.linked_task_id} onChange={e => setNewEvent({ ...newEvent, linked_task_id: e.target.value })} style={{ ...inputStyle, padding: '10px 12px' }}>
                  <option value="">— None —</option>
                  {tasks.map((t: any) => (
                    <option key={t.id} value={t.id}>{t.title}{t.due_date ? ` · due ${t.due_date}` : ''}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Notes (optional)</label>
                <AutoGrowTextarea value={newEvent.description} onChange={e => setNewEvent({ ...newEvent, description: e.target.value })}
                  placeholder="Anything you want to remember about this event…"
                  rows={3}
                  style={{ ...inputStyle, minHeight: 70 }} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 22 }}>
              <button onClick={() => setShowNewEvent(false)} style={btnSecondaryWide}>Cancel</button>
              <button onClick={handleCreateEvent} disabled={creating} style={{ ...btnPrimaryWide, opacity: creating ? 0.6 : 1 }}>
                {creating ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Plus size={14} />}
                {creating ? 'Saving…' : 'Schedule'}
              </button>
            </div>
          </ModalShell>
        )}
      </AnimatePresence>

      {/* ------- Day Detail Modal ------- */}
      <AnimatePresence>
        {dayDetail && (
          <ModalShell onClose={() => setDayDetail(null)} maxWidth={520}>
            <ModalHeader title={fmtDateLong(dayDetail)} onClose={() => setDayDetail(null)} />
            {(() => {
              const dayKey = isoDate(dayDetail);
              const dayEvs = (eventsByDate[dayKey] || []);
              if (dayEvs.length === 0) {
                return (
                  <div style={{ textAlign: 'center', padding: '24px 0' }}>
                    <p style={{ color: 'var(--text-3)', fontSize: 13, margin: '0 0 14px' }}>No events on this day.</p>
                    <button onClick={() => { setNewEvent(n => ({ ...n, date: dayKey })); setDayDetail(null); setShowNewEvent(true); }}
                      style={btnPrimary}><Plus size={14} /> Add event for this day</button>
                  </div>
                );
              }
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {dayEvs.map(ev => <AgendaRow key={ev.id || ev.title + ev.time} ev={ev} color={colorOf(ev)} onClick={() => { setDayDetail(null); handleEventClick(ev); }} />)}
                  <button onClick={() => { setNewEvent(n => ({ ...n, date: dayKey })); setDayDetail(null); setShowNewEvent(true); }}
                    style={{ ...btnGhost, marginTop: 8, justifyContent: 'center' }}>
                    <Plus size={14} /> Add another event
                  </button>
                </div>
              );
            })()}
          </ModalShell>
        )}
      </AnimatePresence>

      {/* ------- Event Detail Modal (only for events without a linked task) ------- */}
      <AnimatePresence>
        {eventDetail && (
          <ModalShell onClose={() => setEventDetail(null)} maxWidth={460}>
            <ModalHeader title={eventDetail.title} onClose={() => setEventDetail(null)} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, fontSize: 13 }}>
              <Pill label="When" value={`${eventDetail.date} · ${eventDetail.time} · ${eventDetail.duration_minutes || 60} min`} />
              <Pill label="Topic" value={eventDetail.topic || 'Other'} color={colorOf(eventDetail)} />
              {eventDetail.source && eventDetail.source !== 'manual' && (
                <Pill label="Source" value={eventDetail.source} />
              )}
              {eventDetail.description && (
                <div style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px', whiteSpace: 'pre-wrap', color: 'var(--text-2)', fontSize: 12.5, lineHeight: 1.55 }}>
                  {eventDetail.description}
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
              <button onClick={() => handleDeleteEvent(eventDetail.id)} style={{ ...btnSecondaryWide, color: '#ef4444', borderColor: 'rgba(239,68,68,0.25)' }}>
                <Trash2 size={13} /> Delete
              </button>
              <button onClick={() => setEventDetail(null)} style={btnPrimaryWide}>Close</button>
            </div>
          </ModalShell>
        )}
      </AnimatePresence>

      {/* ------- Connect Google Calendar Wizard ------- */}
      <AnimatePresence>
        {showConnect && (
          <ModalShell onClose={() => setShowConnect(false)} maxWidth={580}>
            <ModalHeader
              title="Connect a Calendar"
              icon={<div style={{ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(135deg,#06b6d4,#0891b2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><LinkIcon size={16} color="#fff" /></div>}
              onClose={() => setShowConnect(false)}
            />

            {/* Step indicator */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 16 }}>
              {[1, 2, 3, 4].map(s => (
                <React.Fragment key={s}>
                  <div style={{
                    width: 24, height: 24, borderRadius: '50%',
                    background: s < wizardStep ? '#10b981' : s === wizardStep ? '#06b6d4' : 'var(--surface-3)',
                    color: s <= wizardStep ? '#fff' : 'var(--text-3)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 11, fontWeight: 700, transition: 'all 0.2s',
                    border: `1px solid ${s === wizardStep ? '#06b6d4' : 'transparent'}`,
                  }}>
                    {s < wizardStep ? <Check size={12} /> : s}
                  </div>
                  {s < 4 && <div style={{ flex: 1, height: 2, background: s < wizardStep ? '#10b981' : 'var(--surface-3)', transition: 'all 0.2s' }} />}
                </React.Fragment>
              ))}
            </div>

            {/* Active step */}
            {(() => {
              const step = wizard?.steps?.[wizardStep - 1] || {
                id: wizardStep,
                title: wizardStep === 1 ? 'Copy your private feed URL'
                  : wizardStep === 2 ? 'Open Google Calendar'
                  : wizardStep === 3 ? 'Paste the feed URL'
                  : 'You are connected',
                body: 'Loading…',
                action: wizardStep === 1 ? 'copy_url' : wizardStep === 2 ? 'open_google' : wizardStep === 3 ? 'paste' : 'done',
              };
              return (
                <div>
                  <h4 style={{ fontSize: 15, fontWeight: 800, margin: '0 0 6px' }}>Step {step.id}: {step.title}</h4>
                  <p style={{ color: 'var(--text-3)', fontSize: 12.5, lineHeight: 1.55, margin: '0 0 14px' }}>{step.body}</p>

                  {step.action === 'copy_url' && (
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input readOnly value={icsUrl} onClick={e => (e.target as HTMLInputElement).select()}
                        style={{ ...inputStyle, fontSize: 12, fontFamily: 'monospace', flex: 1 }} />
                      <button onClick={() => copyIcs(icsUrl)} style={{ padding: '0 14px', background: icsCopied ? 'rgba(16,185,129,0.15)' : 'linear-gradient(135deg,#06b6d4,#0891b2)', border: icsCopied ? '1px solid rgba(16,185,129,0.4)' : 'none', borderRadius: 10, color: icsCopied ? '#10b981' : '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
                        {icsCopied ? <><Check size={13} /> Copied</> : <><Copy size={13} /> Copy URL</>}
                      </button>
                    </div>
                  )}

                  {step.action === 'open_google' && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                      <a href={step.url || 'https://calendar.google.com/calendar/u/0/r/settings/addbyurl'} target="_blank" rel="noreferrer"
                        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '10px', background: 'linear-gradient(135deg,#06b6d4,#0891b2)', border: 'none', borderRadius: 10, color: '#fff', fontSize: 12, fontWeight: 700, textDecoration: 'none', fontFamily: 'inherit' }}>
                        <ExternalLink size={13} /> Open Google Calendar
                      </a>
                      <a href={webcalUrl}
                        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '10px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--text-1)', fontSize: 12, fontWeight: 700, textDecoration: 'none', fontFamily: 'inherit' }}>
                        Apple Calendar
                      </a>
                    </div>
                  )}

                  {step.action === 'paste' && (
                    <div style={{ background: 'var(--surface-2)', border: '1px dashed var(--border)', borderRadius: 10, padding: '12px 14px', fontSize: 12, color: 'var(--text-2)', lineHeight: 1.55 }}>
                      <strong style={{ color: 'var(--text-1)' }}>Tip:</strong> after pasting, Google may take a few minutes to fetch your events for the first time. Subsequent syncs happen automatically.
                    </div>
                  )}

                  {step.action === 'done' && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: 12 }}>
                      <Check size={18} color="#10b981" />
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: '#10b981' }}>All set</div>
                        <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>Your Recall events now appear inside your provider.</div>
                      </div>
                    </div>
                  )}

                  {wizard?.notes && wizardStep === 4 && (
                    <ul style={{ margin: '14px 0 0', paddingLeft: 18, fontSize: 11.5, color: 'var(--text-3)', lineHeight: 1.6 }}>
                      {wizard.notes.map((n: string, i: number) => <li key={i}>{n}</li>)}
                    </ul>
                  )}
                </div>
              );
            })()}

            {/* Footer nav */}
            <div style={{ display: 'flex', gap: 10, marginTop: 22 }}>
              <button onClick={() => wizardStep > 1 ? setWizardStep(wizardStep - 1) : setShowConnect(false)} style={btnSecondaryWide}>
                {wizardStep === 1 ? 'Cancel' : 'Back'}
              </button>
              <button onClick={() => wizardStep < 4 ? setWizardStep(wizardStep + 1) : (setShowConnect(false), setWizardStep(1))} style={btnPrimaryWide}>
                {wizardStep < 4 ? <>Next <ArrowRight size={13} /></> : <><Check size={14} /> Done</>}
              </button>
            </div>
          </ModalShell>
        )}
      </AnimatePresence>

      {/* ------- Import .ics Modal ------- */}
      <AnimatePresence>
        {showImport && (
          <ModalShell onClose={() => { setShowImport(false); setImportText(''); setImportResult(null); }} maxWidth={520}>
            <ModalHeader
              title="Import calendar (.ics)"
              icon={<div style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Upload size={16} color="var(--primary)" /></div>}
              onClose={() => { setShowImport(false); setImportText(''); setImportResult(null); }}
            />
            <p style={{ color: 'var(--text-3)', fontSize: 12.5, margin: '0 0 14px', lineHeight: 1.55 }}>
              Drop or pick an <code>.ics</code> file exported from Google, Apple or Outlook. Each event will be imported with the topic you choose below.
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10, marginBottom: 12 }}>
              <button onClick={() => fileInputRef.current?.click()}
                style={{ ...btnGhost, padding: '14px', justifyContent: 'center', borderStyle: 'dashed' }}>
                <Upload size={14} /> {importText ? 'Replace file' : 'Pick .ics file'}
              </button>
              <select value={importTopic} onChange={e => setImportTopic(e.target.value)} style={{ ...inputStyle, padding: '10px 12px' }}>
                {topics.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
              <input ref={fileInputRef} type="file" accept=".ics,text/calendar" style={{ display: 'none' }}
                onChange={e => { const f = e.target.files?.[0]; if (f) onPickFile(f); }} />
            </div>

            {importText && (
              <div style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 10, padding: 10, marginBottom: 12 }}>
                <div style={{ fontSize: 10.5, color: 'var(--text-3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>Preview</div>
                <pre style={{ margin: 0, maxHeight: 140, overflow: 'auto', fontSize: 11, color: 'var(--text-2)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {importText.slice(0, 600)}{importText.length > 600 ? '…' : ''}
                </pre>
              </div>
            )}

            {importResult && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderRadius: 10, marginBottom: 12,
                background: importResult.imported > 0 ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.08)',
                border: `1px solid ${importResult.imported > 0 ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.25)'}`,
              }}>
                {importResult.imported > 0 ? <Check size={16} color="#10b981" /> : <AlertCircle size={16} color="#ef4444" />}
                <div style={{ fontSize: 12.5, color: 'var(--text-1)' }}>
                  Imported <strong>{importResult.imported}</strong> of <strong>{importResult.total_parsed}</strong> events
                  {importResult.failed > 0 && <span style={{ color: '#ef4444' }}> · {importResult.failed} failed</span>}
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => { setShowImport(false); setImportText(''); setImportResult(null); }} style={btnSecondaryWide}>Close</button>
              <button onClick={handleImport} disabled={!importText.trim() || importing} style={{ ...btnPrimaryWide, opacity: !importText.trim() || importing ? 0.6 : 1 }}>
                {importing ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Upload size={14} />}
                {importing ? 'Importing…' : 'Import events'}
              </button>
            </div>
          </ModalShell>
        )}
      </AnimatePresence>
    </div>
  );
};

// ------- Helpers ----------

const btnGhost: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 7, padding: '8px 14px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--text-2)', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.15s' };
const btnPrimary: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 7, padding: '8px 14px', background: 'linear-gradient(135deg,var(--primary),#4f46e5)', border: 'none', borderRadius: 10, color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', boxShadow: '0 4px 12px rgba(99,102,241,0.3)' };
const btnPrimaryWide: React.CSSProperties = { ...btnPrimary, flex: 1, padding: '11px 0', justifyContent: 'center', fontSize: 13 };
const btnSecondaryWide: React.CSSProperties = { flex: 1, padding: '11px 0', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--text-2)', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' };
const iconBtn: React.CSSProperties = { width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-2)', cursor: 'pointer' };

const ModalShell: React.FC<{ onClose: () => void; maxWidth?: number; children: React.ReactNode }> = ({ onClose, maxWidth = 460, children }) => (
  <div style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      onClick={onClose}
      style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)' }} />
    <motion.div initial={{ opacity: 0, scale: 0.95, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }}
      style={{ position: 'relative', width: '100%', maxWidth, ...card, padding: '26px 24px', borderRadius: 20, boxShadow: '0 24px 60px rgba(0,0,0,0.4)', maxHeight: '90vh', overflowY: 'auto' }}>
      {children}
    </motion.div>
  </div>
);

const ModalHeader: React.FC<{ title: string; onClose: () => void; icon?: React.ReactNode }> = ({ title, onClose, icon }) => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
      {icon}
      <h3 style={{ fontSize: 17, fontWeight: 800, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</h3>
    </div>
    <button onClick={onClose} style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, padding: 6, cursor: 'pointer', color: 'var(--text-2)', display: 'flex', alignItems: 'center' }}>
      <X size={16} />
    </button>
  </div>
);

const Pill: React.FC<{ label: string; value: string; color?: string }> = ({ label, value, color }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
    <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.5px', minWidth: 60 }}>{label}</span>
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 10px', background: color ? `${color}20` : 'var(--surface-2)', border: `1px solid ${color ? color + '40' : 'var(--border)'}`, borderRadius: 20, color: color || 'var(--text-1)', fontSize: 12, fontWeight: 600 }}>
      {color && <span style={{ width: 6, height: 6, borderRadius: '50%', background: color }} />}
      {value}
    </span>
  </div>
);

const AgendaRow: React.FC<{ ev: EventItem; color: string; onClick: () => void }> = ({ ev, color, onClick }) => {
  const navigate = useNavigate();
  return (
    <div onClick={onClick}
      style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 10, borderLeft: `3px solid ${color}`, cursor: 'pointer', transition: 'all 0.15s' }}
      onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface-3)'; }}
      onMouseLeave={e => { e.currentTarget.style.background = 'var(--surface-2)'; }}>
      <div style={{ minWidth: 64, fontSize: 11, fontWeight: 700, color, textAlign: 'center' as const }}>
        {ev.time}
        <div style={{ fontSize: 9.5, color: 'var(--text-3)', fontWeight: 500, marginTop: 1 }}>{ev.duration_minutes || 60}m</div>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 13, fontWeight: 700, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ev.title}</p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 9.5, color, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.4px' }}>{ev.topic || 'Other'}</span>
          {ev.linked_task_id && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); navigate(`/tasks?focus=${encodeURIComponent(ev.linked_task_id!)}`); }}
              data-testid={`badge-agenda-task-${ev.id}`}
              title="Open the linked task"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '2px 8px', borderRadius: 20, background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.3)', color: '#10b981', fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.4px', cursor: 'pointer', fontFamily: 'inherit' }}
            >
              <LinkIcon size={9} /> task
            </button>
          )}
          {ev.linked_memory_id && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); navigate(`/memory/${ev.linked_memory_id}`); }}
              data-testid={`badge-agenda-from-memory-${ev.id}`}
              title="Open the memory this event came from"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '2px 8px', borderRadius: 20, background: 'rgba(6,182,212,0.12)', border: '1px solid rgba(6,182,212,0.3)', color: '#06b6d4', fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.4px', cursor: 'pointer', fontFamily: 'inherit' }}
            >
              <LinkIcon size={9} /> from memory
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default CalendarModule;
