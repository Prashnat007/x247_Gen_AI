import React, { useState, useEffect, useRef, useCallback, Component, Suspense, lazy } from 'react';

// ── Global Error Boundary ────────────────────────────────────────────────────
// Catches React render errors that would otherwise blank the entire page.
// Shows an inline recovery card so the user can reload without losing context.
interface EBState { hasError: boolean; message: string }
class ErrorBoundary extends Component<React.PropsWithChildren, EBState> {
  constructor(props: React.PropsWithChildren) {
    super(props);
    this.state = { hasError: false, message: '' };
  }
  static getDerivedStateFromError(err: unknown): EBState {
    const message = err instanceof Error ? err.message : String(err);
    return { hasError: true, message };
  }
  componentDidCatch(err: unknown, info: React.ErrorInfo) {
    console.error('[ErrorBoundary]', err, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', minHeight: '60vh', gap: 16, padding: 32,
          fontFamily: 'inherit', color: 'var(--text-1)',
        }}>
          <div style={{ fontSize: 36 }}>⚠️</div>
          <div style={{ fontWeight: 700, fontSize: 18 }}>Something went wrong loading this page</div>
          <div style={{
            fontSize: 13, color: 'var(--text-3)', maxWidth: 420, textAlign: 'center',
            background: 'var(--surface-2)', padding: '10px 16px', borderRadius: 8,
            border: '1px solid var(--border)', wordBreak: 'break-word',
          }}>
            {this.state.message || 'An unexpected error occurred.'}
          </div>
          <button
            onClick={() => this.setState({ hasError: false, message: '' })}
            style={{
              padding: '8px 20px', borderRadius: 8, border: 'none', cursor: 'pointer',
              background: 'var(--primary)', color: '#fff', fontWeight: 600, fontSize: 14,
            }}
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
import {
  BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate
} from 'react-router-dom';
import { CaptureSuggestionsProvider } from './contexts/CaptureSuggestionsContext';
import { LinkerProvider, useLinker } from './contexts/LinkerContext';
import CommandPalette from './components/CommandPalette';
import {
  Brain, Search, CheckSquare, Calendar as CalendarIcon, LayoutDashboard, Plus,
  Database, Bot, Network, GitBranch, BarChart2, FlipHorizontal,
  Settings, ChevronLeft, ChevronDown, ChevronRight, LogOut, Menu, Moon, Sun, Cpu, Presentation,
  CheckCircle2, AlertTriangle, Info, X, StickyNote, Globe, Zap, HelpCircle,
  Plug, Bookmark, Flame, GraduationCap, Compass, Bell, Kanban, Pin,
  Library, Target, Sparkles
} from 'lucide-react';
// Heavy, conditionally-rendered components are lazy-loaded so they don't
// land in the entry chunk. The tour only mounts when the user opens it,
// the briefing notifier polls in the background.
const OnboardingTour = lazy(() => import('./components/OnboardingTour'));
const BriefingNotifier = lazy(() => import('./components/BriefingNotifier'));
import AutoGrowTextarea from './components/AutoGrowTextarea';
import { onAuthStateChanged } from 'firebase/auth';
import {
  auth,
  signInWithGoogle,
  signUpWithEmail,
  signInWithEmail,
  resetPassword,
  checkRedirectResult,
  signOut as firebaseSignOut,
} from './lib/firebase';
import { motion, AnimatePresence } from 'motion/react';
// ── Route-level code splitting ─────────────────────────────────────────────
// Every page is its own lazy chunk so first-paint only ships the route the
// user actually landed on (plus shared vendor chunks). Navigating to a new
// page fetches that page's chunk on demand; <RouteSuspense> below paints a
// thin progress strip while the chunk is in flight.
const Landing = lazy(() => import('./pages/Landing'));
const Login = lazy(() => import('./pages/Login'));
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const DailyBriefingPage = lazy(() => import('./pages/DailyBriefingPage'));
const AgentPage = lazy(() => import('./pages/AgentPage'));
const CapturePage = lazy(() => import('./pages/CapturePage'));
// Note: VaultPage, NotesPage, BookmarksPage, TasksPage, HabitsPage,
// FlashcardsPage, RevisitsPage, TimelinePage, GraphPage, AnalyticsPage,
// StudyPlanPage are all reached via /library, /focus, /learn, /insights
// hubs — they no longer have their own top-level <Route> entries. Anything
// not used directly here is imported lazily inside its hub.
const RecallPage = lazy(() => import('./pages/RecallPage'));
const CalendarPage = lazy(() => import('./pages/CalendarPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const WorkspacePage = lazy(() => import('./pages/WorkspacePage'));
const MemoryDetailPage = lazy(() => import('./pages/MemoryDetailPage'));
const SessionDetailPage = lazy(() => import('./pages/SessionDetailPage'));
const DeckPage = lazy(() => import('./pages/DeckPage'));
const ProfilePage = lazy(() => import('./pages/ProfilePage'));
const IntegrationsPage = lazy(() => import('./pages/IntegrationsPage'));
const SharePage = lazy(() => import('./pages/SharePage'));
const DiscoverPage = lazy(() => import('./pages/DiscoverPage'));
const LibraryPage = lazy(() => import('./pages/LibraryPage'));
const FocusPage = lazy(() => import('./pages/FocusPage'));
const LearnPage = lazy(() => import('./pages/LearnPage'));
const InsightsPage = lazy(() => import('./pages/InsightsPage'));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'));
const PageSpecialistDock = lazy(() => import('./components/PageSpecialistDock'));
import PageBreadcrumbs from './components/PageBreadcrumbs';
import './pages/pages.css';

// ── ChunkErrorBoundary ──────────────────────────────────────────────────────
// When a deploy ships a new build, hashed chunk filenames change. Tabs that
// were already open will request a stale chunk that 404s. Catch the resulting
// dynamic-import error here and trigger a single hard reload so the browser
// re-fetches the new index.html and resolves the new chunk names. Without
// this, the user just sees a blank page after a deploy.
class ChunkErrorBoundary extends Component<
  React.PropsWithChildren,
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError(err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/Loading chunk|Failed to fetch dynamically imported module|ChunkLoadError|Importing a module script failed/i.test(msg)) {
      // Reload once per session so we don't loop forever on a real error.
      try {
        if (!sessionStorage.getItem('chunk-reload-once')) {
          sessionStorage.setItem('chunk-reload-once', '1');
          window.location.reload();
          return { hasError: true };
        }
      } catch {
        window.location.reload();
        return { hasError: true };
      }
    }
    return { hasError: true };
  }
  componentDidCatch(err: unknown) {
    console.error('[ChunkErrorBoundary]', err);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-2)' }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>This page didn't load.</div>
          <button
            onClick={() => { try { sessionStorage.removeItem('chunk-reload-once'); } catch {} window.location.reload(); }}
            style={{ padding: '8px 16px', borderRadius: 8, border: 'none', cursor: 'pointer', background: 'var(--primary)', color: '#fff', fontWeight: 600 }}
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── RouteSuspense fallback ──────────────────────────────────────────────────
// Shows the x247 logo with bouncing dots while lazy routes load.
const RouteSuspenseFallback = () => (
  <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#03080f' }}>
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 24 }}>
      <img src="/x247-logo.webp" alt="x247 AI" width={785} height={421} decoding="async" fetchPriority="high" style={{ width: 'clamp(120px,15vw,180px)', height: 'auto', userSelect: 'none' }} draggable={false} />
      <div style={{ display: 'flex', gap: 6 }}>
        {[0,1,2].map(i => <div key={i} style={{ width: 5, height: 5, borderRadius: '50%', background: 'rgba(255,255,255,0.42)', animation: `bounce 1.1s ease-in-out ${i*0.15}s infinite` }} />)}
      </div>
    </div>
  </div>
);

