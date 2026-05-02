import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import {
  Loader2, Inbox, Plus, CheckCircle2, Tag as TagIcon, Archive,
  Youtube, Globe, FileText, StickyNote, ExternalLink, X, Clock,
  Search, Filter,
} from 'lucide-react';
import { showToast } from '../App';
import type { Memory } from '../lib/types';
import CapturePage from '../pages/CapturePage';

const SOURCE_META: Record<string, { icon: React.ComponentType<{ size?: number; color?: string }>; color: string; label: string }> = {
  youtube: { icon: Youtube,    color: '#ef4444', label: 'YouTube' },
  web:     { icon: Globe,      color: '#3b82f6', label: 'Web'     },
  pdf:     { icon: FileText,   color: '#f59e0b', label: 'PDF'     },
  note:    { icon: StickyNote, color: '#22d3ee', label: 'Note'    },
};

// Page size for the Inbox list. Matches the legacy hard-coded 50 so the
// "first 50" wording in the design intent still holds — switching to
// pagination here just means we ASK for one page at a time and let the
// user pull more with "Load more".
const PAGE_SIZE = 50;

// Source filter chips. `id` is the value we send to the backend
// (`source_type=...`); `''` is the "All" sentinel that simply omits the
// filter from the request.
const SOURCE_FILTERS: Array<{ id: '' | 'web' | 'youtube' | 'pdf' | 'note'; label: string; color: string; icon?: React.ComponentType<{ size?: number; color?: string }> }> = [
  { id: '',        label: 'All',     color: '#06b6d4' },
  { id: 'web',     label: 'Web',     color: '#3b82f6', icon: Globe      },
  { id: 'youtube', label: 'YouTube', color: '#ef4444', icon: Youtube    },
  { id: 'pdf',     label: 'PDF',     color: '#f59e0b', icon: FileText   },
  { id: 'note',    label: 'Note',    color: '#22d3ee', icon: StickyNote },
];

// Date filter chips (client-side — applied to whatever rows are loaded).
const DATE_FILTERS: Array<{ id: '' | 'today' | 'week'; label: string }> = [
  { id: '',      label: 'Any time'   },
  { id: 'today', label: 'Today'      },
  { id: 'week',  label: 'This week'  },
];

// Domain options come from the same canonical list the backend uses to
// validate the `domain=` query param (kept in sync manually — it changes
// rarely). Falling back to "any domain" is the empty string.
const DOMAIN_OPTIONS = [
  '', 'AI', 'Technology', 'Science', 'Business', 'Health',
  'History', 'Philosophy', 'Engineering', 'Productivity', 'Other',
];

const timeAgo = (iso?: string): string => {
  if (!iso) return 'just now';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return 'just now';
  const diff = Math.max(0, Date.now() - t);
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  const w = Math.floor(d / 7);
  if (w < 5) return `${w}w ago`;
  return new Date(iso).toLocaleDateString();
};

const safeHostname = (raw: string): string | null => {
  try { return new URL(raw).hostname.replace(/^www\./, ''); } catch { return null; }
};

interface CaptureModalProps { onClose: () => void; onCaptured: () => void; }
const CaptureModal: React.FC<CaptureModalProps> = ({ onClose, onCaptured }) => {
  useEffect(() => {
    // Escape key dismisses the modal AND triggers a re-fetch (same path as
    // overlay click / X) so any newly captured items show up in the inbox.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); onCaptured(); }
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose, onCaptured]);

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '24px 16px', overflowY: 'auto' }}>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={() => { onClose(); onCaptured(); }}
        style={{ position: 'absolute', inset: 0, background: 'rgba(5,5,15,0.88)', backdropFilter: 'blur(10px)' }}
        data-testid="overlay-capture-modal"
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97, y: 20 }}
        style={{
          position: 'relative', width: '100%', maxWidth: 1080, background: 'var(--surface)',
          border: '1px solid var(--border)', borderRadius: 18, overflow: 'hidden',
          boxShadow: '0 28px 80px rgba(0,0,0,0.55)', marginTop: 20, marginBottom: 40,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', borderBottom: '1px solid var(--border)', background: 'var(--surface-2)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Plus size={16} color="#06b6d4" />
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-1)' }}>New capture</span>
          </div>
          <button
            onClick={() => { onClose(); onCaptured(); }}
            data-testid="button-close-capture-modal"
            style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--surface)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--text-2)' }}
          >
            <X size={14} />
          </button>
        </div>
        <div style={{ maxHeight: 'calc(100vh - 140px)', overflowY: 'auto' }}>
          <CapturePage embedded />
        </div>
      </motion.div>
    </div>
  );
};

