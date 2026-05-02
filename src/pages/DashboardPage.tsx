import React, { useState, useEffect, lazy, Suspense } from 'react';
import { useNavigate } from 'react-router-dom';
import { Brain, Sparkles, CheckSquare, Network, GraduationCap, Zap, Timer, TrendingUp, Bot, Activity, ArrowUpRight, Youtube, Globe, FileText, StickyNote, Flame, Check, ChevronRight, Bell, ExternalLink, RotateCw, PauseCircle, Target, Hash, History, CalendarClock, Tag, Trophy, X } from 'lucide-react';
import { showToast } from '../App';
import { motion } from 'motion/react';
import type { Memory } from '../lib/types';

// Recharts is ~250 KB. Lazy-load just the two chart blocks we need so
// the dashboard's initial chunk doesn't pay for it. A lightweight
// "Loading chart…" placeholder fills the slot while the chunk arrives.
const ForecastBarChart = lazy(() =>
  import('../components/charts/DashboardCharts').then(m => ({ default: m.ForecastBarChart }))
);
const DomainsRadarChart = lazy(() =>
  import('../components/charts/DashboardCharts').then(m => ({ default: m.DomainsRadarChart }))
);
const ChartPlaceholder = ({ height }: { height: number }) => (
  <div
    aria-hidden
    style={{
      height, width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: 'var(--text-3)', fontSize: 11, opacity: 0.5,
    }}
  >
    Loading chart…
  </div>
);

type DashAdvanced = {
  greeting?: { period: string; label: string; hour_ist: number; iso: string };
  pulse?: Record<string, { current: number; previous: number; diff: number; pct: number; direction: 'up' | 'down' | 'flat' }>;
  activity_heatmap?: { days: number; cells: { date: string; weekday: number; count: number }[]; max: number };
  streak?: { current: number; longest: number };
  top_tags?: { tag: string; count: number; weight: number }[];
  today_focus?: { kind: string; id: string; title: string; subtitle: string; action_label: string; url: string; memory_id: string; color: string }[];
  forecast_7d?: { date: string; label: string; day: number; revisits: number; tasks: number }[];
  pick_up?: { id: string; title: string; summary: string; domain: string; source_type: string; source_url: string; created_at: string; suggestion: string } | null;
  totals?: Record<string, number>;
};

const DOMAIN_COLORS = ['#6366f1', '#9333ea', '#f472b6', '#10b981', '#f59e0b', '#ef4444'];
const SRC_ICON: Record<string, any> = { youtube: Youtube, web: Globe, pdf: FileText, note: StickyNote };
const SRC_CLR: Record<string, string> = { youtube: '#ef4444', web: '#00d4ff', pdf: '#f59e0b', note: '#10b981' };

type SectionHeaderProps = {
  icon: any;
  color: string;
  title: string;
  eyebrow?: string;
  actionLabel?: string;
  onAction?: () => void;
};
const SectionHeader = ({ icon: Icon, color, title, eyebrow, actionLabel, onAction }: SectionHeaderProps) => (
  <div className="dash-section-head">
    <div className="dash-title-wrap">
      <span className="dash-icon-pill" style={{ background: `${color}14`, border: `1px solid ${color}28`, color }}>
        <Icon size={14} />
      </span>
      <h3>{title}</h3>
      {eyebrow && <span className="dash-eyebrow">{eyebrow}</span>}
    </div>
    {actionLabel && onAction && (
      <button className="dash-action-link" onClick={onAction} style={{ color }}>
        {actionLabel} <ArrowUpRight size={11} />
      </button>
    )}
  </div>
);