// ── Single neon green accent for entire app ──────
const NEON = '#c5f82a';

// ── Core nav — the 5 daily-driver pages, each with a keyboard shortcut ──────
const CORE_NAV = [
  { id: 'dashboard', label: 'Dashboard',      desc: 'Your daily overview',         path: '/dashboard', icon: LayoutDashboard, color: NEON, shortcut: '1' },
  { id: 'briefing',  label: 'Daily Briefing', desc: 'Today, with audio & actions', path: '/briefing',  icon: Sparkles,        color: NEON, shortcut: '2' },
  { id: 'library',   label: 'Library',        desc: 'Vault, notes, files & inbox', path: '/library',   icon: Library,         color: NEON, shortcut: '3' },
  { id: 'recall',    label: 'Recall AI',      desc: 'Ask & get answers',           path: '/recall',    icon: Bot,             color: NEON, shortcut: '4' },
  { id: 'agent',     label: 'Agent Hub',      desc: 'Multi-agent workflows',       path: '/agent',     icon: Cpu,             color: NEON, shortcut: '5' },
];

// ── Tools nav — workspace + learning destinations, always flat ──────────────
const TOOLS_NAV = [
  { id: 'workspace', label: 'Projects',  path: '/workspace', icon: Kanban,        color: NEON },
  { id: 'focus',     label: 'Focus',     path: '/focus',     icon: Target,        color: NEON },
  { id: 'calendar',  label: 'Calendar',  path: '/calendar',  icon: CalendarIcon,  color: NEON },
  { id: 'learn',     label: 'Learn',     path: '/learn',     icon: GraduationCap, color: NEON },
  { id: 'discover',  label: 'Discover',  path: '/discover',  icon: Compass,       color: NEON },
  { id: 'insights',  label: 'Insights',  path: '/insights',  icon: BarChart2,     color: NEON },
];

// ── System nav — settings & integrations ─────────────────
const SYSTEM_NAV = [
  { id: 'settings',     label: 'Settings',     path: '/settings',     icon: Settings, color: NEON },
  { id: 'integrations', label: 'Integrations', path: '/integrations', icon: Plug,     color: NEON },
];

// ── SidebarNavItem — defined at module level so React never sees a new
// component type on re-render, which would reset the nav scroll position.
interface SidebarNavItemProps {
  id: string; label: string; path: string; icon: React.ElementType;
  color: string; shortcut?: string; desc?: string;
  isCollapsed: boolean; active: boolean;
  navigate: (to: string) => void;
  badgeCount?: number;
  badgeCapped?: boolean;
  badgeTitle?: string;
}
const SidebarNavItem = React.memo(({
  id, label, path, icon: Icon, color, shortcut, desc, isCollapsed, active, navigate,
  badgeCount, badgeCapped, badgeTitle,
}: SidebarNavItemProps) => {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={() => navigate(path)}
      title={isCollapsed ? label : undefined}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: isCollapsed ? '10px 0' : '10px 14px',
        borderRadius: 8, border: 'none',
        background: active ? 'rgba(197, 248, 42, 0.1)' : hovered ? 'rgba(255,255,255,0.03)' : 'transparent',
        cursor: 'pointer',
        transition: 'all 0.15s ease',
        position: 'relative',
        justifyContent: isCollapsed ? 'center' : 'flex-start',
        width: '100%', marginBottom: 1, fontFamily: 'inherit',
      }}>
      {/* Left accent bar for active state */}
      {active && (
        <div style={{
          position: 'absolute', left: 0, top: '20%', bottom: '20%', width: 2,
          background: NEON,
          borderRadius: '0 2px 2px 0',
        }} />
      )}
      {/* Icon */}
      <Icon 
        size={18} 
        color={active ? NEON : hovered ? '#ffffff' : 'var(--text-3)'} 
        strokeWidth={1.5} 
        style={{ flexShrink: 0, transition: 'color 0.15s ease' }}
      />
      {/* Label - only when expanded */}
      {!isCollapsed && (
        <span style={{
          color: active ? '#ffffff' : hovered ? '#ffffff' : 'var(--text-2)',
          fontSize: 13, fontWeight: active ? 600 : 400,
          letterSpacing: '-0.1px',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          transition: 'color 0.15s ease',
        }}>{label}</span>
      )}
      {/* Badge - minimal neon dot */}
      {!isCollapsed && badgeCount !== undefined && badgeCount > 0 && (
        <span
          data-testid={`sidebar-badge-${id}`}
          title={badgeTitle ?? `${badgeCount} items`}
          style={{
            fontSize: 9, fontWeight: 600, color: '#0a0a0a',
            background: NEON,
            borderRadius: 999, padding: '2px 6px', flexShrink: 0,
            marginLeft: 'auto',
          }}
        >
          {badgeCount > 99 ? '99+' : badgeCount}
        </span>
      )}
    </button>
  );
});
SidebarNavItem.displayName = 'SidebarNavItem';

// Minimal section divider
const SidebarSectionLabel = React.memo(({ label, isCollapsed }: { label: string; isCollapsed: boolean }) => (
  !isCollapsed ? (
    <div style={{ padding: '16px 14px 6px' }}>
      <span style={{ 
        color: 'var(--text-3)', 
        fontSize: 10, 
        fontWeight: 500, 
        letterSpacing: '0.5px', 
        textTransform: 'uppercase',
      }}>{label}</span>
    </div>
  ) : (
    <div style={{ height: 1, background: 'var(--border)', margin: '12px 8px', opacity: 0.5 }} />
  )
));
SidebarSectionLabel.displayName = 'SidebarSectionLabel';

