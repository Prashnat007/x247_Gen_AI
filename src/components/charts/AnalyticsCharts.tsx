import React from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  CartesianGrid, Area, AreaChart,
} from './RechartsBundle';

const TOOLTIP_STYLE = {
  contentStyle: {
    background: '#0d0d1a', border: '1px solid rgba(0,212,255,0.2)',
    borderRadius: 8, fontSize: 11, color: '#e2e8f0',
    fontFamily: "'Poppins', sans-serif",
  },
  cursor: { fill: 'rgba(255,255,255,0.03)' },
};

export interface CapturesAreaChartProps {
  data: { day: string; captures: number }[];
}
export const CapturesAreaChart: React.FC<CapturesAreaChartProps> = ({ data }) => (
  <ResponsiveContainer width="100%" height={130}>
    <AreaChart data={data} margin={{ top: 0, right: 0, left: -26, bottom: 0 }}>
      <defs>
        <linearGradient id="capGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="5%" stopColor="#00d4ff" stopOpacity={0.3} />
          <stop offset="95%" stopColor="#00d4ff" stopOpacity={0} />
        </linearGradient>
      </defs>
      <CartesianGrid stroke="rgba(255,255,255,0.04)" vertical={false} />
      <XAxis dataKey="day" tick={{ fill: 'var(--text-3, #6b7280)', fontSize: 10 }} axisLine={false} tickLine={false} />
      <YAxis tick={{ fill: 'var(--text-3, #6b7280)', fontSize: 10 }} axisLine={false} tickLine={false} />
      <Tooltip {...TOOLTIP_STYLE} />
      <Area type="monotone" dataKey="captures" stroke="#00d4ff" strokeWidth={2} fill="url(#capGrad)" />
    </AreaChart>
  </ResponsiveContainer>
);

export interface DomainsBarChartProps {
  data: { name: string; value: number }[];
  colors: string[];
}
export const DomainsBarChart: React.FC<DomainsBarChartProps> = ({ data, colors }) => (
  <ResponsiveContainer width="100%" height={160}>
    <BarChart data={data} layout="vertical" margin={{ top: 0, right: 10, left: 0, bottom: 0 }}>
      <XAxis type="number" tick={{ fill: 'var(--text-3, #6b7280)', fontSize: 9 }} axisLine={false} tickLine={false} />
      <YAxis type="category" dataKey="name" tick={{ fill: 'var(--text-2, #9ca3af)', fontSize: 10 }} axisLine={false} tickLine={false} width={80} />
      <Tooltip {...TOOLTIP_STYLE} />
      <Bar dataKey="value" radius={[0, 4, 4, 0]}>
        {data.map((_, i) => <Cell key={i} fill={colors[i % colors.length]} />)}
      </Bar>
    </BarChart>
  </ResponsiveContainer>
);
