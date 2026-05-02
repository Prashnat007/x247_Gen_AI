import React, { lazy, Suspense } from 'react';
import { Target, CheckSquare, Flame } from 'lucide-react';
import { motion } from 'motion/react';
import LegacyRedirectBanner from '../components/LegacyRedirectBanner';

const TasksPage = lazy(() => import('./TasksPage'));
const HabitsPage = lazy(() => import('./HabitsPage'));
const SectionFallback = () => (
  <div aria-hidden style={{ minHeight: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-3)', fontSize: 12, opacity: 0.6 }}>
    Loading…
  </div>
);

const FocusPage: React.FC = () => {
  return (
    <div style={{ color: 'var(--text-1)', padding: '14px 0' }}>
      <LegacyRedirectBanner hub="focus" />
      {/* Hub header */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          padding: '16px 18px',
          marginBottom: 16,
          boxShadow: 'var(--shadow-sm)',
          display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
        }}
      >
        <div
          style={{
            width: 40, height: 40, borderRadius: 11,
            background: 'rgba(16,185,129,0.15)',
            border: '1px solid rgba(16,185,129,0.4)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <Target size={19} color="#10b981" />
        </div>
        <div style={{ minWidth: 0 }}>
          <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0, letterSpacing: '-0.4px', color: 'var(--text-1)' }}>Focus</h1>
          <p style={{ color: 'var(--text-3)', fontSize: 12, margin: '2px 0 0' }}>
            Your daily rituals and what you're working on — one screen, one focus.
          </p>
        </div>
      </motion.div>

      {/* ── Daily rituals (habits) ──────────────────────────────────────── */}
      <section style={{ marginBottom: 24 }}>
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            margin: '0 0 10px', color: 'var(--text-2)',
            fontSize: 11, letterSpacing: '1.4px', textTransform: 'uppercase', fontWeight: 700,
          }}
        >
          <Flame size={12} color="#f59e0b" />
          Daily rituals
        </div>
        <Suspense fallback={<SectionFallback />}>
          <HabitsPage embedded />
        </Suspense>
      </section>

      {/* ── Tasks ────────────────────────────────────────────────────────── */}
      <section>
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            margin: '0 0 10px', color: 'var(--text-2)',
            fontSize: 11, letterSpacing: '1.4px', textTransform: 'uppercase', fontWeight: 700,
          }}
        >
          <CheckSquare size={12} color="#10b981" />
          Tasks
        </div>
        <Suspense fallback={<SectionFallback />}>
          <TasksPage embedded />
        </Suspense>
      </section>
    </div>
  );
};

export default FocusPage;