const Sidebar = ({
  isCollapsed, setIsCollapsed, user, onSignOut,
}: {
  isCollapsed: boolean; setIsCollapsed: (v: boolean) => void;
  user: { displayName?: string; email?: string; photoURL?: string; isAnonymous?: boolean; isGuest?: boolean } | null;
  onSignOut: () => void;
}) => {
  const location = useLocation();
  const navigate = useNavigate();
  const navRef = useRef<HTMLElement>(null);
  const [canScrollDown, setCanScrollDown] = useState(false);
  const [inboxCount, setInboxCount] = useState(0);
  const [inboxCapped, setInboxCapped] = useState(false);

  const checkScroll = useCallback(() => {
    const el = navRef.current;
    if (!el) return;
    setCanScrollDown(el.scrollHeight - el.scrollTop - el.clientHeight > 8);
  }, []);

  useEffect(() => {
    checkScroll();
    const el = navRef.current;
    if (!el) return;
    el.addEventListener('scroll', checkScroll);
    window.addEventListener('resize', checkScroll);
    return () => { el.removeEventListener('scroll', checkScroll); window.removeEventListener('resize', checkScroll); };
  }, [checkScroll, isCollapsed]);

  // ── Inbox-count badge ────────────────────────────────────────────────
  // Cheap counts-only fetch. Refreshes on:
  //   1. Mount
  //   2. Window/tab focus (covers returning from another tab)
  //   3. A custom 'inbox-count-refresh' event (fired after capture / review /
  //      archive in LibraryInboxTab and other capture entry points)
  // No long-lived connections, no polling timer.
  useEffect(() => {
    let cancelled = false;
    const fetchCount = async () => {
      try {
        const res = await fetch('/memories/inbox-count');
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        const n = Number(data?.count) || 0;
        setInboxCount(n);
        setInboxCapped(Boolean(data?.capped));
      } catch {
        // Silent — the badge is non-critical, keep the previous value.
      }
    };
    fetchCount();
    const onFocus = () => { fetchCount(); };
    const onVisibility = () => { if (document.visibilityState === 'visible') fetchCount(); };
    const onRefresh = () => { fetchCount(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('inbox-count-refresh', onRefresh);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('inbox-count-refresh', onRefresh);
    };
  }, []);

  const isActive = (path: string) =>
    location.pathname === path || (path === '/dashboard' && location.pathname === '/');

  // Active nav entry — used by the collapsed-mode "you are here" cue so the
  // user can tell which page they're on without expanding the sidebar.
  // Detail / sub-routes (e.g. /memory/:id, /capture, /profile) don't have
  // their own sidebar slot, so they fall back to their owning section so
  // the cue is still present.
  const allNav = [...CORE_NAV, ...TOOLS_NAV, ...SYSTEM_NAV];
  const findNavById = (id: string) => allNav.find(n => n.id === id);
  const ROUTE_FALLBACKS: Array<{ prefix: string; id: string }> = [
    { prefix: '/memory',  id: 'library' },
    { prefix: '/session', id: 'library' },
    { prefix: '/capture', id: 'library' },
    { prefix: '/deck',    id: 'learn' },
    { prefix: '/profile', id: 'settings' },
  ];
  const activeNav =
    allNav.find(n => isActive(n.path)) ||
    (() => {
      const match = ROUTE_FALLBACKS.find(r => location.pathname.startsWith(r.prefix));
      return match ? findNavById(match.id) : undefined;
    })();

  // Per-nav badge map. Today only Library carries the Inbox-waiting count,
  // but the SidebarNavItem already accepts badgeCount/badgeCapped so adding
  // future badges (e.g. Briefing unread) is a one-line change here.
  const badgeFor = (id: string): { count?: number; capped?: boolean; title?: string } => {
    if (id === 'library' && inboxCount > 0) {
      return {
        count: inboxCount,
        capped: inboxCapped,
        title: `${inboxCount}${inboxCapped ? '+' : ''} item${inboxCount === 1 ? '' : 's'} waiting in your Inbox`,
      };
    }
    return {};
  };

  return (
    <div style={{ width: '100%', minWidth: 0, height: '100%', background: 'var(--surface)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* ── Header: logo + collapse toggle ─────────────────────────────────── */}
      <div style={{
        padding: isCollapsed ? '10px 0' : '13px 14px',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        flexDirection: isCollapsed ? 'column' : 'row',
        alignItems: 'center',
        justifyContent: isCollapsed ? 'center' : 'space-between',
        gap: isCollapsed ? 6 : 0,
        flexShrink: 0, minHeight: 54,
      }}>
        {isCollapsed ? (
          <>
            {/* Active page icon when collapsed */}
            {activeNav && (() => {
              const ActiveIcon = activeNav.icon;
              return (
                <div
                  data-testid="sidebar-active-cue"
                  title={activeNav.label}
                  style={{
                    width: 32, height: 32, borderRadius: 8,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: 'rgba(197, 248, 42, 0.1)',
                    flexShrink: 0,
                  }}
                >
                  <ActiveIcon size={16} color={NEON} strokeWidth={1.5} />
                </div>
              );
            })()}
            <button onClick={() => setIsCollapsed(false)} title="Expand sidebar"
              data-testid="sidebar-expand-toggle"
              style={{ background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 7, borderRadius: 8, color: 'var(--text-3)', transition: 'all 0.15s' }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--surface-2)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-1)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-3)'; }}>
              <ChevronRight size={15} strokeWidth={2} />
            </button>
          </>
        ) : (
          <>
            <img src="/x247-logo.webp" alt="x247 AI" className="x247-logo-img" draggable={false} width={785} height={421} decoding="async" style={{ height: 22, width: 'auto' }} />
            <button onClick={() => setIsCollapsed(true)} title="Collapse sidebar"
              data-testid="sidebar-collapse-toggle"
              style={{ background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 7, borderRadius: 8, color: 'var(--text-3)', transition: 'all 0.15s', flexShrink: 0 }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--surface-2)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-1)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-3)'; }}>
              <ChevronLeft size={15} strokeWidth={2} />
            </button>
          </>
        )}
      </div>

      {/* ── Scrollable nav area ─────────────────────────────────────────────── */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <nav ref={navRef} style={{ flex: 1, padding: '6px 6px 8px', overflowY: 'auto', overflowX: 'hidden' }} className="sidebar-nav">

          {/* Core destinations */}
          <div style={{ height: 4 }} />
          {CORE_NAV.map(item => {
            const badge = badgeFor(item.id);
            return (
              <SidebarNavItem
                key={item.id}
                {...item}
                isCollapsed={isCollapsed}
                navigate={navigate}
                active={isActive(item.path)}
                badgeCount={badge.count}
                badgeCapped={badge.capped}
                badgeTitle={badge.title}
              />
            );
          })}

          {/* Tools section */}
          <SidebarSectionLabel label="Tools" isCollapsed={isCollapsed} />
          {TOOLS_NAV.map(item => (
            <SidebarNavItem key={item.id} {...item} isCollapsed={isCollapsed} navigate={navigate} active={isActive(item.path)} />
          ))}

          {/* System section */}
          <SidebarSectionLabel label="System" isCollapsed={isCollapsed} />
          {SYSTEM_NAV.map(item => (
            <SidebarNavItem key={item.id} {...item} isCollapsed={isCollapsed} navigate={navigate} active={isActive(item.path)} />
          ))}

        </nav>

        {/* Scroll-more fade hint */}
        {!isCollapsed && canScrollDown && (
          <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 28, background: 'linear-gradient(to bottom, transparent, var(--surface))', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: 3, pointerEvents: 'none' }}>
            <ChevronDown size={14} strokeWidth={2} color="var(--text-3)" style={{ opacity: 0.4 }} />
          </div>
        )}
      </div>

      {/* ── Profile footer ──────────────────────────────────────────────────── */}
      <div style={{ padding: isCollapsed ? '8px 6px 12px' : '10px 10px 14px', borderTop: '1px solid var(--border)', flexShrink: 0 }}>
        <div
          onClick={() => navigate('/profile')}
          title={isCollapsed ? 'Profile' : 'Open profile'}
          style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: isCollapsed ? '8px' : '8px 10px',
            borderRadius: 8, cursor: 'pointer', transition: 'all 0.15s',
            background: 'transparent',
            justifyContent: isCollapsed ? 'center' : 'flex-start',
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = 'rgba(255,255,255,0.03)'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}>
          {user?.photoURL
            ? <img src={user.photoURL} alt="avatar" style={{ width: 28, height: 28, borderRadius: '50%', flexShrink: 0, objectFit: 'cover', border: `2px solid ${NEON}30` }} />
            : <div style={{ width: 28, height: 28, borderRadius: '50%', background: NEON, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: '#0a0a0a', fontSize: 11, fontWeight: 600 }}>
                {user?.displayName?.[0]?.toUpperCase() ?? 'U'}
              </div>
          }
          {!isCollapsed && (
            <>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ color: 'var(--text-1)', fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {user?.isAnonymous || user?.isGuest ? 'Guest' : (user?.displayName || (user?.email ? user.email.split('@')[0] : 'User'))}
                </div>
              </div>
              <button
                onClick={e => { e.stopPropagation(); onSignOut(); }}
                title="Sign out"
                style={{ padding: 5, background: 'transparent', border: 'none', borderRadius: 6, cursor: 'pointer', color: 'var(--text-3)', flexShrink: 0, display: 'flex', alignItems: 'center', transition: 'all 0.15s' }}
                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = NEON; }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-3)'; }}>
                <LogOut size={14} strokeWidth={1.5} />
              </button>
            </>
          )}
        </div>
        {isCollapsed && (
          <button onClick={onSignOut} title="Sign out"
            style={{ width: '100%', marginTop: 5, padding: '5px', background: 'transparent', border: 'none', borderRadius: 7, cursor: 'pointer', color: 'var(--text-3)', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.15s' }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(239,68,68,0.1)'; (e.currentTarget as HTMLButtonElement).style.color = '#ef4444'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-3)'; }}>
            <LogOut size={14} strokeWidth={2} />
          </button>
        )}
      </div>
    </div>
  );
};

