import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, CheckSquare, CalendarDays, Database, FileText, ExternalLink, Clock, X } from 'lucide-react';
import { motion } from 'motion/react';
import type { NavPreviewItem } from '../lib/types';

interface Props {
  path: string;
  query?: string;
  pageLabel: string;
  reason: string;
  preview?: NavPreviewItem[];
  alreadyAutoNavigated?: boolean;
  // Wall-clock timestamp (ms) the card was created. We only auto-redirect
  // when it's "fresh" (received in the last few seconds). Persisted/history
  // cards stay put until the user clicks Open. Optional — falls back to
  // "not fresh" so we never surprise-redirect when this is missing.
  createdAtMs?: number;
  onAutoNavigated?: () => void;
}

const ICON_MAP: Record<NonNullable<NavPreviewItem['icon']>, React.ComponentType<{ size?: number; color?: string }>> = {
  task: CheckSquare,
  event: CalendarDays,
  memory: Database,
  note: FileText,
};

const ICON_COLOR: Record<NonNullable<NavPreviewItem['icon']>, string> = {
  task: '#10b981',
  event: '#f472b6',
  memory: '#a78bfa',
  note: '#22d3ee',
};

const AUTO_REDIRECT_MS = 4500;
// "Freshness" window — if the message was created within this many ms of
// mount we consider it a brand-new redirect that should auto-open. Anything
// older (re-rendered from session history, scroll-back, etc) sits and waits
// for an explicit click. 6s gives the SSE event + React render loop plenty
// of headroom.
const FRESH_WINDOW_MS = 6000;

// Build the destination URL safely. The destination path may already
// contain a query string (e.g. "/library?tab=vault"), so we can't blindly
// append "?q=...". Use URLSearchParams against a dummy origin and serialize
// back so the result is always well-formed.
const buildDest = (path: string, query?: string): string => {
  if (!query) return path;
  try {
    const u = new URL(path, 'http://_');
    u.searchParams.set('q', query);
    return u.pathname + (u.search || '') + (u.hash || '');
  } catch {
    return path.includes('?')
      ? `${path}&q=${encodeURIComponent(query)}`
      : `${path}?q=${encodeURIComponent(query)}`;
  }
};

