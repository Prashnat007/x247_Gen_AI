import React, { useEffect, useMemo, useState } from 'react';
import { Trash2, RotateCcw, AlertTriangle, Database, StickyNote, Bookmark, Search, X, type LucideIcon } from 'lucide-react';
import { motion } from 'motion/react';
import { showToast } from '../App';

type Entity = 'memory' | 'note' | 'bookmark';

interface TrashItem {
  id: string;
  entity: Entity;
  title?: string;
  url?: string;
  domain?: string;
  trashed_at?: string;
  days_left?: number;
  tags?: string[];
}

interface TrashResponse {
  memories: TrashItem[];
  notes: TrashItem[];
  bookmarks: TrashItem[];
}

const ENTITY_META: Record<Entity, { label: string; icon: LucideIcon; color: string }> = {
  memory: { label: 'Memory', icon: Database, color: '#a78bfa' },
  note: { label: 'Note', icon: StickyNote, color: '#f59e0b' },
  bookmark: { label: 'Bookmark', icon: Bookmark, color: '#ec4899' },
};

const TrashPage: React.FC = () => {
  const [data, setData] = useState<TrashResponse>({ memories: [], notes: [], bookmarks: [] });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterEntity, setFilterEntity] = useState<'all' | Entity>('all');
  const [selected, setSelected] = useState<Record<string, Set<string>>>({ memory: new Set(), note: new Set(), bookmark: new Set() });
  const [busy, setBusy] = useState(false);

  const load = () => {
    setLoading(true);
    fetch('/trash')
      .then(r => r.ok ? r.json() : null)
      .then((d: unknown) => {
        const safe = d && typeof d === 'object' && !Array.isArray(d) ? d as TrashResponse : null;
        setData(safe || { memories: [], notes: [], bookmarks: [] });
        setLoading(false);
      }).catch(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const all: TrashItem[] = useMemo(() => {
    const merged = [
      ...(data.memories || []).map(x => ({ ...x, entity: 'memory' as Entity })),
      ...(data.notes || []).map(x => ({ ...x, entity: 'note' as Entity })),
      ...(data.bookmarks || []).map(x => ({ ...x, entity: 'bookmark' as Entity })),
    ];
    return merged.sort((a, b) => String(b.trashed_at || '').localeCompare(String(a.trashed_at || '')));
  }, [data]);

  const filtered = useMemo(() => {
    return all.filter(it => {
      if (filterEntity !== 'all' && it.entity !== filterEntity) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!(it.title || '').toLowerCase().includes(q) && !(it.url || '').toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [all, search, filterEntity]);

  const toggle = (entity: Entity, id: string) => {
    setSelected(prev => {
      const next = { ...prev };
      const s = new Set(next[entity]);
      if (s.has(id)) s.delete(id); else s.add(id);
      next[entity] = s;
      return next;
    });
  };

  const totalSelected = (selected.memory.size + selected.note.size + selected.bookmark.size);

  const selectAll = () => {
    const next = { memory: new Set<string>(), note: new Set<string>(), bookmark: new Set<string>() };
    filtered.forEach(it => next[it.entity].add(it.id));
    setSelected(next);
  };

  const clearSel = () => setSelected({ memory: new Set(), note: new Set(), bookmark: new Set() });

  const callBulk = async (path: 'restore' | 'purge') => {
    const entities: Entity[] = ['memory', 'note', 'bookmark'];
    setBusy(true);
    let total = 0;
    const failed: Entity[] = [];
    try {
      for (const e of entities) {
        const ids = Array.from(selected[e]);
        if (!ids.length) continue;
        try {
          const r = await fetch(`/trash/${path}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ entity: e, ids }),
          });
          if (!r.ok) { failed.push(e); continue; }
          const j = await r.json().catch(() => ({}));
          total += (j.restored ?? j.purged ?? 0);
        } catch {
          failed.push(e);
        }
      }
      if (failed.length) {
        const verb = path === 'restore' ? 'Restore' : 'Delete';
        const labels = failed.map(e => ENTITY_META[e].label.toLowerCase()).join(', ');
        showToast(`${verb} failed for ${labels}${total ? ` — ${total} other item${total === 1 ? '' : 's'} succeeded` : ''}`, 'error');
      } else {
        showToast(path === 'restore' ? `Restored ${total} item${total === 1 ? '' : 's'}` : `Deleted ${total} item${total === 1 ? '' : 's'} forever`);
      }
      clearSel();
      load();
    } finally { setBusy(false); }
  };

  const purge = async () => {
    if (!totalSelected) return;
    if (!confirm(`Permanently delete ${totalSelected} item${totalSelected === 1 ? '' : 's'}? This cannot be undone.`)) return;
    callBulk('purge');
  };

  const counts = {
    all: all.length,
    memory: data.memories?.length || 0,
    note: data.notes?.length || 0,
    bookmark: data.bookmarks?.length || 0,
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '14px 0 28px', minHeight: 'calc(100vh - 5rem)' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 14 }}>
        <div style={{ width: 40, height: 40, borderRadius: 10, background: 'rgba(239,68,68,0.18)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Trash2 size={20} color="#ef4444" />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ color: 'var(--text-1)', fontSize: 14, fontWeight: 800 }}>Trash</div>
          <div style={{ color: 'var(--text-3)', fontSize: 11.5 }}>Items here are kept for 30 days, then deleted forever. Restore anything you want to keep.</div>
        </div>
        <div style={{ color: 'var(--text-3)', fontSize: 11, fontWeight: 700 }}>{counts.all} item{counts.all === 1 ? '' : 's'}</div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: '1 1 240px', minWidth: 200 }}>
          <Search size={13} color="var(--text-3)" style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)' }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search trashed items..."
            style={{ width: '100%', padding: '9px 12px 9px 32px', borderRadius: 9, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-1)', fontSize: 12.5, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }} />
        </div>
        {(['all', 'memory', 'note', 'bookmark'] as const).map(t => (
          <button key={t} onClick={() => setFilterEntity(t)}
            style={{ padding: '7px 12px', background: filterEntity === t ? 'var(--primary-bg)' : 'transparent', border: `1px solid ${filterEntity === t ? 'var(--primary-border)' : 'var(--border)'}`, borderRadius: 9, color: filterEntity === t ? 'var(--primary)' : 'var(--text-2)', fontSize: 11.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', textTransform: 'capitalize' }}>
            {t === 'all' ? `All (${counts.all})` : `${t}s (${counts[t]})`}
          </button>
        ))}
      </div>

      {/* Action bar */}
      {totalSelected > 0 && (
        <motion.div initial={{ y: -6, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
          style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '10px 14px', background: 'var(--surface)', border: '1px solid var(--primary-border)', borderRadius: 12, position: 'sticky', top: 6, zIndex: 5 }}>
          <span style={{ color: 'var(--primary)', fontSize: 12.5, fontWeight: 800 }}>{totalSelected} selected</span>
          <span style={{ flex: 1 }} />
          <button onClick={() => callBulk('restore')} disabled={busy}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px', background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.35)', borderRadius: 9, color: '#10b981', fontSize: 12, fontWeight: 700, cursor: busy ? 'wait' : 'pointer', fontFamily: 'inherit' }}>
            <RotateCcw size={12} /> Restore
          </button>
          <button onClick={purge} disabled={busy}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.35)', borderRadius: 9, color: '#ef4444', fontSize: 12, fontWeight: 700, cursor: busy ? 'wait' : 'pointer', fontFamily: 'inherit' }}>
            <Trash2 size={12} /> Delete forever
          </button>
          <button onClick={clearSel} title="Clear selection"
            style={{ padding: 7, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-3)', cursor: 'pointer' }}>
            <X size={12} />
          </button>
        </motion.div>
      )}

      {/* List */}
      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-3)' }}>Loading trash...</div>
      ) : filtered.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-3)', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14 }}>
          <Trash2 size={36} style={{ margin: '0 auto 10px', opacity: 0.4 }} />
          <p style={{ margin: 0, fontWeight: 700, fontSize: 13 }}>Your trash is empty</p>
          <p style={{ margin: '4px 0 0', fontSize: 11.5 }}>Items you delete will appear here for 30 days before being removed permanently.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 4px 6px' }}>
            <button onClick={selectAll} style={{ background: 'transparent', border: 'none', color: 'var(--text-3)', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>
              Select all ({filtered.length})
            </button>
          </div>
          {filtered.map(it => {
            const meta = ENTITY_META[it.entity];
            const Icon = meta.icon;
            const sel = selected[it.entity].has(it.id);
            const lowDays = (it.days_left ?? 30) <= 7;
            return (
              <div key={`${it.entity}:${it.id}`}
                onClick={() => toggle(it.entity, it.id)}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: sel ? 'var(--primary-bg)' : 'var(--surface)', border: `1px solid ${sel ? 'var(--primary-border)' : 'var(--border)'}`, borderRadius: 11, cursor: 'pointer' }}>
                <input type="checkbox" checked={sel} onChange={() => toggle(it.entity, it.id)} onClick={e => e.stopPropagation()}
                  style={{ width: 14, height: 14, accentColor: '#22d3ee', cursor: 'pointer' }} />
                <div style={{ width: 30, height: 30, borderRadius: 8, background: `${meta.color}18`, border: `1px solid ${meta.color}30`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Icon size={14} color={meta.color} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: 'var(--text-1)', fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {it.title || it.url || '(untitled)'}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-3)', fontSize: 10.5, marginTop: 2 }}>
                    <span style={{ color: meta.color, fontWeight: 700 }}>{meta.label}</span>
                    {it.domain && <><span>·</span><span>{it.domain}</span></>}
                    {it.trashed_at && <><span>·</span><span>Trashed {new Date(it.trashed_at).toLocaleDateString()}</span></>}
                  </div>
                </div>
                <div title={lowDays ? 'About to be deleted forever' : 'Days remaining before purge'}
                  style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '3px 9px', background: lowDays ? 'rgba(239,68,68,0.1)' : 'var(--surface-2)', border: `1px solid ${lowDays ? 'rgba(239,68,68,0.3)' : 'var(--border)'}`, borderRadius: 12, color: lowDays ? '#ef4444' : 'var(--text-3)', fontSize: 10.5, fontWeight: 700 }}>
                  {lowDays && <AlertTriangle size={10} />} {it.days_left ?? 30}d left
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default TrashPage;
