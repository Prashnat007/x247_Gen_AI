import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Loader2, Youtube, Globe, FileText, StickyNote, Download, Trash2, ExternalLink, FlipHorizontal, Brain, CheckCircle2, Tag, Clock, X, RotateCcw, ChevronLeft, ChevronRight, Award, Database, Filter, ArrowUpDown, XCircle, CheckCircle, ListTodo, BookOpen, MessageCircle, Pin, PinOff, CheckSquare, Square, Save, Sparkles, Archive, ArchiveRestore, Plus, Edit2, FolderInput, Circle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn, getYouTubeId, YouTubeEmbed, YouTubeThumbnail } from '../lib/utils';
import type { Memory, Flashcard, SmartCollection, BulkApiResponse, DeepSearchResponse, DeepSearchHit } from '../lib/types';
import { card } from '../lib/ui';
import ViewModeToggle, { useViewModePref } from '../components/ViewModeToggle';
import MemoryEditModal from '../components/MemoryEditModal';
import ConfirmDialog from '../components/ConfirmDialog';
import { showToast } from '../App';

interface StudyCard extends Flashcard { status: 'unseen' | 'known' | 'unknown'; }

const FlashcardModal = ({ memory, onClose }: { memory: Memory; onClose: () => void }) => {
  const [cards, setCards] = useState<StudyCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [idx, setIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [done, setDone] = useState(false);
  const [known, setKnown] = useState(0);

  useEffect(() => {
    fetch(`/memories/${memory.id}/flashcards`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.flashcards) setCards(data.flashcards.map((c: Flashcard) => ({ ...c, status: 'unseen' }))); })
      .catch(console.error).finally(() => setLoading(false));
  }, [memory.id]);

  const markCard = (status: 'known' | 'unknown') => {
    setCards(prev => prev.map((c, i) => i === idx ? { ...c, status } : c));
    if (status === 'known') setKnown(k => k + 1);
    if (idx < cards.length - 1) { setIdx(i => i + 1); setFlipped(false); }
    else setDone(true);
  };

  const score = cards.length > 0 ? Math.round((known / cards.length) * 100) : 0;

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(5,5,15,0.88)', backdropFilter: 'blur(10px)' }} />
      <motion.div initial={{ opacity: 0, scale: 0.95, y: 24 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 24 }}
        style={{ position: 'relative', width: '100%', maxWidth: 520, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 20, overflow: 'hidden', boxShadow: '0 24px 64px rgba(0,0,0,0.5)' }}>
        <div style={{ background: 'linear-gradient(135deg,rgba(245,158,11,0.15),rgba(249,115,22,0.08))', borderBottom: '1px solid rgba(245,158,11,0.2)', padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ color: '#f59e0b', fontSize: 9, fontWeight: 700, letterSpacing: '1.5px', marginBottom: 3 }}>AI FLASHCARDS</div>
            <div style={{ color: 'var(--text-1)', fontWeight: 700, fontSize: 13 }}>{memory.title.slice(0, 50)}{memory.title.length > 50 ? '…' : ''}</div>
          </div>
          <button onClick={onClose} style={{ width: 30, height: 30, borderRadius: 8, background: 'var(--surface-2)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--text-2)' }}>
            <X size={13} />
          </button>
        </div>
        <div style={{ padding: '20px 22px' }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: '36px 0' }}>
              <Loader2 size={26} color="#f59e0b" style={{ animation: 'spin 1s linear infinite', margin: '0 auto 10px' }} />
              <p style={{ color: 'var(--text-3)', fontSize: 13, margin: 0 }}>Generating flashcards…</p>
            </div>
          ) : done ? (
            <div style={{ textAlign: 'center', padding: '8px 0' }}>
              <div style={{ width: 72, height: 72, borderRadius: '50%', background: score >= 80 ? 'rgba(16,185,129,0.12)' : 'rgba(245,158,11,0.12)', border: `2px solid ${score >= 80 ? '#10b981' : '#f59e0b'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px', boxShadow: `0 0 24px ${score >= 80 ? 'rgba(16,185,129,0.2)' : 'rgba(245,158,11,0.2)'}` }}>
                <span style={{ fontSize: 22, fontWeight: 900, color: score >= 80 ? '#10b981' : '#f59e0b' }}>{score}%</span>
              </div>
              <div style={{ color: 'var(--text-1)', fontSize: 17, fontWeight: 800, marginBottom: 4 }}>{score >= 80 ? 'Great job!' : score >= 50 ? 'Good progress!' : 'Keep going!'}</div>
              <div style={{ color: 'var(--text-3)', fontSize: 12, marginBottom: 16 }}>{known}/{cards.length} correct</div>
              <button onClick={onClose} style={{ padding: '10px 24px', background: 'linear-gradient(135deg,#f59e0b,#d97706)', border: 'none', borderRadius: 10, color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>Done</button>
            </div>
          ) : cards.length > 0 ? (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                <div style={{ flex: 1, height: 3, background: 'var(--surface-3)', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ width: `${(idx / cards.length) * 100}%`, height: '100%', background: 'linear-gradient(90deg,#f59e0b,#f97316)', transition: 'width 0.3s' }} />
                </div>
                <span style={{ color: 'var(--text-3)', fontSize: 10, fontWeight: 600 }}>{idx + 1}/{cards.length}</span>
              </div>
              <motion.div key={`${idx}-${flipped}`} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }}
                onClick={() => setFlipped(!flipped)}
                style={{ minHeight: 160, borderRadius: 14, padding: '24px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', cursor: 'pointer', border: `2px solid ${flipped ? 'rgba(99,102,241,0.25)' : 'rgba(245,158,11,0.2)'}`, background: flipped ? 'rgba(99,102,241,0.05)' : 'rgba(245,158,11,0.04)', marginBottom: 12 }}>
                <span style={{ color: flipped ? '#818cf8' : '#f59e0b', fontSize: 8.5, fontWeight: 700, letterSpacing: '1.5px', marginBottom: 10, display: 'block' }}>{flipped ? 'ANSWER' : 'QUESTION'}</span>
                <p style={{ color: 'var(--text-1)', fontSize: 14, fontWeight: 600, lineHeight: 1.55, margin: 0 }}>{flipped ? cards[idx].answer : cards[idx].question}</p>
                <span style={{ color: 'var(--text-3)', fontSize: 10, marginTop: 10 }}>Click to {flipped ? 'see question' : 'reveal answer'}</span>
              </motion.div>
              {flipped ? (
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => markCard('unknown')} style={{ flex: 1, padding: '10px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 10, color: '#ef4444', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                    <XCircle size={13} /> Don't know
                  </button>
                  <button onClick={() => markCard('known')} style={{ flex: 1, padding: '10px', background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.25)', borderRadius: 10, color: '#10b981', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                    <CheckCircle size={13} /> Know it!
                  </button>
                </div>
              ) : (
                <button onClick={() => setFlipped(true)} style={{ width: '100%', padding: '11px', background: 'linear-gradient(135deg,#f59e0b,#d97706)', border: 'none', borderRadius: 10, color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                  Reveal Answer →
                </button>
              )}
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '28px 0', color: 'var(--text-3)', fontSize: 13 }}>
              Failed to generate flashcards.
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
};

const SRC_ICON: Record<string, { icon: React.ElementType; color: string }> = {
  youtube: { icon: Youtube, color: '#ef4444' },
  web:     { icon: Globe,   color: '#00d4ff' },
  pdf:     { icon: FileText,color: '#f59e0b' },
};

const DOMAINS = ['', 'AI', 'Technology', 'Science', 'Business', 'Health', 'History', 'Philosophy', 'Engineering', 'Productivity', 'Other'];
const SORT_OPTS = [{ value: 'newest', label: 'Newest' }, { value: 'oldest', label: 'Oldest' }, { value: 'title', label: 'A–Z' }];

interface VaultViewProps {
  embedded?: boolean;
  initialSourceFilter?: string;
  /**
   * Base localStorage key for persisting view mode + density. The component
   * stores `${storageKey}:viewMode` and `${storageKey}:density`, so each
   * surface (standalone Vault, Library Vault tab, Library Files tab) can
   * remember its own choice independently. Defaults to the legacy global key.
   */
  storageKey?: string;
}
const VaultView: React.FC<VaultViewProps> = ({ embedded = false, initialSourceFilter = '', storageKey = 'recall:vault' }) => {
  const navigate = useNavigate();
  const [memories, setMemories] = useState<Memory[]>([]);
  const [filter, setFilter] = useState('');
  const [domainFilter, setDomainFilter] = useState('');
  const [sourceTypeFilter, setSourceTypeFilter] = useState(initialSourceFilter);
  const [sort, setSort] = useState('newest');
  const [isLoading, setIsLoading] = useState(true);
  const [selectedMemory, setSelectedMemory] = useState<Memory | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [flashcardsMemory, setFlashcardsMemory] = useState<Memory | null>(null);
  const [editingMemory, setEditingMemory] = useState<Memory | null>(null);
  // Tracks which memory the user just clicked Trash on, so we can show a
  // proper ConfirmDialog instead of the browser-native confirm() prompt.
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const { viewMode, setViewMode, density, setDensity } = useViewModePref(storageKey);

  // Library power-ups
  const [showArchived, setShowArchived] = useState(false);
  const [pinnedOnly, setPinnedOnly] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [collections, setCollections] = useState<SmartCollection[]>([]);
  const [activeCollectionId, setActiveCollectionId] = useState<string | null>(null);
  const [deepMode, setDeepMode] = useState(false);
  const [deepResults, setDeepResults] = useState<Record<string, string>>({});
  const [bulkBusy, setBulkBusy] = useState(false);
  const [tagPromptOpen, setTagPromptOpen] = useState<null | 'add' | 'remove'>(null);
  const [tagInput, setTagInput] = useState('');
  const [movePromptOpen, setMovePromptOpen] = useState(false);
  const [projectInput, setProjectInput] = useState('');
  const [renamingCollId, setRenamingCollId] = useState<string | null>(null);
  const [renameCollName, setRenameCollName] = useState('');
  const [saveCollOpen, setSaveCollOpen] = useState(false);
  const [collName, setCollName] = useState('');

  // View mode + density persistence is handled by `useViewModePref` —
  // each surface (standalone /vault, Library Vault tab, Library Files tab)
  // passes a distinct `storageKey` so its choice doesn't bleed into the
  // others. The component is remounted (via TabbedPage's `key={active}`)
  // when the user switches tabs, which re-runs the initialiser.

  const fetchMemories = useCallback(() => {
    setIsLoading(true);
    const params = new URLSearchParams();
    params.set('limit', '100');
    if (domainFilter) params.set('domain', domainFilter);
    if (showArchived) params.set('include_archived', '1');
    fetch(`/memories?${params.toString()}`).then(r => r.ok ? r.json() : []).then(data => { setMemories(data); setIsLoading(false); }).catch(() => setIsLoading(false));
  }, [domainFilter, showArchived]);

  useEffect(() => { fetchMemories(); }, [fetchMemories]);

  // Load smart collections
  const loadCollections = useCallback(() => {
    fetch('/smart-collections').then(r => r.ok ? r.json() : []).then((data: SmartCollection[]) => {
      setCollections(Array.isArray(data) ? data : []);
    }).catch(() => {});
  }, []);
  useEffect(() => { loadCollections(); }, [loadCollections]);

  // Deep search — debounced
  useEffect(() => {
    if (!deepMode || !filter.trim()) { setDeepResults({}); return; }
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/search/deep?q=${encodeURIComponent(filter)}&entities=memory&limit=50`);
        if (!r.ok) { setDeepResults({}); return; }
        const j = await r.json() as DeepSearchResponse | DeepSearchHit[] | { results?: DeepSearchHit[] };
        const map: Record<string, string> = {};
        const ids: string[] = [];
        // Backend returns { memories: [...], notes: [...], bookmarks: [...] } — Vault only consumes memories
        const rows: DeepSearchHit[] = Array.isArray((j as DeepSearchResponse).memories)
          ? (j as DeepSearchResponse).memories!
          : Array.isArray((j as { results?: DeepSearchHit[] }).results)
          ? (j as { results: DeepSearchHit[] }).results
          : Array.isArray(j) ? (j as DeepSearchHit[]) : [];
        rows.forEach(row => {
          map[row.id] = row.snippet || '';
          ids.push(row.id);
        });
        setDeepResults(map);
        if (ids.length) {
          // Fetch full memory docs for any IDs not already loaded
          const missing = ids.filter(id => !memories.some(m => m.id === id));
          if (missing.length) {
            const fetched = await Promise.all(missing.map(id => fetch(`/memories/${id}`).then(r => r.ok ? r.json() : null).catch(() => null)));
            // Honour the active domain + source-type constraints — otherwise
            // deep-search fans out across the user's whole library and ignores
            // the filter strip the user just set.
            const valid = (fetched.filter(Boolean) as Memory[]).filter(m => {
              if (domainFilter && m.domain !== domainFilter) return false;
              if (sourceTypeFilter && m.source_type !== sourceTypeFilter) return false;
              return true;
            });
            if (valid.length) setMemories(prev => [...valid, ...prev]);
          }
        }
      } catch { setDeepResults({}); }
    }, 350);
    return () => clearTimeout(t);
  }, [deepMode, filter, domainFilter, sourceTypeFilter, memories]);

  // Trash button now opens a proper ConfirmDialog (see <ConfirmDialog ...>
  // mounted at the bottom of the page) instead of the browser-native
  // confirm() prompt. The actual DELETE only fires on confirmation via
  // performDelete().
  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setPendingDeleteId(id);
  };

  const performDelete = async (id: string) => {
    setPendingDeleteId(null);
    setDeletingId(id);
    try {
      await fetch(`/memories/${id}`, { method: 'DELETE' });
      setMemories(prev => prev.filter(m => m.id !== id));
      if (selectedMemory?.id === id) setSelectedMemory(null);
      showToast('Moved to Trash');
    } catch (err) { console.error(err); }
    finally { setDeletingId(null); }
  };

  // Apply an updated memory after the edit modal saves. We patch the local
  // state so the card re-renders without a full refetch.
  const applyMemoryUpdate = (updated: Memory) => {
    setMemories(prev => prev.map(m => m.id === updated.id ? { ...m, ...updated } : m));
    if (selectedMemory?.id === updated.id) setSelectedMemory(updated);
  };

  const togglePin = async (m: Memory, e: React.MouseEvent) => {
    e.stopPropagation();
    const next = !m.pinned;
    setMemories(prev => prev.map(x => x.id === m.id ? { ...x, pinned: next } : x));
    try {
      await fetch(`/memories/${m.id}/pin`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pinned: next }),
      });
    } catch {
      setMemories(prev => prev.map(x => x.id === m.id ? { ...x, pinned: !next } : x));
    }
  };

  const toggleReviewed = async (m: Memory, e: React.MouseEvent) => {
    e.stopPropagation();
    const next = !m.reviewed;
    setMemories(prev => prev.map(x => x.id === m.id ? { ...x, reviewed: next } : x));
    try {
      const res = await fetch(`/memories/${m.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewed: next }),
      });
      if (!res.ok) throw new Error('patch failed');
      showToast(next ? 'Marked as done' : 'Marked as not done');
    } catch {
      setMemories(prev => prev.map(x => x.id === m.id ? { ...x, reviewed: !next } : x));
      showToast("Couldn't update. Try again.", 'error');
    }
  };

  const toggleSelect = (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const exitSelect = () => { setSelectMode(false); setSelectedIds(new Set()); };

  const runBulk = async (path: string, body: Record<string, unknown>, successLabel: string) => {
    if (!selectedIds.size) return;
    setBulkBusy(true);
    try {
      const r = await fetch(path, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entity: 'memory', ids: Array.from(selectedIds), ...body }),
      });
      if (!r.ok) {
        const txt = await r.text().catch(() => '');
        throw new Error(txt || `HTTP ${r.status}`);
      }
      const j: BulkApiResponse = await r.json().catch(() => ({}));
      const n = j.deleted ?? j.trashed ?? j.updated ?? (Array.isArray(j.ids) ? j.ids.length : undefined) ?? selectedIds.size;
      showToast(`${successLabel} ${n} memor${n === 1 ? 'y' : 'ies'}`);
      exitSelect();
      fetchMemories();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '';
      showToast(msg ? `Action failed — ${msg.slice(0, 80)}` : 'Action failed', 'error');
    } finally { setBulkBusy(false); }
  };

  const bulkDelete = () => {
    if (!confirm(`Move ${selectedIds.size} memor${selectedIds.size === 1 ? 'y' : 'ies'} to Trash?`)) return;
    runBulk('/library/bulk-delete', {}, 'Moved');
  };

  const bulkArchive = (archived: boolean) => {
    if (archived && !confirm(`Archive ${selectedIds.size} memor${selectedIds.size === 1 ? 'y' : 'ies'}? They get hidden from the main view but stay searchable.`)) return;
    runBulk('/library/bulk-archive', { archived }, archived ? 'Archived' : 'Unarchived');
  };

  const submitTagBulk = () => {
    const tags = tagInput.split(',').map(t => t.trim().replace(/^#/, '')).filter(Boolean);
    if (!tags.length || !tagPromptOpen) { setTagPromptOpen(null); setTagInput(''); return; }
    const path = tagPromptOpen === 'add' ? '/library/bulk-tag-add' : '/library/bulk-tag-remove';
    const label = tagPromptOpen === 'add' ? 'Tagged' : 'Untagged';
    runBulk(path, { tags }, label);
    setTagPromptOpen(null); setTagInput('');
  };

  const submitMoveProject = () => {
    const pid = projectInput.trim();
    if (!pid || !selectedIds.size) { setMovePromptOpen(false); setProjectInput(''); return; }
    runBulk('/library/bulk-move-project', { project_id: pid }, 'Moved to project');
    setMovePromptOpen(false); setProjectInput('');
  };

  const submitMoveClear = () => {
    if (!confirm(`Remove ${selectedIds.size} memor${selectedIds.size === 1 ? 'y' : 'ies'} from any project?`)) return;
    runBulk('/library/bulk-move-project', { project_id: null }, 'Cleared project');
    setMovePromptOpen(false); setProjectInput('');
  };

  const exportSelection = () => {
    const rows = memories.filter(m => selectedIds.has(m.id));
    const md = rows.map(m => `# ${m.title}\n\n**Domain:** ${m.domain}  \n**Source:** ${m.source_type}  \n${m.source_url ? `**URL:** ${m.source_url}  \n` : ''}**Tags:** ${m.tags.map(t => '#' + t).join(' ')}\n\n## Summary\n${m.summary}\n\n## Key Points\n${(m.key_points || []).map(p => `- ${p}`).join('\n')}\n\n---\n`).join('\n');
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `vault-selection-${Date.now()}.md`; a.click();
    URL.revokeObjectURL(url);
    showToast(`Exported ${rows.length} memor${rows.length === 1 ? 'y' : 'ies'}`);
  };

  // Smart collections
  // Tags ride inside the search string as `#tag` tokens. Persist them as
  // `filters.tags` so collections capture the explicit tag filter dimension
  // independent of free-text search.
  const parseTagsFromSearch = (s: string): { plain: string; tags: string[] } => {
    const tokens = (s || '').split(/\s+/).filter(Boolean);
    const tags: string[] = [];
    const rest: string[] = [];
    tokens.forEach(t => { if (t.startsWith('#') && t.length > 1) tags.push(t.slice(1).toLowerCase()); else rest.push(t); });
    return { plain: rest.join(' ').trim(), tags };
  };

  const applyCollection = (c: SmartCollection) => {
    setActiveCollectionId(c.id);
    const f = c.filters || {};
    const plain = (f.search || '').trim();
    const tagPart = (f.tags || []).map(t => `#${t}`).join(' ');
    const combined = [plain, tagPart].filter(Boolean).join(' ').trim();
    setFilter(combined);
    setDomainFilter(f.domain || '');
    setSourceTypeFilter(f.source || '');
    setPinnedOnly(!!f.pinned_only);
    setShowArchived(!!f.archived);
    setDeepMode(!!f.deep);
    setSort(f.sort || 'newest');
  };

  const clearCollection = () => {
    setActiveCollectionId(null);
    setFilter(''); setDomainFilter(''); setSourceTypeFilter(initialSourceFilter);
    setPinnedOnly(false); setShowArchived(false); setDeepMode(false);
    setSort('newest');
  };

  const saveCollection = async () => {
    if (!collName.trim()) return;
    const { plain, tags } = parseTagsFromSearch(filter);
    const filters = {
      search: plain || undefined,
      tags: tags.length ? tags : undefined,
      domain: domainFilter || undefined,
      source: sourceTypeFilter || undefined,
      pinned_only: pinnedOnly || undefined,
      archived: showArchived || undefined,
      deep: deepMode || undefined,
      sort: sort && sort !== 'newest' ? sort : undefined,
    };
    try {
      const r = await fetch('/smart-collections', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: collName.trim(), filters }),
      });
      const j = await r.json();
      if (j.id) setActiveCollectionId(j.id);
      showToast(`Saved "${collName.trim()}"`);
      setSaveCollOpen(false); setCollName('');
      loadCollections();
    } catch { showToast('Could not save collection', 'error'); }
  };

  const startRenameCollection = (id: string, currentName: string) => {
    setRenamingCollId(id);
    setRenameCollName(currentName);
  };

  const submitRenameCollection = async () => {
    if (!renamingCollId || !renameCollName.trim()) { setRenamingCollId(null); return; }
    try {
      const r = await fetch(`/smart-collections/${renamingCollId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: renameCollName.trim() }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      showToast(`Renamed to "${renameCollName.trim()}"`);
      setRenamingCollId(null); setRenameCollName('');
      loadCollections();
    } catch { showToast('Could not rename collection', 'error'); }
  };

  const deleteCollection = async (id: string) => {
    if (!confirm('Delete this collection? Items inside stay safe.')) return;
    await fetch(`/smart-collections/${id}`, { method: 'DELETE' }).catch(() => {});
    if (activeCollectionId === id) setActiveCollectionId(null);
    loadCollections();
  };

  const filtered = useMemo(() => {
    // Tokenise the filter string. `#foo` tokens are matched as exact tag
    // membership (case-insensitive); plain tokens fall back to the existing
    // substring search across title / tags / summary. This keeps tag-based
    // smart collections honest when reapplied via `#tag` tokens.
    const { plain: plainFilter, tags: tagTokens } = parseTagsFromSearch(filter);
    const plainLc = plainFilter.toLowerCase();
    return memories
      .filter(m => {
        if (deepMode && filter) return deepResults[m.id] !== undefined;
        if (tagTokens.length) {
          const memTags = (m.tags || []).map(t => t.toLowerCase());
          if (!tagTokens.every(t => memTags.includes(t))) return false;
        }
        if (!plainLc) return true;
        return m.title.toLowerCase().includes(plainLc)
          || (m.tags || []).some(t => t.toLowerCase().includes(plainLc))
          || (m.summary || '').toLowerCase().includes(plainLc);
      })
      .filter(m => !sourceTypeFilter || m.source_type === sourceTypeFilter)
      .filter(m => !pinnedOnly || m.pinned)
      .sort((a, b) => {
        if (a.pinned && !b.pinned) return -1;
        if (!a.pinned && b.pinned) return 1;
        if (sort === 'newest') return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        if (sort === 'oldest') return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
        return a.title.localeCompare(b.title);
      });
  }, [memories, filter, sourceTypeFilter, sort, pinnedOnly, deepMode, deepResults]);

  const renderSnippet = (id: string) => {
    const raw = deepResults[id];
    if (!raw) return null;
    const parts: React.ReactNode[] = [];
    let i = 0; let key = 0;
    while (i < raw.length) {
      const open = raw.indexOf('<<HL>>', i);
      if (open < 0) { parts.push(raw.slice(i)); break; }
      if (open > i) parts.push(raw.slice(i, open));
      const close = raw.indexOf('<</HL>>', open + 6);
      if (close < 0) { parts.push(raw.slice(open + 6)); break; }
      parts.push(<mark key={key++} className="vault-deep-hit">{raw.slice(open + 6, close)}</mark>);
      i = close + 7;
    }
    return <div className="vault-deep-snippet">{parts}</div>;
  };

  return (
    <div style={{ color: 'var(--text-1)' }}>
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} style={{ marginBottom: 20 }}>
        {!embedded && (
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 14, marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 40, height: 40, borderRadius: 12, background: 'rgba(244,114,182,0.15)', border: '1px solid rgba(244,114,182,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 18px rgba(244,114,182,0.12)' }}>
                <Database size={18} color="#f472b6" />
              </div>
              <div>
                <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0, letterSpacing: '-0.4px' }}>Knowledge Vault</h1>
                <p style={{ color: 'var(--text-3)', fontSize: 12, margin: '2px 0 0' }}>{memories.length} memories in your Second Brain</p>
              </div>
            </div>
            <a href="/export/vault" download="recall-x247-vault.md" title="Export vault as Markdown"
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', background: 'linear-gradient(135deg,#6366f1,#4f46e5)', border: 'none', borderRadius: 10, color: '#fff', fontSize: 12, fontWeight: 700, textDecoration: 'none', cursor: 'pointer', boxShadow: '0 4px 12px rgba(99,102,241,0.35)', flexShrink: 0 }}>
              <Download size={14} /> Export Vault
            </a>
          </div>
        )}

        {/* Smart collections strip — always shown so users can save the
            current filter combo even before they have any collections. */}
        <div className="vault-coll-strip">
            <Sparkles size={12} color="#a78bfa" />
            <span className="vault-coll-label">Collections:</span>
            {collections.length === 0 && (
              <span className="vault-coll-empty">None yet — set filters and save one.</span>
            )}
            {collections.map(c => (
              renamingCollId === c.id ? (
                <span key={c.id} className="vault-coll-chip is-active" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <input autoFocus value={renameCollName} onChange={e => setRenameCollName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') submitRenameCollection(); if (e.key === 'Escape') { setRenamingCollId(null); setRenameCollName(''); } }}
                    style={{ width: 110, padding: '1px 6px', background: 'transparent', border: 'none', color: 'var(--text-1)', fontSize: 11, fontWeight: 700, fontFamily: 'inherit', outline: 'none' }} />
                  <button onClick={submitRenameCollection} title="Save name"
                    style={{ background: 'transparent', border: 'none', color: 'var(--primary)', cursor: 'pointer', display: 'flex', padding: 0 }}>
                    <CheckCircle2 size={11} />
                  </button>
                  <button onClick={() => { setRenamingCollId(null); setRenameCollName(''); }} title="Cancel"
                    style={{ background: 'transparent', border: 'none', color: 'var(--text-3)', cursor: 'pointer', display: 'flex', padding: 0 }}>
                    <X size={11} />
                  </button>
                </span>
              ) : (
                <button key={c.id}
                  onClick={() => activeCollectionId === c.id ? clearCollection() : applyCollection(c)}
                  className={cn('vault-coll-chip', activeCollectionId === c.id && 'is-active')}
                  title="Apply this collection">
                  {c.name}
                  <span onClick={e => { e.stopPropagation(); startRenameCollection(c.id, c.name); }}
                    className="vault-coll-x" title="Rename collection"><Edit2 size={10} /></span>
                  <span onClick={e => { e.stopPropagation(); deleteCollection(c.id); }}
                    className="vault-coll-x" title="Delete collection"><X size={10} /></span>
                </button>
              )
            ))}
            {(filter || domainFilter || sourceTypeFilter || pinnedOnly || showArchived || deepMode) && (
              <button onClick={() => setSaveCollOpen(true)} className="vault-coll-save" title="Save current filters as a collection">
                <Save size={11} /> Save view
              </button>
            )}
            {activeCollectionId && (
              <button onClick={clearCollection} className="vault-coll-clear">Clear</button>
            )}
        </div>

        {/* Save collection inline */}
        {saveCollOpen && (
          <div className="vault-coll-save-row">
            <Sparkles size={13} color="#a78bfa" />
            <input value={collName} onChange={e => setCollName(e.target.value)} autoFocus
              placeholder="Collection name (e.g. AI papers, Reading queue)"
              onKeyDown={e => { if (e.key === 'Enter') saveCollection(); if (e.key === 'Escape') setSaveCollOpen(false); }} />
            <button onClick={saveCollection} disabled={!collName.trim()} className="primary">Save</button>
            <button onClick={() => { setSaveCollOpen(false); setCollName(''); }}>Cancel</button>
          </div>
        )}

        {/* Filters */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ position: 'relative', flex: '1 1 200px', maxWidth: 320 }}>
            <Search size={13} color="var(--text-3)" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
            <input type="text" placeholder={deepMode ? 'Deep search across summaries, key points, notes...' : 'Search memories...'} value={filter} onChange={e => setFilter(e.target.value)}
              style={{ width: '100%', paddingLeft: 30, paddingRight: filter ? 28 : 12, paddingTop: 9, paddingBottom: 9, background: 'var(--surface)', border: `1px solid ${deepMode ? 'rgba(168,85,247,0.4)' : 'var(--border)'}`, borderRadius: 10, color: 'var(--text-1)', fontSize: 12.5, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box', transition: 'border-color 0.15s' }}
              onFocus={e => { e.target.style.borderColor = deepMode ? 'rgba(168,85,247,0.55)' : 'rgba(244,114,182,0.4)'; }}
              onBlur={e => { e.target.style.borderColor = deepMode ? 'rgba(168,85,247,0.4)' : 'var(--border)'; }}
            />
            {filter && (
              <button onClick={() => setFilter('')} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)', display: 'flex', padding: 2 }}>
                <X size={12} />
              </button>
            )}
          </div>

          <button onClick={() => setDeepMode(d => !d)}
            title={deepMode ? 'Deep search on — searches inside summaries and notes' : 'Turn on deep search'}
            className={cn('vault-toggle', deepMode && 'is-on')}>
            <Sparkles size={11} /> Deep
          </button>

          <button onClick={() => setPinnedOnly(p => !p)} title="Show only pinned"
            className={cn('vault-toggle', pinnedOnly && 'is-on pinned')}>
            <Pin size={11} /> Pinned
          </button>

          <button onClick={() => setShowArchived(a => !a)} title="Include archived items"
            className={cn('vault-toggle', showArchived && 'is-on')}>
            <Archive size={11} /> Archived
          </button>

          <button onClick={() => { setSelectMode(m => !m); if (selectMode) setSelectedIds(new Set()); }}
            className={cn('vault-toggle', selectMode && 'is-on select')}>
            {selectMode ? <CheckSquare size={11} /> : <Square size={11} />} Select
          </button>

          <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 8px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8 }}>
            <Filter size={11} color="var(--text-3)" />
          </div>

          <select value={domainFilter} onChange={e => setDomainFilter(e.target.value)}
            style={{ padding: '8px 12px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--text-1)', fontSize: 12, outline: 'none', fontFamily: 'inherit', cursor: 'pointer' }}>
            {DOMAINS.map(d => <option key={d} value={d}>{d || 'All Domains'}</option>)}
          </select>

          <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 8px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8 }}>
            <ArrowUpDown size={11} color="var(--text-3)" />
          </div>

          <select value={sort} onChange={e => setSort(e.target.value)}
            style={{ padding: '8px 12px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--text-1)', fontSize: 12, outline: 'none', fontFamily: 'inherit', cursor: 'pointer' }}>
            {SORT_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>

          <div style={{ marginLeft: 'auto' }}>
            <ViewModeToggle
              viewMode={viewMode}
              onViewMode={setViewMode}
              density={density}
              onDensity={setDensity}
            />
          </div>
        </div>
      </motion.div>

      {/* Bulk action bar */}
      <AnimatePresence>
        {selectMode && selectedIds.size > 0 && (
          <motion.div initial={{ y: -8, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -8, opacity: 0 }}
            className="vault-action-bar">
            <span className="vault-action-count">{selectedIds.size} selected</span>
            <button onClick={() => setSelectedIds(new Set(filtered.map(m => m.id)))} className="vault-action-link">Select all on page</button>
            <span style={{ flex: 1 }} />
            <button onClick={() => setTagPromptOpen('add')} disabled={bulkBusy} className="vault-action-btn"><Tag size={12} /> Add tags</button>
            <button onClick={() => setTagPromptOpen('remove')} disabled={bulkBusy} className="vault-action-btn"><Tag size={12} /> Remove tags</button>
            <button onClick={() => setMovePromptOpen(true)} disabled={bulkBusy} className="vault-action-btn"><FolderInput size={12} /> Move to project</button>
            <button onClick={() => bulkArchive(true)} disabled={bulkBusy} className="vault-action-btn"><Archive size={12} /> Archive</button>
            {showArchived && (
              <button onClick={() => bulkArchive(false)} disabled={bulkBusy} className="vault-action-btn"><ArchiveRestore size={12} /> Unarchive</button>
            )}
            <button onClick={exportSelection} disabled={bulkBusy} className="vault-action-btn"><Download size={12} /> Export</button>
            <button onClick={bulkDelete} disabled={bulkBusy} className="vault-action-btn danger"><Trash2 size={12} /> Delete</button>
            <button onClick={exitSelect} title="Exit select mode" className="vault-action-x"><X size={12} /></button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Inline tag prompt for bulk */}
      {tagPromptOpen && (
        <div className="vault-tag-prompt">
          <Tag size={13} color={tagPromptOpen === 'add' ? '#22d3ee' : '#ef4444'} />
          <span className="lbl">{tagPromptOpen === 'add' ? 'Add tags to' : 'Remove tags from'} {selectedIds.size} memor{selectedIds.size === 1 ? 'y' : 'ies'}</span>
          <input value={tagInput} onChange={e => setTagInput(e.target.value)} autoFocus
            placeholder="comma, separated, tags"
            onKeyDown={e => { if (e.key === 'Enter') submitTagBulk(); if (e.key === 'Escape') { setTagPromptOpen(null); setTagInput(''); } }} />
          <button onClick={submitTagBulk} disabled={!tagInput.trim() || bulkBusy} className="primary">Apply</button>
          <button onClick={() => { setTagPromptOpen(null); setTagInput(''); }}>Cancel</button>
        </div>
      )}

      {/* Inline move-to-project prompt */}
      {movePromptOpen && (
        <div className="vault-tag-prompt">
          <FolderInput size={13} color="#a78bfa" />
          <span className="lbl">Move {selectedIds.size} memor{selectedIds.size === 1 ? 'y' : 'ies'} to project</span>
          <input value={projectInput} onChange={e => setProjectInput(e.target.value)} autoFocus
            placeholder="project id (or leave blank to clear)"
            onKeyDown={e => { if (e.key === 'Enter') submitMoveProject(); if (e.key === 'Escape') { setMovePromptOpen(false); setProjectInput(''); } }} />
          <button onClick={submitMoveProject} disabled={!projectInput.trim() || bulkBusy} className="primary">Move</button>
          <button onClick={submitMoveClear} disabled={bulkBusy}>Clear project</button>
          <button onClick={() => { setMovePromptOpen(false); setProjectInput(''); }}>Cancel</button>
        </div>
      )}

      {/* Memories — grid (comfortable / compact) or list */}
      {isLoading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '80px 0' }}>
          <Loader2 size={34} color="#f472b6" style={{ animation: 'spin 1s linear infinite' }} />
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '70px 0' }}>
          <Brain size={40} color="var(--border-2)" style={{ margin: '0 auto 12px' }} />
          <p style={{ color: 'var(--text-3)', margin: 0 }}>{filter ? 'No memories match your search.' : 'No memories yet — start capturing knowledge!'}</p>
          <button onClick={() => navigate('/capture')} style={{ marginTop: 14, padding: '9px 20px', background: 'linear-gradient(135deg,#6366f1,#4f46e5)', border: 'none', borderRadius: 10, color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
            + Capture Knowledge
          </button>
        </div>
      ) : viewMode === 'list' ? (
        <div className="vault-list">
          {filtered.map((memory, i) => {
            const src = SRC_ICON[memory.source_type] ?? { icon: StickyNote, color: '#f59e0b' };
            const SrcIcon = src.icon;
            return (
              <motion.div key={memory.id} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i * 0.015, 0.3) }}
                className={cn('vault-row', selectedIds.has(memory.id) && 'is-selected', memory.pinned && 'is-pinned', memory.archived && 'is-archived')}
                onClick={() => selectMode ? toggleSelect(memory.id) : navigate(`/memory/${memory.id}`)}>
                {selectMode && (
                  <input type="checkbox" checked={selectedIds.has(memory.id)} onChange={() => toggleSelect(memory.id)} onClick={e => e.stopPropagation()}
                    className="vault-row-check" />
                )}
                {(memory.image_thumbnail || memory.image_data) ? (
                  <div
                    data-testid={`vault-row-thumb-${memory.id}`}
                    style={{ width: 44, height: 44, borderRadius: 8, overflow: 'hidden',
                      flexShrink: 0, position: 'relative', background: '#000',
                      border: `1px solid ${src.color}25` }}
                  >
                    <img
                      src={memory.image_thumbnail || memory.image_data}
                      alt={memory.image_caption || memory.title}
                      loading="lazy"
                      style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                    />
                    <div style={{ position: 'absolute', bottom: 2, right: 2, width: 14, height: 14,
                      borderRadius: 4, background: 'rgba(0,0,0,0.7)', display: 'grid', placeItems: 'center' }}>
                      <SrcIcon size={9} color={src.color} />
                    </div>
                  </div>
                ) : (
                  <div className="vault-row-icon" style={{ background: `${src.color}12`, border: `1px solid ${src.color}20` }}>
                    <SrcIcon size={14} color={src.color} />
                  </div>
                )}
                <div className="vault-row-main">
                  <div className="vault-row-title">
                    {memory.pinned && <Pin size={11} className="vault-pin-mark" />}
                    {memory.title}
                    {memory.archived && <span className="vault-archived-tag">Archived</span>}
                  </div>
                  <div className="vault-row-meta">
                    <span style={{ padding: '1px 6px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 20, color: 'var(--text-3)', fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{memory.domain}</span>
                    {memory.tags.slice(0, 2).map(tag => (
                      <span key={tag} style={{ color: '#f472b6', fontWeight: 700 }}>#{tag}</span>
                    ))}
                    {memory.tags.length > 2 && <span style={{ color: 'var(--text-3)', fontWeight: 700 }}>+{memory.tags.length - 2}</span>}
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                      <Clock size={10} />{new Date(memory.created_at).toLocaleDateString()}
                    </span>
                  </div>
                  {deepMode && deepResults[memory.id] && renderSnippet(memory.id)}
                </div>
                <div className="vault-row-actions">
                  <button onClick={e => toggleReviewed(memory, e)} title={memory.reviewed ? 'Mark as not done' : 'Mark as done'}
                    style={{ width: 28, height: 28, borderRadius: 7, background: memory.reviewed ? 'rgba(16,185,129,0.15)' : 'transparent', border: `1px solid ${memory.reviewed ? 'rgba(16,185,129,0.35)' : 'transparent'}`, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: memory.reviewed ? '#10b981' : 'var(--text-3)', transition: 'all 0.15s' }}
                    onMouseEnter={e => { if (!memory.reviewed) { e.currentTarget.style.background = 'rgba(16,185,129,0.1)'; e.currentTarget.style.color = '#10b981'; e.currentTarget.style.borderColor = 'rgba(16,185,129,0.25)'; } }}
                    onMouseLeave={e => { if (!memory.reviewed) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-3)'; e.currentTarget.style.borderColor = 'transparent'; } }}>
                    {memory.reviewed ? <CheckCircle2 size={13} /> : <Circle size={13} />}
                  </button>
                  <button onClick={e => togglePin(memory, e)} title={memory.pinned ? 'Unpin' : 'Pin to top'}
                    className={cn('vault-row-pin', memory.pinned && 'is-on')}>
                    {memory.pinned ? <Pin size={13} /> : <PinOff size={13} />}
                  </button>
                  <button onClick={e => { e.stopPropagation(); setFlashcardsMemory(memory); }} title="Generate Flashcards"
                    style={{ width: 28, height: 28, borderRadius: 7, background: 'transparent', border: '1px solid transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-3)', transition: 'all 0.15s' }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'rgba(245,158,11,0.12)'; e.currentTarget.style.color = '#f59e0b'; e.currentTarget.style.borderColor = 'rgba(245,158,11,0.25)'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-3)'; e.currentTarget.style.borderColor = 'transparent'; }}>
                    <FlipHorizontal size={13} />
                  </button>
                  <button onClick={e => { e.stopPropagation(); navigate(`/memory/${memory.id}`); }} title="Deep Dive"
                    style={{ width: 28, height: 28, borderRadius: 7, background: 'transparent', border: '1px solid transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-3)', transition: 'all 0.15s' }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'rgba(99,102,241,0.12)'; e.currentTarget.style.color = 'var(--primary)'; e.currentTarget.style.borderColor = 'rgba(99,102,241,0.25)'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-3)'; e.currentTarget.style.borderColor = 'transparent'; }}>
                    <ChevronRight size={14} />
                  </button>
                  <button onClick={e => { e.stopPropagation(); setEditingMemory(memory); }} title="Edit memory"
                    data-testid={`button-edit-memory-${memory.id}`}
                    style={{ width: 28, height: 28, borderRadius: 7, background: 'transparent', border: '1px solid transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-3)', transition: 'all 0.15s' }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'rgba(167,139,250,0.12)'; e.currentTarget.style.color = '#a78bfa'; e.currentTarget.style.borderColor = 'rgba(167,139,250,0.25)'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-3)'; e.currentTarget.style.borderColor = 'transparent'; }}>
                    <Edit2 size={12} />
                  </button>
                  <button onClick={e => handleDelete(memory.id, e)} disabled={deletingId === memory.id} title="Delete"
                    style={{ width: 28, height: 28, borderRadius: 7, background: 'transparent', border: '1px solid transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-3)', transition: 'all 0.15s' }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.1)'; e.currentTarget.style.color = '#ef4444'; e.currentTarget.style.borderColor = 'rgba(239,68,68,0.2)'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-3)'; e.currentTarget.style.borderColor = 'transparent'; }}>
                    {deletingId === memory.id ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <Trash2 size={13} />}
                  </button>
                </div>
              </motion.div>
            );
          })}
        </div>
      ) : (
        <div className={density === 'compact' ? 'vault-grid vault-compact' : 'vault-grid'}>
          {filtered.map((memory, i) => {
            const src = SRC_ICON[memory.source_type] ?? { icon: StickyNote, color: '#f59e0b' };
            const SrcIcon = src.icon;
            const compact = density === 'compact';
            const pad = compact ? '10px 11px' : '14px 15px';
            const tileSize = compact ? 26 : 34;
            const tileIcon = compact ? 13 : 16;
            const titleSize = compact ? 12 : 13.5;
            const titleMb = compact ? 4 : 6;
            const tagFs = compact ? 9 : 9.5;
            const showSummary = !compact;
            const tagLimit = compact ? 2 : 3;
            const actionBtn = compact ? 22 : 26;
            const actionIcon = compact ? 11 : 12;
            const sel = selectedIds.has(memory.id);
            return (
              <motion.div key={memory.id} layout initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i * 0.03, 0.4) }}
                onClick={() => { if (selectMode) toggleSelect(memory.id); }}
                className={cn(memory.pinned && 'vault-card-pinned', sel && 'vault-card-selected')}
                style={{ ...card, position: 'relative', display: 'flex', flexDirection: 'column', overflow: 'hidden', transition: 'all 0.2s', cursor: 'pointer', borderColor: sel ? 'var(--primary-border)' : 'var(--border)', background: sel ? 'var(--primary-bg)' : card.background }}
                onMouseEnter={e => { if (!sel) { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.boxShadow = `0 10px 28px ${src.color}12`; e.currentTarget.style.borderColor = `${src.color}25`; } }}
                onMouseLeave={e => { if (!sel) { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.borderColor = 'var(--border)'; } }}>

                {selectMode && (
                  <input type="checkbox" checked={sel} onChange={() => toggleSelect(memory.id)} onClick={e => e.stopPropagation()}
                    className="vault-card-check" />
                )}
                {memory.pinned && !selectMode && <div className="vault-card-pin-mark"><Pin size={10} /></div>}

                {memory.source_type === 'youtube' && memory.source_url && getYouTubeId(memory.source_url) && (
                  <YouTubeThumbnail url={memory.source_url} onClick={() => setSelectedMemory(memory)} />
                )}

                {/* Captured image thumbnail — shown for memories created via
                    visual capture / OCR. Sits flush at the top of the card,
                    above the padded content. Skipped when there's already a
                    YouTube thumbnail so we don't stack two media tiles. */}
                {(memory.image_thumbnail || memory.image_data) && !(memory.source_type === 'youtube' && memory.source_url && getYouTubeId(memory.source_url)) && (
                  <div
                    onClick={(e) => { e.stopPropagation(); navigate(`/memory/${memory.id}`); }}
                    data-testid={`vault-card-thumb-${memory.id}`}
                    style={{ position: 'relative', width: '100%', aspectRatio: '16 / 9',
                      background: '#000', overflow: 'hidden', cursor: 'pointer',
                      borderBottom: '1px solid var(--border)' }}
                  >
                    <img
                      src={memory.image_thumbnail || memory.image_data}
                      alt={memory.image_caption || memory.title}
                      loading="lazy"
                      style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                    />
                    {memory.image_caption && !compact && (
                      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0,
                        padding: '6px 9px',
                        background: 'linear-gradient(to top, rgba(0,0,0,0.78), rgba(0,0,0,0))',
                        color: '#fff', fontSize: 10.5, fontWeight: 600,
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {memory.image_caption}
                      </div>
                    )}
                  </div>
                )}

                <div style={{ padding: pad, flex: 1, display: 'flex', flexDirection: 'column' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: compact ? 8 : 10 }}>
                    <div style={{ width: tileSize, height: tileSize, borderRadius: compact ? 7 : 9, background: `${src.color}12`, border: `1px solid ${src.color}20`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <SrcIcon size={tileIcon} color={src.color} />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: compact ? 3 : 5 }}>
                      {!compact && (
                        <span style={{ padding: '2px 7px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 20, color: 'var(--text-3)', fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{memory.domain}</span>
                      )}
                      <button onClick={e => toggleReviewed(memory, e)} title={memory.reviewed ? 'Mark as not done' : 'Mark as done'}
                        style={{ width: actionBtn, height: actionBtn, borderRadius: 7, background: memory.reviewed ? 'rgba(16,185,129,0.18)' : 'transparent', border: `1px solid ${memory.reviewed ? 'rgba(16,185,129,0.35)' : 'transparent'}`, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: memory.reviewed ? '#10b981' : 'var(--text-3)', transition: 'all 0.15s' }}
                        onMouseEnter={e => { if (!memory.reviewed) { e.currentTarget.style.background = 'rgba(16,185,129,0.1)'; e.currentTarget.style.color = '#10b981'; e.currentTarget.style.borderColor = 'rgba(16,185,129,0.25)'; } }}
                        onMouseLeave={e => { if (!memory.reviewed) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-3)'; e.currentTarget.style.borderColor = 'transparent'; } }}>
                        {memory.reviewed ? <CheckCircle2 size={actionIcon} /> : <Circle size={actionIcon} />}
                      </button>
                      <button onClick={e => { e.stopPropagation(); setFlashcardsMemory(memory); }} title="Generate Flashcards"
                        style={{ width: actionBtn, height: actionBtn, borderRadius: 7, background: 'transparent', border: '1px solid transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-3)', transition: 'all 0.15s' }}
                        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(245,158,11,0.12)'; e.currentTarget.style.color = '#f59e0b'; e.currentTarget.style.borderColor = 'rgba(245,158,11,0.25)'; }}
                        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-3)'; e.currentTarget.style.borderColor = 'transparent'; }}>
                        <FlipHorizontal size={actionIcon} />
                      </button>
                      <button onClick={e => togglePin(memory, e)} title={memory.pinned ? 'Unpin' : 'Pin to top'}
                        style={{ width: actionBtn, height: actionBtn, borderRadius: 7, background: memory.pinned ? 'rgba(244,114,182,0.18)' : 'transparent', border: `1px solid ${memory.pinned ? 'rgba(244,114,182,0.35)' : 'transparent'}`, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: memory.pinned ? '#f472b6' : 'var(--text-3)', transition: 'all 0.15s' }}
                        onMouseEnter={e => { if (!memory.pinned) { e.currentTarget.style.background = 'rgba(244,114,182,0.1)'; e.currentTarget.style.color = '#f472b6'; e.currentTarget.style.borderColor = 'rgba(244,114,182,0.25)'; } }}
                        onMouseLeave={e => { if (!memory.pinned) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-3)'; e.currentTarget.style.borderColor = 'transparent'; } }}>
                        {memory.pinned ? <Pin size={actionIcon} /> : <PinOff size={actionIcon} />}
                      </button>
                      <button onClick={e => { e.stopPropagation(); setEditingMemory(memory); }} title="Edit memory"
                        data-testid={`button-edit-memory-grid-${memory.id}`}
                        style={{ width: actionBtn, height: actionBtn, borderRadius: 7, background: 'transparent', border: '1px solid transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-3)', transition: 'all 0.15s' }}
                        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(167,139,250,0.12)'; e.currentTarget.style.color = '#a78bfa'; e.currentTarget.style.borderColor = 'rgba(167,139,250,0.25)'; }}
                        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-3)'; e.currentTarget.style.borderColor = 'transparent'; }}>
                        <Edit2 size={actionIcon - 1} />
                      </button>
                      <button onClick={e => handleDelete(memory.id, e)} disabled={deletingId === memory.id} title="Move to Trash"
                        style={{ width: actionBtn, height: actionBtn, borderRadius: 7, background: 'transparent', border: '1px solid transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-3)', transition: 'all 0.15s' }}
                        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.1)'; e.currentTarget.style.color = '#ef4444'; e.currentTarget.style.borderColor = 'rgba(239,68,68,0.2)'; }}
                        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-3)'; e.currentTarget.style.borderColor = 'transparent'; }}>
                        {deletingId === memory.id ? <Loader2 size={actionIcon - 1} style={{ animation: 'spin 1s linear infinite' }} /> : <Trash2 size={actionIcon} />}
                      </button>
                    </div>
                  </div>

                  <h4 onClick={() => navigate(`/memory/${memory.id}`)} style={{ color: 'var(--text-1)', fontSize: titleSize, fontWeight: 700, lineHeight: 1.4, marginBottom: titleMb, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', cursor: 'pointer', transition: 'color 0.15s' }}
                    onMouseEnter={e => { e.currentTarget.style.color = 'var(--primary)'; }}
                    onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-1)'; }}>
                    {memory.title}
                  </h4>
                  {showSummary && (
                    <p style={{ color: 'var(--text-3)', fontSize: 12, lineHeight: 1.55, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden', flex: 1, marginBottom: 10 }}>{memory.summary}</p>
                  )}

                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: compact ? 4 : 5, marginBottom: compact ? 8 : 10, marginTop: compact ? 'auto' : 0 }}>
                    {memory.tags.slice(0, tagLimit).map(tag => (
                      <span key={tag} style={{ padding: compact ? '1px 6px' : '2px 7px', background: 'rgba(244,114,182,0.08)', border: '1px solid rgba(244,114,182,0.18)', borderRadius: 20, color: '#f472b6', fontSize: tagFs, fontWeight: 700 }}>#{tag}</span>
                    ))}
                    {memory.tags.length > tagLimit && <span style={{ color: 'var(--text-3)', fontSize: tagFs, fontWeight: 700, alignSelf: 'center' }}>+{memory.tags.length - tagLimit}</span>}
                  </div>

                  {deepMode && deepResults[memory.id] && renderSnippet(memory.id)}

                  <div style={{ paddingTop: compact ? 8 : 10, borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--text-3)', fontSize: 10 }}>
                      <Clock size={10} />{new Date(memory.created_at).toLocaleDateString()}
                    </span>
                    <button onClick={() => navigate(`/memory/${memory.id}`)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--primary)', fontSize: 10.5, fontWeight: 700, fontFamily: 'inherit' }}>
                      {compact ? '→' : 'Deep Dive →'}
                    </button>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Memory Detail Modal */}
      <AnimatePresence>
        {selectedMemory && (
          <div style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setSelectedMemory(null)}
              style={{ position: 'absolute', inset: 0, background: 'rgba(5,5,15,0.82)', backdropFilter: 'blur(8px)' }} />
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }}
              style={{ position: 'relative', width: '100%', maxWidth: 720, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 20, overflow: 'hidden', maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 64px rgba(0,0,0,0.55)' }}>

              <div style={{ background: 'linear-gradient(135deg, #0d1117 0%, #1a1040 60%, #1e1b4b 100%)', padding: '24px 28px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexShrink: 0 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
                    <span style={{ padding: '3px 9px', background: '#6366f1', borderRadius: 6, fontSize: 9, fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', color: '#fff' }}>{selectedMemory.source_type}</span>
                    <span style={{ padding: '3px 9px', background: 'rgba(255,255,255,0.1)', borderRadius: 6, fontSize: 9, fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', color: 'rgba(255,255,255,0.7)' }}>{selectedMemory.domain}</span>
                  </div>
                  <h3 style={{ color: '#fff', fontSize: 20, fontWeight: 800, margin: 0, lineHeight: 1.35 }}>{selectedMemory.title}</h3>
                </div>
                <button onClick={() => setSelectedMemory(null)} style={{ width: 34, height: 34, borderRadius: 9, background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#fff', flexShrink: 0, marginLeft: 12 }}>
                  <X size={16} />
                </button>
              </div>

              <div style={{ flex: 1, overflowY: 'auto', padding: '22px 28px' }} className="scroll-custom">
                {selectedMemory.source_type === 'youtube' && selectedMemory.source_url && <YouTubeEmbed url={selectedMemory.source_url} />}

                {selectedMemory.source_type === 'pdf' && selectedMemory.pdf_data && (
                  <div style={{ marginBottom: 18, borderRadius: 12, overflow: 'hidden', border: '1px solid var(--border)', background: '#1a1040' }}>
                    <iframe src={selectedMemory.pdf_data} title={selectedMemory.title}
                      style={{ width: '100%', height: 480, border: 0, display: 'block', background: '#fff' }} />
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: 'var(--surface-2)', fontSize: 11, color: 'var(--text-3)', flexWrap: 'wrap' }}>
                      <FileText size={11} color="#f59e0b" />
                      <span style={{ fontWeight: 700, color: 'var(--text-2)' }}>PDF embedded</span>
                      {selectedMemory.pdf_pages && <span>{selectedMemory.pdf_pages} pages</span>}
                      {selectedMemory.pdf_size_kb && <span>{selectedMemory.pdf_size_kb} KB</span>}
                      {selectedMemory.pdf_word_count && <span>~{selectedMemory.pdf_word_count.toLocaleString()} words</span>}
                      <button
                        type="button"
                        onClick={() => {
                          if (!selectedMemory.pdf_data) return;
                          fetch(selectedMemory.pdf_data)
                            .then(r => r.blob())
                            .then(blob => {
                              const u = URL.createObjectURL(blob);
                              window.open(u, '_blank', 'noopener,noreferrer');
                              setTimeout(() => URL.revokeObjectURL(u), 60000);
                            })
                            .catch(() => window.open(selectedMemory.pdf_data!, '_blank', 'noopener,noreferrer'));
                        }}
                        data-testid="button-open-pdf-vault"
                        style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 700, color: 'var(--primary)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 9px', border: '1px solid var(--primary-border)', borderRadius: 7, background: 'var(--primary-bg)', fontFamily: 'inherit' }}
                      >
                        Open in new tab
                      </button>
                      <a href={selectedMemory.pdf_data} download={`${selectedMemory.title}.pdf`}
                        data-testid="link-download-pdf-vault"
                        style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-2)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 9px', border: '1px solid var(--border)', borderRadius: 7, background: 'var(--surface)' }}>
                        Download
                      </a>
                    </div>
                  </div>
                )}
                {selectedMemory.source_type === 'pdf' && !selectedMemory.pdf_data && (
                  <div style={{ marginBottom: 18, padding: '14px 16px', borderRadius: 12, border: '1px dashed var(--border)', background: 'var(--surface-2)', display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, color: 'var(--text-3)' }}>
                    <FileText size={14} color="#f59e0b" />
                    <span style={{ color: 'var(--text-2)', fontWeight: 700 }}>PDF too large to embed inline.</span>
                    <span>Text was extracted and analyzed — full inline preview is available for files under 700 KB.</span>
                  </div>
                )}

                <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                  {selectedMemory.executive_summary && (
                    <section>
                      <h4 style={{ display: 'flex', alignItems: 'center', gap: 7, color: 'var(--text-1)', fontSize: 13, fontWeight: 700, marginBottom: 8 }}>
                        <Award size={14} color="#a855f7" /> Executive Summary
                      </h4>
                      <p style={{ color: 'var(--text-2)', lineHeight: 1.7, fontSize: 13.5, margin: 0, padding: '12px 14px', background: 'rgba(168,85,247,0.06)', border: '1px solid rgba(168,85,247,0.18)', borderRadius: 11 }}>
                        {selectedMemory.executive_summary}
                      </p>
                    </section>
                  )}

                  <section>
                    <h4 style={{ display: 'flex', alignItems: 'center', gap: 7, color: 'var(--text-1)', fontSize: 13, fontWeight: 700, marginBottom: 8 }}>
                      <Brain size={14} color="#6366f1" /> Summary
                    </h4>
                    <p style={{ color: 'var(--text-2)', lineHeight: 1.7, fontSize: 13.5, margin: 0 }}>{selectedMemory.summary}</p>
                  </section>

                  {selectedMemory.action_items && selectedMemory.action_items.length > 0 && (
                    <section>
                      <h4 style={{ display: 'flex', alignItems: 'center', gap: 7, color: 'var(--text-1)', fontSize: 13, fontWeight: 700, marginBottom: 8 }}>
                        <ListTodo size={14} color="#22d3ee" /> Action Items
                      </h4>
                      <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {selectedMemory.action_items.map((it, i) => (
                          <li key={i} style={{ display: 'flex', gap: 9, padding: '9px 12px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 10, fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.5 }}>
                            <span style={{ width: 18, height: 18, borderRadius: 5, border: '1.5px solid #22d3ee', flexShrink: 0, marginTop: 1 }} />
                            <span>{it}</span>
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}

                  <section>
                    <h4 style={{ display: 'flex', alignItems: 'center', gap: 7, color: 'var(--text-1)', fontSize: 13, fontWeight: 700, marginBottom: 8 }}>
                      <CheckCircle2 size={14} color="#10b981" /> Key Insights
                    </h4>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(250px,1fr))', gap: 8 }}>
                      {selectedMemory.key_points.map((point, i) => (
                        <div key={i} style={{ display: 'flex', gap: 10, padding: '10px 13px', background: 'var(--surface-2)', borderRadius: 11, fontSize: 12.5, color: 'var(--text-2)', border: '1px solid var(--border)' }}>
                          <span style={{ width: 20, height: 20, borderRadius: '50%', background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.25)', color: '#818cf8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9.5, fontWeight: 800, flexShrink: 0 }}>{i + 1}</span>
                          {point}
                        </div>
                      ))}
                    </div>
                  </section>

                  {selectedMemory.glossary && selectedMemory.glossary.length > 0 && (
                    <section>
                      <h4 style={{ display: 'flex', alignItems: 'center', gap: 7, color: 'var(--text-1)', fontSize: 13, fontWeight: 700, marginBottom: 8 }}>
                        <BookOpen size={14} color="#f97316" /> Glossary
                      </h4>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {selectedMemory.glossary.map((g, i) => (
                          <div key={i} style={{ padding: '9px 12px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 10, fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.5 }}>
                            <strong style={{ color: '#f97316', marginRight: 6 }}>{g.term}</strong>
                            <span>{g.definition}</span>
                          </div>
                        ))}
                      </div>
                    </section>
                  )}

                  {selectedMemory.study_questions && selectedMemory.study_questions.length > 0 && (
                    <section>
                      <h4 style={{ display: 'flex', alignItems: 'center', gap: 7, color: 'var(--text-1)', fontSize: 13, fontWeight: 700, marginBottom: 8 }}>
                        <MessageCircle size={14} color="#ec4899" /> Study Questions
                      </h4>
                      <ol style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 5 }}>
                        {selectedMemory.study_questions.map((q, i) => (
                          <li key={i} style={{ fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.55 }}>{q}</li>
                        ))}
                      </ol>
                    </section>
                  )}

                  <section>
                    <h4 style={{ display: 'flex', alignItems: 'center', gap: 7, color: 'var(--text-1)', fontSize: 13, fontWeight: 700, marginBottom: 8 }}>
                      <Tag size={14} color="#f59e0b" /> Tags
                    </h4>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
                      {selectedMemory.tags.map(tag => (
                        <span key={tag} style={{ padding: '4px 11px', background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.2)', borderRadius: 20, color: '#818cf8', fontSize: 11.5, fontWeight: 700 }}>#{tag}</span>
                      ))}
                    </div>
                  </section>

                  <div style={{ paddingTop: 14, borderTop: '1px solid var(--border)', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                      {selectedMemory.source_url && (
                        <a href={selectedMemory.source_url} target="_blank" rel="noopener noreferrer"
                          style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, color: '#6366f1', textDecoration: 'none' }}>
                          <ExternalLink size={13} /> View Source
                        </a>
                      )}
                      <button onClick={() => { setFlashcardsMemory(selectedMemory); setSelectedMemory(null); }}
                        style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, color: '#f59e0b', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
                        <FlipHorizontal size={13} /> Generate Flashcards
                      </button>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {flashcardsMemory && (
          <FlashcardModal memory={flashcardsMemory} onClose={() => setFlashcardsMemory(null)} />
        )}
      </AnimatePresence>

      <MemoryEditModal
        memory={editingMemory}
        onClose={() => setEditingMemory(null)}
        onSaved={(updated) => {
          applyMemoryUpdate(updated);
          setEditingMemory(null);
        }}
      />

      <ConfirmDialog
        open={!!pendingDeleteId}
        title="Move to Trash?"
        message="This memory will be moved to Trash. You can restore it within 30 days."
        confirmLabel="Move to Trash"
        cancelLabel="Keep it"
        destructive
        onConfirm={() => { if (pendingDeleteId) performDelete(pendingDeleteId); }}
        onCancel={() => setPendingDeleteId(null)}
      />
    </div>
  );
};

export default VaultView;