interface InlineTagEditorProps {
  initialTags: string[];
  onSave: (tags: string[]) => Promise<void> | void;
  onCancel: () => void;
}
const InlineTagEditor: React.FC<InlineTagEditorProps> = ({ initialTags, onSave, onCancel }) => {
  const [tags, setTags] = useState<string[]>(initialTags);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  const addTag = () => {
    const v = draft.trim();
    if (!v) return;
    if (tags.some(t => t.toLowerCase() === v.toLowerCase())) { setDraft(''); return; }
    setTags(prev => [...prev, v]);
    setDraft('');
  };
  const removeTag = (i: number) => setTags(prev => prev.filter((_, idx) => idx !== i));

  const handleSave = async () => {
    setSaving(true);
    try { await onSave(tags); }
    finally { setSaving(false); }
  };

  return (
    <div
      style={{ marginTop: 10, padding: 12, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 10 }}
      data-testid="editor-inline-tags"
    >
      <div style={{ fontSize: 10, color: 'var(--text-3)', fontWeight: 700, letterSpacing: '0.8px', textTransform: 'uppercase', marginBottom: 8 }}>Edit tags</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
        {tags.map((t, i) => (
          <span key={`${t}-${i}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 8px', background: 'rgba(244,114,182,0.12)', border: '1px solid rgba(244,114,182,0.25)', borderRadius: 999, fontSize: 11, color: '#f472b6', fontWeight: 600 }}>
            {t}
            <button onClick={() => removeTag(i)} aria-label={`Remove tag ${t}`} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#f472b6', display: 'flex', padding: 0 }}>
              <X size={11} />
            </button>
          </span>
        ))}
        {tags.length === 0 && (
          <span style={{ fontSize: 11, color: 'var(--text-3)' }}>No tags yet</span>
        )}
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input
          autoFocus
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); addTag(); }
            else if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
          }}
          placeholder="Type a tag and press Enter"
          data-testid="input-new-tag"
          style={{ flex: 1, padding: '7px 10px', fontSize: 12, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-1)', outline: 'none', fontFamily: 'inherit' }}
        />
        <button
          onClick={addTag}
          data-testid="button-add-tag"
          style={{ padding: '7px 12px', fontSize: 11, fontWeight: 700, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-2)', cursor: 'pointer', fontFamily: 'inherit' }}
        >
          Add
        </button>
        <button
          onClick={onCancel}
          data-testid="button-cancel-tags"
          style={{ padding: '7px 12px', fontSize: 11, fontWeight: 700, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-2)', cursor: 'pointer', fontFamily: 'inherit' }}
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          data-testid="button-save-tags"
          style={{ padding: '7px 14px', fontSize: 11, fontWeight: 700, background: 'linear-gradient(135deg,#6366f1,#4f46e5)', border: 'none', borderRadius: 8, color: '#fff', cursor: saving ? 'wait' : 'pointer', fontFamily: 'inherit', opacity: saving ? 0.7 : 1 }}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
};

// --- URL-param helpers ---
//
// We persist filter state in the page's query string so it survives both
// tab switches inside the Library hub and full-page refreshes. We use
// short keys (`src`, `dom`, `when`, `q`) so the URL stays human-readable.
// Empty / "all" values are stripped from the URL entirely so the default
// state has a clean URL.
type SourceFilter = '' | 'web' | 'youtube' | 'pdf' | 'note';
type DateFilter = '' | 'today' | 'week';
const isSourceFilter = (v: string | null): v is SourceFilter =>
  v === '' || v === 'web' || v === 'youtube' || v === 'pdf' || v === 'note';
const isDateFilter = (v: string | null): v is DateFilter =>
  v === '' || v === 'today' || v === 'week';

// Window for "this week" — last 7 days from now (rolling, not calendar).
const isWithinDateFilter = (iso: string | undefined, when: DateFilter): boolean => {
  if (!when) return true;
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return false;
  const now = Date.now();
  if (when === 'today') {
    // Same calendar day in the user's local timezone.
    const a = new Date(t);
    const b = new Date(now);
    return a.getFullYear() === b.getFullYear()
      && a.getMonth() === b.getMonth()
      && a.getDate() === b.getDate();
  }
  if (when === 'week') {
    return now - t <= 7 * 24 * 60 * 60 * 1000;
  }
  return true;
};

const LibraryInboxTab: React.FC = () => {
  const [params, setParams] = useSearchParams();

  // Read filter state from the URL. Unknown / malformed values fall back
  // to the "all" sentinel so a hand-typed bad URL can't break the inbox.
  const rawSrc = params.get('src');
  const rawDom = params.get('dom');
  const rawWhen = params.get('when');
  const src: SourceFilter = isSourceFilter(rawSrc) ? rawSrc : '';
  const dom: string = rawDom && DOMAIN_OPTIONS.includes(rawDom) ? rawDom : '';
  const when: DateFilter = isDateFilter(rawWhen) ? rawWhen : '';
  const q: string = params.get('q') || '';

  const updateParam = useCallback((key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  }, [params, setParams]);

  const [items, setItems] = useState<Memory[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editingTagsId, setEditingTagsId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showCapture, setShowCapture] = useState(false);
  // Server-side search fallback: when the loaded page is full (50 rows)
  // AND the user types a query that matches none of those rows, we
  // automatically run a server-side substring search across the full
  // candidate window. Results are stored separately so toggling the
  // query off restores the original loaded set without a re-fetch.
  const [serverMatches, setServerMatches] = useState<Memory[] | null>(null);
  const [serverSearching, setServerSearching] = useState(false);

  // Each load() call gets a sequence number so a stale response from a
  // previous filter combination can't overwrite a newer page.
  const loadSeqRef = useRef(0);
  const serverSearchSeqRef = useRef(0);

  const buildQs = useCallback((offset: number) => {
    const qs = new URLSearchParams();
    qs.set('unreviewed', 'true');
    qs.set('limit', String(PAGE_SIZE));
    if (offset > 0) qs.set('offset', String(offset));
    if (src) qs.set('source_type', src);
    if (dom) qs.set('domain', dom);
    return qs.toString();
  }, [src, dom]);

  const load = useCallback(async () => {
    const seq = ++loadSeqRef.current;
    setLoading(true);
    setError(null);
    // Any in-flight server search becomes irrelevant once the base list
    // reloads — invalidate it so a stale match set can't show up.
    serverSearchSeqRef.current++;
    setServerMatches(null);
    setServerSearching(false);
    try {
      const res = await fetch(`/memories?${buildQs(0)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (loadSeqRef.current !== seq) return; // a newer load() superseded us
      const arr = Array.isArray(data) ? data : [];
      setItems(arr);
      setHasMore(arr.length >= PAGE_SIZE);
      // Keep the sidebar Inbox badge in sync with what we just rendered.
      window.dispatchEvent(new CustomEvent('inbox-count-refresh'));
    } catch (e) {
      if (loadSeqRef.current !== seq) return;
      const msg = e instanceof Error ? e.message : 'Failed to load inbox';
      setError(msg);
    } finally {
      if (loadSeqRef.current === seq) setLoading(false);
    }
  }, [buildQs]);

  const loadMore = useCallback(async () => {
    if (loadingMore || loading || !hasMore) return;
    const seq = loadSeqRef.current; // anchor to current filter snapshot
    setLoadingMore(true);
    try {
      const res = await fetch(`/memories?${buildQs(items.length)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (loadSeqRef.current !== seq) return; // filters changed mid-flight
      const arr = Array.isArray(data) ? data : [];
      // Dedupe defensively — pinned items can repeat across pages because
      // the server pre-sorts pinned-first within each candidate window.
      setItems(prev => {
        const seen = new Set(prev.map(p => p.id));
        return [...prev, ...arr.filter(m => !seen.has(m.id))];
      });
      setHasMore(arr.length >= PAGE_SIZE);
    } catch (e) {
      const msg = e instanceof Error ? `Couldn't load more: ${e.message}` : 'Couldn\u2019t load more';
      showToast(msg);
    } finally {
      if (loadSeqRef.current === seq) setLoadingMore(false);
    }
  }, [buildQs, items.length, loadingMore, loading, hasMore]);

  // Re-fetch whenever a server-side filter (source / domain) changes. Date
  // and search are client-side over the loaded page set, so they don't
  // trigger a re-fetch on their own.
  useEffect(() => { load(); }, [load]);

  // Client-side filtered set over what's actually loaded (the "fast path").
  const localMatches = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return items.filter(m => {
      if (!isWithinDateFilter(m.created_at, when)) return false;
      if (needle) {
        const hay = `${m.title || ''} ${m.summary || ''}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [items, q, when]);

  // Track the trigger inputs in a stable signature so the server-search
  // effect only re-fires when the user actually changes something it
  // cares about — NOT when serverMatches updates from inside the effect.
  const localMatchCount = localMatches.length;

  // Server-side search fallback. Spec: "filter by title/summary
  // client-side first, then fall back to a server query if 50+ items."
  // We trigger only when the loaded page is full (>=PAGE_SIZE — i.e. there
  // could be more matches further back on the server) AND the local
  // filter found nothing. Debounced 300ms so per-keystroke typing doesn't
  // spam the backend.
  useEffect(() => {
    const needle = q.trim();
    if (!needle || items.length < PAGE_SIZE || localMatchCount > 0) {
      // Either no query, page isn't full, or we already have matches
      // locally — no server search needed. Drop any prior server matches
      // and cancel any in-flight search.
      serverSearchSeqRef.current++;
      setServerMatches(null);
      setServerSearching(false);
      return;
    }
    const seq = ++serverSearchSeqRef.current;
    setServerSearching(true);
    const handle = window.setTimeout(async () => {
      try {
        const qs = new URLSearchParams();
        qs.set('unreviewed', 'true');
        qs.set('limit', String(PAGE_SIZE));
        if (src) qs.set('source_type', src);
        if (dom) qs.set('domain', dom);
        qs.set('q', needle);
        const res = await fetch(`/memories?${qs.toString()}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (serverSearchSeqRef.current !== seq) return; // superseded
        const arr = Array.isArray(data) ? data : [];
        setServerMatches(arr);
      } catch {
        if (serverSearchSeqRef.current !== seq) return;
        // Soft-fail: just leave the empty client result visible. Don't
        // toast on every keystroke.
        setServerMatches([]);
      } finally {
        if (serverSearchSeqRef.current === seq) setServerSearching(false);
      }
    }, 300);
    return () => window.clearTimeout(handle);
  }, [q, items.length, localMatchCount, src, dom]);

  // What we actually render: server-side fallback if it's active, else
  // the client-filtered loaded set. Date filter still applies to server
  // matches (server doesn't know about the `when` filter).
  const visibleItems = useMemo(() => {
    const base = serverMatches !== null ? serverMatches : localMatches;
    if (!when) return base;
    return base.filter(m => isWithinDateFilter(m.created_at, when));
  }, [serverMatches, localMatches, when]);

  // Triage mutations have to update BOTH data sources we render from —
  // the loaded page (`items`) AND, when active, the server-search
  // fallback set (`serverMatches`). Otherwise a Review/Archive in
  // fallback mode would leave the just-triaged row visible until the
  // next reload.
  const removeFromList = (id: string) => {
    setItems(prev => prev.filter(m => m.id !== id));
    setServerMatches(prev => (prev === null ? prev : prev.filter(m => m.id !== id)));
  };

  const patchMemory = async (id: string, body: Record<string, unknown>): Promise<boolean> => {
    try {
      const res = await fetch(`/memories/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return true;
    } catch (e) {
      showToast(e instanceof Error ? `Update failed: ${e.message}` : 'Update failed');
      return false;
    }
  };

  // Restore a row that was just reviewed or archived. Best-effort: if the
  // component has been unmounted (user navigated tabs), the local setItems is a
  // no-op but the PATCH still revives the memory on the server, so it will
  // reappear next time the inbox loads.
  //
  // When the server-search fallback is active, the row was also stripped
  // from `serverMatches` — re-insert it there too so undo restores the
  // visible row even while the user is mid-search.
  const restoreMemory = async (m: Memory, originalIndex: number, body: Record<string, unknown>) => {
    const ok = await patchMemory(m.id, body);
    if (ok) {
      setItems(prev => {
        if (prev.some(x => x.id === m.id)) return prev;
        const next = [...prev];
        const insertAt = Math.max(0, Math.min(originalIndex, next.length));
        next.splice(insertAt, 0, m);
        return next;
      });
      setServerMatches(prev => {
        if (prev === null) return prev;
        if (prev.some(x => x.id === m.id)) return prev;
        const next = [...prev];
        const insertAt = Math.max(0, Math.min(originalIndex, next.length));
        next.splice(insertAt, 0, m);
        return next;
      });
      showToast('Restored');
    }
  };

  // Note: the sidebar Inbox badge auto-refreshes after Review / Archive because
  // the global apiFetch hook broadcasts `inbox-count-refresh` on every
  // successful non-GET /memories call — no explicit dispatch needed here.
  const handleReview = async (m: Memory) => {
    const originalIndex = items.findIndex(x => x.id === m.id);
    setBusyId(m.id);
    const ok = await patchMemory(m.id, { reviewed: true });
    setBusyId(null);
    if (ok) {
      removeFromList(m.id);
      showToast('Marked as reviewed', 'success', {
        label: 'Undo',
        testId: `button-undo-review-${m.id}`,
        onClick: () => restoreMemory(m, originalIndex, { reviewed: false }),
      });
    }
  };

  const handleArchive = async (m: Memory) => {
    const originalIndex = items.findIndex(x => x.id === m.id);
    setBusyId(m.id);
    const ok = await patchMemory(m.id, { archived: true });
    setBusyId(null);
    if (ok) {
      removeFromList(m.id);
      // Archiving from the inbox implicitly leaves `reviewed` untouched, but
      // restoring should bring the row back to the inbox in its prior state, so
      // we explicitly clear both flags on undo.
      showToast('Archived', 'success', {
        label: 'Undo',
        testId: `button-undo-archive-${m.id}`,
        onClick: () => restoreMemory(m, originalIndex, { archived: false, reviewed: false }),
      });
    }
  };

  const handleSaveTags = async (m: Memory, tags: string[]) => {
    const ok = await patchMemory(m.id, { tags });
    if (ok) {
      setItems(prev => prev.map(x => x.id === m.id ? { ...x, tags } : x));
      // Mirror the tag edit into the active server-search set too so the
      // updated tags render immediately when fallback mode is on.
      setServerMatches(prev =>
        prev === null ? prev : prev.map(x => x.id === m.id ? { ...x, tags } : x)
      );
      setEditingTagsId(null);
      showToast('Tags updated');
    }
  };

  const handleCaptureClosed = () => {
    setShowCapture(false);
    load();
  };

  const clearFilters = () => {
    const next = new URLSearchParams(params);
    next.delete('src');
    next.delete('dom');
    next.delete('when');
    next.delete('q');
    setParams(next, { replace: true });
  };

  const hasActiveFilters = !!(src || dom || when || q);
  const hiddenByFilters = items.length - visibleItems.length;

  return (
    <div style={{ width: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18, gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-1)', margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Inbox size={18} color="#06b6d4" />
            Inbox
            {!loading && visibleItems.length > 0 && (
              <span data-testid="badge-inbox-count" style={{ marginLeft: 6, padding: '2px 9px', background: 'rgba(6,182,212,0.14)', border: '1px solid rgba(6,182,212,0.3)', borderRadius: 999, fontSize: 11, color: '#06b6d4', fontWeight: 700 }}>
                {visibleItems.length}{hasMore ? '+' : ''}
              </span>
            )}
          </h2>
          <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-3)' }}>Triage recent captures — review, tag, or archive them.</p>
        </div>
        <button
          onClick={() => setShowCapture(true)}
          data-testid="button-open-capture"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 16px', background: 'linear-gradient(135deg,#06b6d4,#0891b2)', border: 'none', borderRadius: 10, color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', boxShadow: '0 6px 18px rgba(6,182,212,0.28)' }}
        >
          <Plus size={14} />
          Capture
        </button>
      </div>

      {/* Filter & search toolbar — survives tab switches via the URL query
          string (?tab=inbox&src=youtube&dom=AI&when=today&q=...). */}
      <div
        data-testid="toolbar-inbox-filters"
        style={{
          display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8,
          padding: 10, marginBottom: 12,
          background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12,
        }}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {SOURCE_FILTERS.map(f => {
            const isActive = src === f.id;
            const ChipIcon = f.icon;
            return (
              <button
                key={f.id || 'all'}
                onClick={() => updateParam('src', f.id)}
                data-testid={`chip-src-${f.id || 'all'}`}
                aria-pressed={isActive}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  padding: '5px 10px', borderRadius: 999, fontSize: 11.5, fontWeight: 700,
                  cursor: 'pointer', fontFamily: 'inherit',
                  background: isActive ? `${f.color}1f` : 'var(--surface-2)',
                  border: `1px solid ${isActive ? `${f.color}55` : 'var(--border)'}`,
                  color: isActive ? f.color : 'var(--text-2)',
                  transition: 'all 0.15s',
                }}
              >
                {ChipIcon && <ChipIcon size={11} color={isActive ? f.color : undefined} />}
                {f.label}
              </button>
            );
          })}
        </div>

        <div style={{ width: 1, height: 22, background: 'var(--border)', margin: '0 2px' }} />

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {DATE_FILTERS.map(f => {
            const isActive = when === f.id;
            return (
              <button
                key={f.id || 'any'}
                onClick={() => updateParam('when', f.id)}
                data-testid={`chip-when-${f.id || 'any'}`}
                aria-pressed={isActive}
                style={{
                  padding: '5px 10px', borderRadius: 999, fontSize: 11.5, fontWeight: 700,
                  cursor: 'pointer', fontFamily: 'inherit',
                  background: isActive ? 'rgba(168,85,247,0.16)' : 'var(--surface-2)',
                  border: `1px solid ${isActive ? 'rgba(168,85,247,0.4)' : 'var(--border)'}`,
                  color: isActive ? '#a855f7' : 'var(--text-2)',
                  transition: 'all 0.15s',
                }}
              >
                {f.label}
              </button>
            );
          })}
        </div>

        <div style={{ width: 1, height: 22, background: 'var(--border)', margin: '0 2px' }} />

        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--text-3)' }}>
          <Filter size={11} />
          <select
            value={dom}
            onChange={e => updateParam('dom', e.target.value)}
            data-testid="select-inbox-domain"
            aria-label="Filter by domain"
            style={{
              padding: '5px 8px', fontSize: 11.5, fontWeight: 600,
              background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8,
              color: 'var(--text-2)', cursor: 'pointer', fontFamily: 'inherit', outline: 'none',
            }}
          >
            {DOMAIN_OPTIONS.map(d => (
              <option key={d || 'all'} value={d}>{d || 'Any domain'}</option>
            ))}
          </select>
        </label>

        <div style={{ flex: 1, minWidth: 160, position: 'relative' }}>
          <Search size={12} color="var(--text-3)" style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
          <input
            type="search"
            value={q}
            onChange={e => updateParam('q', e.target.value)}
            placeholder="Search loaded inbox…"
            data-testid="input-inbox-search"
            aria-label="Search inbox"
            style={{
              width: '100%', padding: '6px 10px 6px 26px', fontSize: 12,
              background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8,
              color: 'var(--text-1)', outline: 'none', fontFamily: 'inherit',
            }}
          />
        </div>

        {hasActiveFilters && (
          <button
            onClick={clearFilters}
            data-testid="button-clear-filters"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              padding: '5px 10px', borderRadius: 8, fontSize: 11, fontWeight: 700,
              background: 'transparent', border: '1px solid var(--border)',
              color: 'var(--text-3)', cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            <X size={11} /> Clear
          </button>
        )}
      </div>

      {loading && (
        <div data-testid="state-inbox-loading" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '60px 0', color: 'var(--text-3)' }}>
          <Loader2 size={26} color="#06b6d4" style={{ animation: 'spin 1s linear infinite', marginBottom: 10 }} />
          <span style={{ fontSize: 12 }}>Loading inbox…</span>
        </div>
      )}

      {!loading && error && (
        <div data-testid="state-inbox-error" style={{ padding: '20px 22px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 12, color: '#fca5a5', fontSize: 12 }}>
          Couldn't load inbox: {error}
          <button onClick={load} style={{ marginLeft: 12, padding: '5px 11px', background: 'rgba(239,68,68,0.18)', border: '1px solid rgba(239,68,68,0.35)', borderRadius: 8, color: '#fca5a5', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
            Retry
          </button>
        </div>
      )}

      {!loading && !error && items.length === 0 && (
        <div data-testid="state-inbox-empty" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '60px 24px', textAlign: 'center', background: 'var(--surface)', border: '1px dashed var(--border)', borderRadius: 14 }}>
          <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.28)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}>
            <CheckCircle2 size={28} color="#10b981" />
          </div>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800, color: 'var(--text-1)' }}>
            {hasActiveFilters ? 'No matches for these filters' : 'All caught up — nothing to review'}
          </h3>
          <p style={{ margin: '6px 0 16px', fontSize: 12, color: 'var(--text-3)', maxWidth: 360 }}>
            {hasActiveFilters
              ? 'Try clearing a filter or expanding the date range.'
              : 'New captures land here for quick triage. Add one to get started.'}
          </p>
          {hasActiveFilters ? (
            <button
              onClick={clearFilters}
              data-testid="button-empty-clear-filters"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 16px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--text-1)', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}
            >
              <X size={14} /> Clear filters
            </button>
          ) : (
            <button
              onClick={() => setShowCapture(true)}
              data-testid="button-empty-open-capture"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 16px', background: 'linear-gradient(135deg,#06b6d4,#0891b2)', border: 'none', borderRadius: 10, color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}
            >
              <Plus size={14} />
              Capture something
            </button>
          )}
        </div>
      )}

      {/* Items exist on the server but the client-side filters (date /
          search) have hidden them all AND the server-side fallback also
          came up empty (or isn't applicable because the loaded page is
          smaller than PAGE_SIZE). */}
      {!loading && !error && items.length > 0 && visibleItems.length === 0 && !serverSearching && (
        <div
          data-testid="state-inbox-no-matches"
          style={{ padding: '36px 22px', textAlign: 'center', background: 'var(--surface)', border: '1px dashed var(--border)', borderRadius: 12, color: 'var(--text-3)', fontSize: 12 }}
        >
          <div style={{ marginBottom: 10, fontSize: 13, color: 'var(--text-2)', fontWeight: 700 }}>
            {serverMatches !== null
              ? 'No matches anywhere in your inbox.'
              : `No matches in the ${items.length} loaded item${items.length === 1 ? '' : 's'}.`}
          </div>
          {hasMore && serverMatches === null && (
            <button
              onClick={loadMore}
              disabled={loadingMore}
              data-testid="button-load-more-no-match"
              style={{ marginRight: 8, padding: '7px 14px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-1)', fontSize: 11.5, fontWeight: 700, cursor: loadingMore ? 'wait' : 'pointer', fontFamily: 'inherit' }}
            >
              {loadingMore ? 'Loading…' : 'Load more to keep searching'}
            </button>
          )}
          <button
            onClick={clearFilters}
            data-testid="button-no-matches-clear"
            style={{ padding: '7px 14px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-2)', fontSize: 11.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}
          >
            Clear filters
          </button>
        </div>
      )}

      {/* Inline "searching the rest of your inbox" status while the
          server-side fallback is in flight. */}
      {!loading && !error && serverSearching && visibleItems.length === 0 && (
        <div
          data-testid="state-inbox-server-searching"
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '24px 0', color: 'var(--text-3)', fontSize: 12 }}
        >
          <Loader2 size={14} color="#06b6d4" style={{ animation: 'spin 1s linear infinite' }} />
          Searching the rest of your inbox…
        </div>
      )}

      {!loading && !error && visibleItems.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <AnimatePresence initial={false}>
            {visibleItems.map(m => {
              const meta = SOURCE_META[m.source_type] || SOURCE_META.note;
              const Icon = meta.icon;
              const host = m.source_url ? safeHostname(m.source_url) : null;
              const isBusy = busyId === m.id;
              const isEditingTags = editingTagsId === m.id;
              const isExpanded = expandedId === m.id;
              return (
                <motion.div
                  key={m.id}
                  layout
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: -20, height: 0, marginTop: 0, marginBottom: 0, paddingTop: 0, paddingBottom: 0 }}
                  transition={{ duration: 0.18 }}
                  data-testid={`row-inbox-${m.id}`}
                  style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 14, opacity: isBusy ? 0.55 : 1, transition: 'opacity 0.15s' }}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                    <div style={{ width: 36, height: 36, flexShrink: 0, borderRadius: 9, background: `${meta.color}1f`, border: `1px solid ${meta.color}40`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Icon size={16} color={meta.color} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <button
                          onClick={() => setExpandedId(isExpanded ? null : m.id)}
                          data-testid={`button-toggle-${m.id}`}
                          style={{ background: 'transparent', border: 'none', padding: 0, fontSize: 14, fontWeight: 700, color: 'var(--text-1)', textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit' }}
                        >
                          {m.title || 'Untitled'}
                        </button>
                        {host && (
                          <a
                            href={m.source_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--text-3)', textDecoration: 'none' }}
                          >
                            {host} <ExternalLink size={10} />
                          </a>
                        )}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4, fontSize: 11, color: 'var(--text-3)' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <Clock size={10} /> {timeAgo(m.created_at)}
                        </span>
                        <span style={{ color: meta.color, fontWeight: 600 }}>{meta.label}</span>
                        {m.domain && m.domain !== 'Other' && (
                          <span style={{ padding: '1px 7px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 999, fontSize: 10, fontWeight: 600, color: 'var(--text-2)' }}>
                            {m.domain}
                          </span>
                        )}
                      </div>
                      {m.summary && (
                        <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--text-2)', lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: isExpanded ? 99 : 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                          {m.summary}
                        </p>
                      )}
                      {isExpanded && m.key_points && m.key_points.length > 0 && (
                        <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 12, color: 'var(--text-2)', lineHeight: 1.55 }}>
                          {m.key_points.slice(0, 5).map((kp, i) => (
                            <li key={i}>{kp}</li>
                          ))}
                        </ul>
                      )}
                      {m.tags && m.tags.length > 0 && !isEditingTags && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 8 }}>
                          {m.tags.slice(0, 8).map((t, i) => (
                            <span key={`${t}-${i}`} style={{ padding: '2px 7px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 999, fontSize: 10, color: 'var(--text-2)', fontWeight: 600 }}>
                              {t}
                            </span>
                          ))}
                        </div>
                      )}
                      {isEditingTags && (
                        <InlineTagEditor
                          initialTags={m.tags || []}
                          onSave={(tags) => handleSaveTags(m, tags)}
                          onCancel={() => setEditingTagsId(null)}
                        />
                      )}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6, marginTop: 12 }}>
                    <button
                      onClick={() => handleReview(m)}
                      disabled={isBusy}
                      data-testid={`button-review-${m.id}`}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 12px', background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: 8, color: '#10b981', fontSize: 11, fontWeight: 700, cursor: isBusy ? 'wait' : 'pointer', fontFamily: 'inherit' }}
                    >
                      <CheckCircle2 size={12} />
                      Review
                    </button>
                    <button
                      onClick={() => setEditingTagsId(isEditingTags ? null : m.id)}
                      disabled={isBusy}
                      data-testid={`button-tag-${m.id}`}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 12px', background: isEditingTags ? 'rgba(244,114,182,0.18)' : 'var(--surface-2)', border: `1px solid ${isEditingTags ? 'rgba(244,114,182,0.4)' : 'var(--border)'}`, borderRadius: 8, color: isEditingTags ? '#f472b6' : 'var(--text-2)', fontSize: 11, fontWeight: 700, cursor: isBusy ? 'wait' : 'pointer', fontFamily: 'inherit' }}
                    >
                      <TagIcon size={12} />
                      Tag
                    </button>
                    <button
                      onClick={() => handleArchive(m)}
                      disabled={isBusy}
                      data-testid={`button-archive-${m.id}`}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 12px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-2)', fontSize: 11, fontWeight: 700, cursor: isBusy ? 'wait' : 'pointer', fontFamily: 'inherit' }}
                    >
                      <Archive size={12} />
                      Archive
                    </button>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>

          {/* Footer: Load more + (optional) hidden-by-filter hint. */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, padding: '14px 0 4px', flexWrap: 'wrap' }}>
            {hiddenByFilters > 0 && (
              <span data-testid="text-hidden-by-filters" style={{ fontSize: 11, color: 'var(--text-3)' }}>
                {hiddenByFilters} hidden by current filters
              </span>
            )}
            {hasMore ? (
              <button
                onClick={loadMore}
                disabled={loadingMore}
                data-testid="button-load-more"
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '8px 16px', borderRadius: 10,
                  background: 'var(--surface-2)', border: '1px solid var(--border)',
                  color: 'var(--text-1)', fontSize: 12, fontWeight: 700,
                  cursor: loadingMore ? 'wait' : 'pointer', fontFamily: 'inherit',
                }}
              >
                {loadingMore ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : null}
                {loadingMore ? 'Loading…' : 'Load more'}
              </button>
            ) : (
              items.length > PAGE_SIZE && (
                <span data-testid="text-end-of-list" style={{ fontSize: 11, color: 'var(--text-3)' }}>
                  That's everything in your inbox.
                </span>
              )
            )}
          </div>
        </div>
      )}

      <AnimatePresence>
        {showCapture && (
          <CaptureModal onClose={() => setShowCapture(false)} onCaptured={handleCaptureClosed} />
        )}
      </AnimatePresence>
    </div>
  );
};

export default LibraryInboxTab;
