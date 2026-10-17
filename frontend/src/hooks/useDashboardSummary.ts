'use client';

import { useMemo } from 'react';
import { useOptimizedDashboard } from '@/hooks/useOptimizedDashboard';
import { useWalletTrends, useWalletTrendBaseline } from '@/hooks/useWalletTrends';
import { netWorthOf } from '@/lib/dashboard/periodChange';
import { useGoals, type Goal } from '@/hooks/useGoals';
import { useAppMode } from '@/hooks/useAppMode';
import { portfolioCreditedGoal } from '@/utils/goalMatchers';

/**
 * Shared data model for the focused ("compact") dashboard views — consumed by
 * BOTH MobileDashboard (phone) and CompactDashboard (desktop focus mode) so the
 * two can never drift apart. Keeps the presentational layers thin and identical
 * in the numbers they show.
 *
 * The net-worth series comes from useWalletTrends (demo-aware), NOT the dashboard
 * payload's walletTrendData which is always empty — the source of an earlier
 * blank-sparkline bug.
 */

interface SparkGeometry { line: string; area: string; last: readonly [number, number] }

/** Build sparkline SVG geometry (normalized to a 300×60 viewBox) from a series. */
function buildSpark(values: number[], w = 300, h = 60, pad = 5): SparkGeometry | null {
    if (values.length < 2) return null;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    const stepX = (w - pad * 2) / (values.length - 1);
    const pts = values.map((v, i) => {
        const x = pad + i * stepX;
        const y = pad + (1 - (v - min) / range) * (h - pad * 2);
        return [x, y] as const;
    });
    const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
    const lastX = pts[pts.length - 1][0];
    const area = `${line} L${lastX.toFixed(1)},${h} L${pad},${h} Z`;
    return { line, area, last: pts[pts.length - 1] };
}

/**
 * Pick the goal to feature, and its completion — pure so it can be tested.
 *
 * Two corrections live here, both of which produced visibly wrong output:
 *
 *  1. A retirement goal receives no manual deposits — nobody transfers into it —
 *     so its stored currentAmount stays 0. It rendered as "NT$0 · 0%" against a
 *     multi-million target while the portfolio, which IS its progress, sat right
 *     next to it. GoalsOverview already applies this override for the full
 *     dashboard; compact and mobile read this hook and so missed it.
 *
 *  2. The backend serialises Decimal as strings, so comparing targetAmount
 *     without coercion compares lexicographically — "600000" > "1000000" is true
 *     for strings, which can feature the wrong goal entirely.
 */
export function selectPrimaryGoal(
    goals: Goal[],
    portfolioValue: number,
): { primaryGoal: Goal | null; goalPct: number } {
    const creditedId = portfolioCreditedGoal(goals)?.id;
    const normalized = goals.map((g) => {
        const current = Number(g.currentAmount) || 0;
        const target = Number(g.targetAmount) || 0;
        return {
            ...g,
            currentAmount:
                g.id === creditedId && portfolioValue > 0
                    ? Math.max(current, portfolioValue)
                    : current,
            targetAmount: target,
        };
    });

    const primaryGoal = normalized.length
        ? normalized.reduce((a, b) => (b.targetAmount > a.targetAmount ? b : a))
        : null;

    const goalPct = primaryGoal && primaryGoal.targetAmount > 0
        ? Math.min(100, Math.max(0, (primaryGoal.currentAmount / primaryGoal.targetAmount) * 100))
        : 0;

    return { primaryGoal, goalPct };
}

interface DashboardSummary {
    netWorth: number;
    changeAbs: number;
    changePct: number;
    income: number;
    expenses: number;
    net: number;
    expenseShare: number;
    pnl: number;
    pnlPct: number;
    portfolioValue: number;
    primaryGoal: Goal | null;
    goalPct: number;
    spark: SparkGeometry | null;
    stats: {
        life_wallet?: number;
        portfolio_wallet?: number;
        emergency_wallet?: number;
        total_asset?: number;
        total_debt?: number;
    } | undefined;
    isLoading: boolean;
    isDemo: boolean;
}

export function useDashboardSummary(): DashboardSummary {
    const { isDemo } = useAppMode();
    const { data: dash, isLoading } = useOptimizedDashboard('month');
    const stats = dash?.data?.stats;
    const portfolio = dash?.data?.portfolio;
    // 'month', not '30d': the hero labels this delta "this month" and the stats
    // beside it are already the calendar month, so a rolling 30-day window put
    // two different periods under one label. The baseline is the day the window
    // opened — without it, `last - first` over N points spans N-1 days and the
    // 1st's movement is dropped, which is the same defect the desktop strip had.
    const { data: trend = [] } = useWalletTrends('month');
    const { data: trendBaseline } = useWalletTrendBaseline('month');
    const { data: goals = [] } = useGoals();

    return useMemo(() => {
        const s = stats;
        const netWorth = (s?.total_asset ?? 0) - (s?.total_debt ?? 0);
        const fromOpen = trendBaseline ? [trendBaseline, ...trend] : trend;
        let nwSeries = fromOpen.map(netWorthOf);
        // Demo mode has no real history — synthesize a gentle upward series ending
        // at today's net worth so the hero chart reads as alive. Real accounts use
        // their actual series only (never faked); an empty real series collapses.
        if (nwSeries.length < 2 && isDemo && netWorth > 0) {
            const N = 12;
            nwSeries = Array.from({ length: N }, (_, i) => {
                const f = i / (N - 1);
                const drift = 0.92 + 0.08 * f;
                const wobble = 1 + Math.sin(f * Math.PI * 2) * 0.012;
                return Math.round(netWorth * drift * wobble);
            });
            nwSeries[N - 1] = netWorth;
        }
        const firstNW = nwSeries[0] ?? netWorth;
        const changeAbs = (nwSeries[nwSeries.length - 1] ?? netWorth) - firstNW;
        const changePct = firstNW > 0 ? (changeAbs / firstNW) * 100 : 0;

        const income = s?.monthlyIncome ?? 0;
        const expenses = s?.monthlyExpenses ?? 0;
        const net = income - expenses;
        const expenseShare = income > 0 ? Math.min(100, (expenses / income) * 100) : (expenses > 0 ? 100 : 0);

        const pnl = portfolio?.totalGainLoss ?? 0;
        const pnlPct = portfolio?.gainLossPercentage ?? 0;
        const portfolioValue = portfolio?.totalValue ?? s?.portfolio_wallet ?? 0;

        const { primaryGoal, goalPct } = selectPrimaryGoal(goals, portfolioValue);

        return {
            netWorth, changeAbs, changePct, income, expenses, net, expenseShare,
            pnl, pnlPct, portfolioValue, primaryGoal, goalPct,
            spark: buildSpark(nwSeries), stats: s, isLoading, isDemo,
        };
    }, [stats, portfolio, trend, trendBaseline, goals, isDemo, isLoading]);
}
