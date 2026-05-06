import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Send, Mic, MicOff, Loader2, Plus, Radio, MessageSquare, Trash2,
  X, Clock, Cpu, Check, AlertTriangle, ChevronDown, ArrowRight,
  Sparkles, ListChecks, Search as SearchIcon, GraduationCap, CalendarDays, Brain,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import type { AgentMsg, AgentStepData } from '../lib/types';
import type { LucideIcon } from 'lucide-react';
import { LazyMarkdownMessage as MarkdownMessage } from '../components/LazyMarkdownMessage';
import MessageToolbar from '../components/MessageToolbar';
import ActionResultCards, { ROUTE_MAP } from '../components/ActionResultCards';
import { LiveInlineGate } from '../components/LiveChatPanel';
import AutoGrowTextarea from '../components/AutoGrowTextarea';
import NavRedirectCard from '../components/NavRedirectCard';
import ClarificationCard from '../components/ClarificationCard';
import AgentTrace from '../components/AgentTrace';
import { AGENT_LABEL, friendlyAgent } from '../lib/agentLabels';

// ─── Persisted chat storage (cleared on sign-out by App.handleSignOut) ────
const STORAGE_KEY_CURRENT = 'agent-hub-current-chat-v1';
const STORAGE_KEY_CURRENT_SESSION_ID = 'agent-hub-current-session-id-v1';
const STORAGE_KEY_SESSIONS = 'agent-hub-sessions-v1';
const MAX_SESSIONS = 25;
const MAX_MSGS_PER_SESSION = 80;       // cap conversation length we store
const MAX_CONTENT_CHARS = 8000;        // truncate oversized assistant content

// Trim a message for storage: drop bulky internal fields, cap content length.
function trimMessageForStorage(m: AgentMsg): AgentMsg {
  const content = (m.content || '').length > MAX_CONTENT_CHARS
    ? (m.content || '').slice(0, MAX_CONTENT_CHARS) + '\n\n…[truncated for storage]'
    : m.content;
  const steps = m.steps?.map(s => ({
    ...s,
    input: typeof s.input === 'string' && s.input.length > 400 ? s.input.slice(0, 400) + '…' : s.input,
    output_summary: typeof s.output_summary === 'string' && s.output_summary.length > 400 ? s.output_summary.slice(0, 400) + '…' : s.output_summary,
  }));
  return { ...m, content, ...(steps ? { steps } : {}) };
}

function trimMessagesForStorage(msgs: AgentMsg[]): AgentMsg[] {
  const capped = msgs.length > MAX_MSGS_PER_SESSION ? msgs.slice(-MAX_MSGS_PER_SESSION) : msgs;
  return capped.map(trimMessageForStorage);
}

type ChatSession = {
  id: string;
  title: string;
  ts: string;
  msg_count: number;
  messages: AgentMsg[];
};

const buildWelcomeMsg = (): AgentMsg => ({
  id: 'welcome', role: 'assistant', type: 'welcome', ts: new Date().toISOString(),
  content: `Hi — I'm your assistant. Ask me to plan your day, find something you saved, capture a link, or schedule study time.`,
});

// Empty-state suggestion chips. Each chip is a one-tap quick prompt that
// fires a real message — surfaced as colorful action cards on the welcome
// screen and as a compact chip strip above the input once a conversation
// is in flight (so common follow-ups stay one tap away).
type Suggestion = { label: string; msg: string; icon: LucideIcon; color: string };
const SUGGESTIONS: Suggestion[] = [
  { label: 'Plan my day',         msg: 'Give me my daily briefing with what I should focus on today.',         icon: Sparkles,      color: '#f59e0b' },
  { label: 'Show my tasks',       msg: 'Show me all my pending tasks and help me prioritise them.',            icon: ListChecks,    color: '#22d3ee' },
  { label: 'Recall recent saves', msg: 'Recall the most important things I have saved recently.',              icon: SearchIcon,    color: '#a78bfa' },
  { label: 'Build a study plan',  msg: 'Create a study plan for this week and put it on my calendar.',         icon: GraduationCap, color: '#10b981' },
  { label: 'What is on my calendar?', msg: 'What is on my calendar this week?',                                icon: CalendarDays,  color: '#f472b6' },
  { label: 'Quiz me',             msg: 'Quiz me on what I have been learning this week using my flashcards.',  icon: Brain,         color: '#6366f1' },
];

// Contextual follow-up chips shown immediately under an assistant reply that
// just ran a list-type tool. Keeps the conversation flowing — instead of
// dropping the user into a dead end after "8 events this week", we offer the
// most likely next moves (schedule, drill into tomorrow, switch view).
type FollowupChip = { label: string; msg: string };
const CONTEXTUAL_FOLLOWUPS: Record<string, FollowupChip[]> = {
  list_schedule: [
    { label: 'What is tomorrow?',     msg: 'What is on my calendar tomorrow?' },
    { label: 'Block focus time',      msg: 'Schedule a 90-minute focus block tomorrow morning.' },
    { label: 'Reschedule something',  msg: 'Help me move one of my events to a better time.' },
  ],
  list_tasks: [
    { label: 'Add a task',            msg: 'Create a new task for me.' },
    { label: 'What is most urgent?',  msg: 'Which task should I do first today?' },
    { label: 'Plan time for these',   msg: 'Block focus time on my calendar for these tasks.' },
  ],
  list_memories: [
    { label: 'Recall by topic',       msg: 'Recall my recent saves about a specific topic.' },
    { label: 'Build a study plan',    msg: 'Create a study plan from these recent saves.' },
    { label: 'Quiz me',               msg: 'Quiz me on what I have been learning recently.' },
  ],
  recall_knowledge: [
    { label: 'Tell me more',          msg: 'Tell me more about the top result.' },
    { label: 'Build a study plan',    msg: 'Create a study plan from these results.' },
    { label: 'Save a related note',   msg: 'Save a note linking these together.' },
  ],
};

// Map a nav-redirect destination path to the same chip set as the
// equivalent list tool — so messages routed through the navigate-intent
// classifier (which never run a tool, just emit a `navigate` event) still
// surface the contextual follow-ups. Stripped of query string + trailing slash
// so "/library?tab=notes" still resolves to the notes path.
const NAV_PATH_FOLLOWUPS: Record<string, FollowupChip[]> = {
  '/calendar': CONTEXTUAL_FOLLOWUPS.list_schedule,
  '/tasks':    CONTEXTUAL_FOLLOWUPS.list_tasks,
  '/focus':    CONTEXTUAL_FOLLOWUPS.list_tasks,
  '/vault':    CONTEXTUAL_FOLLOWUPS.list_memories,
  '/library':  CONTEXTUAL_FOLLOWUPS.list_memories,
  '/recall':   CONTEXTUAL_FOLLOWUPS.recall_knowledge,
};

// Pick the first list-style tool that completed in this message OR — when
// the message was a nav-redirect with no tool steps — derive chips from
// the destination path. Returns [] when nothing relevant happened (e.g.
// capture, schedule create, generic chat) so the chip strip stays out of
// the way.
const getContextualFollowups = (msg: AgentMsg): FollowupChip[] => {
  // 1. Tool-driven path — orchestrator actually ran a list_* tool.
  if (msg.steps && msg.steps.length > 0) {
    for (const s of msg.steps) {
      if (s.status !== 'completed') continue;
      const chips = s.tool ? CONTEXTUAL_FOLLOWUPS[s.tool] : null;
      if (chips) return chips;
    }
  }
  // 2. Nav-redirect path — message emitted by _classify_navigate_intent
  //    has type:'nav' but no steps, so look up by destination path.
  if (msg.type === 'nav' && msg.nav?.path) {
    const base = (msg.nav.path.split('?')[0] || '').replace(/\/+$/, '') || '/';
    const chips = NAV_PATH_FOLLOWUPS[base];
    if (chips) return chips;
  }
  return [];
};

// Friendly agent labels are imported from src/lib/agentLabels at the top
// of this file so AgentTrace and any other components share one map.

