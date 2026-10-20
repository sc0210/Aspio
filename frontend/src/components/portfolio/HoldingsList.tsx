'use client';

import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { ChartBarIcon, PlusIcon, ArrowDownTrayIcon } from '@heroicons/react/24/outline';
import dynamic from 'next/dynamic';
import { AdvancedFilters } from './holdingsFilters';
import { cn } from '@/utils/cn';
import { HoldingsListMobile } from './HoldingsListMobile';
import { HoldingRow } from './HoldingRow';
import { useTranslation } from 'react-i18next';
import { holdingKey, isCashHolding } from './holdingRowStyles';
import { Card } from '@/components/ui/Card';
import { useExchangeRates } from '@/hooks/useExchangeRates';

/** The account's reporting currency. */
const BASE_CURRENCY = 'TWD';

// Lazy-load the detail modal — it's 706 lines and only needed after the user
// clicks a holding row. Deferring it saves ~20 kB from the initial bundle.
const HoldingDetailModal = dynamic(
  () => import('./HoldingDetailModal').then(m => ({ default: m.HoldingDetailModal })),
  { ssr: false }
);

// Helper to check if price is stale (older than 4 hours)
// Format time ago — accepts t() so strings are translatable
function HoldingsTableHeader({ showBulkSelect, onSelectAll, allSelected }: {
  showBulkSelect: boolean;
  onSelectAll?: () => void;
  allSelected?: boolean;
}) {
  const { t } = useTranslation(['portfolio']);
  return (
    <thead className="bg-gray-50 dark:bg-gray-900/50">
      <tr>
        {showBulkSelect && (
          <th className="px-4 py-4 text-center">
            <input
              aria-label={t('portfolio:selectAllHoldings', 'Select all holdings')}
              type="checkbox"
              checked={!!allSelected}
              onChange={onSelectAll}
              className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-primary-700 dark:text-primary-600 focus-visible:ring-primary-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-900 cursor-pointer transition-colors"
            />
          </th>
        )}
        <th scope="col" className="px-3 md:px-6 py-4 text-left text-xs font-bold text-gray-600 dark:text-gray-300 uppercase tracking-wider">
          {t('portfolio:fields.symbol')}
        </th>
        <th scope="col" className="px-3 md:px-6 py-4 text-left text-xs font-bold text-gray-600 dark:text-gray-300 uppercase tracking-wider">
          {t('portfolio:fields.type')}
        </th>
        <th scope="col" className="px-3 md:px-6 py-4 text-right text-xs font-bold text-gray-600 dark:text-gray-300 uppercase tracking-wider">
          {t('portfolio:holdings.quantity')}
        </th>
        <th scope="col" className="px-3 md:px-6 py-4 text-right text-xs font-bold text-gray-600 dark:text-gray-300 uppercase tracking-wider">
          {t('portfolio:holdings.price')}
        </th>
        <th scope="col" className="px-3 md:px-6 py-4 text-center text-xs font-bold text-gray-600 dark:text-gray-300 uppercase tracking-wider">
          {t('portfolio:holdings.trend')}
        </th>
        <th scope="col" className="px-3 md:px-6 py-4 text-right text-xs font-bold text-gray-600 dark:text-gray-300 uppercase tracking-wider">
          {t('portfolio:holdings.value')}
        </th>
        <th scope="col" className="px-3 md:px-6 py-4 text-right text-xs font-bold text-gray-600 dark:text-gray-300 uppercase tracking-wider">
          {t('portfolio:holdings.return')}
        </th>
      </tr>
    </thead>
  );
}

export interface Holding {
  id: string;
  symbol: string;
  name: string;
  type: string;
  walletType?: 'portfolio' | 'emergency' | string;
  market?: string;
  quantity: number;
  averageCost: number;
  currentPrice: number;
  previousClose?: number;
  dayChange?: number;
  dayChangePercentage?: number;
  totalValue: number;
  totalCost: number;
  gainLoss: number;
  gainLossPercentage: number;
  irr?: number; // Annualized Internal Rate of Return
  currency: string;
  exchange: string;
  sector?: string;
  lastUpdated: Date;
  purchaseDate?: string;
  sparklineData?: number[]; // Real historical price data from backend
}

