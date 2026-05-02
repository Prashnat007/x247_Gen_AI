import React from 'react';
import { LayoutGrid, List as ListIcon, Rows2, Rows3 } from 'lucide-react';

export type ViewMode = 'grid' | 'list';
export type Density = 'comfortable' | 'compact';

// Legacy keys: prior versions stored a single global view+density preference
// shared across the standalone /vault page and both Library tabs. We keep
// reading them as a one-time fallback so users don't lose their choice when
// per-surface keys are introduced (and likewise for Notes / Bookmarks now
// that they get the same toggle).
const LEGACY_VIEW_KEY = 'recall:vault:viewMode';
const LEGACY_DENSITY_KEY = 'recall:vault:density';

export const loadViewMode = (key: string): ViewMode => {
  try {
    const v = localStorage.getItem(key);
    if (v === 'list' || v === 'grid') return v;
    const legacy = localStorage.getItem(LEGACY_VIEW_KEY);
    if (legacy === 'list' || legacy === 'grid') {
      try { localStorage.setItem(key, legacy); } catch { /* ignore */ }
      return legacy;
    }
    return 'grid';
  } catch { return 'grid'; }
};

export const loadDensity = (key: string): Density => {
  try {
    const v = localStorage.getItem(key);
    if (v === 'comfortable' || v === 'compact') return v;
    const legacy = localStorage.getItem(LEGACY_DENSITY_KEY);
    if (legacy === 'comfortable' || legacy === 'compact') {
      try { localStorage.setItem(key, legacy); } catch { /* ignore */ }
      return legacy;
    }
    return 'comfortable';
  } catch { return 'comfortable'; }
};

/**
 * Persist view mode + density to localStorage under
 * `${storageKey}:viewMode` / `${storageKey}:density`. Reusable by every
 * surface (Vault, Notes, Bookmarks, Library tabs) so each remembers its
 * own choice while sharing the same component + behavior.
 */
export const useViewModePref = (storageKey: string) => {
  const viewKey = `${storageKey}:viewMode`;
  const densityKey = `${storageKey}:density`;
  const [viewMode, setViewMode] = React.useState<ViewMode>(() => loadViewMode(viewKey));
  const [density, setDensity] = React.useState<Density>(() => loadDensity(densityKey));
  React.useEffect(() => { try { localStorage.setItem(viewKey, viewMode); } catch { /* ignore */ } }, [viewMode, viewKey]);
  React.useEffect(() => { try { localStorage.setItem(densityKey, density); } catch { /* ignore */ } }, [density, densityKey]);
  return { viewMode, setViewMode, density, setDensity };
};

interface Props {
  viewMode: ViewMode;
  onViewMode: (v: ViewMode) => void;
  density: Density;
  onDensity: (d: Density) => void;
  /** Hide density control when in list mode (since list has its own density). Default true. */
  hideDensityInList?: boolean;
  testIdPrefix?: string;
}

const ViewModeToggle: React.FC<Props> = ({
  viewMode, onViewMode, density, onDensity,
  hideDensityInList = true, testIdPrefix = '',
}) => {
  const segStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 2, padding: 3,
    background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 9,
  };
  const btnBase: React.CSSProperties = {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    width: 28, height: 26, borderRadius: 6, border: 'none',
    background: 'transparent', cursor: 'pointer', color: 'var(--text-3)',
    transition: 'all 0.15s', fontFamily: 'inherit',
  };
  const buttonStyle = (on: boolean): React.CSSProperties => on
    ? { ...btnBase, background: 'var(--surface)', color: 'var(--primary)', boxShadow: 'var(--shadow-sm)' }
    : btnBase;

  const tid = (s: string) => testIdPrefix ? `${testIdPrefix}-${s}` : s;

  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      <div role="group" aria-label="View mode" style={segStyle}>
        <button
          data-testid={tid('view-grid')}
          title="Grid view"
          aria-label="Grid view"
          aria-pressed={viewMode === 'grid'}
          onClick={() => onViewMode('grid')}
          style={buttonStyle(viewMode === 'grid')}
        >
          <LayoutGrid size={14} strokeWidth={1.75} />
        </button>
        <button
          data-testid={tid('view-list')}
          title="List view"
          aria-label="List view"
          aria-pressed={viewMode === 'list'}
          onClick={() => onViewMode('list')}
          style={buttonStyle(viewMode === 'list')}
        >
          <ListIcon size={14} strokeWidth={1.75} />
        </button>
      </div>
      {(viewMode === 'grid' || !hideDensityInList) && (
        <div role="group" aria-label="Density" style={segStyle}>
          <button
            data-testid={tid('density-comfortable')}
            title="Comfortable"
            aria-label="Comfortable density"
            aria-pressed={density === 'comfortable'}
            onClick={() => onDensity('comfortable')}
            style={buttonStyle(density === 'comfortable')}
          >
            <Rows2 size={14} strokeWidth={1.75} />
          </button>
          <button
            data-testid={tid('density-compact')}
            title="Compact"
            aria-label="Compact density"
            aria-pressed={density === 'compact'}
            onClick={() => onDensity('compact')}
            style={buttonStyle(density === 'compact')}
          >
            <Rows3 size={14} strokeWidth={1.75} />
          </button>
        </div>
      )}
    </div>
  );
};

export default ViewModeToggle;
