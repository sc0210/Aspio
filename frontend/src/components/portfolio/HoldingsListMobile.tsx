'use client';

import React, { useMemo, useRef, useEffect, useCallback } from 'react';
import { HoldingCardMobile } from './HoldingCardMobile';
import { holdingKey } from './holdingRowStyles';

// Helper to check if price is stale (older than 4 hours)
// Format time ago — accepts t() so strings are translatable
interface Holding {
  id: string;
  symbol: string;
  name: string;
  type: string;
  walletType?: 'portfolio' | 'emergency' | string;
  market?: string;
  quantity: number;
  averageCost: number;
  currentPrice: number;
  dayChange?: number;
  dayChangePercentage?: number;
  totalValue: number;
  totalCost: number;
  gainLoss: number;
  gainLossPercentage: number;
  irr?: number;
  currency: string;
  exchange: string;
  sector?: string;
  lastUpdated: Date;
  purchaseDate?: string;
  sparklineData?: number[];
}

interface HoldingsListMobileProps {
  holdings: Holding[];
  allHoldings?: Holding[];
  isValueVisible: boolean;
  onSelect: (symbol: string, walletType?: string) => void;
  bulkEditMode?: boolean;
  selectedHoldings?: string[];
  /** Passed straight to each card — see HoldingCardMobile. */
  rateFor?: (currency?: string) => number | undefined;
  baseCurrency?: string;
  onSelectionChange?: (selected: string[]) => void;
}

export function HoldingsListMobile({
  holdings,
  allHoldings,
  isValueVisible,
  onSelect,
  bulkEditMode = false,
  selectedHoldings = [],
  rateFor,
  baseCurrency = 'TWD',
  onSelectionChange
}: HoldingsListMobileProps) {
  // O(1) per card instead of a `.includes` scan, and the card receives the
  // resolved boolean so only the one whose selection changed re-renders.
  const selectedSet = useMemo(() => new Set(selectedHoldings), [selectedHoldings]);

  // Was `(allHoldings || holdings).filter(...).length` inside the map — a full
  // scan per card, so O(n²) for the list. Counted once here instead.
  //
  // Keyed by symbol AND wallet, matching the desktop table. Counting by symbol
  // alone — which is what the filter did — merges the same security held in two
  // wallets into one number, so a position held in both Portfolio and Emergency
  // showed a combined "3×" on the phone and separate counts on the desktop.
  // That predates this refactor; it is fixed here because having the two
  // surfaces disagree is the thing this change set exists to stop.
  const lotCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const h of allHoldings || holdings) {
      const key = holdingKey(h);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [allHoldings, holdings]);

  // Read through a ref so the identity survives a selection change; depending
  // on `selectedHoldings` would hand every memoised card a new callback each
  // time anything was ticked, which is the cost this split removes.
  const selectedRef = useRef(selectedHoldings);
  useEffect(() => { selectedRef.current = selectedHoldings; }, [selectedHoldings]);

  // Keyed by symbol AND wallet, matching the desktop list — by symbol alone,
  // ticking a Portfolio lot also ticked the Emergency lot of the same security.
  const handleToggleSelect = useCallback((holding: Holding, e: React.SyntheticEvent) => {
    e.stopPropagation();
    if (!onSelectionChange) return;
    const key = holdingKey(holding);
    const current = selectedRef.current;
    onSelectionChange(
      current.includes(key) ? current.filter(k => k !== key) : [...current, key]
    );
  }, [onSelectionChange]);

  return (
    <div className="space-y-3">
      {holdings.map((holding) => (
        <HoldingCardMobile
          key={holding.id}
          holding={holding}
          isSelected={selectedSet.has(holdingKey(holding))}
          isValueVisible={isValueVisible}
          bulkEditMode={bulkEditMode}
          lotCount={lotCounts.get(holdingKey(holding)) ?? 1}
          baseRate={holding.currency?.toUpperCase() === baseCurrency ? undefined : rateFor?.(holding.currency)}
          baseCurrency={baseCurrency}
          onSelect={onSelect}
          onToggleSelect={handleToggleSelect}
        />
      ))}
    </div>
  );
}
