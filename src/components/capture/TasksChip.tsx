/**
 * TasksChip — accept / edit AI-suggested follow-up tasks. The user
 * can rewrite titles, set priority, optionally pick a due date, and
 * add or remove rows. On first open the AI's suggested tasks pre-fill
 * the rows so accepting the AI proposal is one click.
 */
import React, { useEffect, useRef } from 'react';
import { Plus, Trash2, ListChecks } from 'lucide-react';
import type { SuggestedTask } from '../../lib/types';

export interface TaskRow {
  title: string;
  priority: 'low' | 'medium' | 'high';
  due_date?: string;
}

interface Props {
  suggested: SuggestedTask[];
  value: TaskRow[];
  onChange: (next: TaskRow[]) => void;
}

const PRIORITIES: TaskRow['priority'][] = ['low', 'medium', 'high'];

const TasksChip: React.FC<Props> = ({ suggested, value, onChange }) => {
  // Pre-fill from the AI's suggestions ONCE if the user hasn't picked
  // anything yet. Subsequent renders respect the user's edits.
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current) return;
    if (value.length === 0 && suggested.length > 0) {
      onChange(suggested.map(s => ({
        title: s.title,
        priority: (s.priority as TaskRow['priority']) || 'medium',
      })));
    }
    seededRef.current = true;
  }, [suggested, value.length, onChange]);

  const updateRow = (i: number, patch: Partial<TaskRow>) => {
    onChange(value.map((row, idx) => idx === i ? { ...row, ...patch } : row));
  };
  const removeRow = (i: number) => {
    onChange(value.filter((_, idx) => idx !== i));
  };
  const addRow = () => {
    onChange([...value, { title: '', priority: 'medium' }]);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <ListChecks size={14} color="#10b981" />
        <span style={{ fontWeight: 700, fontSize: 12.5, color: 'var(--text-1)' }}>
          Follow-up tasks
        </span>
        {suggested.length > 0 && (
          <span style={{
            fontSize: 10.5, fontWeight: 600, padding: '2px 7px',
            borderRadius: 999, color: '#a78bfa',
            background: 'rgba(167,139,250,0.12)',
            border: '1px solid rgba(167,139,250,0.32)',
          }}>
            AI suggested {suggested.length}
          </span>
        )}
      </header>

      {value.length === 0 && (
        <div style={{ fontSize: 12, color: 'var(--text-2)' }}>
          No tasks yet — click "Add task" to start.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {value.map((row, i) => (
          <div
            key={i}
            data-testid={`task-row-${i}`}
            style={{
              display: 'flex', gap: 6, alignItems: 'center',
              padding: 8, borderRadius: 8,
              background: 'var(--surface-1)',
              border: '1px solid var(--border)',
            }}
          >
            <input
              type="text"
              value={row.title}
              onChange={e => updateRow(i, { title: e.target.value })}
              placeholder="What needs to happen?"
              data-testid={`input-task-title-${i}`}
              style={{
                flex: 1, padding: '6px 8px', fontSize: 12.5, borderRadius: 6,
                background: 'transparent', border: '1px solid var(--border)',
                color: 'var(--text-1)', fontFamily: 'inherit',
              }}
            />
            <select
              value={row.priority}
              onChange={e => updateRow(i, { priority: e.target.value as TaskRow['priority'] })}
              data-testid={`select-task-priority-${i}`}
              style={{
                padding: '6px 8px', fontSize: 12, borderRadius: 6,
                background: 'var(--surface-2)', border: '1px solid var(--border)',
                color: 'var(--text-1)', fontFamily: 'inherit',
              }}
            >
              {PRIORITIES.map(p => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
            <input
              type="date"
              value={row.due_date || ''}
              onChange={e => updateRow(i, { due_date: e.target.value })}
              data-testid={`input-task-due-${i}`}
              style={{
                padding: '6px 8px', fontSize: 12, borderRadius: 6,
                background: 'var(--surface-2)', border: '1px solid var(--border)',
                color: 'var(--text-1)', fontFamily: 'inherit',
                colorScheme: 'dark',
              }}
            />
            <button
              type="button"
              onClick={() => removeRow(i)}
              data-testid={`button-task-remove-${i}`}
              aria-label="Remove task"
              style={{
                padding: 6, borderRadius: 6, cursor: 'pointer',
                background: 'transparent', border: '1px solid var(--border)',
                color: '#ef4444', display: 'flex', alignItems: 'center',
              }}
            >
              <Trash2 size={13} />
            </button>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={addRow}
        data-testid="button-task-add"
        style={{
          alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: 6,
          padding: '7px 12px', borderRadius: 8,
          background: 'rgba(16,185,129,0.10)',
          border: '1px solid rgba(16,185,129,0.32)',
          color: '#10b981', fontWeight: 700, fontSize: 12,
          cursor: 'pointer', fontFamily: 'inherit',
        }}
      >
        <Plus size={13} /> Add task
      </button>
    </div>
  );
};

export default TasksChip;
