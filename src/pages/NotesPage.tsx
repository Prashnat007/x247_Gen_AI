import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  StickyNote, Plus, Search, Pin, PinOff, Trash2, Save, Edit3, X,
  Eye, Code, Tag as TagIcon, FileText, Sparkles, Calendar as CalendarIcon,
  Hash, Filter, Type, ChevronRight, Clock, CheckSquare, Square, Download, Archive, ArchiveRestore, FolderInput
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { showToast } from '../App';
import type { BulkApiResponse } from '../lib/types';
import ViewModeToggle, { useViewModePref } from '../components/ViewModeToggle';

interface Note {
  id: string;
  title: string;
  content: string;
  tags: string[];
  pinned: boolean;
  created_at: string;
  updated_at: string;
  word_count: number;
}

const renderMarkdown = (md: string): string => {
  if (!md) return '<p style="color:var(--text-3);font-style:italic">Start writing...</p>';
  let html = md
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/^### (.*)$/gm, '<h3 style="font-size:15px;font-weight:800;color:var(--text-1);margin:16px 0 6px">$1</h3>')
    .replace(/^## (.*)$/gm, '<h2 style="font-size:17px;font-weight:800;color:var(--text-1);margin:18px 0 8px">$1</h2>')
    .replace(/^# (.*)$/gm, '<h1 style="font-size:20px;font-weight:900;color:var(--text-1);margin:20px 0 10px;letter-spacing:-0.4px">$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong style="color:var(--text-1);font-weight:700">$1</strong>')
    .replace(/\*(.+?)\*/g, '<em style="color:var(--text-1)">$1</em>')
    .replace(/`(.+?)`/g, '<code style="background:var(--surface-2);padding:1px 6px;border-radius:5px;font-family:JetBrains Mono,monospace;font-size:12px;color:var(--primary)">$1</code>')
    .replace(/^\- (.*)$/gm, '<li style="margin-left:18px;margin-bottom:4px;color:var(--text-2)">$1</li>')
    .replace(/^\d+\. (.*)$/gm, '<li style="margin-left:18px;margin-bottom:4px;color:var(--text-2);list-style-type:decimal">$1</li>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" style="color:var(--primary);text-decoration:underline">$1</a>')
    .replace(/\n\n/g, '</p><p style="margin:8px 0;color:var(--text-2);line-height:1.6">')
    .replace(/\n/g, '<br/>');
  return `<p style="margin:8px 0;color:var(--text-2);line-height:1.6">${html}</p>`;
};

interface NotesPageProps { embedded?: boolean }
const NotesPage: React.FC<NotesPageProps> = ({ embedded = false }) => {
  const [notes, setNotes] = useState<Note[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [view, setView] = useState<'edit' | 'preview' | 'split'>('split');
  const [draft, setDraft] = useState({ title: '', content: '', tags: [] as string[] });
  const [tagInput, setTagInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [tagPrompt, setTagPrompt] = useState<null | 'add' | 'remove'>(null);
  const [tagPromptInput, setTagPromptInput] = useState('');
  const [moveProjectPrompt, setMoveProjectPrompt] = useState(false);
  const [moveProjectInput, setMoveProjectInput] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const { viewMode, setViewMode, density, setDensity } = useViewModePref('recall:notes');

  const loadNotes = useCallback(() => {
    fetch(`/notes${showArchived ? '?include_archived=true' : ''}`)
      .then(r => r.ok ? r.json() : [])
      .then((data: unknown) => {
        const arr = Array.isArray(data) ? (data as Note[]) : [];
        setNotes(arr);
        if (arr.length && !selectedId) setSelectedId(arr[0].id);
        setLoading(false);
      }).catch(() => setLoading(false));
  }, [selectedId, showArchived]);

  useEffect(() => { loadNotes(); }, [showArchived]);

  const selected = useMemo(() => notes.find(n => n.id === selectedId) || null, [notes, selectedId]);

  useEffect(() => {
    if (selected) setDraft({ title: selected.title, content: selected.content, tags: selected.tags });
  }, [selectedId]);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    notes.forEach(n => n.tags.forEach(t => set.add(t)));
    return Array.from(set).sort();
  }, [notes]);

  const filtered = useMemo(() => {
    return notes.filter(n => {
      if (search && !n.title.toLowerCase().includes(search.toLowerCase()) && !n.content.toLowerCase().includes(search.toLowerCase())) return false;
      if (tagFilter && !n.tags.includes(tagFilter)) return false;
      return true;
    });
  }, [notes, search, tagFilter]);

  const saveNote = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      await fetch(`/notes/${selected.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft)
      });
      loadNotes();
    } finally { setTimeout(() => setSaving(false), 400); }
  };

  // Auto-save
  useEffect(() => {
    if (!selected) return;
    if (draft.title === selected.title && draft.content === selected.content && JSON.stringify(draft.tags) === JSON.stringify(selected.tags)) return;
    const t = setTimeout(saveNote, 800);
    return () => clearTimeout(t);
  }, [draft.title, draft.content, draft.tags]);

  const createNew = async () => {
    const r = await fetch('/notes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Untitled note', content: '', tags: [] }) });
    const newNote = await r.json();
    setNotes([newNote, ...notes]);
    setSelectedId(newNote.id);
  };

  const togglePin = async (id: string, current: boolean) => {
    await fetch(`/notes/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pinned: !current }) });
    loadNotes();
  };

  const deleteNote = async (id: string) => {
    if (!confirm('Move this note to Trash?')) return;
    await fetch(`/notes/${id}`, { method: 'DELETE' });
    setNotes(notes.filter(n => n.id !== id));
    if (selectedId === id) setSelectedId(notes.find(n => n.id !== id)?.id ?? null);
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
      loadNotes();
      exitSelect();
    } catch {
      showToast('Bulk action failed');
    } finally { setBulkBusy(false); }
  };

  const bulkDelete = () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`Move ${selectedIds.size} notes to Trash?`)) return;
    bulkApi('/library/bulk-delete', { entity: 'note', ids: Array.from(selectedIds) }, 'Moved to Trash');
  };

  const bulkArchive = () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`Archive ${selectedIds.size} notes? They get hidden from the main list but stay searchable.`)) return;
    bulkApi('/library/bulk-archive', { entity: 'note', ids: Array.from(selectedIds), archived: true }, 'Archived');
  };

  const bulkUnarchive = () => {
    if (selectedIds.size === 0) return;
    bulkApi('/library/bulk-archive', { entity: 'note', ids: Array.from(selectedIds), archived: false }, 'Unarchived');
  };

  const submitMoveProject = () => {
    const pid = moveProjectInput.trim();
    if (!pid || selectedIds.size === 0) { setMoveProjectPrompt(false); setMoveProjectInput(''); return; }
    bulkApi('/library/bulk-move-project', { entity: 'note', ids: Array.from(selectedIds), project_id: pid }, 'Moved to project');
    setMoveProjectInput('');
  };

  const submitClearProject = () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`Remove ${selectedIds.size} notes from any project?`)) return;
    bulkApi('/library/bulk-move-project', { entity: 'note', ids: Array.from(selectedIds), project_id: null }, 'Cleared project');
    setMoveProjectInput('');
  };

  const bulkTagAdd = () => {
    const tags = tagPromptInput.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
    if (!tags.length || selectedIds.size === 0) return;
    bulkApi('/library/bulk-tag-add', { entity: 'note', ids: Array.from(selectedIds), tags }, 'Tags added');
    setTagPromptInput('');
  };

  const bulkTagRemove = () => {
    const tags = tagPromptInput.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
    if (!tags.length || selectedIds.size === 0) return;
    bulkApi('/library/bulk-tag-remove', { entity: 'note', ids: Array.from(selectedIds), tags }, 'Tags removed');
    setTagPromptInput('');
  };

  const bulkExport = () => {
    if (selectedIds.size === 0) return;
    const chosen = notes.filter(n => selectedIds.has(n.id));
    const md = chosen.map(n => `# ${n.title}\n\nTags: ${n.tags.map(t => '#' + t).join(' ')}\n\n${n.content}\n\n---\n`).join('\n');
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `notes-export-${Date.now()}.md`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    showToast(`Exported ${chosen.length} notes`);
  };

  const addTag = () => {
    if (!tagInput.trim()) return;
    const t = tagInput.trim().toLowerCase();
    if (!draft.tags.includes(t)) setDraft({ ...draft, tags: [...draft.tags, t] });
    setTagInput('');
  };

  const removeTag = (t: string) => setDraft({ ...draft, tags: draft.tags.filter(x => x !== t) });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '14px 0 28px', minHeight: 'calc(100vh - 5rem)' }}>

      {/* HERO HEADER */}
      {!embedded && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ width: 52, height: 52, borderRadius: 14, background: 'linear-gradient(135deg, rgba(245,158,11,0.25), rgba(217,119,6,0.18))', border: '1px solid rgba(245,158,11,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 28px rgba(245,158,11,0.2)' }}>
              <StickyNote size={24} color="#f59e0b" />
            </div>
            <div>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '4px 12px', background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 20, marginBottom: 6 }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#10b981', boxShadow: '0 0 8px #10b981' }} />
                <span style={{ fontSize: 10.5, fontWeight: 700, color: '#f59e0b', letterSpacing: '0.5px' }}>{notes.length} NOTES · MARKDOWN ENABLED · AUTO-SAVE</span>
              </div>
              <h2 style={{ fontSize: 'clamp(22px,3.5vw,30px)', fontWeight: 900, color: 'var(--text-1)', margin: 0, letterSpacing: '-0.6px', lineHeight: 1.05 }}>
                Notes <span style={{ color: '#f59e0b' }}>✦</span>
              </h2>
              <p style={{ color: 'var(--text-3)', fontSize: 13.5, margin: '4px 0 0' }}>
                Quick markdown notes that flow into your second brain
              </p>
            </div>
          </div>
          <button onClick={createNew} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '10px 18px', background: 'linear-gradient(135deg,#f59e0b,#d97706)', border: 'none', borderRadius: 10, color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', boxShadow: '0 4px 16px rgba(245,158,11,0.4)' }}>
            <Plus size={14} /> New note
          </button>
        </div>
      )}

      {/* BODY: list + editor */}
      <div className="notes-body-grid" style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: 14, alignItems: 'start' }}>

        {/* LEFT: list */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, position: 'sticky', top: 12, alignSelf: 'start', maxHeight: 'calc(100vh - 80px)' }}>
          {embedded && (
            <button onClick={createNew}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '8px 12px', background: 'linear-gradient(135deg,#f59e0b,#d97706)', border: 'none', borderRadius: 10, color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', boxShadow: '0 2px 8px rgba(245,158,11,0.25)' }}>
              <Plus size={13} /> New note
            </button>
          )}
          <div style={{ position: 'relative' }}>
            <Search size={13} color="var(--text-3)" style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)' }} />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search notes..."
              style={{ width: '100%', padding: '9px 12px 9px 32px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-1)', fontSize: 12.5, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }} />
          </div>

          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <button onClick={() => { if (selectMode) exitSelect(); else setSelectMode(true); }}
              style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, padding: '6px 10px', background: selectMode ? 'var(--primary-bg)' : 'var(--surface-2)', border: `1px solid ${selectMode ? 'var(--primary-border)' : 'var(--border)'}`, borderRadius: 9, color: selectMode ? 'var(--primary)' : 'var(--text-2)', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
              {selectMode ? <CheckSquare size={11} /> : <Square size={11} />}
              {selectMode ? `Selected: ${selectedIds.size}` : 'Select'}
            </button>
            {selectMode && filtered.length > 0 && (
              <button onClick={() => {
                const allIds = new Set(filtered.map(n => n.id));
                setSelectedIds(selectedIds.size === filtered.length ? new Set() : allIds);
              }}
                style={{ padding: '6px 10px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 9, color: 'var(--text-2)', fontSize: 10.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                {selectedIds.size === filtered.length ? 'None' : 'All'}
              </button>
            )}
            <button onClick={() => setShowArchived(v => !v)} title={showArchived ? 'Showing archived too' : 'Hide archived'}
              style={{ padding: '6px 10px', background: showArchived ? 'rgba(168,85,247,0.12)' : 'var(--surface-2)', border: `1px solid ${showArchived ? 'rgba(168,85,247,0.4)' : 'var(--border)'}`, borderRadius: 9, color: showArchived ? '#a855f7' : 'var(--text-3)', fontSize: 10.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 4 }}>
              <Archive size={10} /> {showArchived ? 'Archived: on' : 'Archived'}
            </button>
          </div>

          {/* Same view-mode toggle Vault uses, so users get one mental model
              across the Library hub. Persisted under `recall:notes:*` so
              Notes' choice doesn't bleed into Vault or Bookmarks. */}
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <ViewModeToggle
              viewMode={viewMode}
              onViewMode={setViewMode}
              density={density}
              onDensity={setDensity}
              testIdPrefix="notes"
            />
          </div>

          {selectMode && selectedIds.size > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 8, background: 'var(--surface-2)', border: '1px solid var(--primary-border)', borderRadius: 10 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
                <button onClick={bulkDelete} disabled={bulkBusy} title="Move to Trash"
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, padding: '6px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 7, color: '#ef4444', fontSize: 10.5, fontWeight: 700, cursor: bulkBusy ? 'wait' : 'pointer', fontFamily: 'inherit' }}>
                  <Trash2 size={10} /> Trash
                </button>
                <button onClick={bulkExport} disabled={bulkBusy} title="Export markdown"
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, padding: '6px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 7, color: 'var(--text-2)', fontSize: 10.5, fontWeight: 700, cursor: bulkBusy ? 'wait' : 'pointer', fontFamily: 'inherit' }}>
                  <Download size={10} /> Export
                </button>
                <button onClick={() => { setTagPrompt('add'); setTagPromptInput(''); }} disabled={bulkBusy}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, padding: '6px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 7, color: 'var(--text-2)', fontSize: 10.5, fontWeight: 700, cursor: bulkBusy ? 'wait' : 'pointer', fontFamily: 'inherit' }}>
                  <TagIcon size={10} /> Add tag
                </button>
                <button onClick={() => { setTagPrompt('remove'); setTagPromptInput(''); }} disabled={bulkBusy}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, padding: '6px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 7, color: 'var(--text-2)', fontSize: 10.5, fontWeight: 700, cursor: bulkBusy ? 'wait' : 'pointer', fontFamily: 'inherit' }}>
                  <X size={10} /> Remove tag
                </button>
                <button onClick={() => { setMoveProjectPrompt(true); setMoveProjectInput(''); }} disabled={bulkBusy} title="Move to project"
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, padding: '6px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 7, color: 'var(--text-2)', fontSize: 10.5, fontWeight: 700, cursor: bulkBusy ? 'wait' : 'pointer', fontFamily: 'inherit' }}>
                  <FolderInput size={10} /> Move
                </button>
                {showArchived ? (
                  <button onClick={bulkUnarchive} disabled={bulkBusy} title="Bring back to main list"
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, padding: '6px', background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: 7, color: '#22c55e', fontSize: 10.5, fontWeight: 700, cursor: bulkBusy ? 'wait' : 'pointer', fontFamily: 'inherit' }}>
                    <ArchiveRestore size={10} /> Unarchive
                  </button>
                ) : (
                  <button onClick={bulkArchive} disabled={bulkBusy} title="Archive — hidden from main list, still searchable"
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, padding: '6px', background: 'rgba(168,85,247,0.1)', border: '1px solid rgba(168,85,247,0.3)', borderRadius: 7, color: '#a855f7', fontSize: 10.5, fontWeight: 700, cursor: bulkBusy ? 'wait' : 'pointer', fontFamily: 'inherit' }}>
                    <Archive size={10} /> Archive
                  </button>
                )}
              </div>
              {tagPrompt && (
                <div style={{ display: 'flex', gap: 4 }}>
                  <input autoFocus value={tagPromptInput} onChange={e => setTagPromptInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { tagPrompt === 'add' ? bulkTagAdd() : bulkTagRemove(); } }}
                    placeholder="tag1, tag2"
                    style={{ flex: 1, padding: '5px 8px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 7, color: 'var(--text-1)', fontSize: 11, outline: 'none', fontFamily: 'inherit' }} />
                  <button onClick={tagPrompt === 'add' ? bulkTagAdd : bulkTagRemove} disabled={!tagPromptInput.trim()}
                    style={{ padding: '5px 10px', background: 'var(--primary-bg)', border: '1px solid var(--primary-border)', borderRadius: 7, color: 'var(--primary)', fontSize: 10.5, fontWeight: 700, cursor: tagPromptInput.trim() ? 'pointer' : 'default', fontFamily: 'inherit', opacity: tagPromptInput.trim() ? 1 : 0.5 }}>OK</button>
                </div>
              )}
              {moveProjectPrompt && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  <input autoFocus value={moveProjectInput} onChange={e => setMoveProjectInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') submitMoveProject(); if (e.key === 'Escape') { setMoveProjectPrompt(false); setMoveProjectInput(''); } }}
                    placeholder="project id"
                    style={{ flex: 1, minWidth: 100, padding: '5px 8px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 7, color: 'var(--text-1)', fontSize: 11, outline: 'none', fontFamily: 'inherit' }} />
                  <button onClick={submitMoveProject} disabled={!moveProjectInput.trim() || bulkBusy}
                    style={{ padding: '5px 10px', background: 'var(--primary-bg)', border: '1px solid var(--primary-border)', borderRadius: 7, color: 'var(--primary)', fontSize: 10.5, fontWeight: 700, cursor: moveProjectInput.trim() ? 'pointer' : 'default', fontFamily: 'inherit', opacity: moveProjectInput.trim() ? 1 : 0.5 }}>Move</button>
                  <button onClick={submitClearProject} disabled={bulkBusy}
                    style={{ padding: '5px 10px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 7, color: 'var(--text-3)', fontSize: 10.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Clear</button>
                </div>
              )}
            </div>
          )}

          {allTags.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              <button onClick={() => setTagFilter(null)} style={{ padding: '3px 9px', background: !tagFilter ? 'var(--primary-bg)' : 'transparent', border: `1px solid ${!tagFilter ? 'var(--primary-border)' : 'var(--border)'}`, borderRadius: 12, color: !tagFilter ? 'var(--primary)' : 'var(--text-3)', fontSize: 10.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>All</button>
              {allTags.slice(0, 8).map(t => (
                <button key={t} onClick={() => setTagFilter(tagFilter === t ? null : t)} style={{ padding: '3px 9px', background: tagFilter === t ? 'var(--primary-bg)' : 'transparent', border: `1px solid ${tagFilter === t ? 'var(--primary-border)' : 'var(--border)'}`, borderRadius: 12, color: tagFilter === t ? 'var(--primary)' : 'var(--text-3)', fontSize: 10.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>#{t}</button>
              ))}
            </div>
          )}

          <div
            className={
              loading || filtered.length === 0
                ? 'scroll-custom'
                : viewMode === 'list'
                  ? 'scroll-custom lib-list'
                  : density === 'compact' ? 'scroll-custom lib-grid lib-compact' : 'scroll-custom lib-grid'
            }
            style={{
              flex: 1,
              overflowY: 'auto',
              ...((loading || filtered.length === 0) ? { display: 'flex', flexDirection: 'column' } : {}),
              // The Notes sidebar is ~300px wide, but `.lib-grid` inherits
              // viewport-based breakpoints from Vault (3 / 5 cols at desktop
              // widths) which would make cards uselessly cramped here.
              // Override inline so the narrow container gets a sane column
              // count while still differentiating compact from comfortable.
              ...(viewMode === 'grid' && filtered.length > 0
                ? { gridTemplateColumns: density === 'compact' ? 'repeat(2, 1fr)' : '1fr' }
                : {}),
            }}>
            {loading ? (
              <div style={{ textAlign: 'center', color: 'var(--text-3)', fontSize: 12, padding: 30 }}>Loading...</div>
            ) : filtered.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 30, color: 'var(--text-3)' }}>
                <FileText size={28} style={{ margin: '0 auto 8px', opacity: 0.5 }} />
                <div style={{ fontSize: 12 }}>No notes yet</div>
                <button onClick={createNew} style={{ marginTop: 10, padding: '6px 12px', background: 'var(--primary-bg)', border: '1px solid var(--primary-border)', borderRadius: 8, color: 'var(--primary)', fontSize: 11.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Create first note</button>
              </div>
            ) : viewMode === 'list' ? filtered.map(n => {
              const isSel = selectedIds.has(n.id);
              const active = selectedId === n.id;
              return (
                <motion.div key={n.id} onClick={() => selectMode ? toggleSelect(n.id) : setSelectedId(n.id)}
                  whileHover={{ x: 2 }}
                  className="lib-row"
                  style={{ background: selectMode && isSel ? 'rgba(99,102,241,0.12)' : active ? 'var(--primary-bg)' : 'var(--surface)', borderColor: selectMode && isSel ? 'var(--primary)' : active ? 'var(--primary-border)' : 'var(--border)' }}>
                  {selectMode && (
                    isSel
                      ? <CheckSquare size={13} color="var(--primary)" style={{ flexShrink: 0 }} />
                      : <Square size={13} color="var(--text-3)" style={{ flexShrink: 0 }} />
                  )}
                  {n.pinned && <Pin size={12} color="#f59e0b" style={{ flexShrink: 0 }} />}
                  <div className="lib-row-main">
                    <div className="lib-row-title" style={{ color: active ? 'var(--primary)' : 'var(--text-1)' }}>{n.title}</div>
                    <div className="lib-row-meta">
                      {n.tags.slice(0, 3).map(t => (
                        <span key={t} style={{ color: 'var(--primary)', fontWeight: 700 }}>#{t}</span>
                      ))}
                      {n.tags.length > 3 && <span style={{ color: 'var(--text-3)', fontWeight: 700 }}>+{n.tags.length - 3}</span>}
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                        <Clock size={10} /> {new Date(n.updated_at).toLocaleDateString()}
                      </span>
                      <span>· {n.word_count} words</span>
                    </div>
                  </div>
                  <div className="lib-row-actions">
                    <button onClick={e => { e.stopPropagation(); togglePin(n.id, n.pinned); }} title={n.pinned ? 'Unpin' : 'Pin to top'}
                      style={{ width: 26, height: 26, borderRadius: 7, background: n.pinned ? 'rgba(245,158,11,0.12)' : 'transparent', border: `1px solid ${n.pinned ? 'rgba(245,158,11,0.3)' : 'transparent'}`, color: n.pinned ? '#f59e0b' : 'var(--text-3)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {n.pinned ? <Pin size={12} /> : <PinOff size={12} />}
                    </button>
                    <button onClick={e => { e.stopPropagation(); deleteNote(n.id); }} title="Delete"
                      style={{ width: 26, height: 26, borderRadius: 7, background: 'transparent', border: '1px solid transparent', color: 'var(--text-3)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                      onMouseEnter={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.1)'; e.currentTarget.style.color = '#ef4444'; e.currentTarget.style.borderColor = 'rgba(239,68,68,0.25)'; }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-3)'; e.currentTarget.style.borderColor = 'transparent'; }}>
                      <Trash2 size={12} />
                    </button>
                  </div>
                </motion.div>
              );
            }) : filtered.map(n => {
              const isSel = selectedIds.has(n.id);
              const active = selectedId === n.id;
              const compact = density === 'compact';
              return (
                <motion.div key={n.id} onClick={() => selectMode ? toggleSelect(n.id) : setSelectedId(n.id)}
                  whileHover={{ y: -2 }}
                  style={{ padding: compact ? '8px 10px' : '10px 12px', background: selectMode && isSel ? 'rgba(99,102,241,0.12)' : active ? 'var(--primary-bg)' : 'var(--surface)', border: `1px solid ${selectMode && isSel ? 'var(--primary)' : active ? 'var(--primary-border)' : 'var(--border)'}`, borderRadius: 10, cursor: 'pointer', position: 'relative', display: 'flex', flexDirection: 'column', gap: compact ? 3 : 5, minHeight: compact ? 56 : 72 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    {selectMode && (isSel
                      ? <CheckSquare size={11} color="var(--primary)" style={{ flexShrink: 0 }} />
                      : <Square size={11} color="var(--text-3)" style={{ flexShrink: 0 }} />)}
                    {n.pinned && <Pin size={10} color="#f59e0b" style={{ flexShrink: 0 }} />}
                    <div style={{ color: active ? 'var(--primary)' : 'var(--text-1)', fontSize: compact ? 11 : 12, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1, minWidth: 0 }}>{n.title}</div>
                  </div>
                  {!compact && (
                    <div style={{ color: 'var(--text-3)', fontSize: 10.5, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{n.content.replace(/[#*`]/g, '').slice(0, 80) || 'Empty note'}</div>
                  )}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--text-3)', fontSize: 9.5, marginTop: 'auto', flexWrap: 'wrap' }}>
                    {n.tags.slice(0, compact ? 1 : 2).map(t => <span key={t} style={{ color: 'var(--primary)', fontWeight: 700 }}>#{t}</span>)}
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                      <Clock size={9} />{new Date(n.updated_at).toLocaleDateString()}
                    </span>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>

        {/* RIGHT: editor */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 600 }}>
          {!selected ? (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12, color: 'var(--text-3)' }}>
              <Edit3 size={42} style={{ opacity: 0.3 }} />
              <div style={{ fontSize: 14 }}>Select a note or create a new one</div>
              <button onClick={createNew} style={{ padding: '8px 16px', background: 'linear-gradient(135deg,#f59e0b,#d97706)', border: 'none', borderRadius: 10, color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 6 }}><Plus size={12} /> New note</button>
            </div>
          ) : (
            <>
              {/* toolbar */}
              <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <input value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })}
                  className="bare-input"
                  style={{ flex: 1, minWidth: 180, padding: '6px 10px', borderRadius: 8, color: 'var(--text-1)', fontSize: 16, fontWeight: 800, fontFamily: 'inherit', letterSpacing: '-0.3px', border: '1px solid transparent', transition: 'border-color 0.15s' }}
                  onFocus={e => { (e.target as HTMLInputElement).style.border = '1px solid var(--border)'; }}
                  onBlur={e => { (e.target as HTMLInputElement).style.border = '1px solid transparent'; }} />
                <div style={{ display: 'flex', background: 'var(--surface-2)', borderRadius: 9, padding: 3, gap: 1 }}>
                  {([
                    { v: 'edit', icon: Code, label: 'Edit' },
                    { v: 'split', icon: Type, label: 'Split' },
                    { v: 'preview', icon: Eye, label: 'Preview' },
                  ] as const).map(b => (
                    <button key={b.v} onClick={() => setView(b.v)} title={b.label}
                      style={{ padding: '5px 9px', background: view === b.v ? 'var(--surface)' : 'transparent', border: 'none', borderRadius: 7, cursor: 'pointer', color: view === b.v ? 'var(--primary)' : 'var(--text-3)', display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'inherit', fontSize: 11, fontWeight: 600 }}>
                      <b.icon size={12} />
                    </button>
                  ))}
                </div>
                <button onClick={() => togglePin(selected.id, selected.pinned)} title={selected.pinned ? 'Unpin' : 'Pin'} style={{ padding: 7, background: selected.pinned ? 'rgba(245,158,11,0.12)' : 'var(--surface-2)', border: `1px solid ${selected.pinned ? 'rgba(245,158,11,0.3)' : 'var(--border)'}`, borderRadius: 8, color: selected.pinned ? '#f59e0b' : 'var(--text-3)', cursor: 'pointer', display: 'flex' }}>
                  {selected.pinned ? <PinOff size={12} /> : <Pin size={12} />}
                </button>
                <button onClick={() => deleteNote(selected.id)} title="Delete" style={{ padding: 7, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 8, color: '#ef4444', cursor: 'pointer', display: 'flex' }}>
                  <Trash2 size={12} />
                </button>
                <span style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px', background: saving ? 'rgba(99,102,241,0.1)' : 'rgba(16,185,129,0.08)', border: `1px solid ${saving ? 'rgba(99,102,241,0.3)' : 'rgba(16,185,129,0.25)'}`, borderRadius: 12, color: saving ? '#6366f1' : '#10b981', fontSize: 10, fontWeight: 700 }}>
                  {saving ? 'Saving...' : <><Save size={9} /> Saved</>}
                </span>
              </div>

              {/* tags row */}
              <div style={{ padding: '8px 14px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <TagIcon size={11} color="var(--text-3)" />
                {draft.tags.map(t => (
                  <span key={t} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', background: 'var(--primary-bg)', border: '1px solid var(--primary-border)', borderRadius: 11, color: 'var(--primary)', fontSize: 10.5, fontWeight: 600 }}>
                    #{t}
                    <button onClick={() => removeTag(t)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--primary)', display: 'flex', padding: 0 }}><X size={9} /></button>
                  </span>
                ))}
                <input value={tagInput} onChange={e => setTagInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }}
                  placeholder="Add tag..." style={{ width: 100, padding: '3px 8px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 11, color: 'var(--text-1)', fontSize: 10.5, outline: 'none', fontFamily: 'inherit' }} />
              </div>

              {/* editor + preview */}
              <div style={{ flex: 1, display: 'grid', gridTemplateColumns: view === 'split' ? '1fr 1fr' : '1fr', gap: 0, minHeight: 400 }}>
                {(view === 'edit' || view === 'split') && (
                  <textarea value={draft.content} onChange={e => setDraft({ ...draft, content: e.target.value })}
                    placeholder="Start writing in markdown..."
                    className="bare-input"
                    style={{ width: '100%', height: '100%', padding: '16px 18px', borderRight: view === 'split' ? '1px solid var(--border)' : 'none', color: 'var(--text-1)', fontSize: 13.5, fontFamily: "'JetBrains Mono', monospace", resize: 'none', boxSizing: 'border-box', lineHeight: 1.65 }} />
                )}
                {(view === 'preview' || view === 'split') && (
                  <div style={{ padding: '16px 20px', overflow: 'auto', fontSize: 13.5 }} dangerouslySetInnerHTML={{ __html: renderMarkdown(draft.content) }} />
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default NotesPage;
