import React from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar,
} from './RechartsBundle';

// Self-contained chart blocks for the Dashboard. Loaded via React.lazy
// from the page so recharts (~250 KB) sits in its own `vendor-recharts`
// chunk and is only fetched once a chart actually renders.

export interface ForecastBarChartProps {
  data: { date: string; label: string; day: number; revisits: number; tasks: number }[];
}
export const ForecastBarChart: React.FC<ForecastBarChartProps> = ({ data }) => (
  <ResponsiveContainer width="100%" height={160}>
    <BarChart data={data} margin={{ top: 5, right: 6, left: -22, bottom: 0 }}>
      <XAxis dataKey="label" tick={{ fill: '#94a3b8', fontSize: 10 }} axisLine={false} tickLine={false} />
      <YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} axisLine={false} tickLine={false} allowDecimals={false} />
      <Tooltip
        contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 11, color: 'var(--text-1)', boxShadow: 'var(--shadow-md)' }}
        cursor={{ fill: 'rgba(147,51,234,0.06)' }}
        labelFormatter={(_l, payload) => {
          const p = payload?.[0]?.payload as any;
          return p ? `${p.label} ${p.day}` : '';
        }}
      />
      <Bar dataKey="revisits" stackId="a" fill="#f59e0b" radius={[0, 0, 0, 0]} name="Revisits" />
      <Bar dataKey="tasks" stackId="a" fill="#9333ea" radius={[3, 3, 0, 0]} name="Tasks" />
    </BarChart>
  </ResponsiveContainer>
);

export interface DomainsRadarChartProps {
  data: { subject: string; value: number; fullMark: number }[];
}
export const DomainsRadarChart: React.FC<DomainsRadarChartProps> = ({ data }) => (
  <ResponsiveContainer width="100%" height={140}>
    <RadarChart data={data} margin={{ top: 5, right: 8, bottom: 5, left: 8 }}>
      <PolarGrid stroke="var(--border)" />
      <PolarAngleAxis dataKey="subject" tick={{ fill: '#94a3b8', fontSize: 9 }} />
      <PolarRadiusAxis tick={false} axisLine={false} />
      <Radar dataKey="value" stroke="#6366f1" fill="#6366f1" fillOpacity={0.15} strokeWidth={2} dot={{ r: 2, fill: '#6366f1' }} />
    </RadarChart>
  </ResponsiveContainer>
);
