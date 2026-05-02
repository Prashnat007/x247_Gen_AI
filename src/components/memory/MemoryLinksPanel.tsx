/**
 * MemoryLinksPanel — the W2 "command center" that lives on the memory
 * detail page. Hydrates GET /memories/{id}/links once, then renders 8
 * collapsible rows (folder, tasks, events, revisits, habits, flashcards,
 * related memories, external refs) with per-item Open + Unlink buttons
 * and a per-row footer that lets the user link an existing entity
 * (Universal Linker — stubbed as a "coming soon" toast until P3) or
 * create a brand new one inline using the same chip components from
 * src/components/capture/.
 *
 * The panel owns its own data fetch and re-fetches after every mutation
 * so counts/state stay accurate without a page reload.
 */
import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ChevronDown, ChevronRight, ExternalLink, Loader2, Plus, Trash2,
  FolderOpen, ListChecks, CalendarPlus, Bell, Flame, BookOpen,
  Network, Link2, Sparkles, Check, X,
} from 'lucide-react';

import {
  fetchMemoryLinks, linkMemory, unlinkMemory,
  fetchSuggestionsForMemory, acceptSuggestion, rejectSuggestion,
  type AISuggestion,
} from '../../lib/api';
import type {
  MemoryLinks, MemoryLinkKind,
  MemoryLinkTaskItem, MemoryLinkEventItem, MemoryLinkRevisitItem,
  MemoryLinkHabitItem, MemoryLinkRelatedItem, MemoryLinkExternalItem,
  MemoryLinkFolderItem,
} from '../../lib/types';
import { showToast } from '../../App';
import { useLinker, type LinkerKind } from '../../contexts/LinkerContext';

import FolderChip, { type FolderState } from '../capture/FolderChip';
import HabitChip, { type HabitState } from '../capture/HabitChip';
import RevisitChip, { type RevisitState } from '../capture/RevisitChip';
import ScheduleChip, { type ScheduleEvent } from '../capture/ScheduleChip';

/* ──────────────────────────────────────────────────────────────────── */
/* Section config — drives row rendering, icons, colours, count source. */
/* ──────────────────────────────────────────────────────────────────── */

type SectionKey =
  | 'folder' | 'tasks' | 'events' | 'revisits'
  | 'habits' | 'flashcards' | 'related' | 'external';

interface SectionMeta {
  key: SectionKey;
  label: string;
  icon: React.ComponentType<{ size?: number; color?: string }>;
  color: string;
  countOf: (links: MemoryLinks) => number;
  // Some sections (folder) cap at one item — hide "+ Create new" when
  // already populated so we don't suggest a destructive overwrite.
  singletonFull?: (links: MemoryLinks) => boolean;
}

// P4B — kind → icon/colour for the AI suggestions sub-section. Shared
// with the daily-briefing AI suggestions card so the visual mapping
// stays consistent across both surfaces.
const SUGGESTION_KIND_ICONS: Record<string, React.ComponentType<{ size?: number; color?: string }>> = {
  habit:        Flame,
  task:         ListChecks,
  event:        CalendarPlus,
  revisit:      Bell,
  memory:       Network,
  folder:       FolderOpen,
  folder_bundle: FolderOpen,
  external_ref: Link2,
};
const SUGGESTION_KIND_COLORS: Record<string, string> = {
  habit:        '#f59e0b',
  task:         '#10b981',
  event:        '#3b82f6',
  revisit:      '#fb7185',
  memory:       '#818cf8',
  folder:       '#22d3ee',
  folder_bundle: '#22d3ee',
  external_ref: '#64748b',
};

const SECTIONS: SectionMeta[] = [
  { key: 'folder',     label: 'Folder',          icon: FolderOpen,    color: '#22d3ee', countOf: l => (l.folder ? 1 : 0), singletonFull: l => !!l.folder },
  { key: 'tasks',      label: 'Tasks',           icon: ListChecks,    color: '#10b981', countOf: l => l.tasks.length },
  { key: 'events',     label: 'Calendar events', icon: CalendarPlus,  color: '#3b82f6', countOf: l => l.events.length },
  { key: 'revisits',   label: 'Revisits',        icon: Bell,          color: '#fb7185', countOf: l => l.revisits.length },
  { key: 'habits',     label: 'Habits',          icon: Flame,         color: '#f59e0b', countOf: l => l.habits.length },
  { key: 'flashcards', label: 'Flashcards',      icon: BookOpen,      color: '#a78bfa', countOf: l => l.flashcards.length },
  { key: 'related',    label: 'Related memories',icon: Network,       color: '#818cf8', countOf: l => l.related_memories.length },
  { key: 'external',   label: 'External refs',   icon: Link2,         color: '#64748b', countOf: l => l.external_refs.length },
];

interface Props {
  memoryId: string;
  /** Title shown in the Cmd-K palette header when "Link existing"
   *  opens the linker scoped to this memory. Optional — falls back
   *  to "this memory" so the palette never shows a blank scope. */
  memoryTitle?: string;
}

