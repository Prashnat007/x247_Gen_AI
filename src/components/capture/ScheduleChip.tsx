/**
 * ScheduleChip — accept / edit a single calendar event suggestion.
 * Pre-fills from the AI's suggested event when present, otherwise
 * from the memory title with sensible defaults (today, 9 AM, 30 min).
 *
 * NOTE: P1 backend `/capture/save-bundle` accepts ONE event per save.
 * Multi-event support is tracked as a follow-up — the UI intentionally
 * exposes a single event so we don't silently drop user input.
 */
import React, { useEffect, useRef } from 'react';
import { Plus, X, CalendarPlus } from 'lucide-react';
import type { SuggestedEvent } from '../../lib/types';

export interface ScheduleEvent {
  title: string;
  date: string;
  time: string;
  duration_minutes: number;
}

interface Props {
  suggested: SuggestedEvent | null;
  defaultTitle: string;
  value: ScheduleEvent | null;
  onChange: (next: ScheduleEvent | null) => void;
}

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const ScheduleChip: React.FC<Props> = ({ suggested, defaultTitle, value, onChange }) => {
  // Seed once from the AI suggestion if the user hasn't created an
  // event yet. After that, respect their edits. Per-preview remount
  // (via `key` in the parent) gives us a fresh seedRef each capture.
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current) return;
    seededRef.current = true;
    if (!value && suggested) {
      onChange({
        title: suggested.title,
        date: suggested.date || todayIso(),
        time: suggested.time || '09:00',
        duration_minutes: suggested.duration_minutes || 30,
      });
    }
  }, [suggested, value, onChange]);

  const update = (patch: Partial<ScheduleEvent>) => {
    if (!value) return;
    onChange({ ...value, ...patch });
  };

  const create = () => {
    onChange({
      title: defaultTitle || 'New event',
      date: todayIso(),
      time: '09:00',
      duration_minutes: 30,
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <CalendarPlus size={14} color="#3b82f6" />
        <span style={{ fontWeight: 700, fontSize: 12.5, color: 'var(--text-1)' }}>
          Schedule on calendar
        </span>
        {suggested && (
          <span style={{
            fontSize: 10.5, fontWeight: 600, padding: '2px 7px',
            borderRadius: 999, color: '#a78bfa',
            background: 'rgba(167,139,250,0.12)',
            border: '1px solid rgba(167,139,250,0.32)',
          }}>
            AI suggested
          </span>
        )}
      </header>

      {!value && (
        <button
          type="button"
          onClick={create}
          data-testid="button-event-add-first"
          style={{
            alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: 6,
            padding: '7px 12px', borderRadius: 8,
            background: 'rgba(59,130,246,0.10)',
            border: '1px solid rgba(59,130,246,0.32)',
            color: '#3b82f6', fontWeight: 700, fontSize: 12,
            cursor: 'pointer', fontFamily: 'inherit',
          }}
        >
          {/* Empty-state CTA differs by intent: "Add event" reads naturally
              when the AI surfaced a date/time worth keeping, while
              "Schedule reminder" sets clearer expectations when there's
              no AI pre-fill to accept. */}
          <Plus size={13} /> {suggested ? 'Add event' : 'Schedule reminder'}
        </button>
      )}

      {value && (
        <div
          data-testid="event-row-0"
          style={{
            display: 'flex', flexDirection: 'column', gap: 6,
            padding: 10, borderRadius: 8,
            background: 'var(--surface-1)',
            border: '1px solid var(--border)',
          }}
        >
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input
              type="text"
              value={value.title}
              onChange={e => update({ title: e.target.value })}
              placeholder="Event title"
              data-testid="input-event-title-0"
              style={{
                flex: 1, padding: '6px 8px', fontSize: 12.5, borderRadius: 6,
                background: 'transparent', border: '1px solid var(--border)',
                color: 'var(--text-1)', fontFamily: 'inherit',
              }}
            />
            <button
              type="button"
              onClick={() => onChange(null)}
              data-testid="button-event-remove-0"
              aria-label="Remove event"
              style={{
                padding: 6, borderRadius: 6, cursor: 'pointer',
                background: 'transparent', border: '1px solid var(--border)',
                color: '#ef4444', display: 'flex', alignItems: 'center',
              }}
            >
              <X size={13} />
            </button>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              type="date"
              value={value.date}
              onChange={e => update({ date: e.target.value })}
              data-testid="input-event-date-0"
              style={{
                flex: 1, padding: '6px 8px', fontSize: 12, borderRadius: 6,
                background: 'var(--surface-2)', border: '1px solid var(--border)',
                color: 'var(--text-1)', fontFamily: 'inherit',
                colorScheme: 'dark',
              }}
            />
            <input
              type="time"
              value={value.time}
              onChange={e => update({ time: e.target.value })}
              data-testid="input-event-time-0"
              style={{
                flex: 1, padding: '6px 8px', fontSize: 12, borderRadius: 6,
                background: 'var(--surface-2)', border: '1px solid var(--border)',
                color: 'var(--text-1)', fontFamily: 'inherit',
                colorScheme: 'dark',
              }}
            />
            <input
              type="number"
              min={5}
              max={480}
              step={5}
              value={value.duration_minutes}
              onChange={e => update({ duration_minutes: Math.max(5, Math.min(480, Number(e.target.value) || 30)) })}
              data-testid="input-event-duration-0"
              style={{
                width: 80, padding: '6px 8px', fontSize: 12, borderRadius: 6,
                background: 'var(--surface-2)', border: '1px solid var(--border)',
                color: 'var(--text-1)', fontFamily: 'inherit',
              }}
            />
            <span style={{ alignSelf: 'center', fontSize: 11, color: 'var(--text-2)' }}>min</span>
          </div>
          <p style={{ margin: 0, fontSize: 10.5, color: 'var(--text-2)', fontStyle: 'italic' }}>
            One event per save — capture again for follow-ups.
          </p>
        </div>
      )}
    </div>
  );
};

export default ScheduleChip;
