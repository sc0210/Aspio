'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { useAppMode } from '@/hooks/useAppMode';
import { greetingName } from '@/lib/dashboard/greetingName';
import { useOptimizedDashboard } from '@/hooks/useOptimizedDashboard';
import { useDataSynchronization, useDashboardRefresh } from '@/hooks/useDataSynchronization';
import { useWalletTrends, useWalletTrendBaseline } from '@/hooks/useWalletTrends';
import { usePriceRefreshOnLogin } from '@/hooks/usePriceRefreshOnLogin';
import { DataRefreshButton } from '@/components/ui/DataRefreshButton';
import { DashboardViewToggle } from '@/components/dashboard/DashboardViewToggle';
import { ComprehensiveDashboardSkeleton } from '@/components/ui/DashboardSkeleton';
import { MemoizedRecentTransactions } from './MemoizedComponents';
import { LazyPortfolioOverview } from './LazyCharts';

// WalletNetWorthCard directly imports recharts — lazy-load so recharts is
// NOT pulled into the initial dashboard JS bundle.
const WalletNetWorthCard = dynamic(
  () => import('./WalletNetWorthCard').then(m => ({ default: m.WalletNetWorthCard })),
  { ssr: false, loading: () => <div className="animate-pulse bg-gray-200 dark:bg-gray-700 rounded-2xl h-48" role="status" aria-label="Loading wallet card" /> }
);
// GrowthForecastCard also imports recharts — lazy-load so it stays out of the
// initial dashboard JS bundle, same as WalletNetWorthCard above.
const GrowthForecastCard = dynamic(
  () => import('./GrowthForecastCard').then(m => ({ default: m.GrowthForecastCard })),
  { ssr: false, loading: () => <div className="animate-pulse bg-gray-200 dark:bg-gray-700 rounded-2xl h-48" role="status" aria-label="Loading growth forecast" /> }
);
// PortfolioHeatmap + TransactionHeatmap import recharts (Treemap) — lazy-load to
// keep it out of the initial dashboard JS bundle, same as the cards above.
const PortfolioHeatmap = dynamic(
  () => import('./PortfolioHeatmap').then(m => ({ default: m.PortfolioHeatmap })),
  { ssr: false, loading: () => <div className="animate-pulse bg-gray-200 dark:bg-gray-700 rounded-2xl h-96" role="status" aria-label="Loading portfolio heatmap" /> }
);
const TransactionHeatmap = dynamic(
  () => import('./TransactionHeatmap').then(m => ({ default: m.TransactionHeatmap })),
  { ssr: false, loading: () => <div className="animate-pulse bg-gray-200 dark:bg-gray-700 rounded-2xl h-96" role="status" aria-label="Loading cash flow heatmap" /> }
);
import { MonthlyInsightCard } from './MonthlyInsightCard';
import { FinancialTermsHelp } from '@/components/help/FinancialTermsHelp';
import { useTranslation } from 'react-i18next';
import { useGoals } from '@/hooks/useGoals';
import { GoalsOverview } from '@/components/goals/GoalsOverview';
import dynamic from 'next/dynamic';

// Goal modals are not needed on the initial render — lazy-load them so their
// form-library code is only fetched when the user clicks Edit/Contribute.
const EditGoalModal = dynamic(
  () => import('@/components/goals/EditGoalModal').then(m => ({ default: m.EditGoalModal })),
  { ssr: false }
);
const ContributeModal = dynamic(
  () => import('@/components/goals/ContributeModal').then(m => ({ default: m.ContributeModal })),
  { ssr: false }
);
import {
  PlusIcon,
  ChartBarIcon,
  CalendarDaysIcon,
  CalendarIcon,
  ChevronDownIcon,
} from '@heroicons/react/24/outline';
import { cn } from '@/utils/cn';
import { DashboardTodayStrip } from './DashboardTodayStrip';
import { periodChange, netWorthOf } from '@/lib/dashboard/periodChange';
import { PERIOD_FALLBACKS, periodLabelKey } from '@/lib/dashboard/periodLabels';
import { Card } from '@/components/ui/Card';

const PERIOD_OPTIONS = [
  { value: '7d',    label: '7D' },
  { value: 'month', label: 'MTD' },
  { value: '30d',   label: '30D' },
  { value: '90d',   label: '90D' },
  { value: '6m',    label: '6M' },
  { value: 'ytd',   label: 'YTD' },
  { value: '1y',    label: '1Y' },
] as const;


