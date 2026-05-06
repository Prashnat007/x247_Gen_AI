import React, { Suspense } from 'react';
import { useSearchParams } from 'react-router-dom';
import { motion } from 'motion/react';
import LegacyRedirectBanner from './LegacyRedirectBanner';

const TabSuspenseFallback = () => (
  <div
    aria-hidden
    style={{
      minHeight: 200,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: 'var(--text-3)',
      fontSize: 12,
      opacity: 0.7,
    }}
  >
    Loading…
  </div>
);

export interface TabDef {
  id: string;
  label: string;
  icon?: React.ElementType;
  render: () => React.ReactNode;
  /** Optional small numeric badge shown next to the tab label. Omit or
   *  pass 0/undefined to render nothing. Caps at 99+ visually. */
  badge?: number;
  /** When true and `badge > 0`, render the badge in the same red
   *  "needs attention" pill the sidebar uses for the Library card so
   *  the user sees, on the inner tabstrip, exactly where the work is.
   *  Also adds a soft red glow to the tab button itself when it's not
   *  the currently selected tab. Use sparingly — only for surfaces
   *  that genuinely require human review (e.g. the Inbox). */
  urgent?: boolean;
  /** Optional tooltip override — paired with `urgent` so the same
   *  hover hint as the sidebar badge can be reused here. */
  badgeTitle?: string;
}

interface Props {
  icon: React.ElementType;
  iconColor: string;
  iconBg: string;
  title: string;
  subtitle: string;
  tabs: TabDef[];
  paramKey?: string;
  defaultTab?: string;
  rightSlot?: React.ReactNode;
  /** Which hub this TabbedPage represents — drives the legacy redirect banner */
  hub?: 'library' | 'focus' | 'learn' | 'insights';
}

