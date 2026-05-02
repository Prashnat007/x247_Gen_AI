import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Bookmark, Plus, Search, Trash2, ExternalLink, Globe, Tag as TagIcon,
  CheckCircle2, Clock, BookOpen, Filter, X, Link as LinkIcon,
  Archive, ArchiveRestore, FolderInput, Play, CheckSquare, Square, Download,
  Pin, ArrowDownAZ, ArrowDownWideNarrow, Calendar as CalendarIcon
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { getYouTubeId } from '../lib/utils';
import { showToast } from '../App';
import type { BulkApiResponse } from '../lib/types';
import ViewModeToggle, { useViewModePref } from '../components/ViewModeToggle';

type BMStatus = 'unread' | 'reading' | 'done';
// Aligned with the shared ViewModeToggle hook ('list' | 'grid'). The old
// HEAD value 'card' is treated as 'grid' everywhere below.
type ViewMode = 'list' | 'grid';
type SortBy = 'recent' | 'oldest' | 'az' | 'most-tagged';

interface BM {
  id: string;
  url: string;
  title: string;
  description: string;
  domain: string;
  tags: string[];
  status: 'unread' | 'reading' | 'done';
  created_at: string;
  favicon: string;
  pinned?: boolean;
}

const STATUS_META = {
  unread: { color: '#3b82f6', label: 'Unread', icon: Clock },
  reading: { color: '#f59e0b', label: 'Reading', icon: BookOpen },
  done: { color: '#10b981', label: 'Done', icon: CheckCircle2 },
};

const SORT_META: Record<SortBy, { label: string; icon: React.ComponentType<{ size?: number; color?: string }> }> = {
  recent:       { label: 'Recent',      icon: CalendarIcon },
  oldest:       { label: 'Oldest',      icon: CalendarIcon },
  az:           { label: 'A → Z',       icon: ArrowDownAZ },
  'most-tagged':{ label: 'Most tagged', icon: ArrowDownWideNarrow },
};

// `viewMode` and `density` are persisted by `useViewModePref` under
// `recall:bookmarks:*`. Sort order keeps its own legacy key so existing
// users don't lose their preference.
const LS_SORT = 'bm-sort-by';
const readLS = <T extends string>(k: string, fallback: T, allowed: T[]): T => {
  try {
    const v = localStorage.getItem(k);
    return v && (allowed as string[]).includes(v) ? (v as T) : fallback;
  } catch { return fallback; }
};

