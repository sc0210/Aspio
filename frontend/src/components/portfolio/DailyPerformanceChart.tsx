'use client';

import { useMemo, memo } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  type TooltipProps,
} from 'recharts';
import { cn } from '@/utils/cn';
import { formatCurrency } from '@/utils/formatters';

interface TopHolding {
  symbol: string;
  change: number;
  value: number;
}

interface ChartDataPoint {
  date: string;
  value: number;
  change: number;
  changePercent: number;
  topHoldings: TopHolding[];
  displayDate: string;
  fullDate: Date;
}

interface DailyPerformanceChartProps {
  data: Array<{
    date: string;
    value: number;
    change: number;
    changePercent: number;
    topHoldings?: TopHolding[];
  }>;
  currency?: string;
  isValueVisible?: boolean;
  viewMode?: 'absolute' | 'percentage';
  className?: string;
}

// ⚡ OPTIMIZATION: Memoize component to prevent unnecessary re-renders
export const DailyPerformanceChart = memo(function DailyPerformanceChart({
  data,
  currency = 'USD',
  isValueVisible = true,
  viewMode = 'absolute',
  className,
}: DailyPerformanceChartProps) {
  const chartData = useMemo(() => {
    if (!Array.isArray(data) || data.length === 0) return [];

    return data.map(item => {
      // Ensure numeric values
      const value = Number(item.value) || 0;
      // Base values from payload
      let change = Number(item.change) || 0;
      let changePercent = Number(item.changePercent) || 0;

      // If topHoldings provide avgCost and closePrice, prefer computing change as
      // closePrice - averageCost for buys on that day. We attempt to derive a
      // more accurate daily change when richer data is available.
      if (Array.isArray(item.topHoldings) && item.topHoldings.length > 0) {
        try {
          type EnrichedHolding = { symbol: string; change: number; value: number; closePrice?: number; avgCost?: number; quantity?: number };
          // If holdings include avgCost and closePrice fields, compute per-holding delta
          const computableHoldings = (item.topHoldings as EnrichedHolding[]).filter((h) => h.closePrice !== undefined && h.avgCost !== undefined);
          if (computableHoldings.length > 0) {
            // Sum per-holding change values (close - avgCost). If quantity is provided, multiply.
            const computedChange = computableHoldings.reduce((sum: number, h: EnrichedHolding) => {
              const close = Number(h.closePrice) || 0;
              const avg = Number(h.avgCost) || 0;
              const qty = h.quantity !== undefined ? Number(h.quantity) : 1;
              return sum + (close - avg) * qty;
            }, 0);

            // Override change with computed value if it seems meaningful (non-zero)
            if (Math.abs(computedChange) > 0) {
              change = computedChange;
              // Recompute percent relative to portfolio value if available
              if (value !== 0) {
                changePercent = (change / value) * 100;
              }
            }
          }
        } catch {
          // Ignore and fall back to provided change values
        }
      }

      // Parse date string directly to avoid timezone conversion issues
      // Backend sends dates as "YYYY-MM-DD", parse components directly
      const [year, month, day] = item.date.split('-').map(Number);
      const dateObj = new Date(year, month - 1, day); // month is 0-indexed

      return {
        ...item,
        value,
        change,
        changePercent,
        topHoldings: item.topHoldings || [], // Preserve topHoldings data
        displayDate: dateObj.toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
        }),
        fullDate: dateObj, // Store parsed date for tooltip
      };
    });
  }, [data]);

  const CustomTooltip = ({ active, payload }: TooltipProps<number | string, string>) => {
    if (!active || !payload || !payload.length) return null;

    const data = payload[0].payload as ChartDataPoint;
    const isPositive = data.change >= 0;

    return (
      <div
        className="bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-xl shadow-lg p-4 min-w-[240px] max-w-[320px] backdrop-blur-sm bg-opacity-95 dark:bg-opacity-95"
        role="tooltip"
        aria-live="polite"
      >
        <div className="flex items-center justify-between mb-3 pb-3 border-b border-gray-200 dark:border-gray-700">
          <time className="text-sm font-bold text-gray-900 dark:text-white" dateTime={data.date}>
            {data.fullDate.toLocaleDateString('en-US', {
              weekday: 'short',
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            })}
          </time>
        </div>

        <div className="space-y-3">
          {/* Portfolio Value */}
          <div className="flex justify-between items-center gap-4">
            <span className="text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
              Portfolio Value
            </span>
            <span className="text-sm font-bold text-gray-900 dark:text-white tabular-nums">
              {isValueVisible ? formatCurrency(data.value, currency) : '•••••'}
            </span>
          </div>

          {/* Daily Change */}
          <div className="flex justify-between items-center gap-4">
            <span className="text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
              Daily Change
            </span>
            <span
              className={cn(
                'text-sm font-bold tabular-nums',
                isPositive
                  ? 'text-success-700 dark:text-success-400'
                  : 'text-error-700 dark:text-error-400'
              )}
            >
              {isValueVisible ? (
                <>
                  {isPositive ? '+' : ''}
                  {formatCurrency(data.change, currency)}
                </>
              ) : (
                '•••••'
              )}
            </span>
          </div>

          {/* Return Percentage */}
          <div className="flex justify-between items-center gap-4">
            <span className="text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
              Return
            </span>
            <span
              className={cn(
                'text-sm font-bold tabular-nums',
                isPositive
                  ? 'text-success-700 dark:text-success-400'
                  : 'text-error-700 dark:text-error-400'
              )}
              aria-label={`Return ${isPositive ? 'gain' : 'loss'} of ${data.changePercent.toFixed(2)} percent`}
            >
              {isValueVisible ? (
                <>
                  {isPositive ? '+' : ''}
                  {data.changePercent.toFixed(2)}%
                </>
              ) : (
                '•••%'
              )}
            </span>
          </div>

          {/* Top Holdings Section */}
          {data.topHoldings && data.topHoldings.length > 0 && (
            <div className="border-t border-gray-200 dark:border-gray-700 pt-3 mt-3">
              <p className="text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider mb-2">
                Top Movers
              </p>
              <div className="space-y-2" role="list">
                {data.topHoldings.map((holding: TopHolding, idx: number) => {
                  const holdingIsPositive = holding.change >= 0;
                  return (
                    <div
                      key={idx}
                      className="flex justify-between items-center gap-3 py-1"
                      role="listitem"
                    >
                      <span className="text-xs font-bold text-gray-800 dark:text-gray-200 tracking-wide">
                        {holding.symbol}
                      </span>
                      <span
                        className={cn(
                          'text-xs font-bold tabular-nums',
                          holdingIsPositive
                            ? 'text-success-700 dark:text-success-400'
                            : 'text-error-700 dark:text-error-400'
                        )}
                        aria-label={`${holding.symbol} ${holdingIsPositive ? 'gain' : 'loss'}`}
                      >
                        {isValueVisible ? (
                          <>
                            {holdingIsPositive ? '+' : ''}
                            {formatCurrency(holding.change, currency)}
                          </>
                        ) : (
                          '•••••'
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  if (!chartData.length) {
    return (
      <div
        className={cn('flex flex-col items-center justify-center py-16 px-4', className)}
        role="status"
        aria-live="polite"
      >
        <div className="text-center max-w-sm">
          <div className="w-16 h-16 mx-auto mb-4 rounded-xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
            <svg
              className="w-8 h-8 text-gray-500 dark:text-gray-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
              />
            </svg>
          </div>
          <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            No Performance Data Available
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Add holdings to see your daily portfolio performance
          </p>
        </div>
      </div>
    );
  }

  // Get today's performance (latest data point)
  const todayData = chartData[chartData.length - 1];
  const todayChange = todayData?.change || 0;
  const _todayChangePercent = todayData?.changePercent || 0;
  const _isPositive = todayChange >= 0;

  return (
    <div
      className={cn('h-full flex flex-col', className)}
      role="img"
      aria-label={`Daily performance chart showing ${chartData.length} data points`}
    >
      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={chartData}
            margin={{
              top: 10,
              right: 10,
              left: 0,
              bottom: 35
            }}
            accessibilityLayer
          >
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="currentColor"
              className="text-gray-200 dark:text-gray-700 opacity-50"
              vertical={false}
            />
            <XAxis
              dataKey="displayDate"
              tick={{
                fill: 'currentColor',
                fontSize: 11,
                fontWeight: 500
              }}
              className="text-gray-600 dark:text-gray-400"
              angle={-45}
              textAnchor="end"
              height={50}
              interval={typeof window !== 'undefined' && window.innerWidth < 640
                ? Math.max(Math.floor(chartData.length / 4), 1)
                : 'preserveStartEnd'
              }
              tickMargin={10}
            />
            <YAxis
              tick={{
                fill: 'currentColor',
                fontSize: 11,
                fontWeight: 500
              }}
              className="text-gray-600 dark:text-gray-400"
              width={70}
              tickMargin={8}
              tickFormatter={(value) => {
                if (!isValueVisible) return '•••';
                if (viewMode === 'percentage') {
                  return `${value.toFixed(1)}%`;
                }
                return formatCurrency(value, currency, { compact: true, showSymbol: false });
              }}
            />
            <Tooltip
              content={<CustomTooltip />}
              cursor={{ stroke: 'rgb(99, 102, 241)', strokeWidth: 2, strokeDasharray: '5 5' }}
              animationDuration={200}
              wrapperStyle={{ outline: 'none' }}
            />
            <Bar
              dataKey={viewMode === 'percentage' ? 'changePercent' : 'change'}
              radius={[6, 6, 0, 0]}
              maxBarSize={36}
              minPointSize={3}
              animationDuration={500}
              animationBegin={0}
            >
              {chartData.map((entry, index) => {
                const value = viewMode === 'percentage' ? entry.changePercent : entry.change;
                const isPositive = value >= 0;
                return (
                  <Cell
                    key={`cell-${index}`}
                    fill={isPositive ? 'var(--color-prosperity-500, #10b981)' : 'var(--color-error-500, #ef4444)'}
                    className="transition-opacity duration-200 hover:opacity-80"
                  />
                );
              })}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
});