const TabbedPage: React.FC<Props> = ({
  icon: Icon, iconColor, iconBg, title, subtitle, tabs,
  paramKey = 'tab', defaultTab, rightSlot, hub,
}) => {
  const [params, setParams] = useSearchParams();
  const initial = params.get(paramKey) || defaultTab || tabs[0]?.id;
  const active = tabs.find(t => t.id === initial)?.id || tabs[0]?.id;

  const setActive = (id: string) => {
    const next = new URLSearchParams(params);
    next.set(paramKey, id);
    setParams(next, { replace: true });
  };

  const current = tabs.find(t => t.id === active) || tabs[0];

  // On mobile the tablist becomes a horizontally scrollable strip (CSS
  // takes over via `.tabbed-tablist` + media query). When the active tab
  // changes, scroll it into view so users don't have to swipe to find it.
  // Gated to mobile so we don't trigger unexpected scroll jumps on desktop
  // where the tablist already lays out fully on screen.
  const tablistRef = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    if (!window.matchMedia('(max-width: 640px)').matches) return;
    const el = tablistRef.current?.querySelector<HTMLElement>(`button[data-tab-id="${active}"]`);
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }
  }, [active]);

  return (
    <div style={{ color: 'var(--text-1)', padding: '14px 0' }}>
      {/* Keyframes for the urgent badge pulse. Inlined so we don't have
          to plumb a new CSS file just for one animation; the rule is
          scoped by name and only runs when an `urgent` badge is on
          screen, so it's safe to declare globally. */}
      <style>{`
        @keyframes tabbed-urgent-pulse {
          0%,100% { box-shadow: 0 0 0 0 rgba(197,248,42,0.55); }
          50%     { box-shadow: 0 0 0 4px rgba(197,248,42,0); }
        }
      `}</style>
      {hub && <LegacyRedirectBanner hub={hub} />}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          padding: '16px 18px',
          marginBottom: 14,
          boxShadow: 'var(--shadow-sm)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
            <div
              style={{
                width: 40, height: 40, borderRadius: 11,
                background: iconBg,
                border: `1px solid ${iconColor}40`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <Icon size={19} color={iconColor} />
            </div>
            <div style={{ minWidth: 0 }}>
              <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0, letterSpacing: '-0.4px', color: 'var(--text-1)' }}>{title}</h1>
              <p style={{ color: 'var(--text-3)', fontSize: 12, margin: '2px 0 0' }}>{subtitle}</p>
            </div>
          </div>
          {rightSlot}
        </div>

        <div
          role="tablist"
          ref={tablistRef}
          className="tabbed-tablist"
          style={{
            display: 'flex', gap: 4, marginTop: 14, flexWrap: 'wrap',
            background: 'var(--surface-2)', borderRadius: 10, padding: 4,
            border: '1px solid var(--border)', width: 'fit-content', maxWidth: '100%',
          }}
        >
          {tabs.map(t => {
            const isActive = t.id === active;
            const TabIcon = t.icon;
            const hasBadge = typeof t.badge === 'number' && t.badge > 0;
            // `urgent` only "fires" when there is actually something to
            // act on (badge > 0). Otherwise we fall back to the regular
            // muted pill so a quiet inbox doesn't shout for no reason.
            const isUrgent = !!t.urgent && hasBadge;
            return (
              <button
                key={t.id}
                role="tab"
                data-tab-id={t.id}
                aria-selected={isActive}
                title={isUrgent ? t.badgeTitle : undefined}
                onClick={() => setActive(t.id)}
                style={{
                  padding: '7px 14px', borderRadius: 7, border: 'none', cursor: 'pointer',
                  fontFamily: 'inherit',
                  background: isActive ? 'var(--surface)' : 'transparent',
                  color: isActive ? iconColor : 'var(--text-3)',
                  fontSize: 12.5, fontWeight: isActive ? 700 : 600,
                  transition: 'all 0.18s',
                  boxShadow: isActive
                    ? 'var(--shadow-sm)'
                    : isUrgent
                      // Soft neon glow so the eye lands on the tab
                      ? '0 0 0 1px rgba(197,248,42,0.35), 0 0 12px rgba(197,248,42,0.25)'
                      : 'none',
                  display: 'flex', alignItems: 'center', gap: 6,
                  whiteSpace: 'nowrap',
                }}
              >
                {TabIcon && <TabIcon size={13} color={isUrgent && !isActive ? '#c5f82a' : undefined} />}
                {t.label}
                {hasBadge && (
                  isUrgent ? (
                    // Mirror the sidebar's "needs review" pill: solid red
                    // with white text. Same data-testid pattern as the
                    // sidebar so existing test selectors work here too.
                    <span
                      data-testid={`tab-badge-${t.id}-urgent`}
                      aria-label={`${t.badge} item${t.badge === 1 ? '' : 's'} need review`}
                      style={{
                        marginLeft: 2,
                        minWidth: 18,
                        height: 16,
                        padding: '0 6px',
                        borderRadius: 999,
                        fontSize: 10.5,
                        fontWeight: 700,
                        lineHeight: '16px',
                        textAlign: 'center',
                        background: '#c5f82a',
                        color: '#0a0a0a',
                        letterSpacing: '0.2px',
                        whiteSpace: 'nowrap',
                        animation: 'tabbed-urgent-pulse 1.8s ease-in-out infinite',
                      }}
                    >
                      {t.badge! > 99 ? '99+' : t.badge}
                    </span>
                  ) : (
                    <span
                      aria-label={`${t.badge} item${t.badge === 1 ? '' : 's'}`}
                      style={{
                        marginLeft: 2,
                        minWidth: 18,
                        height: 16,
                        padding: '0 5px',
                        borderRadius: 8,
                        fontSize: 10.5,
                        fontWeight: 700,
                        lineHeight: '16px',
                        textAlign: 'center',
                        background: isActive ? `${iconColor}26` : 'var(--surface-3, rgba(255,255,255,0.08))',
                        color: isActive ? iconColor : 'var(--text-2, #b9b9c8)',
                        border: `1px solid ${isActive ? `${iconColor}55` : 'var(--border)'}`,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {t.badge! > 99 ? '99+' : t.badge}
                    </span>
                  )
                )}
              </button>
            );
          })}
        </div>
      </motion.div>

      <div key={active}>
        <Suspense fallback={<TabSuspenseFallback />}>
          {current?.render()}
        </Suspense>
      </div>
    </div>
  );
};

export default TabbedPage;
