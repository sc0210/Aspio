'use client';

import { useState, type JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Sector } from 'recharts';
import type { PieSectorDataItem } from 'recharts/types/polar/Pie';
import { useTheme } from '@/contexts/ThemeContext';
import { formatCurrency as formatCurrencyUtil } from '@/utils/formatters';
import { Card } from '@/components/ui/Card';
import { chartTooltipStyle } from '@/lib/charts/tooltipStyle';

interface AllocationItem {
  value: number;
  percentage: number;
  color: string;
  // Each view uses a different name field
  type?: string;
  sector?: string;
  region?: string;
}

interface ActiveShapeProps extends PieSectorDataItem {
  payload: AllocationItem;
  percent: number;
}

interface AllocationData {
  byType: AllocationItem[];
  bySector: AllocationItem[];
  byRegion: AllocationItem[];
  baseCurrency?: string;
  exchangeRate?: number;
}

interface PortfolioAllocationProps {
  allocation: AllocationData;
  isValueVisible: boolean;
}

export function PortfolioAllocation({ allocation, isValueVisible }: PortfolioAllocationProps) {
  const { t } = useTranslation(['portfolio']);
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  const [activeView, setActiveView] = useState<'type' | 'sector' | 'region'>('type');
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  // Get base currency from allocation data
  const baseCurrency = allocation.baseCurrency || 'TWD';

  // Format currency based on base currency
  const formatCurrency = (amount: number) =>
    formatCurrencyUtil(amount, baseCurrency, { precision: 0 });

  const getCurrentData = () => {
    switch (activeView) {
      case 'sector': return allocation.bySector || [];
      case 'region': return allocation.byRegion || [];
      default: return allocation.byType || [];
    }
  };

  const currentData = getCurrentData();

  // Custom active shape renderer for interactive pie chart
  const renderActiveShape = (props: ActiveShapeProps) => {
    const RADIAN = Math.PI / 180;
    const { cx, cy, midAngle, innerRadius, outerRadius, startAngle, endAngle, fill, payload, percent } = props;
    const sin = Math.sin(-RADIAN * midAngle!);
    const cos = Math.cos(-RADIAN * midAngle!);
    const sx = cx! + (outerRadius! + 10) * cos;
    const sy = cy! + (outerRadius! + 10) * sin;
    const mx = cx! + (outerRadius! + 30) * cos;
    const my = cy! + (outerRadius! + 30) * sin;
    const ex = mx + (cos >= 0 ? 1 : -1) * 22;
    const ey = my;
    const textAnchor = cos >= 0 ? 'start' : 'end';

    return (
      <g>
        <text x={cx} y={cy} dy={8} textAnchor="middle" fill={fill} className="font-bold text-lg">
          {isValueVisible ? `${(percent * 100).toFixed(1)}%` : '•••%'}
        </text>
        <Sector
          cx={cx}
          cy={cy}
          innerRadius={innerRadius}
          outerRadius={outerRadius! + 10}
          startAngle={startAngle}
          endAngle={endAngle}
          fill={fill}
        />
        <Sector
          cx={cx}
          cy={cy}
          startAngle={startAngle}
          endAngle={endAngle}
          innerRadius={outerRadius! + 12}
          outerRadius={outerRadius! + 16}
          fill={fill}
        />
        <path d={`M${sx},${sy}L${mx},${my}L${ex},${ey}`} stroke={fill} fill="none" />
        <circle cx={ex} cy={ey} r={2} fill={fill} stroke="none" />
        <text
          x={ex + (cos >= 0 ? 1 : -1) * 12}
          y={ey}
          textAnchor={textAnchor}
          fill="currentColor"
          className="text-sm font-medium"
        >
          {payload.type || payload.sector || payload.region}
        </text>
        <text
          x={ex + (cos >= 0 ? 1 : -1) * 12}
          y={ey}
          dy={18}
          textAnchor={textAnchor}
          fill="currentColor"
          className="text-xs opacity-70"
        >
          {isValueVisible ? formatCurrency(payload.value) : '•••••••'}
        </text>
      </g>
    );
  };

  const onPieEnter = (_: AllocationItem, index: number) => {
    setActiveIndex(index);
  };

  const onPieLeave = () => {
    setActiveIndex(null);
  };

  // Check if there's no data
  const hasNoData = !currentData || currentData.length === 0;

  if (hasNoData) {
    return (
      <Card padding="none" radius="xl" className="p-12 text-center">
        <div className="w-16 h-16 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center mx-auto mb-4">
          <span className="text-2xl">📊</span>
        </div>
        <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
          No Allocation Data
        </h3>
        <p className="text-gray-500 dark:text-gray-400 mb-4">
          Add holdings to your portfolio to see asset allocation breakdown
        </p>
      </Card>
    );
  }

  // Get exchange rate from allocation data
  const exchangeRate = allocation.exchangeRate;

  return (
    <div className="space-y-4">
      {/* Currency Conversion Notice */}
      {exchangeRate && (
        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div className="flex-1">
              <p className="text-sm font-semibold text-blue-900 dark:text-blue-100">
                Currency Conversion Applied
              </p>
              <p className="text-xs text-blue-700 dark:text-blue-300 mt-0.5">
                All values converted to {baseCurrency} using exchange rate: 1 USD = {exchangeRate.toFixed(2)} {baseCurrency}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* View Selector */}
      <Card padding="sm" radius="xl">
        <div className="flex space-x-1 bg-gray-100 dark:bg-gray-800 rounded-lg p-1">
          <button
            onClick={() => setActiveView('type')}
            aria-pressed={activeView === 'type'}
            className={`flex-1 px-3 py-2 text-sm font-medium rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 ${activeView === 'type'
                ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
              }`}
          >
            {t('portfolio:allocationBy.type')}
          </button>
          <button
            onClick={() => setActiveView('sector')}
            aria-pressed={activeView === 'sector'}
            className={`flex-1 px-3 py-2 text-sm font-medium rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 ${activeView === 'sector'
                ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
              }`}
          >
            {t('portfolio:allocationBy.sector')}
          </button>
          <button
            onClick={() => setActiveView('region')}
            aria-pressed={activeView === 'region'}
            className={`flex-1 px-3 py-2 text-sm font-medium rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 ${activeView === 'region'
                ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
              }`}
          >
            {t('portfolio:allocationBy.region')}
          </button>
        </div>
      </Card>

      {/* Chart and Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Pie Chart */}
        <Card padding="md" radius="xl" clip>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
            Allocation {activeView === 'type' ? 'by Asset Type' :
              activeView === 'sector' ? 'by Sector' : 'by Region'}
          </h3>
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
            Hover over segments to see details
          </p>
          <div className="h-64 sm:h-80 md:h-96 w-full" role="img" aria-label={t('portfolio:allocation')}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  activeIndex={activeIndex !== null ? activeIndex : undefined}
                  activeShape={renderActiveShape as (props: PieSectorDataItem) => JSX.Element}
                  data={currentData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={100}
                  fill="#8884d8"
                  dataKey="value"
                  nameKey={activeView === 'type' ? 'type' : activeView === 'sector' ? 'sector' : 'region'}
                  onMouseEnter={onPieEnter}
                  onMouseLeave={onPieLeave}
                  animationBegin={0}
                  animationDuration={800}
                >
                  {currentData.map((entry, index) => (
                    <Cell
                      key={`cell-${index}`}
                      fill={entry.color}
                      className="cursor-pointer transition-all duration-300"
                    />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value: number | string, name) => {
                    const numericValue = typeof value === 'number' ? value : parseFloat(value);
                    const item = currentData.find(d =>
                      d.type === name || d.sector === name || d.region === name
                    );
                    return [
                      isValueVisible ? `${formatCurrency(numericValue)} (${item?.percentage.toFixed(1)}%)` : '•••••••',
                      'Value'
                    ];
                  }}
                  {...chartTooltipStyle(isDark)}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* Breakdown Table */}
        <Card padding="md" radius="xl">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Breakdown</h3>
          <div className="space-y-2">
            {currentData.map((item, index) => {
              const name = item.type || item.sector || item.region;
              const isActive = activeIndex === index;
              return (
                <div
                  key={index}
                  onMouseEnter={() => setActiveIndex(index)}
                  onMouseLeave={() => setActiveIndex(null)}
                  className={`flex items-center justify-between p-4 rounded-lg transition-all duration-300 cursor-pointer ${isActive
                      ? 'bg-primary-50 dark:bg-primary-900/20 shadow-md border border-primary-200 dark:border-primary-800'
                      : 'bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 border-2 border-transparent'
                    }`}
                >
                  <div className="flex items-center space-x-3">
                    <div
                      className={`w-5 h-5 rounded-full transition-all duration-300 ${isActive ? 'ring-2 ring-offset-2 ring-primary-400 dark:ring-primary-600' : ''
                        }`}
                      style={{ backgroundColor: item.color }}
                    />
                    <span className={`font-medium transition-all duration-300 ${isActive
                        ? 'text-primary-900 dark:text-primary-100 text-base'
                        : 'text-gray-900 dark:text-gray-100 text-sm'
                      }`}>
                      {name}
                    </span>
                  </div>
                  <div className="text-right">
                    <div className={`font-semibold transition-all duration-300 ${isActive
                        ? 'text-primary-900 dark:text-primary-100 text-base'
                        : 'text-gray-900 dark:text-gray-100 text-sm'
                      }`}>
                      {isValueVisible
                        ? formatCurrency(item.value)
                        : '•••••••'
                      }
                    </div>
                    <div className={`text-xs font-medium transition-all duration-300 ${isActive
                        ? 'text-primary-700 dark:text-primary-300'
                        : 'text-gray-600 dark:text-gray-400'
                      }`}>
                      {isValueVisible
                        ? `${item.percentage.toFixed(1)}% of portfolio`
                        : '•••% of portfolio'
                      }
                    </div>
                    {isActive && (
                      <div className="mt-1 text-xs text-primary-600 dark:text-primary-400 animate-fade-in">
                        <span className="inline-flex items-center">
                          <svg className="w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                          </svg>
                          Selected
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      </div>
    </div>
  );
}