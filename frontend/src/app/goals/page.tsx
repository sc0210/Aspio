'use client';

import React, { useState, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useIsMobile } from '@/hooks/useMediaQuery';
import { MobileGoals } from '@/components/goals/MobileGoals';
import { useGoals, useDeleteGoal, Goal, CreateGoalData, goalProgressPercent } from '@/hooks/useGoals';
import { usePortfolio } from '@/hooks/usePortfolio';
import { AssetGoalCard } from '@/components/goals/AssetGoalCard';
import dynamic from 'next/dynamic';

const CreateGoalModal = dynamic(
  () => import('@/components/goals/CreateGoalModal').then(m => ({ default: m.CreateGoalModal })),
  { ssr: false }
);
const EditGoalModal = dynamic(
  () => import('@/components/goals/EditGoalModal').then(m => ({ default: m.EditGoalModal })),
  { ssr: false }
);
const ContributeModal = dynamic(
  () => import('@/components/goals/ContributeModal').then(m => ({ default: m.ContributeModal })),
  { ssr: false }
);
import { Button } from '@/components/ui/Button';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { TOP_BAR_PRIMARY } from '@/components/layout/topBarStyles';
import { PageHeader } from '@/components/layout/PageHeader';
import { PlusIcon } from '@heroicons/react/24/outline';
import { useAppMode } from '@/hooks/useAppMode';
import { useAssetTrackingPreferences } from '@/hooks/useAssetTrackingPreferences';
import { Trans, useTranslation } from 'react-i18next';
import { formatCurrency } from '@/utils/formatters';
import { portfolioCreditedGoal } from '@/utils/goalMatchers';
import GoalsLoading from './loading';
import { Card } from '@/components/ui/Card';

const STATUS_FILTER_KEYS = ['active', 'completed', 'paused', 'cancelled'] as const;
const CATEGORY_FILTER_KEYS = [
    'emergency_fund',
    'retirement',
    'house_down_payment',
    'education',
    'vacation',
    'car_purchase',
    'debt_payoff',
    'investment',
    'savings',
    'other',
] as const;

