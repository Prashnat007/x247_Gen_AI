import React, { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface Props {
  content: string;
  onActionClick?: (text: string) => void;
}

const NUMBERED_RE = /^\s*(\d+)\.\s+(.+)$/;
const AGENT_NAME_RE = /^([A-Z][a-zA-Z]*Agent|Orchestrator|RecallAgent|TaskAgent|CalendarAgent|BriefingAgent|CaptureAgent|AnalyticsAgent)\b/;

function extractActions(content: string): { display: string; raw: string; agent?: string }[] {
  const lines = content.split('\n');
  const out: { display: string; raw: string; agent?: string }[] = [];
  for (const line of lines) {
    const m = line.match(NUMBERED_RE);
    if (!m) continue;
    let body = m[2].replace(/\*\*/g, '').trim();
    const agentMatch = body.match(AGENT_NAME_RE);
    let agent: string | undefined;
    if (agentMatch) {
      agent = agentMatch[1];
      body = body.replace(AGENT_NAME_RE, '').replace(/^[\s—\-:]+/, '').trim();
    }
    if (body.length > 4 && body.length < 220) {
      out.push({ display: body, raw: m[2].replace(/\*\*/g, '').trim(), agent });
    }
  }
  return out.slice(0, 6);
}

const AGENT_TINT: Record<string, string> = {
  Orchestrator: '#00d4ff', CaptureAgent: '#f43f5e', RecallAgent: '#8b5cf6',
  TaskAgent: '#10b981', CalendarAgent: '#f59e0b', BriefingAgent: '#06b6d4', AnalyticsAgent: '#3b82f6'
};

export const MarkdownMessage: React.FC<Props> = ({ content, onActionClick }) => {
  const actions = useMemo(() => extractActions(content), [content]);
  const hasActionPrompt = /which one should i run\?/i.test(content);

  return (
    <div className="md-msg">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => <h3 className="md-h">{children}</h3>,
          h2: ({ children }) => <h4 className="md-h">{children}</h4>,
          h3: ({ children }) => <h5 className="md-h">{children}</h5>,
          h4: ({ children }) => <h6 className="md-h">{children}</h6>,
          p: ({ children }) => <p className="md-p">{children}</p>,
          ul: ({ children }) => <ul className="md-ul">{children}</ul>,
          ol: ({ children }) => <ol className="md-ol">{children}</ol>,
          li: ({ children }) => <li className="md-li">{children}</li>,
          strong: ({ children }) => <strong className="md-strong">{children}</strong>,
          em: ({ children }) => <em className="md-em">{children}</em>,
          code: ({ children, className }) => {
            const isBlock = className?.includes('language-');
            return isBlock
              ? <code className="md-code-block">{children}</code>
              : <code className="md-code-inline">{children}</code>;
          },
          pre: ({ children }) => <pre className="md-pre">{children}</pre>,
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer" className="md-link">{children}</a>
          ),
          blockquote: ({ children }) => <blockquote className="md-quote">{children}</blockquote>,
          hr: () => <hr className="md-hr" />,
          table: ({ children }) => <table className="md-table">{children}</table>,
        }}
      >
        {content}
      </ReactMarkdown>

      {actions.length > 0 && hasActionPrompt && onActionClick && (
        <div className="md-actions">
          <div className="md-actions-title">Tap to run</div>
          <div className="md-actions-row">
            {actions.map((a, i) => {
              const c = (a.agent && AGENT_TINT[a.agent]) || '#6366f1';
              return (
                <button
                  key={i}
                  onClick={() => onActionClick(`Run option ${i + 1}: ${a.display}`)}
                  className="md-action-chip"
                  style={{ borderColor: `${c}55`, background: `${c}12`, color: c }}
                  title={a.display}
                >
                  <span className="md-action-num" style={{ background: c, color: '#fff' }}>{i + 1}</span>
                  {a.agent && <span className="md-action-agent" style={{ color: c }}>{a.agent.replace('Agent', '')}</span>}
                  <span className="md-action-text">{a.display.length > 60 ? a.display.slice(0, 60) + '…' : a.display}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default MarkdownMessage;