interface BookmarksPageProps { embedded?: boolean }
const BookmarksPage: React.FC<BookmarksPageProps> = ({ embedded = false }) => {
  const [items, setItems] = useState<BM[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [domainFilter, setDomainFilter] = useState<string | null>(null);
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [newUrl, setNewUrl] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [newTags, setNewTags] = useState('');
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [tagPrompt, setTagPrompt] = useState<null | 'add' | 'remove'>(null);
  const [tagPromptInput, setTagPromptInput] = useState('');
  const [moveProjectPrompt, setMoveProjectPrompt] = useState(false);
  const [moveProjectInput, setMoveProjectInput] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  // viewMode + density come from the shared hook (persisted under
  // `recall:bookmarks:*`). sortBy + sort menu / keyboard shortcuts are
  // Bookmarks-specific and stay local.
  const { viewMode, setViewMode, density, setDensity } = useViewModePref('recall:bookmarks');
  const [sortBy, setSortBy]     = useState<SortBy>(() => readLS<SortBy>(LS_SORT, 'recent', ['recent', 'oldest', 'az', 'most-tagged']));
  const [showSortMenu, setShowSortMenu] = useState(false);
  const sortBtnRef = useRef<HTMLButtonElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  // Persist sort pref (viewMode + density already persisted by useViewModePref)
  useEffect(() => { try { localStorage.setItem(LS_SORT, sortBy); } catch { /* ignore */ } }, [sortBy]);

  // Close sort menu on outside click + keyboard "/" focuses the search input
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (showSortMenu && sortBtnRef.current && !sortBtnRef.current.parentElement?.contains(e.target as Node)) {
        setShowSortMenu(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '/' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
      if (e.key === 'Escape') setShowSortMenu(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [showSortMenu]);

  const load = () => {
    fetch(`/bookmarks${showArchived ? '?include_archived=true' : ''}`)
      .then(r => r.ok ? r.json() : [])
      .then((data: unknown) => {
        setItems(Array.isArray(data) ? (data as BM[]) : []);
        setLoading(false);
      }).catch(() => setLoading(false));
  };

  useEffect(() => { load(); }, [showArchived]);

  const domains = useMemo(() => {
    const map: Record<string, number> = {};
    items.forEach(i => { map[i.domain] = (map[i.domain] || 0) + 1; });
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }, [items]);

  const filtered = useMemo(() => {
    return items.filter(i => {
      if (statusFilter && i.status !== statusFilter) return false;
      if (domainFilter && i.domain !== domainFilter) return false;
      if (tagFilter && !i.tags.includes(tagFilter)) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!i.title.toLowerCase().includes(q) && !i.url.toLowerCase().includes(q) && !i.description.toLowerCase().includes(q) && !i.tags.some(t => t.includes(q))) return false;
      }
      return true;
    });
  }, [items, search, statusFilter, domainFilter, tagFilter]);

  // Sort + split pinned-first. Pinned items always float to top regardless of sort.
  const sorted = useMemo(() => {
    const arr = [...filtered];
    switch (sortBy) {
      case 'oldest':       arr.sort((a, b) => (a.created_at || '').localeCompare(b.created_at || '')); break;
      case 'az':           arr.sort((a, b) => (a.title || '').localeCompare(b.title || '')); break;
      case 'most-tagged':  arr.sort((a, b) => b.tags.length - a.tags.length); break;
      case 'recent':
      default:             arr.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
    }
    return arr;
  }, [filtered, sortBy]);

  const pinnedItems = useMemo(() => sorted.filter(i => i.pinned), [sorted]);
  const otherItems  = useMemo(() => sorted.filter(i => !i.pinned), [sorted]);

  const activeFilterCount =
    (statusFilter ? 1 : 0) +
    (domainFilter ? 1 : 0) +
    (tagFilter    ? 1 : 0) +
    (search.trim()? 1 : 0);

  const clearAllFilters = () => {
    setStatusFilter(''); setDomainFilter(null); setTagFilter(null); setSearch('');
  };

  const counts = {
    all: items.length,
    unread:  items.filter(i => i.status === 'unread').length,
    reading: items.filter(i => i.status === 'reading').length,
    done:    items.filter(i => i.status === 'done').length,
    pinned:  items.filter(i => i.pinned).length,
  };

  const addBookmark = async () => {
    if (!newUrl.trim()) return;
    const tags = newTags.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
    await fetch('/bookmarks', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: newUrl, title: newTitle, tags })
    });
    setNewUrl(''); setNewTitle(''); setNewTags(''); setShowAdd(false);
    load();
  };

  const updateStatus = async (id: string, status: BMStatus) => {
    await fetch(`/bookmarks/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) });
    setItems(items.map(i => i.id === id ? { ...i, status } : i));
  };

  const togglePin = async (id: string) => {
    const cur = items.find(i => i.id === id);
    if (!cur) return;
    const next = !cur.pinned;
    // Optimistic update — use functional setItems so a concurrent edit
    // (status change, delete) doesn't get clobbered by stale closure data.
    setItems(prev => prev.map(i => i.id === id ? { ...i, pinned: next } : i));
    try {
      const r = await fetch(`/bookmarks/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pinned: next }) });
      if (!r.ok) throw new Error('pin failed');
      showToast(next ? 'Pinned to top' : 'Unpinned');
    } catch {
      // Roll back only the pinned field; preserve any other concurrent edits.
      setItems(prev => prev.map(i => i.id === id ? { ...i, pinned: cur.pinned } : i));
      showToast('Could not update pin');
    }
  };

  const deleteBM = async (id: string) => {
    if (!confirm('Move this bookmark to Trash?')) return;
    await fetch(`/bookmarks/${id}`, { method: 'DELETE' });
    setItems(items.filter(i => i.id !== id));
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const exitSelect = () => { setSelectMode(false); setSelectedIds(new Set()); setTagPrompt(null); setMoveProjectPrompt(false); };

  const bulkApi = async (path: string, body: Record<string, unknown>, okMsg: string) => {
    setBulkBusy(true);
    try {
      const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error('bulk failed');
      await r.json().catch(() => ({} as BulkApiResponse));
      showToast(okMsg);
      load();
      exitSelect();
    } catch {
      showToast('Bulk action failed');
    } finally { setBulkBusy(false); }
  };

  const bulkDelete = () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`Move ${selectedIds.size} bookmarks to Trash?`)) return;
    bulkApi('/library/bulk-delete', { entity: 'bookmark', ids: Array.from(selectedIds) }, 'Moved to Trash');
  };

  const bulkArchive = () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`Archive ${selectedIds.size} bookmarks? They get hidden from the main list but stay searchable.`)) return;
    bulkApi('/library/bulk-archive', { entity: 'bookmark', ids: Array.from(selectedIds), archived: true }, 'Archived');
  };

  const bulkUnarchive = () => {
    if (selectedIds.size === 0) return;
    bulkApi('/library/bulk-archive', { entity: 'bookmark', ids: Array.from(selectedIds), archived: false }, 'Unarchived');
  };

  const submitMoveProject = () => {
    const pid = moveProjectInput.trim();
    if (!pid || selectedIds.size === 0) { setMoveProjectPrompt(false); setMoveProjectInput(''); return; }
    bulkApi('/library/bulk-move-project', { entity: 'bookmark', ids: Array.from(selectedIds), project_id: pid }, 'Moved to project');
    setMoveProjectInput('');
  };

  const submitClearProject = () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`Remove ${selectedIds.size} bookmarks from any project?`)) return;
    bulkApi('/library/bulk-move-project', { entity: 'bookmark', ids: Array.from(selectedIds), project_id: null }, 'Cleared project');
    setMoveProjectInput('');
  };

  const bulkTagAdd = () => {
    const tags = tagPromptInput.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
    if (!tags.length || selectedIds.size === 0) return;
    bulkApi('/library/bulk-tag-add', { entity: 'bookmark', ids: Array.from(selectedIds), tags }, 'Tags added');
    setTagPromptInput('');
  };

  const bulkTagRemove = () => {
    const tags = tagPromptInput.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
    if (!tags.length || selectedIds.size === 0) return;
    bulkApi('/library/bulk-tag-remove', { entity: 'bookmark', ids: Array.from(selectedIds), tags }, 'Tags removed');
    setTagPromptInput('');
  };

  const bulkSetStatus = async (status: BMStatus) => {
    if (selectedIds.size === 0) return;
    setBulkBusy(true);
    try {
      // No backend bulk-status endpoint yet — parallel PUTs are fast enough
      // for the typical "select 5–20 bookmarks" use case. fetch() does NOT
      // reject on HTTP 4xx/5xx, so we have to inspect each response.ok and
      // only mutate state for the ids that actually succeeded.
      const ids = Array.from(selectedIds);
      const results = await Promise.all(ids.map(async id => {
        try {
          const r = await fetch(`/bookmarks/${id}`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }),
          });
          return { id, ok: r.ok };
        } catch {
          return { id, ok: false };
        }
      }));
      const okIds = new Set(results.filter(r => r.ok).map(r => r.id));
      const failed = results.length - okIds.size;
      if (okIds.size > 0) {
        setItems(prev => prev.map(i => okIds.has(i.id) ? { ...i, status } : i));
      }
      if (failed === 0) {
        showToast(`Marked ${okIds.size} as ${status}`);
        exitSelect();
      } else if (okIds.size === 0) {
        showToast(`Could not update — try again`);
      } else {
        showToast(`Marked ${okIds.size} as ${status}, ${failed} failed`);
      }
    } finally { setBulkBusy(false); }
  };

  const bulkExport = () => {
    if (selectedIds.size === 0) return;
    const chosen = items.filter(i => selectedIds.has(i.id));
    const text = chosen.map(b => `- [${b.title}](${b.url})${b.tags.length ? '  ' + b.tags.map(t => '#' + t).join(' ') : ''}`).join('\n');
    const blob = new Blob([text], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `bookmarks-export-${Date.now()}.md`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    showToast(`Exported ${chosen.length} bookmarks`);
  };

  // Single render fn so list and grid mode share the same per-item markup.
  // Grid mode = thumbnail on top, body below; list mode = horizontal row.
  const renderBookmark = (bm: BM, mode: ViewMode) => {
    const meta = STATUS_META[bm.status] || STATUS_META.unread;
    const StatusIcon = meta.icon;
    const ytId = getYouTubeId(bm.url);
    const isSel = selectedIds.has(bm.id);
    const isCard = mode === 'grid';
    const dateStr = bm.created_at ? new Date(bm.created_at).toLocaleDateString() : '';

    const thumb = ytId ? (
      <a href={bm.url} target="_blank" rel="noreferrer" title={`Play "${bm.title}" on YouTube`}
        onClick={e => { if (selectMode) { e.preventDefault(); e.stopPropagation(); toggleSelect(bm.id); } }}
        style={isCard
          ? { position: 'relative', width: '100%', aspectRatio: '16 / 9', borderRadius: 8, overflow: 'hidden', flexShrink: 0, background: '#000', display: 'block', textDecoration: 'none' }
          : { position: 'relative', width: 96, height: 54, borderRadius: 8, overflow: 'hidden', flexShrink: 0, background: '#000', display: 'block', textDecoration: 'none' }}>
        <img src={`https://img.youtube.com/vi/${ytId}/mqdefault.jpg`} alt={bm.title} loading="lazy"
          onError={e => { (e.currentTarget as HTMLImageElement).src = `https://img.youtube.com/vi/${ytId}/hqdefault.jpg`; }}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(0,0,0,0.05) 0%, rgba(0,0,0,0.45) 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ width: isCard ? 38 : 24, height: isCard ? 38 : 24, borderRadius: '50%', background: 'rgba(239,68,68,0.95)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Play size={isCard ? 16 : 11} color="#fff" fill="#fff" style={{ marginLeft: 1 }} />
          </div>
        </div>
        <span style={{ position: 'absolute', top: 4, left: 4, padding: '2px 6px', background: 'rgba(239,68,68,0.92)', borderRadius: 4, color: '#fff', fontSize: 8.5, fontWeight: 700, letterSpacing: '0.5px', lineHeight: 1.1 }}>YT</span>
      </a>
    ) : (
      <img src={bm.favicon} alt=""
        style={isCard
          ? { width: 32, height: 32, borderRadius: 7, background: 'var(--surface-2)', border: '1px solid var(--border)', flexShrink: 0 }
          : { width: 28, height: 28, borderRadius: 7, background: 'var(--surface-2)', border: '1px solid var(--border)', flexShrink: 0 }}
        onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
    );

    return (
      <motion.div key={bm.id} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} whileHover={{ y: -1 }}
        onClick={() => { if (selectMode) toggleSelect(bm.id); }}
        className={isCard ? 'bm-item-card' : 'bm-item'}
        style={isCard
          ? { display: 'flex', flexDirection: 'column', gap: 10, padding: 12, background: selectMode && isSel ? 'rgba(99,102,241,0.08)' : 'var(--surface)', border: `1px solid ${selectMode && isSel ? 'var(--primary)' : bm.pinned ? 'rgba(236,72,153,0.35)' : ytId ? 'rgba(239,68,68,0.22)' : 'var(--border)'}`, borderRadius: 12, transition: 'all 0.15s', cursor: selectMode ? 'pointer' : 'default', position: 'relative' }
          : { display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', background: selectMode && isSel ? 'rgba(99,102,241,0.08)' : 'var(--surface)', border: `1px solid ${selectMode && isSel ? 'var(--primary)' : bm.pinned ? 'rgba(236,72,153,0.35)' : ytId ? 'rgba(239,68,68,0.22)' : 'var(--border)'}`, borderRadius: 12, transition: 'all 0.15s', cursor: selectMode ? 'pointer' : 'default', position: 'relative' }}>
        {selectMode && (
          <button onClick={e => { e.stopPropagation(); toggleSelect(bm.id); }}
            style={{ background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', display: 'flex', position: isCard ? 'absolute' : 'static', top: isCard ? 8 : undefined, left: isCard ? 8 : undefined, zIndex: 2 }}>
            {isSel ? <CheckSquare size={16} color="var(--primary)" /> : <Square size={16} color="var(--text-3)" />}
          </button>
        )}

        {/* Pin badge for pinned items in card mode (visual cue) */}
        {isCard && bm.pinned && (
          <Pin size={12} color="#ec4899" fill="#ec4899" style={{ position: 'absolute', top: 8, right: 8, zIndex: 2 }} />
        )}

        {thumb}

        <div className="bm-item-body" style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div className="bm-item-title-row" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <a href={bm.url} target="_blank" rel="noreferrer"
              style={{ color: 'var(--text-1)', fontSize: 13.5, fontWeight: 700, textDecoration: 'none', flex: 1, minWidth: 0, ...(isCard
                ? { display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', lineHeight: 1.3 }
                : { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }) }}>
              {bm.title}
            </a>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '1px 8px', background: `${meta.color}15`, border: `1px solid ${meta.color}30`, borderRadius: 10, color: meta.color, fontSize: 9.5, fontWeight: 700, flexShrink: 0 }}>
              <StatusIcon size={9} /> {meta.label}
            </span>
          </div>
          <div className="bm-item-meta" style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-3)', fontSize: 11, flexWrap: 'wrap' }}>
            <Globe size={10} /> <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: isCard ? 200 : 220 }}>{bm.url}</span>
            {dateStr && (<>
              <span style={{ opacity: 0.5 }}>·</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}><Clock size={9} /> {dateStr}</span>
            </>)}
          </div>
          {bm.tags.length > 0 && (
            <div className="bm-item-tags" style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {bm.tags.slice(0, isCard ? 5 : 3).map(t => (
                <button key={t} onClick={e => { e.stopPropagation(); setTagFilter(tagFilter === t ? null : t); }}
                  title={tagFilter === t ? 'Clear tag filter' : `Filter by #${t}`}
                  style={{ padding: '2px 7px', background: tagFilter === t ? 'rgba(99,102,241,0.18)' : 'var(--surface-2)', border: `1px solid ${tagFilter === t ? 'var(--primary-border)' : 'var(--border)'}`, borderRadius: 8, color: tagFilter === t ? 'var(--primary)' : 'var(--text-2)', fontSize: 10, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                  #{t}
                </button>
              ))}
              {bm.tags.length > (isCard ? 5 : 3) && (
                <span style={{ padding: '2px 6px', color: 'var(--text-3)', fontSize: 10, fontWeight: 600 }}>+{bm.tags.length - (isCard ? 5 : 3)}</span>
              )}
            </div>
          )}
          {bm.description && !isCard && (
            <p style={{ margin: '2px 0 0', color: 'var(--text-3)', fontSize: 11.5, lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{bm.description}</p>
          )}
          {bm.description && isCard && (
            <p style={{ margin: '2px 0 0', color: 'var(--text-3)', fontSize: 11.5, lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{bm.description}</p>
          )}
        </div>

        <div className="bm-item-actions" style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0, ...(isCard ? { justifyContent: 'flex-end', width: '100%', borderTop: '1px solid var(--border)', paddingTop: 8, marginTop: 4 } : {}) }}>
          <button onClick={e => { e.stopPropagation(); togglePin(bm.id); }} title={bm.pinned ? 'Unpin' : 'Pin to top'}
            style={{ padding: 7, background: bm.pinned ? 'rgba(236,72,153,0.12)' : 'var(--surface-2)', border: `1px solid ${bm.pinned ? 'rgba(236,72,153,0.35)' : 'var(--border)'}`, borderRadius: 7, color: bm.pinned ? '#ec4899' : 'var(--text-3)', cursor: 'pointer', display: 'flex' }}>
            <Pin size={11} fill={bm.pinned ? '#ec4899' : 'none'} />
          </button>
          <select value={bm.status} onChange={e => updateStatus(bm.id, e.target.value as BMStatus)} onClick={e => e.stopPropagation()}
            style={{ padding: '5px 8px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 7, color: 'var(--text-1)', fontSize: 11, fontFamily: 'inherit', cursor: 'pointer', outline: 'none' }}>
            <option value="unread">Unread</option>
            <option value="reading">Reading</option>
            <option value="done">Done</option>
          </select>
          <a href={bm.url} target="_blank" rel="noreferrer" title="Open" onClick={e => e.stopPropagation()}
            style={{ padding: 7, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 7, color: 'var(--text-2)', display: 'flex', textDecoration: 'none' }}>
            <ExternalLink size={11} />
          </a>
          <button onClick={e => { e.stopPropagation(); deleteBM(bm.id); }} title="Delete"
            style={{ padding: 7, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 7, color: '#ef4444', cursor: 'pointer', display: 'flex' }}>
            <Trash2 size={11} />
          </button>
        </div>
      </motion.div>
    );
  };

  return (
    <div className="bookmarks-page" style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '14px 0 28px', minHeight: 'calc(100vh - 5rem)' }}>

      {/* HERO HEADER */}
      {!embedded && (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ width: 52, height: 52, borderRadius: 14, background: 'linear-gradient(135deg, rgba(236,72,153,0.25), rgba(219,39,119,0.18))', border: '1px solid rgba(236,72,153,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 28px rgba(236,72,153,0.2)' }}>
              <Bookmark size={24} color="#ec4899" />
            </div>
            <div>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '4px 12px', background: 'rgba(236,72,153,0.1)', border: '1px solid rgba(236,72,153,0.3)', borderRadius: 20, marginBottom: 6 }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#10b981', boxShadow: '0 0 8px #10b981' }} />
                <span style={{ fontSize: 10.5, fontWeight: 700, color: '#ec4899', letterSpacing: '0.5px' }}>{counts.all} BOOKMARKS · READ-LATER QUEUE</span>
              </div>
              <h2 style={{ fontSize: 'clamp(22px,3.5vw,30px)', fontWeight: 900, color: 'var(--text-1)', margin: 0, letterSpacing: '-0.6px', lineHeight: 1.05 }}>
                Bookmarks <span style={{ color: '#ec4899' }}>✦</span>
              </h2>
              <p style={{ color: 'var(--text-3)', fontSize: 13.5, margin: '4px 0 0' }}>
                Save links now, read later. Tag, organise and convert into memories
              </p>
            </div>
          </div>
          <button onClick={() => setShowAdd(true)} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '10px 18px', background: 'linear-gradient(135deg,#ec4899,#db2777)', border: 'none', borderRadius: 10, color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', boxShadow: '0 4px 16px rgba(236,72,153,0.4)' }}>
            <Plus size={14} /> Add bookmark
          </button>
        </div>

        {/* Stats strip */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
          {[
            { icon: LinkIcon, color: '#a78bfa', label: 'Total saved', value: counts.all },
            { icon: Clock, color: '#3b82f6', label: 'Unread', value: counts.unread },
            { icon: BookOpen, color: '#f59e0b', label: 'Reading', value: counts.reading },
            { icon: CheckCircle2, color: '#10b981', label: 'Completed', value: counts.done },
          ].map(stat => (
            <div key={stat.label} style={{ padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 13 }}>
              <div style={{ width: 40, height: 40, borderRadius: 10, background: `${stat.color}15`, border: `1px solid ${stat.color}30`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <stat.icon size={18} color={stat.color} />
              </div>
              <div>
                <div style={{ color: 'var(--text-3)', fontSize: 10.5, fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase' }}>{stat.label}</div>
                <div style={{ color: 'var(--text-1)', fontSize: 22, fontWeight: 800, lineHeight: 1.1 }}>{stat.value}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
      )}

      {!embedded ? null : (
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={() => setShowAdd(true)} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '8px 14px', background: 'linear-gradient(135deg,#ec4899,#db2777)', border: 'none', borderRadius: 9, color: '#fff', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
            <Plus size={13} /> Add bookmark
          </button>
        </div>
      )}

      {/* TOOLBAR — search, status pills, sort, view toggle, utility chips */}
      <div className="bm-toolbar" style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>

        {/* Row 1 — search input full-width */}
        <div className="bm-search-row" style={{ position: 'relative' }}>
          <Search size={13} color="var(--text-3)" style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)' }} />
          <input ref={searchInputRef} value={search} onChange={e => setSearch(e.target.value)} placeholder='Search title, URL, tags…  (press "/" to focus)'
            style={{ width: '100%', padding: '9px 36px 9px 32px', borderRadius: 9, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text-1)', fontSize: 12.5, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }} />
          {search && (
            <button onClick={() => setSearch('')} aria-label="Clear search"
              style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', padding: 4, cursor: 'pointer', color: 'var(--text-3)', display: 'flex' }}>
              <X size={12} />
            </button>
          )}
        </div>

        {/* Row 2 — status segmented + sort + view toggle */}
        <div className="bm-controls-row" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <div className="bm-status-pills" style={{ display: 'flex', gap: 6, flex: '1 1 auto', minWidth: 0 }}>
            {(['', 'unread', 'reading', 'done'] as const).map(s => {
              const meta = s ? STATUS_META[s as 'unread' | 'reading' | 'done'] : { color: '#a78bfa', label: 'All', icon: Filter };
              const Icon = meta.icon;
              const isActive = statusFilter === s;
              const c = s ? counts[s as 'unread' | 'reading' | 'done'] : counts.all;
              return (
                <button key={s || 'all'} onClick={() => setStatusFilter(s)}
                  style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '7px 11px', background: isActive ? `${meta.color}15` : 'transparent', border: `1px solid ${isActive ? meta.color + '50' : 'var(--border)'}`, borderRadius: 9, color: isActive ? meta.color : 'var(--text-2)', fontSize: 11.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
                  <Icon size={11} /> {meta.label} <span style={{ opacity: 0.7, fontWeight: 600 }}>{c}</span>
                </button>
              );
            })}
          </div>

          {/* Sort dropdown */}
          <div style={{ position: 'relative' }}>
            <button ref={sortBtnRef} onClick={() => setShowSortMenu(v => !v)} title="Sort by"
              style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '7px 11px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 9, color: 'var(--text-2)', fontSize: 11.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
              {(() => { const M = SORT_META[sortBy]; const I = M.icon; return <><I size={11} /> {M.label}</>; })()}
            </button>
            {showSortMenu && (
              <div style={{ position: 'absolute', top: 'calc(100% + 4px)', right: 0, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 4, minWidth: 160, zIndex: 50, boxShadow: '0 8px 24px rgba(0,0,0,0.15)' }}>
                {(Object.keys(SORT_META) as SortBy[]).map(k => {
                  const M = SORT_META[k]; const I = M.icon;
                  return (
                    <button key={k} onClick={() => { setSortBy(k); setShowSortMenu(false); }}
                      style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 10px', background: sortBy === k ? 'var(--primary-bg)' : 'transparent', border: 'none', borderRadius: 7, color: sortBy === k ? 'var(--primary)' : 'var(--text-1)', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>
                      <I size={12} /> {M.label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* View / density toggle replaced by the shared ViewModeToggle —
              now lives on the utility row below alongside the filter chips. */}
        </div>

        {/* Row 3 — utility chips */}
        <div className="bm-utility-row" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <button onClick={() => { if (selectMode) exitSelect(); else setSelectMode(true); }}
            style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 10px', background: selectMode ? 'var(--primary-bg)' : 'transparent', border: `1px solid ${selectMode ? 'var(--primary-border)' : 'var(--border)'}`, borderRadius: 8, color: selectMode ? 'var(--primary)' : 'var(--text-2)', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
            {selectMode ? <CheckSquare size={11} /> : <Square size={11} />}
            {selectMode ? `${selectedIds.size} selected` : 'Select'}
          </button>
          <button onClick={() => setShowArchived(v => !v)} title={showArchived ? 'Hide archived' : 'Show archived too'}
            style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 10px', background: showArchived ? 'rgba(168,85,247,0.12)' : 'transparent', border: `1px solid ${showArchived ? 'rgba(168,85,247,0.4)' : 'var(--border)'}`, borderRadius: 8, color: showArchived ? '#a855f7' : 'var(--text-2)', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
            <Archive size={11} /> {showArchived ? 'Archived shown' : 'Archived'}
          </button>
          {selectMode && filtered.length > 0 && (
            <button onClick={() => {
              const allIds = new Set(filtered.map(i => i.id));
              setSelectedIds(selectedIds.size === filtered.length ? new Set() : allIds);
            }}
              style={{ padding: '6px 10px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-2)', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
              {selectedIds.size === filtered.length ? 'Clear' : 'Select all'}
            </button>
          )}

          {/* Active-filter chips with X — make it dead-obvious what's filtered */}
          {activeFilterCount > 0 && (
            <>
              <span style={{ color: 'var(--text-3)', fontSize: 10.5, fontWeight: 600, marginLeft: 4 }}>·</span>
              {tagFilter && (
                <button onClick={() => setTagFilter(null)} title="Clear tag filter"
                  style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '5px 9px', background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.35)', borderRadius: 8, color: 'var(--primary)', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                  #{tagFilter} <X size={10} />
                </button>
              )}
              {domainFilter && (
                <button onClick={() => setDomainFilter(null)} title="Clear domain filter"
                  style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '5px 9px', background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.35)', borderRadius: 8, color: 'var(--primary)', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                  <Globe size={10} /> {domainFilter} <X size={10} />
                </button>
              )}
              <button onClick={clearAllFilters} title="Clear all active filters"
                style={{ padding: '5px 9px', background: 'transparent', border: '1px dashed var(--border-2)', borderRadius: 8, color: 'var(--text-3)', fontSize: 10.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                Clear all
              </button>
            </>
          )}

          {/* Shared view / density toggle (same component used on Vault and
              Notes). Persisted under `recall:bookmarks:*` so each surface
              remembers its own choice. Pushed to the right with auto-margin. */}
          <div style={{ marginLeft: 'auto' }}>
            <ViewModeToggle
              viewMode={viewMode}
              onViewMode={setViewMode}
              density={density}
              onDensity={setDensity}
              testIdPrefix="bookmarks"
            />
          </div>
        </div>

        {/* BULK ACTION BAR (only when selecting) */}
        {selectMode && selectedIds.size > 0 && (
          <div className="bm-bulk-bar" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, padding: 10, background: 'var(--surface-2)', border: '1px solid var(--primary-border)', borderRadius: 10 }}>
            <span style={{ color: 'var(--primary)', fontSize: 11.5, fontWeight: 700, marginRight: 4 }}>{selectedIds.size} selected:</span>

            {/* Bulk status change — quick chips for the 3 statuses */}
            {(['unread', 'reading', 'done'] as BMStatus[]).map(s => {
              const M = STATUS_META[s]; const I = M.icon;
              return (
                <button key={s} onClick={() => bulkSetStatus(s)} disabled={bulkBusy} title={`Mark ${selectedIds.size} as ${M.label}`}
                  style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 10px', background: `${M.color}12`, border: `1px solid ${M.color}40`, borderRadius: 8, color: M.color, fontSize: 11, fontWeight: 700, cursor: bulkBusy ? 'wait' : 'pointer', fontFamily: 'inherit' }}>
                  <I size={11} /> {M.label}
                </button>
              );
            })}

            <button onClick={bulkDelete} disabled={bulkBusy}
              style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 10px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, color: '#ef4444', fontSize: 11, fontWeight: 700, cursor: bulkBusy ? 'wait' : 'pointer', fontFamily: 'inherit' }}>
              <Trash2 size={11} /> Trash
            </button>
            <button onClick={() => { setTagPrompt('add'); setTagPromptInput(''); }} disabled={bulkBusy}
              style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 10px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-2)', fontSize: 11, fontWeight: 700, cursor: bulkBusy ? 'wait' : 'pointer', fontFamily: 'inherit' }}>
              <TagIcon size={11} /> Add tags
            </button>
            <button onClick={() => { setTagPrompt('remove'); setTagPromptInput(''); }} disabled={bulkBusy}
              style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 10px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-2)', fontSize: 11, fontWeight: 700, cursor: bulkBusy ? 'wait' : 'pointer', fontFamily: 'inherit' }}>
              <X size={11} /> Remove tags
            </button>
            <button onClick={() => { setMoveProjectPrompt(true); setMoveProjectInput(''); }} disabled={bulkBusy} title="Move to project"
              style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 10px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-2)', fontSize: 11, fontWeight: 700, cursor: bulkBusy ? 'wait' : 'pointer', fontFamily: 'inherit' }}>
              <FolderInput size={11} /> Move
            </button>
            {showArchived ? (
              <button onClick={bulkUnarchive} disabled={bulkBusy} title="Bring back to main list"
                style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 10px', background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: 8, color: '#22c55e', fontSize: 11, fontWeight: 700, cursor: bulkBusy ? 'wait' : 'pointer', fontFamily: 'inherit' }}>
                <ArchiveRestore size={11} /> Unarchive
              </button>
            ) : (
              <button onClick={bulkArchive} disabled={bulkBusy} title="Archive — hidden from main list, still searchable"
                style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 10px', background: 'rgba(168,85,247,0.1)', border: '1px solid rgba(168,85,247,0.3)', borderRadius: 8, color: '#a855f7', fontSize: 11, fontWeight: 700, cursor: bulkBusy ? 'wait' : 'pointer', fontFamily: 'inherit' }}>
                <Archive size={11} /> Archive
              </button>
            )}
            <button onClick={bulkExport} disabled={bulkBusy}
              style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 10px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-2)', fontSize: 11, fontWeight: 700, cursor: bulkBusy ? 'wait' : 'pointer', fontFamily: 'inherit' }}>
              <Download size={11} /> Export
            </button>
            {tagPrompt && (
              <div style={{ display: 'flex', gap: 4, marginLeft: 6 }}>
                <input autoFocus value={tagPromptInput} onChange={e => setTagPromptInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { tagPrompt === 'add' ? bulkTagAdd() : bulkTagRemove(); } }}
                  placeholder="tag1, tag2"
                  style={{ width: 140, padding: '5px 8px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 7, color: 'var(--text-1)', fontSize: 11, outline: 'none', fontFamily: 'inherit' }} />
                <button onClick={tagPrompt === 'add' ? bulkTagAdd : bulkTagRemove} disabled={!tagPromptInput.trim()}
                  style={{ padding: '5px 12px', background: 'var(--primary-bg)', border: '1px solid var(--primary-border)', borderRadius: 7, color: 'var(--primary)', fontSize: 11, fontWeight: 700, cursor: tagPromptInput.trim() ? 'pointer' : 'default', fontFamily: 'inherit', opacity: tagPromptInput.trim() ? 1 : 0.5 }}>OK</button>
              </div>
            )}
            {moveProjectPrompt && (
              <div style={{ display: 'flex', gap: 4, marginLeft: 6, flexWrap: 'wrap' }}>
                <input autoFocus value={moveProjectInput} onChange={e => setMoveProjectInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') submitMoveProject(); if (e.key === 'Escape') { setMoveProjectPrompt(false); setMoveProjectInput(''); } }}
                  placeholder="project id"
                  style={{ width: 140, padding: '5px 8px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 7, color: 'var(--text-1)', fontSize: 11, outline: 'none', fontFamily: 'inherit' }} />
                <button onClick={submitMoveProject} disabled={!moveProjectInput.trim() || bulkBusy}
                  style={{ padding: '5px 12px', background: 'var(--primary-bg)', border: '1px solid var(--primary-border)', borderRadius: 7, color: 'var(--primary)', fontSize: 11, fontWeight: 700, cursor: moveProjectInput.trim() ? 'pointer' : 'default', fontFamily: 'inherit', opacity: moveProjectInput.trim() ? 1 : 0.5 }}>Move</button>
                <button onClick={submitClearProject} disabled={bulkBusy}
                  style={{ padding: '5px 12px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 7, color: 'var(--text-3)', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Clear</button>
              </div>
            )}
          </div>
        )}

        {/* Domain chips */}
        {domains.length > 1 && (
          <div className="bm-domain-row" style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ color: 'var(--text-3)', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase' }}>Domain:</span>
            <button onClick={() => setDomainFilter(null)} style={{ padding: '3px 9px', background: !domainFilter ? 'var(--primary-bg)' : 'transparent', border: `1px solid ${!domainFilter ? 'var(--primary-border)' : 'var(--border)'}`, borderRadius: 11, color: !domainFilter ? 'var(--primary)' : 'var(--text-3)', fontSize: 10.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>All ({items.length})</button>
            {domains.slice(0, 8).map(([d, c]) => (
              <button key={d} onClick={() => setDomainFilter(domainFilter === d ? null : d)} style={{ padding: '3px 9px', background: domainFilter === d ? 'var(--primary-bg)' : 'transparent', border: `1px solid ${domainFilter === d ? 'var(--primary-border)' : 'var(--border)'}`, borderRadius: 11, color: domainFilter === d ? 'var(--primary)' : 'var(--text-3)', fontSize: 10.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>{d} ({c})</button>
            ))}
          </div>
        )}
      </div>

      {/* LIST or GRID — outer wrapper stays a column flex so the optional
          "Pinned" / "All bookmarks" section headers can sit between two
          inner containers (each carrying the shared lib-list / lib-grid
          classes used by Vault + Notes). */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-3)' }}>Loading bookmarks...</div>
        ) : sorted.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-3)', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14 }}>
            <Bookmark size={36} style={{ margin: '0 auto 10px', opacity: 0.4 }} />
            <p style={{ margin: 0, fontWeight: 600, fontSize: 13 }}>{activeFilterCount > 0 ? 'No bookmarks match your filters' : 'No bookmarks yet'}</p>
            <p style={{ margin: '4px 0 12px', fontSize: 11.5 }}>{activeFilterCount > 0 ? 'Try clearing some filters' : 'Save your first link to get started'}</p>
            <div style={{ display: 'flex', justifyContent: 'center', gap: 8, flexWrap: 'wrap' }}>
              {activeFilterCount > 0 && (
                <button onClick={clearAllFilters} style={{ padding: '7px 14px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 9, color: 'var(--text-2)', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Clear filters</button>
              )}
              <button onClick={() => setShowAdd(true)} style={{ padding: '7px 14px', background: 'var(--primary-bg)', border: '1px solid var(--primary-border)', borderRadius: 9, color: 'var(--primary)', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Add bookmark</button>
            </div>
          </div>
        ) : (
          <>
            {pinnedItems.length > 0 && (
              <>
                <div className="bm-section-header" style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-3)', fontSize: 10.5, fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', padding: '4px 2px' }}>
                  <Pin size={11} color="#ec4899" /> Pinned <span style={{ opacity: 0.6 }}>({pinnedItems.length})</span>
                </div>
                <div className={
                  viewMode === 'list'
                    ? 'lib-list'
                    : density === 'compact' ? 'lib-grid lib-compact' : 'lib-grid'
                }>
                  {pinnedItems.map(bm => renderBookmark(bm, viewMode))}
                </div>
              </>
            )}

            {pinnedItems.length > 0 && otherItems.length > 0 && (
              <div className="bm-section-header" style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-3)', fontSize: 10.5, fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', padding: '8px 2px 4px' }}>
                <Bookmark size={11} /> All bookmarks <span style={{ opacity: 0.6 }}>({otherItems.length})</span>
              </div>
            )}
            <div className={
              viewMode === 'list'
                ? 'lib-list'
                : density === 'compact' ? 'lib-grid lib-compact' : 'lib-grid'
            }>
              {otherItems.map(bm => renderBookmark(bm, viewMode))}
            </div>
          </>
        )}
      </div>

      {/* ADD MODAL */}
      <AnimatePresence>
        {showAdd && (
          <div onClick={() => setShowAdd(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9000, padding: 20 }}>
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} onClick={e => e.stopPropagation()}
              style={{ background: 'var(--surface)', border: '1px solid rgba(236,72,153,0.4)', borderRadius: 16, padding: '22px 24px', maxWidth: 460, width: '100%' }}>
              <h3 style={{ margin: '0 0 14px', color: 'var(--text-1)', fontSize: 16, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 8 }}>
                <Plus size={16} color="#ec4899" /> Add bookmark
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {[
                  { label: 'URL *', value: newUrl, set: setNewUrl, ph: 'https://example.com/article' },
                  { label: 'Title (optional)', value: newTitle, set: setNewTitle, ph: 'Auto-detected from URL' },
                  { label: 'Tags (comma-separated)', value: newTags, set: setNewTags, ph: 'ai, research, important' },
                ].map(f => (
                  <div key={f.label}>
                    <label style={{ color: 'var(--text-3)', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase', marginBottom: 5, display: 'block' }}>{f.label}</label>
                    <input value={f.value} onChange={e => f.set(e.target.value)} placeholder={f.ph}
                      style={{ width: '100%', padding: '9px 12px', borderRadius: 9, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text-1)', fontSize: 13, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }} />
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                <button onClick={() => setShowAdd(false)} style={{ flex: 1, padding: '10px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 9, color: 'var(--text-2)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
                <button onClick={addBookmark} disabled={!newUrl.trim()} style={{ flex: 2, padding: '10px', background: newUrl.trim() ? 'linear-gradient(135deg,#ec4899,#db2777)' : 'var(--surface-3)', border: 'none', borderRadius: 9, color: '#fff', fontSize: 12.5, fontWeight: 700, cursor: newUrl.trim() ? 'pointer' : 'default', fontFamily: 'inherit', opacity: newUrl.trim() ? 1 : 0.5 }}>Save bookmark</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default BookmarksPage;
