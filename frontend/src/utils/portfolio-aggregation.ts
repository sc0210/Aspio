import { PortfolioHolding } from '@/shared/types';

function calculateLotLevelXirr(lots: PortfolioHolding[], totalValue: number): number | undefined {
  const validFlows = lots
    .map((lot) => {
      const purchaseDate = lot.purchaseDate ? new Date(lot.purchaseDate) : null;
      const cost = Number(lot.totalCost || (lot.quantity * lot.averageCost) || 0);
      return { purchaseDate, cost };
    })
    .filter((flow) => flow.purchaseDate && !isNaN(flow.purchaseDate.getTime()) && flow.cost > 0)
    .map((flow) => ({
      date: flow.purchaseDate as Date,
      amount: -flow.cost,
    }));

  if (validFlows.length === 0 || totalValue <= 0) {
    return undefined;
  }

  const terminalDate = new Date();
  const cashFlows = [...validFlows, { date: terminalDate, amount: totalValue }].sort(
    (a, b) => a.date.getTime() - b.date.getTime()
  );

  const start = cashFlows[0].date;
  const yearFractions = cashFlows.map(
    (flow) => (flow.date.getTime() - start.getTime()) / (1000 * 60 * 60 * 24 * 365.25)
  );

  const npv = (rate: number) =>
    cashFlows.reduce((sum, flow, index) => {
      const discount = Math.pow(1 + rate, yearFractions[index]);
      return sum + flow.amount / discount;
    }, 0);

  const dNpv = (rate: number) =>
    cashFlows.reduce((sum, flow, index) => {
      const years = yearFractions[index];
      if (years === 0) return sum;
      const discount = Math.pow(1 + rate, years + 1);
      return sum - (years * flow.amount) / discount;
    }, 0);

  const totalCost = Math.abs(cashFlows.slice(0, -1).reduce((sum, flow) => sum + flow.amount, 0));
  const roiGuess = totalCost > 0 ? (totalValue - totalCost) / totalCost : 0.1;
  let rate = Math.max(-0.9, Math.min(roiGuess, 2));

  for (let i = 0; i < 80; i++) {
    const value = npv(rate);
    if (Math.abs(value) < 1e-7) {
      return rate;
    }

    const derivative = dNpv(rate);
    if (!isFinite(derivative) || Math.abs(derivative) < 1e-12) {
      break;
    }

    const nextRate = rate - value / derivative;
    if (!isFinite(nextRate) || nextRate <= -0.9999 || nextRate > 10) {
      break;
    }
    rate = nextRate;
  }

  return undefined;
}

/**
 * Aggregate multiple lots of the same symbol for portfolio display
 * while preserving individual lots for detailed view
 * 
 * FINANCIAL TERMINOLOGY (see docs/FINANCIAL_TERMINOLOGY.md):
 * - totalValue 💼 = Current market value of holdings (quantity × currentPrice)
 * - totalCost = Original purchase cost (quantity × averageCost)
 * - This is used ONLY for portfolio page calculations, not dashboard totals
 * 
 * IMPORTANT: Value Calculation
 * - Uses pre-calculated totalCost and totalValue from each holding
 * - This preserves backend currency conversions and calculations
 * - Do NOT recalculate by multiplying quantity × price, as this loses conversions
 * 
 * IRR Calculation for Aggregated Holdings:
 * - Primary: XIRR from lot-level cash flows (buy date + buy amount + current value)
 *   This correctly handles mixed buy times and buy sizes
 * - Fallback: Earliest purchase date CAGR when XIRR cannot converge
 */
