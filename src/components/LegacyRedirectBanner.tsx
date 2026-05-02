import React, { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { X, ArrowRight } from 'lucide-react';

export const DISMISSED_PREFIX = 'recall:redirect_banner_dismissed:';

const ROUTE_LABELS: Record<string, { from: string; nowIn: string; hub: string }> = {
  '/notes':      { from: 'Notes',         nowIn: 'Library',       hub: 'library' },
  '/vault':      { from: 'Vault',         nowIn: 'Library',       hub: 'library' },
  '/bookmarks':  { from: 'Bookmarks',     nowIn: 'Library',       hub: 'library' },
  '/capture':    { from: 'Capture',       nowIn: 'Library Inbox', hub: 'library' },
  '/tasks':      { from: 'Tasks',         nowIn: 'Focus',         hub: 'focus'   },
  '/habits':     { from: 'Habits',        nowIn: 'Focus',         hub: 'focus'   },
  '/plan':       { from: 'Study Plan',    nowIn: 'Learn',         hub: 'learn'   },
  '/flashcards': { from: 'Flashcards',    nowIn: 'Learn',         hub: 'learn'   },
  '/revisits':   { from: 'Revisits',      nowIn: 'Learn',         hub: 'learn'   },
  '/timeline':   { from: 'Timeline',      nowIn: 'Insights',      hub: 'insights'},
  '/graph':      { from: 'Mind Graph',    nowIn: 'Insights',      hub: 'insights'},
  '/analytics':  { from: 'Analytics',     nowIn: 'Insights',      hub: 'insights'},
};

interface Props {
  hub: 'library' | 'focus' | 'learn' | 'insights';
}

const LegacyRedirectBanner: React.FC<Props> = ({ hub }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const redirectedFrom = (location.state as { redirectedFrom?: string } | null)?.redirectedFrom;

  const [dismissed, setDismissed] = useState<boolean>(() => {
    if (!redirectedFrom) return false;
    try { return !!localStorage.getItem(DISMISSED_PREFIX + redirectedFrom); } catch { return false; }
  });

  if (!redirectedFrom) return null;
  const meta = ROUTE_LABELS[redirectedFrom];
  if (!meta || meta.hub !== hub) return null;
  if (dismissed) return null;

  const handleDismiss = () => {
    try { localStorage.setItem(DISMISSED_PREFIX + redirectedFrom, '1'); } catch { /* ignore */ }
    setDismissed(true);
    // Clear the navigation state so a refresh / share doesn't bring the banner back.
    navigate(location.pathname + location.search, { replace: true, state: null });
  };

  return (
    <div
      role="status"
      data-testid="legacy-redirect-banner"
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '10px 14px',
        marginBottom: 12,
        background: 'linear-gradient(135deg, rgba(99,102,241,0.10), rgba(34,211,238,0.10))',
        border: '1px solid rgba(99,102,241,0.30)',
        borderRadius: 'var(--radius)',
        color: 'var(--text-1)',
        fontSize: 13,
      }}
    >
      <ArrowRight size={15} color="#6366f1" style={{ flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <strong>{meta.from}</strong> is now part of <strong>{meta.nowIn}</strong>. Same content, new home.
      </div>
      <button
        onClick={handleDismiss}
        aria-label="Dismiss"
        data-testid="button-dismiss-redirect-banner"
        style={{
          background: 'transparent', border: 'none', cursor: 'pointer',
          padding: 4, color: 'var(--text-3)', display: 'flex',
          flexShrink: 0,
        }}
      >
        <X size={16} />
      </button>
    </div>
  );
};

export default LegacyRedirectBanner;
