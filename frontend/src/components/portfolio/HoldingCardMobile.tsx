'use client';

import React, { memo, type MouseEvent } from 'react';
import Link from 'next/link';
import { ArrowTrendingUpIcon, ArrowTrendingDownIcon, ClockIcon } from '@heroicons/react/24/outline';
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
  getWalletTypeBadge,
  isCashHolding,
  isPriceStale,
} from './holdingRowStyles';

interface HoldingCardMobileProps {
  holding: Holding;
  isSelected: boolean;
  isValueVisible: boolean;
  bulkEditMode: boolean;
  lotCount: number;
  /** See HoldingRow: base-currency value of one unit of this holding's
   *  currency, or undefined when the pair could not be priced. */
  baseRate?: number;
  baseCurrency?: string;
  onSelect: (symbol: string, walletType?: string) => void;
  /** Takes the whole holding — see HoldingRow. */
  onToggleSelect: (holding: Holding, e: React.SyntheticEvent) => void;
}

/**
 * One holding, as a card, for phones.
 *
 * The third instance of the same defect: `HoldingsListMobile` mapped these
 * inline, so there was no boundary for React to skip and every card
 * re-rendered — sparkline included — whenever anything in the list moved.
 * `HoldingRow` got this treatment first; this is its phone counterpart, and
 * the props follow the same rule: primitives and stable callbacks, with
 * `isSelected` and `lotCount` resolved by the parent.
 */
