import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MarkdownMessage } from './MarkdownMessage';
import AutoGrowTextarea from './AutoGrowTextarea';

/**
 * Page-specialist chat dock.
 *
 * Floating bottom-right chat panel mounted once per major page. Each instance
 * talks to its own `/agent/specialist/{pageId}/chat/stream` endpoint, which
 * runs a focused agent with a restricted tool set. The main /agent
 * orchestrator is unaffected — these specialists co-exist with it.
 *
 * History is namespaced per (pageId, session_id) on the backend AND mirrored
 * to localStorage so a refresh doesn't lose the conversation.
 */

type DockMsg =
  | { id: string; role: 'user' | 'assistant'; content: string; ts: string; type?: 'text' | 'thinking' | 'streaming' }
  | { id: string; role: 'assistant'; content: string; ts: string; type: 'steps'; steps: DockStep[] };

interface DockStep {
  step_id: string;
  agent: string;
  tool: string;
  name?: string;
  status: 'running' | 'done' | 'failed';
  output_summary?: string;
  duration_ms?: number;
  error?: string;
}

export interface PageSpecialistDockProps {
  pageId: string;
  /** Override the dock label (defaults to the backend-supplied label). */
  label?: string;
  /** Override the dock focus tagline. */
  focus?: string;
  /** Hide the dock entirely (e.g. on mobile) without unmounting. */
  hidden?: boolean;
}

const SESSION_PREFIX = 'specialist_dock_session_';
const HISTORY_PREFIX = 'specialist_dock_history_';
const OPEN_PREFIX = 'specialist_dock_open_';