export function ComprehensiveDashboard() {
  const { t, i18n } = useTranslation(['dashboard', 'common']);
  const { isDemo, user } = useAppMode();
  const [dateRange, setDateRange] = useState('month');

  useDataSynchronization();
  const { refreshDashboard } = useDashboardRefresh();

  const { data: goalsData = [], isLoading: goalsLoading } = useGoals();

  const [editingGoalId, setEditingGoalId] = useState<string | null>(null);
  const [contributeGoalId, setContributeGoalId] = useState<string | null>(null);
  const editingGoal    = editingGoalId    ? (goalsData.find(g => g.id === editingGoalId)    ?? null) : null;
  const contributeGoal = contributeGoalId ? (goalsData.find(g => g.id === contributeGoalId) ?? null) : null;

  usePriceRefreshOnLogin();

  const { data: dashboardData, isLoading, error, isFetching } = useOptimizedDashboard(dateRange as '7d' | 'month' | '30d' | '90d' | '6m' | '1y' | 'ytd');

  const memoizedDashboardData = useMemo(() => {
    if (!dashboardData?.data) {
      return {
        stats: {
          life_wallet:      0,
          portfolio_wallet: 0,
          emergency_wallet: 0,
          total_asset:      0,
          investment_total: 0,
          totalBalance:     0,
          monthlyIncome:    0,
          monthlyExpenses:  0,
          savingsRate:      0,
          netWorth:         0,
          portfolioValue:   0,
          portfolioGrowth:  0,
          monthlyChange:    0,
          upcomingBills:    0,
          totalAssets:      0,
        },
        recentTransactions: [],
        portfolio: {
          totalValue:        0,
          totalGainLoss:     0,
          gainLossPercentage: 0,
          holdings:          [],
        },
        activities:      [],
        trendData:       undefined,
        walletTrendData: [],
      };
    }
    return dashboardData.data;
  }, [dashboardData]);

  // Fetch wallet trends independently so transaction mutations invalidate it immediately
  // (useWalletTrends listens to 'dashboard-data-updated' events and has staleTime: 0)
  const { data: walletTrendsData = [] } = useWalletTrends(
    dateRange as '7d' | 'month' | '30d' | '90d' | '6m' | '1y' | 'ytd'
  );

  const chartData = useMemo(() => {
    if (isDemo) return undefined;
    const trendData = memoizedDashboardData.trendData;
    if (trendData && trendData.length > 0) return trendData;
    return undefined;
  }, [memoizedDashboardData, isDemo]);

  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) return t('common:greetings.goodMorning', 'Good morning');
    if (hour < 17) return t('common:greetings.goodAfternoon', 'Good afternoon');
    return t('common:greetings.goodEvening', 'Good evening');
  }, [t]);

  const todayFormatted = useMemo(() => {
    return new Date().toLocaleDateString(i18n.language, {
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    });
  }, [i18n.language]);

  // Names the window on the flow strip's column headers. This was an inline
  // English-only map, so a zh-TW dashboard read "已儲蓄 · THIS MONTH"; the
  // locale files carry these already, and MonthlyInsightCard reads them.
  const periodLabel = useMemo(
    () => t(periodLabelKey(dateRange), PERIOD_FALLBACKS[dateRange] ?? 'This Month'),
    [t, dateRange],
  );

  // Net worth is assets MINUS debt, and the two move independently — borrowing
  // raises assets and debt together and leaves net worth almost unchanged.
  //
  // This used to be `periodChange(..., 'totalAsset')` under the name
  // `netWorthChange`, so the Net Worth card showed the *asset* growth: on this
  // account +53.2% against a true +5.7%, a ninefold overstatement, on the one
  // card whose entire job is to be the number after the borrowing. The name is
  // what hid it, so it now says what it measures.
  // Where the period opened. A series of N daily points spans N-1 days, so
  // `last - first` over it alone measures a day less than the period the user
  // picked: on MTD the 1st's movement was dropped entirely, which is why this
  // strip disagreed with the P&L calendar further down the page — that one does
  // count the 1st. Prepending the opening balance makes both deltas span the
  // whole window. Falls back to the old behaviour against a payload without it.
  const { data: trendBaseline } = useWalletTrendBaseline(
    dateRange as '7d' | 'month' | '30d' | '90d' | '6m' | '1y' | 'ytd'
  );
  const trendFromOpen = useMemo(
    () => (trendBaseline ? [trendBaseline, ...walletTrendsData] : walletTrendsData),
    [trendBaseline, walletTrendsData],
  );

  const netWorthSeries = useMemo(
    () => trendFromOpen?.map((p) => ({ netWorth: netWorthOf(p) })),
    [trendFromOpen],
  );
  const netWorthChange = useMemo(
    () => periodChange(netWorthSeries, 'netWorth'),
    [netWorthSeries],
  );

  // Portfolio change over the SELECTED period, read off the same wallet-trend
  // series the hero card's net-worth delta uses.
  //
  // It used to come from portfolio.gainLossPercentage / totalGainLoss, which is
  // all-time unrealized P&L against cost basis — a figure with no period in it at
  // all. So the two tiles sat side by side on the same strip with different time
  // bases: changing the period moved the Total Assets delta and left Portfolio's
  // untouched, which reads as the dashboard ignoring the selector.
  //
  // Note this is the change in portfolio *value* over the window, so contributions
  // and withdrawals count toward it, not just market movement. That is the same
  // basis Total Assets already uses. All-time unrealized P&L is still on the
  // portfolio page, where it isn't sitting under a period selector.
  const portfolioChange = useMemo(
    () => periodChange(trendFromOpen, 'portfolioWallet'),
    [trendFromOpen],
  );

  const quickActions = useMemo(() => [
    { label: t('dashboard:quickActions.addTransaction.title', 'Add Transaction'), href: '/transactions/add', icon: PlusIcon },
    { label: t('dashboard:quickActions.portfolio.title',      'Portfolio'),        href: '/portfolio',        icon: ChartBarIcon },
    { label: t('dashboard:quickActions.review.title',         'Month in Review'),  href: '/review',           icon: CalendarDaysIcon },
  ], [t]);

  const isNewUser = !isLoading && (memoizedDashboardData.stats.total_asset === 0) && (memoizedDashboardData.recentTransactions.length === 0) && (goalsData.length === 0);

  if (isLoading && !dashboardData) {
    return (
      <DashboardLayout>
        <ComprehensiveDashboardSkeleton />
      </DashboardLayout>
    );
  }

  if (error) {
    return (
      <DashboardLayout>
        <div className="min-h-screen flex items-center justify-center">
          <div className="text-center">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">{t('common:error.title', 'Something went wrong')}</h2>
            <p className="text-gray-600 dark:text-gray-400 mb-4">{t('common:error.loadFailed', "We couldn't load your dashboard. Please try again.")}</p>
            <div className="space-y-2">
              <button onClick={refreshDashboard} className="px-4 py-2.5 min-h-[44px] bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors mr-3 touch-manipulation">
                {t('common:actions.refresh', 'Refresh Data')}
              </button>
              <button onClick={() => window.location.reload()} className="px-4 py-2.5 min-h-[44px] bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors touch-manipulation">
                {t('common:actions.reload', 'Reload Page')}
              </button>
            </div>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout topBarActions={<><DashboardViewToggle /><DataRefreshButton size="sm" showLabel={false} /></>}>
      <div className="space-y-4 sm:space-y-6 lg:space-y-8">
        {/* Demo status is already shown by the persistent global DemoBanner (top strip);
            a second in-page banner here is redundant and wastes vertical space on mobile. */}

        {/* ========== HEADER + AT A GLANCE (merged) ========== */}
        <div className="rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden animate-fade-in">
          <div className="h-px bg-gradient-to-r from-primary-400/60 via-indigo-400/60 to-violet-400/60" />
          <div className="px-4 sm:px-6 py-4 sm:py-5">
            {/* Row 1: Greeting left — Period selector right (wraps on xs to avoid truncation) */}
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-3">
              <div className="min-w-0">
                <h1 className="text-lg sm:text-xl font-bold text-gray-900 dark:text-white truncate">
                  {greeting}, {greetingName(isDemo, user, t('common:user'))}
                </h1>
                <p className="text-xs text-gray-400 dark:text-gray-500 flex items-center gap-1 mt-0.5">
                  <CalendarIcon className="w-3 h-3" />
                  {todayFormatted}
                </p>
              </div>
              {/* Period selector — full-width on mobile (own row) so all chips fit; scrolls only if it ever overflows */}
              <div className="flex items-center gap-1 flex-shrink-0 overflow-x-auto scrollbar-hide max-w-full sm:max-w-none">
                <div className="bg-gray-100 dark:bg-gray-800 rounded-xl p-1 flex gap-0.5 flex-shrink-0">
                  {PERIOD_OPTIONS.map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => setDateRange(opt.value)}
                      aria-pressed={dateRange === opt.value}
                      className={cn(
                        'px-2 py-1.5 text-xs font-semibold rounded-lg transition-all duration-200 whitespace-nowrap',
                        dateRange === opt.value
                          ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900 shadow-sm'
                          : 'text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300'
                      )}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Row 2: Quick actions + Utility buttons */}
            <div className="flex items-center justify-between gap-2">
              <div className="flex flex-wrap gap-1.5 sm:gap-2 min-w-0">
                {quickActions.map((action) => {
                  const Icon = action.icon;
                  return (
                    <Link
                      key={action.href}
                      href={action.href}
                      className="inline-flex items-center gap-1 sm:gap-1.5 px-2.5 sm:px-3 py-2 min-h-[44px] rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-primary-50 dark:hover:bg-primary-900/20 hover:text-primary-700 dark:hover:text-primary-300 font-medium text-xs border border-gray-200 dark:border-gray-700 hover:border-primary-200 dark:hover:border-primary-800 transition-all duration-150"
                    >
                      <Icon className="w-3.5 h-3.5 flex-shrink-0" />
                      <span>{action.label}</span>
                    </Link>
                  );
                })}
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <FinancialTermsHelp variant="modal" />
              </div>
            </div>
          </div>
        </div>

        {/* ========== NEW USER ONBOARDING ========== */}
        {isNewUser && (
          <section aria-label="Get Started" className="animate-fade-in-up animation-delay-150">
            <div className="rounded-2xl border border-primary-200 dark:border-primary-800/50 bg-gradient-to-br from-primary-50 to-indigo-50 dark:from-primary-900/10 dark:to-indigo-900/10 p-5">
              <h2 className="text-base font-semibold text-gray-900 dark:text-white mb-1">{t('dashboard:onboarding.title')}</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">{t('dashboard:onboarding.subtitle')}</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {([
                  { step: 1, key: 'recordIncome',   href: '/transactions/add' },
                  { step: 2, key: 'trackExpenses',  href: '/transactions/add' },
                  { step: 3, key: 'addInvestments', href: '/portfolio/add'    },
                  { step: 4, key: 'setGoal',        href: '/goals'            },
                  // The link wraps the card rather than being one: a surface is
                  // not a control, and `Card` has no business rendering an anchor.
                  // `h-full` keeps it filling the grid cell as it did before.
                ] as const).map(({ step, key, href }) => (
                  <Link key={step} href={href} className="group block">
                    <Card
                      radius="xl"
                      shadow="none"
                      padding="sm"
                      className="h-full flex flex-col gap-2 hover:border-primary-300 dark:hover:border-primary-600 hover:shadow-sm transition-all"
                    >
                    <div className="flex items-center gap-2">
                      <span className="w-6 h-6 rounded-full bg-primary-100 dark:bg-primary-900/40 text-primary-700 dark:text-primary-300 text-xs font-bold flex items-center justify-center flex-shrink-0">{step}</span>
                      <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">{t(`dashboard:onboarding.steps.${key}.title`)}</p>
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 leading-snug">{t(`dashboard:onboarding.steps.${key}.desc`)}</p>
                    <span className="mt-auto text-xs font-medium text-primary-600 dark:text-primary-400 group-hover:underline">{t(`dashboard:onboarding.steps.${key}.cta`)} &rarr;</span>
                    </Card>
                  </Link>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* ========== WALLET NET WORTH CARD ========== */}
        <section aria-label="Wallet Overview" className="animate-fade-in-up animation-delay-200">
          <WalletNetWorthCard
            stats={memoizedDashboardData.stats}
            netWorthChangePercent={netWorthChange.percent}
            netWorthChangeAmount={netWorthChange.amount}
            walletTrendsData={walletTrendsData ?? []}
            loading={isLoading}
            isPeriodSwitching={isFetching}
          />
        </section>

        {/* ========== FLOW STRIP ==========
            What moved over the selected period, under the balance it moved.
            Total assets used to lead this strip, directly above a hero card
            stating net worth — two headline balances a screen-inch apart,
            differing only by debt, with nothing to say which one the page was
            about. The hero keeps the balance; the strip keeps the flow.

            These figures do follow the period selector, unlike the balances
            above them. The portfolio delta comes from walletTrendsData so it
            shares the hero's time base — stats.portfolioGrowth is avoided
            because the backend computes it over a different holding set. */}
        <section aria-label="This period" className="animate-fade-in-up animation-delay-200">
          <DashboardTodayStrip
            netSaved={memoizedDashboardData.stats.monthlyIncome - memoizedDashboardData.stats.monthlyExpenses}
            savingsRate={memoizedDashboardData.stats.savingsRate}
            portfolioValue={memoizedDashboardData.stats.portfolio_wallet}
            portfolioChangePercent={portfolioChange.percent}
            portfolioChangeAmount={portfolioChange.amount}
            isLoading={isLoading}
            periodLabel={periodLabel}
          />
        </section>

        {/* ========== MAIN LAYOUT ========== */}
        <div className={`space-y-5 sm:space-y-6 lg:space-y-8 transition-opacity duration-300 ${isFetching ? 'opacity-60' : 'opacity-100'}`}>
          {/* Portfolio — full width (horizontal 2:1 chart/calendar inside) */}
          <section aria-label="Portfolio" className="animate-fade-in-up animation-delay-300">
            <LazyPortfolioOverview
              portfolio={memoizedDashboardData.portfolio}
              dateRange={dateRange}
            />
          </section>

          {/* Goals · Cash Flow · Recent Activity — compact horizontal row.
              items-stretch (grid's default) so all three columns match the
              tallest card's height; each card fills its cell with h-full and
              lets its own content sit at the top, leaving blank space below
              on the shorter cards instead of stretching their content. */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 sm:gap-6 lg:gap-8 items-stretch animate-fade-in-up animation-delay-300">
            <section aria-label="Financial Goals" className="h-full">
              <GoalsOverview
                goals={goalsData}
                isLoading={goalsLoading}
                onEdit={(goal) => setEditingGoalId(goal.id)}
                onContribute={(goal) => setContributeGoalId(goal.id)}
                portfolioTotalValue={memoizedDashboardData.stats.total_asset || 0}
                compact
              />
            </section>

            <section aria-label="Cash Flow" className="h-full">
              <MonthlyInsightCard
                stats={memoizedDashboardData.stats}
                dateRange={dateRange}
                trendData={chartData}
              />
            </section>

            <section aria-label="Recent Activity" className="h-full">
              <MemoizedRecentTransactions
                dateRange={dateRange}
              />
            </section>
          </div>

          {/* ========== EXPLORE ==========
              The forecast and the two heatmaps answer questions you ask
              occasionally, not questions you have on landing — and they were
              three full-width bands of chart between the wallet card and the
              things that are read every visit. Closed by default; <details>
              keeps the toggle keyboard-accessible without any state of ours.
              They still mount, so their data loads as before. */}
          <details className="group animate-fade-in-up animation-delay-300">
            <summary className="flex items-center justify-between gap-3 px-4 sm:px-5 py-3 rounded-xl border border-dashed border-gray-300 dark:border-gray-600 cursor-pointer list-none [&::-webkit-details-marker]:hidden hover:border-primary-300 dark:hover:border-primary-600 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">{t('dashboard:explore.title')}</p>
                <p className="text-xs text-gray-400 dark:text-gray-500 truncate">{t('dashboard:explore.subtitle')}</p>
              </div>
              <ChevronDownIcon className="w-5 h-5 flex-shrink-0 text-gray-400 transition-transform duration-200 group-open:rotate-180" />
            </summary>

            <div className="pt-5 sm:pt-6 space-y-5 sm:space-y-6 lg:space-y-8">
              <section aria-label="Growth Forecast">
                <GrowthForecastCard
                  stats={memoizedDashboardData.stats}
                  loading={isLoading}
                />
              </section>

              {/* Portfolio (left) + cash flow (right) side by side on wide
                  screens, stacked below lg. */}
              <section aria-label="Heatmaps">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 sm:gap-6 lg:gap-8 items-stretch">
                  <PortfolioHeatmap />
                  <TransactionHeatmap />
                </div>
              </section>
            </div>
          </details>
        </div>
      </div>

      {editingGoal && (
        <EditGoalModal
          isOpen={!!editingGoal}
          onClose={() => setEditingGoalId(null)}
          goal={editingGoal}
        />
      )}

      {contributeGoal && (
        <ContributeModal
          isOpen={!!contributeGoal}
          onClose={() => setContributeGoalId(null)}
          goalId={contributeGoal.id}
          goalTitle={contributeGoal.title}
          currentAmount={Number(contributeGoal.currentAmount)}
          targetAmount={Number(contributeGoal.targetAmount)}
          currency={contributeGoal.currency}
        />
      )}
    </DashboardLayout>
  );
}
