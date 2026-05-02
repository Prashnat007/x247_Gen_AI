/**
 * RelatedChip — surface memories similar to the in-progress capture.
 * Lazy-fetches on first open so we don't burn a backend call until
 * the user actually wants to see related items. User can multi-select
 * with checkboxes; selection bubbles up as a list of memory IDs.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Loader2, Network, ExternalLink } from 'lucide-react';
import { fetchRelatedMemories } from '../../lib/api';
import type { RelatedMemoryHit } from '../../lib/types';

interface Props {
  text: string;
  tags?: string[];
  excludeId?: string;
  value: string[];
  onChange: (next: string[]) => void;
}

const RelatedChip: React.FC<Props> = ({ text, tags, excludeId, value, onChange }) => {
  const [items, setItems] = useState<RelatedMemoryHit[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    setLoading(true);
    fetchRelatedMemories(text, tags, excludeId, 5)
      .then(setItems)
      .catch(err => setError(String(err?.message || err)))
      .finally(() => setLoading(false));
  }, [text, tags, excludeId]);

  const toggle = (id: string) => {
    if (value.includes(id)) onChange(value.filter(x => x !== id));
    else onChange([...value, id]);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Network size={14} color="#a78bfa" />
        <span style={{ fontWeight: 700, fontSize: 12.5, color: 'var(--text-1)' }}>
          Related memories
        </span>
        {value.length > 0 && (
          <span style={{
            fontSize: 10.5, fontWeight: 600, padding: '2px 7px',
            borderRadius: 999, color: '#a78bfa',
            background: 'rgba(167,139,250,0.16)',
            border: '1px solid rgba(167,139,250,0.42)',
          }}>
            {value.length} selected
          </span>
        )}
      </header>

      {loading && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-2)', fontSize: 12 }}>
          <Loader2 size={13} className="spin" /> Searching your vault…
        </div>
      )}
      {error && (
        <div style={{ fontSize: 11.5, color: '#ef4444' }}>Couldn't load related: {error}</div>
      )}
      {!loading && !error && items && items.length === 0 && (
        <div style={{ fontSize: 12, color: 'var(--text-2)' }}>
          Nothing related yet. Capture more on this topic and they'll start linking up.
        </div>
      )}

      {!loading && !error && items && items.length > 0 && (
        <ul
          data-testid="list-related-hits"
          style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 0, listStyle: 'none', margin: 0 }}
        >
          {items.map(hit => {
            const checked = value.includes(hit.id);
            return (
              <li
                key={hit.id}
                style={{
                  display: 'flex', alignItems: 'flex-start', gap: 10,
                  padding: 10, borderRadius: 8,
                  background: checked ? 'rgba(167,139,250,0.10)' : 'var(--surface-1)',
                  border: `1px solid ${checked ? 'rgba(167,139,250,0.42)' : 'var(--border)'}`,
                }}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(hit.id)}
                  data-testid={`checkbox-related-${hit.id}`}
                  style={{ marginTop: 3, cursor: 'pointer' }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontWeight: 700, fontSize: 12.5, color: 'var(--text-1)' }}>
                      {hit.title}
                    </span>
                    <span style={{
                      fontSize: 10, fontWeight: 600, color: 'var(--text-2)',
                      padding: '1px 6px', borderRadius: 999,
                      background: 'var(--surface-2)',
                      border: '1px solid var(--border)',
                    }}>
                      {hit.reason}
                    </span>
                  </div>
                  {hit.snippet && (
                    <p style={{ fontSize: 11.5, color: 'var(--text-2)', margin: '4px 0 0', lineHeight: 1.5 }}>
                      {hit.snippet}
                    </p>
                  )}
                </div>
                <a
                  href={`/library?tab=vault&open=${hit.id}`}
                  target="_blank"
                  rel="noreferrer"
                  data-testid={`link-related-open-${hit.id}`}
                  aria-label="Open in vault"
                  style={{
                    color: 'var(--text-2)', display: 'flex',
                    alignItems: 'center', flexShrink: 0,
                  }}
                >
                  <ExternalLink size={13} />
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

export default RelatedChip;
