'use client';

import { useMemo } from 'react';
import { demoLoans } from '@/data/demoData';
import { keepPreviousData } from '@tanstack/react-query';
import { dashboardService } from '@/services/dashboardService';
import { portfolioService } from '@/services/portfolioService';
import { useAppMode } from './useAppMode';
import { useDemo } from '@/contexts/DemoContext';
import { useDualModeQuery } from './useAuthenticatedQuery';
import { QUERY_KEYS } from './useDataSynchronization';

interface DashboardHolding {
  symbol: string;
  name: string;
  value: number;
  gainLoss: number;
  gainLossPercentage: number;
}

interface DashboardActivity {
  id: string;
  type: string;
  title: string;
  description: string;
  timestamp: Date;
}

interface TrendDataPoint {
  date: string;
  income: number;
  expenses: number;
  balance: number;
  netWorth: number;
}

interface WalletTrendDataPoint {
  date: string;
  lifeWallet: number;
  portfolioWallet: number;
  emergencyWallet: number;
  totalAsset: number;
  investmentTotal: number;
  debtBalance?: number;
}

interface RawHolding {
  totalValue?: number;
  value?: number;
  currency?: string;
  walletType?: string;
  gainLoss?: number;
  gainLossPercentage?: number;
  symbol?: string;
  name?: string;
}

interface DashboardStatsData {
  life_wallet?: number;
  portfolio_wallet?: number;
  emergency_wallet?: number;
  total_debt?: number;
  total_income?: number;
  totalIncome?: number;
  total_expenses?: number;
  totalExpenses?: number;
  savings_rate?: number;
  savingsRate?: number;
  portfolio_change?: number;
  portfolioChange?: number;
  investment_return?: number;
  investmentReturn?: number;
  monthly_change?: number;
  monthlyChange?: number;
  upcoming_bills?: number;
  upcomingBills?: number;
}

interface PortfolioOverviewData {
  holdings?: RawHolding[];
  totalValue?: number;
  totalGainLoss?: number;
  totalGainLossPercentage?: number;
}

interface OptimizedDashboardData {
  stats: {
    // Three-wallet system
    life_wallet: number;
    portfolio_wallet: number;
    emergency_wallet: number;
    total_asset: number;
    total_debt: number;
    investment_total: number;

    // Legacy fields
    totalBalance: number;
    monthlyIncome: number;
    monthlyExpenses: number;
    netWorth: number;
    savingsRate: number;
    portfolioValue: number;
    portfolioGrowth: number;
    monthlyChange: number;
    upcomingBills: number;
    totalAssets: number;
  };
  recentTransactions: unknown[];
  portfolio: {
    totalValue: number;
    totalGainLoss: number;
    gainLossPercentage: number;
    holdings: DashboardHolding[];
  };
  activities: DashboardActivity[];
  trendData?: TrendDataPoint[];
  walletTrendData?: WalletTrendDataPoint[];
}

function safeNumber(value: number | undefined | null, fallback: number = 0): number {
  if (value === null || value === undefined || isNaN(value) || !isFinite(value)) {
    return fallback;
  }
  return value;
}

function deriveFxRate(holdings: RawHolding[], totalTWD: number): number {
  let twdNative = 0;
  let foreignNative = 0;
  for (const h of holdings) {
    const v = safeNumber(h?.totalValue, 0);
    if ((h?.currency ?? 'USD').toUpperCase() === 'TWD') twdNative += v;
    else foreignNative += v;
  }
  return foreignNative > 0 ? (totalTWD - twdNative) / foreignNative : 1;
}

/**
 * Optimized dashboard hook that aggregates all dashboard data in a single API call
 * Eliminates the need for multiple parallel API calls and redundant data processing
 */
