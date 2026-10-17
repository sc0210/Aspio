'use client';

import { useState, useMemo, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { ArrowLeftIcon } from '@heroicons/react/24/outline';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { TOP_BAR_BUTTON, TOP_BAR_SELECT } from '@/components/layout/topBarStyles';
import { PageHeader } from '@/components/layout/PageHeader';
import { apiClient } from '@/lib/api-client';
import { getDemoMonthlySummaries } from '@/data/demoData';
import { useAppMode, useModeAwareUI } from '@/hooks/useAppMode';
import { useTranslation } from 'react-i18next';
import { usePrivacy } from '@/contexts/PrivacyContext';
import toast from 'react-hot-toast';
import { cn } from '@/utils/cn';
import { formatTWD } from '@/utils/formatters';
import { formatMonth, formatMonthShort } from '@/utils/monthFormat';
import dynamic from 'next/dynamic';
import { Card } from '@/components/ui/Card';
import { MobileMonthlySummary } from '@/components/transactions/MobileMonthlySummary';
import { SUMMARY_BUCKETS, spendingOf, type MonthlySummaryRow } from '@/components/transactions/monthlySummaryBuckets';
import { useIsMobile } from '@/hooks/useMediaQuery';

// MonthlySummaryCharts directly imports recharts — lazy-load so recharts is
// not pulled into the monthly-summary initial JS bundle.
const MonthlySummaryCharts = dynamic(
    () => import('@/components/transactions/MonthlySummaryCharts').then(m => ({ default: m.MonthlySummaryCharts })),
    {
        ssr: false,
        loading: () => (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                <div className="lg:col-span-2 animate-pulse bg-gray-200 dark:bg-gray-700 rounded-2xl h-80" role="status" aria-label="Loading chart" />
                <div className="animate-pulse bg-gray-200 dark:bg-gray-700 rounded-2xl h-80" aria-hidden="true" />
            </div>
        ),
    }
);

type MonthlySummary = MonthlySummaryRow;

const PIE_CATEGORIES = SUMMARY_BUCKETS;


export default function MonthlySummaryPage() {
    const { t } = useTranslation(['common', 'transactions']);
    const { user, isAuthenticated } = useAppMode();
    const { getModeIndicator, isDemo } = useModeAwareUI();
    const { isValueVisible } = usePrivacy();
    const isMobile = useIsMobile();
    const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
    const [showBarChart, setShowBarChart] = useState(true);
    const [showLineChart, setShowLineChart] = useState(false);

    const { data: monthlySummaries, isLoading, error } = useQuery<MonthlySummary[]>({
        queryKey: ['monthly-summary', selectedYear, user?.id],
        queryFn: async () => {
            if (isDemo) return getDemoMonthlySummaries(selectedYear);
            const response = await apiClient.get<MonthlySummary[]>(
                `/transactions/monthly-summary?year=${selectedYear}`
            );
            return Array.isArray(response.data) ? response.data : (response.data || []);
        },
        enabled: isAuthenticated || isDemo,
        staleTime: 60_000,
        refetchOnMount: true,
        retry: isDemo ? false : 1,
    });

    useEffect(() => {
        if (error) toast.error(t('transactions:toast.monthlySummaryFailed'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [error]);

    const completeYearlyFinancials = useMemo(() => {
        // Spending, not every outflow: the table has no Transfer column, so a move to
        // Emergency counted here was spending nobody could find (see spendingOf).
        const expenses = monthlySummaries?.reduce((sum, m) => sum + spendingOf(m), 0) ?? 0;
        const moved = monthlySummaries?.reduce((sum, m) => sum + (m.transfer || 0), 0) ?? 0;
        const income = monthlySummaries?.reduce((sum, m) => sum + (m.income || 0), 0) ?? 0;
        return { income, expenses, moved, remaining: income - expenses };
    }, [monthlySummaries]);

    const yearlyTotals = useMemo(() => {
        if (!monthlySummaries) return { housing: 0, eat: 0, investment: 0, transfer: 0, debt: 0, others: 0, total: 0 };
        return monthlySummaries.reduce(
            (acc, month) => ({
                housing: acc.housing + month.housing,
                eat: acc.eat + month.eat,
                investment: acc.investment + (month.investment || 0),
                transfer: acc.transfer + (month.transfer || 0),
                debt: acc.debt + (month.debt || 0),
                others: acc.others + month.others,
                total: acc.total + month.total,
            }),
            { housing: 0, eat: 0, investment: 0, transfer: 0, debt: 0, others: 0, total: 0 }
        );
    }, [monthlySummaries]);

    const chartData = useMemo(() => {
        if (!monthlySummaries) return [];
        return monthlySummaries.map(month => ({
            month: formatMonthShort(month.month),
            Housing: month.housing,
            Eat: month.eat,
            Investment: month.investment || 0,
            Transfer: month.transfer || 0,
            Debt: month.debt || 0,
            Others: month.others,
            Total: month.total,
            Income: month.income || 0,
        }));
    }, [monthlySummaries]);

    const yearOptions = useMemo(() => {
        const currentYear = new Date().getFullYear();
        return Array.from({ length: 5 }, (_, i) => currentYear - i);
    }, []);

    const handleBarToggle = () => {
        if (showBarChart && !showLineChart) return;
        setShowBarChart(!showBarChart);
    };

    const handleLineToggle = () => {
        if (showLineChart && !showBarChart) return;
        setShowLineChart(!showLineChart);
    };

    const topBarActions = (
        <div className="flex items-center gap-2">
            <select
                aria-label={t('transactions:fields.year', 'Year')}
                value={selectedYear}
                onChange={(e) => setSelectedYear(Number(e.target.value))}
                className={TOP_BAR_SELECT}
            >
                {yearOptions.map((year) => (
                    <option key={year} value={year}>{year}</option>
                ))}
            </select>
            <Link
                href="/transactions"
                className={TOP_BAR_BUTTON}
            >
                <ArrowLeftIcon className="w-4 h-4" />
                {t('transactions:monthlySummaryPage.back', 'Back')}
            </Link>
        </div>
    );

    // `isMobile` is null until resolved: keep the spinner rather than flash desktop.
    if (isLoading || isMobile === null) {
        return (
            <DashboardLayout topBarActions={topBarActions}>
                <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
                    <LoadingSpinner size="lg" />
                    <p className="text-sm text-gray-500 dark:text-gray-400 animate-pulse">
                        {t('transactions:monthlySummaryPage.loading', 'Loading monthly summary...')}
                    </p>
                </div>
            </DashboardLayout>
        );
    }

    if (isMobile) {
        return (
            <MobileMonthlySummary
                year={selectedYear}
                yearOptions={yearOptions}
                onYearChange={setSelectedYear}
                months={monthlySummaries ?? []}
                income={completeYearlyFinancials.income}
                expenses={completeYearlyFinancials.expenses}
                totals={yearlyTotals}
            />
        );
    }

    const pieData = PIE_CATEGORIES
        .filter(c => yearlyTotals[c.key] > 0)
        .map(c => ({ name: c.name, value: yearlyTotals[c.key], color: c.color }));

    return (
        <DashboardLayout topBarActions={topBarActions}>
            <div className="space-y-6 pb-8">
                {/* Header */}
                <PageHeader
                    title={t('transactions:monthlySummaryPage.title', 'Monthly Summary')}
                    subtitle={t('transactions:monthlySummaryPage.subtitle', 'Track your spending patterns and budget allocation')}
                    accent="prosperity"
                    backHref="/transactions"
                    backLabel={t('transactions:monthlySummaryPage.back', 'Back')}
                    actions={
                        <>
                            <span className={`px-3 py-1.5 text-xs font-bold rounded-lg shadow-sm ${getModeIndicator().className}`}>
                                {getModeIndicator().text}
                            </span>
                            <select
                                aria-label={t('transactions:fields.year', 'Year')}
                                value={selectedYear}
                                onChange={(e) => setSelectedYear(Number(e.target.value))}
                                className="px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:border-primary-500 transition-all text-sm font-medium shadow-sm hover:shadow-md cursor-pointer"
                            >
                                {yearOptions.map((year) => (
                                    <option key={year} value={year}>{year}</option>
                                ))}
                            </select>
                        </>
                    }
                />

                {/* Financial Summary Cards */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 animate-fade-in-up">
                    <div className="group relative bg-gradient-to-br from-income-50 to-white dark:from-income-900/10 dark:to-gray-800 rounded-xl p-4 shadow-sm hover:shadow-md border border-income-100 dark:border-income-800/30 transition-shadow duration-300">
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-2xl" aria-hidden="true">💰</span>
                            <div className="px-2.5 py-0.5 bg-income-100 dark:bg-income-900/30 rounded-full text-xs font-semibold text-income-700 dark:text-income-400">
                                {t('transactions:monthlySummaryPage.income', 'Income')}
                            </div>
                        </div>
                        <div className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">
                            {t('transactions:monthlySummaryPage.totalIncome', 'Total Income {{year}}', { year: selectedYear })}
                        </div>
                        <div className="text-2xl font-bold text-income-600 dark:text-income-400 tabular-nums truncate">
                            {isValueVisible ? formatTWD(completeYearlyFinancials.income) : '•••••'}
                        </div>
                    </div>

                    <div className="group relative bg-gradient-to-br from-expense-50 to-white dark:from-expense-900/10 dark:to-gray-800 rounded-xl p-4 shadow-sm hover:shadow-md border border-expense-100 dark:border-expense-800/30 transition-shadow duration-300">
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-2xl" aria-hidden="true">💸</span>
                            <div className="px-2.5 py-0.5 bg-expense-100 dark:bg-expense-900/30 rounded-full text-xs font-semibold text-expense-700 dark:text-expense-400">
                                {t('transactions:monthlySummaryPage.expenses', 'Expenses')}
                            </div>
                        </div>
                        <div className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">
                            {t('transactions:monthlySummaryPage.totalExpenses', 'Total Expenses {{year}}', { year: selectedYear })}
                        </div>
                        <div className="text-2xl font-bold text-expense-600 dark:text-expense-400 tabular-nums truncate">
                            {isValueVisible ? formatTWD(completeYearlyFinancials.expenses) : '•••••'}
                        </div>
                        {completeYearlyFinancials.moved > 0 && (
                            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                                {t('transactions:monthlySummaryPage.movedBetweenWallets', 'Moved between your wallets: {{amount}} (not spending)', {
                                    amount: isValueVisible ? formatTWD(completeYearlyFinancials.moved) : '•••••',
                                })}
                            </p>
                        )}
                    </div>

                    <div className="group relative bg-gradient-to-br from-prosperity-50 to-white dark:from-prosperity-900/10 dark:to-gray-800 rounded-xl p-4 shadow-sm hover:shadow-md border border-prosperity-100 dark:border-prosperity-800/30 transition-shadow duration-300">
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-2xl" aria-hidden="true">📈</span>
                            <div className="px-2.5 py-0.5 bg-prosperity-100 dark:bg-prosperity-900/30 rounded-full text-xs font-semibold text-prosperity-700 dark:text-prosperity-400">
                                {t('transactions:monthlySummaryPage.invested', 'Invested')}
                            </div>
                        </div>
                        <div className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">
                            {t('transactions:monthlySummaryPage.totalInvested', 'Total Invested {{year}}', { year: selectedYear })}
                        </div>
                        <div className="text-2xl font-bold text-prosperity-600 dark:text-prosperity-400 tabular-nums truncate">
                            {isValueVisible ? formatTWD(yearlyTotals.investment) : '•••••'}
                        </div>
                    </div>

                    <div className={cn(
                        "group relative rounded-xl p-4 shadow-sm hover:shadow-md border transition-shadow duration-300",
                        completeYearlyFinancials.remaining >= 0
                            ? "bg-gradient-to-br from-primary-50 to-white dark:from-primary-900/10 dark:to-gray-800 border-primary-100 dark:border-primary-800/30"
                            : "bg-gradient-to-br from-warning-50 to-white dark:from-warning-900/10 dark:to-gray-800 border-warning-100 dark:border-warning-800/30"
                    )}>
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-2xl" aria-hidden="true">{completeYearlyFinancials.remaining >= 0 ? '💵' : '⚠️'}</span>
                            <div className={cn(
                                "px-2.5 py-0.5 rounded-full text-xs font-semibold",
                                completeYearlyFinancials.remaining >= 0
                                    ? "bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-400"
                                    : "bg-warning-100 dark:bg-warning-900/30 text-warning-700 dark:text-warning-400"
                            )}>
                                {completeYearlyFinancials.remaining >= 0
                                    ? t('transactions:monthlySummaryPage.surplus', 'Surplus')
                                    : t('transactions:monthlySummaryPage.deficit', 'Deficit')}
                            </div>
                        </div>
                        <div className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">
                            {t('transactions:monthlySummaryPage.netRemaining', 'Net Remaining {{year}}', { year: selectedYear })}
                        </div>
                        <div className={cn(
                            "text-2xl font-bold tabular-nums truncate",
                            completeYearlyFinancials.remaining >= 0
                                ? "text-primary-600 dark:text-primary-400"
                                : "text-warning-600 dark:text-warning-400"
                        )}>
                            {isValueVisible ? formatTWD(completeYearlyFinancials.remaining) : '•••••'}
                        </div>
                    </div>
                </div>

                {/* Chart and Category Breakdown Row — lazy-loaded to defer recharts */}
                <MonthlySummaryCharts
                    chartData={chartData}
                    pieData={pieData}
                    yearlyTotals={yearlyTotals}
                    showBarChart={showBarChart}
                    showLineChart={showLineChart}
                    onBarToggle={handleBarToggle}
                    onLineToggle={handleLineToggle}
                    chartTitle={t('transactions:monthlySummaryPage.chartTitle', 'Income & Expense Trends')}
                    chartSubtitle={t('transactions:monthlySummaryPage.chartSubtitle', 'Track your income and expenses over time')}
                    categoryBreakdownTitle={t('transactions:monthlySummaryPage.categoryBreakdown', 'Category Breakdown')}
                    categoryBreakdownSubtitle={t('transactions:monthlySummaryPage.categoryBreakdownSubtitle', 'Visualize your spending by category')}
                />

                {/* Monthly Summary Table */}
                <Card padding="none" radius="xl" clip className="relative animate-fade-in-up animation-delay-300">
                    <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-primary-500 to-prosperity-500"></div>
                    <div className="px-6 py-5 bg-gradient-to-br from-gray-50/50 to-white dark:from-gray-900/50 dark:to-gray-800 border-b border-gray-200 dark:border-gray-700">
                        <h2 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
                            <span className="text-2xl">📋</span>
                            {t('transactions:monthlySummaryPage.monthlyBreakdown', 'Monthly Breakdown')}
                        </h2>
                        <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                            {t('transactions:monthlySummaryPage.monthlyBreakdownSubtitle', 'Detailed view with percentages per category')}
                        </p>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <caption className="sr-only">
                                {t('transactions:monthlySummaryPage.monthlyBreakdown', 'Monthly Breakdown')}
                            </caption>
                            <thead>
                                <tr className="bg-gradient-to-r from-gray-100 to-gray-50 dark:from-gray-700 dark:to-gray-800 border-b-2 border-gray-200 dark:border-gray-600">
                                    <th scope="col" className="sticky left-0 z-10 bg-gray-100 dark:bg-gray-700 px-3 sm:px-6 py-3 text-left text-sm font-bold text-gray-900 dark:text-white uppercase tracking-wide">
                                        {t('transactions:monthlySummaryPage.monthHeader', 'Month')}
                                    </th>
                                    <th scope="col" className="px-3 sm:px-6 py-3 text-right text-sm font-bold text-income-700 dark:text-income-400 uppercase tracking-wide">
                                        <span aria-hidden="true">💰</span> {t('transactions:monthlySummaryPage.income', 'Income')}
                                    </th>
                                    <th scope="col" className="px-3 sm:px-6 py-3 text-right text-sm font-bold text-blue-700 dark:text-blue-400 uppercase tracking-wide">
                                        <span aria-hidden="true">🏠</span> {t('transactions:monthlySummaryPage.housing', 'Housing')}
                                    </th>
                                    <th scope="col" className="px-3 sm:px-6 py-3 text-right text-sm font-bold text-amber-700 dark:text-amber-400 uppercase tracking-wide">
                                        <span aria-hidden="true">🍔</span> {t('transactions:monthlySummaryPage.eat', 'Eat')}
                                    </th>
                                    <th scope="col" className="px-3 sm:px-6 py-3 text-right text-sm font-bold text-prosperity-700 dark:text-prosperity-400 uppercase tracking-wide">
                                        <span aria-hidden="true">📈</span> {t('transactions:monthlySummaryPage.invest', 'Invest')}
                                    </th>
                                    <th scope="col" className="px-3 sm:px-6 py-3 text-right text-sm font-bold text-expense-700 dark:text-expense-400 uppercase tracking-wide">
                                        <span aria-hidden="true">🏦</span> {t('transactions:monthlySummaryPage.debt', 'Debt')}
                                    </th>
                                    <th scope="col" className="px-3 sm:px-6 py-3 text-right text-sm font-bold text-purple-700 dark:text-purple-400 uppercase tracking-wide">
                                        <span aria-hidden="true">🎯</span> {t('transactions:monthlySummaryPage.others', 'Others')}
                                    </th>
                                    <th scope="col" className="px-3 sm:px-6 py-3 text-right text-sm font-bold text-gray-900 dark:text-white uppercase tracking-wide">
                                        <span aria-hidden="true">💵</span> {t('transactions:monthlySummaryPage.remainingHeader', 'Remaining')}
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                                {monthlySummaries && monthlySummaries.length > 0 ? (
                                    monthlySummaries.map((month, index) => {
                                        // Shares of what the visible columns add up to; transfers
                                        // have no column, so they sit out of both (see spendingOf).
                                        const spent = spendingOf(month);
                                        const housingPct = spent > 0 ? (month.housing / spent) * 100 : 0;
                                        const eatPct = spent > 0 ? (month.eat / spent) * 100 : 0;
                                        const investPct = spent > 0 ? ((month.investment || 0) / spent) * 100 : 0;
                                        const debtPct = spent > 0 ? ((month.debt || 0) / spent) * 100 : 0;
                                        const othersPct = spent > 0 ? (month.others / spent) * 100 : 0;
                                        const monthIncome = Number(month.income || 0);
                                        const remaining = monthIncome - spent;

                                        return (
                                            <tr
                                                key={month.month}
                                                className={cn(
                                                    "hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-all duration-200 hover:shadow-md",
                                                    index % 2 === 0 ? "bg-white dark:bg-gray-800" : "bg-gray-50/50 dark:bg-gray-800/50"
                                                )}
                                            >
                                                <td className="sticky left-0 z-[1] bg-white dark:bg-gray-800 px-3 sm:px-6 py-3 text-sm font-semibold text-gray-900 dark:text-white">
                                                    {formatMonth(month.month)}
                                                </td>
                                                <td className="px-3 sm:px-6 py-3 text-sm text-right">
                                                    <span className="font-semibold text-income-600 dark:text-income-400">
                                                        {isValueVisible ? formatTWD(monthIncome) : '•••••'}
                                                    </span>
                                                </td>
                                                <td className="px-3 sm:px-6 py-3 text-sm text-right">
                                                    <div className="flex flex-col items-end gap-1.5">
                                                        <span className="font-semibold text-blue-600 dark:text-blue-400">
                                                            {isValueVisible ? formatTWD(month.housing) : '•••••'}
                                                        </span>
                                                        {spent > 0 && (
                                                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">
                                                                {housingPct.toFixed(1)}%
                                                            </span>
                                                        )}
                                                    </div>
                                                </td>
                                                <td className="px-3 sm:px-6 py-3 text-sm text-right">
                                                    <div className="flex flex-col items-end gap-1.5">
                                                        <span className="font-semibold text-amber-600 dark:text-amber-400">
                                                            {isValueVisible ? formatTWD(month.eat) : '•••••'}
                                                        </span>
                                                        {spent > 0 && (
                                                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300">
                                                                {eatPct.toFixed(1)}%
                                                            </span>
                                                        )}
                                                    </div>
                                                </td>
                                                <td className="px-3 sm:px-6 py-3 text-sm text-right">
                                                    <div className="flex flex-col items-end gap-1.5">
                                                        <span className="font-semibold text-prosperity-600 dark:text-prosperity-400">
                                                            {isValueVisible ? formatTWD(month.investment || 0) : '•••••'}
                                                        </span>
                                                        {spent > 0 && (month.investment || 0) > 0 && (
                                                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-prosperity-100 dark:bg-prosperity-900/30 text-prosperity-700 dark:text-prosperity-300">
                                                                {investPct.toFixed(1)}%
                                                            </span>
                                                        )}
                                                    </div>
                                                </td>
                                                <td className="px-3 sm:px-6 py-3 text-sm text-right">
                                                    <div className="flex flex-col items-end gap-1.5">
                                                        <span className="font-semibold text-expense-600 dark:text-expense-400">
                                                            {isValueVisible ? formatTWD(month.debt || 0) : '•••••'}
                                                        </span>
                                                        {spent > 0 && (month.debt || 0) > 0 && (
                                                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-expense-100 dark:bg-expense-900/30 text-expense-700 dark:text-expense-300">
                                                                {debtPct.toFixed(1)}%
                                                            </span>
                                                        )}
                                                    </div>
                                                </td>
                                                <td className="px-3 sm:px-6 py-3 text-sm text-right">
                                                    <div className="flex flex-col items-end gap-1.5">
                                                        <span className="font-semibold text-purple-600 dark:text-purple-400">
                                                            {isValueVisible ? formatTWD(month.others) : '•••••'}
                                                        </span>
                                                        {spent > 0 && (
                                                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300">
                                                                {othersPct.toFixed(1)}%
                                                            </span>
                                                        )}
                                                    </div>
                                                </td>
                                                <td className="px-3 sm:px-6 py-3 text-sm text-right">
                                                    <span className={cn(
                                                        "font-bold text-base",
                                                        remaining >= 0
                                                            ? "text-income-600 dark:text-income-400"
                                                            : "text-expense-600 dark:text-expense-400"
                                                    )}>
                                                        {isValueVisible ? formatTWD(remaining) : '•••••'}
                                                    </span>
                                                </td>
                                            </tr>
                                        );
                                    })
                                ) : (
                                    <tr>
                                        <td colSpan={8} className="px-6 py-16 text-center">
                                            <div className="flex flex-col items-center gap-3">
                                                <span className="text-5xl opacity-50">📭</span>
                                                <p className="text-gray-500 dark:text-gray-400 font-medium">
                                                    {t('transactions:monthlySummaryPage.noDataForYear', 'No data available for {{year}}', { year: selectedYear })}
                                                </p>
                                                <p className="text-sm text-gray-500 dark:text-gray-400">
                                                    {t('transactions:monthlySummaryPage.noDataHint', 'Try selecting a different year or add some transactions')}
                                                </p>
                                            </div>
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </Card>
            </div>
        </DashboardLayout>
    );
}
