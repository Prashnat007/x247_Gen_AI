import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { Sparkles, X, ArrowRight } from 'lucide-react';

/**
 * BriefingNotifier — small in-app banner that pops up when the backend has a
 * fresh daily briefing waiting for the user. Polls /briefing/notification
 * every minute. When a notification arrives it (1) shows an in-app banner
 * with the executive summary and a link to the Daily Briefing page, and
 * (2) — if the user previously granted permission — also fires a system
 * notification. The banner self-dismisses after 30s if the user ignores it.
 *
 * Mounted once in AppShell so it works on every page.
 */
type Notification = {
  date: string;
  executive_summary: string;
  preview: string;
  created_at: string;
};

const STORAGE_KEY = 'recall-briefing-last-shown';

const BriefingNotifier: React.FC = () => {
  const navigate = useNavigate();
  const [active, setActive] = useState<Notification | null>(null);
  const dismissTimer = useRef<number | null>(null);

  // Mark the notification as seen on the backend so it doesn't keep
  // re-arriving on every poll. Best-effort — failures are silent.
  const markSeen = async () => {
    try {
      await fetch('/briefing/notification/seen', { method: 'POST' });
    } catch {}
  };

  const dismiss = async (silent = false) => {
    if (dismissTimer.current) {
      window.clearTimeout(dismissTimer.current);
      dismissTimer.current = null;
    }
    setActive(null);
    if (!silent) await markSeen();
  };

  useEffect(() => {
    let cancelled = false;

    const fetchNotification = async (opts?: { force?: boolean }) => {
      try {
        const res = await fetch('/briefing/notification');
        if (!res.ok) return;
        const data = await res.json();
        const n: Notification | null = data?.notification || null;
        if (!n || cancelled) return;

        // De-dupe by date+created_at — never show the same notification
        // twice in one browser session even if /seen failed. A `force`
        // refresh (triggered by the "send me a test notification" button)
        // bypasses the dedupe so the user immediately sees the result.
        const key = `${n.date}|${n.created_at}`;
        if (!opts?.force) {
          try {
            const prev = sessionStorage.getItem(STORAGE_KEY);
            if (prev === key) return;
          } catch {}
        }
        try { sessionStorage.setItem(STORAGE_KEY, key); } catch {}

        setActive(n);

        // Mirror to a system notification when the user has granted
        // permission. Quietly skip otherwise — the banner is enough.
        try {
          if ('Notification' in window && Notification.permission === 'granted') {
            const sys = new window.Notification('Your daily briefing is ready', {
              body: (n.executive_summary || n.preview || '').slice(0, 180),
              tag: `briefing-${n.date}`,
            });
            sys.onclick = () => {
              window.focus();
              navigate('/briefing');
              sys.close();
            };
          }
        } catch {}

        // Auto-dismiss the banner after 30s so it doesn't block the UI all day.
        if (dismissTimer.current) window.clearTimeout(dismissTimer.current);
        dismissTimer.current = window.setTimeout(() => {
          setActive(null);
          // Don't mark seen on auto-dismiss so the user can still trigger it
          // manually via the test button — only explicit dismiss / open marks seen.
        }, 30_000);
      } catch {}
    };

    // Poll every 60s. First fetch happens after a short delay so the rest
    // of the app shell mounts first.
    const initial = window.setTimeout(() => fetchNotification(), 4000);
    const interval = window.setInterval(() => fetchNotification(), 60_000);

    // Manual trigger — when the Settings page asks the backend to
    // generate a fresh notification, it fires this event so we don't
    // have to wait up to 60s for the next poll.
    const onForce = () => { fetchNotification({ force: true }); };
    window.addEventListener('recall-briefing-poll', onForce);

    return () => {
      cancelled = true;
      window.clearTimeout(initial);
      window.clearInterval(interval);
      if (dismissTimer.current) window.clearTimeout(dismissTimer.current);
      window.removeEventListener('recall-briefing-poll', onForce);
    };
  }, [navigate]);

  return (
    <AnimatePresence>
      {active && (
        <motion.div
          initial={{ opacity: 0, y: -16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -16 }}
          transition={{ duration: 0.2 }}
          role="status"
          aria-live="polite"
          style={{
            position: 'fixed', top: 16, right: 16, zIndex: 200,
            maxWidth: 380, width: 'calc(100% - 32px)',
            background: 'linear-gradient(135deg,#6366f1 0%,#7c3aed 100%)',
            color: '#fff', borderRadius: 14, padding: '14px 14px 12px',
            boxShadow: '0 12px 32px rgba(15,23,42,0.32)',
            display: 'flex', flexDirection: 'column', gap: 8,
            fontFamily: "'Poppins', system-ui, sans-serif",
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Sparkles size={14} color="rgba(255,255,255,0.9)" />
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', opacity: 0.95 }}>
              Today's Briefing
            </span>
            <span style={{ flex: 1 }} />
            <button
              onClick={() => dismiss(false)}
              aria-label="Dismiss notification"
              style={{ background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.85)', cursor: 'pointer', padding: 4, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 6 }}
            >
              <X size={14} />
            </button>
          </div>
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.45, color: 'rgba(255,255,255,0.95)' }}>
            {(active.executive_summary || active.preview || 'Your morning briefing is ready.').slice(0, 220)}
          </p>
          <button
            onClick={() => { dismiss(false); navigate('/briefing'); }}
            style={{
              alignSelf: 'flex-start', marginTop: 2,
              background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.28)',
              color: '#fff', borderRadius: 8, padding: '6px 12px',
              fontSize: 12, fontWeight: 700, cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', gap: 6,
              fontFamily: 'inherit',
            }}
          >
            Open the briefing <ArrowRight size={12} />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default BriefingNotifier;
