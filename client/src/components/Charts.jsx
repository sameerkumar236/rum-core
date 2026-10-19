import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { EmptyState } from './ui';
import { number } from '../format';

export function TrafficChart({ timeline = [], range = '24h', metric = 'pageViews' }) {
  if (!timeline.length || !timeline.some((point) => point.pageViews || point.requests))
    return (
      <EmptyState
        title="Waiting for the first signal"
        description="Traffic will appear here as soon as the tracker sends events from your website."
      />
    );
  const formatTime = (value) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return range === '7d' || range === '30d'
      ? date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
      : date.toLocaleTimeString(undefined, {
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        });
  };
  return (
    <div
      className="traffic-chart"
      role="img"
      aria-label={`${metric === 'pageViews' ? 'Page views' : 'API requests'} over the selected time range`}
    >
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={timeline} margin={{ top: 20, right: 16, bottom: 0, left: -20 }}>
          <defs>
            <linearGradient id={`chart-fill-${metric}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--chart)" stopOpacity={0.2} />
              <stop offset="100%" stopColor="var(--chart)" stopOpacity={0.01} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 5" vertical={false} stroke="var(--chart-grid)" />
          <XAxis
            dataKey="time"
            tickFormatter={formatTime}
            tickLine={false}
            axisLine={false}
            minTickGap={35}
            tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
            dy={12}
          />
          <YAxis
            tickFormatter={number}
            allowDecimals={false}
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
          />
          <Tooltip
            labelFormatter={(value) => new Date(value).toLocaleString()}
            formatter={(value) => [
              number(value),
              metric === 'pageViews' ? 'Page views' : 'Requests',
            ]}
            contentStyle={{
              border: '1px solid var(--border)',
              background: 'var(--card)',
              color: 'var(--foreground)',
              borderRadius: 0,
              fontSize: 12,
              boxShadow: '0 4px 12px #0001',
            }}
          />
          <Area
            isAnimationActive={false}
            type="monotone"
            dataKey={metric}
            stroke="var(--chart)"
            strokeWidth={2}
            fill={`url(#chart-fill-${metric})`}
            activeDot={{ r: 4, stroke: 'var(--background)', strokeWidth: 2 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function Distribution({ rows = [], label = 'pageViews' }) {
  const total = rows.reduce((sum, row) => sum + (row[label] || 0), 0);
  if (!rows.length)
    return (
      <EmptyState
        title="No data yet"
        description="Visitor information will appear when events arrive."
      />
    );
  return (
    <div className="distribution">
      {rows.slice(0, 6).map((row, index) => (
        <div className="distribution-row" key={row.name || index}>
          <div className="distribution-label">
            <span>
              <i
                style={{
                  background: [
                    'var(--primary)',
                    '#34d399',
                    '#6ee7b7',
                    '#a7f3d0',
                    '#f59e0b',
                    '#fb923c',
                  ][index % 6],
                }}
              />
              {row.name || 'Unknown'}
            </span>
            <strong>
              {number(row[label])}
              <small>{total ? Math.round((row[label] / total) * 100) : 0}%</small>
            </strong>
          </div>
          <div className="distribution-track">
            <span style={{ width: `${total ? (row[label] / total) * 100 : 0}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}
