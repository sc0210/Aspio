'use client';

import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';
import { useTranslation } from 'react-i18next';
import type { CompareDataResponse, PeerStatCard } from '@/shared/types';
import { formatCurrency as formatCurrencyUtil } from '@/utils/formatters';
import { CURRENCIES } from '@/utils/constants';

interface CompareLineChartProps {
  chart: CompareDataResponse['chart'];
  users: PeerStatCard[];
  /** Display currency (the signed-in user's preferred currency). */
  currency: string;
}

// Per-user colour palette — matches portfolio chart's colour family
const USER_COLORS = [
  { line: '#3b82f6', area: '#3b82f6' },  // blue  (self)
  { line: '#10b981', area: '#10b981' },  // green (peer 1)
  { line: '#f97316', area: '#f97316' },  // orange (peer 2)
];

const currencySymbol = (currency: string) =>
  CURRENCIES.find((c) => c.code === currency)?.symbol ?? currency;

// Compact axis ticks keep the k/M scale, but use the display currency's symbol.
const formatCompact = (value: number, currency: string) => {
  const sym = currencySymbol(currency);
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${sign}${sym}${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}${sym}${(abs / 1_000).toFixed(0)}K`;
  return `${sign}${sym}${abs.toFixed(0)}`;
};

// Force en-US so TWD shows its distinct "NT$" symbol (zh-TW renders TWD as a
// bare "$", indistinguishable from USD).
const formatFull = (value: number, currency: string) =>
  formatCurrencyUtil(value, currency, { locale: 'en-US' });

const formatDate = (dateStr: string) =>
  new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

export default function CompareLineChart({ chart, users, currency }: CompareLineChartProps) {
  const { t } = useTranslation('common');

  if (chart.length <= 1) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm flex items-center justify-center h-[300px]">
        <p className="text-gray-500 dark:text-gray-400 text-sm text-center px-6">
          {t('compare.chartEmpty', 'Not enough historical data yet. Check back after a few days.')}
        </p>
      </div>
    );
  }

  // Dark mode detection — same pattern as PortfolioChart
  const isDark =
    typeof document !== 'undefined' &&
    document.documentElement.classList.contains('dark');

  const gridColor = isDark ? '#374151' : '#e5e7eb';
  const tickColor = isDark ? '#9ca3af' : '#6b7280';
  const tooltipBg = isDark ? '#1f2937' : '#ffffff';
  const tooltipBorder = isDark ? '#4b5563' : '#d1d5db';
  const tooltipTextPrimary = isDark ? '#f3f4f6' : '#111827';
  const tooltipTextSecondary = isDark ? '#9ca3af' : '#6b7280';

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm p-4 sm:p-6">
      {/* Header */}
      <div className="mb-4">
        <h2 className="text-base font-semibold text-gray-900 dark:text-white">
          {t('compare.chartTitle', 'Net Worth Over Time')}
        </h2>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
          {t('compare.chartSubtitle', 'Based on current portfolio values')}
        </p>
      </div>

      {/* Chart */}
      <div className="h-64 sm:h-72 lg:h-80 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chart} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
            <defs>
              {users.map((user, index) => {
                const color = USER_COLORS[index % USER_COLORS.length].line;
                return (
                  <linearGradient
                    key={user.user_id}
                    id={`lineGrad-${index}`}
                    x1="0" y1="0" x2="1" y2="0"
                  >
                    <stop offset="0%"   stopColor={color} stopOpacity={0.7} />
                    <stop offset="50%"  stopColor={color} stopOpacity={1} />
                    <stop offset="100%" stopColor={color} stopOpacity={0.7} />
                  </linearGradient>
                );
              })}
            </defs>

            <CartesianGrid
              strokeDasharray="5 5"
              stroke={gridColor}
              strokeOpacity={0.5}
              vertical={false}
            />

            <XAxis
              dataKey="date"
              tickFormatter={formatDate}
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 11, fill: tickColor, fontWeight: 500 }}
              minTickGap={40}
              dy={6}
            />

            <YAxis
              tickFormatter={(v) => formatCompact(v, currency)}
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 11, fill: tickColor, fontWeight: 500 }}
              width={64}
              dx={-4}
            />

            <Tooltip
              cursor={{
                stroke: isDark ? '#6b7280' : '#d1d5db',
                strokeWidth: 1,
                strokeDasharray: '5 5',
              }}
              content={({ active, payload, label }) => {
                if (!active || !payload || !payload.length) return null;
                return (
                  <div
                    style={{
                      backgroundColor: tooltipBg,
                      border: `1px solid ${tooltipBorder}`,
                      borderRadius: '12px',
                      boxShadow: isDark
                        ? '0 10px 25px -5px rgba(0,0,0,0.5)'
                        : '0 10px 25px -5px rgba(0,0,0,0.1)',
                      padding: '12px 14px',
                      minWidth: '180px',
                    }}
                  >
                    <p style={{ color: tooltipTextPrimary, fontWeight: 600, fontSize: '13px', marginBottom: '8px' }}>
                      {formatDate(label as string)}
                    </p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      {payload.map((entry, i) => {
                        const color = USER_COLORS[i % USER_COLORS.length].line;
                        const user = users.find((u) => u.user_id === entry.dataKey);
                        return (
                          <div key={String(entry.dataKey)} style={{ display: 'flex', justifyContent: 'space-between', gap: '16px' }}>
                            <span style={{ fontSize: '12px', color: tooltipTextSecondary, display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', backgroundColor: color, flexShrink: 0 }} />
                              {user?.name ?? String(entry.dataKey)}
                              {user?.is_self && (
                                <span style={{ fontSize: '10px', opacity: 0.7 }}>(You)</span>
                              )}
                            </span>
                            <span style={{ fontSize: '13px', fontWeight: 600, color: tooltipTextPrimary }}>
                              {formatFull(Number(entry.value), currency)}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              }}
            />

            {users.map((user, index) => {
              const color = USER_COLORS[index % USER_COLORS.length].line;
              return (
                <Line
                  key={user.user_id}
                  type="monotone"
                  dataKey={user.user_id}
                  stroke={`url(#lineGrad-${index})`}
                  strokeWidth={3}
                  dot={false}
                  activeDot={{
                    r: 6,
                    stroke: color,
                    strokeWidth: 3,
                    fill: isDark ? '#1f2937' : '#ffffff',
                    style: { filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.2))' },
                  }}
                  animationDuration={800}
                  animationEasing="ease-in-out"
                />
              );
            })}
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Inline legend — matches WalletTrendChart */}
      <div className="flex items-center justify-center gap-4 sm:gap-5 mt-3 text-xs">
        {users.map((user, index) => {
          const color = USER_COLORS[index % USER_COLORS.length].line;
          return (
            <div key={user.user_id} className="flex items-center gap-1.5">
              <div className="w-3 h-1.5 rounded-full" style={{ backgroundColor: color }} />
              <span className="text-gray-500 dark:text-gray-400 font-medium">
                {user.name}
                {user.is_self && <span className="ml-1 opacity-60">(You)</span>}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
