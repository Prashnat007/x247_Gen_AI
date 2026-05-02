/**
 * HabitChip — link this capture to an existing habit (or note that a
 * new habit should be created later from the Focus page). The AI
 * proposes a habit_id only when the content clearly maps to one of
 * the user's existing habits, so most captures will see "no AI
 * suggestion" and the user picks manually if they want.
 *
 * NOTE: We intentionally don't create new habits inline — habits have
 * a richer setup flow (icon, color, goal cadence) that lives on the
 * Focus page. Picking "Create new habit" here just records the
 * intention so a later UI can prompt for it.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Loader2, Flame, Plus } from 'lucide-react';
import { fetchHabits, type HabitOption } from '../../lib/api';
import type { SuggestedHabitLink } from '../../lib/types';

export interface HabitState {
  habit_id: string;
  habit_name: string;
}

interface Props {
  suggested: SuggestedHabitLink | null;
  value: HabitState | null;
  onChange: (next: HabitState | null) => void;
}

const HabitChip: React.FC<Props> = ({ suggested, value, onChange }) => {
  const [habits, setHabits] = useState<HabitOption[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchHabits()
      .then(list => { if (!cancelled) setHabits(list); })
      .catch(err => { if (!cancelled) setError(String(err?.message || err)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // Auto-apply the AI suggestion ONCE if it matches an existing habit
  // and the user hasn't picked anything yet. dismissedRef prevents
  // re-applying after the user explicitly hits "Clear", which would
  // otherwise make the clear button feel broken.
  const dismissedRef = useRef(false);
  useEffect(() => {
    if (value || dismissedRef.current || !suggested?.habit_id || !habits) return;
    const match = habits.find(h => h.id === suggested.habit_id);
    if (match) {
      onChange({ habit_id: match.id, habit_name: match.name });
    }
  }, [suggested, habits, value, onChange]);

  const clearSelection = () => {
    dismissedRef.current = true;
    onChange(null);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Flame size={14} color="#f59e0b" />
        <span style={{ fontWeight: 700, fontSize: 12.5, color: 'var(--text-1)' }}>
          Link to a habit
        </span>
        {suggested?.reason && (
          <span style={{
            fontSize: 10.5, fontWeight: 600, padding: '2px 7px',
            borderRadius: 999, color: '#a78bfa',
            background: 'rgba(167,139,250,0.12)',
            border: '1px solid rgba(167,139,250,0.32)',
          }}>
            AI: {suggested.reason}
          </span>
        )}
      </header>

      {loading && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-2)', fontSize: 12 }}>
          <Loader2 size={13} className="spin" /> Loading habits…
        </div>
      )}
      {error && (
        <div style={{ fontSize: 11.5, color: '#ef4444' }}>Couldn't load habits: {error}</div>
      )}

      {!loading && !error && habits && habits.length === 0 && (
        <div style={{ fontSize: 12, color: 'var(--text-2)' }}>
          You don't have any habits yet — create one from the Focus page first.
        </div>
      )}

      {!loading && !error && habits && habits.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 220, overflowY: 'auto' }}>
          {habits.map(h => {
            const selected = value?.habit_id === h.id;
            return (
              <button
                key={h.id}
                type="button"
                onClick={() => onChange({ habit_id: h.id, habit_name: h.name })}
                data-testid={`option-habit-${h.id}`}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '7px 10px', borderRadius: 8, cursor: 'pointer',
                  background: selected ? 'rgba(245,158,11,0.10)' : 'var(--surface-1)',
                  border: `1px solid ${selected ? 'rgba(245,158,11,0.45)' : 'var(--border)'}`,
                  color: 'var(--text-1)', fontFamily: 'inherit', fontSize: 12.5,
                  textAlign: 'left',
                }}
              >
                <span style={{
                  width: 8, height: 8, borderRadius: '50%',
                  background: h.color || '#f59e0b', flexShrink: 0,
                }} />
                <span style={{ fontWeight: 600 }}>{h.name}</span>
              </button>
            );
          })}
        </div>
      )}

      <a
        href="/focus?new=habit"
        target="_blank"
        rel="noreferrer"
        data-testid="link-habit-create"
        style={{
          alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: 6,
          padding: '7px 10px', borderRadius: 8, textDecoration: 'none',
          background: 'transparent', border: '1px dashed var(--border)',
          color: 'var(--text-1)', fontWeight: 600, fontSize: 12,
        }}
      >
        <Plus size={13} /> Create a new habit (opens Focus page)
      </a>

      {value && (
        <button
          type="button"
          onClick={clearSelection}
          data-testid="button-habit-clear"
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
  );
};

export default HabitChip;