// Per-tool human-readable verb for the Live Pipeline panel. Mapped on the
// frontend (rather than threading through the SSE stream) because the
// backend's TOOLS list is stable and we want the label to update the moment
// `agent_start` arrives — before the tool body even runs. Falls back to the
// agent's friendly name when we don't recognize the tool.
// Keys MUST match the backend tool names emitted in `agent_start` events
// (see TOOL_AGENT_MAP / TOOL_DISPLAY_NAMES in app/coordinator.py). If you
// add a new tool there, add the friendly verb here so the Live Pipeline
// panel can render the actual current task instead of falling back to the
// generic "X working" label.
const AGENT_TASK_VERB: Record<string, string> = {
  capture_knowledge:   'Capturing knowledge',
  recall_knowledge:    'Searching your memories',
  list_memories:       'Listing your memories',
  create_task:         'Creating a task',
  list_tasks:          'Fetching your tasks',
  schedule_event:      'Adding to your calendar',
  list_schedule:       'Fetching your schedule',
  get_daily_briefing:  'Building your daily briefing',
  get_knowledge_stats: 'Crunching your vault stats',
  generate_study_plan: 'Drafting a study plan',
};

const taskVerbForStep = (agent: string, tool?: string): string => {
  if (tool && AGENT_TASK_VERB[tool]) return AGENT_TASK_VERB[tool];
  return `${friendlyAgent(agent)} working`;
};

// Format a duration in ms as a short human-readable string ("420ms" / "2.4s" / "1m 12s").
// Uses integer-second math at the minute boundary to avoid "1m 60s" rollover artifacts.
const formatDuration = (ms: number): string => {
  if (!ms || ms < 0) return '0ms';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) {
    const seconds = ms / 1000;
    return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
  }
  const totalSec = Math.round(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return s === 0 ? `${m}m` : `${m}m ${s}s`;
};

// Map any noun we receive to a (singular, plural) pair so the aggregated chip
// and the per-step drill-down panel both pluralise consistently — e.g. a
// "memory" step (count 1) and a "memories" step (count 5) collapse cleanly.
const NOUN_FORMS: Record<string, { singular: string; plural: string }> = {
  memory:      { singular: 'memory',     plural: 'memories'    },
  memories:    { singular: 'memory',     plural: 'memories'    },
  task:        { singular: 'task',       plural: 'tasks'       },
  tasks:       { singular: 'task',       plural: 'tasks'       },
  event:       { singular: 'event',      plural: 'events'      },
  events:      { singular: 'event',      plural: 'events'      },
  briefing:    { singular: 'briefing',   plural: 'briefings'   },
  briefings:   { singular: 'briefing',   plural: 'briefings'   },
  'study plan':  { singular: 'study plan', plural: 'study plans' },
  'study plans': { singular: 'study plan', plural: 'study plans' },
};

// Render a single step's entity audit as "saved 1 memory" / "checked 3 memories".
// Returns "" when the step lacks a usable count/noun/verb (e.g. stats tools).
const stepEntityPhrase = (step: AgentStepData): string => {
  const count = step.entity_count;
  const noun = (step.entity_noun || '').toLowerCase();
  const verb = step.entity_verb || '';
  if (typeof count !== 'number' || count < 0 || !noun || !verb) return '';
  const forms = NOUN_FORMS[noun];
  const singular = forms?.singular || noun;
  const plural = forms?.plural || `${noun}s`;
  return `${verb} ${count} ${count === 1 ? singular : plural}`;
};

// Build a "saved 2 memories, created 1 task" phrase from per-step entity counts.
// Aggregates counts that share the same (verb, noun-stem) so a workflow with
// multiple captures collapses to one "saved 3 memories" instead of three
// separate phrases. Returns "" when no step had a usable count, which lets the
// chip fall back to the friendly agent path.
const buildEntityPhrase = (steps: AgentStepData[]): string => {
  // Order-preserving aggregation keyed by verb+noun-stem (singular). Each
  // entry tracks the running count and the verb/noun pair we'll render.
  const order: string[] = [];
  const groups = new Map<string, { verb: string; singular: string; plural: string; count: number }>();

  for (const s of steps) {
    if (s.status !== 'completed') continue;
    const count = s.entity_count;
    const noun = (s.entity_noun || '').toLowerCase();
    const verb = s.entity_verb || '';
    if (typeof count !== 'number' || count < 0 || !noun || !verb) continue;

    const forms = NOUN_FORMS[noun];
    const singular = forms?.singular || noun;
    const plural = forms?.plural || `${noun}s`;
    const key = `${verb}|${singular}`;
    const existing = groups.get(key);
    if (existing) {
      existing.count += count;
    } else {
      groups.set(key, { verb, singular, plural, count });
      order.push(key);
    }
  }

  if (order.length === 0) return '';
  return order
    .map(key => {
      const g = groups.get(key)!;
      const noun = g.count === 1 ? g.singular : g.plural;
      return `${g.verb} ${g.count} ${noun}`;
    })
    .join(', ');
};

// End-of-stream summary chip: renders concrete counts when the backend supplied
// per-step entity audit data ("Done — checked 3 memories, created 1 task · 2.4s"),
// otherwise falls back to the friendly agent path ("Done · Coordinator → Tasks · 2.4s").
// When `onToggle` is provided the chip is rendered as a button — clicking it
// expands the inline drill-down panel below the assistant message. Only friendly
// agent labels from AGENT_LABEL are shown — unknown identifiers are dropped so we
// never leak raw "FooAgent" or model strings into the UI.
const CompletionSummary: React.FC<{
  steps: AgentStepData[];
  expanded?: boolean;
  onToggle?: () => void;
  controlsId?: string;
}> = ({ steps, expanded, onToggle, controlsId }) => {
  if (!steps || steps.length === 0) return null;
  const completed = steps.filter(s => s.status === 'completed').length;
  const failed = steps.filter(s => s.status === 'failed').length;
  const totalMs = steps.reduce((a, s) => a + (s.duration_ms || 0), 0);

  // Dedupe agents in execution order. Drop anything not in our friendly map so
  // unfamiliar identifiers / model names cannot leak through.
  const seen = new Set<string>();
  const agentList: string[] = [];
  for (const s of steps) {
    const label = AGENT_LABEL[s.agent];
    if (label && !seen.has(label)) { seen.add(label); agentList.push(label); }
  }

  // Prefer concrete entity counts when the backend provided them; otherwise fall
  // back to the friendly agent path. This is the only middle slot in the chip.
  const entityPhrase = buildEntityPhrase(steps);
  const middleText = entityPhrase || (agentList.length > 0 ? agentList.join(' → ') : '');

  // Status ladder: any failures > 0 demote the chip; otherwise "Done" if at least
  // one step actually finished, else neutral "Finished" (covers stuck/unknown states).
  let statusText = 'Done';
  let statusColor = '#10b981';
  let StatusIcon: LucideIcon = Check;
  if (failed > 0 && completed === 0) {
    statusText = "Couldn't complete";
    statusColor = '#ef4444';
    StatusIcon = AlertTriangle;
  } else if (failed > 0) {
    statusText = 'Finished with issues';
    statusColor = '#f59e0b';
    StatusIcon = AlertTriangle;
  } else if (completed === 0) {
    statusText = 'Finished';
    statusColor = '#a78bfa';
    StatusIcon = Check;
  }

  const durationStr = totalMs > 0 ? formatDuration(totalMs) : null;
  // Title mirrors the rendered chip: "Done — checked 3 memories · 2.4s".
  const titleStatusAndMid = middleText ? `${statusText} — ${middleText}` : statusText;
  const baseTitle = durationStr ? `${titleStatusAndMid} · ${durationStr}` : titleStatusAndMid;
  // Hint that the chip is now interactive when the parent wired up a toggle.
  const title = onToggle
    ? `${baseTitle} — click to ${expanded ? 'hide' : 'see'} what the assistant did`
    : baseTitle;
  const isInteractive = typeof onToggle === 'function';

  // Shared inner contents — used both for the static <div> chip and the
  // interactive <button> chip so we don't duplicate markup.
  const chipInner = (
    <>
      <StatusIcon size={11} strokeWidth={2.5} />
      <span style={{ color: statusColor, fontWeight: 700, letterSpacing: '0.1px' }}>{statusText}</span>
      {middleText && (
        <>
          {/* Em dash between status and detail per spec ("Done — checked 3 memories…") */}
          <span style={{ color: 'var(--text-3)', fontWeight: 500 }}>—</span>
          <span
            data-testid="completion-summary-detail"
            style={{
              color: 'var(--text-2)', fontWeight: 500,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              maxWidth: 360, minWidth: 0,
            }}>{middleText}</span>
        </>
      )}
      {durationStr && (
        <>
          <span style={{ color: 'var(--text-3)', fontWeight: 500 }}>·</span>
          <span style={{ color: 'var(--text-3)', fontWeight: 600 }}>{durationStr}</span>
        </>
      )}
      {isInteractive && (
        <ChevronDown
          size={11}
          strokeWidth={2.5}
          aria-hidden
          style={{
            marginLeft: 1,
            color: 'var(--text-3)',
            transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 0.18s ease',
          }} />
      )}
    </>
  );

  const baseStyle: React.CSSProperties = {
    marginTop: 8,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 7,
    padding: '4px 10px 4px 8px',
    background: `${statusColor}10`,
    border: `1px solid ${statusColor}33`,
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 600,
    color: statusColor,
    maxWidth: '100%',
    cursor: isInteractive ? 'pointer' : 'default',
    userSelect: 'none',
    fontFamily: 'inherit',
    lineHeight: 1.2,
    textAlign: 'left',
  };

  if (!isInteractive) {
    return (
      <div role="status" aria-live="polite" title={title} style={baseStyle}>
        {chipInner}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onToggle}
      title={title}
      aria-expanded={!!expanded}
      aria-controls={controlsId}
      data-testid="completion-summary-toggle"
      style={baseStyle}>
      {chipInner}
    </button>
  );
};