const ALL_NAV = [
  ...CORE_NAV,
  ...TOOLS_NAV,
  ...SYSTEM_NAV,
];

/* ─────────────────────────────────────────────
   LEGACY REDIRECT HELPER
   Passes the original path via React Router location.state so the
   destination hub can show a one-time "X now lives in Y" banner via
   LegacyRedirectBanner. Direct visits (no state) show no banner.
────────────────────────────────────────────── */
// Map the current route path → page-specialist id understood by the
// `/agent/specialist/{pageId}/...` endpoints. Routes not in the map (like
// /agent itself, /memory/:id, /profile, /share/:token) intentionally get
// no dock — either they ARE the chat surface (/agent) or they're modal-
// detail pages where a floating chat would be visual noise.
const ROUTE_TO_SPECIALIST: Array<{ test: (p: string) => boolean; pageId: string }> = [
  { test: (p) => p === '/dashboard', pageId: 'dashboard' },
  { test: (p) => p === '/library' || p.startsWith('/library/'), pageId: 'library' },
  { test: (p) => p === '/recall' || p.startsWith('/recall/'), pageId: 'recall' },
  { test: (p) => p === '/focus' || p.startsWith('/focus/'), pageId: 'focus' },
  { test: (p) => p === '/calendar' || p.startsWith('/calendar/'), pageId: 'calendar' },
  { test: (p) => p === '/briefing', pageId: 'briefing' },
  { test: (p) => p === '/capture' || p.startsWith('/capture/'), pageId: 'capture' },
  { test: (p) => p === '/learn' || p.startsWith('/learn/'), pageId: 'learn' },
  { test: (p) => p === '/insights' || p.startsWith('/insights/'), pageId: 'insights' },
  { test: (p) => p === '/workspace' || p.startsWith('/workspace/'), pageId: 'workspace' },
  { test: (p) => p === '/discover', pageId: 'discover' },
  { test: (p) => p === '/settings', pageId: 'settings' },
  { test: (p) => p === '/integrations', pageId: 'integrations' },
];

function pageIdForPath(pathname: string): string | null {
  for (const { test, pageId } of ROUTE_TO_SPECIALIST) {
    if (test(pathname)) return pageId;
  }
  return null;
}

const RouteSpecialistDock: React.FC = () => {
  const loc = useLocation();
  const pageId = pageIdForPath(loc.pathname);
  if (!pageId) return null;
  // Use pageId as the React key so navigating between pages cleanly
  // unmounts the old dock and mounts a fresh one (separate session_id,
  // separate history, separate open/closed state per page).
  return <PageSpecialistDock key={pageId} pageId={pageId} />;
};

const RedirectWithBanner: React.FC<{ from: string; to: string }> = ({ from, to }) => {
  // Preserve the original query string when the redirect target doesn't have
  // its own — keeps deep links like /tasks?focus=<id> working after the
  // /tasks → /focus consolidation. If both sides have a query string, the
  // target's wins (legacy explicit override).
  const loc = useLocation();
  let target = to;
  if (loc.search && !to.includes('?')) {
    target = `${to}${loc.search}`;
  }
  return <Navigate to={target} replace state={{ redirectedFrom: from }} />;
};