function HoldingCardMobileBase({
  holding,
  isSelected,
  isValueVisible,
  bulkEditMode,
  lotCount,
  baseRate,
  baseCurrency = 'TWD',
  onSelect,
  onToggleSelect,
}: HoldingCardMobileProps) {
  const { t } = useTranslation(['common', 'portfolio']);
  const isCash = isCashHolding(holding);
  const marketBadge = getMarketBadge(holding.market, holding.type, holding.currency);
  const walletBadge = getWalletTypeBadge(holding.walletType, t);

  return (

    <button
      key={holding.id}
      onClick={() => !bulkEditMode && onSelect(holding.symbol, holding.walletType)}
      className={cn(
        "w-full bg-white dark:bg-gray-800 rounded-xl p-4 border transition-all duration-200 text-left shadow-sm hover:shadow-md active:scale-[0.98]",
        isSelected && bulkEditMode
          ? "border-primary-500 bg-primary-50 dark:bg-primary-900/20"
          : "border-gray-200 dark:border-gray-700 hover:border-primary-400 dark:hover:border-primary-500"
      )}
    >
      {/* Header Row */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 min-w-0 flex items-start gap-2">
          {bulkEditMode && (
            <input
              aria-label={`${t('portfolio:selectHolding', 'Select holding')} ${holding.symbol}`}
              type="checkbox"
              checked={isSelected}
              onChange={(e) => onToggleSelect(holding, e)}
              onClick={(e: MouseEvent) => e.stopPropagation()}
              className="mt-1 w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-primary-600 focus-visible:ring-primary-500 cursor-pointer flex-shrink-0"
            />
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 mb-1 flex-wrap">
              <span className="font-bold text-gray-900 dark:text-white text-base">
                {holding.symbol}
              </span>
              {/* Combined Market + Currency Badge */}
              {marketBadge ? (
                <span className={cn(
                  'inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs font-medium',
                  marketBadge.color
                )} title={`${marketBadge.label} Market`}>
                  <span className="text-sm">{marketBadge.icon}</span>
                  <span>{holding.currency}</span>
                </span>
              ) : (
                <span className={cn(
                  'inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium',
                  getCurrencyColor(holding.currency)
                )}>
                  {holding.currency}
                </span>
              )}
              {/* Type Badge */}
              <span className={cn(
                'inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium',
                getTypeColor(holding.type)
              )}>
                {holding.type.toLowerCase() === 'etf' ? 'ETF' : holding.type.charAt(0).toUpperCase() + holding.type.slice(1).toLowerCase()}
              </span>
              {/* Wallet Icon */}
              {walletBadge && (
                <span className="text-sm" title={`${walletBadge.label}錢包`}>
                  {walletBadge.icon}
                </span>
              )}
              {/* Lot Count - only if multiple */}
              {lotCount > 1 && (
                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300" title="Multiple lots">
                  {lotCount}×
                </span>
              )}
              {/* View trend link */}
              {!isCash && (
                <Link
                  href={`/portfolio/holdings/${holding.symbol}`}
                  onClick={(e: MouseEvent) => e.stopPropagation()}
                  className="p-1 rounded hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-colors"
                  title={`View ${holding.symbol} trend`}
                >
                  <ArrowTrendingUpIcon className="w-3.5 h-3.5 text-blue-500 dark:text-blue-400" />
                </Link>
              )}
            </div>
            <p className="text-xs text-gray-600 dark:text-gray-400 truncate">
              {holding.name}
            </p>
          </div>
        </div>

        {/* Gain/Loss Indicator */}
        <div className="flex items-center gap-1 ml-3 flex-shrink-0">
          {!isCash && (holding.gainLoss >= 0 ? (
            <ArrowTrendingUpIcon className="w-5 h-5 text-success-500" />
          ) : (
            <ArrowTrendingDownIcon className="w-5 h-5 text-error-500" />
          ))}
        </div>
      </div>

      {/* Sparkline - Full Width */}
      {!isCash && (
        <div className="hidden xs:block mb-3 -mx-2">
          <Sparkline
            data={holding.sparklineData || []}
            width={120}
            height={40}
            showArea={true}
          />
        </div>
      )}

      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-3 mb-3">
        {/* Quantity */}
        {!isCash && (
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">{t('portfolio:holdings.quantity')}</p>
            <p className="text-sm font-semibold text-gray-900 dark:text-white">
              {holding.quantity.toLocaleString()}
            </p>
          </div>
        )}

        {/* Current Price */}
        <div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-1 flex items-center gap-1">
            {t('portfolio:holdings.price')}
            {!isCash && isPriceStale(holding.lastUpdated) && (
              <span
                className="inline-flex items-center"
                title={`Updated ${formatTimeAgo(holding.lastUpdated, t)}`}
              >
                <ClockIcon className="w-3 h-3 text-warning-500" />
              </span>
            )}
          </p>
          <p className={cn(
            "text-sm font-semibold",
            !isCash && isPriceStale(holding.lastUpdated)
              ? "text-warning-700 dark:text-warning-300"
              : "text-gray-900 dark:text-white"
          )}>
            {isValueVisible ? (
              isCash ? '—' : formatCurrency(holding.currentPrice, holding.currency)
            ) : '•••••'}
          </p>
          {!isCash && isValueVisible && (
            <p className="hidden xs:block text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              {t('portfolio:holdings.avgCost', { value: formatCurrency(holding.averageCost, holding.currency) })}
            </p>
          )}
          {!isCash && isValueVisible && holding.dayChange != null && (
            <p className={cn(
              'text-xs mt-0.5 leading-tight',
              holding.dayChange >= 0 ? 'text-success-600 dark:text-success-400' : 'text-error-600 dark:text-error-400'
            )}>
              {holding.dayChange >= 0 ? '+' : ''}{formatCurrency(holding.dayChange, holding.currency)}
              {holding.dayChangePercentage != null && (
                <span className="ml-1">({holding.dayChangePercentage >= 0 ? '+' : ''}{holding.dayChangePercentage.toFixed(2)}%)</span>
              )}
              <span className="ml-1 text-gray-400">{t('portfolio:holdings.today')}</span>
            </p>
          )}
        </div>

        {/* Total Value */}
        <div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">{t('portfolio:holdings.value')}</p>
          <p className="text-base font-bold text-gray-900 dark:text-white">
            {isValueVisible ? formatCurrency(holding.totalValue, holding.currency) : '•••••'}
          </p>
          {isValueVisible && baseRate !== undefined && (
            // Same rule as the desktop row: absent when the pair could not be
            // priced, never a guess.
            <p className="text-xs text-gray-400 dark:text-gray-500 tabular-nums">
              ≈ {formatCurrency(holding.totalValue * baseRate, baseCurrency)}
            </p>
          )}
        </div>

        {/* Gain/Loss */}
        {!isCash && (
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">{t('portfolio:holdings.return')}</p>
            <div className="flex flex-col">
              <p className={cn(
                "text-base font-bold leading-tight",
                holding.gainLoss >= 0 ? "text-success-600 dark:text-success-400" : "text-error-600 dark:text-error-400"
              )}>
                {isValueVisible ? (
                  <>
                    {holding.gainLoss >= 0 ? '+' : ''}
                    {formatCurrency(holding.gainLoss, holding.currency)}
                  </>
                ) : '•••'}
              </p>
              <p className={cn(
                "text-xs font-semibold leading-tight mt-0.5",
                holding.gainLossPercentage >= 0 ? "text-success-500" : "text-error-500"
              )}>
                {isValueVisible ? (
                  <>
                    {holding.gainLossPercentage >= 0 ? '+' : ''}
                    {holding.gainLossPercentage.toFixed(2)}% ROI
                  </>
                ) : '•••%'}
              </p>
            </div>
          </div>
        )}
      </div>
    </button>

  );
}

export const HoldingCardMobile = memo(HoldingCardMobileBase);
HoldingCardMobile.displayName = 'HoldingCardMobile';