interface HoldingsListProps {
  holdings: Holding[];
  allHoldings?: Holding[]; // All non-aggregated lots for detailed view
  isValueVisible: boolean;
  filters: AdvancedFilters;
  onFiltersChange: (filters: AdvancedFilters) => void;
  onEditHolding?: (holding: Holding) => void;
  onSellHolding?: (holding: Holding) => void;
  onDeleteHolding?: (holdingId: string) => void;
  onUpdateLot?: (lotId: string, updates: { purchaseDate?: string; quantity?: number; averageCost?: number }) => Promise<void>;
  onUpdateSymbol?: (symbol: string, updates: { name?: string; sector?: string }) => Promise<void>;
  onAddInvestment?: () => void;
  onSellFromWallet?: () => void;
  bulkEditMode?: boolean;
  selectedHoldings?: string[];
  onSelectionChange?: (selected: string[]) => void;
  apiStatus?: 'connected' | 'disconnected' | 'loading';
  lastUpdated?: Date;
}


export function HoldingsList({
  holdings,
  allHoldings,
  isValueVisible,
  filters: _filters,
  onFiltersChange: _onFiltersChange,
  onEditHolding: _onEditHolding,
  onSellHolding,
  onDeleteHolding,
  onUpdateLot,
  onUpdateSymbol,
  onAddInvestment,
  onSellFromWallet,
  bulkEditMode = false,
  selectedHoldings = [],
  onSelectionChange,
  apiStatus = 'connected',
  lastUpdated
}: HoldingsListProps) {
  const { t } = useTranslation(['common', 'portfolio']);
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
  const [selectedWalletType, setSelectedWalletType] = useState<string | null>(null);

  // Selection handlers
  // Membership is asked once per row per render; a Set makes that O(1) instead
  // of O(n) a row, and the row receives the resolved boolean so only the row
  // whose own selection changed re-renders.
  const selectedSet = useMemo(() => new Set(selectedHoldings), [selectedHoldings]);

  // A holding priced in another currency shows its own figures; this adds the
  // base-currency equivalent underneath. `rateFor` returns undefined when the
  // pair could not be priced, and the row then shows nothing extra rather than
  // a number derived from a stale table.
  const { rateFor } = useExchangeRates(BASE_CURRENCY);

  // Read through a ref so the callback identity does not change every time the
  // selection does. Depending on `selectedHoldings` directly would hand every
  // memoised row a new `onToggleSelect` on each tick, re-rendering all of them —
  // which is the cost this split exists to remove. (Stable only as far as the
  // parent's own `onSelectionChange` is; that is outside this file.)
  const selectedRef = useRef(selectedHoldings);
  useEffect(() => { selectedRef.current = selectedHoldings; }, [selectedHoldings]);

  // Keyed by symbol AND wallet. By symbol alone, ticking a Portfolio lot also
  // ticked the Emergency lot of the same security, and the bulk-edit counter
  // said two. The row hands over the whole holding so it need not know the key
  // format.
  const toggleSelection = useCallback((holding: Holding) => {
    if (!onSelectionChange) return;
    const key = holdingKey(holding);
    const current = selectedRef.current;
    onSelectionChange(
      current.includes(key) ? current.filter(k => k !== key) : [...current, key]
    );
  }, [onSelectionChange]);

  // Forwarded to every row, so its identity matters as much as the handlers
  // this component owns — and it belongs to a caller that cannot be relied on
  // to memoise it. Held through a ref so a fresh arrow upstream cannot undo the
  // memo down here. The presence check is preserved: the row only draws its
  // sell action when a handler was actually supplied.
  const sellRef = useRef(onSellHolding);
  useEffect(() => { sellRef.current = onSellHolding; }, [onSellHolding]);
  const stableSell = useCallback((holding: Holding) => sellRef.current?.(holding), []);
  const rowSellHandler = onSellHolding ? stableSell : undefined;

  // The mobile list receives this at two call sites, and it reaches every
  // memoised card. Inline arrows there were a new prop on every render.
  const handleSelectSymbol = useCallback((symbol: string, walletType?: string) => {
    setSelectedSymbol(symbol);
    setSelectedWalletType(walletType || null);
  }, []);

  const handleOpenHolding = useCallback((holding: Holding) => {
    setSelectedSymbol(holding.symbol);
    setSelectedWalletType(holding.walletType || null);
  }, []);

  const toggleSelectAll = (holdings: Holding[]) => {
    if (!onSelectionChange) return;

    const keys = holdings.map(holdingKey);
    if (keys.every(k => selectedHoldings.includes(k))) {
      onSelectionChange(selectedHoldings.filter(k => !keys.includes(k)));
    } else {
      onSelectionChange([...new Set([...selectedHoldings, ...keys])]);
    }
  };

  // Separate cash holdings from investment holdings (memoized — recomputing on
  // every hover/re-render was wasteful)
  const { investmentHoldings, cashHoldings } = useMemo(() => {
    const inv: Holding[] = [];
    const cash: Holding[] = [];
    for (const h of holdings) {
      (isCashHolding(h) ? cash : inv).push(h);
    }
    return { investmentHoldings: inv, cashHoldings: cash };
  }, [holdings]);

  // Pre-compute lot counts once (symbol + wallet → count). Previously each row
  // re-scanned the full holdings array on every render — O(rows²) per paint.
  const lotCountMap = useMemo(() => {
    const source = allHoldings || holdings;
    const map = new Map<string, number>();
    for (const h of source) {
      const key = holdingKey(h);
      map.set(key, (map.get(key) || 0) + 1);
    }
    return map;
  }, [allHoldings, holdings]);

  // Get all lots for selected symbol AND walletType from allHoldings (non-aggregated)
  // This prevents mixing cash from different wallets (e.g., portfolio vs emergency)
  const selectedHoldingLots = selectedSymbol
    ? (allHoldings || holdings).filter(h => {
      const matchesSymbol = h.symbol === selectedSymbol;
      const matchesWalletType = selectedWalletType ? h.walletType === selectedWalletType : true;
      return matchesSymbol && matchesWalletType;
    })
    : [];


  // Filtered-empty state — the portfolio has holdings but the active wallet
  // filter matches none. Without this the section would render blank.
  if (holdings.length === 0) {
    return (
      <div className="py-12 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-gray-100 dark:bg-gray-700">
          <ChartBarIcon className="h-6 w-6 text-gray-500 dark:text-gray-500" />
        </div>
        <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
          {t('portfolio:holdings.noHoldingsInWallet', 'No holdings in this wallet')}
        </p>
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          {t('portfolio:holdings.tryAnotherWallet', 'Try another wallet tab or add a new holding.')}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Investment Holdings */}
      {investmentHoldings.length > 0 && (
        <Card padding="none" radius="xl" clip className="hover:shadow-lg transition-all duration-200">
          <div className="px-4 py-4 sm:px-6 sm:py-5 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-primary-50 dark:bg-primary-900/30 rounded-xl flex-shrink-0">
                  <ChartBarIcon className="w-5 h-5 text-primary-700 dark:text-primary-400" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-gray-900 dark:text-white">
                    {t('portfolio:holdings.investments')}
                  </h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 font-medium">
                    {t('portfolio:holdings.holding', { count: investmentHoldings.length })}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {/* Live Status Indicator */}
                <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-gray-50 dark:bg-gray-900/50 rounded-lg border border-gray-200 dark:border-gray-700">
                  <div className={cn(
                    'w-2 h-2 rounded-full flex-shrink-0',
                    apiStatus === 'connected' && 'bg-emerald-500 dark:bg-emerald-400 animate-pulse',
                    apiStatus === 'disconnected' && 'bg-rose-500 dark:bg-rose-400',
                    apiStatus === 'loading' && 'bg-yellow-500 dark:bg-yellow-400 animate-pulse'
                  )} />
                  <p className={cn(
                    'text-xs font-semibold',
                    apiStatus === 'connected' && 'text-emerald-700 dark:text-emerald-400',
                    apiStatus === 'disconnected' && 'text-rose-600 dark:text-rose-400',
                    apiStatus === 'loading' && 'text-yellow-700 dark:text-yellow-400'
                  )}>
                    {apiStatus === 'connected' && 'Live'}
                    {apiStatus === 'disconnected' && 'Offline'}
                    {apiStatus === 'loading' && 'Syncing'}
                  </p>
                </div>

                {/* Last Updated Time — hidden on mobile to save space */}
                {lastUpdated && (
                  <p className="hidden sm:block text-xs text-gray-500 dark:text-gray-400 px-3 py-1.5 bg-gray-50 dark:bg-gray-900/50 rounded-lg border border-gray-200 dark:border-gray-700">
                    {lastUpdated instanceof Date
                      ? lastUpdated.toLocaleTimeString(undefined, {
                        hour: '2-digit',
                        minute: '2-digit'
                      })
                      : new Date(lastUpdated).toLocaleTimeString(undefined, {
                        hour: '2-digit',
                        minute: '2-digit'
                      })
                    }
                  </p>
                )}

                {onAddInvestment && (
                  <button
                    onClick={onAddInvestment}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary-700 hover:bg-primary-800 dark:bg-primary-500 dark:hover:bg-primary-600 text-white text-xs font-semibold rounded-lg shadow-sm hover:shadow-md transition-all duration-200 active:scale-[0.98]"
                    title="Buy Investment"
                  >
                    <PlusIcon className="w-3.5 h-3.5" />
                    <span>Buy</span>
                  </button>
                )}
                {onSellFromWallet && (
                  <button
                    onClick={onSellFromWallet}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-green-700 hover:bg-green-800 dark:bg-green-500 dark:hover:bg-green-600 text-white text-xs font-semibold rounded-lg shadow-sm hover:shadow-md transition-all duration-200 active:scale-[0.98]"
                    title="Sell Investment"
                  >
                    <ArrowDownTrayIcon className="w-3.5 h-3.5" />
                    <span>Sell</span>
                  </button>
                )}
              </div>
            </div>
          </div>
          {/* Desktop Table View */}
          <div className="hidden md:block overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
              <HoldingsTableHeader
                showBulkSelect={bulkEditMode}
                onSelectAll={() => toggleSelectAll(investmentHoldings)}
                allSelected={investmentHoldings.length > 0 && investmentHoldings.every(h => selectedSet.has(holdingKey(h)))}
              />
              <tbody className="bg-white dark:bg-gray-800">
                {investmentHoldings.map((holding) => (
                <HoldingRow
                  key={holding.id}
                  holding={holding}
                  isSelected={selectedSet.has(holdingKey(holding))}
                  isValueVisible={isValueVisible}
                  bulkEditMode={bulkEditMode}
                  lotCount={lotCountMap.get(holdingKey(holding)) || 1}
                  baseRate={holding.currency?.toUpperCase() === BASE_CURRENCY ? undefined : rateFor(holding.currency)}
                  baseCurrency={BASE_CURRENCY}
                  onToggleSelect={toggleSelection}
                  onOpen={handleOpenHolding}
                  onSellHolding={rowSellHandler}
                />
              ))}
              </tbody>
            </table>
          </div>
          {/* Mobile Card View */}
          <div className="md:hidden px-4 py-4">
            <HoldingsListMobile
              holdings={investmentHoldings}
              allHoldings={allHoldings}
              isValueVisible={isValueVisible}
              onSelect={handleSelectSymbol}
              bulkEditMode={bulkEditMode}
              selectedHoldings={selectedHoldings}
              rateFor={rateFor}
              baseCurrency={BASE_CURRENCY}
              onSelectionChange={onSelectionChange}
            />
          </div>
        </Card>
      )}

      {/* Cash & Savings Holdings */}
      {cashHoldings.length > 0 && (
        <Card padding="none" radius="xl" clip className="hover:shadow-lg transition-all duration-200">
          <div className="px-6 py-5 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-success-50 dark:bg-success-900/30 rounded-xl">
                <ChartBarIcon className="w-5 h-5 text-success-700 dark:text-success-400" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                  {t('portfolio:holdings.cashSavings')}
                </h3>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 font-medium">
                  {t('portfolio:holdings.account', { count: cashHoldings.length })}
                </p>
              </div>
            </div>
          </div>
          {/* Desktop Table View */}
          <div className="hidden md:block overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
              <HoldingsTableHeader showBulkSelect={false} />
              <tbody className="bg-white dark:bg-gray-800">
                {cashHoldings.map((holding) => (
                <HoldingRow
                  key={holding.id}
                  holding={holding}
                  isSelected={selectedSet.has(holdingKey(holding))}
                  isValueVisible={isValueVisible}
                  bulkEditMode={bulkEditMode}
                  lotCount={lotCountMap.get(holdingKey(holding)) || 1}
                  baseRate={holding.currency?.toUpperCase() === BASE_CURRENCY ? undefined : rateFor(holding.currency)}
                  baseCurrency={BASE_CURRENCY}
                  onToggleSelect={toggleSelection}
                  onOpen={handleOpenHolding}
                  onSellHolding={rowSellHandler}
                />
              ))}
              </tbody>
            </table>
          </div>
          {/* Mobile Card View */}
          <div className="md:hidden px-4 py-4">
            <HoldingsListMobile
              holdings={cashHoldings}
              allHoldings={allHoldings}
              isValueVisible={isValueVisible}
              onSelect={handleSelectSymbol}
              bulkEditMode={bulkEditMode}
              selectedHoldings={selectedHoldings}
              rateFor={rateFor}
              baseCurrency={BASE_CURRENCY}
              onSelectionChange={onSelectionChange}
            />
          </div>
        </Card>
      )}

      {/* Holding Detail Modal */}
      {selectedSymbol && selectedHoldingLots.length > 0 && (
        <HoldingDetailModal
          holdings={selectedHoldingLots}
          symbol={selectedSymbol}
          isValueVisible={isValueVisible}
          onClose={() => {
            setSelectedSymbol(null);
            setSelectedWalletType(null);
          }}
          onUpdateLot={onUpdateLot}
          onSellLot={onSellHolding ? (lot) => onSellHolding(lot as unknown as Holding) : undefined}
          onDeleteLot={onDeleteHolding ? async (lotId) => { onDeleteHolding(lotId); } : undefined}
          onUpdateSymbol={onUpdateSymbol}
        />
      )}
    </div>
  );
}
