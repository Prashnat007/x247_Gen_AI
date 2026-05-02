import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Loader2, CheckCircle2, Cpu, AlertCircle } from 'lucide-react';

export type AgentStatus = 'queued' | 'running' | 'done' | 'error';

export interface AgentStep {
  name: string;
  label?: string;
  status: AgentStatus;
  ms?: number;
  out?: string;
  color?: string;
}

interface Props {
  agents: AgentStep[];
  totalMs?: number;
  title?: string;
  compact?: boolean;
}

const STATUS_BG: Record<AgentStatus, string> = {
  queued: 'rgba(148,163,184,0.10)',
  running: 'rgba(59,130,246,0.14)',
  done: 'rgba(16,185,129,0.12)',
  error: 'rgba(239,68,68,0.12)',
};

const STATUS_BORDER: Record<AgentStatus, string> = {
  queued: 'rgba(148,163,184,0.30)',
  running: 'rgba(59,130,246,0.45)',
  done: 'rgba(16,185,129,0.40)',
  error: 'rgba(239,68,68,0.45)',
};

const STATUS_TEXT: Record<AgentStatus, string> = {
  queued: '#94a3b8',
  running: '#3b82f6',
  done: '#10b981',
  error: '#ef4444',
};

const STATUS_LABEL: Record<AgentStatus, string> = {
  queued: 'queued',
  running: 'running',
  done: 'done',
  error: 'failed',
};

const StatusIcon: React.FC<{ status: AgentStatus; size?: number }> = ({ status, size = 12 }) => {
  if (status === 'running') return <Loader2 size={size} style={{ animation: 'spin 1s linear infinite' }} />;
  if (status === 'done') return <CheckCircle2 size={size} />;
  if (status === 'error') return <AlertCircle size={size} />;
  return <Cpu size={size} />;
};

const AgentPipeline: React.FC<Props> = ({ agents, totalMs, title = 'Multi-agent pipeline', compact = false }) => {
  if (!agents.length) return null;
  const card: React.CSSProperties = {
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 12,
    padding: compact ? '10px 12px' : '12px 14px',
  };
  return (
    <div style={card}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, flexWrap: 'wrap', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 18, height: 18, borderRadius: 5, background: 'linear-gradient(135deg,#6366f1,#3b82f6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Cpu size={11} color="#fff" />
          </div>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{title}</div>
        </div>
        {totalMs !== undefined && (
          <div style={{ fontSize: 10.5, color: 'var(--text-3)', fontFamily: 'JetBrains Mono, monospace' }}>
            total {totalMs} ms · {agents.length} agents
          </div>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'stretch', gap: 6, flexWrap: 'wrap' }}>
        <AnimatePresence>
          {agents.map((a, i) => (
            <motion.div
              key={a.name}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              style={{
                flex: '1 1 120px',
                minWidth: 120,
                padding: '8px 10px',
                background: STATUS_BG[a.status],
                border: `1px solid ${STATUS_BORDER[a.status]}`,
                borderRadius: 9,
                display: 'flex',
                flexDirection: 'column',
                gap: 5,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: STATUS_TEXT[a.status] }}>
                <StatusIcon status={a.status} size={11} />
                <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.05em', textTransform: 'uppercase' }}>{STATUS_LABEL[a.status]}</span>
                {a.ms !== undefined && a.status === 'done' && (
                  <span style={{ marginLeft: 'auto', fontSize: 9.5, color: 'var(--text-3)', fontFamily: 'JetBrains Mono, monospace' }}>{a.ms}ms</span>
                )}
              </div>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-1)', lineHeight: 1.2 }}>{a.label || a.name}</div>
              {a.out && (
                <div style={{ fontSize: 10.5, color: 'var(--text-3)', lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.out}</div>
              )}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
};

export default AgentPipeline;