// Pre-redirect notice card. Shown in the chat thread instead of yanking
// the user to a new page silently. Surfaces:
//   • a one-line "I'll take you to X" explanation
//   • a preview of the top items the destination page will show (so the
//     user gets immediate value without a page-load flash)
//   • an explicit "Open <Page>" button + a "Stay here" cancel button
//   • a soft 4.5s auto-redirect with a visible countdown the user can
//     pre-empt by clicking Open, or cancel entirely with Stay here.
//
// Auto-redirect ONLY fires for fresh cards (within FRESH_WINDOW_MS of
// createdAtMs). Persisted/history cards never auto-redirect — they wait
// for an explicit click — so scrolling back through chat doesn't yank
// the user away unexpectedly.
const NavRedirectCard: React.FC<Props> = ({
  path, query, pageLabel, reason, preview, alreadyAutoNavigated, createdAtMs, onAutoNavigated,
}) => {
  const navigate = useNavigate();
  // Auto-redirect disabled — the agent should answer inline and only
  // suggest opening a dedicated page as an opt-in. The user must click
  // "Open <Page>" explicitly; we never yank them away.
  const isFreshAtMount = useRef<boolean>(false);
  const [remainingMs, setRemainingMs] = useState(0);
  const [done, setDone] = useState(!!alreadyAutoNavigated);
  const [cancelled, setCancelled] = useState(false);

  const dest = buildDest(path, query);

  // Mark the SSE event consumed on mount so it doesn't get retried by parent.
  useEffect(() => {
    if (alreadyAutoNavigated) return;
    onAutoNavigated?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleOpen = () => {
    setDone(true);
    onAutoNavigated?.();
    try { navigate(dest); } catch {}
  };

  const handleCancel = () => {
    setCancelled(true);
    setRemainingMs(0);
    onAutoNavigated?.(); // mark consumed so re-mounting doesn't restart timer
  };

  const seconds = Math.ceil(remainingMs / 1000);
  const pct = Math.max(0, Math.min(100, (1 - remainingMs / AUTO_REDIRECT_MS) * 100));
  const willAuto = isFreshAtMount.current && !done && !cancelled;

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      role="region"
      aria-label={`Redirect to ${pageLabel}`}
      style={{
        border: '1px solid rgba(99,102,241,0.32)',
        background: 'linear-gradient(135deg, rgba(99,102,241,0.10), rgba(139,92,246,0.06))',
        borderRadius: '4px 14px 14px 14px',
        padding: '13px 15px',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 9px', borderRadius: 14, background: 'rgba(99,102,241,0.18)', border: '1px solid rgba(99,102,241,0.40)', fontSize: 10, fontWeight: 800, color: '#a78bfa', letterSpacing: '0.5px', textTransform: 'uppercase' }}>
          <ArrowRight size={11} /> Redirect ready
        </span>
        <span style={{ fontSize: 12.5, color: 'var(--text-1)', fontWeight: 600, lineHeight: 1.35 }}>
          {willAuto ? 'Taking you to' : 'You can open'} <span style={{ color: '#a78bfa', fontWeight: 800 }}>{pageLabel}</span> for the full view.
        </span>
      </div>

      <div style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.45 }}>
        {reason}
      </div>

      {preview && preview.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '8px 10px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 9 }}>
          {preview.map((p, i) => {
            const Icon = p.icon ? ICON_MAP[p.icon] : null;
            const color = p.icon ? ICON_COLOR[p.icon] : '#a78bfa';
            return (
              <div key={p.id || `${p.title}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 12, color: 'var(--text-1)' }}>
                {Icon && (
                  <span style={{ width: 22, height: 22, borderRadius: 6, background: `${color}1a`, border: `1px solid ${color}40`, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                    <Icon size={11} color={color} />
                  </span>
                )}
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontWeight: 600, color: 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.title}</div>
                  {p.subtitle && (
                    <div style={{ fontSize: 11, color: 'var(--text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.subtitle}</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={handleOpen}
            disabled={done}
            data-testid="button-nav-open"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '7px 14px', borderRadius: 9,
              background: done ? 'var(--surface-3)' : 'linear-gradient(135deg,#6366f1,#4f46e5)',
              color: '#fff', border: 'none', fontWeight: 700, fontSize: 12, fontFamily: 'inherit',
              cursor: done ? 'default' : 'pointer',
              opacity: done ? 0.7 : 1,
            }}
          >
            <ExternalLink size={12} />
            {done ? 'Opened' : `Open ${pageLabel}`}
          </button>
          {willAuto && (
            <button
              type="button"
              onClick={handleCancel}
              data-testid="button-nav-cancel"
              aria-label="Stay here, don't auto-redirect"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                padding: '7px 11px', borderRadius: 9,
                background: 'var(--surface-2)', color: 'var(--text-2)',
                border: '1px solid var(--border)', fontWeight: 600, fontSize: 11.5, fontFamily: 'inherit',
                cursor: 'pointer',
              }}
            >
              <X size={11} /> Stay here
            </button>
          )}
        </div>
        {willAuto && (
          <span
            aria-live="polite"
            aria-atomic="true"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--text-3)', fontFamily: 'JetBrains Mono, monospace' }}>
            <Clock size={11} /> auto-opens in {seconds}s
          </span>
        )}
        {cancelled && (
          <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
            Auto-redirect cancelled — click Open when ready.
          </span>
        )}
      </div>

      {willAuto && (
        <div style={{ height: 2, background: 'var(--surface-3)', borderRadius: 2, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${pct}%`, background: 'linear-gradient(90deg,#6366f1,#a78bfa)', transition: 'width 0.1s linear' }} />
        </div>
      )}
    </motion.div>
  );
};

export default NavRedirectCard;
