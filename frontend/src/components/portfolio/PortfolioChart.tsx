'use client';

import { useMemo, useState, useEffect, useCallback, memo } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { ChartBarIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import { useTheme } from '@/contexts/ThemeContext';
import { cn } from '@/utils/cn';
import { formatCurrency } from '@/utils/formatters';
import { PortfolioHolding, MarketType } from '@/shared/types';
import { portfolioService } from '@/services/portfolioService';

interface DailyPerformanceEntry {
  date: string;
  value: number | string;
  capitalAdded?: number | string;
}

interface PortfolioChartProps {
  holdings: PortfolioHolding[];
  baseCurrency?: string;
  /** External timeframe control (when provided, internal selector is hidden) */
  externalTimeframe?: '7D' | '30D' | '90D' | '1Y' | 'YTD' | 'MAX';
  /** Pre-fetched daily performance data. When provided, skips the internal fetch. */
  dailyPerformanceData?: DailyPerformanceEntry[];
}

type ChartType = 'timeline' | 'allocation' | 'performance';

const getMarketColor = (market: MarketType) => {
  const colors: Record<MarketType, string> = {
    'US': '#3B82F6',
    'TW': '#EF4444',
    'HK': '#F59E0B',
    'SG': '#10B981',
    'JP': '#8B5CF6',
    'CRYPTO': '#F97316'
  };
  return colors[market] || '#6B7280';
};

export function mapExternalTimeframe(external?: string): string {
  if (!external) return '6M';
  switch (external) {
    case '7D': return '1W';
    case '30D': return '1M';
    case '90D': return '3M';
    case '1Y': return '1Y';
    case 'YTD': return '6M';
    case 'MAX': return 'ALL';
    default: return '6M';
  }
}

// ⚡ OPTIMIZATION: Memoize component to prevent unnecessary re-renders
export const PortfolioChart = memo(function PortfolioChart({ holdings, baseCurrency = 'USD', externalTimeframe, dailyPerformanceData }: PortfolioChartProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  const [timeframe, setTimeframe] = useState(mapExternalTimeframe(externalTimeframe));
  const [chartType, setChartType] = useState<ChartType>('timeline');
  const [rawHistoricalData, setRawHistoricalData] = useState<Array<{ date: string; fullDate?: string; value: number; capitalAdded?: number }>>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [currentPeriodChange, setCurrentPeriodChange] = useState<number>(0);
  const [dataError, setDataError] = useState<string | null>(null);
  const [targetIRR, setTargetIRR] = useState<number>(6); // Default 6% annual IRR target
  const [showProjection, setShowProjection] = useState<boolean>(true);
  const [monthlyInvestment, setMonthlyInvestment] = useState<number>(20000); // Default monthly investment amount

  // Sync external timeframe changes
  useEffect(() => {
    if (externalTimeframe) {
      const mapped = mapExternalTimeframe(externalTimeframe);
      setTimeframe(prev => prev !== mapped ? mapped : prev);
    }
  }, [externalTimeframe]); // mapExternalTimeframe is module-scope stable

  const fetchHistoricalData = useCallback(async () => {
    setIsLoadingHistory(true);
    setDataError(null);

    try {
      const days = timeframe === '1W' ? 7 : timeframe === '1M' ? 30 : timeframe === '3M' ? 90 : timeframe === '6M' ? 180 : timeframe === '1Y' ? 365 : 9999;

      // Use pre-fetched data (from React Query cache) when available; avoids duplicate network call
      let entries: DailyPerformanceEntry[];
      if (dailyPerformanceData && dailyPerformanceData.length > 0) {
        entries = days < 9999 ? dailyPerformanceData.slice(-days) : dailyPerformanceData;
      } else {
        const response = await portfolioService.getDailyPerformance(days);
        if (!response.success || !Array.isArray(response.data) || response.data.length === 0) {
          setDataError('Historical data not available. Please ensure your holdings have sufficient price history.');
          setRawHistoricalData([]);
          return;
        }
        entries = response.data as DailyPerformanceEntry[];
      }

      const formattedData = entries.map((day, index) => {
        const date = new Date(day.date);
        let dateLabel = '';

        if (timeframe === '1W' || timeframe === '1M' || timeframe === '3M') {
          dateLabel = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        } else if (timeframe === '1Y') {
          const now = new Date();
          dateLabel = date.getFullYear() !== now.getFullYear()
            ? date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
            : date.toLocaleDateString('en-US', { month: 'short' });
        } else {
          dateLabel = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        }

        void index; // index retained for future label-thinning logic

        return {
          date: dateLabel,
          fullDate: day.date,
          value: Number(day.value) || 0,
          capitalAdded: Number(day.capitalAdded) || 0
        };
      });

      setRawHistoricalData(formattedData);
      setDataError(null);

      if (formattedData.length >= 2) {
        const firstValue = formattedData[0].value;
        const lastValue = formattedData[formattedData.length - 1].value;
        const change = firstValue > 0 ? ((lastValue - firstValue) / firstValue) * 100 : 0;
        setCurrentPeriodChange(change);
      }
    } catch (error: unknown) {
      setDataError(error instanceof Error ? error.message : 'Failed to load historical data. Please try again later.');
      setRawHistoricalData([]);
    } finally {
      setIsLoadingHistory(false);
    }
  }, [timeframe, dailyPerformanceData]);

  // Fetch real historical data when timeframe or holdings change
  useEffect(() => {
    if (chartType === 'timeline' && holdings.length > 0) {
      fetchHistoricalData();
    }
  }, [fetchHistoricalData, holdings, chartType]);

  // Calculate projected values whenever raw data, targetIRR, monthlyInvestment, or showProjection changes
  const historicalData = useMemo(() => {
    if (!showProjection || rawHistoricalData.length === 0) {
      return rawHistoricalData;
    }

    // Find first non-zero value to use as starting point (first purchase date)
    let startIndex = 0;
    for (let i = 0; i < rawHistoricalData.length; i++) {
      if (rawHistoricalData[i].value > 0) {
        startIndex = i;
        break;
      }
    }

    const startDate = new Date(rawHistoricalData[startIndex].fullDate || rawHistoricalData[startIndex].date);
    const annualRate = targetIRR / 100; // e.g., 0.06 for 6%
    const monthlyRate = Math.pow(1 + annualRate, 1 / 12) - 1; // Convert annual to monthly


    return rawHistoricalData.map((item, index) => {
      // Before first purchase, no projection
      if (index < startIndex) {
        return { ...item, projectedValue: 0 };
      }

      const currentDate = new Date(item.fullDate || item.date);

      // Calculate days since first purchase, then convert to months
      const daysSinceStart = Math.floor((currentDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
      const monthsSinceStart = Math.floor(daysSinceStart / 30.44); // Average days per month

      // Future value of a series of monthly investments with compound interest
      // FV = PMT × [(1 + r)^n - 1] / r
      // Where: PMT = monthly payment, r = monthly rate, n = number of months
      let projectedValue = 0;
      if (daysSinceStart === 0 || monthsSinceStart === 0) {
        // On first purchase date, value = first monthly investment
        projectedValue = monthlyInvestment;
      } else if (monthlyRate === 0) {
        // No growth, just accumulation
        projectedValue = monthlyInvestment * (monthsSinceStart + 1);
      } else {
        // Formula: FV = PMT × [(1 + r)^n - 1] / r
        // This calculates the future value of monthly deposits with compound interest
        projectedValue = monthlyInvestment * ((Math.pow(1 + monthlyRate, monthsSinceStart + 1) - 1) / monthlyRate);
      }

      return { ...item, projectedValue };
    });
  }, [rawHistoricalData, targetIRR, monthlyInvestment, showProjection]);

  const chartData = useMemo(() => {
    if (!holdings.length) return [];

    if (chartType === 'timeline') {
      return historicalData;
    }

    const totalValue = holdings.reduce((sum, holding) => sum + holding.totalValue, 0);

    if (chartType === 'allocation') {
      const marketData = holdings.reduce((acc, holding) => {
        const mkt = (holding.market ?? 'US') as MarketType;
        if (!acc[mkt]) {
          acc[mkt] = { value: 0, count: 0 };
        }
        acc[mkt].value += holding.totalValue;
        acc[mkt].count += 1;
        return acc;
      }, {} as Record<MarketType, { value: number; count: number }>);

      return Object.entries(marketData).map(([market, data]) => ({
        market,
        value: data.value,
        percentage: (data.value / totalValue) * 100,
        count: data.count,
        color: getMarketColor(market as MarketType)
      }));
    }

    return [];
  }, [holdings, chartType, historicalData]);

  if (!holdings.length) {
    return (
      <div className="card">
        <div className="text-center py-12">
          <ChartBarIcon className="w-12 h-12 text-gray-500 dark:text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
            No Portfolio Data
          </h3>
          <p className="text-gray-500 dark:text-gray-400">
            Add holdings to see portfolio analytics
          </p>
        </div>
      </div>
    );
  }

  const timeframeOptions = [
    { label: '1W', value: '1W' },
    { label: '1M', value: '1M' },
    { label: '3M', value: '3M' },
    { label: '6M', value: '6M' },
    { label: '1Y', value: '1Y' },
    { label: 'ALL', value: 'ALL' },
  ];

  const chartTypeOptions = [
    { label: 'Timeline', value: 'timeline' as ChartType },
    { label: 'Allocation', value: 'allocation' as ChartType },
  ];

  const renderTimelineChart = () => {
    // Show error message if in auth mode and no data
    if (dataError) {
      return (
        <div className="w-full h-full flex items-center justify-center p-8">
          <div className="max-w-md text-center">
            <div className="mb-4 flex justify-center">
              <div className="p-4 bg-error-100 dark:bg-error-900/30 rounded-full">
                <ExclamationTriangleIcon className="w-12 h-12 text-error-700 dark:text-error-400" />
              </div>
            </div>
            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">
              Data Not Available
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              {dataError}
            </p>
            <button
              onClick={fetchHistoricalData}
              className="px-4 py-2 bg-primary-700 hover:bg-primary-800 text-white rounded-lg text-sm font-medium transition-colors"
            >
              Retry
            </button>
          </div>
        </div>
      );
    }

    // Calculate if portfolio is trending up or down for gradient color
    const isPositiveGrowth = chartData.length > 1 && chartData[chartData.length - 1].value > chartData[0].value;

    // Define gradient colors based on growth direction
    const lineColor = isPositiveGrowth
      ? (isDark ? '#34d399' : '#10b981')  // prosperity green
      : (isDark ? '#f87171' : '#ef4444'); // error red

    return (
      <div className="w-full h-full px-2">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 25, right: 20, left: 5, bottom: 30 }}>
            <defs>
              {/* Gradient for the line - prosperity for gains, red for losses */}
              <linearGradient id="lineGradient" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor={lineColor} stopOpacity={0.8} />
                <stop offset="50%" stopColor={lineColor} stopOpacity={1} />
                <stop offset="100%" stopColor={lineColor} stopOpacity={0.8} />
              </linearGradient>
              {/* Area gradient under the line */}
              <linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={lineColor} stopOpacity={0.25} />
                <stop offset="95%" stopColor={lineColor} stopOpacity={0.02} />
              </linearGradient>
            </defs>

            <CartesianGrid
              strokeDasharray="5 5"
              stroke={isDark ? '#374151' : '#e5e7eb'}
              strokeOpacity={0.5}
              vertical={false}
            />

            <XAxis
              dataKey="date"
              axisLine={false}
              tickLine={false}
              tick={{
                fontSize: 11,
                fill: isDark ? '#9ca3af' : '#6b7280',
                fontWeight: 500
              }}
              interval={
                timeframe === '1M' ? Math.max(0, Math.floor(chartData.length / 6)) :
                  timeframe === '3M' ? Math.max(0, Math.floor(chartData.length / 6)) :
                    timeframe === '6M' ? Math.max(0, Math.floor(chartData.length / 7)) :
                      timeframe === '1Y' ? Math.max(0, Math.floor(chartData.length / 8)) :
                        Math.max(0, Math.floor(chartData.length / 12)) // Show ~12 labels for ALL timeframe
              }
              minTickGap={35}
              height={50}
              dy={10}
            />

            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{
                fontSize: 12,
                fill: isDark ? '#9ca3af' : '#6b7280',
                fontWeight: 500
              }}
              tickFormatter={(value) => {
                if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
                if (value >= 1000) return `${(value / 1000).toFixed(0)}K`;
                return value.toString();
              }}
              width={70}
              dx={-5}
            />

            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload || !payload.length) return null;

                const data = payload[0].payload;
                const actualValue = data.value;
                const projectedValue = data.projectedValue;

                return (
                  <div
                    style={{
                      backgroundColor: isDark ? '#1f2937' : 'white',
                      border: `1px solid ${isDark ? '#4b5563' : '#d1d5db'}`,
                      borderRadius: '12px',
                      boxShadow: isDark
                        ? '0 10px 25px -5px rgba(0, 0, 0, 0.5), 0 4px 10px -2px rgba(0, 0, 0, 0.3)'
                        : '0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 4px 10px -2px rgba(0, 0, 0, 0.05)',
                      padding: '12px 14px',
                      minWidth: '180px'
                    }}
                  >
                    <p style={{
                      color: isDark ? '#f3f4f6' : '#111827',
                      fontWeight: 600,
                      fontSize: '13px',
                      marginBottom: '8px'
                    }}>
                      {data.fullDate ? new Date(data.fullDate).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric'
                      }) : data.date}
                    </p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
                        <span style={{ fontSize: '12px', color: isDark ? '#9ca3af' : '#6b7280' }}>
                          Actual:
                        </span>
                        <span style={{
                          fontSize: '13px',
                          fontWeight: 600,
                          color: isDark ? '#e5e7eb' : '#374151'
                        }}>
                          {formatCurrency(actualValue, baseCurrency)}
                        </span>
                      </div>
                      {showProjection && projectedValue !== undefined && (
                        <>
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
                            <span style={{ fontSize: '12px', color: isDark ? '#fbbf24' : '#f59e0b' }}>
                              Target ({formatCurrency(monthlyInvestment, baseCurrency)}/mo @ {targetIRR}%):
                            </span>
                            <span style={{
                              fontSize: '13px',
                              fontWeight: 600,
                              color: isDark ? '#fbbf24' : '#f59e0b'
                            }}>
                              {formatCurrency(projectedValue, baseCurrency)}
                            </span>
                          </div>
                          <div style={{
                            borderTop: `1px solid ${isDark ? '#374151' : '#e5e7eb'}`,
                            paddingTop: '6px',
                            marginTop: '2px'
                          }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
                              <span style={{ fontSize: '12px', color: isDark ? '#9ca3af' : '#6b7280', fontWeight: 600 }}>
                                Gap:
                              </span>
                              <span style={{
                                fontSize: '13px',
                                fontWeight: 700,
                                color: actualValue >= projectedValue
                                  ? (isDark ? '#34d399' : '#10b981')
                                  : (isDark ? '#f87171' : '#ef4444')
                              }}>
                                {actualValue >= projectedValue ? '+' : ''}
                                {formatCurrency(actualValue - projectedValue, baseCurrency)}
                                {' '}
                                ({((actualValue - projectedValue) / projectedValue * 100).toFixed(1)}%)
                              </span>
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                );
              }}
              cursor={{
                stroke: isDark ? '#6b7280' : '#d1d5db',
                strokeWidth: 1,
                strokeDasharray: '5 5'
              }}
            />

            <Line
              type="monotone"
              dataKey="value"
              stroke="url(#lineGradient)"
              strokeWidth={3}
              dot={false}
              activeDot={{
                r: 6,
                stroke: lineColor,
                strokeWidth: 3,
                fill: isDark ? '#1f2937' : 'white',
                style: { filter: 'drop-shadow(0 2px 4px rgba(0, 0, 0, 0.2))' }
              }}
              animationDuration={800}
              animationEasing="ease-in-out"
            />

            {/* IRR Projection Line */}
            {showProjection && (
              <Line
                type="monotone"
                dataKey="projectedValue"
                stroke={isDark ? '#fbbf24' : '#f59e0b'}
                strokeWidth={2.5}
                strokeDasharray="8 4"
                dot={false}
                activeDot={{
                  r: 5,
                  stroke: isDark ? '#fbbf24' : '#f59e0b',
                  strokeWidth: 2,
                  fill: isDark ? '#1f2937' : 'white'
                }}
                animationDuration={800}
                animationEasing="ease-in-out"
              />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
    );
  };

  const renderAllocationChart = () => {
    if (!chartData.length) return null;

    const maxValue = Math.max(...chartData.map(d => d.value));

    return (
      <div className="space-y-4 overflow-y-auto h-full pr-2 py-2">
        {(chartData as Array<{ market: string; value: number; percentage: number; count: number; color: string }>).map((item, _index) => (
          <div
            key={item.market}
            className="space-y-2.5 p-4 rounded-xl bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/50 hover:border-gray-300 dark:hover:border-gray-600 transition-all duration-200 hover:shadow-md"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div
                  className="w-5 h-5 rounded-lg shadow-sm ring-2 ring-white dark:ring-gray-900"
                  style={{ backgroundColor: item.color }}
                />
                <div className="flex flex-col sm:flex-row sm:items-center sm:gap-2">
                  <span className="text-sm font-bold text-gray-900 dark:text-white">
                    {item.market}
                  </span>
                  <span className="text-xs font-medium text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-700/50 px-2 py-0.5 rounded-md">
                    {item.count} {item.count === 1 ? 'holding' : 'holdings'}
                  </span>
                </div>
              </div>
              <div className="text-right">
                <div className="text-sm font-bold text-gray-900 dark:text-white">
                  {formatCurrency(item.value, baseCurrency)}
                </div>
                <div className="text-xs font-semibold text-primary-700 dark:text-primary-400">
                  {item.percentage.toFixed(1)}%
                </div>
              </div>
            </div>

            {/* Enhanced progress bar */}
            <div className="relative w-full bg-gray-200 dark:bg-gray-700 rounded-full h-3.5 overflow-hidden shadow-inner">
              <div
                className="h-3.5 rounded-full transition-all duration-700 ease-out relative overflow-hidden"
                style={{
                  backgroundColor: item.color,
                  width: `${(item.value / maxValue) * 100}%`
                }}
              >
                {/* Shimmer effect */}
                <div
                  className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent animate-shimmer"
                  style={{
                    backgroundSize: '200px 100%',
                    animation: 'shimmer 2s ease-in-out infinite'
                  }}
                />
              </div>

              {/* Percentage overlay on bar if wide enough */}
              {item.percentage > 10 && (
                <div
                  className="absolute inset-y-0 left-0 flex items-center px-2"
                  style={{ width: `${(item.value / maxValue) * 100}%` }}
                >
                  <span className="text-xs font-bold text-white drop-shadow-md">
                    {item.percentage.toFixed(0)}%
                  </span>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    );
  };

  const formatPercentage = (value: number) => {
    return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
  };

  return (
    <div className="h-full flex flex-col">
      {/* Unified Control Bar */}
      <div className="flex flex-col gap-3 mb-5">
        {/* Row 1: Chart Type Selector (full width on mobile) */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex bg-gray-100 dark:bg-gray-800/50 rounded-xl p-1.5 shadow-sm border border-gray-200 dark:border-gray-700/50">
            {chartTypeOptions.map((option) => (
              <button
                key={option.value}
                onClick={() => setChartType(option.value)}
                className={cn(
                  'px-3 sm:px-4 py-2 text-xs sm:text-sm font-semibold rounded-lg transition-all duration-200 whitespace-nowrap',
                  chartType === option.value
                    ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-md scale-105'
                    : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-50 dark:hover:bg-gray-700/50'
                )}
              >
                {option.label}
              </button>
            ))}
          </div>

          {/* Current Period Performance - Inline with controls */}
          {chartType === 'timeline' && !isLoadingHistory && (
            <div className="hidden md:flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-gray-50 to-gray-100 dark:from-gray-800/50 dark:to-gray-700/50 rounded-xl border border-gray-200 dark:border-gray-700/50">
              <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
                {timeframe}:
              </span>
              <span className={cn(
                'text-sm font-bold',
                currentPeriodChange >= 0 ? 'text-prosperity-700 dark:text-prosperity-400' : 'text-error-700 dark:text-error-400'
              )}>
                {formatPercentage(currentPeriodChange)}
              </span>
            </div>
          )}
        </div>

        {/* Row 2: Timeframe Selector and IRR Controls (only for timeline) */}
        {chartType === 'timeline' && (
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3">
            {/* IRR Projection Controls - Stack on mobile */}
            <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 bg-gray-100 dark:bg-gray-800/50 rounded-xl p-2 shadow-sm border border-gray-200 dark:border-gray-700/50">
              <button
                onClick={() => setShowProjection(!showProjection)}
                className={cn(
                  'px-3 py-1.5 text-xs font-semibold rounded-lg transition-all duration-200 whitespace-nowrap min-h-[44px] sm:min-h-0',
                  showProjection
                    ? 'bg-amber-500 dark:bg-amber-600 text-white shadow-md'
                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700/50'
                )}
                title={showProjection ? 'Hide IRR Projection' : 'Show IRR Projection'}
              >
                {showProjection ? '📊 Target' : '📊'}
              </button>
              {showProjection && (
                <>
                  <div className="flex items-center gap-1.5 pl-2 border-l border-gray-300 dark:border-gray-600">
                    <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Monthly:</span>
                    <input
                      aria-label="Monthly investment"
                      type="number"
                      inputMode="decimal"
                      onWheel={(e) => e.currentTarget.blur()}
                      min="0"
                      step="1000"
                      value={monthlyInvestment}
                      onChange={(e) => {
                        const value = parseFloat(e.target.value);
                        if (!isNaN(value) && value >= 0) {
                          setMonthlyInvestment(value);
                        }
                      }}
                      onBlur={(e) => {
                        const value = parseFloat(e.target.value);
                        if (isNaN(value) || value < 0) {
                          setMonthlyInvestment(20000);
                        }
                      }}
                      className="w-20 px-2 py-2 sm:py-1 text-xs font-semibold text-center bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 min-h-[44px] sm:min-h-0"
                    />
                  </div>
                  <div className="flex items-center gap-1.5 pl-2 border-l border-gray-300 dark:border-gray-600">
                    <span className="text-xs font-medium text-gray-500 dark:text-gray-400">IRR:</span>
                    <input
                      aria-label="Target IRR"
                      type="number"
                      inputMode="decimal"
                      onWheel={(e) => e.currentTarget.blur()}
                      min="0"
                      max="100"
                      step="0.5"
                      value={targetIRR}
                      onChange={(e) => {
                        const value = parseFloat(e.target.value);
                        if (!isNaN(value) && value >= 0 && value <= 100) {
                          setTargetIRR(value);
                        }
                      }}
                      onBlur={(e) => {
                        const value = parseFloat(e.target.value);
                        if (isNaN(value) || value < 0) {
                          setTargetIRR(6);
                        }
                      }}
                      className="w-14 px-2 py-2 sm:py-1 text-xs font-semibold text-center bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 min-h-[44px] sm:min-h-0"
                    />
                    <span className="text-xs font-medium text-gray-600 dark:text-gray-400">%</span>
                  </div>
                </>
              )}
            </div>

            {/* Timeframe Selector - Hidden when external timeframe is provided */}
            {!externalTimeframe && (
              <div className="flex bg-gray-100 dark:bg-gray-800/50 rounded-xl p-1.5 shadow-sm border border-gray-200 dark:border-gray-700/50 overflow-x-auto">
                {timeframeOptions.map((option) => (
                  <button
                    key={option.value}
                    onClick={() => setTimeframe(option.value)}
                    className={cn(
                      'px-2 sm:px-3.5 py-2 text-xs sm:text-sm font-semibold rounded-lg transition-all duration-200 whitespace-nowrap flex-shrink-0',
                      timeframe === option.value
                        ? 'bg-primary-700 dark:bg-primary-500 text-white shadow-lg shadow-primary-500/30 scale-105'
                        : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-50 dark:hover:bg-gray-700/50'
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Mobile: Period Performance (if not shown inline) */}
      {chartType === 'timeline' && !isLoadingHistory && (
        <div className="md:hidden mb-4 px-4 py-3 bg-gradient-to-r from-gray-50 to-gray-100 dark:from-gray-800/50 dark:to-gray-700/50 rounded-xl border border-gray-200 dark:border-gray-700/50">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
              {timeframe} Performance
            </span>
            <span className={cn(
              'text-lg font-bold',
              currentPeriodChange >= 0 ? 'text-prosperity-700 dark:text-prosperity-400' : 'text-error-700 dark:text-error-400'
            )}>
              {formatPercentage(currentPeriodChange)}
            </span>
          </div>
        </div>
      )}

      {/* Chart Container with enhanced spacing */}
      <div className="flex-1 min-h-0 mt-2">
        {isLoadingHistory && chartType === 'timeline' ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <div className="animate-spin rounded-full h-10 w-10 border-2 border-gray-200 dark:border-gray-700 border-t-primary-600 dark:border-t-primary-500 mx-auto mb-3"></div>
              <p className="text-sm text-gray-500 dark:text-gray-400 font-medium">Loading chart data...</p>
            </div>
          </div>
        ) : (
          <>
            {chartType === 'timeline' && renderTimelineChart()}
            {chartType === 'allocation' && renderAllocationChart()}
          </>
        )}
      </div>
    </div>
  );
});