import React, { lazy } from 'react';
import { BarChart2, GitBranch, Network } from 'lucide-react';
import TabbedPage from '../components/TabbedPage';

const TimelinePage = lazy(() => import('./TimelinePage'));
const GraphPage = lazy(() => import('./GraphPage'));
const AnalyticsPage = lazy(() => import('./AnalyticsPage'));

const InsightsPage: React.FC = () => {
  return (
    <TabbedPage
      icon={BarChart2}
      iconColor="#c5f82a"
      iconBg="rgba(197,248,42,0.15)"
      title="Insights"
      subtitle="Timeline, mind graph, and analytics — see your knowledge from every angle"
      hub="insights"
      paramKey="view"
      defaultTab="timeline"
      tabs={[
        { id: 'timeline',  label: 'Timeline',   icon: GitBranch, render: () => <TimelinePage embedded /> },
        { id: 'graph',     label: 'Mind Graph', icon: Network,   render: () => <GraphPage embedded /> },
        { id: 'analytics', label: 'Analytics',  icon: BarChart2, render: () => <AnalyticsPage embedded /> },
      ]}
    />
  );
};

export default InsightsPage;
