import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Database, CheckSquare, Calendar as CalendarIcon, Search, Sparkles, BarChart3, ArrowRight, FileText, Clock } from 'lucide-react';
import type { AgentStepData, NavPreviewItem } from '../lib/types';

interface Props {
  steps: AgentStepData[];
}

interface CardSpec {
  agent: string;
  color: string;
  icon: any;
  label: string;
  summary: string;
  navTo: string;
  navLabel: string;
  preview?: NavPreviewItem[];
}

// Every agent that has a corresponding page surfaces a "go to that page" card
// inline in chat — so the user can act on the result with one click.
// Exported so other UI (e.g. AgentPage's completion-summary drill-down panel)
// can reuse the same per-agent icon/color palette and stay visually consistent.
export const ROUTE_MAP: Record<string, { route: string; label: string; icon: any; color: string; label2: string }> = {
  CaptureAgent:   { route: '/vault',     label: 'Memory saved',      label2: 'Open in Vault',   icon: Database,     color: '#f43f5e' },
  TaskAgent:      { route: '/tasks',     label: 'Task created',      label2: 'Open Tasks',      icon: CheckSquare,  color: '#10b981' },
  CalendarAgent:  { route: '/calendar',  label: 'Event scheduled',   label2: 'Open Calendar',   icon: CalendarIcon, color: '#f59e0b' },
  RecallAgent:    { route: '/recall',    label: 'Memories recalled', label2: 'Open Recall',     icon: Search,       color: '#8b5cf6' },
  BriefingAgent:  { route: '/dashboard', label: 'Briefing ready',    label2: 'Open Dashboard',  icon: Sparkles,     color: '#06b6d4' },
  AnalyticsAgent: { route: '/analytics', label: 'Insights ready',    label2: 'Open Analytics',  icon: BarChart3,    color: '#3b82f6' },
};

// Per-tool override of the action card label. Used to differentiate list
// tools (which "checked N events") from create tools (which "scheduled an
// event"). Falls back to ROUTE_MAP[agent].label when the tool isn't here.
const TOOL_LABEL_OVERRIDE: Record<string, (count: number) => string> = {
  list_schedule:   (n) => n > 0 ? `${n} ${n === 1 ? 'event' : 'events'} this week` : 'No upcoming events',
  list_tasks:      (n) => n > 0 ? `${n} ${n === 1 ? 'task' : 'tasks'} pending` : 'No pending tasks',
  list_memories:   (n) => n > 0 ? `${n} ${n === 1 ? 'memory' : 'memories'}` : 'Vault is empty',
  recall_knowledge:(n) => n > 0 ? `${n} matching ${n === 1 ? 'memory' : 'memories'}` : 'No matches found',
};

const ICON_FOR_PREVIEW: Record<string, any> = {
  task: CheckSquare,
  event: CalendarIcon,
  memory: Database,
  note: FileText,
};

export const ActionResultCards: React.FC<Props> = ({ steps }) => {
  const navigate = useNavigate();
  if (!steps || steps.length === 0) return null;

  const cards: CardSpec[] = [];
  // Dedupe per (agent, route) so we never show "Open Calendar" twice in the same
  // reply even if the orchestrator ran the agent multiple times.
  const seen = new Set<string>();
  for (const s of steps) {
    if (s.status !== 'completed') continue;
    const meta = ROUTE_MAP[s.agent];
    if (!meta) continue;
    const key = `${s.agent}:${meta.route}`;
    if (seen.has(key)) continue;
    seen.add(key);

    // Prefer the tool-aware label so list_schedule reads as "8 events this
    // week" rather than the legacy "Event scheduled". Fall back to the
    // agent's ROUTE_MAP label when the tool isn't list-aware.
    let label = meta.label;
    const override = s.tool && TOOL_LABEL_OVERRIDE[s.tool];
    if (override && typeof s.entity_count === 'number') {
      label = override(s.entity_count);
    }

    const summary = (s.output_summary || '').trim();
    cards.push({
      agent: s.agent,
      color: meta.color,
      icon: meta.icon,
      label,
      summary: summary.slice(0, 140),
      navTo: meta.route,
      navLabel: meta.label2,
      preview: s.inline_preview && s.inline_preview.length > 0 ? s.inline_preview.slice(0, 3) : undefined,
    });
  }

  if (cards.length === 0) return null;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 8, marginTop: 10 }}>
      {cards.map((c, i) => (
        <div key={i} style={{
          padding: '10px 12px',
          background: `linear-gradient(135deg, ${c.color}10, ${c.color}05)`,
          border: `1px solid ${c.color}30`,
          borderRadius: 10,
          display: 'flex', flexDirection: 'column', gap: 7,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{
              width: 28, height: 28, borderRadius: 7,
              background: `${c.color}20`, border: `1px solid ${c.color}40`,
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0
            }}>
              <c.icon size={14} color={c.color} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ color: c.color, fontSize: 11, fontWeight: 800, letterSpacing: '0.3px', textTransform: 'uppercase' }}>{c.label}</div>
              <div style={{ color: 'var(--text-3)', fontSize: 10, fontWeight: 600 }}>{c.agent}</div>
            </div>
          </div>
          {c.summary && !c.preview && (
            <div style={{ color: 'var(--text-2)', fontSize: 11.5, lineHeight: 1.45, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
              {c.summary}
            </div>
          )}
          {c.preview && c.preview.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 2 }}>
              {c.preview.map((p, j) => {
                const Icon = ICON_FOR_PREVIEW[p.icon || 'memory'] || FileText;
                return (
                  <div key={p.id || j} style={{
                    display: 'flex', alignItems: 'flex-start', gap: 7,
                    padding: '6px 8px',
                    background: 'var(--surface-2)',
                    border: '1px solid var(--border)',
                    borderRadius: 7,
                    minWidth: 0,
                  }}>
                    <Icon size={11} color={c.color} style={{ marginTop: 2, flexShrink: 0 }} />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ color: 'var(--text-1)', fontSize: 11.5, fontWeight: 600, lineHeight: 1.35, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {p.title}
                      </div>
                      {p.subtitle && (
                        <div style={{ color: 'var(--text-3)', fontSize: 10.5, lineHeight: 1.3, display: 'flex', alignItems: 'center', gap: 4 }}>
                          {(p.icon === 'event' || p.icon === 'task') && <Clock size={9} />}
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.subtitle}</span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <button onClick={() => navigate(c.navTo)} style={{
            marginTop: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '6px 10px', background: `${c.color}15`, border: `1px solid ${c.color}30`,
            borderRadius: 7, color: c.color, fontSize: 11, fontWeight: 700,
            cursor: 'pointer', fontFamily: 'inherit'
          }}>
            <span>{c.navLabel}</span>
            <ArrowRight size={11} />
          </button>
        </div>
      ))}
    </div>
  );
};

export default ActionResultCards;
