'use client';

import { memo, type MouseEvent } from 'react';
import Link from 'next/link';
import {
  ArrowTrendingUpIcon,
  ArrowTrendingDownIcon,
  ClockIcon,
  CurrencyDollarIcon,
} from '@heroicons/react/24/outline';
import { useTranslation } from 'react-i18next';
import { cn } from '@/utils/cn';
import { formatCurrency } from '@/utils/formatters';
import { Sparkline } from './Sparkline';
import type { Holding } from './HoldingsList';
import {
  formatTimeAgo,
  getCurrencyColor,
  getMarketBadge,
  getTypeColor,
  isCashHolding,
  isPriceStale,
} from './holdingRowStyles';

interface HoldingRowProps {
  holding: Holding;
  isSelected: boolean;
  isValueVisible: boolean;
  bulkEditMode: boolean;
  /** How many lots back this position, for the "N lots" hint. */
  lotCount: number;
  /**
   * Base-currency value of one unit of this holding's currency, when the
   * holding is not already in the base and a rate could be fetched. A primitive
   * so the memo still holds. Undefined means "not priced" — the row shows the
   * native figure alone rather than a guess.
   */
  baseRate?: number;
  /** Currency the rate converts into, for labelling the second line. */
  baseCurrency?: string;
  /** Takes the whole holding: identity is symbol + wallet, and the row
   *  should not have to know how that key is spelled. */
  onToggleSelect: (holding: Holding) => void;
  onOpen: (holding: Holding) => void;
  onSellHolding?: (holding: Holding) => void;
}

/**
 * One holding, as a table row.
 *
 * This was `renderHoldingRow`, a function returning JSX — which reads like a
 * component but is not one: calling it inlines the elements into the parent's
 * render, so React has no boundary to skip and every row re-rendered whenever
 * anything in the list changed. Ticking one checkbox in bulk-edit mode
 * re-rendered every row, each with its own sparkline.
 *
 * As with `TransactionRow`, the props are primitives and stable callbacks: the
 * row takes `isSelected` and `lotCount` already resolved, because reaching into
 * `selectedHoldings` or `lotCountMap` from here would re-render everything on
 * any change to either.
 */
