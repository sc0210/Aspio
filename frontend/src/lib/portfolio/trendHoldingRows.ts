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

  // The series covers the Portfolio wallet (goal lots included) and no cash, so
  // a symbol's figures belong to its Portfolio piece only.
  const isCash = (h: { type?: string }) => (h.type || '').toLowerCase() === 'cash';
  const inSeries = (h: { type?: string; walletType?: string }) =>
    !isCash(h) && h.walletType !== 'emergency';
  // Cash accounts merge by name across wallets; a security's pieces (lots,
  // goals, whatever each was named) merge by symbol within its wallet, so one
  // symbol never shows its series figures twice.
  const mergeKey = (h: { symbol: string; name: string; type?: string; walletType?: string }) =>
    isCash(h) ? `${h.symbol}__${h.name}` : `${h.symbol}__${h.walletType === 'emergency' ? 'emergency' : 'portfolio'}`;

  // First pass → HoldingRow
  const firstPassRows: Array<{ key: string; row: HoldingRow }> = aggregated.map((h) => {
    const seriesOf = <T,>(m: Record<string, T>) => (inSeries(h) ? m[h.symbol] : undefined);
    const sv = seriesOf(startHoldings);
    const ev = seriesOf(endHoldings);
    const cumChange = seriesOf(cumulativeChange); // sum of daily P&L — undefined if no daily data at all

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

    const row: HoldingRow = {
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
    return { key: mergeKey(h), row };
  });

  // Second pass: merge the pieces that share a key (see mergeKey).
  const nameMap = new Map<string, HoldingRow>();
  for (const { key, row } of firstPassRows) {
    const existing = nameMap.get(key);
    if (!existing) {
      nameMap.set(key, { ...row });
    } else {
      const combinedQty = existing.quantity + row.quantity;
      const combinedCost = existing.totalCost + row.totalCost;
      const combinedValue = existing.currentValue + row.currentValue;
      // Start, end and change come off the trend series by symbol, so every
      // piece of a key already carries the same figures: keep them once.
      // Adding them counted a symbol split across lots or goals twice.
      nameMap.set(key, {
        ...existing,
        quantity: combinedQty,
        avgCost: combinedQty > 0 ? combinedCost / combinedQty : 0,
        totalCost: combinedCost,
        currentValue: combinedValue,
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