export function aggregateHoldingsBySymbol(holdings: PortfolioHolding[]): PortfolioHolding[] {
  const symbolMap = new Map<string, PortfolioHolding[]>();

  // Group holdings by symbol AND walletType (important for cash holdings)
  holdings.forEach(holding => {
    const key = `${holding.symbol}-${holding.walletType || 'portfolio'}`;
    const lots = symbolMap.get(key) || [];
    lots.push(holding);
    symbolMap.set(key, lots);
  });

  // Aggregate each symbol's lots
  const aggregated: PortfolioHolding[] = [];

  symbolMap.forEach((lots, symbol) => {
    if (lots.length === 1) {
      // Only one lot, no aggregation needed
      aggregated.push(lots[0]);
    } else {
      // Multiple lots, aggregate them
      const totalQuantity = lots.reduce((sum, lot) => sum + lot.quantity, 0);

      // Use pre-calculated totalCost and totalValue from holdings instead of recalculating
      // This preserves currency conversions and backend calculations
      const totalCost = lots.reduce((sum, lot) => sum + (lot.totalCost || (lot.quantity * lot.averageCost)), 0);
      const totalValue = lots.reduce((sum, lot) => sum + (lot.totalValue || (lot.quantity * lot.currentPrice)), 0);

      const weightedAvgCost = totalQuantity > 0 ? totalCost / totalQuantity : 0;

      // Use the most recent current price (lots should have same price)
      const _currentPrice = lots[0].currentPrice;
      const gainLoss = totalValue - totalCost;
      const gainLossPercentage = totalCost > 0 ? (gainLoss / totalCost) * 100 : 0;

      // Day change must be summed across lots. It used to be inherited from
      // lots[0] via the spread below, so a 22-lot position reported the day
      // change of its largest lot alone (6,452 of 17,268 shares) next to the
      // full quantity. Derive the percentage from the aggregate rather than
      // copying a lot's, since lots of one symbol can carry different
      // currentPrice values when a price refresh only reached some of them.
      const lotsWithDayChange = lots.filter(lot => lot.dayChange != null);
      const dayChange = lotsWithDayChange.length > 0
        ? lotsWithDayChange.reduce((sum, lot) => sum + (lot.dayChange ?? 0), 0)
        : undefined;
      const previousValue = dayChange != null ? totalValue - dayChange : undefined;
      const dayChangePercentage = dayChange != null && previousValue != null && previousValue > 0
        ? (dayChange / previousValue) * 100
        : undefined;

      // Calculate IRR for aggregated holdings
      // Use lot-level XIRR so different buy times/amounts are captured correctly
      let aggregatedIRR: number | undefined = undefined;

      // Method 1: Cash-flow XIRR across lots
      aggregatedIRR = calculateLotLevelXirr(lots, totalValue);

      // Method 2 (fallback): Use earliest purchase date for conservative IRR estimate
      if (aggregatedIRR === undefined || isNaN(aggregatedIRR)) {
        const sortedLots = [...lots].sort((a, b) => {
          const dateA = a.purchaseDate ? new Date(a.purchaseDate).getTime() : 0;
          const dateB = b.purchaseDate ? new Date(b.purchaseDate).getTime() : 0;
          return dateA - dateB;
        });

        const earliestLot = sortedLots[0];
        if (earliestLot && earliestLot.purchaseDate) {
          // Calculate IRR from earliest purchase date
          const purchaseDate = new Date(earliestLot.purchaseDate);
          const now = new Date();
          const years = (now.getTime() - purchaseDate.getTime()) / (1000 * 60 * 60 * 24 * 365.25);

          if (years > 0 && totalCost > 0) {
            const ratio = totalValue / totalCost;
            aggregatedIRR = Math.pow(ratio, 1 / years) - 1;
          }
        }
      }

      // Create aggregated holding using first lot as template
      const aggregatedHolding: PortfolioHolding = {
        ...lots[0],
        id: `aggregated-${symbol}`, // Special ID to indicate aggregation
        quantity: totalQuantity,
        averageCost: weightedAvgCost,
        totalCost, // Explicitly set aggregated totalCost
        totalValue,
        gainLoss,
        gainLossPercentage,
        dayChange,
        dayChangePercentage,
        irr: aggregatedIRR, // Use recalculated IRR, not first lot's IRR
        // Add metadata to indicate this is aggregated
        metadata: {
          ...lots[0].metadata,
          isAggregated: true,
          lotCount: lots.length,
          purchaseDates: lots.map(l => l.purchaseDate).filter(Boolean),
          // Real lot ids backing this aggregate. The aggregate's own `id` is a
          // synthetic "aggregated-…" string, so the sell flow uses one of these
          // real ids — the backend resolves the symbol and sells FIFO across lots.
          lotIds: lots.map(l => l.id)
        }
      };

      aggregated.push(aggregatedHolding);
    }
  });

  return aggregated;
}
