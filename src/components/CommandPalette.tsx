/**
 * CommandPalette — the Cmd-K Universal Linker.
 *
 * Three modes (set by `useLinker().openLinker(mode, options)`):
 *   - "jump"   → result click navigates to the entity's detail page.
 *                Also lists static nav routes (Dashboard, Library, …)
 *                so Cmd-K still works as a navigator.
 *   - "link"   → result click POSTs to /links with `options.scope` as
 *                the "from" side. Used by MemoryLinksPanel's "+ Link
 *                existing" button. Filters search to `restrictKind`.
 *   - "create" → free-text quick-create (`/task buy milk`,
 *                `/event Mon 3pm`, …). Currently a stub: shows the
 *                command list and emits a toast — the actual create
 *                writers live in capture/inbox flows.
 *
 * Search is debounced by 150ms (per the W3 risk list — every keystroke
 * fans out to 6 collections). Up/Down/Enter/Esc are wired so the
 * palette never feels mouse-only.
 */
import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Search, ArrowRight, Database, BookOpen, ListChecks, CalendarPlus,
  Bell, Flame, FolderOpen, Network, Plus,
} from 'lucide-react';

import {
  useLinker, type LinkerKind, type LinkerMode,
} from '../contexts/LinkerContext';
import { showToast } from '../App';

interface NavItem {
  id: string;
  label: string;
  path: string;
  icon: React.ComponentType<{ size?: number; color?: string }>;
  color: string;
}

interface SearchHit {
  kind: LinkerKind;
  id: string;
  title: string;
  meta?: string;
  snippet?: string;
  score?: number;
}

interface Props {
  /** Static nav routes shown in jump mode when there's no query. */
  navItems: NavItem[];
}

const KIND_META: Record<LinkerKind, { label: string; color: string; icon: React.ComponentType<{ size?: number; color?: string }> }> = {
  memory:  { label: 'Memory',  color: '#22d3ee', icon: BookOpen },
  task:    { label: 'Task',    color: '#10b981', icon: ListChecks },
  event:   { label: 'Event',   color: '#3b82f6', icon: CalendarPlus },
  revisit: { label: 'Revisit', color: '#fb7185', icon: Bell },
  habit:   { label: 'Habit',   color: '#f59e0b', icon: Flame },
  folder:  { label: 'Folder',  color: '#a78bfa', icon: FolderOpen },
};

// Quick-create commands for `create` mode (and `/`-prefixed input in
// jump/link modes). The actual writers live elsewhere; the palette
// just routes the user there with the typed text pre-filled.
const QUICK_CREATE_CMDS: { prefix: string; label: string; kind: LinkerKind }[] = [
  { prefix: '/task',    label: 'New task',    kind: 'task' },
  { prefix: '/event',   label: 'New event',   kind: 'event' },
  { prefix: '/revisit', label: 'New revisit', kind: 'revisit' },
  { prefix: '/habit',   label: 'New habit',   kind: 'habit' },
  { prefix: '/note',    label: 'New note',    kind: 'memory' },
];

const KIND_ROUTES: Record<LinkerKind, (id: string) => string> = {
  memory:  (id) => `/memory/${encodeURIComponent(id)}`,
  task:    ()   => '/library?tab=tasks',
  event:   ()   => '/calendar',
  revisit: ()   => '/library?tab=revisits',
  habit:   ()   => '/library?tab=habits',
  folder:  (id) => {
    // folder ref id is "project_id/folder_id"
    const [project] = id.split('/');
    return project ? `/workspace?project=${encodeURIComponent(project)}` : '/workspace';
  },
};