const MemoryLinksPanel: React.FC<Props> = ({ memoryId, memoryTitle }) => {
  const navigate = useNavigate();
  const { openLinker } = useLinker();
  const [links, setLinks] = useState<MemoryLinks | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // P4B — AI auto-link suggestions tied to this memory. Fetched in
  // parallel with the cross-link fan-out; re-fetched after accept/reject.
  const [suggestions, setSuggestions] = useState<AISuggestion[]>([]);
  const [suggBusy, setSuggBusy] = useState<Record<string, 'accept' | 'reject' | undefined>>({});
  // Open sections start with whichever sections have data — keeps the
  // panel quiet for new memories but instantly informative for rich ones.
  const [open, setOpen] = useState<Record<SectionKey, boolean>>({
    folder: false, tasks: false, events: false, revisits: false,
    habits: false, flashcards: false, related: false, external: false,
  });
  // Per-section "Create new" disclosure. Tracked separately so toggling
  // collapse doesn't clobber an in-progress form.
  const [creatingIn, setCreatingIn] = useState<Record<SectionKey, boolean>>({
    folder: false, tasks: false, events: false, revisits: false,
    habits: false, flashcards: false, related: false, external: false,
  });

  const refresh = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError('');
    try {
      const data = await fetchMemoryLinks(memoryId);
      setLinks(data);
      // First load: auto-open any section that has at least one item so
      // the user sees content without having to click around.
      setOpen(prev => {
        const next = { ...prev };
        for (const s of SECTIONS) {
          if (s.countOf(data) > 0 && !prev[s.key]) next[s.key] = true;
        }
        return next;
      });
    } catch (err: any) {
      setError(String(err?.message || err));
    } finally {
      if (!silent) setLoading(false);
    }
  }, [memoryId]);

  useEffect(() => { void refresh(); }, [refresh]);

  // P4B — separate fetch for AI suggestions so a slow auto_linker call
  // never delays the cross-link panel paint. Soft-fails to [].
  const refreshSuggestions = useCallback(async () => {
    if (!memoryId) return;
    const items = await fetchSuggestionsForMemory(memoryId);
    setSuggestions(items);
    // Auto-open the related section when any suggestion arrives so the
    // user can see what the AI proposes without an extra click.
    if (items.length > 0) {
      setOpen(prev => prev.related ? prev : { ...prev, related: true });
    }
  }, [memoryId]);

  useEffect(() => { void refreshSuggestions(); }, [refreshSuggestions]);

  const handleAcceptSuggestion = async (s: AISuggestion) => {
    setSuggBusy(b => ({ ...b, [s.id]: 'accept' }));
    try {
      await acceptSuggestion(s.id);
      showToast(`Linked: ${s.reason.slice(0, 60)}`, 'success');
      // Refresh both — the new link should appear in the panel and
      // the suggestion should disappear from the suggestions list.
      await Promise.all([refresh(true), refreshSuggestions()]);
    } catch (err: any) {
      showToast(`Couldn't accept: ${err?.message || err}`, 'error');
    } finally {
      setSuggBusy(b => ({ ...b, [s.id]: undefined }));
    }
  };

  const handleRejectSuggestion = async (s: AISuggestion) => {
    setSuggBusy(b => ({ ...b, [s.id]: 'reject' }));
    try {
      await rejectSuggestion(s.id);
      // Optimistic remove so the row disappears immediately even
      // before the inbox refetch lands.
      setSuggestions(prev => prev.filter(x => x.id !== s.id));
      void refreshSuggestions();
    } catch (err: any) {
      showToast(`Couldn't dismiss: ${err?.message || err}`, 'error');
    } finally {
      setSuggBusy(b => ({ ...b, [s.id]: undefined }));
    }
  };

  const handleUnlink = async (kind: MemoryLinkKind, refId: string, label: string) => {
    try {
      await unlinkMemory(memoryId, kind, refId);
      showToast(`Unlinked ${label}`);
      await refresh(true);
    } catch (err: any) {
      showToast(`Couldn't unlink: ${err?.message || err}`, 'error');
    }
  };

  const handleLink = async (kind: MemoryLinkKind, refId: string, label: string) => {
    try {
      await linkMemory(memoryId, kind, refId);
      showToast(`Linked ${label}`);
      await refresh(true);
      return true;
    } catch (err: any) {
      showToast(`Couldn't link: ${err?.message || err}`, 'error');
      return false;
    }
  };

  /**
   * W3 Universal Linker: open the Cmd-K palette in `link` mode scoped
   * to this memory, with the search restricted to the section's kind.
   * After a successful link write the panel re-fetches so counts and
   * row lists update without a page reload.
   *
   * Sections without a real backend collection (flashcards) or
   * without a linkable single-id target (related — that lives behind
   * the AI "related memories" pipeline, not user-driven linking;
   * external — refs are per-memory metadata, not free-floating
   * objects) keep the legacy "coming soon" toast so we don't surface
   * a palette mode the backend can't fulfil.
   */
  const SECTION_TO_LINKER_KIND: Partial<Record<SectionKey, LinkerKind>> = {
    folder: 'folder', tasks: 'task', events: 'event',
    revisits: 'revisit', habits: 'habit', related: 'memory',
  };
  const openLinkExisting = (sectionKey: SectionKey, sectionLabel: string) => {
    const kind = SECTION_TO_LINKER_KIND[sectionKey];
    if (!kind) {
      showToast(`Linker for ${sectionLabel} not available yet`, 'info');
      return;
    }
    openLinker('link', {
      scope: { kind: 'memory', id: memoryId, title: memoryTitle || 'this memory' },
      restrictKind: kind,
      onLinked: () => { void refresh(true); },
    });
  };

  const closeCreate = (key: SectionKey) =>
    setCreatingIn(prev => ({ ...prev, [key]: false }));
  const toggleCreate = (key: SectionKey) =>
    setCreatingIn(prev => ({ ...prev, [key]: !prev[key] }));

  /* ───────────────── Render helpers ───────────────── */

  const renderRow = (
    icon: React.ReactNode,
    title: string,
    meta: string | null,
    onOpen: () => void,
    onUnlink: (() => void) | null,
    testIdBase: string,
  ) => (
    <div
      className="mlp-row"
      data-testid={testIdBase}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '8px 10px', borderRadius: 8,
        background: 'var(--surface-2)', border: '1px solid var(--border)',
        position: 'relative',
      }}
    >
      <span style={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}>{icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{
          margin: 0, fontSize: 12.5, fontWeight: 600, color: 'var(--text-1)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {title}
        </p>
        {meta && (
          <p style={{ margin: '2px 0 0', fontSize: 10.5, color: 'var(--text-3)' }}>
            {meta}
          </p>
        )}
      </div>
      <div className="mlp-row-actions" style={{ display: 'flex', gap: 4, flexShrink: 0, opacity: 0, transition: 'opacity 0.12s' }}>
        <button
          type="button"
          onClick={onOpen}
          aria-label="Open"
          data-testid={`${testIdBase}-open`}
          style={{
            padding: 5, borderRadius: 6, cursor: 'pointer',
            background: 'transparent', border: '1px solid var(--border)',
            color: 'var(--text-2)', display: 'flex', alignItems: 'center',
          }}
        >
          <ExternalLink size={12} />
        </button>
        {onUnlink && (
          <button
            type="button"
            onClick={onUnlink}
            aria-label="Unlink"
            data-testid={`${testIdBase}-unlink`}
            style={{
              padding: 5, borderRadius: 6, cursor: 'pointer',
              background: 'transparent', border: '1px solid var(--border)',
              color: '#ef4444', display: 'flex', alignItems: 'center',
            }}
          >
            <Trash2 size={12} />
          </button>
        )}
      </div>
    </div>
  );

  const renderItems = (key: SectionKey) => {
    if (!links) return null;
    if (key === 'folder' && links.folder) {
      const f: MemoryLinkFolderItem = links.folder;
      return renderRow(
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: f.color || '#22d3ee', display: 'inline-block' }} />,
        f.folder_name,
        f.project_name,
        () => navigate(`/workspace?project=${encodeURIComponent(f.project_id)}&folder=${encodeURIComponent(f.folder_id)}`),
        () => void handleUnlink('folder', `${f.project_id}/${f.folder_id}`, f.folder_name),
        `mlp-item-folder-${f.folder_id}`,
      );
    }
    if (key === 'tasks') {
      return links.tasks.map((t: MemoryLinkTaskItem) => (
        <React.Fragment key={`task-${t.id}`}>
          {renderRow(
            <ListChecks size={13} color="#10b981" />,
            t.title,
            [t.status, t.priority, t.due_date].filter(Boolean).join(' · ') || null,
            () => navigate(`/focus?task=${encodeURIComponent(t.id)}`),
            () => void handleUnlink('task', t.id, 'task'),
            `mlp-item-task-${t.id}`,
          )}
        </React.Fragment>
      ));
    }
    if (key === 'events') {
      return links.events.map((e: MemoryLinkEventItem) => (
        <React.Fragment key={`event-${e.id}`}>
          {renderRow(
            <CalendarPlus size={13} color="#3b82f6" />,
            e.title,
            [e.date, e.time].filter(Boolean).join(' · ') || null,
            () => navigate(`/calendar?event=${encodeURIComponent(e.id)}`),
            () => void handleUnlink('event', e.id, 'event'),
            `mlp-item-event-${e.id}`,
          )}
        </React.Fragment>
      ));
    }
    if (key === 'revisits') {
      return links.revisits.map((r: MemoryLinkRevisitItem) => (
        <React.Fragment key={`revisit-${r.id}`}>
          {renderRow(
            <Bell size={13} color="#fb7185" />,
            r.title || `Revisit (${r.frequency || 'once'})`,
            [r.frequency, r.next_due, r.status].filter(Boolean).join(' · ') || null,
            () => navigate(`/focus?revisit=${encodeURIComponent(r.id)}`),
            () => void handleUnlink('revisit', r.id, 'revisit'),
            `mlp-item-revisit-${r.id}`,
          )}
        </React.Fragment>
      ));
    }
    if (key === 'habits') {
      return links.habits.map((h: MemoryLinkHabitItem) => (
        <React.Fragment key={`habit-${h.id}`}>
          {renderRow(
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: h.color || '#f59e0b', display: 'inline-block' }} />,
            h.name,
            h.streak ? `${h.streak} day streak` : null,
            () => navigate(`/focus?habit=${encodeURIComponent(h.id)}`),
            () => void handleUnlink('habit', h.id, h.name),
            `mlp-item-habit-${h.id}`,
          )}
        </React.Fragment>
      ));
    }
    if (key === 'flashcards') {
      // Flashcards aren't yet a real backend collection (`_LINK_KINDS`
      // doesn't include 'flashcard'), so we render rows without an
      // unlink action — the per-row Open button still navigates to
      // Learn where deck management actually lives.
      return links.flashcards.map((c: any, i: number) => (
        <React.Fragment key={`flashcard-${c.id ?? i}`}>
          {renderRow(
            <BookOpen size={13} color="#a78bfa" />,
            c.title || c.question || 'Flashcard',
            null,
            () => navigate(`/learn?tab=flashcards&memory=${encodeURIComponent(memoryId)}`),
            null,
            `mlp-item-flashcard-${c.id ?? i}`,
          )}
        </React.Fragment>
      ));
    }
    if (key === 'related') {
      return links.related_memories.map((m: MemoryLinkRelatedItem) => (
        <React.Fragment key={`memory-${m.id}`}>
          {renderRow(
            <Network size={13} color="#818cf8" />,
            m.title,
            m.source_type || null,
            () => navigate(`/memory/${m.id}`),
            () => void handleUnlink('memory', m.id, 'memory'),
            `mlp-item-memory-${m.id}`,
          )}
        </React.Fragment>
      ));
    }
    if (key === 'external') {
      // Backend unlink for external_ref is by external_refs doc id, not
      // by "source:source_id" sugar — the sugar is only valid on POST.
      // Rows without an id (legacy / partial payloads) hide unlink so
      // we don't fire a guaranteed-to-400 request.
      return links.external_refs.map((x: MemoryLinkExternalItem, i: number) => {
        // P5A/P5B — Sourced refs get an "Open in <provider> ↗" pill so the
        // user can jump back to the original page without hovering for the
        // generic open icon. We render the standard row, then layer the
        // pill in via React's Fragment after — keeps renderRow generic.
        // Hard-block any URL that isn't http(s) so a stored `javascript:`
        // payload can never become a click-to-XSS vector via the pill.
        const src = (x.source || '').toLowerCase();
        const safeUrl = typeof x.url === 'string' && /^https?:\/\//i.test(x.url) ? x.url : '';
        const sourcePill: { label: string; testid: string } | null =
          src === 'notion' && safeUrl ? { label: 'Notion', testid: 'notion-open' }
          : src === 'gmail' && safeUrl ? { label: 'Gmail', testid: 'gmail-open' }
          : src === 'slack' && safeUrl ? { label: 'Slack', testid: 'slack-open' }
          : null;
        return (
          <React.Fragment key={`external-${x.id ?? i}`}>
            {renderRow(
              <Link2 size={13} color="#64748b" />,
              x.title || x.url || `${x.source}${x.source_id ? ':' + x.source_id : ''}`,
              x.source || null,
              () => { if (x.url) window.open(x.url, '_blank', 'noopener,noreferrer'); },
              x.id ? () => void handleUnlink('external_ref', String(x.id), x.source) : null,
              `mlp-item-external-${x.id ?? i}`,
            )}
            {sourcePill && (
              <a
                href={safeUrl}
                target="_blank"
                rel="noreferrer"
                data-testid={`mlp-item-external-${x.id ?? i}-${sourcePill.testid}`}
                style={{
                  alignSelf: 'flex-start',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '3px 9px',
                  marginTop: -4,
                  marginLeft: 28,
                  marginBottom: 4,
                  borderRadius: 12,
                  background: 'rgba(255,255,255,0.06)',
                  border: '1px solid var(--border)',
                  color: 'var(--text-2)',
                  fontSize: 10.5,
                  fontWeight: 600,
                  textDecoration: 'none',
                  width: 'fit-content',
                }}
              >
                <ExternalLink size={10} /> Open in {sourcePill.label} ↗
              </a>
            )}
          </React.Fragment>
        );
      });
    }
    return null;
  };

  /* ───────────────── Inline "Create new" forms ─────────────────
   * We reuse the capture-page chips as the picker / editor body, then
   * wrap them with a Save button that POSTs to the right endpoint and
   * refreshes the panel. Each form clears + closes on success.
   */

  const FolderCreate: React.FC = () => {
    const [v, setV] = useState<FolderState | null>(null);
    const [busy, setBusy] = useState(false);
    return (
      <div style={{ padding: 10, background: 'var(--surface-1)', borderRadius: 8, border: '1px solid var(--border)' }}>
        <FolderChip suggestedHint="" value={v} onChange={setV} />
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 10 }}>
          <button type="button" onClick={() => closeCreate('folder')}
            style={cancelBtnStyle} data-testid="mlp-folder-cancel">Cancel</button>
          <button
            type="button"
            disabled={!v || busy}
            data-testid="mlp-folder-save"
            onClick={async () => {
              if (!v) return;
              setBusy(true);
              const ok = await handleLink('folder', `${v.project_id}/${v.folder_id}`, v.folder_name);
              setBusy(false);
              if (ok) closeCreate('folder');
            }}
            style={saveBtnStyle(!v || busy, '#22d3ee')}
          >
            {busy ? <Loader2 size={12} className="spin" /> : 'Save folder'}
          </button>
        </div>
      </div>
    );
  };

  const TaskCreate: React.FC = () => {
    const [title, setTitle] = useState('');
    const [priority, setPriority] = useState<'low' | 'medium' | 'high'>('medium');
    const [due, setDue] = useState('');
    const [busy, setBusy] = useState(false);
    return (
      <div style={{ padding: 10, background: 'var(--surface-1)', borderRadius: 8, border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <input
          type="text"
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="What needs to happen?"
          data-testid="mlp-task-title"
          style={inputStyle}
        />
        <div style={{ display: 'flex', gap: 6 }}>
          <select value={priority} onChange={e => setPriority(e.target.value as any)}
            data-testid="mlp-task-priority" style={selectStyle}>
            <option value="low">low</option>
            <option value="medium">medium</option>
            <option value="high">high</option>
          </select>
          <input type="date" value={due} onChange={e => setDue(e.target.value)}
            data-testid="mlp-task-due" style={{ ...inputStyle, flex: 1, colorScheme: 'dark' }} />
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" onClick={() => closeCreate('tasks')}
            style={cancelBtnStyle} data-testid="mlp-task-cancel">Cancel</button>
          <button
            type="button"
            disabled={!title.trim() || busy}
            data-testid="mlp-task-save"
            onClick={async () => {
              setBusy(true);
              try {
                // Two-phase create: POST the entity (which sets its own
                // linked_memory_id) then call /link to write the inverse
                // pointer on the memory side. If create succeeds but
                // /link fails, the entity is still real and the
                // reverse-scan in GET /links will surface it — refresh
                // either way so the panel reflects truth.
                const res = await fetch('/tasks', {
                  method: 'POST', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    title: title.trim(), priority, due_date: due || undefined,
                    linked_memory_id: memoryId,
                  }),
                });
                if (!res.ok) throw new Error(`create task failed: ${res.status}`);
                const created = await res.json();
                const taskId = created?.id || created?.task_id;
                let linkErr: any = null;
                if (taskId) {
                  try { await linkMemory(memoryId, 'task', String(taskId)); }
                  catch (e) { linkErr = e; }
                }
                showToast(linkErr
                  ? `Task created — link sync had an issue: ${linkErr?.message || linkErr}`
                  : 'Task created and linked',
                  linkErr ? 'info' : 'success');
                await refresh(true);
                closeCreate('tasks');
              } catch (err: any) {
                showToast(`Couldn't create task: ${err?.message || err}`, 'error');
                await refresh(true);
              } finally {
                setBusy(false);
              }
            }}
            style={saveBtnStyle(!title.trim() || busy, '#10b981')}
          >
            {busy ? <Loader2 size={12} className="spin" /> : 'Create task'}
          </button>
        </div>
      </div>
    );
  };

  const EventCreate: React.FC = () => {
    const [v, setV] = useState<ScheduleEvent | null>(null);
    const [busy, setBusy] = useState(false);
    return (
      <div style={{ padding: 10, background: 'var(--surface-1)', borderRadius: 8, border: '1px solid var(--border)' }}>
        <ScheduleChip suggested={null} defaultTitle="" value={v} onChange={setV} />
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 10 }}>
          <button type="button" onClick={() => closeCreate('events')}
            style={cancelBtnStyle} data-testid="mlp-event-cancel">Cancel</button>
          <button
            type="button"
            disabled={!v || !v.title.trim() || busy}
            data-testid="mlp-event-save"
            onClick={async () => {
              if (!v) return;
              setBusy(true);
              try {
                const res = await fetch('/calendar/events', {
                  method: 'POST', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    title: v.title, date: v.date, time: v.time,
                    duration_minutes: v.duration_minutes,
                    linked_memory_id: memoryId,
                  }),
                });
                if (!res.ok) throw new Error(`create event failed: ${res.status}`);
                const created = await res.json();
                const eid = created?.id || created?.event_id;
                let linkErr: any = null;
                if (eid) {
                  try { await linkMemory(memoryId, 'event', String(eid)); }
                  catch (e) { linkErr = e; }
                }
                showToast(linkErr
                  ? `Event created — link sync had an issue: ${linkErr?.message || linkErr}`
                  : 'Event created and linked',
                  linkErr ? 'info' : 'success');
                await refresh(true);
                closeCreate('events');
              } catch (err: any) {
                showToast(`Couldn't create event: ${err?.message || err}`, 'error');
                await refresh(true);
              } finally {
                setBusy(false);
              }
            }}
            style={saveBtnStyle(!v || !v.title.trim() || busy, '#3b82f6')}
          >
            {busy ? <Loader2 size={12} className="spin" /> : 'Create event'}
          </button>
        </div>
      </div>
    );
  };

  const RevisitCreate: React.FC = () => {
    const [v, setV] = useState<RevisitState | null>(null);
    const [busy, setBusy] = useState(false);
    return (
      <div style={{ padding: 10, background: 'var(--surface-1)', borderRadius: 8, border: '1px solid var(--border)' }}>
        <RevisitChip suggested={null} value={v} onChange={setV} />
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 10 }}>
          <button type="button" onClick={() => closeCreate('revisits')}
            style={cancelBtnStyle} data-testid="mlp-revisit-cancel">Cancel</button>
          <button
            type="button"
            disabled={!v || busy}
            data-testid="mlp-revisit-save"
            onClick={async () => {
              if (!v) return;
              setBusy(true);
              try {
                const res = await fetch('/revisits', {
                  method: 'POST', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    title: 'Revisit',
                    frequency: v.frequency,
                    memory_id: memoryId,
                    specific_date: v.next_due || undefined,
                  }),
                });
                if (!res.ok) throw new Error(`create revisit failed: ${res.status}`);
                const created = await res.json();
                const rid = created?.id || created?.revisit_id;
                let linkErr: any = null;
                if (rid) {
                  try { await linkMemory(memoryId, 'revisit', String(rid)); }
                  catch (e) { linkErr = e; }
                }
                showToast(linkErr
                  ? `Revisit scheduled — link sync had an issue: ${linkErr?.message || linkErr}`
                  : 'Revisit scheduled and linked',
                  linkErr ? 'info' : 'success');
                await refresh(true);
                closeCreate('revisits');
              } catch (err: any) {
                showToast(`Couldn't schedule revisit: ${err?.message || err}`, 'error');
                await refresh(true);
              } finally {
                setBusy(false);
              }
            }}
            style={saveBtnStyle(!v || busy, '#fb7185')}
          >
            {busy ? <Loader2 size={12} className="spin" /> : 'Save revisit'}
          </button>
        </div>
      </div>
    );
  };

  const HabitCreate: React.FC = () => {
    const [v, setV] = useState<HabitState | null>(null);
    const [busy, setBusy] = useState(false);
    return (
      <div style={{ padding: 10, background: 'var(--surface-1)', borderRadius: 8, border: '1px solid var(--border)' }}>
        <HabitChip suggested={null} value={v} onChange={setV} />
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 10 }}>
          <button type="button" onClick={() => closeCreate('habits')}
            style={cancelBtnStyle} data-testid="mlp-habit-cancel">Cancel</button>
          <button
            type="button"
            disabled={!v || busy}
            data-testid="mlp-habit-save"
            onClick={async () => {
              if (!v) return;
              setBusy(true);
              const ok = await handleLink('habit', v.habit_id, v.habit_name);
              setBusy(false);
              if (ok) closeCreate('habits');
            }}
            style={saveBtnStyle(!v || busy, '#f59e0b')}
          >
            {busy ? <Loader2 size={12} className="spin" /> : 'Link habit'}
          </button>
        </div>
      </div>
    );
  };

  const ExternalCreate: React.FC = () => {
    const [source, setSource] = useState('notion');
    const [sourceId, setSourceId] = useState('');
    const [busy, setBusy] = useState(false);
    return (
      <div style={{ padding: 10, background: 'var(--surface-1)', borderRadius: 8, border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <input type="text" value={source} onChange={e => setSource(e.target.value)}
          placeholder="Source (notion, slack, gdocs…)" data-testid="mlp-external-source" style={inputStyle} />
        <input type="text" value={sourceId} onChange={e => setSourceId(e.target.value)}
          placeholder="ID, slug, or URL" data-testid="mlp-external-id" style={inputStyle} />
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" onClick={() => closeCreate('external')}
            style={cancelBtnStyle} data-testid="mlp-external-cancel">Cancel</button>
          <button
            type="button"
            disabled={!source.trim() || !sourceId.trim() || busy}
            data-testid="mlp-external-save"
            onClick={async () => {
              setBusy(true);
              // Backend POST /link sugar: "source:source_id" creates the
              // external_ref doc on demand and links it. Pure doc-id
              // re-parenting is also supported but the form collects
              // the human-readable shape on purpose.
              const refId = `${source.trim()}:${sourceId.trim()}`;
              const ok = await handleLink('external_ref', refId, source.trim());
              setBusy(false);
              if (ok) closeCreate('external');
            }}
            style={saveBtnStyle(!source.trim() || !sourceId.trim() || busy, '#64748b')}
          >
            {busy ? <Loader2 size={12} className="spin" /> : 'Add reference'}
          </button>
        </div>
      </div>
    );
  };

  const RelatedCreate: React.FC = () => (
    // Picking an existing memory by free-form ID is too sharp an edge —
    // the proper picker arrives with the Universal Linker in P3. Until
    // then we surface the same "coming soon" toast and a one-line
    // explanation so the row footer doesn't look broken.
    <div style={{
      padding: 10, background: 'var(--surface-1)', borderRadius: 8,
      border: '1px dashed var(--border)', fontSize: 12, color: 'var(--text-2)',
      lineHeight: 1.5,
    }}>
      Picking an existing memory inline arrives with the Universal Linker
      (P3). For now, link from the other memory's detail page.
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
        <button type="button" onClick={() => closeCreate('related')}
          style={cancelBtnStyle} data-testid="mlp-related-cancel">Close</button>
      </div>
    </div>
  );

  const FlashcardCreate: React.FC = () => (
    <div style={{
      padding: 10, background: 'var(--surface-1)', borderRadius: 8,
      border: '1px dashed var(--border)', fontSize: 12, color: 'var(--text-2)',
      lineHeight: 1.5,
    }}>
      Flashcard generation lives on the Learn page. Open it for this
      memory and the cards you create there will appear here.
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
        <button type="button" onClick={() => closeCreate('flashcards')}
          style={cancelBtnStyle} data-testid="mlp-flashcard-cancel">Cancel</button>
        <button
          type="button"
          data-testid="mlp-flashcard-open-learn"
          onClick={() => navigate(`/learn?tab=flashcards&memory=${encodeURIComponent(memoryId)}`)}
          style={saveBtnStyle(false, '#a78bfa')}
        >
          Open Learn
        </button>
      </div>
    </div>
  );

  const renderCreateForm = (key: SectionKey): React.ReactNode => {
    switch (key) {
      case 'folder':     return <FolderCreate />;
      case 'tasks':      return <TaskCreate />;
      case 'events':     return <EventCreate />;
      case 'revisits':   return <RevisitCreate />;
      case 'habits':     return <HabitCreate />;
      case 'flashcards': return <FlashcardCreate />;
      case 'related':    return <RelatedCreate />;
      case 'external':   return <ExternalCreate />;
    }
  };

  /* ───────────────── Top-level render ───────────────── */

  return (
    <div data-testid="memory-links-panel" style={{ display: 'flex', flexDirection: 'column' }}>
      <style>{`
        .mlp-row:hover .mlp-row-actions { opacity: 1; }
        .mlp-row:focus-within .mlp-row-actions { opacity: 1; }
      `}</style>

      <div style={{ padding: '16px 18px 12px', borderBottom: '1px solid var(--border)' }}>
        <p style={{
          fontSize: 11, fontWeight: 700, color: 'var(--text-3)',
          letterSpacing: '1px', textTransform: 'uppercase', margin: 0,
        }}>
          Linked across the app
        </p>
        <p style={{ fontSize: 11, color: 'var(--text-3)', margin: '4px 0 0' }}>
          {loading ? 'Loading…' : error ? `Error: ${error}` :
            `${links ? SECTIONS.reduce((n, s) => n + s.countOf(links), 0) : 0} linked items`}
        </p>
      </div>

      {loading && (
        <div style={{ padding: 16, display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-2)', fontSize: 12 }}>
          <Loader2 size={13} className="spin" /> Loading links…
        </div>
      )}

      {/* P4B — "AI thinks this also relates to" sub-section. Renders
          above the SECTIONS list when at least one pending suggestion
          exists for this memory. Each row offers Accept (applies the
          link via the bidirectional writer) + Dismiss (records a
          dismissal so the same signature won't resurface). Mixed-kind
          rendering: a single suggestion can target any of habit/task/
          event/memory/folder/external — we colour-code by kind so the
          user can scan the list quickly. */}
      {suggestions.length > 0 && (
        <div
          data-testid="mlp-ai-suggestions"
          style={{
            padding: '14px 18px 12px',
            borderBottom: '1px solid var(--border)',
            background: 'color-mix(in srgb,#a78bfa 4%,transparent)',
          }}
        >
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10,
          }}>
            <Sparkles size={13} color="#a78bfa" />
            <span style={{
              fontSize: 11, fontWeight: 800, color: '#a78bfa',
              letterSpacing: '0.5px', textTransform: 'uppercase',
            }}>
              AI thinks this also relates to
            </span>
            <span style={{
              marginLeft: 'auto', fontSize: 10.5, fontWeight: 700,
              padding: '2px 8px', borderRadius: 999,
              background: 'color-mix(in srgb,#a78bfa 12%,transparent)',
              border: '1px solid color-mix(in srgb,#a78bfa 28%,transparent)',
              color: '#a78bfa',
            }}>
              {suggestions.length}
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {suggestions.map(s => {
              const KindIcon = SUGGESTION_KIND_ICONS[s.kind] || Network;
              const kindColor = SUGGESTION_KIND_COLORS[s.kind] || '#a78bfa';
              const busy = suggBusy[s.id];
              return (
                <div
                  key={s.id}
                  data-testid={`mlp-suggestion-${s.id}`}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '8px 10px', borderRadius: 8,
                    background: 'var(--surface-2)', border: '1px solid var(--border)',
                  }}
                >
                  <span style={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}>
                    <KindIcon size={13} color={kindColor} />
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{
                      margin: 0, fontSize: 12, color: 'var(--text-1)', lineHeight: 1.35,
                      display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                    }}>
                      {s.reason || `${s.kind} suggestion`}
                    </p>
                    <p style={{ margin: '2px 0 0', fontSize: 10, color: 'var(--text-3)' }}>
                      {s.kind} · {Math.round((s.confidence || 0) * 100)}% match
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleAcceptSuggestion(s)}
                    disabled={!!busy}
                    aria-label="Accept suggestion"
                    data-testid={`mlp-suggestion-${s.id}-accept`}
                    style={{
                      padding: '5px 8px', borderRadius: 6, cursor: busy ? 'wait' : 'pointer',
                      background: 'color-mix(in srgb,#10b981 14%,transparent)',
                      border: '1px solid color-mix(in srgb,#10b981 36%,transparent)',
                      color: '#10b981', display: 'flex', alignItems: 'center', gap: 4,
                      fontSize: 11, fontWeight: 700, fontFamily: 'inherit', flexShrink: 0,
                    }}
                  >
                    {busy === 'accept' ? <Loader2 size={11} className="spin" /> : <Check size={11} />}
                    Accept
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleRejectSuggestion(s)}
                    disabled={!!busy}
                    aria-label="Dismiss suggestion"
                    data-testid={`mlp-suggestion-${s.id}-reject`}
                    style={{
                      padding: '5px 8px', borderRadius: 6, cursor: busy ? 'wait' : 'pointer',
                      background: 'transparent',
                      border: '1px solid var(--border)',
                      color: 'var(--text-3)', display: 'flex', alignItems: 'center',
                      flexShrink: 0,
                    }}
                  >
                    {busy === 'reject' ? <Loader2 size={11} className="spin" /> : <X size={11} />}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {!loading && !error && links && SECTIONS.map((s, i) => {
        const count = s.countOf(links);
        const isOpen = open[s.key];
        const isCreating = creatingIn[s.key];
        const Icon = s.icon;
        const canCreate = !s.singletonFull?.(links);

        return (
          <div key={s.key} style={{ borderBottom: i < SECTIONS.length - 1 ? '1px solid var(--border)' : 'none' }}>
            <button
              type="button"
              data-testid={`mlp-section-${s.key}-toggle`}
              onClick={() => setOpen(prev => ({ ...prev, [s.key]: !prev[s.key] }))}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                padding: '12px 18px', background: 'transparent', border: 'none',
                cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
                transition: 'background 0.12s',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-2)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              <div style={{
                width: 30, height: 30, borderRadius: 8,
                background: `color-mix(in srgb,${s.color} 12%,transparent)`,
                border: `1px solid color-mix(in srgb,${s.color} 22%,transparent)`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
              }}>
                <Icon size={14} color={s.color} />
              </div>
              <span style={{ flex: 1, fontSize: 12.5, fontWeight: 700, color: 'var(--text-1)' }}>
                {s.label}
              </span>
              <span
                data-testid={`mlp-section-${s.key}-count`}
                style={{
                  fontSize: 10.5, fontWeight: 700, padding: '2px 8px',
                  borderRadius: 999, minWidth: 22, textAlign: 'center',
                  background: count > 0 ? `color-mix(in srgb,${s.color} 12%,transparent)` : 'var(--surface-2)',
                  border: `1px solid ${count > 0 ? `color-mix(in srgb,${s.color} 28%,transparent)` : 'var(--border)'}`,
                  color: count > 0 ? s.color : 'var(--text-3)',
                }}
              >
                {count}
              </span>
              {isOpen
                ? <ChevronDown size={13} color="var(--text-3)" />
                : <ChevronRight size={13} color="var(--text-3)" />}
            </button>

            {isOpen && (
              <div style={{ padding: '0 18px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                {count === 0 && !isCreating && (
                  <p style={{ margin: '0 0 4px', fontSize: 11.5, color: 'var(--text-3)', fontStyle: 'italic' }}>
                    Nothing linked yet.
                  </p>
                )}
                {count > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {renderItems(s.key)}
                  </div>
                )}

                {isCreating && (
                  <div data-testid={`mlp-section-${s.key}-create-body`}>
                    {renderCreateForm(s.key)}
                  </div>
                )}

                <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                  <button
                    type="button"
                    data-testid={`mlp-section-${s.key}-link-existing`}
                    onClick={() => openLinkExisting(s.key, s.label)}
                    style={footerBtnStyle}
                  >
                    <Plus size={11} /> Link existing
                  </button>
                  {canCreate && (
                    <button
                      type="button"
                      data-testid={`mlp-section-${s.key}-create-toggle`}
                      onClick={() => toggleCreate(s.key)}
                      style={footerBtnStyle}
                    >
                      <Plus size={11} /> Create new
                      {isCreating
                        ? <ChevronDown size={11} />
                        : <ChevronRight size={11} />}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

/* ───────────────── Shared inline styles ───────────────── */

const inputStyle: React.CSSProperties = {
  padding: '7px 9px', fontSize: 12, borderRadius: 6,
  background: 'var(--surface-2)', border: '1px solid var(--border)',
  color: 'var(--text-1)', fontFamily: 'inherit',
};
const selectStyle: React.CSSProperties = {
  padding: '7px 9px', fontSize: 12, borderRadius: 6,
  background: 'var(--surface-2)', border: '1px solid var(--border)',
  color: 'var(--text-1)', fontFamily: 'inherit',
};
const cancelBtnStyle: React.CSSProperties = {
  padding: '6px 10px', fontSize: 11.5, borderRadius: 6, cursor: 'pointer',
  background: 'transparent', border: '1px solid var(--border)',
  color: 'var(--text-2)', fontFamily: 'inherit',
};
const footerBtnStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 4,
  padding: '5px 10px', fontSize: 11, borderRadius: 6, cursor: 'pointer',
  background: 'transparent', border: '1px dashed var(--border)',
  color: 'var(--text-2)', fontFamily: 'inherit', fontWeight: 600,
};
const saveBtnStyle = (disabled: boolean, color: string): React.CSSProperties => ({
  display: 'flex', alignItems: 'center', gap: 6,
  padding: '6px 12px', fontSize: 11.5, borderRadius: 6,
  cursor: disabled ? 'not-allowed' : 'pointer',
  background: `color-mix(in srgb,${color} 14%,transparent)`,
  border: `1px solid color-mix(in srgb,${color} 36%,transparent)`,
  color, fontFamily: 'inherit', fontWeight: 700,
  opacity: disabled ? 0.55 : 1,
});

export default MemoryLinksPanel;