export function useOptimizedDashboard(dateRange: '7d' | '14d' | 'month' | '30d' | '90d' | '6m' | '1y' | 'ytd' = 'month') {
  const { isDemo } = useAppMode();
  const { getDemoStats, demoTransactions, demoPortfolio } = useDemo();


  // Demo data calculated fresh each time to ensure updates are reflected
  const getDemoData = (): OptimizedDashboardData | null => {
    if (!isDemo) return null;

    const demoTotalDebt = demoLoans
      .filter((loan) => loan.status === 'active')
      .reduce((sum, loan) => sum + Number(loan.current_balance || 0), 0);

    const demoStats = getDemoStats() as {
      life_wallet: number; portfolio_wallet: number; emergency_wallet: number;
      total_asset: number; investment_total: number;
      monthlyIncome: number; monthlyExpenses: number; savingsRate: number; portfolioChange: number;
    };

    return {
      stats: {
        // Three-wallet system demo values
        life_wallet: demoStats.life_wallet || 50000,
        portfolio_wallet: demoStats.portfolio_wallet || 120000,
        emergency_wallet: demoStats.emergency_wallet || 100000,
        total_asset: demoStats.total_asset || 270000,
        // Summed from the very fixture the loans page renders, so the two
        // cannot disagree. Hardcoding 0 here meant the same demo account owed
        // NT$3.85M on /loans and nothing on the dashboard, and the entire debt
        // half of this card — the breakdown, the debt ring, the net-worth
        // distinction — never rendered for anyone evaluating the app.
        total_debt: demoTotalDebt,
        investment_total: demoStats.investment_total || 120000,

        // Legacy fields
        totalBalance: demoStats.life_wallet + demoStats.emergency_wallet,
        monthlyIncome: demoStats.monthlyIncome,
        monthlyExpenses: demoStats.monthlyExpenses,
        netWorth: demoStats.total_asset - demoTotalDebt,
        savingsRate: demoStats.savingsRate,
        portfolioValue: demoStats.portfolio_wallet,
        portfolioGrowth: demoStats.portfolioChange,
        monthlyChange: 0,
        upcomingBills: 2,
        totalAssets: demoStats.life_wallet + demoStats.emergency_wallet + demoStats.portfolio_wallet,
      },
      recentTransactions: demoTransactions.slice(0, 5),
      portfolio: {
        totalValue: demoPortfolio.totalValue,
        totalGainLoss: demoPortfolio.totalGainLoss,
        gainLossPercentage: demoPortfolio.totalGainLossPercentage,
        holdings: demoPortfolio.holdings.map(holding => ({
          symbol: holding.symbol,
          name: holding.name,
          value: holding.totalValue,
          gainLoss: holding.gainLoss,
          gainLossPercentage: holding.gainLossPercentage,
        })),
      },
      activities: [
        {
          id: '1',
          type: 'achievement_unlocked',
          title: 'Consistent Saver Badge Earned',
          description: "You've saved money for 7 days straight!",
          timestamp: new Date('2024-01-15'),
        },
        {
          id: '2',
          type: 'streak_milestone',
          title: '7-Day Streak',
          description: "You've been active for 7 days in a row!",
          timestamp: new Date('2024-01-14'),
        },
      ],
    };
  };

  // Cache key: keep it minimal — useAuthenticatedQuery already appends
  // the auth-mode segment ('authenticated'/'demo') and user.id automatically.
  // We only add demoTransactions.length so the demo cache re-runs whenever the
  // in-memory demo transactions change.
  const cacheKey = useMemo(() => {
    const base = [QUERY_KEYS.OPTIMIZED_DASHBOARD, dateRange];
    return isDemo ? [...base, demoTransactions.length] : base;
  }, [dateRange, isDemo, demoTransactions.length]);

  return useDualModeQuery(
    cacheKey,
    async (): Promise<{ data: OptimizedDashboardData | null }> => {
      const queryTimeout = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error('Dashboard query timeout after 20 seconds'));
        }, 20000);
      });

      const result = await Promise.race([
        (async () => {
          const withTimeout = <T>(promise: Promise<T>, timeoutMs: number, name: string): Promise<T> => {
            return Promise.race([
              promise,
              new Promise<T>((_, reject) =>
                setTimeout(() => {
                  reject(new Error(`${name} timeout`));
                }, timeoutMs)
              ),
            ]);
          };

          const dashboardStatsPromise = withTimeout(
            dashboardService.getDashboardStats(dateRange),
            8000,
            'Dashboard stats'
          ).then(response => {
            if (!response?.data || typeof response.data !== 'object') {
              throw new Error('Invalid dashboard stats response structure');
            }
            return response as { data: DashboardStatsData; success: boolean; message?: string };
          });

          const portfolioPromise = withTimeout(
            portfolioService.getPortfolio(),
            15000,
            'Portfolio data'
          ).then(response => {
            if (!response?.data || typeof response.data !== 'object') {
              throw new Error('Invalid portfolio response structure');
            }
            const portfolioData = response.data as PortfolioOverviewData;
            if (!Array.isArray(portfolioData.holdings)) {
              throw new Error('Invalid portfolio holdings response structure');
            }
            portfolioData.totalValue = Number(portfolioData.totalValue) || 0;
            portfolioData.totalGainLoss = Number(portfolioData.totalGainLoss) || 0;
            portfolioData.totalGainLossPercentage = Number(portfolioData.totalGainLossPercentage) || 0;
            return { ...response, data: portfolioData };
          }).catch((): { data: PortfolioOverviewData; success: boolean; message: string } => ({
            data: { holdings: [], totalValue: 0, totalGainLoss: 0, totalGainLossPercentage: 0 },
            success: false,
            message: 'Failed to fetch portfolio data',
          }));

          type ActivityResponse = { data: unknown[]; success: boolean; message: string };
          const activityPromise: Promise<ActivityResponse> = withTimeout(
            dashboardService.getRecentActivity(5),
            5000,
            'Recent activity'
          )
            .catch((): ActivityResponse => ({
              data: [],
              success: false,
              message: 'Failed to fetch recent activity',
            }))
            .then((response): ActivityResponse => {
              if (!Array.isArray(response?.data)) {
                return { data: [], success: false, message: 'Invalid response structure' };
              }
              return { data: response.data as unknown[], success: !!response.success, message: response.message || '' };
            });

          // /dashboard/historical-trends natively supports the dashboard's
          // full period vocabulary (7d/14d/month/30d/90d/6m/1y/ytd) and
          // resolves "month" to the current calendar month — the same
          // shared date-range function /dashboard/stats uses. Pass dateRange
          // straight through so the sparkline always covers exactly the
          // selected period instead of a wider hardcoded substitute.
          const trendsPromise = withTimeout(
            dashboardService.getHistoricalTrends(dateRange),
            8000,
            'Historical trends'
          )
            .catch(() => ({
              data: { dataPoints: [] },
              success: false,
              message: 'Failed to fetch historical trends',
            }))
            .then(response => {
              if (!response?.data || typeof response.data !== 'object') {
                return {
                  data: { dataPoints: [] },
                  success: false,
                  message: 'Invalid response structure',
                };
              }
              const trendsData = response.data as { dataPoints?: unknown[] };
              if (!Array.isArray(trendsData.dataPoints)) {
                trendsData.dataPoints = [];
              }
              return response;
            });

          // NOTE: wallet trends are intentionally NOT fetched here. The dashboard
          // consumes them via the dedicated useWalletTrends() hook (staleTime: 0)
          // so transaction mutations invalidate them immediately. Fetching them
          // here too was a duplicate network call whose result was never read.
          const [dashboardStats, portfolioOverview, recentActivity, trendsData] = await Promise.all([
            dashboardStatsPromise,
            portfolioPromise,
            activityPromise,
            trendsPromise,
          ]);

          const statsData: DashboardStatsData = dashboardStats.data;
          const life_wallet = safeNumber(statsData?.life_wallet, 0);
          const portfolio_wallet = safeNumber(statsData?.portfolio_wallet, 0);
          const emergency_wallet = safeNumber(statsData?.emergency_wallet, 0);

          // Trust the backend's wallet balances. /dashboard/stats already converts
          // every holding to TWD (see _calculate_all_wallets) and reports the same
          // emergency-inclusive total the chart's wallet-trends endpoint uses.
          // A former re-bucketing workaround here predated that backend FX fix and
          // silently zeroed the emergency wallet, desyncing the header "資產" total
          // from the chart's "總資產" (off by exactly the emergency fund) — removed.
          const overviewData: PortfolioOverviewData = portfolioOverview.data;

          const total_asset = life_wallet + portfolio_wallet + emergency_wallet;
          const investment_total = portfolio_wallet;
          const total_debt = safeNumber(statsData?.total_debt, 0);
          const net_worth = total_asset - total_debt;

          const calculatedStats = {
            life_wallet,
            portfolio_wallet,
            emergency_wallet,
            total_asset,
            total_debt,
            investment_total,
            totalBalance: life_wallet,
            monthlyIncome: safeNumber(statsData?.total_income ?? statsData?.totalIncome, 0),
            monthlyExpenses: safeNumber(statsData?.total_expenses ?? statsData?.totalExpenses, 0),
            netWorth: net_worth,
            savingsRate: safeNumber(statsData?.savings_rate ?? statsData?.savingsRate, 0),
            portfolioValue: portfolio_wallet,
            portfolioGrowth: safeNumber(statsData?.investment_return ?? statsData?.investmentReturn, 0),
            monthlyChange: safeNumber(statsData?.monthly_change ?? statsData?.monthlyChange, 0),
            upcomingBills: safeNumber(statsData?.upcoming_bills ?? statsData?.upcomingBills, 0),
            totalAssets: total_asset,
          };

          const rawData = trendsData?.data as { dataPoints?: TrendDataPoint[] } | undefined;
          const rawTrendPoints: TrendDataPoint[] = Array.isArray(rawData?.dataPoints)
            ? rawData.dataPoints
            : [];

          // Build portfolio-only (non-emergency) metrics for the Investments section
          const allHoldings: RawHolding[] = Array.isArray(overviewData?.holdings)
            ? overviewData.holdings
            : [];
          const portfolioOnlyHoldings = allHoldings.filter(
            (h: RawHolding) => (h?.walletType ?? 'portfolio').toLowerCase() !== 'emergency'
          );

          const _fxRate = deriveFxRate(allHoldings, safeNumber(overviewData?.totalValue, 0));

          let portfolioGainLoss = 0;
          for (const h of portfolioOnlyHoldings) {
            const nativeGainLoss = safeNumber(h?.gainLoss, 0);
            const isTWD = (h?.currency ?? 'USD').toUpperCase() === 'TWD';
            portfolioGainLoss += isTWD ? nativeGainLoss : nativeGainLoss * _fxRate;
          }
          const portfolioCostBasis = portfolio_wallet - portfolioGainLoss;
          const portfolioGainLossPercentage = portfolioCostBasis > 0
            ? (portfolioGainLoss / portfolioCostBasis) * 100
            : 0;

          return {
            data: {
              stats: calculatedStats,
              recentTransactions: [],
              portfolio: {
                totalValue: portfolio_wallet,
                totalGainLoss: portfolioGainLoss,
                gainLossPercentage: portfolioGainLossPercentage,
                holdings: portfolioOnlyHoldings.map((h: RawHolding) => ({
                  symbol: h?.symbol || 'UNKNOWN',
                  name: h?.name || 'Unknown',
                  value: safeNumber(h?.totalValue || h?.value, 0),
                  gainLoss: safeNumber(h?.gainLoss, 0),
                  gainLossPercentage: safeNumber(h?.gainLossPercentage, 0),
                })),
              },
              activities: Array.isArray(recentActivity?.data)
                ? (recentActivity.data as Array<{ id?: string; type?: string; title?: string; description?: string; date?: string; timestamp?: string }>).map((activity) => ({
                  id: activity?.id || `activity-${Date.now()}-${Math.random()}`,
                  type: activity?.type || 'achievement_unlocked',
                  title: activity?.title || 'Activity',
                  description: activity?.description || '',
                  timestamp: new Date(activity?.date || activity?.timestamp || Date.now()),
                }))
                : [],
              trendData: rawTrendPoints,
              // Fetched separately via useWalletTrends(); kept for type compatibility.
              walletTrendData: [],
            },
          };
        })(),
        queryTimeout,
      ]);

      return result;
    },
    () => {
      const demoData = getDemoData();
      return { data: demoData ?? null };
    },
    {
      placeholderData: keepPreviousData,
      staleTime: isDemo ? 1000 : 2 * 60 * 1000,
      gcTime: isDemo ? 5 * 60 * 1000 : 30 * 60 * 1000,
      // Don't refire the whole 4-call dashboard batch (incl. the heavy
      // historical-trends recompute) every time the tab regains focus — that was
      // a major source of "random" refresh latency. staleTime (2min) + explicit
      // mutation invalidation keep the data fresh without focus-driven refetch.
      refetchOnWindowFocus: false,
      refetchOnMount: false,
      refetchInterval: false,
      retry: (failureCount, error: unknown) => {
        if ((error as { response?: { status?: number } })?.response?.status === 401) return false;
        return failureCount < 1;
      },
    }
  );
}