import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, ChevronRight, Home } from 'lucide-react';

const ROUTE_LABELS: Record<string, string> = {
  dashboard: 'Dashboard',
  briefing: 'Daily Briefing',
  agent: 'Agent Hub',
  recall: 'Recall AI',
  calendar: 'Calendar',
  settings: 'Settings',
  capture: 'Capture',
  library: 'Library',
  focus: 'Focus',
  learn: 'Learn',
  insights: 'Insights',
  memory: 'Vault',
  session: 'Session',
  profile: 'Profile',
  integrations: 'Integrations',
  discover: 'Discover',
  workspace: 'Workspace',
  deck: 'Deck',
  // Legacy single-page routes that now live as tabs inside a hub. Keep the
  // labels here so the breadcrumb still reads cleanly if a deep link ever
  // lands on /vault, /tasks, etc. before the legacy redirect kicks in.
  vault: 'Vault',
  notes: 'Notes',
  bookmarks: 'Bookmarks',
  tasks: 'Tasks',
  habits: 'Habits',
  flashcards: 'Flashcards',
  plan: 'Study Plan',
  revisits: 'Revisits',
  timeline: 'Timeline',
  graph: 'Mind Graph',
  analytics: 'Analytics',
};

// Canonical destination for a route segment when it doesn't render its OWN
// page but is actually a tab inside a hub (or a synthetic parent for
// dynamic routes like /memory/:id). Keys MUST stay in sync with the
// LegacyRedirectBanner map in src/components/LegacyRedirectBanner.tsx.
//
// Example: on /memory/abc123 the breadcrumb wants to render
// "Dashboard > Vault > <title>". Without this map, the "Vault" crumb would
// link to "/memory" (built by joining url segments) which 404s — there is
// no list page at /memory, the Vault list lives at /library?tab=vault.
const CANONICAL_PATH: Record<string, string> = {
  memory:     '/library?tab=vault',
  vault:      '/library?tab=vault',
  notes:      '/library?tab=notes',
  bookmarks:  '/library?tab=bookmarks',
  tasks:      '/focus',
  habits:     '/focus',
  flashcards: '/learn?tab=flashcards',
  plan:       '/learn?tab=plan',
  revisits:   '/learn?tab=revisits',
  timeline:   '/insights?view=timeline',
  graph:      '/insights?view=graph',
  analytics:  '/insights?view=analytics',
};

const TAB_LABELS: Record<string, string> = {
  vault: 'Vault',
  notes: 'Notes',
  bookmarks: 'Bookmarks',
  flashcards: 'Flashcards',
  plan: 'Study Plan',
  revisits: 'Revisits',
  timeline: 'Timeline',
  graph: 'Graph',
  analytics: 'Analytics',
  today: 'Today',
};

const HIDDEN_PATHS = new Set(['/', '/dashboard', '/login']);

interface Crumb {
  label: string;
  to?: string;
}

const PageBreadcrumbs: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [memoryTitle, setMemoryTitle] = useState<string>('');

  const path = location.pathname;
  const search = new URLSearchParams(location.search);

  const crumbs = useMemo<Crumb[]>(() => {
    const segs = path.split('/').filter(Boolean);
    const trail: Crumb[] = [{ label: 'Dashboard', to: '/dashboard' }];
    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i];
      const prev = segs[i - 1];
      // Dynamic ID segments
      if (prev === 'memory') {
        trail.push({ label: memoryTitle || 'Memory' });
        continue;
      }
      if (prev === 'session') {
        trail.push({ label: 'Session' });
        continue;
      }
      const label = ROUTE_LABELS[seg] || seg.charAt(0).toUpperCase() + seg.slice(1);
      // Prefer the canonical hub-tab URL over the literal joined-segments
      // URL. Without this, a crumb like "Vault" on /memory/abc would link
      // to "/memory" (404) instead of "/library?tab=vault".
      const partial = CANONICAL_PATH[seg] || '/' + segs.slice(0, i + 1).join('/');
      // For terminal segments don't include link (current page)
      const isLast = i === segs.length - 1;
      trail.push({ label, to: isLast ? undefined : partial });
    }
    // Append ?tab=xxx as a sub-crumb on hub pages
    const tab = search.get('tab') || search.get('view');
    if (tab && TAB_LABELS[tab] && (path === '/library' || path === '/focus' || path === '/learn' || path === '/insights')) {
      // Make the parent (last crumb) a link instead of a current page
      if (trail.length && !trail[trail.length - 1].to) {
        trail[trail.length - 1].to = path;
      }
      trail.push({ label: TAB_LABELS[tab] });
    }
    return trail;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, location.search, memoryTitle]);

  // Lazy-fetch memory title for /memory/:id so the crumb shows real title.
  // Reset eagerly on every path change so navigating /memory/a → /memory/b
  // doesn't briefly show the old title before the new fetch resolves.
  useEffect(() => {
    setMemoryTitle('');
    const m = path.match(/^\/memory\/([^/]+)$/);
    if (!m) return;
    let cancelled = false;
    fetch(`/memories/${m[1]}`).then(r => r.ok ? r.json() : null).then(d => {
      if (cancelled || !d) return;
      const t = (d.title || '').toString().trim();
      if (t) setMemoryTitle(t.length > 60 ? `${t.slice(0, 60)}…` : t);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [path]);

  if (HIDDEN_PATHS.has(path)) return null;

  const handleBack = () => {
    if (window.history.length > 1) navigate(-1);
    else navigate('/dashboard');
  };

  return (
    <nav className="page-crumbs" aria-label="Breadcrumb" data-testid="page-breadcrumbs">
      <button
        type="button"
        onClick={handleBack}
        className="page-crumbs-back"
        data-testid="page-back-button"
        aria-label="Go back"
        title="Go back"
      >
        <ArrowLeft size={12} /> Back
      </button>
      <ol className="page-crumbs-list">
        {crumbs.map((c, i) => {
          const isLast = i === crumbs.length - 1;
          return (
            <li key={i} className="page-crumbs-item">
              {i === 0 && <Home size={11} className="page-crumbs-home" aria-hidden="true" />}
              {c.to && !isLast ? (
                <Link to={c.to} className="page-crumbs-link" data-testid={`crumb-${c.label.toLowerCase().replace(/\s+/g, '-')}`}>
                  {c.label}
                </Link>
              ) : (
                <span className="page-crumbs-current" aria-current={isLast ? 'page' : undefined}>
                  {c.label}
                </span>
              )}
              {!isLast && <ChevronRight size={11} className="page-crumbs-sep" aria-hidden="true" />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
};

export default PageBreadcrumbs;
