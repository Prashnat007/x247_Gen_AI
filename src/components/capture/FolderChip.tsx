/**
 * FolderChip — pick a destination workspace folder for the capture,
 * or create a new folder using the AI-suggested name.
 *
 * Shows a flat list of every folder across every project, sorted by
 * recent use, so the user's currently-active folder bubbles to the
 * top. AI-suggested name is pre-filled in the "Create new" input.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Loader2, Plus, FolderOpen, Check } from 'lucide-react';
import { fetchFlatFolders } from '../../lib/api';
import type { FlatFolder } from '../../lib/types';

/**
 * P1B: only the `existing` branch is wired all the way through to
 * /capture/save-bundle. New-folder creation needs a richer flow
 * (project picker, colour, sections) and lives on the Workspace
 * page until P1C.
 */
export type FolderState =
  | {
      kind: 'existing';
      project_id: string;
      folder_id: string;
      folder_name: string;
      project_name: string;
    };

interface Props {
  suggestedHint: string;
  value: FolderState | null;
  onChange: (next: FolderState | null) => void;
}

const FolderChip: React.FC<Props> = ({ suggestedHint, value, onChange }) => {
  const [folders, setFolders] = useState<FlatFolder[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');
  const [search, setSearch] = useState('');
  const [, setShowCreate] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchFlatFolders()
      .then(list => { if (!cancelled) setFolders(list); })
      .catch(err => { if (!cancelled) setError(String(err?.message || err)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // Filter the list by search OR by the AI hint (so the suggested
  // folder is visually highlighted at the top of an unfiltered list).
  const visible = useMemo(() => {
    const list = folders || [];
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter(f =>
      f.folder_name.toLowerCase().includes(q) ||
      f.project_name.toLowerCase().includes(q)
    );
  }, [folders, search]);

  const pickExisting = (f: FlatFolder) => {
    onChange({
      kind: 'existing',
      project_id: f.project_id,
      folder_id: f.folder_id,
      folder_name: f.folder_name,
      project_name: f.project_name,
    });
    setShowCreate(false);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <FolderOpen size={14} color="#22d3ee" />
        <span style={{ fontWeight: 700, fontSize: 12.5, color: 'var(--text-1)' }}>
          Where should this live?
        </span>
        {suggestedHint && (
          <span style={{
            fontSize: 10.5, fontWeight: 600, padding: '2px 7px',
            borderRadius: 999, color: '#a78bfa',
            background: 'rgba(167,139,250,0.12)',
            border: '1px solid rgba(167,139,250,0.32)',
          }}>
            AI: {suggestedHint}
          </span>
        )}
      </header>

      <input
        type="text"
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="Search folders…"
        data-testid="input-folder-search"
        style={{
          padding: '8px 10px', fontSize: 12.5, borderRadius: 8,
          background: 'var(--surface-1)', border: '1px solid var(--border)',
          color: 'var(--text-1)', fontFamily: 'inherit',
        }}
      />

      {loading && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-2)', fontSize: 12 }}>
          <Loader2 size={13} className="spin" /> Loading folders…
        </div>
      )}
      {error && (
        <div style={{ fontSize: 11.5, color: '#ef4444' }}>Couldn't load folders: {error}</div>
      )}

      {!loading && !error && visible.length > 0 && (
        <div
          data-testid="list-folder-options"
          style={{
            maxHeight: 220, overflowY: 'auto',
            display: 'flex', flexDirection: 'column', gap: 4,
            paddingRight: 2,
          }}
        >
          {visible.map(f => {
            const selected =
              value?.kind === 'existing' && value.folder_id === f.folder_id;
            return (
              <button
                key={`${f.project_id}:${f.folder_id}`}
                type="button"
                onClick={() => pickExisting(f)}
                data-testid={`option-folder-${f.folder_id}`}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '7px 10px', borderRadius: 8, cursor: 'pointer',
                  background: selected ? 'rgba(34,211,238,0.10)' : 'var(--surface-1)',
                  border: `1px solid ${selected ? 'rgba(34,211,238,0.45)' : 'var(--border)'}`,
                  color: 'var(--text-1)', fontFamily: 'inherit', fontSize: 12.5,
                  textAlign: 'left',
                }}
              >
                <span style={{
                  width: 8, height: 8, borderRadius: '50%',
                  background: f.color || '#22d3ee', flexShrink: 0,
                }} />
                <span style={{ fontWeight: 600 }}>{f.folder_name}</span>
                <span style={{ fontSize: 11, color: 'var(--text-2)', marginLeft: 'auto' }}>
                  {f.project_name}
                </span>
                {selected && <Check size={13} color="#22d3ee" />}
              </button>
            );
          })}
        </div>
      )}

      {!loading && !error && visible.length === 0 && (folders || []).length === 0 && (
        <div style={{ fontSize: 12, color: 'var(--text-2)' }}>
          No folders yet. Create your first one below.
        </div>
      )}
      {!loading && !error && visible.length === 0 && (folders || []).length > 0 && (
        <div style={{ fontSize: 12, color: 'var(--text-2)' }}>
          No matches. Try a different search or create a new folder.
        </div>
      )}

      {/* New-folder creation lives in the Workspace page (richer flow:
          colour, project, sections). Linking the user there keeps the
          Capture chip honest — the bundle save endpoint cannot create
          folders today, so confirming a "new" folder here would
          silently drop on save. Coming in P1C. */}
      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <a
          href="/workspace?new=folder"
          target="_blank"
          rel="noreferrer"
          data-testid="link-folder-create"
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '7px 10px', borderRadius: 8, textDecoration: 'none',
            background: 'transparent', border: '1px dashed var(--border)',
            color: 'var(--text-1)', fontFamily: 'inherit', fontSize: 12.5,
          }}
        >
          <Plus size={13} /> Create a new folder (opens Workspace)
        </a>

        {value?.kind === 'existing' && (
          <button
            type="button"
            onClick={() => { onChange(null); setShowCreate(false); }}
            data-testid="button-folder-clear"
            style={{
              alignSelf: 'flex-start', padding: '4px 8px', borderRadius: 6,
              background: 'transparent', border: '1px solid var(--border)',
              color: 'var(--text-2)', fontSize: 11, cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            Clear selection
          </button>
        )}
      </div>
    </div>
  );
};

export default FolderChip;