// Deep links into merged hub tabs/views — surfaced in the command palette
// so users can jump straight to a sub-page (Library → Notes, Insights → Graph, etc.)
const HUB_DEEP_LINKS = [
  { id: 'library:vault',     label: 'Library · Vault',      path: '/library?tab=vault',       icon: Database,        color: '#f472b6' },
  { id: 'library:notes',     label: 'Library · Notes',      path: '/library?tab=notes',       icon: StickyNote,      color: '#f59e0b' },
  { id: 'library:bookmarks', label: 'Library · Bookmarks',  path: '/library?tab=bookmarks',   icon: Bookmark,        color: '#ec4899' },
  { id: 'library:files',     label: 'Library · Files',      path: '/library?tab=files',       icon: FlipHorizontal,  color: '#f472b6' },
  { id: 'library:inbox',     label: 'Library · Inbox',      path: '/library?tab=inbox',       icon: Plus,            color: '#06b6d4' },
  { id: 'library:tasks',     label: 'Library · Tasks',      path: '/library?tab=tasks',       icon: CheckSquare,     color: '#10b981' },
  { id: 'library:habits',    label: 'Library · Habits',     path: '/library?tab=habits',      icon: Flame,           color: '#f59e0b' },
  { id: 'library:flashcards',label: 'Library · Flashcards', path: '/library?tab=flashcards',  icon: FlipHorizontal,  color: '#06b6d4' },
  { id: 'library:revisits',  label: 'Library · Revisits',   path: '/library?tab=revisits',    icon: Bell,            color: '#f59e0b' },
  { id: 'learn:plan',        label: 'Learn · Study Plan',   path: '/learn?tab=plan',          icon: GraduationCap,   color: '#7c3aed' },
  { id: 'learn:flashcards',  label: 'Learn · Flashcards',   path: '/learn?tab=flashcards',    icon: FlipHorizontal,  color: '#06b6d4' },
  { id: 'learn:revisits',    label: 'Learn · Revisits',     path: '/learn?tab=revisits',      icon: Bell,            color: '#f59e0b' },
  { id: 'insights:timeline', label: 'Insights · Timeline',  path: '/insights?view=timeline',  icon: GitBranch,       color: '#818cf8' },
  { id: 'insights:graph',    label: 'Insights · Mind Graph',path: '/insights?view=graph',     icon: Network,         color: '#06b6d4' },
  { id: 'insights:analytics',label: 'Insights · Analytics', path: '/insights?view=analytics', icon: BarChart2,       color: '#10b981' },
  { id: 'settings:deck',     label: 'Settings · Pitch Deck',path: '/deck',                    icon: Presentation,    color: '#22d3ee' },
];

/* ─────────────────────────────────────────────
   GLOBAL TOAST SYSTEM
   Any page can trigger: window.dispatchEvent(new CustomEvent('recall-toast', { detail: { msg, type } }))
────────────────────────────────────────────── */
type ToastType = 'success' | 'error' | 'info';
export interface ToastAction { label: string; onClick: () => void | Promise<void>; testId?: string; }
interface ToastItem { id: number; msg: string; type: ToastType; action?: ToastAction; }

const TOAST_ICONS: Record<ToastType, React.ReactNode> = {
  success: <CheckCircle2 size={15} />,
  error:   <AlertTriangle size={15} />,
  info:    <Info size={15} />,
};
const TOAST_COLORS: Record<ToastType, { bg: string; border: string; text: string }> = {
  success: { bg: 'linear-gradient(135deg,#10b981,#059669)', border: 'rgba(16,185,129,0.4)', text: '#fff' },
  error:   { bg: 'linear-gradient(135deg,#ef4444,#dc2626)', border: 'rgba(239,68,68,0.4)',  text: '#fff' },
  info:    { bg: 'linear-gradient(135deg,#2563eb,#1d4ed8)', border: 'rgba(37,99,235,0.4)', text: '#fff' },
};

