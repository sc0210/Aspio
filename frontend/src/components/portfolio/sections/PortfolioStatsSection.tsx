'use client';

import { PortfolioStats } from '@/components/portfolio/PortfolioStats';
import { usePrivacy } from '@/contexts/PrivacyContext';
import type { PortfolioViewState } from '@/hooks/portfolio/usePortfolioViewState';
import type { Portfolio } from '@/shared/types';

interface RiskMetrics {
  cagr: number | null;
  cagrPercentage: number | null;
  maxDrawdown: number | null;
  maxDrawdownPercentage: number | null;
  annualizedVolatility: number | null;
  annualizedVolatilityPercentage: number | null;
  sharpeRatio: number | null;
  hhi: number | null;
  hhiLabel: string;
  beta: number | null;
  alpha: number | null;
  alphaPercentage: number | null;
  benchmarkSymbol: string;
  hasHistoricalData: boolean;
}

interface DividendIncome {
  totalDividends: number | null;
  dividendYield: number | null;
  projectedAnnual: number | null;
  yieldOnCost: number | null;
  yieldOnValue: number | null;
}

interface RealizedPnl {
  realizedGainLoss: number;
  realizedCount: number;
}

interface PortfolioStatsSectionProps {
  portfolioData: Portfolio | undefined;
  riskMetrics?: RiskMetrics | null;
  dividendIncome?: DividendIncome | null;
  realizedPnl?: RealizedPnl | null;
  viewState: PortfolioViewState;
  onTodayChangeClick?: () => void;
  onViewTrendClick?: () => void;
}

/**
 * Portfolio stats section component
 *
 * Displays portfolio performance metrics and statistics.
 * This component wraps the existing PortfolioStats component
 * and provides a consistent section layout.
 *
 * Features:
 * - Total portfolio value
 * - Gain/loss metrics
 * - Performance view mode toggle (absolute vs percentage)
 * - Today's performance
 * - Analytics data visualization
 *
 * @example
 * ```tsx
 * <PortfolioStatsSection
 *   portfolioData={portfolioData}
 *   viewState={viewState}
 * />
 * ```
 */
export function PortfolioStatsSection({
  portfolioData,
  riskMetrics,
  dividendIncome,
  realizedPnl,
  viewState: _viewState,
  onTodayChangeClick,
  onViewTrendClick,
}: PortfolioStatsSectionProps) {
  const { isValueVisible } = usePrivacy();

  // Don't render if no portfolio data
  if (!portfolioData) {
    return null;
  }

  return (
    <div>
      <PortfolioStats
        portfolio={{
          totalValue: portfolioData?.totalValue || 0,
          totalCost: portfolioData?.totalCost || 0,
          totalGainLoss: portfolioData?.totalGainLoss || 0,
          gainLossPercentage: portfolioData?.totalGainLossPercentage || 0,
          currency: portfolioData?.currency || 'TWD',
          lastUpdated: portfolioData?.lastPriceUpdateAt || new Date(),
          todayGainLoss: portfolioData?.todayGainLoss || 0,
          todayGainLossPercentage: portfolioData?.todayGainLossPercentage || 0,
          holdings: portfolioData?.holdings,
        }}

        isValueVisible={isValueVisible}
        onTodayChangeClick={onTodayChangeClick}
        onViewTrendClick={onViewTrendClick}
        riskMetrics={{
          sharpeRatio: riskMetrics?.sharpeRatio ?? undefined,
          beta: riskMetrics?.beta ?? undefined,
          cagr: riskMetrics?.cagrPercentage ?? undefined,
          maxDrawdown: riskMetrics?.maxDrawdownPercentage ?? undefined,
          annualizedVolatility: riskMetrics?.annualizedVolatilityPercentage ?? undefined,
          hhi: riskMetrics?.hhi ?? undefined,
          hhiLabel: riskMetrics?.hhiLabel,
          alpha: riskMetrics?.alphaPercentage ?? undefined,
          benchmarkSymbol: riskMetrics?.benchmarkSymbol,
        }}
        dividendIncome={dividendIncome ? {
          projectedAnnual: dividendIncome.projectedAnnual,
          yieldOnCost: dividendIncome.yieldOnCost,
          yieldOnValue: dividendIncome.yieldOnValue,
          currency: portfolioData?.currency || 'TWD',
        } : undefined}
        realizedPnl={realizedPnl && realizedPnl.realizedCount > 0 ? {
          realizedGainLoss: realizedPnl.realizedGainLoss,
          realizedCount: realizedPnl.realizedCount,
          currency: portfolioData?.currency || 'TWD',
        } : undefined}
      />
    </div>
  );
}
