import React, { lazy, Suspense } from 'react';

// react-markdown + remark-gfm pull a sizeable parser graph. Defer them
// behind React.lazy so chat-style pages (Agent, Recall, MemoryDetail)
// can ship without that cost in their initial chunk. The fallback renders
// the raw text so first paint still shows the message — the Markdown
// formatting just lights up a moment later.

const Inner = lazy(() => import('./MarkdownMessage'));

interface Props {
  content: string;
  onActionClick?: (text: string) => void;
}

const Fallback: React.FC<{ content: string }> = ({ content }) => (
  <div
    className="md-msg md-msg-fallback"
    style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: 'var(--text-2)' }}
  >
    {content}
  </div>
);

export const LazyMarkdownMessage: React.FC<Props> = (props) => (
  <Suspense fallback={<Fallback content={props.content} />}>
    <Inner {...props} />
  </Suspense>
);

export default LazyMarkdownMessage;
