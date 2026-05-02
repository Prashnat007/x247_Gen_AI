import React, { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronDown, ChevronRight, Loader2, CheckCircle2, AlertCircle, Cpu, Layers } from 'lucide-react';
import type { AgentStepData } from '../lib/types';
import { friendlyAgent } from '../lib/agentLabels';

interface Props {
  steps: AgentStepData[];
  // Whether the orchestrator is still running (controls default expanded
  // state and the header pulse). Caller passes the page-level isStreaming.
  active: boolean;
  // Header label, defaults to "Agents at work".
  title?: string;
}

type Status = 'running' | 'completed' | 'failed';

const STATUS_DOT: Record<Status, string> = {
  running: '#a78bfa',
  completed: '#10b981',
  failed: '#ef4444',
};

const STATUS_BG: Record<Status, string> = {
  running: 'rgba(167,139,250,0.10)',
  completed: 'rgba(16,185,129,0.08)',
  failed: 'rgba(239,68,68,0.10)',
};

const STATUS_BORDER: Record<Status, string> = {
  running: 'rgba(167,139,250,0.35)',
  completed: 'rgba(16,185,129,0.30)',
  failed: 'rgba(239,68,68,0.40)',
};

const STATUS_LABEL: Record<Status, string> = {
  running: 'running',
  completed: 'done',
  failed: 'failed',
};

const StatusIcon: React.FC<{ status: Status; size?: number }> = ({ status, size = 11 }) => {
  if (status === 'running') return <Loader2 size={size} style={{ animation: 'spin 1s linear infinite' }} />;
  if (status === 'completed') return <CheckCircle2 size={size} />;
  if (status === 'failed') return <AlertCircle size={size} />;
  return <Cpu size={size} />;
};

interface BatchGroup {
  batchId: string | null;
  steps: AgentStepData[];
  parallel: boolean;
}

// Collapse consecutive steps with the same batch_id into one group. Steps
// without a batch_id (sequential writes) become singleton groups so the
// rendering logic stays uniform.
function groupByBatch(steps: AgentStepData[]): BatchGroup[] {
  const groups: BatchGroup[] = [];
  for (const s of steps) {
    const bid = s.batch_id || null;
    const last = groups[groups.length - 1];
    if (bid && last && last.batchId === bid) {
      last.steps.push(s);
    } else {
      groups.push({ batchId: bid, steps: [s], parallel: false });
    }
  }
  // A group is "parallel" when it has 2+ siblings sharing one batch_id.
  for (const g of groups) g.parallel = g.steps.length > 1 && g.batchId !== null;
  return groups;
}

const StepCell: React.FC<{ step: AgentStepData; expanded: boolean }> = ({ step, expanded }) => {
  const status = (step.status as Status) || 'running';
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
      data-testid="agent-trace-step"
      data-status={status}
      style={{
        flex: '1 1 160px',
        minWidth: 0,
        background: STATUS_BG[status],
        border: `1px solid ${STATUS_BORDER[status]}`,
        borderRadius: 9,
        padding: expanded ? '8px 10px' : '6px 9px',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: STATUS_DOT[status] }}>
        <StatusIcon status={status} size={11} />
        <span
          style={{
            fontSize: 9.5,
            fontWeight: 800,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
          }}
        >
          {STATUS_LABEL[status]}
        </span>
        {step.duration_ms !== undefined && status === 'completed' && (
          <span
            style={{
              marginLeft: 'auto',
              fontSize: 9.5,
              color: 'var(--text-3)',
              fontFamily: 'JetBrains Mono, monospace',
            }}
          >
            {Math.round(step.duration_ms)}ms
          </span>
        )}
      </div>
      <div
        style={{
          fontSize: 12,
          fontWeight: 700,
          color: 'var(--text-1)',
          lineHeight: 1.25,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {friendlyAgent(step.agent)}
      </div>
      {expanded && step.name && (
        <div
          style={{
            fontSize: 10.5,
            color: 'var(--text-3)',
            lineHeight: 1.35,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {step.name}
        </div>
      )}
      {expanded && status === 'completed' && step.output_summary && (
        <div
          style={{
            fontSize: 10.5,
            color: 'var(--text-3)',
            lineHeight: 1.35,
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {step.output_summary}
        </div>
      )}
      {expanded && status === 'failed' && step.error && (
        <div
          style={{
            fontSize: 10.5,
            color: '#ef4444',
            lineHeight: 1.35,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {step.error}
        </div>
      )}
    </motion.div>
  );
};

const AgentTrace: React.FC<Props> = ({ steps, active, title = 'Agents at work' }) => {
  const [expanded, setExpanded] = useState<boolean>(active);
  // Auto-expand whenever a new run kicks off; collapse when it settles
  // unless the user has already toggled it. We re-sync only on the
  // active->inactive transition so user toggles aren't clobbered.
  const groups = useMemo(() => groupByBatch(steps), [steps]);
  if (!steps.length) return null;

  const total = steps.length;
  const done = steps.filter((s) => s.status === 'completed').length;
  const failed = steps.filter((s) => s.status === 'failed').length;
  const running = steps.filter((s) => s.status === 'running').length;

  return (
    <div
      data-testid="agent-trace"
      style={{
        marginTop: 10,
        background: 'rgba(15,23,42,0.20)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        overflow: 'hidden',
      }}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        data-testid="agent-trace-toggle"
        style={{
          width: '100%',
          background: 'transparent',
          border: 'none',
          padding: '8px 11px',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          cursor: 'pointer',
          color: 'var(--text-2)',
        }}
      >
        {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <Layers size={12} color="#a78bfa" />
        <span
          style={{
            fontSize: 10.5,
            fontWeight: 800,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: 'var(--text-2)',
          }}
        >
          {title}
        </span>
        <span
          style={{
            marginLeft: 'auto',
            display: 'flex',
            gap: 6,
            alignItems: 'center',
            fontSize: 10.5,
            color: 'var(--text-3)',
            fontFamily: 'JetBrains Mono, monospace',
          }}
        >
          {running > 0 && (
            <span style={{ color: STATUS_DOT.running }} data-testid="trace-count-running">
              {running} running
            </span>
          )}
          <span data-testid="trace-count-done">{done}/{total} done</span>
          {failed > 0 && (
            <span style={{ color: STATUS_DOT.failed }} data-testid="trace-count-failed">
              {failed} failed
            </span>
          )}
        </span>
      </button>
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="body"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.16 }}
            style={{ padding: '4px 11px 11px 11px' }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {groups.map((g, gi) => (
                <div
                  key={`${g.batchId || 'seq'}-${gi}`}
                  data-testid={g.parallel ? 'agent-trace-batch-parallel' : 'agent-trace-batch-sequential'}
                >
                  {g.parallel && (
                    <div
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 5,
                        padding: '2px 7px',
                        marginBottom: 5,
                        background: 'rgba(99,102,241,0.12)',
                        border: '1px solid rgba(99,102,241,0.30)',
                        borderRadius: 999,
                        fontSize: 9.5,
                        fontWeight: 800,
                        letterSpacing: '0.05em',
                        textTransform: 'uppercase',
                        color: '#818cf8',
                      }}
                    >
                      <Layers size={10} />
                      {g.steps.length} agents in parallel
                    </div>
                  )}
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: g.parallel ? 'row' : 'column',
                      flexWrap: g.parallel ? 'wrap' : 'nowrap',
                      gap: 6,
                    }}
                  >
                    {g.steps.map((step, si) => (
                      <StepCell
                        key={step.step_id || `${g.batchId || 'seq'}-${gi}-${si}`}
                        step={step}
                        expanded={expanded}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default AgentTrace;