function DesktopGoalsPage() {
    const { t } = useTranslation(['goals', 'common']);
    const { isAuthenticated, isDemo: isDemoMode, isLoading: authLoading } = useAppMode();
    const { preferences } = useAssetTrackingPreferences();
    const router = useRouter();

    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
    const [createModalDefaults, setCreateModalDefaults] = useState<Record<string, unknown> | null>(null);
    const [returnToPortfolio, setReturnToPortfolio] = useState(false);
    const [editingGoal, setEditingGoal] = useState<Goal | null>(null);
    const [contributeGoal, setContributeGoal] = useState<{
        id: string;
        title: string;
        currentAmount: number;
        targetAmount: number;
        currency: string;
    } | null>(null);
    const [filterStatus, setFilterStatus] = useState<string | undefined>(undefined);
    const [filterCategory, setFilterCategory] = useState<string | undefined>(undefined);

    const { data: goals, isLoading } = useGoals(filterStatus, filterCategory);
    const deleteGoal = useDeleteGoal();
    const { portfolio, refetch: refetchPortfolio } = usePortfolio();
    // getPortfolio returns ApiResponse<Portfolio> so data is nested under .data
    // But if the portfolio page already populated the cache it stores Portfolio directly
    // Handle both shapes safely with type narrowing
    const portfolioTotalValue: number =
      (portfolio as { totalValue?: number } | undefined)?.totalValue ??
      (portfolio as { data?: { totalValue?: number } } | undefined)?.data?.totalValue ??
      0;

    // Check if user came from portfolio page wanting to create a retirement goal
    React.useEffect(() => {
        if (typeof window !== 'undefined') {
            const searchParams = new URLSearchParams(window.location.search);
            if (searchParams.get('create') === 'retirement') {
                // Pre-fill with retirement defaults
                const targetYear = new Date().getFullYear() + 10;
                const targetDate = `${targetYear}-12-31`;
                setCreateModalDefaults({
                    title: 'Retirement Fund',
                    category: 'retirement',
                    priority: 'high',
                    target_amount: 10000000, // 10M TWD default
                    currency: 'TWD',
                    target_date: targetDate,
                    description: 'Financial independence and retirement goal',
                });
                setReturnToPortfolio(true);
                setIsCreateModalOpen(true);
                // Clean up URL
                window.history.replaceState({}, '', '/goals');
            }
        }
    }, []);

    // Redirect if not authenticated and not in demo mode
    React.useEffect(() => {
        if (!authLoading && !isAuthenticated && !isDemoMode) {
            router.push('/');
        }
    }, [isAuthenticated, authLoading, isDemoMode, router]);

    React.useEffect(() => {
        // Fetch once on mount to get latest portfolio value for the retirement goal tracker.
        // React Query handles refetchOnWindowFocus for the portfolio query itself, so we
        // only need to respond to explicit portfolio mutation events here.
        refetchPortfolio();

        const handlePortfolioUpdated = () => refetchPortfolio();
        window.addEventListener('portfolio-updated', handlePortfolioUpdated as EventListener);
        return () => window.removeEventListener('portfolio-updated', handlePortfolioUpdated as EventListener);
    }, [refetchPortfolio]);

    const handleContribute = useCallback((goal: Goal) => {
        setContributeGoal({
            id: goal.id,
            title: goal.title,
            currentAmount: goal.currentAmount,
            targetAmount: goal.targetAmount,
            currency: goal.currency,
        });
    }, []);

    const handleEdit = useCallback((goal: Goal) => {
        setEditingGoal(goal);
    }, []);

    const handleDelete = useCallback(async (goalId: string) => {
        await deleteGoal.mutateAsync(goalId);
    }, [deleteGoal]);

    // The retirement goal is a special pinned goal connected to the portfolio tracker.
    // It cannot be deleted from this page — only edited.
    // Match on the shared heuristic, not category alone. A goal titled
    // "Retirement Fund" that kept an earlier category (e.g. house_down_payment,
    // which happens when an existing goal is renamed and retargeted) is still a
    // retirement goal. Checking `category === 'retirement'` here made the page
    // contradict itself: "No retirement goal set yet" rendered directly above a
    // goal called Retirement Fund, which then also appeared as a normal card
    // stuck at NT$0 because the portfolio override below never ran for it.
    // The goal the portfolio is credited to — one, even if several match, or
    // the portfolio would count once per matching goal.
    const retirementGoal = useMemo(() => {
        const credited = portfolioCreditedGoal(goals ?? []);
        return credited?.status === 'active' ? credited : null;
    }, [goals]);

    // For retirement goals, the DB current_amount is always $0 — real progress is the portfolio total value
    const retirementEffectiveCurrent = useMemo(
        () => retirementGoal ? Math.max(Number(retirementGoal.currentAmount), portfolioTotalValue) : 0,
        [retirementGoal, portfolioTotalValue]
    );

    // Progress percentage — computed once, used for both the label and the bar width
    const retirementProgressPct = useMemo(() => {
        if (!retirementGoal) return 0;
        const target = Number(retirementGoal.targetAmount);
        return target > 0 ? Math.min(100, (retirementEffectiveCurrent / target) * 100) : 0;
    }, [retirementGoal, retirementEffectiveCurrent]);

    // Every active goal but the pinned one, so it never renders twice. A second
    // retirement-looking goal is listed here on its own saved amount.
    const activeGoals = useMemo(
        () => goals?.filter((g) => g.status === 'active' && g.id !== retirementGoal?.id) || [],
        [goals, retirementGoal]
    );
    const completedGoals = useMemo(
        () => goals?.filter((g) => g.status === 'completed') || [],
        [goals]
    );
    const otherGoals = useMemo(
        () => goals?.filter((g) => !['active', 'completed'].includes(g.status)) || [],
        [goals]
    );

    const atRiskGoals = useMemo(() => {
        const now = Date.now();
        const alertWindowMs = preferences.goalAlertDays * 24 * 60 * 60 * 1000;
        return activeGoals.filter((goal) => {
            if (!goal.targetDate) {
                return goalProgressPercent(goal) < 35;
            }

            const targetMs = new Date(goal.targetDate).getTime();
            const inAlertWindow = targetMs - now <= alertWindowMs;
            return inAlertWindow && goalProgressPercent(goal) < 70;
        });
    }, [activeGoals, preferences.goalAlertDays]);

    const monthlyRequiredContribution = useMemo(() => {
        const now = Date.now();
        return activeGoals.reduce((sum, goal) => {
            const remaining = Math.max(0, Number(goal.targetAmount) - Number(goal.currentAmount));
            if (!goal.targetDate) {
                return sum + remaining / 12;
            }

            const monthsLeft = Math.max(1, Math.ceil((new Date(goal.targetDate).getTime() - now) / (30 * 24 * 60 * 60 * 1000)));
            return sum + remaining / monthsLeft;
        }, 0);
    }, [activeGoals]);

    const atRiskGoalIds = useMemo(() => new Set(atRiskGoals.map((g) => g.id)), [atRiskGoals]);

    const getMonthlyNeeded = useCallback((goal: Goal): number => {
        const remaining = Math.max(0, Number(goal.targetAmount) - Number(goal.currentAmount));
        if (!goal.targetDate) return remaining / 12;
        const monthsLeft = Math.max(1, Math.ceil(
            (new Date(goal.targetDate).getTime() - Date.now()) / (30 * 24 * 60 * 60 * 1000)
        ));
        return remaining / monthsLeft;
    }, []);

    const activeCoverageRatio = useMemo(() => {
        const activeTargetTotal = activeGoals.reduce((sum, goal) => sum + Number(goal.targetAmount), 0);
        const activeCurrentTotal = activeGoals.reduce((sum, goal) => sum + Number(goal.currentAmount), 0);
        if (activeTargetTotal <= 0) {
            return 0;
        }
        return (activeCurrentTotal / activeTargetTotal) * 100;
    }, [activeGoals]);

    if (authLoading && !isDemoMode) {
        return (
            <DashboardLayout>
                <div className="flex items-center justify-center h-64">
                    <LoadingSpinner size="lg" />
                </div>
            </DashboardLayout>
        );
    }

    if (!isAuthenticated && !isDemoMode) {
        return null;
    }

    return (
        <DashboardLayout topBarActions={
            <button
                onClick={() => setIsCreateModalOpen(true)}
                className={TOP_BAR_PRIMARY}
            >
                <PlusIcon className="w-4 h-4" />
                {t('goals:create')}
            </button>
        }>
            <div className="space-y-6">
                {/* Header — mobile only */}
                <PageHeader
                    title={t('goals:title')}
                    subtitle={t('goals:subtitle')}
                    accent="indigo"
                    actions={
                        <Button
                            variant="primary"
                            size="sm"
                            className="gap-1.5"
                            onClick={() => setIsCreateModalOpen(true)}
                        >
                            <PlusIcon className="w-4 h-4 flex-shrink-0" />
                            <span>{t('goals:create')}</span>
                        </Button>
                    }
                />

                {/* ── Portfolio-Linked Retirement Goal ─────────────────────────── */}
                {!isLoading && (
                    <div className="rounded-xl border border-primary-200 dark:border-primary-800/40 bg-gradient-to-br from-primary-50 via-white to-primary-50/40 dark:from-primary-900/20 dark:via-indigo-900/20 dark:to-primary-900/10 overflow-hidden shadow-sm">
                        {/* Header bar */}
                        <div className="flex items-center justify-between px-4 py-3 border-b border-primary-200 dark:border-primary-700/40 bg-primary-50 dark:bg-primary-900/20 gap-2">
                            <div className="flex items-center gap-2 min-w-0 flex-wrap">
                                <span className="text-base flex-shrink-0">🌳</span>
                                <span className="text-xs sm:text-sm font-semibold text-primary-800 dark:text-primary-200 flex-shrink-0">{t('goals:tracker.title')}</span>
                                <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary-100 dark:bg-primary-500/20 border border-primary-300 dark:border-primary-400/30 text-primary-700 dark:text-primary-300 text-xs font-medium flex-shrink-0">
                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                                    </svg>
                                    {t('goals:overview.portfolioLinked')}
                                </span>
                            </div>
                            <a
                                href="/portfolio"
                                className="text-xs font-medium text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 transition-colors flex items-center gap-1 flex-shrink-0"
                            >
                                <span className="hidden sm:inline">{t('goals:tracker.viewInPortfolio')}</span>
                                <span className="sm:hidden">{t('goals:tracker.portfolioShort')}</span>
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                </svg>
                            </a>
                        </div>

                        {retirementGoal ? (
                            /* Goal is set — show details */
                            <div className="p-5">
                                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 mb-1">
                                            <h3 className="text-lg font-bold text-gray-900 dark:text-white truncate">{retirementGoal.title}</h3>
                                            <span className="shrink-0 inline-flex px-2 py-0.5 rounded-full text-xs font-semibold bg-primary-100 dark:bg-primary-500/20 text-primary-700 dark:text-primary-300 border border-primary-300 dark:border-primary-400/20">
                                                {t('goals:categories.retirement')}
                                            </span>
                                        </div>
                                        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                                            <Trans
                                                i18nKey={retirementGoal.targetDate ? 'goals:tracker.targetBy' : 'goals:tracker.target'}
                                                values={{
                                                    amount: formatCurrency(retirementGoal.targetAmount, retirementGoal.currency, { precision: 0 }),
                                                    year: retirementGoal.targetDate ? new Date(retirementGoal.targetDate).getFullYear() : '',
                                                }}
                                                components={{ b: <span className="font-semibold text-gray-900 dark:text-white" /> }}
                                            />
                                        </p>

                                        {/* Progress bar */}
                                        <div className="space-y-1.5">
                                            <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400">
                                                <span>{t('goals:progress.title')}</span>
                                                <span className="font-semibold text-primary-700 dark:text-primary-300">
                                                    {retirementProgressPct.toFixed(1)}%
                                                </span>
                                            </div>
                                            <div
                                                role="progressbar"
                                                aria-valuenow={Math.round(retirementProgressPct)}
                                                aria-valuemin={0}
                                                aria-valuemax={100}
                                                aria-label={t('goals:tracker.progressAria', { percent: retirementProgressPct.toFixed(1) })}
                                                className="h-2 bg-gray-200 dark:bg-gray-700/60 rounded-full overflow-hidden"
                                            >
                                                <div
                                                    aria-hidden="true"
                                                    className="h-full rounded-full bg-gradient-to-r from-primary-500 to-primary-600 transition-all duration-500"
                                                    style={{ width: `${retirementProgressPct}%` }}
                                                />
                                            </div>
                                            <div className="flex justify-between text-xs text-gray-500">
                                                <span>{formatCurrency(retirementEffectiveCurrent, retirementGoal.currency, { precision: 0 })}</span>
                                                <span>{formatCurrency(retirementGoal.targetAmount, retirementGoal.currency, { precision: 0 })}</span>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Edit button — no delete allowed */}
                                    <div className="shrink-0">
                                        <button
                                            onClick={() => handleEdit(retirementGoal)}
                                            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium transition-colors border border-primary-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-1"
                                        >
                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                            </svg>
                                            {t('goals:edit')}
                                        </button>
                                    </div>
                                </div>

                                <p className="mt-3 text-xs text-gray-500">
                                    {t('goals:tracker.pinnedNote')}
                                </p>
                            </div>
                        ) : (
                            /* No retirement goal yet — CTA */
                            <div className="p-4 sm:p-5 flex flex-col gap-3">
                                <div>
                                    <p className="text-sm font-semibold text-gray-900 dark:text-white mb-1">{t('goals:overview.noRetirementGoal')}</p>
                                    <p className="text-xs text-gray-500 dark:text-gray-400">{t('goals:tracker.emptyDesc')}</p>
                                </div>
                                <button
                                    onClick={() => {
                                        const targetYear = new Date().getFullYear() + 10;
                                        setCreateModalDefaults({
                                            title: 'Retirement Fund',
                                            category: 'retirement',
                                            priority: 'high',
                                            target_amount: 10000000,
                                            currency: 'TWD',
                                            target_date: `${targetYear}-12-31`,
                                            description: 'Financial independence and retirement goal',
                                        });
                                        setIsCreateModalOpen(true);
                                    }}
                                    className="self-start inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium transition-colors border border-primary-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-1 min-h-[44px]"
                                >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                    </svg>
                                    {t('goals:tracker.setGoal')}
                                </button>
                            </div>
                        )}
                    </div>
                )}

                {/* Filters */}
                <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:gap-3 bg-white dark:bg-gray-800 p-3 sm:p-4 rounded-lg border border-gray-200 dark:border-gray-700">
                    <select
                        aria-label={t('goals:filters.statusLabel')}
                        value={filterStatus || ''}
                        onChange={(e) => setFilterStatus(e.target.value || undefined)}
                        className="w-full sm:w-auto px-3 sm:px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:border-transparent text-sm min-h-[44px]"
                    >
                        <option value="">{t('goals:filters.allStatuses')}</option>
                        {STATUS_FILTER_KEYS.map((key) => (
                            <option key={key} value={key}>
                                {t(`goals:status.${key}` as const)}
                            </option>
                        ))}
                    </select>

                    <select
                        aria-label={t('goals:filters.categoryLabel')}
                        value={filterCategory || ''}
                        onChange={(e) => setFilterCategory(e.target.value || undefined)}
                        className="w-full sm:w-auto px-3 sm:px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:border-transparent text-sm min-h-[44px]"
                    >
                        <option value="">{t('goals:filters.allCategories')}</option>
                        {CATEGORY_FILTER_KEYS.map((key) => (
                            <option key={key} value={key}>
                                {t(`goals:categories.${key}` as const)}
                            </option>
                        ))}
                    </select>
                </div>

                {/* Goal Health Insights */}
                {!isLoading && goals && goals.length > 0 && (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <Card padding="none" clip>
                            <div className="h-px bg-gradient-to-r from-indigo-400/60 via-purple-400/60 to-violet-400/60" />
                            <div className="p-4">
                                <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">{t('goals:insights.coverage.title')}</p>
                                <p className="text-2xl font-bold text-gray-900 dark:text-white">{activeCoverageRatio.toFixed(1)}%</p>
                                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{t('goals:insights.coverage.desc')}</p>
                            </div>
                        </Card>

                        <Card padding="none" clip>
                            <div className="h-px bg-gradient-to-r from-error-400/60 via-error-500/60 to-warning-400/60" />
                            <div className="p-4">
                                <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">{t('goals:insights.atRisk.title')}</p>
                                <p className="text-2xl font-bold text-gray-900 dark:text-white">{atRiskGoals.length}</p>
                                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{t('goals:insights.atRisk.desc', { days: preferences.goalAlertDays })}</p>
                            </div>
                        </Card>

                        <Card padding="none" clip>
                            <div className="h-px bg-gradient-to-r from-prosperity-400/60 via-prosperity-500/60 to-prosperity-400/60" />
                            <div className="p-4">
                                <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">{t('goals:insights.monthly.title')}</p>
                                <p className="text-2xl font-bold text-gray-900 dark:text-white">
                                    {formatCurrency(monthlyRequiredContribution, retirementGoal?.currency || activeGoals[0]?.currency || 'TWD', { precision: 0 })}
                                </p>
                                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{t('goals:insights.monthly.desc')}</p>
                            </div>
                        </Card>
                    </div>
                )}

                {/* Loading State */}
                {isLoading && (
                    <div className="flex justify-center items-center py-20">
                        <LoadingSpinner size="lg" />
                    </div>
                )}

                {/* Empty State */}
                {!isLoading && goals?.length === 0 && (
                    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6 sm:p-12 text-center">
                        <div className="max-w-md mx-auto">
                            <div className="w-12 h-12 sm:w-16 sm:h-16 mx-auto mb-3 sm:mb-4 rounded-full bg-primary-100 dark:bg-primary-900/20 flex items-center justify-center">
                                <svg className="w-6 h-6 sm:w-8 sm:h-8 text-primary-600 dark:text-primary-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                            </div>
                            <h3 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-white mb-2">
                                {t('goals:empty.title')}
                            </h3>
                            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4 sm:mb-6">
                                {t('goals:empty.subtitle')}
                            </p>
                            <button
                                onClick={() => setIsCreateModalOpen(true)}
                                className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary-600 hover:bg-primary-700 text-white font-medium rounded-lg transition-colors shadow-sm w-full sm:w-auto justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
                            >
                                <PlusIcon className="w-4 h-4 sm:w-5 sm:h-5" />
                                {t('goals:createFirst')}
                            </button>
                        </div>
                    </div>
                )}

                {/* Active Goals */}
                {!isLoading && activeGoals.length > 0 && (
                    <div>
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
                                {t('goals:sections.activeGoals')}
                            </h2>
                            <div className="flex items-center gap-3">
                                <span className="text-sm text-gray-600 dark:text-gray-400">
                                    {activeGoals.length} {t(activeGoals.length === 1 ? 'goals:stats.goal' : 'goals:stats.goals')}
                                </span>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {activeGoals.map((goal) => (
                                <AssetGoalCard
                                    key={goal.id}
                                    title={goal.title}
                                    currentAmount={goal.currentAmount}
                                    targetAmount={goal.targetAmount}
                                    currency={goal.currency}
                                    targetDate={goal.targetDate ? new Date(goal.targetDate) : undefined}
                                    category={goal.category}
                                    priority={goal.priority}
                                    isAtRisk={atRiskGoalIds.has(goal.id)}
                                    monthlyNeeded={getMonthlyNeeded(goal)}
                                    onContribute={() => handleContribute(goal)}
                                    onEdit={() => handleEdit(goal)}
                                    onDelete={() => handleDelete(goal.id)}
                                />
                            ))}
                        </div>
                    </div>
                )}

                {/* Completed Goals */}
                {!isLoading && completedGoals.length > 0 && (
                    <div>
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
                                {t('goals:sections.completedGoals')}
                            </h2>
                            <span className="text-sm text-gray-600 dark:text-gray-400">
                                {completedGoals.length} {t(completedGoals.length === 1 ? 'goals:stats.goal' : 'goals:stats.goals')}
                            </span>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {completedGoals.map((goal) => (
                                <AssetGoalCard
                                    key={goal.id}
                                    title={goal.title}
                                    currentAmount={goal.currentAmount}
                                    targetAmount={goal.targetAmount}
                                    currency={goal.currency}
                                    targetDate={goal.targetDate ? new Date(goal.targetDate) : undefined}
                                    category={goal.category}
                                    priority={goal.priority}
                                    onEdit={() => handleEdit(goal)}
                                    onDelete={() => handleDelete(goal.id)}
                                />
                            ))}
                        </div>
                    </div>
                )}

                {/* Other Goals */}
                {!isLoading && otherGoals.length > 0 && (
                    <div>
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
                                {t('goals:sections.otherGoals')}
                            </h2>
                            <span className="text-sm text-gray-600 dark:text-gray-400">
                                {otherGoals.length} {t(otherGoals.length === 1 ? 'goals:stats.goal' : 'goals:stats.goals')}
                            </span>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {otherGoals.map((goal) => (
                                <AssetGoalCard
                                    key={goal.id}
                                    title={goal.title}
                                    currentAmount={goal.currentAmount}
                                    targetAmount={goal.targetAmount}
                                    currency={goal.currency}
                                    targetDate={goal.targetDate ? new Date(goal.targetDate) : undefined}
                                    category={goal.category}
                                    priority={goal.priority}
                                    isAtRisk={atRiskGoalIds.has(goal.id)}
                                    monthlyNeeded={getMonthlyNeeded(goal)}
                                    onEdit={() => handleEdit(goal)}
                                    onDelete={() => handleDelete(goal.id)}
                                />
                            ))}
                        </div>
                    </div>
                )}

                {/* Modals */}
                <CreateGoalModal
                    isOpen={isCreateModalOpen}
                    onClose={() => {
                        setIsCreateModalOpen(false);
                        setCreateModalDefaults(null);
                        setReturnToPortfolio(false);
                    }}
                    defaults={createModalDefaults as Partial<CreateGoalData> | undefined}
                    returnToPortfolio={returnToPortfolio}
                />

                {editingGoal && (
                    <EditGoalModal
                        isOpen={!!editingGoal}
                        onClose={() => setEditingGoal(null)}
                        goal={editingGoal}
                    />
                )}

                {contributeGoal && (
                    <ContributeModal
                        isOpen={!!contributeGoal}
                        onClose={() => setContributeGoal(null)}
                        goalId={contributeGoal.id}
                        goalTitle={contributeGoal.title}
                        currentAmount={contributeGoal.currentAmount}
                        targetAmount={contributeGoal.targetAmount}
                        currency={contributeGoal.currency}
                    />
                )}
            </div>
        </DashboardLayout>
    );
}

/**
 * Breakpoint switch: phones (< md) get the focused MobileGoals (primary-goal
 * ring hero + compact goal cards); tablet/desktop get the full page with its
 * create/edit/contribute modals. The switch is a thin wrapper so the desktop
 * page's heavy hooks & dynamic modals never load on mobile. `isMobile` is null
 * until resolved; show the route skeleton then, so the page keeps its
 * dimensions instead of blanking for a frame.
 */
export default function GoalsPage() {
    const isMobile = useIsMobile();
    if (isMobile === null) return <GoalsLoading />;
    return isMobile ? <MobileGoals /> : <DesktopGoalsPage />;
}