function makeSessionId(pageId: string): string {
  const key = SESSION_PREFIX + pageId;
  try {
    let sid = localStorage.getItem(key);
    if (!sid) {
      sid = `dock-${pageId}-${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem(key, sid);
    }
    return sid;
  } catch {
    return `dock-${pageId}-${Date.now()}`;
  }
}

function loadHistory(pageId: string): DockMsg[] {
  try {
    const raw = localStorage.getItem(HISTORY_PREFIX + pageId);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Cap to last 30 to bound memory
    return parsed.slice(-30);
  } catch {
    return [];
  }
}

function saveHistory(pageId: string, msgs: DockMsg[]) {
  try {
    localStorage.setItem(HISTORY_PREFIX + pageId, JSON.stringify(msgs.slice(-30)));
  } catch {
    /* ignore storage errors */
  }
}

// Built-in fallback labels in case the backend registry hasn't loaded yet.
const FALLBACK_LABELS: Record<string, { label: string; focus: string }> = {
  dashboard:    { label: 'Dashboard helper',    focus: 'Quick read on tasks, schedule and briefing.' },
  library:      { label: 'Library helper',      focus: 'Browse, edit, tag and recall memories.' },
  vault:        { label: 'Vault helper',        focus: 'Edit, tag and link your saved memories.' },
  recall:       { label: 'Recall helper',       focus: 'Search your knowledge base.' },
  focus:        { label: 'Focus helper',        focus: 'Tasks: add, list, plan the day.' },
  calendar:     { label: 'Calendar helper',     focus: 'See and schedule events.' },
  briefing:     { label: 'Briefing helper',     focus: "Today's briefing and stats." },
  capture:      { label: 'Capture helper',      focus: 'Save a link, article or note.' },
  learn:        { label: 'Learn helper',        focus: 'Build study plans from your notes.' },
  insights:     { label: 'Insights helper',     focus: 'Stats, trends and patterns.' },
  workspace:    { label: 'Workspace helper',    focus: 'Quick recall and capture.' },
  discover:     { label: 'Discover helper',     focus: 'Find related memories.' },
  settings:     { label: 'Settings helper',     focus: 'Explain settings and options.' },
  integrations: { label: 'Integrations helper', focus: 'Explain integrations and setup.' },
};

export const PageSpecialistDock: React.FC<PageSpecialistDockProps> = ({
  pageId,
  label,
  focus,
  hidden,
}) => {
  const sessionId = useMemo(() => makeSessionId(pageId), [pageId]);
  const [open, setOpen] = useState<boolean>(() => {
    try { return localStorage.getItem(OPEN_PREFIX + pageId) === '1'; } catch { return false; }
  });
  const [messages, setMessages] = useState<DockMsg[]>(() => loadHistory(pageId));
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const meta = FALLBACK_LABELS[pageId] || { label: 'Page helper', focus: 'Page-specific assistant.' };
  const displayLabel = label || meta.label;
  const displayFocus = focus || meta.focus;

  useEffect(() => {
    saveHistory(pageId, messages);
  }, [pageId, messages]);

  useEffect(() => {
    try { localStorage.setItem(OPEN_PREFIX + pageId, open ? '1' : '0'); } catch { /* ignore */ }
  }, [pageId, open]);

  useEffect(() => {
    if (open && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, open]);

  useEffect(() => {
    return () => {
      try { abortRef.current?.abort(); } catch { /* ignore */ }
    };
  }, []);

  const handleStreamEvent = useCallback((event: any, thinkId: string) => {
    switch (event.type) {
      case 'workflow_start':
        // nothing visual yet — the thinking bubble is already there
        break;
      case 'agent_start':
        setMessages(prev => prev.map(m => {
          if (m.id !== thinkId) return m;
          const existingSteps = (m as any).steps as DockStep[] | undefined;
          const next: DockStep[] = [
            ...(existingSteps || []),
            { step_id: event.step_id, agent: event.agent, tool: event.tool, name: event.name, status: 'running' },
          ];
          return { ...(m as any), type: 'steps', steps: next } as DockMsg;
        }));
        break;
      case 'agent_complete':
        setMessages(prev => prev.map(m => {
          if (m.id !== thinkId) return m;
          const existingSteps = ((m as any).steps as DockStep[] | undefined) || [];
          const next = existingSteps.map(s =>
            s.step_id === event.step_id
              ? { ...s, status: 'done' as const, output_summary: event.output_summary, duration_ms: event.duration_ms }
              : s
          );
          return { ...(m as any), steps: next } as DockMsg;
        }));
        break;
      case 'agent_error':
        setMessages(prev => prev.map(m => {
          if (m.id !== thinkId) return m;
          const existingSteps = ((m as any).steps as DockStep[] | undefined) || [];
          const next = existingSteps.map(s =>
            s.step_id === event.step_id
              ? { ...s, status: 'failed' as const, error: event.error }
              : s
          );
          return { ...(m as any), steps: next } as DockMsg;
        }));
        break;
      case 'token':
        setMessages(prev => prev.map(m => {
          if (m.id !== thinkId) return m;
          const cur = (m as any).content || '';
          return { ...(m as any), type: 'streaming', content: cur + (event.text || '') } as DockMsg;
        }));
        break;
      case 'workflow_complete': {
        const reply = event.reply || '';
        setMessages(prev => prev.map(m => {
          if (m.id !== thinkId) return m;
          const fallbackContent = (m as any).content || reply || 'Done.';
          return {
            ...(m as any),
            type: 'text',
            content: fallbackContent,
          } as DockMsg;
        }));
        break;
      }
      case 'error':
        setError(event.message || 'Something went wrong.');
        setMessages(prev => prev.filter(m => m.id !== thinkId));
        break;
      case 'done':
        // SSE terminator
        break;
      default:
        break;
    }
  }, []);

  const handleSend = useCallback(async (raw?: string) => {
    const msg = (raw ?? input).trim();
    if (!msg || isStreaming) return;
    setError(null);
    setInput('');

    const userId = `u-${Date.now()}`;
    const thinkId = `t-${Date.now()}`;
    const ts = new Date().toISOString();

    setMessages(prev => [
      ...prev,
      { id: userId, role: 'user', content: msg, ts, type: 'text' },
      { id: thinkId, role: 'assistant', content: '', ts, type: 'thinking' },
    ]);
    setIsStreaming(true);

    const ac = new AbortController();
    abortRef.current = ac;

    try {
      const response = await fetch(`/agent/specialist/${encodeURIComponent(pageId)}/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg, session_id: sessionId }),
        signal: ac.signal,
      });
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(text || `HTTP ${response.status}`);
      }
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
            try { handleStreamEvent(JSON.parse(line.slice(6)), thinkId); } catch { /* ignore */ }
          }
        }
      }
    } catch (e: any) {
      if (e?.name === 'AbortError') {
        setMessages(prev => prev.filter(m => m.id !== thinkId));
      } else {
        setError(e?.message || 'Connection failed');
        setMessages(prev => prev.map(m => m.id === thinkId
          ? { ...m, type: 'text', content: `Sorry — ${e?.message || 'something went wrong'}.` } as DockMsg
          : m
        ));
      }
    } finally {
      abortRef.current = null;
      setIsStreaming(false);
    }
  }, [input, isStreaming, pageId, sessionId, handleStreamEvent]);

  const handleClear = useCallback(async () => {
    setMessages([]);
    setError(null);
    try {
      await fetch(`/agent/specialist/${encodeURIComponent(pageId)}/chat/clear`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: '', session_id: sessionId }),
      });
    } catch { /* ignore */ }
  }, [pageId, sessionId]);

  if (hidden) return null;

  // Position offsets: the global QuickCaptureFAB sits at bottom:24 right:24
  // with z-index 8000. We place the dock ABOVE the FAB (bottom: ~88px)
  // and use z-index 8500 so the dock always wins clicks in the overlap
  // region. On mobile the panel is allowed to grow up to viewport-8rem
  // tall so the FAB stays visible at the bottom corner.
  // Collapsed pill button
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-testid={`specialist-dock-toggle-${pageId}`}
        style={{ bottom: 88, right: 24, zIndex: 8500 }}
        className="fixed flex items-center gap-2 rounded-full bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 shadow-lg shadow-black/20 text-sm font-medium transition-all"
        title={displayLabel}
        aria-label={`Open ${displayLabel}`}
      >
        <span className="inline-block h-2 w-2 rounded-full bg-green-300 animate-pulse" />
        {displayLabel}
      </button>
    );
  }

  return (
    <div
      data-testid={`specialist-dock-${pageId}`}
      style={{ bottom: 88, right: 24, zIndex: 8500 }}
      className="fixed flex flex-col w-[360px] max-w-[calc(100vw-2rem)] h-[500px] max-h-[calc(100vh-8rem)] rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-2xl overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-zinc-200 dark:border-zinc-800 bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-950/40 dark:to-indigo-950/40">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate">{displayLabel}</div>
          <div className="text-[11px] text-zinc-600 dark:text-zinc-400 truncate">{displayFocus}</div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={handleClear}
            className="text-[11px] text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 px-1.5 py-0.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800"
            title="Clear chat"
            data-testid={`specialist-dock-clear-${pageId}`}
          >
            Clear
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 px-1.5 py-0.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-base leading-none"
            title="Minimize"
            aria-label="Minimize dock"
            data-testid={`specialist-dock-close-${pageId}`}
          >
            ×
          </button>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-2 space-y-2 bg-zinc-50 dark:bg-zinc-950">
        {messages.length === 0 && (
          <div className="text-xs text-zinc-500 dark:text-zinc-400 py-6 text-center">
            <div className="font-medium text-zinc-700 dark:text-zinc-300 mb-1">{displayLabel}</div>
            <div>{displayFocus}</div>
            <div className="mt-2 italic">Type below to start.</div>
          </div>
        )}
        {messages.map(m => (
          <DockBubble key={m.id} m={m} pageId={pageId} />
        ))}
        {error && (
          <div className="text-[11px] text-red-600 dark:text-red-400 px-2 py-1 rounded bg-red-50 dark:bg-red-950/40">
            {error}
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="border-t border-zinc-200 dark:border-zinc-800 p-2 bg-white dark:bg-zinc-900">
        <div className="flex items-end gap-2">
          <AutoGrowTextarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder={`Ask the ${displayLabel.toLowerCase()}…`}
            maxHeight={120}
            disabled={isStreaming}
            data-testid={`specialist-dock-input-${pageId}`}
            className="flex-1 text-sm bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg px-2 py-1.5 resize-none"
          />
          <button
            type="button"
            onClick={() => handleSend()}
            disabled={isStreaming || !input.trim()}
            data-testid={`specialist-dock-send-${pageId}`}
            className="shrink-0 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-zinc-300 dark:disabled:bg-zinc-700 text-white text-sm px-3 py-1.5 transition-colors"
          >
            {isStreaming ? '…' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
};

const DockBubble: React.FC<{ m: DockMsg; pageId: string }> = ({ m, pageId }) => {
  if (m.role === 'user') {
    return (
      <div className="flex justify-end" data-testid={`specialist-dock-msg-user-${pageId}`}>
        <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-blue-600 text-white text-sm px-3 py-1.5 break-words whitespace-pre-wrap">
          {m.content}
        </div>
      </div>
    );
  }
  // Assistant
  const type = (m as any).type as DockMsg['type'];
  const steps = ((m as any).steps as DockStep[] | undefined) || [];
  return (
    <div className="flex justify-start" data-testid={`specialist-dock-msg-assistant-${pageId}`}>
      <div className="max-w-[90%] rounded-2xl rounded-bl-sm bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-sm px-3 py-1.5 shadow-sm">
        {type === 'thinking' && steps.length === 0 && (
          <span className="text-zinc-500 dark:text-zinc-400 italic">Thinking…</span>
        )}
        {steps.length > 0 && (
          <div className="space-y-1 mb-1">
            {steps.map(s => (
              <StepPill key={s.step_id} step={s} pageId={pageId} />
            ))}
          </div>
        )}
        {(m.content && (type === 'text' || type === 'streaming')) && (
          <div className="text-zinc-800 dark:text-zinc-200">
            <MarkdownMessage content={m.content} />
            {type === 'streaming' && <span className="ml-0.5 animate-pulse">▋</span>}
          </div>
        )}
      </div>
    </div>
  );
};

const StepPill: React.FC<{ step: DockStep; pageId: string }> = ({ step, pageId }) => {
  const colors = step.status === 'done'
    ? 'bg-green-50 text-green-700 border-green-200 dark:bg-green-950/40 dark:text-green-300 dark:border-green-900/60'
    : step.status === 'failed'
      ? 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-900/60'
      : 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-900/60';
  return (
    <div
      data-testid={`specialist-dock-step-${pageId}`}
      className={`text-[11px] inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border ${colors}`}
    >
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${
        step.status === 'done' ? 'bg-green-500' : step.status === 'failed' ? 'bg-red-500' : 'bg-blue-500 animate-pulse'
      }`} />
      <span className="font-medium">{step.name || step.tool}</span>
      {step.output_summary && step.status === 'done' && (
        <span className="opacity-70 truncate max-w-[140px]">— {step.output_summary}</span>
      )}
      {step.error && (
        <span className="opacity-70 truncate max-w-[140px]">— {step.error}</span>
      )}
    </div>
  );
};

export default PageSpecialistDock;