// Inline drill-down panel shown when the user clicks the completion chip.
// Lists every step the orchestrator ran for that turn, using the friendly
// agent label, the entity verb+count+noun the backend already emitted, the
// duration, and a truncated output_summary. Failed steps are visibly marked
// and show their error string instead of the summary. Read-only — no actions.
// Steps whose agent isn't in AGENT_LABEL are dropped so we never leak raw
// "FooAgent" / model identifiers into the UI.
const CompletionDetailsPanel: React.FC<{ steps: AgentStepData[]; panelId: string }> = ({ steps, panelId }) => {
  const visible = (steps || []).filter(s => AGENT_LABEL[s.agent]);
  if (visible.length === 0) {
    return (
      <div
        id={panelId}
        data-testid="completion-summary-details"
        style={{
          marginTop: 8,
          padding: '10px 12px',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 10,
          fontSize: 12,
          color: 'var(--text-3)',
        }}>
        No step details available for this reply.
      </div>
    );
  }
  return (
    <div
      id={panelId}
      data-testid="completion-summary-details"
      role="region"
      aria-label="What the assistant did"
      style={{
        marginTop: 8,
        padding: '10px 12px',
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        display: 'flex', flexDirection: 'column', gap: 8,
      }}>
      {visible.map(step => {
        const meta = ROUTE_MAP[step.agent];
        const color = meta?.color || '#a78bfa';
        const StepIcon = meta?.icon || Cpu;
        const label = AGENT_LABEL[step.agent];
        const isFailed = step.status === 'failed';
        const isRunning = step.status === 'running';
        const phrase = stepEntityPhrase(step);
        const summary = (step.output_summary || '').toString().trim().slice(0, 220);
        const dur = typeof step.duration_ms === 'number' && step.duration_ms > 0
          ? formatDuration(step.duration_ms)
          : null;
        return (
          <div key={step.step_id} style={{ display: 'flex', gap: 9, alignItems: 'flex-start' }}>
            <div style={{
              width: 24, height: 24, borderRadius: 7, flexShrink: 0,
              background: isFailed ? 'rgba(239,68,68,0.15)' : `${color}18`,
              border: `1px solid ${isFailed ? 'rgba(239,68,68,0.45)' : `${color}40`}`,
              display: 'grid', placeItems: 'center',
            }}>
              {isFailed
                ? <AlertTriangle size={12} color="#ef4444" />
                : <StepIcon size={12} color={color} />}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
                <span style={{ color: 'var(--text-1)', fontSize: 12, fontWeight: 700 }}>{label}</span>
                {phrase && (
                  <span style={{ color: 'var(--text-2)', fontSize: 11.5, fontWeight: 500 }}>· {phrase}</span>
                )}
                {isRunning && (
                  <span style={{ color: '#a78bfa', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.3px' }}>· RUNNING</span>
                )}
                {isFailed && (
                  <span style={{ color: '#ef4444', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.3px' }}>· FAILED</span>
                )}
                {dur && (
                  <span style={{ marginLeft: 'auto', color: 'var(--text-3)', fontSize: 10.5, fontWeight: 600 }}>{dur}</span>
                )}
              </div>
              {isFailed && step.error && (
                <div style={{ marginTop: 3, color: '#ef4444', fontSize: 11.5, lineHeight: 1.4, wordBreak: 'break-word' }}>
                  {step.error.toString().slice(0, 240)}
                </div>
              )}
              {!isFailed && summary && (
                <div style={{ marginTop: 3, color: 'var(--text-3)', fontSize: 11.5, lineHeight: 1.45, wordBreak: 'break-word' }}>
                  {summary}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

const AgentHubView = () => {
  const navigate = useNavigate();
  // ── persisted state ──
  const [messages, setMessages] = useState<AgentMsg[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_CURRENT);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {}
    return [buildWelcomeMsg()];
  });
  const [currentSessionId, setCurrentSessionId] = useState<string>(() => {
    try { return localStorage.getItem(STORAGE_KEY_CURRENT_SESSION_ID) || `s-${Date.now()}-${Math.random().toString(36).slice(2,6)}`; }
    catch { return `s-${Date.now()}-${Math.random().toString(36).slice(2,6)}`; }
  });
  const [chatSessions, setChatSessions] = useState<ChatSession[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_SESSIONS);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {}
    return [];
  });

  // ── ephemeral UI state ──
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [liveOpen, setLiveOpen] = useState(false);
  // Live per-agent status. Drives the inline "Live agents" strip below the header
  // so the user can see exactly which specialist is working at any moment.
  const [agentStatuses, setAgentStatuses] = useState<Record<string, 'idle' | 'running' | 'done'>>({});
  // Tracks which assistant message has its drill-down panel open. Only one
  // panel is open at a time per chat — opening a second one closes the first.
  // Reset when loading a different chat session or starting a new chat.
  const [expandedSummaryMsgId, setExpandedSummaryMsgId] = useState<string | null>(null);

  // ── refs ──
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const recognitionRef = useRef<any>(null);
  const abortRef = useRef<AbortController | null>(null);
  const activeRequestRef = useRef<string | null>(null);
  // When a `navigate` event arrives we already insert a final assistant
  // bubble + clear streaming state. Some backend paths also yield a
  // `workflow_complete` with the same `reply` text — track the last
  // navigate so we can ignore that follow-up and avoid duplicate bubbles.
  const lastNavigateRef = useRef<{ workflowId?: string; reply?: string; ts: number } | null>(null);

  // ── auto-scroll on new messages (skip first welcome paint to avoid jumping past header on mobile) ──
  useEffect(() => {
    if (messages.length <= 1 && messages[0]?.id === 'welcome') return;
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages]);

  // ── persist current chat (survives reloads / route navigation) ──
  useEffect(() => {
    try {
      const trimmed = trimMessagesForStorage(messages);
      localStorage.setItem(STORAGE_KEY_CURRENT, JSON.stringify(trimmed));
      localStorage.setItem(STORAGE_KEY_CURRENT_SESSION_ID, currentSessionId);
    } catch (e: any) {
      console.warn('[agent-hub] failed to persist current chat:', e?.message || e);
    }
  }, [messages, currentSessionId]);

  // ── browser speech recognition (dictation only — does not touch live voice) ──
  const toggleVoice = useCallback(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;
    if (isListening) { recognitionRef.current?.stop(); setIsListening(false); return; }
    const rec = new SR();
    rec.continuous = false; rec.interimResults = true; rec.lang = 'en-US';
    rec.onresult = (e: any) => setInput(Array.from(e.results).map((r: any) => r[0].transcript).join(''));
    rec.onend = () => setIsListening(false);
    rec.onerror = () => setIsListening(false);
    recognitionRef.current = rec;
    rec.start(); setIsListening(true);
  }, [isListening]);

  // ── sessions: archive / load / delete ──
  const archiveCurrentSession = useCallback((overrideMsgs?: AgentMsg[]) => {
    const src = overrideMsgs || messages;
    const userMsgs = src.filter(m => m.role === 'user');
    if (userMsgs.length === 0) return;
    const firstUser = (userMsgs[0]?.content || '').trim().slice(0, 80) || 'Untitled chat';
    const lastTs = src[src.length - 1]?.ts || new Date().toISOString();
    const trimmed = trimMessagesForStorage(src);
    setChatSessions(prev => {
      const next: ChatSession[] = [
        { id: currentSessionId, title: firstUser, ts: lastTs, msg_count: userMsgs.length, messages: trimmed },
        ...prev.filter(s => s.id !== currentSessionId),
      ].slice(0, MAX_SESSIONS);
      try { localStorage.setItem(STORAGE_KEY_SESSIONS, JSON.stringify(next)); }
      catch (e: any) { console.warn('[agent-hub] failed to persist sessions:', e?.message || e); }
      return next;
    });
  }, [messages, currentSessionId]);

  const loadSession = useCallback((s: ChatSession) => {
    if (s.id === currentSessionId) { setHistoryOpen(false); return; }
    archiveCurrentSession();
    activeRequestRef.current = null;
    if (abortRef.current) { try { abortRef.current.abort(); } catch {} abortRef.current = null; }
    setIsStreaming(false);
    setCurrentSessionId(s.id);
    setMessages(s.messages && s.messages.length > 0 ? s.messages : [buildWelcomeMsg()]);
    setAgentStatuses({});
    setExpandedSummaryMsgId(null);
    setHistoryOpen(false);
    window.dispatchEvent(new CustomEvent('recall-toast', { detail: { msg: `Loaded chat: ${s.title.slice(0, 40)}`, type: 'info' } }));
  }, [currentSessionId, archiveCurrentSession]);

  const deleteSession = useCallback((sessionId: string) => {
    setChatSessions(prev => {
      const next = prev.filter(s => s.id !== sessionId);
      try { localStorage.setItem(STORAGE_KEY_SESSIONS, JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  // ── send + stream (unchanged streaming protocol) ──
  const handleSend = async (text?: string) => {
    const msg = (text || input).trim();
    if (!msg || isStreaming) return;
    // Per-request token — guards aborted-but-still-resolving streams from
    // corrupting a freshly started one.
    const requestId = `r-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const userMsgId = `u-${Date.now()}`;
    const thinkId = `t-${Date.now()}`;
    activeRequestRef.current = requestId;
    setMessages(prev => [...prev,
      { id: userMsgId, role: 'user', type: 'text', content: msg, ts: new Date().toISOString() },
      { id: thinkId, role: 'assistant', type: 'thinking', content: '', ts: new Date().toISOString(), steps: [] },
    ]);
    setInput(''); setIsStreaming(true);
    setAgentStatuses({ Orchestrator: 'running' });
    // Each new send invalidates the previous navigate-dedup window so
    // a legitimate next-turn reply is never accidentally suppressed.
    lastNavigateRef.current = null;

    const ac = new AbortController();
    abortRef.current = ac;
    const isStillActive = () => activeRequestRef.current === requestId;

    try {
      const response = await fetch('/agent/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg, session_id: currentSessionId }),
        signal: ac.signal,
      });
      if (!response.body) throw new Error('No response body');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';
        for (const chunk of lines) {
          const line = chunk.trim();
          if (line.startsWith('data: ')) {
            try { handleStreamEvent(JSON.parse(line.slice(6)), thinkId, isStillActive); } catch { }
          }
        }
      }
    } catch (e: any) {
      if (!isStillActive()) return;
      if (e.name === 'AbortError') {
        setMessages(prev => prev.filter(m => m.id !== thinkId));
      } else {
        setMessages(prev => prev.map(m => m.id === thinkId
          ? { ...m, type: 'text', content: `Something went wrong: ${e.message || 'Connection failed'}` }
          : m
        ));
      }
    } finally {
      if (isStillActive()) {
        abortRef.current = null;
        activeRequestRef.current = null;
        setIsStreaming(false); setAgentStatuses({});
      }
    }
  };

  const handleStreamEvent = (event: any, thinkId: string, isActive: () => boolean) => {
    if (!isActive()) return;
    switch (event.type) {
      case 'thinking':
        setAgentStatuses(prev => ({ ...prev, Orchestrator: 'running' }));
        break;
      case 'agent_start':
        setAgentStatuses(prev => ({ ...prev, [event.agent]: 'running', Orchestrator: 'running' }));
        setMessages(prev => prev.map(m => m.id === thinkId
          ? { ...m, type: 'steps', steps: [...(m.steps || []), { step_id: event.step_id, agent: event.agent, tool: event.tool, name: event.name, status: 'running', input: event.input, batch_id: event.batch_id, parallel: event.parallel }] }
          : m));
        break;
      case 'parallel_batch_start':
        // Backend signals N read-only agents are about to run concurrently.
        // We don't render anything from this event itself — the UI groups
        // by batch_id from the agent_start events that follow. This event
        // is mainly a debug signal and a hook for future "n agents
        // running" toast/affordance.
        break;
      case 'agent_complete':
        setAgentStatuses(prev => ({ ...prev, [event.agent]: 'done' }));
        setMessages(prev => prev.map(m => m.id === thinkId
          ? { ...m, steps: (m.steps || []).map(s => s.step_id === event.step_id ? {
              ...s,
              status: 'completed',
              output_summary: event.output_summary,
              duration_ms: event.duration_ms,
              entity_count: event.entity_count,
              entity_noun: event.entity_noun,
              entity_verb: event.entity_verb,
              inline_preview: event.inline_preview,
              batch_id: event.batch_id ?? s.batch_id,
            } : s) }
          : m));
        break;
      case 'agent_error':
        setAgentStatuses(prev => ({ ...prev, [event.agent]: 'idle' }));
        setMessages(prev => prev.map(m => m.id === thinkId
          ? { ...m, steps: (m.steps || []).map(s => s.step_id === event.step_id ? { ...s, status: 'failed', error: event.error, batch_id: event.batch_id ?? s.batch_id } : s) }
          : m));
        break;
      case 'workflow_clarification_pending':
        // Lightweight terminator emitted by the backend at the end of a
        // turn that already produced a `clarification_needed` card. We
        // intentionally do NOT add a text message here — the card is
        // the user's next interaction surface. Just clear any leftover
        // agent status pulses so the composer goes idle again.
        setAgentStatuses({});
        break;
      case 'clarification_needed': {
        // Orchestrator decided the request is too ambiguous to act on.
        // Replace the in-flight "thinking" bubble with a clarification
        // card showing the question + tappable option chips. The user
        // picking an option dispatches that text as the next user message
        // (handled by the card's onPick → handleSend).
        setMessages(prev => [
          ...prev.filter(m => m.id !== thinkId),
          {
            id: `clar-${event.workflow_id || Date.now()}`,
            role: 'assistant' as const,
            type: 'clarification' as const,
            content: event.question || '',
            ts: new Date().toISOString(),
            workflow_id: event.workflow_id,
            clarification: {
              question: event.question || 'Could you give me a bit more detail?',
              options: Array.isArray(event.options) ? event.options : [],
              reason: event.reason || '',
              step_id: event.step_id,
              workflow_id: event.workflow_id,
            },
          },
        ]);
        setAgentStatuses({});
        break;
      }
      case 'token':
        setMessages(prev => prev.map(m => m.id === thinkId ? { ...m, type: 'streaming' as const, content: (m.content || '') + event.text } : m));
        break;
      case 'workflow_complete': {
        // Skip if a `navigate` event was just emitted for this same
        // workflow — the navigate handler already added the final bubble
        // and a duplicate workflow_complete with the same reply text would
        // render the same message twice in a row.
        // Strict guard: dedup only when same workflow_id, OR (same reply
        // text within 5s). This avoids accidentally swallowing a
        // legitimate next-turn reply that just happens to arrive quickly.
        const lastNav = lastNavigateRef.current;
        const sameWorkflow = !!(lastNav?.workflowId && event.workflow_id && lastNav.workflowId === event.workflow_id);
        const sameReplyRecent = !!(
          lastNav &&
          lastNav.reply &&
          event.reply &&
          lastNav.reply === event.reply &&
          (Date.now() - lastNav.ts) < 5000
        );
        if (sameWorkflow || sameReplyRecent) {
          setAgentStatuses({});
          break;
        }
        setMessages(prev => [
          ...prev.filter(m => m.id !== thinkId),
          { id: event.workflow_id, role: 'assistant' as const, type: 'text' as const, content: event.reply, steps: event.steps, agents: event.agents_called, workflow_id: event.workflow_id, ts: event.timestamp || new Date().toISOString() },
        ]);
        setAgentStatuses({});
        break;
      }
      case 'navigate': {
        // Backend decided this user message belongs on a dedicated page.
        // Instead of yanking the user there silently, render a NavRedirectCard
        // in chat: short reason + preview of the top items + an explicit
        // "Open <Page>" button + a soft 4.5s auto-redirect with countdown.
        // This satisfies two product asks at once:
        //   1) "Don't dump everything in chat — show some + redirect for the rest"
        //   2) "When redirecting, tell the user before it happens"
        const path = (event.path as string) || '/recall';
        const q = (event.query as string) || '';
        const reply = (event.message as string) || 'Redirecting…';
        const pageLabel = (event.page_label as string) || 'page';
        const reason = (event.reason as string) || 'Opening the dedicated page for the full view.';
        const preview = Array.isArray(event.preview) ? event.preview : [];
        // Record so any follow-up workflow_complete with the same reply
        // text gets ignored and we don't render the message twice.
        lastNavigateRef.current = { workflowId: event.workflow_id, reply, ts: Date.now() };
        setMessages(prev => [
          ...prev.filter(m => m.id !== thinkId),
          {
            id: `nav-${Date.now()}`,
            role: 'assistant' as const,
            type: 'nav' as const,
            content: reply,
            ts: new Date().toISOString(),
            nav: { path, query: q, pageLabel, reason, preview },
          },
        ]);
        setAgentStatuses({});
        // No imperative navigate() here — NavRedirectCard handles the
        // soft auto-redirect (and the user-initiated one) itself.
        break;
      }
      case 'error':
        setMessages(prev => prev.map(m => m.id === thinkId ? { ...m, type: 'text', content: `Something went wrong: ${event.message}` } : m));
        break;
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const startNewChat = useCallback(async () => {
    // Invalidate any in-flight stream so its leftover events become no-ops.
    activeRequestRef.current = null;
    if (abortRef.current) {
      try { abortRef.current.abort(); } catch {}
      abortRef.current = null;
    }
    setIsStreaming(false);
    archiveCurrentSession();
    // Each chat now has its own backend session_id slot — we do NOT wipe
    // it here so the user can re-open archived chats and still have full
    // backend context (history + focus item) intact for follow-ups.
    // Backend has its own TTL/trim policy for old sessions.
    setCurrentSessionId(`s-${Date.now()}-${Math.random().toString(36).slice(2,6)}`);
    setMessages([buildWelcomeMsg()]);
    setAgentStatuses({});
    setExpandedSummaryMsgId(null);
    inputRef.current?.focus();
  }, [archiveCurrentSession, currentSessionId]);

  // True empty state: only the welcome message is showing.
  const isEmpty = messages.length === 1 && messages[0]?.id === 'welcome';

  // ─────────────────────────── UI ───────────────────────────
  return (
    <div className="agent-hub-v2" style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '14px 0 28px', minHeight: 'calc(100vh - 5rem)' }}>

      {/* HEADER — title + status dot + history + new chat */}
      <header className="agent-hero" style={{ 
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12,
        padding: '16px 20px',
        background: 'linear-gradient(135deg, var(--surface) 0%, rgba(197, 248, 42, 0.02) 100%)',
        border: '1px solid var(--border)',
        borderRadius: 14,
        boxShadow: '0 4px 20px -8px rgba(0, 0, 0, 0.15)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
          <div style={{ 
            width: 42, height: 42, borderRadius: 12, 
            background: 'linear-gradient(135deg, rgba(197, 248, 42, 0.15) 0%, rgba(197, 248, 42, 0.05) 100%)', 
            border: '1px solid rgba(197, 248, 42, 0.25)', 
            display: 'grid', placeItems: 'center', flexShrink: 0,
            boxShadow: '0 4px 12px -4px rgba(197, 248, 42, 0.2)',
          }}>
            <Cpu size={19} color="#c5f82a" />
          </div>
          <div>
            <h2 style={{ fontSize: 'clamp(18px, 2.2vw, 22px)', fontWeight: 800, color: 'var(--text-1)', margin: 0, letterSpacing: '-0.4px', lineHeight: 1.1 }}>
              recall x247 <span style={{ color: 'var(--text-3)', fontWeight: 600, fontSize: '0.65em' }}>second brain</span>
            </h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
              <span style={{ 
                display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 10px', 
                background: isStreaming ? 'rgba(245, 158, 11, 0.12)' : 'rgba(197, 248, 42, 0.12)', 
                border: isStreaming ? '1px solid rgba(245, 158, 11, 0.35)' : '1px solid rgba(197, 248, 42, 0.30)', 
                borderRadius: 20, fontSize: 10, fontWeight: 700, 
                color: isStreaming ? '#f59e0b' : '#c5f82a', 
                letterSpacing: '0.5px',
                boxShadow: isStreaming ? '0 0 12px rgba(245, 158, 11, 0.15)' : '0 0 12px rgba(197, 248, 42, 0.1)',
              }}
                title={isStreaming ? 'Working on your request' : 'Ready'}>
                <span style={{ 
                  width: 6, height: 6, borderRadius: '50%', 
                  background: isStreaming ? '#f59e0b' : '#c5f82a', 
                  boxShadow: isStreaming ? '0 0 8px #f59e0b' : '0 0 8px #c5f82a', 
                  animation: isStreaming ? 'pulse 1.2s ease-in-out infinite' : 'none' 
                }} />
                {isStreaming ? 'WORKING' : 'LIVE'}
              </span>
            </div>
          </div>
        </div>

        <div className="agent-hero-actions" style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <button onClick={() => setHistoryOpen(true)}
            title="Open chat history"
            aria-label="Open chat history"
            className="agent-hero-btn"
            style={{ 
              display: 'inline-flex', alignItems: 'center', gap: 6, padding: '10px 14px', 
              background: 'var(--surface)', 
              border: '1px solid var(--border)', 
              borderRadius: 10, 
              color: 'var(--text-2)', 
              fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', 
              whiteSpace: 'nowrap', lineHeight: 1,
              transition: 'all 0.18s ease',
            }}>
            <MessageSquare size={14} />
            <span className="agent-hero-btn-label">History</span>
            {chatSessions.length > 0 && (
              <span className="agent-hero-btn-badge" style={{ 
                marginLeft: 2, padding: '2px 8px', borderRadius: 10, 
                background: 'rgba(197, 248, 42, 0.12)', 
                color: '#c5f82a', 
                fontSize: 10.5, fontWeight: 700,
                border: '1px solid rgba(197, 248, 42, 0.2)',
              }}>{chatSessions.length}</span>
            )}
          </button>
          <button onClick={startNewChat}
            title="Start a fresh chat — your current chat is saved to history"
            aria-label="Start a new chat"
            className="agent-hero-btn agent-hero-btn-primary"
            style={{ 
              display: 'inline-flex', alignItems: 'center', gap: 6, padding: '10px 16px', 
              background: 'linear-gradient(135deg, rgba(197, 248, 42, 0.15) 0%, rgba(197, 248, 42, 0.08) 100%)', 
              border: '1px solid rgba(197, 248, 42, 0.35)', 
              borderRadius: 10, 
              color: '#c5f82a', 
              fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', 
              whiteSpace: 'nowrap', lineHeight: 1,
              boxShadow: '0 2px 12px -4px rgba(197, 248, 42, 0.3)',
              transition: 'all 0.18s ease',
            }}>
            <Plus size={14} />
            <span className="agent-hero-btn-label">New chat</span>
          </button>
        </div>
      </header>

      {/* CONVERSATION */}
      <main style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0, flex: 1 }}>

        {/* LIVE AGENTS STRIP — always surfaces ALL 7 specialist agents so the
            user can see at a glance which one is working right now and where
            their request was routed. Color/animation per agent: running =
            pulsing amber (active right now), done = solid green (already
            finished), idle = soft grey. A leading "Now: X" callout names the
            currently-active specialist whenever one is running. */}
        {(() => {
          const ALL_AGENTS = Object.keys(AGENT_LABEL);
          // Prefer a non-Coordinator/Orchestrator running agent — the
          // Coordinator marks itself "running" for the entire turn while
          // sub-agents come and go, so picking it would make the panel
          // permanently say "Now: Coordinator" instead of the actual
          // worker (CaptureAgent, TaskAgent, etc). Only fall back to it
          // when nobody else is currently working.
          const isMeta = (a: string) => a === 'Orchestrator' || a === 'Coordinator';
          const runningSpecialist = ALL_AGENTS.find(a => !isMeta(a) && agentStatuses[a] === 'running');
          const runningMeta = ALL_AGENTS.find(a => isMeta(a) && agentStatuses[a] === 'running');
          const activeAgent = runningSpecialist || runningMeta;
          const anyDone = Object.values(agentStatuses).some(s => s === 'done');
          // Pull the most recent in-flight step from the latest thinking/steps
          // message — that's where `agent_start` events accumulate. Used to
          // derive the human-readable "what is it actually doing right now"
          // line that anchors the Live Pipeline panel.
          const lastInflight = [...messages].reverse().find(m => (m.type === 'thinking' || m.type === 'steps') && m.steps && m.steps.length > 0);
          const liveStep = lastInflight?.steps?.slice().reverse().find(s => s.status === 'running')
            || lastInflight?.steps?.[lastInflight!.steps!.length - 1];
          const currentTaskVerb = activeAgent
            ? taskVerbForStep(activeAgent, liveStep?.tool)
            : (isStreaming ? 'Coordinator is planning your request' : '');
          // Pipeline trail: friendly agent names in execution order, deduped.
          const trailSeen = new Set<string>();
          const trail: string[] = [];
          for (const s of (lastInflight?.steps || [])) {
            const lbl = AGENT_LABEL[s.agent];
            if (lbl && !trailSeen.has(lbl)) { trailSeen.add(lbl); trail.push(lbl); }
          }
          return (
            <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
              style={{ 
                display: 'flex', flexDirection: 'column', gap: 12, 
                padding: '14px 16px', 
                background: 'linear-gradient(135deg, var(--surface) 0%, rgba(197, 248, 42, 0.02) 100%)', 
                border: '1px solid var(--border)', 
                borderRadius: 14,
                boxShadow: '0 2px 12px -4px rgba(0, 0, 0, 0.1)',
              }}>
              {/* Row 1 — header + Now: <Agent> — <task verb> */}
              <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
                <span style={{ 
                  display: 'inline-flex', alignItems: 'center', gap: 6, 
                  color: '#c5f82a', 
                  fontSize: 10, fontWeight: 800, letterSpacing: '1.2px', textTransform: 'uppercase', flexShrink: 0,
                  padding: '3px 8px',
                  background: 'rgba(197, 248, 42, 0.1)',
                  borderRadius: 6,
                  border: '1px solid rgba(197, 248, 42, 0.2)',
                }}>
                  <Radio size={10} color="#c5f82a" /> AGENTS ACTIVE
                </span>
                {activeAgent ? (
                  <span style={{ 
                    display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 12px', 
                    background: 'rgba(245,158,11,0.12)', 
                    border: '1px solid rgba(245,158,11,0.40)', 
                    borderRadius: 20, fontSize: 11, fontWeight: 700, color: '#f59e0b', minWidth: 0,
                    boxShadow: '0 2px 8px -2px rgba(245, 158, 11, 0.2)',
                  }}>
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#f59e0b', boxShadow: '0 0 8px #f59e0b', animation: 'pulse 1.2s ease-in-out infinite', flexShrink: 0 }} />
                    <span style={{ flexShrink: 0 }}>{AGENT_LABEL[activeAgent]}</span>
                    <span style={{ color: 'var(--text-3)', fontWeight: 500 }}>—</span>
                    <span style={{ color: 'var(--text-1)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }} title={currentTaskVerb}>
                      {currentTaskVerb}
                    </span>
                  </span>
                ) : isStreaming ? (
                  <span style={{ 
                    display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 12px', 
                    background: 'rgba(197, 248, 42, 0.10)', 
                    border: '1px solid rgba(197, 248, 42, 0.30)', 
                    borderRadius: 20, fontSize: 11, fontWeight: 700, color: '#c5f82a',
                    boxShadow: '0 2px 8px -2px rgba(197, 248, 42, 0.15)',
                  }}>
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#c5f82a', boxShadow: '0 0 8px #c5f82a', animation: 'pulse 1.2s ease-in-out infinite' }} />
                    Orchestrator planning...
                  </span>
                ) : (
                  <span style={{ fontSize: 11, fontWeight: 600, color: '#c5f82a' }}>
                    {anyDone ? 'All done' : 'Standing by'}
                  </span>
                )}
                {trail.length > 0 && (
                  <span style={{ 
                    marginLeft: 'auto', fontSize: 10, color: 'var(--text-3)', 
                    fontFamily: 'JetBrains Mono, monospace', flexShrink: 0,
                    padding: '2px 8px',
                    background: 'var(--surface-2)',
                    borderRadius: 4,
                    border: '1px solid var(--border)',
                  }}>
                    {trail.join(' → ')}
                  </span>
                )}
              </div>
              {/* Row 2 — full agent roster pills with progress-style bars */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {ALL_AGENTS.map(agent => {
                  const status = agentStatuses[agent] || 'idle';
                  const label = AGENT_LABEL[agent];
                  // Use lime green for done, amber for running, muted for idle
                  const dotColor = status === 'running' ? '#f59e0b' : status === 'done' ? '#c5f82a' : '#4b5563';
                  const progressWidth = status === 'running' ? '60%' : status === 'done' ? '100%' : '0%';
                  const progressColor = status === 'running' ? 'rgba(245, 158, 11, 0.4)' : status === 'done' ? 'rgba(197, 248, 42, 0.35)' : 'transparent';
                  const textColor = status === 'running' ? '#f59e0b' : status === 'done' ? '#c5f82a' : 'var(--text-3)';
                  return (
                    <div key={agent}
                      title={`${label} — ${status}`}
                      style={{ 
                        display: 'flex', alignItems: 'center', gap: 8, 
                        padding: '6px 10px', 
                        background: 'var(--surface)', 
                        border: '1px solid var(--border)', 
                        borderRadius: 8, 
                        fontSize: 11.5, fontWeight: 600, 
                        color: textColor, 
                        opacity: status === 'idle' ? 0.5 : 1,
                        position: 'relative',
                        overflow: 'hidden',
                        transition: 'all 0.3s ease',
                      }}>
                      {/* Progress bar background */}
                      <div style={{
                        position: 'absolute',
                        left: 0,
                        top: 0,
                        bottom: 0,
                        width: progressWidth,
                        background: progressColor,
                        transition: 'width 0.5s ease-out',
                        borderRadius: 8,
                      }} />
                      <span style={{ 
                        width: 7, height: 7, borderRadius: '50%', background: dotColor, 
                        boxShadow: status === 'running' ? `0 0 8px ${dotColor}` : status === 'done' ? '0 0 6px rgba(197, 248, 42, 0.5)' : 'none', 
                        animation: status === 'running' ? 'pulse 1.2s ease-in-out infinite' : 'none',
                        position: 'relative',
                        zIndex: 1,
                      }} />
                      <span style={{ position: 'relative', zIndex: 1, flex: 1 }}>{label}</span>
                    </div>
                  );
                })}
              </div>
            </motion.div>
          );
        })()}

        {/* Empty-state quick-action grid — colorful cards for first-time chats */}
        {isEmpty && !isStreaming && (
          <div className="agent-quick-actions">
            <div className="agent-quick-actions-eyebrow" style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              color: '#c5f82a',
              fontSize: 10, fontWeight: 800, letterSpacing: '1.2px',
              padding: '4px 10px',
              background: 'rgba(197, 248, 42, 0.1)',
              borderRadius: 6,
              border: '1px solid rgba(197, 248, 42, 0.2)',
              marginBottom: 12,
            }}>
              <Sparkles size={11} color="#c5f82a" /> TRY ONE OF THESE
            </div>
            <div className="agent-quick-actions-grid">
              {SUGGESTIONS.map(s => {
                const Icon = s.icon;
                return (
                  <button key={s.label} onClick={() => handleSend(s.msg)}
                    className="agent-quick-action-card"
                    style={{ ['--qa-color' as any]: s.color }}>
                    <span className="agent-quick-action-icon" style={{ background: `${s.color}1f`, border: `1px solid ${s.color}40`, color: s.color }}>
                      <Icon size={14} />
                    </span>
                    <span className="agent-quick-action-label">{s.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Persistent quick-prompt strip — once the chat has content, keep
            the four most useful prompts available as a horizontally
            scrollable chip row so common follow-ups stay one tap away. */}
        {!isEmpty && !isStreaming && (
          <div className="agent-quick-strip" aria-label="Quick prompts">
            {SUGGESTIONS.slice(0, 5).map(s => {
              const Icon = s.icon;
              return (
                <button key={s.label} onClick={() => handleSend(s.msg)}
                  className="agent-quick-chip"
                  style={{ ['--qa-color' as any]: s.color }}>
                  <Icon size={11} color={s.color} />
                  <span>{s.label}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* MESSAGE THREAD — flows with the page; no inner scrollbox */}
        <div className="agent-messages" style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '4px 0' }}>
          {messages.map(msg => (
            <motion.div key={msg.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
              style={{ display: 'flex', flexDirection: msg.role === 'user' ? 'row-reverse' : 'row', gap: 11, alignItems: 'flex-start' }}>

              {msg.role === 'assistant' && (
                <div style={{ 
                    width: 34, height: 34, borderRadius: 10, 
                    background: 'linear-gradient(135deg, rgba(197, 248, 42, 0.15) 0%, rgba(197, 248, 42, 0.05) 100%)', 
                    border: '1px solid rgba(197, 248, 42, 0.25)', 
                    display: 'grid', placeItems: 'center', flexShrink: 0,
                    boxShadow: '0 2px 8px -2px rgba(197, 248, 42, 0.2)',
                  }}>
                  <Cpu size={16} color="#c5f82a" />
                </div>
              )}

              <div style={{ maxWidth: msg.role === 'user' ? '78%' : '92%', minWidth: 0 }}>

                {/* In-progress assistant bubble: subtle inline progress + step ticker */}
                {(msg.type === 'thinking' || msg.type === 'steps') && (
                  <div style={{ 
                    padding: '14px 18px', 
                    background: 'linear-gradient(135deg, var(--surface) 0%, rgba(197, 248, 42, 0.03) 100%)', 
                    border: '1px solid var(--border)', 
                    borderRadius: '4px 16px 16px 16px', 
                    color: 'var(--text-2)',
                    boxShadow: '0 2px 12px -4px rgba(0, 0, 0, 0.08)',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ display: 'flex', gap: 5 }}>
                        {[0,1,2].map(i => <div key={i} style={{ width: 7, height: 7, borderRadius: '50%', background: '#c5f82a', boxShadow: '0 0 6px rgba(197, 248, 42, 0.4)', animation: `bounce 1.2s ${i * 0.18}s ease-in-out infinite` }} />)}
                      </div>
                      <span style={{ fontSize: 12.5, fontWeight: 600, color: '#c5f82a' }}>
                        Thinking
                        {msg.steps && msg.steps.length > 0 && (
                          <span style={{ color: 'var(--text-3)', fontWeight: 500 }}>
                            {' · '}{msg.steps.map(s => friendlyAgent(s.agent)).join(' → ')}
                          </span>
                        )}
                      </span>
                    </div>
                    {/* Collapsible "Agents at work" trace — pills + parallel
                        batch grouping. Replaces the old flat dot list so
                        power users can drill into each step's reasoning
                        while keeping the default view compact. */}
                    {msg.type === 'steps' && msg.steps && msg.steps.length > 0 && (
                      <AgentTrace steps={msg.steps} active={isStreaming} />
                    )}
                  </div>
                )}

                {/* Pre-redirect notice card — replaces silent navigate(). The
                    backend's `navigate` event is rendered as one of these
                    cards instead of pushing the route imperatively, so the
                    user sees: short reason + preview of top items + an
                    "Open <Page>" button + a 4.5s soft countdown. */}
                {msg.type === 'nav' && msg.nav && (
                  <NavRedirectCard
                    path={msg.nav.path}
                    query={msg.nav.query}
                    pageLabel={msg.nav.pageLabel}
                    reason={msg.nav.reason}
                    preview={msg.nav.preview}
                    alreadyAutoNavigated={msg.nav.autoNavigated}
                    createdAtMs={msg.ts ? Date.parse(msg.ts) : undefined}
                    onAutoNavigated={() => {
                      setMessages(prev => prev.map(m => m.id === msg.id && m.nav
                        ? { ...m, nav: { ...m.nav, autoNavigated: true } }
                        : m));
                    }}
                  />
                )}

                {/* Clarification card — orchestrator paused to ask. Tapping
                    an option dispatches it as the next user message via
                    the existing send flow. */}
                {msg.type === 'clarification' && msg.clarification && (
                  <ClarificationCard
                    clarification={msg.clarification}
                    disabled={isStreaming}
                    onPick={(opt) => {
                      if (isStreaming) return;
                      handleSend(opt);
                    }}
                  />
                )}

                {/* Streaming markdown */}
                {msg.type === 'streaming' && (
                  <div style={{ 
                    padding: '14px 18px', 
                    borderRadius: '4px 16px 16px 16px', 
                    background: 'linear-gradient(135deg, var(--surface) 0%, rgba(197, 248, 42, 0.02) 100%)', 
                    border: '1px solid var(--border)', 
                    color: 'var(--text-1)',
                    boxShadow: '0 2px 12px -4px rgba(0, 0, 0, 0.08)',
                  }}>
                    <MarkdownMessage content={msg.content || ''} />
                    <span style={{ display: 'inline-block', width: 2, height: '1em', background: '#c5f82a', marginLeft: 2, verticalAlign: 'text-bottom', animation: 'bounce 1s ease-in-out infinite', opacity: 0.9, boxShadow: '0 0 6px rgba(197, 248, 42, 0.5)' }} />
                  </div>
                )}

                {/* Final text / welcome */}
                {(msg.type === 'text' || msg.type === 'welcome') && (
                  <div>
                    <div className={msg.role === 'user' ? 'user-bubble' : ''} style={{
                      padding: '14px 18px',
                      borderRadius: msg.role === 'user' ? '16px 4px 16px 16px' : '4px 16px 16px 16px',
                      background: msg.role === 'user'
                        ? 'linear-gradient(135deg, rgba(197, 248, 42, 0.95) 0%, rgba(163, 230, 53, 0.9) 100%)'
                        : msg.type === 'welcome'
                          ? 'linear-gradient(135deg, var(--surface) 0%, rgba(197, 248, 42, 0.05) 100%)'
                          : 'var(--surface)',
                      border: msg.role === 'user' ? '1px solid rgba(197, 248, 42, 0.3)' : msg.type === 'welcome' ? '1px solid rgba(197, 248, 42, 0.2)' : '1px solid var(--border)',
                      color: msg.role === 'user' ? '#0a0a0b' : 'var(--text-1)',
                      boxShadow: msg.role === 'user' ? '0 4px 16px -4px rgba(197, 248, 42, 0.4)' : '0 2px 12px -4px rgba(0, 0, 0, 0.08)',
                    }}>
                      <MarkdownMessage
                        content={msg.content || ''}
                        onActionClick={msg.role === 'assistant' ? (text) => handleSend(text) : undefined}
                      />
                    </div>

                    {/* End-of-stream summary chip — quick "Done — Coordinator → Capture · 2.4s".
                        Click to expand an inline panel showing each step the orchestrator ran.
                        Only one panel can be open per chat at a time — opening another closes this one. */}
                    {msg.role === 'assistant' && msg.type === 'text' && msg.steps && msg.steps.length > 0 && (
                      <>
                        <CompletionSummary
                          steps={msg.steps}
                          expanded={expandedSummaryMsgId === msg.id}
                          onToggle={() => setExpandedSummaryMsgId(prev => prev === msg.id ? null : msg.id)}
                          controlsId={`completion-details-${msg.id}`}
                        />
                        {expandedSummaryMsgId === msg.id && (
                          <CompletionDetailsPanel
                            steps={msg.steps}
                            panelId={`completion-details-${msg.id}`}
                          />
                        )}
                      </>
                    )}

                    {/* Action result cards (memory saved, task created, event scheduled) */}
                    {msg.role === 'assistant' && msg.steps && msg.steps.length > 0 && (
                      <ActionResultCards steps={msg.steps as any} />
                    )}

                    {/* Contextual follow-up chips — only render after a list-type
                        tool completed (list_schedule, list_tasks, list_memories,
                        recall_knowledge) so the user gets a natural next step
                        instead of staring at a dead-end answer. */}
                    {msg.role === 'assistant' && !isStreaming && (() => {
                      const chips = getContextualFollowups(msg);
                      if (chips.length === 0) return null;
                      return (
                        <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }} aria-label="Suggested next steps">
                          <span style={{ 
                            color: '#c5f82a', 
                            fontSize: 10, 
                            fontWeight: 700, 
                            marginRight: 2,
                            padding: '2px 8px',
                            background: 'rgba(197, 248, 42, 0.1)',
                            borderRadius: 4,
                            border: '1px solid rgba(197, 248, 42, 0.15)',
                            letterSpacing: '0.5px',
                          }}>NEXT</span>
                          {chips.map((c, ci) => (
                            <button key={ci} onClick={() => handleSend(c.msg)}
                              className="agent-quick-chip"
                              style={{ ['--qa-color' as any]: '#c5f82a' } as React.CSSProperties}
                              title={c.msg}>
                              <ArrowRight size={10} color="#c5f82a" />
                              <span>{c.label}</span>
                            </button>
                          ))}
                        </div>
                      );
                    })()}

                    {/* Quiet meta row: timestamp + export menu only */}
                    {msg.role === 'assistant' && (
                      <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-3)', fontSize: 10.5, paddingLeft: 2 }}>
                        {msg.ts && <span>{new Date(msg.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>}
                        {msg.type === 'text' && msg.content && (
                          <MessageToolbar
                            messageId={msg.id}
                            content={msg.content}
                            meta={{ agents: (msg as any).agents, ts: msg.ts, durationMs: msg.steps?.reduce((a, s) => a + (s.duration_ms || 0), 0) }}
                          />
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </motion.div>
          ))}
          <div ref={bottomRef} />
        </div>

        {/* INPUT BAR — sticky bottom; live voice expands inline below the row */}
        <div className="agent-input" style={{
          position: 'sticky', bottom: 12, zIndex: 5,
          background: 'linear-gradient(135deg, var(--surface) 0%, rgba(197, 248, 42, 0.02) 100%)',
          border: `1px solid ${isListening ? 'rgba(239,68,68,0.45)' : isStreaming ? 'rgba(197, 248, 42, 0.4)' : 'var(--border)'}`,
          borderRadius: 16, padding: '12px 14px',
          boxShadow: isStreaming 
            ? '0 -6px 28px rgba(0,0,0,0.12), 0 0 0 2px rgba(197, 248, 42, 0.1)' 
            : '0 -6px 28px rgba(0,0,0,0.12)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          transition: 'all 0.2s ease',
        }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
            <AutoGrowTextarea ref={inputRef} value={input} onChange={e => setInput(e.target.value)} onKeyDown={handleKeyDown}
              placeholder={isListening ? 'Listening...' : isStreaming ? 'Working...' : 'Ask your second brain...'}
              disabled={isStreaming}
              rows={1}
              maxHeight={200}
              className="bare-input"
              data-testid="agent-composer-input"
              style={{ flex: 1, color: 'var(--text-1)', fontSize: 14, fontFamily: 'inherit', lineHeight: 1.5, padding: '10px 8px', minHeight: 26 }}
              title="Press Enter to send, Shift + Enter for a new line"
            />
            <button onClick={toggleVoice}
              title={isListening ? 'Stop voice input' : 'Use voice input'}
              aria-label={isListening ? 'Stop voice input' : 'Use voice input'}
              style={{ 
                width: 38, height: 38, borderRadius: 10, border: 'none', cursor: 'pointer', flexShrink: 0, 
                background: isListening ? 'rgba(239,68,68,0.15)' : 'var(--surface-2)', 
                display: 'grid', placeItems: 'center', 
                transition: 'all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)',
              }}>
              {isListening ? <MicOff size={16} color="#ef4444" style={{ animation: 'pulse 1s ease-in-out infinite' }} /> : <Mic size={16} color="var(--text-3)" />}
            </button>
            <button onClick={() => setLiveOpen(o => !o)}
              title={liveOpen ? 'Close voice mode' : 'Talk live'}
              aria-label={liveOpen ? 'Close voice mode' : 'Talk live'}
              aria-expanded={liveOpen}
              style={{ 
                width: 38, height: 38, borderRadius: 10, border: 'none', cursor: 'pointer', flexShrink: 0,
                background: liveOpen ? 'linear-gradient(135deg, rgba(197, 248, 42, 0.9), rgba(163, 230, 53, 0.85))' : 'var(--surface-2)',
                display: 'grid', placeItems: 'center', 
                transition: 'all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)',
                boxShadow: liveOpen ? '0 4px 16px rgba(197, 248, 42, 0.35)' : 'none',
              }}>
              <Radio size={16} color={liveOpen ? '#0a0a0b' : 'var(--text-3)'} />
            </button>
            <button onClick={() => handleSend()} disabled={!input.trim() || isStreaming}
              aria-label="Send message"
              data-testid="agent-composer-send"
              style={{ 
                minWidth: 88, height: 38, borderRadius: 10, border: 'none', 
                cursor: input.trim() && !isStreaming ? 'pointer' : 'default', 
                fontFamily: 'inherit', flexShrink: 0,
                background: input.trim() && !isStreaming 
                  ? 'linear-gradient(135deg, rgba(197, 248, 42, 0.95) 0%, rgba(163, 230, 53, 0.9) 100%)' 
                  : 'var(--surface-3)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '0 16px',
                color: input.trim() && !isStreaming ? '#0a0a0b' : 'var(--text-3)', 
                fontSize: 13, fontWeight: 700,
                transition: 'all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)',
                boxShadow: input.trim() && !isStreaming ? '0 4px 16px -4px rgba(197, 248, 42, 0.4)' : 'none',
              }}>
              {isStreaming ? <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} /> : <><Send size={14} /> Send</>}
            </button>
          </div>

          {/* Live voice — only mounted when the user opens it (saves bandwidth + mic prompt) */}
          <AnimatePresence>
            {liveOpen && (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }} style={{ overflow: 'hidden', marginTop: 10 }}>
                <LiveInlineGate active={liveOpen} compact />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>

      {/* HISTORY DRAWER — slide-in panel from the right */}
      <AnimatePresence>
        {historyOpen && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setHistoryOpen(false)}
              style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 60, backdropFilter: 'blur(2px)' }} />
            <motion.aside
              initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 240 }}
              role="dialog" aria-label="Chat history"
              className="agent-history-drawer"
              style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: 'min(380px, 100vw)', background: 'var(--surface)', borderLeft: '1px solid var(--border)', zIndex: 61, display: 'flex', flexDirection: 'column', boxShadow: '-12px 0 40px rgba(0,0,0,0.35)' }}>
              <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <MessageSquare size={15} color="var(--text-2)" />
                  <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: 'var(--text-1)' }}>Chat history</h3>
                  <span style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 600 }}>{chatSessions.length}</span>
                </div>
                <button onClick={() => setHistoryOpen(false)} aria-label="Close history" title="Close"
                  style={{ width: 30, height: 30, borderRadius: 8, background: 'transparent', border: 'none', color: 'var(--text-3)', cursor: 'pointer', display: 'grid', placeItems: 'center' }}>
                  <X size={15} />
                </button>
              </div>
              <div style={{ flex: 1, overflowY: 'auto', padding: 12 }} className="scroll-custom">
                {chatSessions.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '60px 12px', color: 'var(--text-3)', fontSize: 12.5, lineHeight: 1.55 }}>
                    <MessageSquare size={28} color="var(--border-2)" style={{ margin: '0 auto 12px', display: 'block' }} />
                    <p style={{ margin: 0, fontWeight: 600, color: 'var(--text-2)' }}>No saved chats yet</p>
                    <p style={{ margin: '6px 0 0' }}>When you start a new chat, the previous one is saved here so you can pick it up later.</p>
                  </div>
                ) : chatSessions.map(s => {
                  const isActive = s.id === currentSessionId;
                  return (
                    <div key={s.id} role="button" tabIndex={0}
                      onClick={() => loadSession(s)}
                      onKeyDown={(e) => { if (e.key === 'Enter') loadSession(s); }}
                      style={{ padding: '11px 12px 10px', borderRadius: 11, marginBottom: 6, background: isActive ? 'var(--primary-bg)' : 'var(--surface-2)', border: `1px solid ${isActive ? 'var(--primary-border)' : 'var(--border)'}`, cursor: 'pointer', transition: 'all 0.15s' }}
                      onMouseEnter={e => { if (!isActive) e.currentTarget.style.borderColor = 'var(--primary-border)'; }}
                      onMouseLeave={e => { if (!isActive) e.currentTarget.style.borderColor = 'var(--border)'; }}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 9 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ color: 'var(--text-1)', fontSize: 12.5, fontWeight: 700, lineHeight: 1.35, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{s.title}</div>
                          <div style={{ color: 'var(--text-3)', fontSize: 10.5, marginTop: 5, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                            <span>{s.msg_count} message{s.msg_count !== 1 ? 's' : ''}</span>
                            <span>·</span>
                            <Clock size={9} /> {new Date(s.ts).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                            {isActive && <span style={{ marginLeft: 'auto', color: 'var(--primary)', fontWeight: 700 }}>active</span>}
                          </div>
                        </div>
                        <button onClick={(e) => { e.stopPropagation(); deleteSession(s.id); }}
                          title="Delete chat"
                          aria-label="Delete chat"
                          style={{ flexShrink: 0, width: 26, height: 26, borderRadius: 7, border: '1px solid transparent', background: 'transparent', color: 'var(--text-3)', cursor: 'pointer', display: 'grid', placeItems: 'center', transition: 'all 0.15s' }}
                          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.1)'; e.currentTarget.style.color = '#ef4444'; }}
                          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-3)'; }}>
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </div>
  );
};

export default AgentHubView;