const GlobalToast = () => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const counterRef = useRef(0);
  const dismiss = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);
  useEffect(() => {
    const handler = (e: Event) => {
      const { msg, type = 'success', action } = (e as CustomEvent).detail ?? {};
      if (!msg) return;
      const id = ++counterRef.current;
      setToasts(prev => [...prev, { id, msg, type, action }]);
      // Toasts with an action (e.g. Undo) linger longer so users have time to react.
      const lifetime = action ? 5500 : 3800;
      setTimeout(() => dismiss(id), lifetime);
    };
    window.addEventListener('recall-toast', handler);
    return () => window.removeEventListener('recall-toast', handler);
  }, [dismiss]);

  return (
    <div style={{ position: 'fixed', top: 22, right: 22, zIndex: 9999, display: 'flex', flexDirection: 'column', gap: 8, pointerEvents: 'none' }}>
      <AnimatePresence>
        {toasts.map(t => {
          const c = TOAST_COLORS[t.type];
          return (
            <motion.div key={t.id} initial={{ opacity: 0, x: 60, scale: 0.9 }} animate={{ opacity: 1, x: 0, scale: 1 }} exit={{ opacity: 0, x: 60, scale: 0.9 }}
              style={{ background: c.bg, border: `1px solid ${c.border}`, borderRadius: 12, padding: '11px 14px 11px 18px', display: 'flex', alignItems: 'center', gap: 9, color: c.text, fontSize: 13, fontWeight: 600, boxShadow: '0 8px 24px rgba(0,0,0,0.35)', backdropFilter: 'blur(8px)', fontFamily: "'Poppins', sans-serif", pointerEvents: 'all', minWidth: 220, maxWidth: 360 }}>
              {TOAST_ICONS[t.type]}
              <span style={{ flex: 1 }}>{t.msg}</span>
              {t.action && (
                <button
                  data-testid={t.action.testId || 'button-toast-action'}
                  onClick={async () => {
                    // Optimistically dismiss so users get instant feedback even
                    // if the action awaits a network round-trip.
                    dismiss(t.id);
                    try { await t.action!.onClick(); } catch { /* no-op: handler shows its own error */ }
                  }}
                  style={{ marginLeft: 4, padding: '5px 11px', background: 'rgba(255,255,255,0.18)', border: '1px solid rgba(255,255,255,0.35)', borderRadius: 8, color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', textTransform: 'uppercase', letterSpacing: '0.4px' }}
                >
                  {t.action.label}
                </button>
              )}
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
};

export const showToast = (msg: string, type: ToastType = 'success', action?: ToastAction) => {
  window.dispatchEvent(new CustomEvent('recall-toast', { detail: { msg, type, action } }));
};

/* ─────────────────────────────────────────────
   QUICK CAPTURE FAB
────────────────────────────────────────────── */
const QuickCaptureFAB = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [showNote, setShowNote] = useState(false);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  // Hide FAB on the Capture page itself (you're already there) and on Pitch Deck
  const hideFab = location.pathname.startsWith('/capture') || location.pathname.startsWith('/deck');

  const saveNote = async () => {
    if (!note.trim() || saving) return;
    setSaving(true);
    try {
      const res = await fetch('/capture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source_type: 'note', url: '', content: note, preview: false })
      });
      if (res.ok) {
        showToast('Note saved to Vault!');
        setNote(''); setShowNote(false); setOpen(false);
      } else {
        showToast('Failed to save note', 'error');
      }
    } catch { showToast('Failed to save note', 'error'); }
    finally { setSaving(false); }
  };

  const ACTIONS = [
    { icon: Globe, label: 'Capture URL', color: '#00d4ff', action: () => { navigate('/capture'); setOpen(false); } },
    { icon: StickyNote, label: 'Quick Note', color: '#06b6d4', action: () => { setShowNote(true); setOpen(false); } },
    { icon: Bot, label: 'Agent Hub', color: '#3b82f6', action: () => { navigate('/agent'); setOpen(false); } },
  ];

  if (hideFab) return null;

  return (
    <>
      {/* Quick Note Modal */}
      <AnimatePresence>
        {showNote && (
          <div style={{ position: 'fixed', inset: 0, zIndex: 9000, display: 'flex', alignItems: 'flex-end', justifyContent: 'flex-end', padding: '0 24px 88px' }}>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowNote(false)}
              style={{ position: 'absolute', inset: 0, background: 'rgba(5,5,15,0.5)', backdropFilter: 'blur(4px)' }} />
            <motion.div initial={{ opacity: 0, y: 16, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 16, scale: 0.95 }}
              style={{ position: 'relative', width: 340, background: 'var(--surface)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 16, padding: '18px 20px', boxShadow: '0 16px 48px rgba(0,0,0,0.5)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <StickyNote size={15} color="#f59e0b" />
                <span style={{ color: '#06b6d4', fontSize: 12, fontWeight: 700 }}>Quick Note</span>
                <button onClick={() => setShowNote(false)} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)', display: 'flex' }}><X size={14} /></button>
              </div>
              <AutoGrowTextarea value={note} onChange={e => setNote(e.target.value)} autoFocus
                placeholder="Capture an idea, thought, or insight..."
                rows={4}
                style={{ width: '100%', padding: '10px 12px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--text-1)', fontSize: 13, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box', lineHeight: 1.55, minHeight: 96 }}
                onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) saveNote(); }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
                <span style={{ color: 'var(--text-3)', fontSize: 10 }}>⌘↵ to save</span>
                <button onClick={saveNote} disabled={!note.trim() || saving}
                  style={{ padding: '7px 16px', background: 'linear-gradient(135deg,#f59e0b,#d97706)', border: 'none', borderRadius: 8, color: '#fff', fontSize: 12, fontWeight: 700, cursor: note.trim() ? 'pointer' : 'default', fontFamily: 'inherit', opacity: note.trim() ? 1 : 0.5 }}>
                  {saving ? 'Saving…' : 'Save to Vault'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* FAB actions */}
      <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 8000, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 10 }}>
        <AnimatePresence>
          {open && ACTIONS.map((a, i) => (
            <motion.button key={a.label}
              initial={{ opacity: 0, y: 12, scale: 0.8 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 12, scale: 0.8 }}
              transition={{ delay: i * 0.05 }}
              onClick={a.action}
              title={a.label}
              style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '8px 14px 8px 10px', background: 'var(--surface)', border: `1px solid ${a.color}35`, borderRadius: 22, boxShadow: `0 6px 18px rgba(0,0,0,0.4), 0 0 0 1px ${a.color}15`, cursor: 'pointer', fontFamily: 'inherit', color: 'var(--text-1)', fontSize: 12, fontWeight: 600 }}>
              <div style={{ width: 28, height: 28, borderRadius: '50%', background: `${a.color}18`, border: `1px solid ${a.color}30`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <a.icon size={14} color={a.color} />
              </div>
              {a.label}
            </motion.button>
          ))}
        </AnimatePresence>

        {/* Main FAB button */}
        <motion.button
          onClick={() => setOpen(o => !o)}
          whileTap={{ scale: 0.93 }}
          style={{ width: 52, height: 52, borderRadius: '50%', background: open ? 'var(--surface-2)' : 'linear-gradient(135deg,#2563eb,#06b6d4)', border: open ? '1px solid var(--border)' : '1px solid rgba(37,99,235,0.4)', boxShadow: open ? 'none' : '0 8px 24px rgba(37,99,235,0.5), 0 0 0 1px rgba(37,99,235,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.25s' }}>
          <motion.div animate={{ rotate: open ? 45 : 0 }} transition={{ duration: 0.2 }}>
            <Plus size={22} color={open ? 'var(--text-2)' : '#fff'} />
          </motion.div>
        </motion.button>
      </div>
    </>
  );
};

const AppShell = ({ user, onSignOut, onUpgradeGuest, isDark, toggleTheme }: { user: any; onSignOut: () => void; onUpgradeGuest: () => void | Promise<void>; isDark: boolean; toggleTheme: () => void }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [showTour, setShowTour] = useState(false);
  // W3 Universal Linker: palette state lives in LinkerContext now so any
  // component (MemoryLinksPanel, future inbox menu, etc.) can summon it
  // via openLinker() without prop drilling. Local Cmd-K listener is
  // kept here because keybinds belong to the shell, not the modal.
  const { openLinker, closeLinker } = useLinker();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); openLinker('jump'); }
      // Note: Esc-to-close is handled inside CommandPalette (on the
      // input element) so it doesn't fire when other modals are open.
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [openLinker]);

  // Reset palette on route change so a leftover open state from one
  // page doesn't bleed into the next (back-button after linking, etc.).
  useEffect(() => { closeLinker(); }, [location.pathname, closeLinker]);

  useEffect(() => {
    if (!user) return;
    try {
      if (!localStorage.getItem('recall-x247-onboarded')) {
        const t = setTimeout(() => setShowTour(true), 350);
        return () => clearTimeout(t);
      }
    } catch {}
  }, [user?.uid]);

  // Settings → "Replay onboarding tour" dispatches this event so the global
  // tour state lives here in AppShell rather than being duplicated per-page.
  useEffect(() => {
    const handler = () => setShowTour(true);
    window.addEventListener('recall-replay-tour', handler);
    return () => window.removeEventListener('recall-replay-tour', handler);
  }, []);

  return (
    <div style={{ display: 'flex', height: '100vh', background: 'var(--bg)', color: 'var(--text-1)', overflow: 'hidden', fontFamily: "'Poppins', system-ui, sans-serif", padding: '8px 12px', gap: 8 }}>

      {/* Desktop Sidebar */}
      <div style={{ position: 'relative', zIndex: 50, flexShrink: 0, borderRadius: 14, border: '1px solid var(--border)', boxShadow: isDark ? '0 2px 14px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.04)' : '0 2px 8px rgba(0,0,0,0.06), inset 0 1px 0 rgba(255,255,255,0.88)', height: '100%', width: isCollapsed ? 60 : 220, minWidth: isCollapsed ? 60 : 220, transition: 'width 0.25s cubic-bezier(0.4,0,0.2,1), min-width 0.25s cubic-bezier(0.4,0,0.2,1)', overflow: 'hidden' }} className="desktop-sidebar">
        <Sidebar isCollapsed={isCollapsed} setIsCollapsed={setIsCollapsed} user={user} onSignOut={onSignOut} />
      </div>

      {/* Mobile Sidebar */}
      <AnimatePresence>
        {isMobileMenuOpen && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setIsMobileMenuOpen(false)}
              style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.35)', backdropFilter: 'blur(2px)', zIndex: 60 }} />
            <motion.div initial={{ x: -240 }} animate={{ x: 0 }} exit={{ x: -240 }}
              transition={{ type: 'spring', damping: 28, stiffness: 220 }}
              style={{ position: 'fixed', top: 0, bottom: 0, left: 0, zIndex: 70, width: 220 }}>
              <Sidebar isCollapsed={false} setIsCollapsed={() => {}} user={user} onSignOut={() => { onSignOut(); setIsMobileMenuOpen(false); }} />
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Main content */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative', minWidth: 0, borderRadius: 14, border: '1px solid var(--border)', background: 'var(--surface)', boxShadow: isDark ? '0 2px 14px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.04)' : '0 2px 8px rgba(0,0,0,0.06), inset 0 1px 0 rgba(255,255,255,0.88)' }}>
        <header style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)', padding: '0 14px', height: 46, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0, gap: 8, borderRadius: '14px 14px 0 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
            <button onClick={() => setIsMobileMenuOpen(true)} className="mobile-only"
              style={{ padding: 6, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 7, cursor: 'pointer', color: 'var(--text-2)', alignItems: 'center', flexShrink: 0 }}>
              <Menu size={15} />
            </button>
            <div className="header-search" style={{ position: 'relative', flex: 1, maxWidth: 400 }}>
              <Search size={12} color="var(--text-3)" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
              <input readOnly onFocus={() => openLinker('jump')}
                placeholder="Search memories, tasks... (⌘K)"
                style={{ width: '100%', paddingLeft: 30, paddingRight: 12, paddingTop: 6, paddingBottom: 6, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-3)', fontSize: 12, outline: 'none', cursor: 'pointer', fontFamily: 'inherit' }}
              />
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            <button onClick={() => setShowTour(true)} className="theme-toggle" title="Take the tour">
              <HelpCircle size={14} />
            </button>
            <button onClick={toggleTheme} className="theme-toggle" title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}>
              {isDark ? <Sun size={14} /> : <Moon size={14} />}
            </button>
            <button onClick={() => navigate('/capture')}
              style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 12px', background: 'linear-gradient(135deg,#2563eb,#1d4ed8)', border: '1px solid rgba(37,99,235,0.4)', borderRadius: 8, color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', boxShadow: '0 2px 8px rgba(37,99,235,0.3), inset 0 1px 0 rgba(255,255,255,0.15)', fontFamily: 'inherit', transition: 'all 0.15s', whiteSpace: 'nowrap' }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 4px 14px rgba(37,99,235,0.45), inset 0 1px 0 rgba(255,255,255,0.15)'; (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-1px)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 2px 8px rgba(37,99,235,0.3), inset 0 1px 0 rgba(255,255,255,0.15)'; (e.currentTarget as HTMLButtonElement).style.transform = ''; }}>
              <Plus size={13} /> <span className="desktop-text">Capture</span>
            </button>
          </div>
        </header>

        <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', background: 'var(--bg)', minHeight: 0 }} className="scroll-custom responsive-content">
          <div style={{ maxWidth: 1280, margin: '0 auto', minWidth: 0 }}>
            <AnimatePresence mode="wait">
              <motion.div key={location.pathname} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.18 }}>
                <ErrorBoundary>
                <ChunkErrorBoundary>
                <PageBreadcrumbs />
                <Suspense fallback={<RouteSuspenseFallback />}>
                <Routes>
                  <Route path="/" element={<Navigate to="/dashboard" replace />} />
                  {/* Auth pages aren't reachable for an already-signed-in user.
                      If the URL still says /login (e.g. just after sign-in or a
                      bookmark), bounce them to the dashboard instead of the
                      404 page. */}
                  <Route path="/login" element={<Navigate to="/dashboard" replace />} />
                  <Route path="/auth" element={<Navigate to="/dashboard" replace />} />
                  <Route path="/signin" element={<Navigate to="/dashboard" replace />} />
                  <Route path="/signup" element={<Navigate to="/dashboard" replace />} />
                  <Route path="/dashboard" element={<DashboardPage isDark={isDark} user={user} onSignOut={onSignOut} onUpgradeGuest={onUpgradeGuest} />} />
                  <Route path="/briefing" element={<DailyBriefingPage />} />
                  <Route path="/agent" element={<AgentPage />} />
                  <Route path="/recall" element={<RecallPage />} />
                  <Route path="/calendar" element={<CalendarPage />} />
                  <Route path="/settings" element={<SettingsPage />} />
                  <Route path="/workspace" element={<WorkspacePage />} />
                  <Route path="/memory/:id" element={<MemoryDetailPage />} />
                  <Route path="/session/:id" element={<SessionDetailPage />} />
                  <Route path="/deck" element={<DeckPage />} />
                  <Route path="/profile" element={<ProfilePage user={user} onSignOut={onSignOut} />} />
                  <Route path="/integrations" element={<IntegrationsPage />} />
                  <Route path="/discover" element={<DiscoverPage />} />

                  {/* Merged hub pages */}
                  <Route path="/library"  element={<LibraryPage />} />
                  <Route path="/focus"    element={<FocusPage />} />
                  <Route path="/learn"    element={<LearnPage />} />
                  <Route path="/insights" element={<InsightsPage />} />

                  {/* Backwards-compatible redirects to the merged hubs.
                      RedirectWithBanner passes the original path via location.state so
                      the destination hub can show a one-time "now lives in X" banner. */}
                  <Route path="/capture"    element={<CapturePage />} />
                  <Route path="/vault"      element={<RedirectWithBanner from="/vault"      to="/library?tab=vault" />} />
                  <Route path="/notes"      element={<RedirectWithBanner from="/notes"      to="/library?tab=notes" />} />
                  <Route path="/bookmarks"  element={<RedirectWithBanner from="/bookmarks"  to="/library?tab=bookmarks" />} />
                  <Route path="/tasks"      element={<RedirectWithBanner from="/tasks"      to="/focus" />} />
                  <Route path="/habits"     element={<RedirectWithBanner from="/habits"     to="/focus" />} />
                  <Route path="/plan"       element={<RedirectWithBanner from="/plan"       to="/learn?tab=plan" />} />
                  <Route path="/flashcards" element={<RedirectWithBanner from="/flashcards" to="/learn?tab=flashcards" />} />
                  <Route path="/revisits"   element={<RedirectWithBanner from="/revisits"   to="/learn?tab=revisits" />} />
                  <Route path="/timeline"   element={<RedirectWithBanner from="/timeline"   to="/insights?view=timeline" />} />
                  <Route path="/graph"      element={<RedirectWithBanner from="/graph"      to="/insights?view=graph" />} />
                  <Route path="/analytics"  element={<RedirectWithBanner from="/analytics"  to="/insights?view=analytics" />} />

                  <Route path="*" element={<NotFoundPage />} />
                </Routes>
                </Suspense>
                </ChunkErrorBoundary>
                </ErrorBoundary>
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </main>

      {/* Global Toast + FAB */}
      <GlobalToast />
      <QuickCaptureFAB />
      <Suspense fallback={null}>
        <BriefingNotifier />
      </Suspense>

      {/* Per-page specialist dock — bottom-right floating chat that auto-
          maps the current route to a focused agent with a restricted tool
          set. The main /agent orchestrator (which IS a chat surface
          itself) skips the dock to avoid two chat surfaces stacking. */}
      <Suspense fallback={null}>
        <RouteSpecialistDock />
      </Suspense>

      {/* Onboarding Tour — only mount the chunk when actually shown so the
          tour's animations + content don't land in the entry chunk. */}
      {showTour && (
        <Suspense fallback={null}>
          <OnboardingTour open={showTour} onClose={() => setShowTour(false)} />
        </Suspense>
      )}

      {/* W3 Universal Linker — palette state lives in LinkerContext.
          We pass ALL_NAV + HUB_DEEP_LINKS so jump mode still surfaces
          the static routes when the input is empty. */}
      <AnimatePresence>
        <CommandPalette navItems={[...ALL_NAV, ...HUB_DEEP_LINKS] as any} />
      </AnimatePresence>
    </div>
  );
};