const Dashboard = ({ isDark, user, onSignOut, onUpgradeGuest }: { isDark?: boolean; user?: any; onSignOut?: () => void | Promise<void>; onUpgradeGuest?: () => void | Promise<void> }) => {
  const navigate = useNavigate();
  const [stats, setStats] = useState<any>(null);
  const [recent, setRecent] = useState<Memory[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [briefing, setBriefing] = useState('');
  const [briefingLoading, setBriefingLoading] = useState(true);
  const [revisits, setRevisits] = useState<any[]>([]);
  const [revisitsUpcoming, setRevisitsUpcoming] = useState<any[]>([]);
  const [habits, setHabits] = useState<any[]>([]);
  const [adv, setAdv] = useState<DashAdvanced | null>(null);
  // Pending-task list intentionally not loaded on the Dashboard — the
  // AI Daily Briefing card is kept minimal here. Full task list lives
  // on /briefing.
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  const isGuest = !!(user?.isAnonymous || user?.isGuest);
  const rawName = (user?.displayName ?? '').trim();
  // Treat the placeholder displayName we set for anonymous Firebase guests
  // ("Guest User") the same way as a real isGuest flag — otherwise a real
  // sign-up that happens to have the literal name "Guest User" would also
  // show the demo banner. Real signups always have a non-empty email.
  const looksLikeGuestName = rawName.toLowerCase() === 'guest user';
  const emailLocal = (user?.email ?? '').split('@')[0] || '';
  const niceEmailName = emailLocal
    ? emailLocal.replace(/[._-]+/g, ' ').split(/\s+/)[0].replace(/^./, (c: string) => c.toUpperCase())
    : '';
  const firstName = rawName && !looksLikeGuestName
    ? rawName.split(/\s+/)[0]
    : isGuest
      ? 'Guest'
      : niceEmailName || 'there';
  const greetLabel = adv?.greeting?.label || 'Welcome';

  // ── First-time banner: shown ONCE per uid, dismissable ──
  // Real accounts land on a fresh empty brain. We make that intentional
  // (not "where is my stuff?") with a one-time welcome strip. The
  // banner is keyed per uid AND re-evaluated whenever uid changes so
  // a fresh sign-up on a browser where another user already dismissed
  // their banner still gets to see their own once.
  const bannerKey = `dash-welcome-banner-dismissed-${user?.uid || 'unknown'}`;
  const [showWelcomeBanner, setShowWelcomeBanner] = useState<boolean>(() => {
    try { return !localStorage.getItem(bannerKey); } catch { return true; }
  });
  useEffect(() => {
    try { setShowWelcomeBanner(!localStorage.getItem(bannerKey)); }
    catch { setShowWelcomeBanner(true); }
  }, [bannerKey]);
  const dismissWelcomeBanner = () => {
    setShowWelcomeBanner(false);
    try { localStorage.setItem(bannerKey, '1'); } catch {}
  };
  const isEmptyRealUser = !isGuest && stats !== null && (stats?.total_memories ?? 0) === 0;

  // ── Guest "Sign up free" CTA: signs the guest out (clears the
  //    `recall-guest-user` localStorage key + Firebase anon session)
  //    BEFORE navigating, so the unauth-only `/login` route is reachable
  //    again. Without this, AppShell intercepts /login as a 404 since
  //    /login is only mounted in the no-user branch of AppRouter.
  const handleGuestUpgrade = async () => {
    // Prefer the dedicated upgrade callback (single sign-out + nav to
    // /login?mode=signup with no intermediate render). Fall back to the
    // older two-step path only if the parent didn't supply it.
    if (onUpgradeGuest) {
      try { await onUpgradeGuest(); } catch {}
      return;
    }
    try { if (onSignOut) await onSignOut(); } catch {}
    navigate('/login?mode=signup');
  };

  useEffect(() => {
    Promise.all([
      fetch('/stats').then(r => r.ok ? r.json() : null),
      fetch('/memories?limit=6').then(r => r.ok ? r.json() : []),
      fetch('/logs?limit=5').then(r => r.ok ? r.json() : []),
    ]).then(([s, m, l]) => { if (s) setStats(s); setRecent(m); setLogs(l); }).catch(console.error);
    fetch('/briefing').then(r => r.ok ? r.json() : { briefing: 'Ready for another great day of learning!', executive_summary: '' })
      .then(d => {
        // Prefer the short executive summary on the Dashboard so the card
        // stays compact; the full structured briefing lives on /briefing.
        setBriefing(d.executive_summary || d.briefing);
        setRevisits(Array.isArray(d?.revisits_due) ? d.revisits_due : []);
        setRevisitsUpcoming(Array.isArray(d?.revisits_upcoming) ? d.revisits_upcoming : []);
      })
      .catch(() => setBriefing('Ready for another great day of learning!'))
      .finally(() => setBriefingLoading(false));
    fetch('/habits').then(r => r.ok ? r.json() : []).then(setHabits).catch(() => setHabits([]));
    fetch('/dashboard/advanced')
      .then(r => r.ok ? r.json() : null)
      .then((d: DashAdvanced | null) => { if (d) setAdv(d); })
      .catch(() => {});
  }, []);

  const refreshAdvanced = async () => {
    try {
      const r = await fetch('/dashboard/advanced');
      if (r.ok) setAdv(await r.json());
    } catch {}
  };

  const handleFocusAction = async (item: any) => {
    if (item.kind === 'revisit') {
      if (item.url) window.open(item.url, '_blank', 'noopener,noreferrer');
      else if (item.memory_id) navigate(`/memory/${item.memory_id}`);
      try { await fetch(`/revisits/${item.id}/visit`, { method: 'POST' }); } catch {}
    } else if (item.kind === 'task') {
      try {
        await fetch(`/tasks/${item.id}/complete`, { method: 'POST' });
        showToast('Task completed');
      } catch {}
    } else if (item.kind === 'habit') {
      const todayIso = new Date().toISOString().slice(0, 10);
      try {
        const r = await fetch(`/habits/${item.id}/toggle?date=${todayIso}`, { method: 'POST' });
        if (r.ok) {
          const updated = await r.json();
          setHabits(habits.map(x => x.id === item.id ? updated : x));
        }
      } catch {}
    }
    refreshAdvanced();
    refreshRevisits();
  };

  const refreshRevisits = async () => {
    try {
      const r = await fetch('/revisits/due');
      if (r.ok) {
        const d = await r.json();
        setRevisits(Array.isArray(d?.due) ? d.due : []);
        setRevisitsUpcoming(Array.isArray(d?.upcoming) ? d.upcoming : []);
      }
    } catch {}
  };

  const handleRevisitGo = async (rv: any) => {
    if (rv.url) window.open(rv.url, '_blank', 'noopener,noreferrer');
    else if (rv.memory_id) navigate(`/memory/${rv.memory_id}`);
    try { await fetch(`/revisits/${rv.id}/visit`, { method: 'POST' }); } catch {}
    refreshRevisits();
  };

  const handleRevisitDone = async (rv: any) => {
    try { await fetch(`/revisits/${rv.id}/visit`, { method: 'POST' }); showToast('Marked done — next due updated'); } catch {}
    refreshRevisits();
  };

  const handleRevisitSnooze = async (rv: any, days: number) => {
    try {
      await fetch(`/revisits/${rv.id}/snooze`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ days }),
      });
      showToast(`Snoozed ${days >= 1 ? days + 'd' : Math.round(days * 24) + 'h'}`);
    } catch {}
    refreshRevisits();
  };

  const handleRevisitPause = async (rv: any) => {
    try { await fetch(`/revisits/${rv.id}/pause`, { method: 'POST' }); showToast('Paused'); } catch {}
    refreshRevisits();
  };

  const totalMem = stats?.total_memories ?? 0;
  const domains: { name: string; value: number }[] = stats?.knowledge_domains ?? [];

  const radarData = domains.length > 0
    ? domains.slice(0, 6).map((d: any) => ({ subject: d.name, value: d.value, fullMark: Math.max(...domains.map((x: any) => x.value)) + 1 }))
    : [{ subject: 'AI/ML', value: 0, fullMark: 10 }, { subject: 'Science', value: 0, fullMark: 10 }, { subject: 'Tech', value: 0, fullMark: 10 }, { subject: 'Business', value: 0, fullMark: 10 }, { subject: 'Health', value: 0, fullMark: 10 }];

  const statCards = [
    { label: 'Neural Memories', value: totalMem, icon: Brain, color: '#6366f1', trend: '+12%', sub: 'Total captured', route: '/vault' },
    { label: 'Pending Tasks', value: stats?.pending_tasks ?? 0, icon: CheckSquare, color: '#9333ea', trend: '2 due today', sub: 'Open tasks', route: '/tasks' },
    { label: 'AI Interactions', value: stats?.ai_interactions ?? 0, icon: Sparkles, color: '#ec4899', trend: 'Lifetime', sub: 'Recall queries', route: '/recall' },
    { label: 'Knowledge Domains', value: domains.length, icon: Network, color: '#10b981', trend: 'Active', sub: 'Topics tracked', route: '/graph' },
    { label: 'Flashcards', value: stats?.flashcards ?? 0, icon: GraduationCap, color: '#f59e0b', trend: 'Study ready', sub: 'Created', route: '/flashcards' },
    { label: 'Learning Streak', value: stats?.streak_days ?? 0, icon: Zap, color: '#ef4444', trend: 'Days', sub: 'Current streak', route: '/flashcards' },
    { label: 'Focus Sessions', value: stats?.focus_sessions ?? 0, icon: Timer, color: '#06b6d4', trend: 'This week', sub: 'Deep work', route: '/tasks' },
    { label: 'Captured Today', value: stats?.captured_today ?? 0, icon: TrendingUp, color: '#8b5cf6', trend: 'Today', sub: 'New memories', route: '/capture' },
  ];

  const dashIconBtn: React.CSSProperties = {
    width: 28, height: 28, borderRadius: 7, border: '1px solid var(--border)',
    background: 'var(--surface-2)', color: 'var(--text-2)', cursor: 'pointer',
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  };

  const S = {
    card: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, boxShadow: isDark ? '0 2px 14px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.04)' : '0 1px 4px rgba(0,0,0,0.06), inset 0 1px 0 rgba(255,255,255,0.88)', transition: 'all 0.2s' } as React.CSSProperties,
  };

  // ── Smart Insights — derived from the data we already have ───────────────
  const velocityWk = adv?.pulse?.memories_this_week;
  const topicLead = (adv?.top_tags && adv.top_tags[0]) || null;
  const nextRevisit = revisits[0] || revisitsUpcoming[0] || null;
  const smartInsights: { id: string; icon: any; color: string; eyebrow: string; headline: string; sub: string; onClick?: () => void }[] = [];
  if (velocityWk) {
    const dirSign = velocityWk.direction === 'up' ? '+' : velocityWk.direction === 'down' ? '−' : '';
    const dirClr = velocityWk.direction === 'up' ? '#10b981' : velocityWk.direction === 'down' ? '#ef4444' : '#94a3b8';
    smartInsights.push({
      id: 'velocity',
      icon: TrendingUp,
      color: dirClr,
      eyebrow: 'LEARNING VELOCITY',
      headline: `${dirSign}${Math.abs(velocityWk.diff)} this week`,
      sub: `${velocityWk.current} captures · was ${velocityWk.previous} last week`,
      onClick: () => navigate('/analytics'),
    });
  }
  if (topicLead) {
    smartInsights.push({
      id: 'topic',
      icon: Hash,
      color: '#06b6d4',
      eyebrow: 'TOPIC LEAD',
      headline: topicLead.tag,
      sub: `${topicLead.count} item${topicLead.count === 1 ? '' : 's'} tagged across your vault`,
      onClick: () => navigate(`/vault?q=${encodeURIComponent(topicLead.tag)}`),
    });
  }
  if (nextRevisit) {
    const overdue = (nextRevisit.overdue_hours ?? 0) > 0;
    const dueIn = nextRevisit.due_in_hours;
    const meta = overdue
      ? `Overdue by ${nextRevisit.overdue_hours < 24 ? nextRevisit.overdue_hours + 'h' : Math.round(nextRevisit.overdue_hours / 24) + 'd'}`
      : dueIn != null
        ? (dueIn < 24 ? `Due in ${Math.max(1, dueIn)}h` : `Due in ${Math.round(dueIn / 24)}d`)
        : 'Coming up';
    smartInsights.push({
      id: 'revisit',
      icon: Bell,
      color: overdue ? '#ef4444' : '#f59e0b',
      eyebrow: 'NEXT REVISIT',
      headline: nextRevisit.title || 'Untitled',
      sub: meta,
      onClick: () => handleRevisitGo(nextRevisit),
    });
  }

  return (
    <div style={{ color: 'var(--text-1)' }}>
      {/* ── 0. CONTEXT BANNER (Guest demo / Fresh-start welcome) ─────────── */}
      {showWelcomeBanner && (isGuest || isEmptyRealUser) && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          style={{
            ...S.card,
            marginBottom: 14,
            padding: '12px 16px',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            border: isGuest ? '1px solid rgba(245,158,11,0.32)' : '1px solid var(--primary-border)',
            background: isGuest ? 'rgba(245,158,11,0.06)' : 'var(--primary-bg)',
          }}
        >
          <div
            style={{
              width: 32, height: 32, borderRadius: 9,
              background: isGuest ? 'rgba(245,158,11,0.16)' : 'var(--primary-bg)',
              border: isGuest ? '1px solid rgba(245,158,11,0.32)' : '1px solid var(--primary-border)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}
          >
            {isGuest
              ? <Sparkles size={15} color="#f59e0b" />
              : <Sparkles size={15} color="var(--primary)" />}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-1)', lineHeight: 1.35 }}>
              {isGuest ? "You're exploring with sample data" : 'Welcome to your fresh second brain'}
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 2, lineHeight: 1.45 }}>
              {isGuest
                ? 'Memories, tasks, notes and habits below are demo content. Sign up to start with a clean slate and save your own captures.'
                : 'Capture your first article, video or note to start building your knowledge brain. Everything you save stays private to your account.'}
            </div>
          </div>
          {isGuest ? (
            <button
              type="button"
              onClick={handleGuestUpgrade}
              data-testid="button-guest-upgrade"
              style={{
                padding: '7px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600,
                background: '#f59e0b', color: '#fff', border: 'none', cursor: 'pointer',
                whiteSpace: 'nowrap', flexShrink: 0,
              }}
            >
              Sign up free
            </button>
          ) : (
            <button
              type="button"
              onClick={() => navigate('/capture')}
              style={{
                padding: '7px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600,
                background: 'var(--primary)', color: '#fff', border: 'none', cursor: 'pointer',
                whiteSpace: 'nowrap', flexShrink: 0,
              }}
            >
              Capture first memory
            </button>
          )}
          <button
            type="button"
            onClick={dismissWelcomeBanner}
            aria-label="Dismiss"
            title="Dismiss"
            style={{
              padding: 4, background: 'transparent', border: 'none', borderRadius: 6,
              cursor: 'pointer', color: 'var(--text-3)', flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <X size={14} />
          </button>
        </motion.div>
      )}

      {/* ── 1. HEADER + AI BRIEFING ───────────────────────────────────────── */}
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} style={{ marginBottom: 18 }}>
        <div className="dash-header-row" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 14 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#10b981' }} />
              <span style={{ color: 'var(--text-3)', fontSize: 11, letterSpacing: '0.08em', fontWeight: 500 }}>NEURAL OS ACTIVE</span>
            </div>
            <h1 style={{ fontSize: 26, fontWeight: 800, color: 'var(--text-1)', margin: 0, lineHeight: 1.15, letterSpacing: '-0.5px' }}>
              {greetLabel}, <span style={{ color: 'var(--primary)' }}>{firstName}</span>
            </h1>
            <p style={{ color: 'var(--text-3)', fontSize: 13, marginTop: 4, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span>{today}</span>
              {adv?.streak && (adv.streak.current > 0 || adv.streak.longest > 0) && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.28)', color: '#f59e0b', padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700 }}>
                  <Flame size={11} /> {adv.streak.current}d streak · best {adv.streak.longest}d
                </span>
              )}
            </p>
          </div>
          <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.1 }}
            className="dash-briefing"
            style={{ ...S.card, maxWidth: 420, padding: '14px 18px', border: '1px solid var(--primary-border)', flex: '1 1 320px' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
              <div className="dash-briefing-icon" style={{ width: 32, height: 32, borderRadius: 9, background: 'var(--primary-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Sparkles size={15} color="var(--primary)" />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="dash-briefing-eyebrow" style={{ color: 'var(--primary)', fontSize: 9, letterSpacing: '1.5px', textTransform: 'uppercase', marginBottom: 5, fontWeight: 700 }}>AI DAILY BRIEFING</div>
                {briefingLoading
                  ? <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>{[0,1,2].map(i => <div key={i} style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--primary)', opacity: 0.4, animation: `bounce 1.2s ease-in-out ${i*0.2}s infinite` }} />)}</div>
                  : <p className="dash-briefing-body" style={{ color: 'var(--text-2)', fontSize: 12, lineHeight: 1.55, margin: 0, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{briefing}</p>
                }
                {/* Dashboard intentionally keeps the briefing minimal — the
                    "up next / pending tasks" list and full structured view
                    live on /briefing so this card stays a glanceable summary. */}
                <button
                  type="button"
                  className="briefing-handoff"
                  onClick={() => navigate('/briefing')}
                >
                  Open full briefing <ChevronRight size={11} />
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      </motion.div>

      {/* ── 2. KPI STAT CARDS — moved to TOP per your request ──────────────── */}
      <div className="dash-section">
        <SectionHeader icon={Activity} color="#6366f1" title="At a glance" eyebrow="LIVE METRICS" />
        <div className="stat-cards-grid">
          {statCards.map((s, i) => (
            <motion.div key={s.label} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}
              onClick={() => navigate(s.route)}
              style={{ ...S.card, padding: '16px 18px', cursor: 'pointer', position: 'relative', overflow: 'hidden' }}
              onMouseEnter={e => {
                const el = e.currentTarget as HTMLDivElement;
                el.style.transform = 'translateY(-3px)';
                el.style.borderColor = 'var(--primary-border)';
              }}
              onMouseLeave={e => {
                const el = e.currentTarget as HTMLDivElement;
                el.style.transform = '';
                el.style.borderColor = 'var(--border)';
              }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: `${s.color}14`, border: `1px solid ${s.color}22`, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `inset 0 1px 0 rgba(255,255,255,0.6)` }}>
                  <s.icon size={16} color={s.color} />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ fontSize: 9.5, color: s.color, background: `${s.color}14`, border: `1px solid ${s.color}22`, padding: '2px 7px', borderRadius: 20, fontWeight: 600, letterSpacing: '0.2px' }}>{s.trend}</span>
                  <ArrowUpRight size={11} color={s.color} style={{ opacity: 0.6 }} />
                </div>
              </div>
              <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--text-1)', lineHeight: 1, marginBottom: 3, letterSpacing: '-0.5px', fontFamily: "'Alegreya Sans SC', system-ui" }}>{s.value}</div>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-1)', marginBottom: 1 }}>{s.label}</div>
              <div style={{ fontSize: 10.5, color: 'var(--text-3)' }}>{s.sub}</div>
            </motion.div>
          ))}
        </div>
      </div>

      {/* ── 3. SMART INSIGHTS — derived from your live data ────────────────── */}
      {smartInsights.length > 0 && (
        <div className="dash-section">
          <SectionHeader icon={Sparkles} color="#9333ea" title="Smart insights" eyebrow="AI-DERIVED" />
          <div className="dash-insight-strip">
            {smartInsights.map((ins, i) => (
              <motion.button key={ins.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 + i * 0.05 }}
                onClick={ins.onClick}
                className="dash-insight-card"
                style={{
                  ...S.card,
                  padding: '14px 16px',
                  cursor: ins.onClick ? 'pointer' : 'default',
                  textAlign: 'left',
                  fontFamily: 'inherit',
                  borderLeft: `3px solid ${ins.color}`,
                  display: 'flex',
                  flexDirection: 'column',
                  minHeight: 118,
                  width: '100%',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-2px)'; (e.currentTarget as HTMLButtonElement).style.boxShadow = `0 8px 22px ${ins.color}1f`; }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.transform = ''; (e.currentTarget as HTMLButtonElement).style.boxShadow = ''; }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                  <span style={{ width: 24, height: 24, borderRadius: 7, background: `${ins.color}1a`, color: ins.color, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <ins.icon size={12} />
                  </span>
                  <span style={{ fontSize: 9.5, color: ins.color, letterSpacing: '0.16em', fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ins.eyebrow}</span>
                </div>
                <div
                  title={ins.headline}
                  style={{
                    fontSize: 16,
                    fontWeight: 800,
                    color: 'var(--text-1)',
                    letterSpacing: '-0.3px',
                    lineHeight: 1.25,
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical' as const,
                    overflow: 'hidden',
                    wordBreak: 'break-word',
                  }}>{ins.headline}</div>
                <div
                  title={ins.sub}
                  style={{
                    fontSize: 11.5,
                    color: 'var(--text-3)',
                    marginTop: 'auto',
                    paddingTop: 8,
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical' as const,
                    overflow: 'hidden',
                    lineHeight: 1.4,
                  }}>{ins.sub}</div>
              </motion.button>
            ))}
          </div>
        </div>
      )}

      {/* ── 4. EMPTY STATE — only when zero memories ───────────────────────── */}
      {stats && totalMem === 0 && (
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          style={{
            position: 'relative',
            background: 'linear-gradient(135deg, rgba(59,130,246,0.10) 0%, rgba(34,211,238,0.06) 50%, rgba(129,140,248,0.08) 100%)',
            border: '1px solid rgba(59,130,246,0.28)',
            borderRadius: 18,
            padding: '24px 26px',
            marginBottom: 18,
            overflow: 'hidden',
            boxShadow: '0 8px 32px -10px rgba(59,130,246,0.25), inset 0 1px 0 rgba(255,255,255,0.06)',
          }}>
          <div aria-hidden style={{ position: 'absolute', top: -60, right: -60, width: 220, height: 220, background: 'radial-gradient(circle, rgba(59,130,246,0.22) 0%, transparent 70%)', pointerEvents: 'none' }} />
          <div style={{ position: 'relative', zIndex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <Sparkles size={14} color="var(--primary)" />
              <span style={{ fontSize: 10.5, letterSpacing: '0.18em', color: 'var(--primary)', fontWeight: 700 }}>GET STARTED</span>
            </div>
            <h2 style={{ margin: '0 0 6px', fontSize: 22, fontWeight: 700, color: 'var(--text-1)', letterSpacing: '-0.3px', lineHeight: 1.2 }}>
              Capture your first memory in 30 seconds
            </h2>
            <p style={{ margin: '0 0 18px', fontSize: 13, color: 'var(--text-2)', maxWidth: 560, lineHeight: 1.55 }}>
              Pick any source — your 7 AI agents will read, summarize, tag and link it to your knowledge graph automatically.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
              {[
                { label: 'Save a Website', sub: 'Paste a URL', icon: Globe, color: '#22d3ee', path: '/capture' },
                { label: 'YouTube Video', sub: 'Auto transcribe', icon: Youtube, color: '#ef4444', path: '/capture' },
                { label: 'Quick Note', sub: 'Type a thought', icon: StickyNote, color: '#10b981', path: '/capture' },
                { label: 'Ask Recall AI', sub: 'Try a question', icon: Bot, color: '#818cf8', path: '/recall' },
              ].map((t) => (
                <button key={t.label} onClick={() => navigate(t.path)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '11px 12px',
                    background: 'var(--surface)', border: '1px solid var(--border)',
                    borderRadius: 11, cursor: 'pointer', fontFamily: 'inherit',
                    transition: 'all 0.18s', textAlign: 'left',
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = `${t.color}66`; (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-2px)'; (e.currentTarget as HTMLButtonElement).style.boxShadow = `0 6px 18px ${t.color}22`; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border)'; (e.currentTarget as HTMLButtonElement).style.transform = ''; (e.currentTarget as HTMLButtonElement).style.boxShadow = 'none'; }}
                >
                  <div style={{ width: 32, height: 32, borderRadius: 9, background: `${t.color}1a`, border: `1px solid ${t.color}33`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <t.icon size={15} color={t.color} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-1)', lineHeight: 1.2 }}>{t.label}</div>
                    <div style={{ fontSize: 10.5, color: 'var(--text-3)', marginTop: 2 }}>{t.sub}</div>
                  </div>
                  <ArrowUpRight size={13} color="var(--text-3)" style={{ flexShrink: 0 }} />
                </button>
              ))}
            </div>
          </div>
        </motion.div>
      )}

      {/* ── 5. REVISIT REMINDERS ───────────────────────────────────────────── */}
      {(revisits.length > 0 || revisitsUpcoming.length > 0) && (
        <div className="dash-section">
          <SectionHeader
            icon={Bell}
            color="#f59e0b"
            title="Revisit reminders"
            eyebrow={revisits.length > 0 ? `${revisits.length} DUE NOW` : 'UPCOMING'}
            actionLabel="Manage all"
            onAction={() => navigate('/revisits')}
          />
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
            style={{ ...S.card, padding: '14px 16px', borderLeft: '3px solid #f59e0b' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[...revisits, ...revisitsUpcoming].slice(0, 5).map(rv => {
                const overdue = (rv.overdue_hours ?? 0) > 0;
                const dueIn = rv.due_in_hours;
                const meta = overdue
                  ? `Overdue by ${rv.overdue_hours < 24 ? rv.overdue_hours + 'h' : Math.round(rv.overdue_hours / 24) + 'd'}`
                  : dueIn != null
                    ? (dueIn < 24 ? `Due in ${Math.max(1, dueIn)}h` : `Due in ${Math.round(dueIn / 24)}d`)
                    : '';
                return (
                  <div key={rv.id} style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
                    background: 'var(--surface-2)', border: `1px solid ${overdue ? 'rgba(239,68,68,0.35)' : 'var(--border)'}`,
                    borderRadius: 10, minWidth: 0,
                  }}>
                    <div style={{ width: 30, height: 30, borderRadius: 8, background: overdue ? 'rgba(239,68,68,0.15)' : 'rgba(245,158,11,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <Bell size={13} color={overdue ? '#ef4444' : '#f59e0b'} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{rv.title}</div>
                      <div style={{ fontSize: 10.5, color: 'var(--text-3)', display: 'flex', gap: 8, alignItems: 'center', marginTop: 2 }}>
                        <span style={{ color: overdue ? '#ef4444' : 'var(--text-3)', fontWeight: 600 }}>{meta}</span>
                        <span>·</span>
                        <span style={{ textTransform: 'capitalize' }}>{String(rv.frequency || '').replace('_', ' ')}</span>
                      </div>
                    </div>
                    <button onClick={() => handleRevisitGo(rv)} title="Go to" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 11px', borderRadius: 8, border: 'none', cursor: 'pointer', background: 'linear-gradient(135deg,#f59e0b,#ef4444)', color: '#fff', fontSize: 11.5, fontWeight: 700, fontFamily: 'inherit' }}>
                      {rv.url ? <ExternalLink size={11} /> : <ChevronRight size={11} />} Go
                    </button>
                    <button onClick={() => handleRevisitDone(rv)} title="Mark done" style={dashIconBtn}><Check size={12} /></button>
                    <button onClick={() => handleRevisitSnooze(rv, 1)} title="Snooze 1 day" style={dashIconBtn}><RotateCw size={12} /></button>
                    <button onClick={() => handleRevisitPause(rv)} title="Pause" style={dashIconBtn}><PauseCircle size={12} /></button>
                  </div>
                );
              })}
            </div>
          </motion.div>
        </div>
      )}

      {/* ── 6. TODAY'S FOCUS + PICK UP WHERE YOU LEFT OFF ──────────────────── */}
      {(adv?.today_focus?.length || adv?.pick_up) && (
        <div className="dash-section">
          <SectionHeader icon={Target} color="#6366f1" title="What to do next" eyebrow="AUTO-RANKED" />
          <div className="dash-grid-2">
            {adv?.today_focus && adv.today_focus.length > 0 && (
              <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
                style={{ ...S.card, padding: '16px 18px', borderLeft: '3px solid #6366f1' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Target size={13} color="#6366f1" />
                    <div style={{ color: 'var(--text-1)', fontWeight: 700, fontSize: 13 }}>Today's focus · top {adv.today_focus.length}</div>
                  </div>
                  <span style={{ fontSize: 10, color: 'var(--text-3)' }}>by urgency</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {adv.today_focus.map((item, i) => (
                    <div key={`${item.kind}-${item.id || i}`}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
                        background: 'var(--surface-2)', border: `1px solid var(--border)`,
                        borderRadius: 10, minWidth: 0,
                      }}>
                      <div style={{ width: 22, height: 22, borderRadius: 6, background: `${item.color}1a`, color: item.color, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 11, fontWeight: 800 }}>{i + 1}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ textTransform: 'uppercase', fontSize: 9, letterSpacing: '0.1em', color: item.color, fontWeight: 700 }}>{item.kind}</span>
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: 1 }}>{item.title}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 1 }}>{item.subtitle}</div>
                      </div>
                      <button onClick={() => handleFocusAction(item)}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 11px', borderRadius: 8, border: 'none', cursor: 'pointer', background: item.color, color: '#fff', fontSize: 11.5, fontWeight: 700, fontFamily: 'inherit' }}>
                        {item.action_label} <ArrowUpRight size={11} />
                      </button>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}

            {adv?.pick_up && (
              <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
                role="button" tabIndex={0}
                aria-label={`Pick up where you left off: ${adv.pick_up.title}`}
                onClick={() => navigate(`/memory/${adv.pick_up!.id}`)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(`/memory/${adv.pick_up!.id}`); } }}
                style={{ ...S.card, padding: '16px 18px', cursor: 'pointer', borderLeft: '3px solid #10b981' }}
                onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-2px)'; (e.currentTarget as HTMLDivElement).style.boxShadow = '0 8px 24px rgba(16,185,129,0.18)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.transform = ''; (e.currentTarget as HTMLDivElement).style.boxShadow = ''; }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                  <History size={13} color="#10b981" />
                  <div style={{ color: 'var(--text-1)', fontWeight: 700, fontSize: 13 }}>Pick up where you left off</div>
                </div>
                <div style={{ fontSize: 9.5, letterSpacing: '0.16em', color: '#10b981', textTransform: 'uppercase', fontWeight: 700, marginBottom: 6 }}>
                  {adv.pick_up.suggestion}
                </div>
                <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-1)', lineHeight: 1.25, marginBottom: 6 }}>
                  {adv.pick_up.title}
                </div>
                {adv.pick_up.summary && (
                  <p style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.5, margin: '0 0 12px', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' as const, overflow: 'hidden' }}>
                    {adv.pick_up.summary}
                  </p>
                )}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  {adv.pick_up.domain && (
                    <span style={{ fontSize: 10, color: '#6366f1', background: 'rgba(99,102,241,0.1)', padding: '2px 8px', borderRadius: 999, fontWeight: 600 }}>{adv.pick_up.domain}</span>
                  )}
                  {adv.pick_up.source_type && (
                    <span style={{ fontSize: 10, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 600 }}>{adv.pick_up.source_type}</span>
                  )}
                  <div style={{ marginLeft: 'auto', color: '#10b981', fontSize: 11.5, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    Resume <ArrowUpRight size={12} />
                  </div>
                </div>
              </motion.div>
            )}
          </div>
        </div>
      )}

      {/* ── 7. ACTIVITY INSIGHTS — Heatmap + 7-day Forecast ────────────────── */}
      {(adv?.activity_heatmap?.cells?.length || adv?.forecast_7d?.length) && (
        <div className="dash-section">
          <SectionHeader icon={Activity} color="#06b6d4" title="Activity & forecast" eyebrow="LAST 12W · NEXT 7D" />
          <div className="dash-grid-2">
            {adv?.activity_heatmap && adv.activity_heatmap.cells.length > 0 && (
              <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} style={{ ...S.card, padding: '16px 18px', borderLeft: '3px solid #06b6d4' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Activity size={13} color="#06b6d4" />
                      <div style={{ color: 'var(--text-1)', fontWeight: 700, fontSize: 13 }}>Capture heatmap</div>
                    </div>
                    <div style={{ color: 'var(--text-3)', fontSize: 11, marginTop: 2 }}>Last 12 weeks</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: 'var(--text-3)' }}>
                    Less
                    {[0, 0.25, 0.5, 0.75, 1].map((s) => (
                      <span key={s} style={{
                        width: 10, height: 10, borderRadius: 2,
                        background: s === 0 ? 'var(--surface-2)' : `rgba(6,182,212,${0.18 + s * 0.6})`,
                        border: '1px solid var(--border)',
                      }} />
                    ))}
                    More
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.ceil(adv.activity_heatmap.cells.length / 7)}, minmax(8px, 1fr))`, gridAutoFlow: 'column', gridTemplateRows: 'repeat(7, 14px)', gap: 3 }}>
                  {(() => {
                    const cells = adv.activity_heatmap!.cells;
                    const max = adv.activity_heatmap!.max || 1;
                    const first = cells[0];
                    const firstWd = first?.weekday ?? 0;
                    const pads = Array.from({ length: firstWd }, (_, i) => ({ pad: true, key: `pad-${i}` }));
                    return [
                      ...pads.map(p => <div key={p.key} style={{ background: 'transparent' }} />),
                      ...cells.map(c => {
                        const intensity = c.count === 0 ? 0 : Math.max(0.18, Math.min(1, c.count / max));
                        return (
                          <div key={c.date}
                            title={`${c.date} — ${c.count} capture${c.count === 1 ? '' : 's'}`}
                            style={{
                              width: '100%', height: 14, borderRadius: 3,
                              background: c.count === 0 ? 'var(--surface-2)' : `rgba(6,182,212,${0.2 + intensity * 0.6})`,
                              border: '1px solid var(--border)',
                              cursor: 'default', transition: 'transform 0.12s',
                            }}
                            onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.transform = 'scale(1.35)'; }}
                            onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.transform = ''; }}
                          />
                        );
                      }),
                    ];
                  })()}
                </div>
              </motion.div>
            )}

            {adv?.forecast_7d && adv.forecast_7d.length > 0 && (
              <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} style={{ ...S.card, padding: '16px 18px', borderLeft: '3px solid #9333ea' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <CalendarClock size={13} color="#9333ea" />
                  <div style={{ color: 'var(--text-1)', fontWeight: 700, fontSize: 13 }}>Coming up · next 7 days</div>
                </div>
                <div style={{ color: 'var(--text-3)', fontSize: 11, marginBottom: 10 }}>Revisits + tasks scheduled</div>
                <Suspense fallback={<ChartPlaceholder height={160} />}>
                  <ForecastBarChart data={adv.forecast_7d} />
                </Suspense>
                <div style={{ display: 'flex', gap: 14, marginTop: 4, fontSize: 11 }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ width: 9, height: 9, borderRadius: 2, background: '#f59e0b' }} /> Revisits
                  </span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ width: 9, height: 9, borderRadius: 2, background: '#9333ea' }} /> Tasks
                  </span>
                </div>
              </motion.div>
            )}
          </div>
        </div>
      )}

      {/* ── 8. KNOWLEDGE — Topics + Domains (radar + list combined) ────────── */}
      <div className="dash-section">
        <SectionHeader
          icon={Network}
          color="#6366f1"
          title="Your knowledge map"
          eyebrow="TOPICS · DOMAINS"
          actionLabel="Open vault"
          onAction={() => navigate('/vault')}
        />
        <div className="dash-grid-2">
          {/* Top topics tag cloud */}
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
            style={{ ...S.card, padding: '16px 18px', borderLeft: '3px solid #06b6d4' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <Tag size={13} color="#06b6d4" />
              <div style={{ color: 'var(--text-1)', fontWeight: 700, fontSize: 13 }}>Top topics</div>
              <span style={{ fontSize: 10, color: 'var(--text-3)' }}>by frequency</span>
            </div>
            {adv?.top_tags && adv.top_tags.length > 0 ? (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
                {adv.top_tags.map((t) => {
                  const sz = 10 + t.weight * 6;
                  const op = 0.45 + t.weight * 0.55;
                  return (
                    <button key={t.tag} onClick={() => navigate(`/vault?q=${encodeURIComponent(t.tag)}`)}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 5,
                        padding: '5px 11px', borderRadius: 999, cursor: 'pointer',
                        background: `rgba(6,182,212,${0.06 + t.weight * 0.08})`,
                        border: `1px solid rgba(6,182,212,${0.18 + t.weight * 0.25})`,
                        color: 'var(--text-1)', fontSize: sz, fontWeight: 600,
                        fontFamily: 'inherit', opacity: op, transition: 'all 0.12s',
                      }}
                      onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-1px)'; (e.currentTarget as HTMLButtonElement).style.opacity = '1'; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.transform = ''; (e.currentTarget as HTMLButtonElement).style.opacity = String(op); }}>
                      <Hash size={Math.round(sz * 0.7)} color="#06b6d4" /> {t.tag}
                      <span style={{ fontSize: 10, color: 'var(--text-3)', fontWeight: 500 }}>{t.count}</span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--text-3)', fontSize: 12 }}>Tag your captures to see your top topics</div>
            )}
          </motion.div>

          {/* Combined: radar + domain list — single panel */}
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
            style={{ ...S.card, padding: '16px 18px', borderLeft: '3px solid #6366f1' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <Network size={13} color="#6366f1" />
              <div style={{ color: 'var(--text-1)', fontWeight: 700, fontSize: 13 }}>Knowledge domains</div>
              <span style={{ fontSize: 10, color: 'var(--text-3)' }}>{domains.length} active</span>
            </div>
            {domains.length > 0 ? (
              <div className="dash-domains-grid" style={{ display: 'grid', gridTemplateColumns: '140px minmax(0, 1fr)', gap: 14, alignItems: 'center' }}>
                <Suspense fallback={<ChartPlaceholder height={140} />}>
                  <DomainsRadarChart data={radarData} />
                </Suspense>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
                  {domains.slice(0, 5).map((d: any, i: number) => {
                    const pct = Math.round((d.value / (totalMem || 1)) * 100);
                    const clr = DOMAIN_COLORS[i % DOMAIN_COLORS.length];
                    return (
                      <div key={d.name}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                          <span style={{ color: 'var(--text-2)', fontSize: 11.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.name}</span>
                          <span style={{ color: clr, fontSize: 11, fontWeight: 600 }}>{d.value}</span>
                        </div>
                        <div style={{ height: 4, background: 'var(--surface-3)', borderRadius: 4, overflow: 'hidden' }}>
                          <motion.div initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.6, delay: 0.3 + i * 0.07 }}
                            style={{ height: '100%', borderRadius: 4, background: clr }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--text-3)', fontSize: 12 }}>Start capturing to see your domain spread</div>
            )}
          </motion.div>
        </div>
      </div>

      {/* ── 9. RECENT ACTIVITY — Memories + AI Interactions ────────────────── */}
      <div className="dash-section">
        <SectionHeader icon={History} color="#9333ea" title="Recent activity" eyebrow="LAST CAPTURES + QUERIES" />
        <div className="dash-grid-2">
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} style={{ ...S.card, padding: '16px 18px', overflow: 'hidden', borderLeft: '3px solid #6366f1' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Brain size={13} color="#6366f1" />
                <div style={{ color: 'var(--text-1)', fontWeight: 700, fontSize: 13 }}>Recent memories</div>
              </div>
              <button onClick={() => navigate('/insights?view=timeline')} className="dash-action-link" style={{ color: '#6366f1' }}>
                View all <ArrowUpRight size={11} />
              </button>
            </div>
            {recent.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {recent.map((mem) => {
                  const Icon = SRC_ICON[mem.source_type] ?? Brain;
                  const clr = SRC_CLR[mem.source_type] ?? '#6366f1';
                  return (
                    <div key={mem.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 11px', borderRadius: 9, background: 'var(--surface-2)', border: '1px solid var(--border)', transition: 'all 0.15s', cursor: 'default', overflow: 'hidden', minWidth: 0 }}
                      onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--primary-border)'; (e.currentTarget as HTMLDivElement).style.background = 'var(--primary-bg)'; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border)'; (e.currentTarget as HTMLDivElement).style.background = 'var(--surface-2)'; }}>
                      <div style={{ width: 28, height: 28, borderRadius: 8, background: `${clr}15`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <Icon size={12} color={clr} />
                      </div>
                      <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
                        <div style={{ color: 'var(--text-1)', fontSize: 12.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{mem.title}</div>
                        <div style={{ color: 'var(--text-3)', fontSize: 11, marginTop: 2, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical' as const, lineHeight: 1.4 }}>{mem.summary}</div>
                      </div>
                      <span style={{ fontSize: 9, color: clr, background: `${clr}15`, padding: '2px 6px', borderRadius: 20, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.4px', whiteSpace: 'nowrap', flexShrink: 0 }}>{mem.source_type}</span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={{ padding: '28px 0', textAlign: 'center' }}>
                <Brain size={28} color="var(--text-3)" style={{ margin: '0 auto 10px' }} />
                <p style={{ color: 'var(--text-3)', fontSize: 12.5, margin: 0 }}>No memories yet</p>
                <button onClick={() => navigate('/capture')} style={{ marginTop: 8, color: '#6366f1', fontSize: 12, background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>Capture your first memory →</button>
              </div>
            )}
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} style={{ ...S.card, padding: '16px 18px', overflow: 'hidden', borderLeft: '3px solid #9333ea' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Bot size={13} color="#9333ea" />
                <div style={{ color: 'var(--text-1)', fontWeight: 700, fontSize: 13 }}>Recent AI interactions</div>
              </div>
              <button onClick={() => navigate('/recall')} className="dash-action-link" style={{ color: '#9333ea' }}>
                Open Recall <ArrowUpRight size={11} />
              </button>
            </div>
            {logs.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {logs.map((log, i) => (
                  <div key={i} style={{ padding: '9px 12px', borderRadius: 8, background: 'var(--surface-2)', border: '1px solid var(--border)', overflow: 'hidden', minWidth: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 3, gap: 8 }}>
                      <span style={{ color: 'var(--text-1)', fontSize: 12, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>{log.user_message}</span>
                      <span style={{ color: 'var(--text-3)', fontSize: 10, flexShrink: 0, whiteSpace: 'nowrap' }}>{new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                    <p style={{ color: 'var(--text-2)', fontSize: 11, margin: 0, fontStyle: 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>"{log.reply}"</p>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--text-3)', fontSize: 12 }}>No queries yet — try asking Recall AI a question</div>
            )}
          </motion.div>
        </div>
      </div>

      {/* ── 10. WEEKLY LEARNING GOALS ──────────────────────────────────────── */}
      <div className="dash-section">
        <SectionHeader icon={Trophy} color="#f59e0b" title="Weekly goals" eyebrow="THIS WEEK" />
        <div>
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} style={{ ...S.card, padding: '16px 18px', borderLeft: '3px solid #f59e0b' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Trophy size={13} color="#f59e0b" />
                <div style={{ color: 'var(--text-1)', fontWeight: 700, fontSize: 13 }}>Learning goals</div>
              </div>
              <span style={{ padding: '3px 9px', background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.25)', borderRadius: 999, fontSize: 10, color: '#f59e0b', fontWeight: 700 }}>This week</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {[
                { label: 'Knowledge captures', current: totalMem, target: 20, color: '#6366f1' },
                { label: 'AI recall sessions', current: stats?.ai_interactions ?? 0, target: 10, color: '#9333ea' },
                { label: 'Flashcard reviews', current: stats?.flashcards ?? 0, target: 15, color: '#f59e0b' },
                { label: 'Tasks completed', current: Math.max(0, (stats?.total_tasks ?? 0) - (stats?.pending_tasks ?? 0)), target: 8, color: '#10b981' },
              ].map((goal) => {
                const pct = Math.min(100, Math.round((goal.current / goal.target) * 100));
                return (
                  <div key={goal.label}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                      <span style={{ color: 'var(--text-2)', fontSize: 12, fontWeight: 500 }}>{goal.label}</span>
                      <span style={{ color: pct >= 100 ? '#10b981' : 'var(--text-3)', fontSize: 11, fontWeight: 600 }}>{goal.current}/{goal.target}</span>
                    </div>
                    <div style={{ height: 6, background: 'var(--surface-3)', borderRadius: 6, overflow: 'hidden', border: '1px solid var(--border)' }}>
                      <motion.div initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.7, delay: 0.2 }}
                        style={{ height: '100%', borderRadius: 6, background: pct >= 100 ? '#10b981' : goal.color, boxShadow: `0 0 8px ${goal.color}40` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </motion.div>

        </div>
      </div>
    </div>
  );
};

export default Dashboard;
