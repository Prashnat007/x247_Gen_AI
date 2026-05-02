import React from 'react';
import { motion } from 'motion/react';
import { HelpCircle } from 'lucide-react';
import type { AgentClarification } from '../lib/types';

interface Props {
  clarification: AgentClarification;
  onPick: (option: string) => void;
  disabled?: boolean;
}

const ClarificationCard: React.FC<Props> = ({ clarification, onPick, disabled }) => {
  const { question, options, reason } = clarification;
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
      data-testid="agent-clarification-card"
      style={{
        background: 'var(--surface)',
        border: '1px solid rgba(245,158,11,0.30)',
        borderRadius: 14,
        padding: '14px 16px',
        boxShadow: '0 1px 0 rgba(245,158,11,0.05) inset',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <div
          style={{
            width: 28,
            height: 28,
            flexShrink: 0,
            borderRadius: 8,
            background: 'linear-gradient(135deg,#f59e0b,#d97706)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff',
          }}
        >
          <HelpCircle size={15} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 10.5,
              fontWeight: 700,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: '#d97706',
              marginBottom: 4,
            }}
          >
            Quick check before I run
          </div>
          <div
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: 'var(--text-1)',
              lineHeight: 1.4,
            }}
          >
            {question}
          </div>
          {reason && (
            <div
              style={{
                fontSize: 12,
                color: 'var(--text-3)',
                marginTop: 4,
                lineHeight: 1.4,
              }}
            >
              {reason}
            </div>
          )}
        </div>
      </div>
      {options.length > 0 && (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 6,
            marginTop: 12,
          }}
        >
          {options.map((opt, i) => (
            <button
              key={`${i}-${opt}`}
              type="button"
              data-testid={`clarification-option-${i}`}
              disabled={disabled}
              onClick={() => onPick(opt)}
              style={{
                background: 'rgba(245,158,11,0.10)',
                border: '1px solid rgba(245,158,11,0.35)',
                borderRadius: 999,
                color: 'var(--text-1)',
                fontSize: 12.5,
                fontWeight: 600,
                padding: '6px 12px',
                cursor: disabled ? 'not-allowed' : 'pointer',
                opacity: disabled ? 0.6 : 1,
                transition: 'background 0.12s, border-color 0.12s',
              }}
              onMouseEnter={(e) => {
                if (disabled) return;
                (e.currentTarget as HTMLButtonElement).style.background = 'rgba(245,158,11,0.18)';
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background = 'rgba(245,158,11,0.10)';
              }}
            >
              {opt}
            </button>
          ))}
        </div>
      )}
    </motion.div>
  );
};

export default ClarificationCard;
