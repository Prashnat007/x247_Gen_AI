import React, { useEffect, useMemo, useState } from 'react';
import { Tag as TagIcon, Search, Edit3, Trash2, GitMerge, X, Check, AlertTriangle } from 'lucide-react';
import { motion } from 'motion/react';
import { showToast } from '../App';
import type { TagIndexEntry } from '../lib/types';

const TagsManagerPage: React.FC = () => {
  const [tags, setTags] = useState<TagIndexEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [renaming, setRenaming] = useState<{ from: string; to: string } | null>(null);
  const [merging, setMerging] = useState(false);
  const [mergeTarget, setMergeTarget] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => {
    setLoading(true);
    fetch('/tags-index')
      .then(r => r.ok ? r.json() : [])
      .then((d: unknown) => {
        setTags(Array.isArray(d) ? (d as TagIndexEntry[]) : []);
        setLoading(false);
      }).catch(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return tags;
    return tags.filter(t => t.name.toLowerCase().includes(q));
  }, [tags, search]);

  const toggle = (name: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  };

  const rename = async () => {
    if (!renaming || !renaming.to.trim()) return;
    setBusy(true);
    try {
      const r = await fetch('/tags/rename', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ old: renaming.from, new: renaming.to.trim() }),
      });
      if (!r.ok) throw new Error(await r.text().catch(() => `HTTP ${r.status}`));
      const j = await r.json();
      showToast(`Renamed "${renaming.from}" to "${renaming.to.trim()}" across ${j.items_updated ?? 0} items`);
      setRenaming(null);
      load();
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      showToast(msg ? `Rename failed — ${msg.slice(0, 80)}` : 'Rename failed', 'error');
    } finally { setBusy(false); }
  };

  const mergeNow = async () => {
    if (!mergeTarget.trim() || selected.size < 2) return;
    setBusy(true);
    try {
      const r = await fetch('/tags/merge', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sources: Array.from(selected), target: mergeTarget.trim() }),
      });
      if (!r.ok) throw new Error(await r.text().catch(() => `HTTP ${r.status}`));
      const j = await r.json();
      showToast(`Merged ${selected.size} tags into "${mergeTarget.trim()}" across ${j.items_updated ?? 0} items`);
      setMerging(false);
      setSelected(new Set());
      setMergeTarget('');
      load();
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      showToast(msg ? `Merge failed — ${msg.slice(0, 80)}` : 'Merge failed', 'error');
    } finally { setBusy(false); }
  };

  const deleteTag = async (name: string) => {
    if (!confirm(`Remove tag "${name}" from every item that uses it? The items themselves stay safe.`)) return;
    setBusy(true);
    try {
      const r = await fetch(`/tags/${encodeURIComponent(name)}`, { method: 'DELETE' });
      if (!r.ok) throw new Error(await r.text().catch(() => `HTTP ${r.status}`));
      const j = await r.json();
      showToast(`Removed "${name}" from ${j.items_updated ?? 0} items`);
      load();
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      showToast(msg ? `Delete failed — ${msg.slice(0, 80)}` : 'Delete failed', 'error');
    } finally { setBusy(false); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '14px 0 28px', minHeight: 'calc(100vh - 5rem)' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', background: 'rgba(34,211,238,0.06)', border: '1px solid rgba(34,211,238,0.25)', borderRadius: 14 }}>
        <div style={{ width: 40, height: 40, borderRadius: 10, background: 'rgba(34,211,238,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <TagIcon size={20} color="#22d3ee" />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ color: 'var(--text-1)', fontSize: 14, fontWeight: 800 }}>Tag manager</div>
          <div style={{ color: 'var(--text-3)', fontSize: 11.5 }}>Rename, merge or remove tags across memories, notes and bookmarks in one shot.</div>
        </div>
        <div style={{ color: 'var(--text-3)', fontSize: 11, fontWeight: 700 }}>{tags.length} unique tag{tags.length === 1 ? '' : 's'}</div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: '1 1 240px', minWidth: 200 }}>
          <Search size={13} color="var(--text-3)" style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)' }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search tags..."
            style={{ width: '100%', padding: '9px 12px 9px 32px', borderRadius: 9, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-1)', fontSize: 12.5, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }} />
        </div>
        <button onClick={() => setMerging(true)} disabled={selected.size < 2}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px', background: selected.size >= 2 ? 'rgba(99,102,241,0.1)' : 'var(--surface-2)', border: `1px solid ${selected.size >= 2 ? 'rgba(99,102,241,0.35)' : 'var(--border)'}`, borderRadius: 9, color: selected.size >= 2 ? '#6366f1' : 'var(--text-3)', fontSize: 12, fontWeight: 700, cursor: selected.size >= 2 ? 'pointer' : 'not-allowed', fontFamily: 'inherit' }}>
          <GitMerge size={12} /> Merge {selected.size > 0 ? `(${selected.size})` : ''}
        </button>
        {selected.size > 0 && (
          <button onClick={() => setSelected(new Set())} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '8px 10px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 9, color: 'var(--text-3)', fontSize: 11.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
            <X size={11} /> Clear
          </button>
        )}
      </div>

      {/* Merge dialog */}
      {merging && (
        <motion.div initial={{ y: -6, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
          style={{ padding: '12px 14px', background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.3)', borderRadius: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <GitMerge size={14} color="#6366f1" />
            <span style={{ color: 'var(--text-1)', fontSize: 12.5, fontWeight: 800 }}>Merge {selected.size} tags into one</span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 10 }}>
            {Array.from(selected).map(s => (
              <span key={s} style={{ padding: '3px 9px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 11, color: 'var(--text-2)', fontSize: 11, fontWeight: 700 }}>#{s}</span>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ color: 'var(--text-3)', fontSize: 11.5, fontWeight: 700 }}>Combined as:</span>
            <input value={mergeTarget} onChange={e => setMergeTarget(e.target.value)} placeholder="new-tag"
              style={{ flex: '1 1 200px', minWidth: 160, padding: '7px 11px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-1)', fontSize: 12.5, outline: 'none', fontFamily: 'inherit' }} />
            <button onClick={mergeNow} disabled={!mergeTarget.trim() || busy}
              style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '7px 14px', background: mergeTarget.trim() ? 'linear-gradient(135deg,#6366f1,#4f46e5)' : 'var(--surface-2)', border: 'none', borderRadius: 8, color: mergeTarget.trim() ? '#fff' : 'var(--text-3)', fontSize: 12, fontWeight: 700, cursor: mergeTarget.trim() ? 'pointer' : 'not-allowed', fontFamily: 'inherit' }}>
              <Check size={12} /> Merge
            </button>
            <button onClick={() => setMerging(false)} style={{ padding: '7px 12px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-2)', fontSize: 11.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
          </div>
        </motion.div>
      )}

      {/* Rename dialog */}
      {renaming && (
        <motion.div initial={{ y: -6, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
          style={{ padding: '12px 14px', background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <Edit3 size={14} color="#f59e0b" />
            <span style={{ color: 'var(--text-1)', fontSize: 12.5, fontWeight: 800 }}>Rename tag</span>
            <span style={{ padding: '2px 8px', background: 'var(--surface-2)', borderRadius: 10, color: 'var(--text-3)', fontSize: 11, fontWeight: 700 }}>#{renaming.from}</span>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input value={renaming.to} onChange={e => setRenaming({ ...renaming, to: e.target.value })} placeholder="new-name" autoFocus
              onKeyDown={e => { if (e.key === 'Enter') rename(); if (e.key === 'Escape') setRenaming(null); }}
              style={{ flex: '1 1 200px', minWidth: 160, padding: '7px 11px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-1)', fontSize: 12.5, outline: 'none', fontFamily: 'inherit' }} />
            <button onClick={rename} disabled={!renaming.to.trim() || busy}
              style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '7px 14px', background: renaming.to.trim() ? 'linear-gradient(135deg,#f59e0b,#d97706)' : 'var(--surface-2)', border: 'none', borderRadius: 8, color: renaming.to.trim() ? '#fff' : 'var(--text-3)', fontSize: 12, fontWeight: 700, cursor: renaming.to.trim() ? 'pointer' : 'not-allowed', fontFamily: 'inherit' }}>
              <Check size={12} /> Rename
            </button>
            <button onClick={() => setRenaming(null)} style={{ padding: '7px 12px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-2)', fontSize: 11.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
          </div>
        </motion.div>
      )}

      {/* List */}
      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-3)' }}>Loading tags...</div>
      ) : filtered.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-3)', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14 }}>
          <TagIcon size={36} style={{ margin: '0 auto 10px', opacity: 0.4 }} />
          <p style={{ margin: 0, fontWeight: 700, fontSize: 13 }}>No tags found</p>
          <p style={{ margin: '4px 0 0', fontSize: 11.5 }}>Add some tags to your memories, notes or bookmarks first.</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 }}>
          {filtered.map(t => {
            const sel = selected.has(t.name);
            return (
              <div key={t.name}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 13px', background: sel ? 'var(--primary-bg)' : 'var(--surface)', border: `1px solid ${sel ? 'var(--primary-border)' : 'var(--border)'}`, borderRadius: 11 }}>
                <input type="checkbox" checked={sel} onChange={() => toggle(t.name)}
                  style={{ width: 14, height: 14, accentColor: '#22d3ee', cursor: 'pointer' }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: 'var(--text-1)', fontSize: 13, fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>#{t.name}</div>
                  <div style={{ display: 'flex', gap: 8, color: 'var(--text-3)', fontSize: 10.5, marginTop: 2 }}>
                    <span><strong style={{ color: 'var(--text-2)' }}>{t.total}</strong> total</span>
                    {t.memories > 0 && <span>· {t.memories} memor{t.memories === 1 ? 'y' : 'ies'}</span>}
                    {t.notes > 0 && <span>· {t.notes} note{t.notes === 1 ? '' : 's'}</span>}
                    {t.bookmarks > 0 && <span>· {t.bookmarks} bookmark{t.bookmarks === 1 ? '' : 's'}</span>}
                  </div>
                </div>
                <button onClick={() => setRenaming({ from: t.name, to: t.name })} title="Rename"
                  style={{ padding: 6, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 7, color: '#f59e0b', cursor: 'pointer', display: 'flex' }}>
                  <Edit3 size={11} />
                </button>
                <button onClick={() => deleteTag(t.name)} title="Remove tag from all items"
                  style={{ padding: 6, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 7, color: '#ef4444', cursor: 'pointer', display: 'flex' }}>
                  <Trash2 size={11} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default TagsManagerPage;
