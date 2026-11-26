/**
 * The /portfolio/trend holdings table: one row per symbol (lots grouped, and
 * same-named cash accounts across wallets merged), with its period change read
 * off the trend series' per-day topHoldings.
 */

import type { Portfolio } from '@/shared/types';
import { aggregateHoldingsBySymbol } from '@/utils/portfolio-aggregation';
import { toTWD } from '@/utils/formatters';

export interface HoldingRow {
  symbol: string;
  name: string;
  type: string;
  quantity: number;
  avgCost: number;
  currency: string;
  currentPrice: number;
  currentValue: number;
  startValue: number | null;
  endValue: number | null;
  periodChange: number | null;
  periodChangePct: number | null;
  isPartialPeriod: boolean; // true when asset wasn't held since the period start
  weight: number;
  totalCost: number;
  lotCount: number;
  sparkline: number[];
}

/** The part of a trend point this table reads. */
export interface TrendHoldingsPoint {
  topHoldings?: Array<{ symbol: string; change: number; value: number }>;
}

export function buildTrendHoldingRows(
  portfolio: Portfolio | null | undefined,
  trend: TrendHoldingsPoint[],
  convert: (amount: number, currency: string) => number = toTWD,
): HoldingRow[] {
  if (!portfolio?.holdings || portfolio.holdings.length === 0) return [];
  if (trend.length === 0) return [];

  const currency = portfolio.currency || 'TWD';

  // Derive per-holding period changes from topHoldings arrays in the trend data
  // topHoldings entry: { symbol, change, value } — change is daily P&L, value is holding value that day

  // Map: symbol → { startValue, endValue, cumulativeChange }
  const firstPoint = trend[0];
  const lastPoint = trend[trend.length - 1];

  const startHoldings: Record<string, number> = {};
  const endHoldings: Record<string, number> = {};

  (firstPoint.topHoldings || []).forEach((h) => {
    startHoldings[h.symbol] = h.value;
  });
  (lastPoint.topHoldings || []).forEach((h) => {
    endHoldings[h.symbol] = h.value;
  });

  // Accumulate daily P&L changes per symbol across the full period.
  // This is more reliable than snapshot-diff (ev - sv) because:
  //  • it naturally handles assets bought mid-period (accumulation starts on purchase day)
  //  • it isn't affected by stale/missing snapshot values on boundary dates
  const cumulativeChange: Record<string, number> = {};
  for (const point of trend) {
    for (const h of point.topHoldings || []) {
      cumulativeChange[h.symbol] = (cumulativeChange[h.symbol] ?? 0) + h.change;
    }
  }

  // First pass: aggregate by symbol+walletType (groups individual lots)
  const aggregated = aggregateHoldingsBySymbol(portfolio.holdings);

  // First pass → HoldingRow
  const firstPassRows: HoldingRow[] = aggregated.map((h) => {
    const sv = startHoldings[h.symbol];
    const ev = endHoldings[h.symbol];
    const cumChange = cumulativeChange[h.symbol]; // sum of daily P&L — undefined if no daily data at all

    const startValue = sv !== undefined ? sv : null;
    const endValue = ev !== undefined ? ev : null;

    // An asset is "partial" if it has no snapshot at the period start —
    // meaning it was purchased after the period began.
    const isPartialPeriod =
      sv === undefined && (cumChange !== undefined || ev !== undefined);

    // Prefer cumulativeChange (sum of daily P&L) as the canonical period change.
    // Fall back to snapshot diff only when daily data is fully absent.
    let periodChange: number | null;
    if (cumChange !== undefined) {
      periodChange = cumChange;
    } else if (startValue !== null && endValue !== null) {
      periodChange = endValue - startValue;
    } else {
      periodChange = null;
    }

    // % change: only meaningful when the asset was held for the full period
    // (i.e. a period-start snapshot exists as the reference point).
    // For partial-period holdings there is no valid baseline, so we leave it null.
    let periodChangePct: number | null = null;
    if (periodChange !== null && startValue !== null && startValue > 0) {
      periodChangePct = (periodChange / startValue) * 100;
    }

    return {
      symbol: h.symbol,
      name: h.name,
      type: h.type,
      quantity: h.quantity,
      avgCost: h.averageCost,
      currency: h.currency || currency,
      currentPrice: h.currentPrice,
      // holdings[] carry their own currency; the table's values are TWD, like
      // the trend series it reads start and end from.
      currentValue: convert(h.totalValue, h.currency || currency),
      startValue,
      endValue,
      periodChange,
      periodChangePct,
      isPartialPeriod,
      weight: 0, // set below, once every row is in
      totalCost: h.totalCost ?? h.quantity * h.averageCost,
      lotCount: (h.metadata?.lotCount as number) ?? 1,
      sparkline: h.sparklineData ?? [],
    };
  });

  // Second pass: merge rows that share the same symbol+name
  // (handles same-named cash accounts spread across multiple wallet types)
  const nameMap = new Map<string, HoldingRow>();
  for (const row of firstPassRows) {
    const key = `${row.symbol}__${row.name}`;
    const existing = nameMap.get(key);
    if (!existing) {
      nameMap.set(key, { ...row });
    } else {
      const combinedQty = existing.quantity + row.quantity;
      const combinedCost = existing.totalCost + row.totalCost;
      const combinedValue = existing.currentValue + row.currentValue;
      const combinedStart =
        existing.startValue !== null || row.startValue !== null
          ? (existing.startValue ?? 0) + (row.startValue ?? 0)
          : null;
      const combinedEnd =
        existing.endValue !== null || row.endValue !== null
          ? (existing.endValue ?? 0) + (row.endValue ?? 0)
          : null;
      const pChange = combinedStart !== null && combinedEnd !== null ? combinedEnd - combinedStart : null;
      const pChangePct =
        combinedStart !== null && pChange !== null && combinedStart > 0
          ? (pChange / combinedStart) * 100
          : null;
      nameMap.set(key, {
        ...existing,
        quantity: combinedQty,
        avgCost: combinedQty > 0 ? combinedCost / combinedQty : 0,
        totalCost: combinedCost,
        currentValue: combinedValue,
        startValue: combinedStart,
        endValue: combinedEnd,
        periodChange: pChange,
        periodChangePct: pChangePct,
        // partial if either constituent row is partial
        isPartialPeriod: existing.isPartialPeriod || row.isPartialPeriod,
        lotCount: existing.lotCount + row.lotCount,
      });
    }
  }

  // Each row's share of the table, cash rows included, so the weights add up
  // to 100%. They were a native amount over the investments-only total: a
  // US$3,500 lot read 0.6%, and the column summed to ~114%. Overdrawn cash
  // (negative) weighs 0 rather than shrinking the total under the rest.
  const rows = Array.from(nameMap.values());
  const held = (r: HoldingRow) => Math.max(0, r.currentValue);
  const tableTotal = rows.reduce((sum, r) => sum + held(r), 0);
  return rows.map((r) => ({ ...r, weight: tableTotal > 0 ? (held(r) / tableTotal) * 100 : 0 }));
}
