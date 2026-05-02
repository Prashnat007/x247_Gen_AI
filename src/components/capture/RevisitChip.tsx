/**
 * RevisitChip — schedule a spaced-repetition revisit for this capture
 * so the Briefing nudges the user to re-read it later. Default
 * frequency is the AI's suggestion when present, otherwise "weekly".
 */
import React, { useEffect, useRef } from 'react';
import { Bell } from 'lucide-react';
import type { SuggestedRevisit } from '../../lib/types';

export interface RevisitState {
  frequency: 'once' | 'daily' | 'weekly' | 'monthly';
  next_due?: string;
}

interface Props {
  suggested: SuggestedRevisit | null;
  value: RevisitState | null;
  onChange: (next: RevisitState | null) => void;
}

const FREQS: RevisitState['frequency'][] = ['once', 'daily', 'weekly', 'monthly'];

const RevisitChip: React.FC<Props> = ({ suggested, value, onChange }) => {
  // Seed once from the AI suggestion if the user hasn't picked yet.
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current) return;
    seededRef.current = true;
    if (!value && suggested) {
      onChange({
        frequency: suggested.frequency,
        next_due: suggested.next_due || '',
      });
    }
  }, [suggested, value, onChange]);

  const enable = (freq: RevisitState['frequency']) => {
    onChange({
      frequency: freq,
      next_due: value?.next_due || suggested?.next_due || '',
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Bell size={14} color="#fb7185" />
        <span style={{ fontWeight: 700, fontSize: 12.5, color: 'var(--text-1)' }}>
          Revisit cadence
        </span>
        {suggested && (
          <span style={{
            fontSize: 10.5, fontWeight: 600, padding: '2px 7px',
            borderRadius: 999, color: '#a78bfa',
            background: 'rgba(167,139,250,0.12)',
            border: '1px solid rgba(167,139,250,0.32)',
          }}>
            AI: {suggested.frequency}
          </span>
        )}
      </header>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {FREQS.map(f => {
          const selected = value?.frequency === f;
          return (
            <button
              key={f}
              type="button"
              onClick={() => enable(f)}
              data-testid={`button-revisit-${f}`}
              style={{
                padding: '6px 12px', borderRadius: 999, cursor: 'pointer',
                background: selected ? 'rgba(251,113,133,0.12)' : 'var(--surface-1)',
                border: `1px solid ${selected ? 'rgba(251,113,133,0.45)' : 'var(--border)'}`,
                color: selected ? '#fb7185' : 'var(--text-1)',
                fontFamily: 'inherit', fontSize: 12, fontWeight: 700,
                textTransform: 'capitalize',
              }}
            >
              {f}
            </button>
          );
        })}
      </div>

      {value && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <label style={{ fontSize: 12, color: 'var(--text-2)' }}>
            Next due:
          </label>
          <input
            type="date"
            value={value.next_due || ''}
            onChange={e => onChange({ ...value, next_due: e.target.value })}
            data-testid="input-revisit-due"
            style={{
              padding: '6px 8px', fontSize: 12, borderRadius: 6,
              background: 'var(--surface-2)', border: '1px solid var(--border)',
              color: 'var(--text-1)', fontFamily: 'inherit',
              colorScheme: 'dark',
            }}
          />
          <button
            type="button"
            onClick={() => onChange(null)}
            data-testid="button-revisit-clear"
            style={{
              marginLeft: 'auto', padding: '4px 8px', borderRadius: 6,
              background: 'transparent', border: '1px solid var(--border)',
              color: 'var(--text-2)', fontSize: 11, cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            Clear
          </button>
        </div>
      )}
    </div>
  );
};

export default RevisitChip;