function HoldingRowBase({
  holding,
  isSelected,
  isValueVisible,
  bulkEditMode,
  lotCount,
  baseRate,
  baseCurrency = 'TWD',
  onToggleSelect,
  onOpen,
  onSellHolding,
}: HoldingRowProps) {
  const { t } = useTranslation(['portfolio', 'common']);
  const isCash = isCashHolding(holding);
  
  const isGain = (holding.gainLoss || 0) >= 0;
  const marketBadge = getMarketBadge(holding.market, holding.type, holding.currency);
  

  return (
    <tr
      key={holding.id}
      className={cn(
        "group transition-all duration-150 cursor-pointer border-l-4 border-b border-gray-100 dark:border-gray-700",
        "hover:border-b-gray-200 dark:hover:border-b-gray-600",
        isSelected && bulkEditMode
          ? "bg-primary-50 dark:bg-primary-900/20 border-l-primary-500"
          // Pure-CSS hover (no React state) — sign-tinted border + background.
          : cn(
              "border-l-transparent",
              isGain
                ? "hover:border-l-success-500 dark:hover:border-l-success-400 hover:bg-success-50/30 dark:hover:bg-success-900/10"
                : "hover:border-l-error-500 dark:hover:border-l-error-400 hover:bg-error-50/30 dark:hover:bg-error-900/10"
            )
      )}
      onClick={() => {
        if (!bulkEditMode) {
          onOpen(holding);
        }
      }}
    >
      {bulkEditMode && (
        <td className="px-4 py-4 text-center" onClick={(e: MouseEvent) => e.stopPropagation()}>
          <input
            aria-label={`${t('portfolio:selectHolding', 'Select holding')} ${holding.symbol}`}
            type="checkbox"
            checked={isSelected}
            onChange={() => onToggleSelect(holding)}
            className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-primary-700 dark:text-primary-600 focus-visible:ring-primary-500 cursor-pointer"
          />
        </td>
      )}
      <td className="px-3 md:px-6 py-4 whitespace-nowrap">
        <div>
          <div className="flex items-center gap-2">
            <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
              {holding.symbol}
            </div>
            {/* Combined Market + Currency Badge */}
            {marketBadge ? (
              <span className={cn(
                'inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium',
                marketBadge.color
              )} title={`${marketBadge.label} Market - ${holding.currency}`}>
                <span>{marketBadge.icon}</span>
                <span>{holding.currency}</span>
              </span>
            ) : (
              <span className={cn(
                'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium',
                getCurrencyColor(holding.currency)
              )}>
                {holding.currency}
              </span>
            )}
            {/* Lot indicator - only show if multiple lots */}
            {lotCount > 1 && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300" title="Multiple purchase lots">
                {lotCount}×
              </span>
            )}
            {/* Sell Button - only show for non-cash holdings */}
            {!isCash && onSellHolding && (
              <button
                onClick={(e: MouseEvent) => {
                  e.stopPropagation();
                  onSellHolding(holding);
                }}
                className="ml-1 p-1 hover:bg-green-100 dark:hover:bg-green-900/30 rounded transition-colors"
                title="Sell this holding"
              >
                <CurrencyDollarIcon className="w-4 h-4 text-green-700 dark:text-green-400" />
              </button>
            )}
            {/* Trend link - navigate to asset detail page */}
            {!isCash && (
              <Link
                href={`/portfolio/holdings/${holding.symbol}`}
                onClick={(e: MouseEvent) => e.stopPropagation()}
                className="ml-1 p-1 hover:bg-blue-100 dark:hover:bg-blue-900/30 rounded transition-colors"
                title={`View ${holding.symbol} trend`}
              >
                <ArrowTrendingUpIcon className="w-4 h-4 text-blue-500 dark:text-blue-400" />
              </Link>
            )}
          </div>
          <div className="text-sm text-gray-500 dark:text-gray-400 truncate max-w-64">
            {holding.name}
          </div>
        </div>
      </td>
      <td className="px-3 md:px-6 py-4 whitespace-nowrap">
        <span className={cn(
          'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
          getTypeColor(holding.type)
        )}>
          {holding.type.toLowerCase() === 'etf' ? 'ETF' : holding.type.charAt(0).toUpperCase() + holding.type.slice(1).toLowerCase()}
        </span>
      </td>
      <td className="px-3 md:px-6 py-4 whitespace-nowrap text-right text-sm text-gray-900 dark:text-gray-100">
        {isCash ? '—' : holding.quantity.toLocaleString()}
      </td>
      <td className="px-3 md:px-6 py-4 whitespace-nowrap text-right">
        {isValueVisible ? (
          <div className="flex flex-col items-end">
            <div className="flex items-center gap-1.5">
              {!isCash && isPriceStale(holding.lastUpdated) && (
                <span
                  className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-warning-50 dark:bg-warning-900/30 cursor-help"
                  title={`Price updated ${formatTimeAgo(holding.lastUpdated, t)} - Click Refresh to update`}
                >
                  <ClockIcon className="w-3 h-3 text-warning-700 dark:text-warning-400" />
                </span>
              )}
              <span className={cn(
                "text-sm font-medium",
                !isCash && isPriceStale(holding.lastUpdated)
                  ? "text-warning-700 dark:text-warning-300"
                  : "text-gray-900 dark:text-gray-100"
              )}>
                {isCash ? '—' : formatCurrency(holding.currentPrice, holding.currency)}
              </span>
            </div>
            {!isCash && (
              <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                {t('portfolio:holdings.avgCost', { value: formatCurrency(holding.averageCost, holding.currency) })}
              </div>
            )}
            {!isCash && holding.dayChange != null && (
              <div className={cn(
                'text-xs mt-0.5 leading-tight',
                holding.dayChange >= 0 ? 'text-success-700 dark:text-success-400' : 'text-error-700 dark:text-error-400'
              )}>
                {holding.dayChange >= 0 ? '+' : ''}{formatCurrency(holding.dayChange, holding.currency)}
                {holding.dayChangePercentage != null && (
                  <span className="ml-1">({holding.dayChangePercentage >= 0 ? '+' : ''}{holding.dayChangePercentage.toFixed(2)}%)</span>
                )}
                <span className="ml-1 text-gray-500 dark:text-gray-500">{t('portfolio:holdings.today')}</span>
              </div>
            )}
          </div>
        ) : (
          <div className="text-sm text-gray-900 dark:text-gray-100">•••••</div>
        )}
      </td>
      <td className="px-3 md:px-6 py-4 whitespace-nowrap">
        <div className="flex items-center justify-center">
          {isCash ? (
            <span className="text-xs text-gray-500 dark:text-gray-400">—</span>
          ) : (
            <Link
              href={`/portfolio/holdings/${holding.symbol}`}
              onClick={(e: MouseEvent) => e.stopPropagation()}
              className="block rounded hover:opacity-75 transition-opacity"
              title={`View ${holding.symbol} trend`}
            >
              <Sparkline
                data={holding.sparklineData || []}
                width={80}
                height={32}
                showArea={true}
              />
            </Link>
          )}
        </div>
      </td>
      <td className="px-3 md:px-6 py-4 whitespace-nowrap text-right text-sm font-medium text-gray-900 dark:text-gray-100">
        {isValueVisible ? (
          <>
            <div>{formatCurrency(holding.totalValue, holding.currency)}</div>
            {baseRate !== undefined && (
              // The native currency stays primary — it is what the position
              // trades in. The converted figure is secondary and marked
              // approximate, because it moves with the rate and the rate is a
              // snapshot.
              <div className="text-xs font-normal text-gray-500 dark:text-gray-500 tabular-nums">
                ≈ {formatCurrency(holding.totalValue * baseRate, baseCurrency)}
              </div>
            )}
          </>
        ) : (
          '•••••••'
        )}
      </td>
      <td className="px-3 md:px-6 py-4 whitespace-nowrap text-right">
        {isCash ? (
          <div className="text-sm text-gray-500 dark:text-gray-400">—</div>
        ) : (
          <div className="flex flex-col items-end space-y-0.5">
            {/* Gain/Loss Amount and ROI */}
            <div className="flex items-center justify-end space-x-2">
              {(holding.gainLoss || 0) >= 0 ? (
                <ArrowTrendingUpIcon className="w-4 h-4 text-success-700 dark:text-success-500" />
              ) : (
                <ArrowTrendingDownIcon className="w-4 h-4 text-error-500" />
              )}
              <div className="flex flex-col items-end">
                {/* Total Gain/Loss Amount */}
                <div className={cn(
                  'text-sm font-semibold leading-tight',
                  (holding.gainLoss || 0) >= 0 ? 'text-success-700 dark:text-success-400' : 'text-error-700 dark:text-error-400'
                )}>
                  {isValueVisible
                    ? `${(holding.gainLoss || 0) >= 0 ? '+' : ''}${formatCurrency(holding.gainLoss || 0, holding.currency)}`
                    : '•••'
                  }
                </div>
                {/* ROI (Return on Investment) - Simple percentage gain */}
                <div className={cn(
                  'text-xs leading-tight',
                  (holding.gainLossPercentage || 0) >= 0 ? 'text-success-700 dark:text-success-400' : 'text-error-500 dark:text-error-400'
                )}>
                  {isValueVisible
                    ? `${(holding.gainLossPercentage || 0) >= 0 ? '+' : ''}${(holding.gainLossPercentage || 0).toFixed(2)}% ROI`
                    : '•••%'
                  }
                </div>
              </div>
            </div>

          </div>
        )}
      </td>
    </tr>
  );
}

export const HoldingRow = memo(HoldingRowBase);
HoldingRow.displayName = 'HoldingRow';