const GUEST_USER_KEY = 'recall-guest-user';

function AppRouter() {
  const [user, setUser] = useState<any>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [isReady, setIsReady] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>(() =>
    (localStorage.getItem('recall-theme-v2') as 'light' | 'dark') || 'dark'
  );
  const navigate = useNavigate();

  useEffect(() => {
    checkRedirectResult().catch(() => {});
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      if (u) {
        setUser(u);
      } else {
        try {
          const guestData = localStorage.getItem(GUEST_USER_KEY);
          setUser(guestData ? JSON.parse(guestData) : null);
        } catch { setUser(null); }
      }
      setAuthLoading(false);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('recall-theme-v2', theme);
  }, [theme]);

  useEffect(() => {
    const timer = setTimeout(() => setIsReady(true), 100);
    return () => clearTimeout(timer);
  }, []);

  // Hide splash only after auth is resolved AND the page has painted
  useEffect(() => {
    if (authLoading || !isReady) return;
    // Wait for the browser to paint the actual page content
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (typeof (window as any).hideSplash === 'function') {
          (window as any).hideSplash();
        }
      });
    });
  }, [authLoading, isReady]);

  const handleGuestSignIn = async () => {
    const guestUser = { uid: `guest-${Date.now()}`, displayName: 'Guest User', email: 'guest@recall-x247.local', photoURL: null, isAnonymous: true, isGuest: true };
    localStorage.setItem(GUEST_USER_KEY, JSON.stringify(guestUser));
    setUser(guestUser);
    navigate('/dashboard', { replace: true });
  };

  // `redirectTo` lets callers route to a non-default destination after
  // sign-out (e.g. the guest "Sign up free" CTA wants /login?mode=signup).
  // We do a single navigate at the end so React Router doesn't get a
  // chance to render an intermediate state where /login is unreachable.
  const handleSignOut = async (redirectTo: string = '/') => {
    localStorage.removeItem(GUEST_USER_KEY);
    // Clear per-user transient state so the next user starts fresh
    try {
      localStorage.removeItem('agent-hub-current-chat-v1');
      localStorage.removeItem('agent-hub-current-session-id-v1');
      localStorage.removeItem('agent-hub-sessions-v1');
    } catch {}
    try { await firebaseSignOut(); } catch {}
    setUser(null);
    navigate(redirectTo, { replace: true });
  };

  const toggleTheme = () => setTheme(t => t === 'light' ? 'dark' : 'light');
  const isDark = theme === 'dark';

  // Public share view — accessible without auth, before all other gating
  const isSharePath = window.location.pathname.startsWith('/share/');
  if (isSharePath) {
    return (
      <Suspense fallback={<RouteSuspenseFallback />}>
        <Routes>
          <Route path="/share/:token" element={<SharePage />} />
        </Routes>
      </Suspense>
    );
  }

  if (authLoading || !isReady) {
    return (
      <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#03080f' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 24 }}>
          <img src="/x247-logo.webp" alt="x247 AI" width={785} height={421} decoding="async" fetchPriority="high" style={{ width: 'clamp(120px,15vw,180px)', height: 'auto', userSelect: 'none' }} draggable={false} />
          <div style={{ display: 'flex', gap: 6 }}>
            {[0,1,2].map(i => <div key={i} style={{ width: 5, height: 5, borderRadius: '50%', background: 'rgba(255,255,255,0.42)', animation: `bounce 1.1s ease-in-out ${i*0.15}s infinite` }} />)}
          </div>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <ChunkErrorBoundary>
        <Suspense fallback={<RouteSuspenseFallback />}>
          <Routes>
            <Route path="/" element={<Landing navigate={navigate} isDark={isDark} toggleTheme={toggleTheme} />} />
            <Route path="/login" element={
              <Login
                navigate={navigate}
                initialMode={window.location.search.includes('mode=signup') ? 'sign-up' : 'sign-in'}
                onGoogleSignIn={signInWithGoogle}
                onEmailSignIn={signInWithEmail}
                onEmailSignUp={signUpWithEmail}
                onResetPassword={resetPassword}
                onAnonymousSignIn={handleGuestSignIn}
              />
            } />
            <Route path="/auth" element={<Navigate to="/login" replace />} />
            <Route path="/signin" element={<Navigate to="/login" replace />} />
            <Route path="/signup" element={<Navigate to="/login?mode=signup" replace />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </ChunkErrorBoundary>
    );
  }

  // Guest → signup CTA: do a HARD redirect via window.location.
  //
  // We previously tried `setUser(null) + navigate('/login?mode=signup')`,
  // but in React 19 + RR7 the two state updates batch in a way that lets
  // the AppRouter's `if (!user)` wildcard route (`*` -> Navigate to `/`)
  // win first, dropping the user on the landing page. A hard reload
  // guarantees the browser arrives at /login?mode=signup, the React tree
  // is rebuilt fresh with no guest, and Login renders in sign-up mode.
  const handleUpgradeGuest = () => {
    try { localStorage.removeItem(GUEST_USER_KEY); } catch {}
    try {
      localStorage.removeItem('agent-hub-current-chat-v1');
      localStorage.removeItem('agent-hub-current-session-id-v1');
      localStorage.removeItem('agent-hub-sessions-v1');
    } catch {}
    // Fire-and-forget — we're about to reload anyway.
    try { firebaseSignOut(); } catch {}
    // `replace` rather than `assign` so the browser back button doesn't
    // bounce the user from the signup page back to the dashboard (where
    // the guest user no longer exists).
    window.location.replace('/login?mode=signup');
  };
  return <AppShell user={user} onSignOut={handleSignOut} onUpgradeGuest={handleUpgradeGuest} isDark={isDark} toggleTheme={toggleTheme} />;
}

export default function App() {
  return (
    <BrowserRouter>
      {/* CaptureSuggestionsProvider holds a 60s in-memory cache for AI
          suggested_* fields keyed by preview.id, so re-opening the
          EnrichPanel on the same capture (or hitting Re-analyze on the
          memory detail page) repaints chips instantly instead of
          flashing a loader. */}
      <CaptureSuggestionsProvider>
        {/* LinkerProvider wraps the router so AppShell + every route
            can summon the Cmd-K palette via useLinker(). Mounted
            INSIDE BrowserRouter so the palette can call useNavigate. */}
        <LinkerProvider>
          <AppRouter />
        </LinkerProvider>
      </CaptureSuggestionsProvider>
    </BrowserRouter>
  );
}