const CommandPalette: React.FC<Props> = ({ navItems }) => {
  const { state, closeLinker } = useLinker();
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);

  // Reset every time the palette opens — leaving stale query/results
  // around makes a fresh Cmd-K feel ghost-haunted.
  useEffect(() => {
    if (!state.open) return;
    setQuery('');
    setDebounced('');
    setHits([]);
    setActiveIdx(0);
    // Focus input on next frame so the autoFocus prop fires after
    // motion's mount transition.
    const t = setTimeout(() => inputRef.current?.focus(), 30);
    return () => clearTimeout(t);
  }, [state.open]);

  // 150ms debounce — search fans out to 6 collections per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 150);
    return () => clearTimeout(t);
  }, [query]);

  // Fire the search whenever the debounced query (or restrict kind) changes.
  useEffect(() => {
    if (!state.open) return;
    if (state.mode === 'create') { setHits([]); return; }
    const isQuickCreate = debounced.trim().startsWith('/');
    if (isQuickCreate) { setHits([]); return; }

    let cancelled = false;
    const run = async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        params.set('q', debounced.trim());
        params.set('limit', '20');
        const restrict = state.options.restrictKind;
        if (restrict) params.set('kinds', restrict);
        const res = await fetch(`/search/global?${params.toString()}`);
        if (!res.ok) throw new Error(`search failed: ${res.status}`);
        const data = await res.json();
        if (cancelled) return;
        const next: SearchHit[] = Array.isArray(data?.results) ? data.results : [];
        // In link mode, hide the scope item from results — you can't
        // link a memory to itself.
        const scope = state.options.scope;
        const filtered = scope
          ? next.filter(h => !(h.kind === scope.kind && h.id === scope.id))
          : next;
        setHits(filtered);
        setActiveIdx(0);
      } catch (err: any) {
        if (!cancelled) {
          setHits([]);
          showToast(`Search failed: ${err?.message || err}`, 'error');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void run();
    return () => { cancelled = true; };
  }, [state.open, state.mode, state.options.restrictKind, state.options.scope, debounced]);

  // Items shown when the input is empty (and we're not in create mode):
  // - jump mode → static nav routes
  // - link mode → recent items in the restricted kind (server returns
  //   recency-sorted when `q` is empty, so just reuse `hits`).
  const showNav = state.mode === 'jump' && debounced.trim() === '';
  const isQuickCreate = debounced.trim().startsWith('/');
  const isCreateMode = state.mode === 'create';

  // Quick-create items: in jump/link with `/`, filter to commands that
  // start with the typed prefix. In create mode, show all and use the
  // remainder of the input as the title.
  const quickCreateItems = useMemo(() => {
    if (isCreateMode) {
      const text = debounced.trim();
      const matchedPrefix = QUICK_CREATE_CMDS.find(c => text.startsWith(c.prefix));
      if (matchedPrefix) {
        const title = text.slice(matchedPrefix.prefix.length).trim();
        return [{ ...matchedPrefix, label: title ? `${matchedPrefix.label}: ${title}` : matchedPrefix.label }];
      }
      return QUICK_CREATE_CMDS;
    }
    if (!isQuickCreate) return [];
    const text = debounced.trim();
    return QUICK_CREATE_CMDS.filter(c => c.prefix.startsWith(text.split(/\s+/)[0]));
  }, [debounced, isCreateMode, isQuickCreate]);

  // Combine into a single keyboard-navigable list. Index 0 always
  // exists (palette never renders zero rows when open) so Enter has
  // something deterministic to act on.
  type Row =
    | { type: 'nav'; nav: NavItem }
    | { type: 'hit'; hit: SearchHit }
    | { type: 'create'; cmd: { prefix: string; label: string; kind: LinkerKind } };

  const rows: Row[] = useMemo(() => {
    if (isCreateMode || isQuickCreate) {
      return quickCreateItems.map(c => ({ type: 'create' as const, cmd: c }));
    }
    if (showNav) return navItems.map(n => ({ type: 'nav' as const, nav: n }));
    return hits.map(h => ({ type: 'hit' as const, hit: h }));
  }, [isCreateMode, isQuickCreate, quickCreateItems, showNav, navItems, hits]);

  // Clamp activeIdx whenever rows shrink so an old index doesn't point
  // past the end (would make Enter a no-op silently).
  useEffect(() => {
    setActiveIdx(idx => Math.max(0, Math.min(idx, rows.length - 1)));
  }, [rows.length]);

  const handleLinkAction = useCallback(async (hit: SearchHit) => {
    const scope = state.options.scope;
    if (!scope) return;
    try {
      const res = await fetch('/links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: { kind: scope.kind, id: scope.id },
          to:   { kind: hit.kind,   id: hit.id },
        }),
      });
      if (!res.ok) {
        let detail = '';
        try { detail = (await res.json())?.detail || ''; } catch { /* ignore */ }
        throw new Error(detail || `link failed: ${res.status}`);
      }
      showToast(`Linked ${hit.title}`);
      state.options.onLinked?.({ kind: hit.kind, id: hit.id, title: hit.title });
      closeLinker();
    } catch (err: any) {
      showToast(`Couldn't link: ${err?.message || err}`, 'error');
    }
  }, [state.options, closeLinker]);

  const handleQuickCreate = useCallback((cmd: { prefix: string; kind: LinkerKind }) => {
    // Quick-create writers don't exist as a single endpoint yet — the
    // capture flow + per-section "Create new" forms in MemoryLinksPanel
    // own those. For now, route the user to the most useful place and
    // let them fill out the rest there.
    closeLinker();
    if (cmd.kind === 'task' || cmd.kind === 'habit' || cmd.kind === 'revisit') {
      navigate('/library?tab=' + (cmd.kind === 'task' ? 'tasks' : cmd.kind === 'habit' ? 'habits' : 'revisits'));
    } else if (cmd.kind === 'event') {
      navigate('/calendar');
    } else if (cmd.kind === 'memory') {
      navigate('/capture');
    }
    showToast('Quick-create coming soon — landed you in the right place', 'info');
  }, [closeLinker, navigate]);

  const handleSelect = useCallback((row: Row) => {
    if (row.type === 'nav') {
      navigate(row.nav.path);
      closeLinker();
      return;
    }
    if (row.type === 'create') {
      handleQuickCreate(row.cmd);
      return;
    }
    // hit
    if (state.mode === 'link') {
      void handleLinkAction(row.hit);
      return;
    }
    // jump
    const route = KIND_ROUTES[row.hit.kind]?.(row.hit.id);
    if (route) navigate(route);
    closeLinker();
  }, [state.mode, navigate, closeLinker, handleLinkAction, handleQuickCreate]);

  // Local keyboard handling (Esc/Up/Down/Enter). Mounted on the input
  // so it doesn't fight the global Cmd-K listener in AppShell.
  const handleKey = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeLinker();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx(idx => Math.min(rows.length - 1, idx + 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx(idx => Math.max(0, idx - 1));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const row = rows[activeIdx];
      if (row) handleSelect(row);
    }
  }, [rows, activeIdx, handleSelect, closeLinker]);

  if (!state.open) return null;

  const headerLabel = state.mode === 'link'
    ? `Link to ${state.options.scope?.title || 'item'}`
    : state.mode === 'create'
      ? 'Quick create'
      : 'Search & jump';

  const placeholder = state.mode === 'link'
    ? `Search ${state.options.restrictKind ? KIND_META[state.options.restrictKind].label.toLowerCase() + 's' : 'everything'} to link…`
    : state.mode === 'create'
      ? 'Type /task, /event, /revisit, /habit, /note…'
      : 'Search memories, tasks… or type / for commands';

  return (
    <div
      data-testid="command-palette"
      style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '14vh 16px 16px' }}
    >
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={closeLinker}
        style={{ position: 'absolute', inset: 0, background: 'rgba(15,23,42,0.4)', backdropFilter: 'blur(4px)' }}
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: -16 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96, y: -16 }}
        style={{ position: 'relative', width: '100%', maxWidth: 600, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}
      >
        <div style={{ padding: '13px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <Search size={15} color="var(--primary)" />
          <input
            ref={inputRef}
            data-testid="command-palette-input"
            autoFocus
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKey}
            placeholder={placeholder}
            className="bare-input"
            style={{ flex: 1, color: 'var(--text-1)', fontSize: 14, fontFamily: 'inherit' }}
          />
          <div style={{ padding: '3px 8px', background: 'var(--surface-3)', borderRadius: 6, color: 'var(--text-3)', fontSize: 10, fontWeight: 700 }}>
            ESC
          </div>
        </div>

        <div style={{ padding: '6px', maxHeight: '55vh', overflowY: 'auto' }} className="scroll-custom">
          <div style={{ padding: '8px 10px 4px', color: 'var(--text-3)', fontSize: 10, letterSpacing: '1.5px', textTransform: 'uppercase', fontWeight: 700, display: 'flex', justifyContent: 'space-between' }}>
            <span>{headerLabel}</span>
            {loading && <span data-testid="command-palette-loading">Searching…</span>}
          </div>

          {rows.length === 0 && !loading && (
            <div data-testid="command-palette-empty" style={{ padding: '18px 12px', color: 'var(--text-3)', fontSize: 12 }}>
              {debounced.trim()
                ? 'No matches. Try a different word or type / to create.'
                : state.mode === 'link'
                  ? 'Start typing to search…'
                  : 'Type to search anything in your X247.'}
            </div>
          )}

          {rows.map((row, idx) => {
            const isActive = idx === activeIdx;
            const baseStyle: React.CSSProperties = {
              width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '9px 10px', borderRadius: 10,
              background: isActive ? 'var(--surface-2)' : 'transparent',
              border: 'none', cursor: 'pointer', transition: 'background 0.12s', fontFamily: 'inherit', textAlign: 'left',
            };

            if (row.type === 'nav') {
              const Icon = row.nav.icon;
              return (
                <button
                  key={`nav:${row.nav.id}`}
                  data-testid={`command-palette-row-nav-${row.nav.id}`}
                  onClick={() => handleSelect(row)}
                  onMouseEnter={() => setActiveIdx(idx)}
                  style={baseStyle}
                >
                  <div style={{ width: 32, height: 32, borderRadius: 8, background: `${row.nav.color}15`, border: `1px solid ${row.nav.color}35`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <Icon size={14} color={row.nav.color} />
                  </div>
                  <span style={{ color: 'var(--text-1)', fontSize: 13, flex: 1 }}>{row.nav.label}</span>
                  <ArrowRight size={12} color="var(--text-3)" />
                </button>
              );
            }

            if (row.type === 'create') {
              return (
                <button
                  key={`create:${row.cmd.prefix}`}
                  data-testid={`command-palette-row-create-${row.cmd.kind}`}
                  onClick={() => handleSelect(row)}
                  onMouseEnter={() => setActiveIdx(idx)}
                  style={baseStyle}
                >
                  <div style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--primary-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <Plus size={14} color="var(--primary)" />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ color: 'var(--text-1)', fontSize: 13, fontWeight: 600 }}>{row.cmd.label}</div>
                    <div style={{ color: 'var(--text-3)', fontSize: 11, marginTop: 1 }}>
                      <code>{row.cmd.prefix}</code>
                    </div>
                  </div>
                  <ArrowRight size={12} color="var(--text-3)" />
                </button>
              );
            }

            // hit
            const meta = KIND_META[row.hit.kind];
            const KindIcon = meta?.icon || Database;
            return (
              <button
                key={`${row.hit.kind}:${row.hit.id}`}
                data-testid={`command-palette-row-${row.hit.kind}-${row.hit.id}`}
                onClick={() => handleSelect(row)}
                onMouseEnter={() => setActiveIdx(idx)}
                style={baseStyle}
              >
                <div style={{ width: 32, height: 32, borderRadius: 8, background: `${meta?.color || '#888'}15`, border: `1px solid ${meta?.color || '#888'}35`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <KindIcon size={14} color={meta?.color || '#888'} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: 'var(--text-1)', fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {row.hit.title}
                  </div>
                  <div style={{ color: 'var(--text-3)', fontSize: 11, marginTop: 1, display: 'flex', gap: 6, alignItems: 'center' }}>
                    <span style={{ textTransform: 'uppercase', letterSpacing: '0.6px', color: meta?.color || 'var(--text-3)', fontWeight: 700 }}>
                      {meta?.label || row.hit.kind}
                    </span>
                    {row.hit.meta && <span>· {row.hit.meta}</span>}
                  </div>
                  {row.hit.snippet && (
                    <div style={{ color: 'var(--text-3)', fontSize: 11, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {row.hit.snippet}
                    </div>
                  )}
                </div>
                {state.mode === 'link'
                  ? <Network size={12} color="var(--text-3)" />
                  : <ArrowRight size={12} color="var(--text-3)" />}
              </button>
            );
          })}
        </div>

        <div style={{ padding: '10px 16px', background: 'var(--surface-2)', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ color: 'var(--text-3)', fontSize: 10 }}>↑↓ Navigate · Enter to select · Esc to close</span>
          <span style={{ color: 'var(--text-3)', fontSize: 10, letterSpacing: '1px', textTransform: 'uppercase' }}>
            {state.mode}
          </span>
        </div>
      </motion.div>
    </div>
  );
};

export default CommandPalette;
