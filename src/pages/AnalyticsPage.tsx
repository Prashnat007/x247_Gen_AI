import React, { useState, useEffect, lazy, Suspense } from 'react';
import { BarChart2, Brain, TrendingUp, Zap, Target } from 'lucide-react';
import { motion } from 'motion/react';
import type { Memory } from '../lib/types';
import { card } from '../lib/ui';

const COLORS = ['#00d4ff', '#8b5cf6', '#f472b6', '#10b981', '#f59e0b', '#ef4444'];

// Defer recharts (~250 KB) until the analytics view actually paints.
// The two chart blocks live in their own component module so recharts
// stays out of the page chunk.
const CapturesAreaChart = lazy(() =>
  import('../components/charts/AnalyticsCharts').then(m => ({ default: m.CapturesAreaChart }))
);
const DomainsBarChart = lazy(() =>
  import('../components/charts/AnalyticsCharts').then(m => ({ default: m.DomainsBarChart }))
);
const ChartFallback = ({ height }: { height: number }) => (
  <div aria-hidden style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-3)', fontSize: 11, opacity: 0.5 }}>
    Loading chart…
  </div>
);

interface AnalyticsViewProps { embedded?: boolean }
const AnalyticsView: React.FC<AnalyticsViewProps> = ({ embedded = false }) => {
  const [stats, setStats] = useState<any>(null);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);

  useEffect(() => {
    Promise.all([
      fetch('/stats').then(r => r.ok ? r.json() : null),
      fetch('/memories?limit=50').then(r => r.ok ? r.json() : []),
      fetch('/logs?limit=20').then(r => r.ok ? r.json() : []),
      fetch('/tasks?limit=50').then(r => r.ok ? r.json() : []),
    ]).then(([s, m, l, t]) => {
      if (s) setStats(s);
      setMemories(Array.isArray(m) ? m : []);
      setLogs(Array.isArray(l) ? l : []);
      setTasks(Array.isArray(t) ? t : []);
    });
  }, []);

  const domains = stats?.knowledge_domains ?? [];

  const srcCounts = { youtube: 0, web: 0, pdf: 0, note: 0 };
  memories.forEach(m => { if (m.source_type in srcCounts) (srcCounts as any)[m.source_type]++; });
  const srcData = [
    { name: 'YouTube', value: srcCounts.youtube, color: '#ef4444' },
    { name: 'Web', value: srcCounts.web, color: '#00d4ff' },
    { name: 'PDF', value: srcCounts.pdf, color: '#f59e0b' },
    { name: 'Notes', value: srcCounts.note, color: '#10b981' },
  ].filter(s => s.value > 0);

  const tagFreq: Record<string, number> = {};
  memories.forEach(m => m.tags.forEach(t => { tagFreq[t] = (tagFreq[t] || 0) + 1; }));
  const topTags = Object.entries(tagFreq).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([name, value]) => ({ name, value }));

  const actMap: Record<string, number> = {};
  memories.forEach(m => {
    const d = new Date(m.created_at);
    if (!isNaN(d.getTime())) { const k = d.toLocaleDateString('en-US', { weekday: 'short' }); actMap[k] = (actMap[k] || 0) + 1; }
  });
  const actData = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => ({ day: d, captures: actMap[d] || 0 }));

  const completedTasks = tasks.filter(t => t.status === 'completed').length;
  const avgTagsPerMemory = memories.length > 0 ? (memories.reduce((s, m) => s + (m.tags?.length || 0), 0) / memories.length).toFixed(1) : 0;

  const kpis = [
    { label: 'Total Memories', value: memories.length, sub: 'Captured knowledge', color: '#00d4ff', icon: Brain },
    { label: 'Domains', value: domains.length, sub: 'Knowledge areas', color: '#8b5cf6', icon: Target },
    { label: 'AI Sessions', value: logs.length, sub: 'Queries answered', color: '#f472b6', icon: Zap },
    { label: 'Tasks Done', value: completedTasks, sub: `of ${tasks.length} total`, color: '#10b981', icon: TrendingUp },
  ];

  return (
    <div style={{ color: 'var(--text-1)' }}>
      {!embedded && (
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 38, height: 38, borderRadius: 10, background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <BarChart2 size={17} color="#10b981" />
            </div>
            <div>
              <h1 style={{ color: 'var(--text-1)', fontSize: 22, fontWeight: 800, margin: 0, letterSpacing: '-0.4px' }}>Analytics</h1>
              <p style={{ color: 'var(--text-3)', fontSize: 12, margin: 0 }}>Deep insights into your knowledge patterns and learning velocity</p>
            </div>
          </div>
        </motion.div>
      )}

      {/* KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 10, marginBottom: 16 }}>
        {kpis.map((k, i) => (
          <motion.div key={k.label} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.07 }}
            style={{ ...card, padding: '16px 18px', border: `1px solid ${k.color}20` }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <div style={{ width: 30, height: 30, borderRadius: 8, background: `${k.color}14`, border: `1px solid ${k.color}22`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <k.icon size={14} color={k.color} />
              </div>
              <div style={{ width: 36, height: 4, borderRadius: 4, background: `${k.color}18`, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${Math.min(100, (Number(k.value) / Math.max(10, Number(k.value))) * 100)}%`, background: k.color, borderRadius: 4 }} />
              </div>
            </div>
            <div style={{ fontSize: 30, fontWeight: 800, color: k.color, lineHeight: 1, marginBottom: 3 }}>{k.value}</div>
            <div style={{ color: 'var(--text-1)', fontSize: 12, fontWeight: 600 }}>{k.label}</div>
            <div style={{ color: 'var(--text-3)', fontSize: 10.5, marginTop: 2 }}>{k.sub}</div>
          </motion.div>
        ))}
      </div>

      {/* Row 1: Charts */}
      <div className="grid-2col">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.28 }} style={{ ...card, padding: '16px 18px' }}>
          <div style={{ color: 'var(--text-1)', fontWeight: 700, fontSize: 13, marginBottom: 3 }}>Captures by Day</div>
          <div style={{ color: 'var(--text-3)', fontSize: 10.5, marginBottom: 14 }}>Day-of-week distribution</div>
          <Suspense fallback={<ChartFallback height={130} />}>
            <CapturesAreaChart data={actData} />
          </Suspense>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.33 }} style={{ ...card, padding: '16px 18px' }}>
          <div style={{ color: 'var(--text-1)', fontWeight: 700, fontSize: 13, marginBottom: 3 }}>Source Distribution</div>
          <div style={{ color: 'var(--text-3)', fontSize: 10.5, marginBottom: 12 }}>Where your knowledge comes from</div>
          {srcData.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 6 }}>
              {srcData.map(s => (
                <div key={s.name}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ color: 'var(--text-2)', fontSize: 12 }}>{s.name}</span>
                    <span style={{ color: s.color, fontSize: 11, fontWeight: 700 }}>{s.value} ({Math.round(s.value / memories.length * 100)}%)</span>
                  </div>
                  <div style={{ height: 4, background: 'rgba(255,255,255,0.06)', borderRadius: 4, overflow: 'hidden' }}>
                    <motion.div initial={{ width: 0 }} animate={{ width: `${(s.value / memories.length) * 100}%` }} transition={{ duration: 0.8, delay: 0.5 }}
                      style={{ height: '100%', borderRadius: 4, background: s.color, boxShadow: `0 0 8px ${s.color}60` }} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p style={{ color: 'var(--text-3)', fontSize: 12, margin: 0, marginTop: 24 }}>Capture memories to see distribution</p>
          )}
        </motion.div>
      </div>

      {/* Row 2: More charts */}
      <div className="grid-2col">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.38 }} style={{ ...card, padding: '16px 18px' }}>
          <div style={{ color: 'var(--text-1)', fontWeight: 700, fontSize: 13, marginBottom: 14 }}>Knowledge Domains</div>
          {domains.length > 0 ? (
            <Suspense fallback={<ChartFallback height={160} />}>
              <DomainsBarChart data={domains.slice(0, 8)} colors={COLORS} />
            </Suspense>
          ) : (
            <p style={{ color: 'var(--text-3)', fontSize: 12, margin: '24px 0 0', textAlign: 'center' }}>No domain data yet</p>
          )}
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.43 }} style={{ ...card, padding: '16px 18px' }}>
          <div style={{ color: 'var(--text-1)', fontWeight: 700, fontSize: 13, marginBottom: 6 }}>Top Tags</div>
          <div style={{ color: 'var(--text-3)', fontSize: 10.5, marginBottom: 12 }}>Most frequent knowledge tags · avg {avgTagsPerMemory}/memory</div>
          {topTags.length > 0 ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
              {topTags.map((t, i) => {
                const clr = COLORS[i % COLORS.length];
                const size = Math.max(10, Math.min(15, 9 + t.value * 1.5));
                return (
                  <div key={t.name} style={{ padding: '4px 10px', background: `${clr}10`, border: `1px solid ${clr}25`, borderRadius: 20, cursor: 'default' }}>
                    <span style={{ color: clr, fontSize: size, fontWeight: 600 }}>#{t.name}</span>
                    <span style={{ color: 'var(--text-3)', fontSize: 9, marginLeft: 4 }}>×{t.value}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <p style={{ color: 'var(--text-3)', fontSize: 12, margin: '20px 0 0' }}>No tags yet — add tags when capturing</p>
          )}
        </motion.div>
      </div>
    </div>
  );
};

export default AnalyticsView;
