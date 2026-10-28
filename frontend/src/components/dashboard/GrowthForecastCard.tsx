'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
    ArrowTrendingUpIcon,
    InformationCircleIcon,
    ArrowPathIcon,
} from '@heroicons/react/24/outline';
import {
    AreaChart,
    Area,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    ReferenceLine,
} from 'recharts';
import { usePrivacy } from '@/contexts/PrivacyContext';
import { useAppMode } from '@/hooks/useAppMode';
import { useWalletTrends, type WalletTrendDataPoint } from '@/hooks/useWalletTrends';
import { portfolioService } from '@/services/portfolioService';
import { formatTWD, formatTWDCompact } from '@/utils/formatters';
import { cn } from '@/utils/cn';
import { useGrowthForecast } from '@/hooks/useGrowthForecast';
import { useExpenseBreakdown } from '@/hooks/useExpenseBreakdown';
import { useGoalPlanning, type GoalPlan } from '@/hooks/useGoalPlanning';
import { netWorthOf } from '@/lib/dashboard/periodChange';
import { Card } from '@/components/ui/Card';

interface GrowthForecastCardProps {
    stats: {
        total_asset: number;
        total_debt?: number;
        portfolio_wallet: number;
        emergency_wallet?: number;
        monthlyIncome: number;
        monthlyExpenses: number;
    };
    loading?: boolean;
}


const FALLBACK_RETURN = 7; // typical long-run global-index average
const HORIZONS = [6, 12, 36] as const;

const COLORS = {
    estimate: '#6366f1', // indigo-500 — full projection (savings + investment return)
    savings: '#10b981',  // emerald-500 — savings-only trajectory (0% return)
    actual: '#64748b',   // slate-500 — real history
};

function clamp(v: number, min: number, max: number) {
    return Math.min(max, Math.max(min, v));
}

/** Collapse a daily/weekly trend series to one point per calendar month (last value wins). */
function toMonthly(points: WalletTrendDataPoint[]): WalletTrendDataPoint[] {
    const byMonth = new Map<string, WalletTrendDataPoint>();
    for (const p of points) {
        if (!p?.date) continue;
        byMonth.set(p.date.slice(0, 7), p); // YYYY-MM; chronological input → ordered keys
    }
    return Array.from(byMonth.values());
}

/**
 * Clean, round Y-axis: pads the data range a touch, then snaps the domain and
 * ticks to nice round steps (1 / 2 / 2.5 / 5 × 10ⁿ) so labels read $400萬 / $550萬
 * instead of $340.7萬 / $540.7萬.
 */
function niceAxis(min: number, max: number, count = 4): { domain: [number, number]; ticks: number[] } {
    if (!(max > min)) return { domain: [0, Math.max(1, max)], ticks: [] };
    const pad = (max - min) * 0.08;
    let lo = min - pad;
    let hi = max + pad;
    const rawStep = (hi - lo) / count;
    const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
    const norm = rawStep / magnitude;
    const step = (norm >= 5 ? 5 : norm >= 2.5 ? 2.5 : norm >= 2 ? 2 : 1) * magnitude;
    lo = Math.max(0, Math.floor(lo / step) * step);
    hi = Math.ceil(hi / step) * step;
    const ticks: number[] = [];
    for (let v = lo; v <= hi + step * 0.001; v += step) ticks.push(Math.round(v));
    return { domain: [Math.round(lo), Math.round(hi)], ticks };
}

interface ChartRow {
    label: string;
    actual: number | null;
    estPast: number | null;
    estFuture: number | null;
    savingsOnly: number | null;           // future: trajectory with 0% return
    returnBand: [number, number] | null;  // future: [savingsOnly, estFuture] — the return gap
}

interface TooltipPayloadItem {
    payload: ChartRow;
    dataKey: string;
}

export function GrowthForecastCard({ stats, loading = false }: GrowthForecastCardProps) {
    const { t, i18n } = useTranslation('dashboard');
    const { isValueVisible } = usePrivacy();
    const { isDemo, session } = useAppMode();

    // Real ~3-month history — used to overlay actual vs. estimate so the forecast is
    // anchored to reality rather than a bare straight line. A shorter window keeps the
    // overlay focused on recent, comparable months (avoids early data-entry ramps).
    const { data: history90d = [] } = useWalletTrends('90d');

    // Auto-default the annual return from the portfolio's own annualized CAGR.
    const { data: riskMetrics } = useQuery({
        queryKey: ['portfolio-risk-metrics', session?.user?.email || 'demo'],
        queryFn: () => portfolioService.getRiskMetrics(),
        enabled: !isDemo,
        staleTime: 5 * 60 * 1000,
        gcTime: 15 * 60 * 1000,
        retry: false,
        refetchOnWindowFocus: false,
    });

    const realSavings = Math.round(stats.monthlyIncome - stats.monthlyExpenses);
    const defaultInvestedPct = stats.total_asset > 0
        ? Math.round(clamp((stats.portfolio_wallet / stats.total_asset) * 100, 0, 100))
        : 50;
    const cagr = riskMetrics?.cagrPercentage;
    const hasCagr = typeof cagr === 'number' && Number.isFinite(cagr) && (riskMetrics?.hasHistoricalData ?? false);
    const defaultReturn = hasCagr ? clamp(Math.round((cagr as number) * 10) / 10, 0, 30) : FALLBACK_RETURN;

    // Categorised 3-month expense + income averages for a realistic monthly burn.
    const breakdown = useExpenseBreakdown();

    const [returnOverride, setReturnOverride] = useState<number | null>(null);
    const [investedOverride, setInvestedOverride] = useState<number | null>(null);
    const [horizonMonths, setHorizonMonths] = useState<number>(12); // FUTURE horizon
    const [incomeOverride, setIncomeOverride] = useState<number | null>(null);
    const [expenseOverrides, setExpenseOverrides] = useState<Record<string, number>>({});
    const [includeOverrides, setIncludeOverrides] = useState<Record<string, boolean>>({});

    const annualReturnPct = returnOverride ?? defaultReturn;
    const investedPct = investedOverride ?? defaultInvestedPct;

    // Each expense bucket is included by default when it looks routine, and its amount
    // defaults to the multi-month average — both overridable by the user (keyed by group).
    const isIncluded = (c: { key: string; isRoutine: boolean }) => includeOverrides[c.key] ?? c.isRoutine;
    const catAmount = (c: { key: string; monthlyAvg: number }) => expenseOverrides[c.key] ?? c.monthlyAvg;
    const includedExpense = breakdown.categories.reduce((s, c) => (isIncluded(c) ? s + catAmount(c) : s), 0);
    const groupLabel = (c: { key: string; name: string }) =>
        c.key === 'debtInterest'
            ? t('growthForecast.debtInterest', 'Debt interest')
            : t(`growthForecast.group_${c.key}`, c.name);
    // Income is the window's average monthly income from real transactions, which is
    // period-independent. Falls back to the dashboard's monthly figure only when there
    // are no income transactions yet (new account).
    const effectiveIncome = incomeOverride
        ?? (breakdown.avgMonthlyIncome > 0 ? breakdown.avgMonthlyIncome : Math.round(stats.monthlyIncome));
    // Net savings — derived from the editable breakdown when we have categorised data,
    // otherwise the coarse dashboard income−expense figure.
    const monthlySavings = breakdown.hasData ? effectiveIncome - includedExpense : realSavings;

    const expensesDirty = incomeOverride !== null || Object.keys(expenseOverrides).length > 0 || Object.keys(includeOverrides).length > 0;
    const isDirty = returnOverride !== null || investedOverride !== null || expensesDirty;

    // Monthly-resampled actual history. The oldest bucket anchors the estimate;
    // the newest bucket is "now". With no history we fall back to a now-anchored
    // forward projection (no actual overlay).
    const monthly = useMemo(() => toMonthly(history90d), [history90d]);
    const hasHistory = monthly.length >= 2;
    const pastMonths = hasHistory ? monthly.length - 1 : 0;
    // First bucket's date anchors the x-axis; the forecast itself anchors on TODAY.
    const anchorDate = useMemo(
        () => (hasHistory ? new Date(monthly[0].date) : new Date()),
        [hasHistory, monthly],
    );

    // Forward projection is ALWAYS anchored at today's NET worth (assets − debt), so
    // the future line starts from where the user actually is. Debt is held flat — its
    // interest is already deducted from monthly savings via the expense breakdown, and
    // principal paydown is net-neutral (cash down, debt down by the same amount).
    const nowTotal = stats.total_asset - (stats.total_debt ?? 0);
    const forecast = useGrowthForecast(
        {
            totalAsset: nowTotal,
            portfolioWallet: stats.portfolio_wallet,
            monthlyIncome: stats.monthlyIncome,
            monthlyExpenses: stats.monthlyExpenses,
        },
        { annualReturnPct, monthlySavings, horizonMonths, investedPct },
    );

    const projectedTotal = forecast.points[horizonMonths]?.total ?? nowTotal;
    const gain = projectedTotal - nowTotal;
    const gainPct = nowTotal > 0 ? (gain / nowTotal) * 100 : 0;

    // Return-driven growth over the future window (projection minus savings-only).
    const futureGrowth = (forecast.points[horizonMonths]?.total ?? 0) - nowTotal;
    const futureSavings = (forecast.baselinePoints[horizonMonths]?.total ?? 0) - nowTotal;
    const marketContribution = futureGrowth - futureSavings;

    // Goal-backed planning: per-goal ETA / required-extra under the SAME model,
    // so the chips and the chart always agree.
    const { plans: goalPlans } = useGoalPlanning({
        netWorth: nowTotal,
        portfolioWallet: stats.portfolio_wallet,
        monthlySavings,
        annualReturnPct,
        investedPct,
    });

    // Past replay: de-grow today's assets backward month by month (the inverse of the
    // forward step) so the estimate line passes exactly through today's real value and
    // connects to the projection at "Now", then overlays the actual history.
    const pastEstimate = useMemo(() => {
        const monthlyRate = annualReturnPct / 100 / 12;
        const invFrac = clamp(investedPct / 100, 0, 1);
        const investedContribution = monthlySavings * invFrac;
        const cashContribution = monthlySavings * (1 - invFrac);
        let port = stats.portfolio_wallet;
        let cash = nowTotal - stats.portfolio_wallet;
        const back: number[] = [port + cash]; // index 0 = now
        for (let i = 1; i <= pastMonths; i++) {
            port = (port - investedContribution) / (1 + monthlyRate);
            cash = cash - cashContribution;
            back.push(port + cash);
        }
        return back; // back[i] = estimate i months before now
    }, [annualReturnPct, investedPct, monthlySavings, stats.portfolio_wallet, nowTotal, pastMonths]);

    // The anchor is the newest bucket we hold data for. Trends are computed live
    // through the server's business day, so that is normally the current month,
    // but not always around a month boundary: a response cached before midnight,
    // or a browser whose month differs from the business timezone's. Calling a
    // stale bucket "Now" hides it completely: the axis reads … Jun · Jul · Now,
    // where "Now" silently means July. Label the anchor with its real month
    // whenever it isn't the current one, so a lag is visible on the axis instead
    // of being papered over.
    const anchorIsCurrentMonth = useMemo(() => {
        if (!hasHistory) return true; // no history → anchorDate is literally new Date()
        const newest = monthly[monthly.length - 1]?.date;
        if (!newest) return true;
        const today = new Date();
        const currentKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
        return newest.slice(0, 7) === currentKey;
    }, [hasHistory, monthly]);

    const chartData: ChartRow[] = useMemo(() => {
        const total = pastMonths + horizonMonths;
        const rows: ChartRow[] = [];
        for (let k = 0; k <= total; k++) {
            const monthsFromNow = k - pastMonths; // <0 past, 0 anchor, >0 future
            const d = new Date(anchorDate.getFullYear(), anchorDate.getMonth() + k, 1);
            const label = monthsFromNow === 0 && anchorIsCurrentMonth
                ? t('growthForecast.now', 'Now')
                : d.toLocaleDateString(i18n.language, { month: 'short' });
            const est = monthsFromNow >= 0 ? forecast.points[monthsFromNow]?.total ?? null : null;
            const sav = monthsFromNow >= 0 ? forecast.baselinePoints[monthsFromNow]?.total ?? null : null;
            rows.push({
                label,
                actual: hasHistory && k <= pastMonths && monthly[k]
                    ? netWorthOf(monthly[k]) // net worth
                    : null,
                estPast: monthsFromNow <= 0 ? pastEstimate[-monthsFromNow] ?? null : null,
                estFuture: est,
                savingsOnly: sav,
                // The gap between the savings-only and full lines = growth from returns.
                returnBand: est != null && sav != null ? [sav, est] : null,
            });
        }
        return rows;
    }, [pastMonths, horizonMonths, anchorDate, pastEstimate, forecast.points, forecast.baselinePoints, hasHistory, monthly, i18n.language, t, anchorIsCurrentMonth]);

    // Whatever the anchor tick ended up called — "Now" when the data is current,
    // otherwise that bucket's real month. The reference line has to match the tick
    // exactly or Recharts silently draws nothing.
    const nowLabel = anchorIsCurrentMonth
        ? t('growthForecast.now', 'Now')
        : new Date(anchorDate.getFullYear(), anchorDate.getMonth() + pastMonths, 1)
            .toLocaleDateString(i18n.language, { month: 'short' });

    // Goal target lines drawn on the chart — only targets near the projected range
    // (≤125% of the curve max), so a far-off goal (e.g. retirement) doesn't crush
    // the axis. Distant goals still appear in the chips below with their ETA.
    const chartGoals = useMemo(() => {
        const curveMax = Math.max(0, ...chartData.flatMap(p => [p.actual, p.estFuture].filter((v): v is number => v != null)));
        return goalPlans.filter(g => g.targetAmount > 0 && g.targetAmount <= curveMax * 1.25);
    }, [goalPlans, chartData]);

    const yAxis = useMemo(() => {
        const values = chartData.flatMap(p => [p.actual, p.estPast, p.estFuture].filter((v): v is number => v != null));
        if (!values.length) return { domain: [0, 1] as [number, number], ticks: [] as number[] };
        // Include visible goal lines so they always land inside the plot area.
        const withGoals = values.concat(chartGoals.map(g => g.targetAmount));
        return niceAxis(Math.min(...withGoals), Math.max(...withGoals), 4);
    }, [chartData, chartGoals]);

    const horizonLabel = horizonMonths === 6
        ? t('growthForecast.in6mo', 'In 6 months')
        : horizonMonths === 12
            ? t('growthForecast.in1yr', 'In 1 year')
            : t('growthForecast.in3yr', 'In 3 years');

    const gainPositive = gain >= 0;

    // ── Stage ladder: foundation → debt → near goals → far goals ────────────
    // Each stage has one gate metric; the first non-green stage is where the
    // user's next effort belongs.
    type StageState = 'ok' | 'warn' | 'todo' | 'none';
    const stages = useMemo((): Array<{ key: string; state: StageState; label: string; metric: string }> => {
        const list: Array<{ key: string; state: StageState; label: string; metric: string }> = [];

        // 1. Foundation — emergency runway in months of current spending.
        const emergency = stats.emergency_wallet ?? 0;
        const runway = includedExpense > 0 ? emergency / includedExpense : null;
        list.push({
            key: 'foundation',
            label: t('growthForecast.stageFoundation', 'Safety net'),
            state: runway === null ? 'none' : runway >= 6 ? 'ok' : runway >= 3 ? 'warn' : 'todo',
            metric: runway === null ? '—' : `${runway.toFixed(1)} ${t('growthForecast.months', 'mo')}`,
        });

        // 2. Debt — monthly interest burden relative to income.
        const debtMo = breakdown.categories.find(c => c.key === 'debtInterest')?.monthlyAvg ?? 0;
        list.push({
            key: 'debt',
            label: t('growthForecast.stageDebt', 'Debt'),
            state: debtMo <= 0 ? 'ok' : debtMo <= effectiveIncome * 0.1 ? 'warn' : 'todo',
            metric: debtMo <= 0 ? t('growthForecast.debtFree', 'none') : `${formatTWDCompact(debtMo)}/${t('growthForecast.months', 'mo')}`,
        });

        // 3 + 4. Goals split by horizon: near (≤2y) vs far.
        const nowMs = Date.now();
        const isNear = (p: GoalPlan) => {
            if (p.targetDate) return (new Date(p.targetDate).getTime() - nowMs) / (1000 * 60 * 60 * 24 * 30.44) <= 24;
            return p.etaMonths !== null && p.etaMonths <= 24;
        };
        const bucket = (plans: GoalPlan[], key: string, label: string) => {
            if (!plans.length) { list.push({ key, label, state: 'none', metric: '—' }); return; }
            const short = plans.filter(p => p.status === 'short' || p.status === 'unreachable');
            const shortSum = short.reduce((s, p) => s + (p.requiredExtraPerMonth ?? 0), 0);
            list.push({
                key,
                label,
                state: short.length === 0 ? 'ok' : 'warn',
                metric: short.length === 0
                    ? t('growthForecast.onTrack', 'on track')
                    : shortSum > 0
                        ? t('growthForecast.shortBy', 'short {{amount}}/mo', { amount: formatTWDCompact(shortSum) })
                        : t('growthForecast.beyondPlan', '40y+'),
            });
        };
        bucket(goalPlans.filter(isNear), 'nearGoals', t('growthForecast.stageNearGoals', 'Near goals'));
        bucket(goalPlans.filter(p => !isNear(p)), 'farGoals', t('growthForecast.stageFarGoals', 'Far goals'));

        return list;
    }, [stats.emergency_wallet, includedExpense, breakdown.categories, effectiveIncome, goalPlans, t]);

    const handleReset = () => {
        setReturnOverride(null);
        setInvestedOverride(null);
        setHorizonMonths(12);
        setIncomeOverride(null);
        setExpenseOverrides({});
        setIncludeOverrides({});
    };

    if (loading) {
        return (
            <Card padding="md" className="animate-pulse space-y-3">
                <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded w-1/3" />
                <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded w-2/3" />
                <div className="h-44 bg-gray-200 dark:bg-gray-700 rounded-xl" />
            </Card>
        );
    }

    return (
        <Card padding="md" clip>
            <div className="-mx-4 sm:-mx-5 -mt-4 sm:-mt-5 mb-3">
                <div className="h-px bg-gradient-to-r from-indigo-400/60 via-primary-400/60 to-violet-400/60" />
            </div>

            {/* Header: title + horizon toggle */}
            <div className="flex items-center justify-between gap-2 mb-3">
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-1.5">
                    <ArrowTrendingUpIcon className="w-4 h-4 text-indigo-500" />
                    {t('growthForecast.title', 'Growth Forecast')}
                </h3>
                <div className="flex items-center gap-2">
                    <div className="inline-flex rounded-lg bg-gray-100 dark:bg-gray-700/60 p-0.5">
                        {HORIZONS.map(h => (
                            <button
                                key={h}
                                onClick={() => setHorizonMonths(h)}
                                aria-pressed={horizonMonths === h}
                                className={cn(
                                    'px-2.5 py-1 text-xs font-semibold rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400',
                                    horizonMonths === h
                                        ? 'bg-white dark:bg-gray-800 text-indigo-600 dark:text-indigo-300 shadow-sm'
                                        : 'text-gray-600 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                                )}
                            >
                                {h === 6 ? t('growthForecast.6mo', '6mo') : h === 12 ? t('growthForecast.1yr', '1yr') : t('growthForecast.3yr', '3yr')}
                            </button>
                        ))}
                    </div>
                    {isDirty && (
                        <button
                            onClick={handleReset}
                            className="flex items-center gap-1 text-xs text-gray-600 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
                            aria-label={t('growthForecast.reset', 'Reset to actual')}
                        >
                            <ArrowPathIcon className="w-3.5 h-3.5" />
                            {t('growthForecast.reset', 'Reset')}
                        </button>
                    )}
                </div>
            </div>

            {/* Body: 2:1 split — projection + sliders on the left, expense editor on the right */}
            <div className={cn('grid grid-cols-1 gap-4 lg:gap-5', breakdown.hasData && 'lg:grid-cols-3')}>
            {/* ── LEFT (2/3) ── */}
            <div className={cn('flex flex-col min-w-0', breakdown.hasData && 'lg:col-span-2')}>

            {/* Headline projection */}
            <div className="flex flex-wrap items-end gap-x-3 gap-y-1 mb-1">
                <span className="text-xs text-gray-500 dark:text-gray-500 font-medium">{horizonLabel}</span>
                <span className="text-2xl font-bold text-gray-900 dark:text-white tabular-nums">
                    {isValueVisible ? formatTWD(projectedTotal) : '••••••'}
                </span>
                <span className={cn(
                    'inline-flex items-center gap-0.5 text-xs font-semibold px-1.5 py-0.5 rounded-full',
                    gainPositive
                        ? 'bg-prosperity-100 dark:bg-prosperity-900/40 text-prosperity-700 dark:text-prosperity-300'
                        : 'bg-error-100 dark:bg-error-900/40 text-error-700 dark:text-error-300'
                )}>
                    {gainPositive ? '▲' : '▼'} {isValueVisible ? formatTWDCompact(Math.abs(gain)) : '•••'}
                    {' '}({gainPositive ? '+' : '−'}{Math.abs(gainPct).toFixed(1)}%)
                </span>
            </div>
            {/* Growth decomposition: how much of the gain is from saving vs from returns */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs mb-2">
                <span className="flex items-center gap-1 text-gray-500 dark:text-gray-400">
                    <span className="w-2 h-2 rounded-sm flex-shrink-0" style={{ background: COLORS.savings }} />
                    {t('growthForecast.fromSaving', 'from saving')}
                    <b className="text-gray-700 dark:text-gray-200 tabular-nums">{isValueVisible ? formatTWDCompact(futureSavings) : '•••'}</b>
                </span>
                <span className="flex items-center gap-1 text-gray-500 dark:text-gray-400">
                    <span className="w-2 h-2 rounded-sm flex-shrink-0" style={{ background: COLORS.estimate }} />
                    {t('growthForecast.fromReturn', 'from returns')}
                    <b className="text-gray-700 dark:text-gray-200 tabular-nums">{isValueVisible ? formatTWDCompact(marketContribution) : '•••'}</b>
                </span>
            </div>

            {/* Legend */}
            <div className="flex items-center gap-4 text-xs mb-1">
                {hasHistory && (
                    <span className="flex items-center gap-1.5 text-gray-500 dark:text-gray-400">
                        <span className="inline-block w-4 h-0.5 rounded-full" style={{ background: COLORS.actual }} />
                        {t('growthForecast.actual', 'Actual')}
                    </span>
                )}
                <span className="flex items-center gap-1.5 text-gray-500 dark:text-gray-400">
                    <svg width="18" height="6" viewBox="0 0 18 6"><line x1="0" y1="3" x2="18" y2="3" stroke={COLORS.savings} strokeWidth="2" strokeDasharray="4 3" /></svg>
                    {t('growthForecast.savingsOnly', 'Savings only')}
                </span>
                <span className="flex items-center gap-1.5 text-gray-500 dark:text-gray-400">
                    <svg width="18" height="6" viewBox="0 0 18 6"><line x1="0" y1="3" x2="18" y2="3" stroke={COLORS.estimate} strokeWidth="2" strokeDasharray="4 3" /></svg>
                    {t('growthForecast.estimate', 'Estimate')}
                </span>
            </div>

            {/* Chart */}
            <div className="h-44 sm:h-52">
                <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                        <defs>
                            <linearGradient id="gfc-savGrad" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor={COLORS.savings} stopOpacity={0.18} />
                                <stop offset="95%" stopColor={COLORS.savings} stopOpacity={0.03} />
                            </linearGradient>
                            <linearGradient id="gfc-retGrad" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor={COLORS.estimate} stopOpacity={0.32} />
                                <stop offset="95%" stopColor={COLORS.estimate} stopOpacity={0.10} />
                            </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-gray-200 dark:text-gray-700 opacity-50" vertical={false} />
                        <XAxis dataKey="label" tick={{ fill: 'currentColor', fontSize: 12, fontWeight: 500 }} className="text-gray-500 dark:text-gray-400" tickLine={false} interval="preserveStartEnd" />
                        <YAxis tick={{ fill: 'currentColor', fontSize: 12, fontWeight: 500 }} className="text-gray-500 dark:text-gray-400" tickLine={false} tickFormatter={(v) => isValueVisible ? formatTWDCompact(v) : '•••'} width={80} tickMargin={4} domain={yAxis.domain} ticks={yAxis.ticks} />
                        {hasHistory && (
                            <ReferenceLine x={nowLabel} stroke="currentColor" className="text-gray-500 dark:text-gray-500" strokeDasharray="3 3" label={{ value: t('growthForecast.now', 'Now'), position: 'insideTopRight', fontSize: 10, fill: 'currentColor' }} />
                        )}
                        {/* Goal target lines — where the projection crosses = when it's affordable */}
                        {chartGoals.map(g => (
                            <ReferenceLine
                                key={g.id}
                                y={g.targetAmount}
                                stroke="#f59e0b"
                                strokeDasharray="6 4"
                                strokeOpacity={0.75}
                                label={{ value: `${g.icon} ${isValueVisible ? formatTWDCompact(g.targetAmount) : '•••'}`, position: 'insideBottomRight', fontSize: 10, fill: '#d97706' }}
                            />
                        ))}
                        <Tooltip
                            cursor={{ stroke: COLORS.estimate, strokeWidth: 1.5, strokeDasharray: '5 5' }}
                            content={({ active, payload }) => {
                                if (!active || !payload?.length) return null;
                                const items = payload as TooltipPayloadItem[];
                                const d = items[0].payload;
                                const est = d.estFuture ?? d.estPast;
                                return (
                                    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-xl shadow-lg p-3 min-w-[170px]">
                                        <p className="text-xs font-bold text-gray-900 dark:text-white mb-2 pb-1.5 border-b border-gray-100 dark:border-gray-700">{d.label}</p>
                                        <div className="space-y-1.5">
                                            {d.actual != null && (
                                                <div className="flex justify-between gap-3 text-xs">
                                                    <span className="flex items-center gap-1" style={{ color: COLORS.actual }}>
                                                        <span className="w-1.5 h-1.5 rounded-full" style={{ background: COLORS.actual }} />
                                                        {t('growthForecast.actual', 'Actual')}
                                                    </span>
                                                    <span className="text-gray-900 dark:text-white font-bold tabular-nums">{isValueVisible ? formatTWD(d.actual) : '•••'}</span>
                                                </div>
                                            )}
                                            {est != null && (
                                                <div className="flex justify-between gap-3 text-xs">
                                                    <span className="flex items-center gap-1" style={{ color: COLORS.estimate }}>
                                                        <span className="w-1.5 h-1.5 rounded-full" style={{ background: COLORS.estimate }} />
                                                        {t('growthForecast.estimate', 'Estimate')}
                                                    </span>
                                                    <span className="text-gray-600 dark:text-gray-300 tabular-nums">{isValueVisible ? formatTWD(est) : '•••'}</span>
                                                </div>
                                            )}
                                            {d.savingsOnly != null && (
                                                <div className="flex justify-between gap-3 text-xs">
                                                    <span className="flex items-center gap-1" style={{ color: COLORS.savings }}>
                                                        <span className="w-1.5 h-1.5 rounded-full" style={{ background: COLORS.savings }} />
                                                        {t('growthForecast.savingsOnly', 'Savings only')}
                                                    </span>
                                                    <span className="text-gray-600 dark:text-gray-300 tabular-nums">{isValueVisible ? formatTWD(d.savingsOnly) : '•••'}</span>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                );
                            }}
                        />
                        {/* Savings-only region: fill from the axis up to the 0%-return line */}
                        <Area type="monotone" dataKey="savingsOnly" stroke={COLORS.savings} strokeWidth={2} strokeDasharray="4 3" fill="url(#gfc-savGrad)" fillOpacity={1} dot={false} connectNulls={false} name="Savings only" />
                        {/* Investment-return band: the gap between savings-only and the full projection */}
                        <Area type="monotone" dataKey="returnBand" stroke="none" fill="url(#gfc-retGrad)" fillOpacity={1} dot={false} connectNulls={false} name="Investment return" />
                        {/* Full projection (savings + return) — dashed top line, no fill */}
                        <Area type="monotone" dataKey="estFuture" stroke={COLORS.estimate} strokeWidth={2.5} strokeDasharray="5 4" fill="none" dot={false} activeDot={{ r: 4, fill: COLORS.estimate, stroke: 'white', strokeWidth: 2 }} connectNulls={false} name="Estimate (future)" />
                        {/* Past replay of the model — solid, overlaps the actual line */}
                        <Area type="monotone" dataKey="estPast" stroke={COLORS.estimate} strokeWidth={2.5} fill="none" dot={false} connectNulls={false} name="Estimate (past)" />
                        {/* Real history */}
                        <Area type="monotone" dataKey="actual" stroke={COLORS.actual} strokeWidth={2} fill="none" dot={false} connectNulls={false} activeDot={{ r: 4, fill: COLORS.actual, stroke: 'white', strokeWidth: 2 }} name="Actual" />
                    </AreaChart>
                </ResponsiveContainer>
            </div>

            {/* Goal chips: per-goal affordability under the current plan */}
            {goalPlans.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-3">
                    {goalPlans.map(g => {
                        const eta = g.etaMonths;
                        const etaText = g.status === 'affordable'
                            ? t('growthForecast.affordableNow', 'affordable now')
                            : eta !== null
                                ? new Date(new Date().getFullYear(), new Date().getMonth() + eta, 1)
                                    .toLocaleDateString(i18n.language, { year: 'numeric', month: 'short' })
                                : t('growthForecast.beyondPlan', '40y+');
                        return (
                            <span key={g.id} className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60 px-2.5 py-1 text-xs text-gray-600 dark:text-gray-300">
                                <span aria-hidden="true">{g.icon}</span>
                                <span className="font-medium truncate max-w-[8rem]">{g.title}</span>
                                <span className="tabular-nums text-gray-500 dark:text-gray-400">{etaText}</span>
                                {g.status === 'short' && g.requiredExtraPerMonth != null && (
                                    <span className="font-semibold text-error-700 dark:text-error-400 tabular-nums">
                                        {t('growthForecast.shortBy', 'short {{amount}}/mo', { amount: isValueVisible ? formatTWDCompact(g.requiredExtraPerMonth) : '•••' })}
                                    </span>
                                )}
                                {(g.status === 'onTrack' || g.status === 'affordable') && (
                                    <span className="font-semibold text-prosperity-700 dark:text-prosperity-400">
                                        {t('growthForecast.onTrack', 'on track')}
                                    </span>
                                )}
                            </span>
                        );
                    })}
                </div>
            )}

            {/* Sliders: expected return + % invested */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
                        {/* Annual return */}
                        <div>
                            <div className="flex items-baseline justify-between mb-1">
                                <label htmlFor="growthfore-growthforecast-annualreturn" className="text-xs font-medium text-gray-600 dark:text-gray-400">{t('growthForecast.annualReturn', 'Annual return')}</label>
                                <span className="text-xs font-bold text-indigo-600 dark:text-indigo-300 tabular-nums">{annualReturnPct.toFixed(1)}%</span>
                            </div>
                            <input
                                id="growthfore-growthforecast-annualreturn"
                                type="range" min={0} max={30} step={0.5} value={annualReturnPct}
                                onChange={(e) => setReturnOverride(parseFloat(e.target.value))}
                                className="w-full h-11 sm:h-6 cursor-pointer accent-indigo-600"
                            />
                            <p className="mt-1 text-sm text-gray-500 dark:text-gray-500">
                                {hasCagr && returnOverride === null
                                    ? t('growthForecast.fromCagr', 'from your portfolio (CAGR)')
                                    : t('growthForecast.returnHint', 'expected yearly growth')}
                            </p>
                        </div>
                        {/* % invested */}
                        <div>
                            <div className="flex items-baseline justify-between mb-1">
                                <label htmlFor="growthfore-growthforecast-percentinvested" className="text-xs font-medium text-gray-600 dark:text-gray-400">{t('growthForecast.percentInvested', '% of savings invested')}</label>
                                <span className="text-xs font-bold text-gray-900 dark:text-white tabular-nums">{investedPct}%</span>
                            </div>
                            <input
                                id="growthfore-growthforecast-percentinvested"
                                type="range" min={0} max={100} step={5} value={investedPct}
                                onChange={(e) => setInvestedOverride(parseFloat(e.target.value))}
                                className="w-full h-11 sm:h-6 cursor-pointer accent-indigo-600"
                            />
                            <p className="mt-1 text-sm text-gray-500 dark:text-gray-500">
                                {t('growthForecast.investedHint', 'rest stays as cash')}
                            </p>
                        </div>
                    </div>

                    {/* Net savings — shown here only when there's no breakdown panel on the
                        right (otherwise it duplicates the panel's total below). */}
                    {!breakdown.hasData && (
                        <div className="mt-3">
                            <div className="flex items-baseline justify-between gap-2">
                                <span className="text-xs font-medium text-gray-600 dark:text-gray-400">{t('growthForecast.monthlySavings', 'Net savings / mo')}</span>
                                <span className={cn('text-sm font-bold tabular-nums', monthlySavings >= 0 ? 'text-gray-900 dark:text-white' : 'text-error-700 dark:text-error-500')}>
                                    {isValueVisible ? formatTWD(monthlySavings) : '•••'}
                                </span>
                            </div>
                            <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-500">
                                {t('growthForecast.realSavings', 'your real income − expense')}
                            </p>
                        </div>
                    )}
            </div>

            {/* ── RIGHT (1/3): editable monthly-expense breakdown (3-month averages) ── */}
            {breakdown.hasData && (
                <div className="lg:col-span-1">
                    <div className="h-full rounded-xl border border-gray-200 dark:border-gray-700 p-3 flex flex-col">
                        <div className="flex items-center justify-between gap-2 text-xs font-medium text-gray-700 dark:text-gray-200">
                            <span>{t('growthForecast.monthlyIncome', 'Monthly income')}</span>
                            {isValueVisible ? (
                                <input
                                    type="number" min={0} value={effectiveIncome}
                                    inputMode="decimal"
                                    aria-label={t('growthForecast.monthlyIncome', 'Monthly income')}
                                    onWheel={(e) => e.currentTarget.blur()}
                                    onChange={(e) => setIncomeOverride(Math.max(0, Math.round(Number(e.target.value) || 0)))}
                                    className="w-28 text-right tabular-nums bg-transparent border-b border-gray-200 dark:border-gray-600 focus-visible:border-indigo-500 focus-visible:outline-none px-1 py-1"
                                />
                            ) : (
                                <span className="w-28 text-right tabular-nums text-gray-500 dark:text-gray-500">•••</span>
                            )}
                        </div>
                        <p className="text-sm text-gray-500 dark:text-gray-500 pt-1">
                            {incomeOverride !== null
                                ? t('growthForecast.incomeManual', 'manually set')
                                : t('growthForecast.incomeHint', 'recurring earned avg — salary, freelance')}
                        </p>
                        <p className="text-sm text-gray-500 dark:text-gray-500 pt-2 pb-1">
                            {t('growthForecast.expensesTitle', 'Monthly expenses — {{months}}-month average (tap to edit)', { months: breakdown.monthsAveraged })}
                        </p>
                        <div className="space-y-1.5 overflow-y-auto max-h-64 lg:max-h-80 pr-1 -mr-1">
                            {breakdown.categories.map((c) => {
                                const included = isIncluded(c);
                                return (
                                    <div key={c.key} className={cn('flex items-center gap-2 text-xs', !included && 'opacity-50')}>
                                        {/* The name toggles the box too, so the target is the row, not a 13px square */}
                                        <label className="flex flex-1 min-w-0 min-h-[28px] items-center gap-2 cursor-pointer">
                                            <input
                                                type="checkbox" checked={included}
                                                onChange={() => setIncludeOverrides(prev => ({ ...prev, [c.key]: !included }))}
                                                className="rounded border-gray-300 dark:border-gray-600 text-indigo-600 focus-visible:ring-indigo-500 cursor-pointer"
                                                aria-label={groupLabel(c)}
                                            />
                                            <span className="flex-1 truncate text-gray-600 dark:text-gray-300">
                                                <span className="mr-1" aria-hidden="true">{c.icon}</span>{groupLabel(c)}
                                            </span>
                                        </label>
                                        {isValueVisible ? (
                                            <input
                                                type="number" min={0} value={catAmount(c)} disabled={!included}
                                                inputMode="decimal"
                                                aria-label={groupLabel(c)}
                                                onWheel={(e) => e.currentTarget.blur()}
                                                onChange={(e) => setExpenseOverrides(prev => ({ ...prev, [c.key]: Math.max(0, Math.round(Number(e.target.value) || 0)) }))}
                                                className="w-24 text-right tabular-nums bg-transparent border-b border-gray-200 dark:border-gray-600 focus-visible:border-indigo-500 focus-visible:outline-none px-1 py-1 disabled:opacity-40"
                                            />
                                        ) : (
                                            <span className="w-24 text-right tabular-nums text-gray-500 dark:text-gray-500">•••</span>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                        <div className="mt-auto pt-2 space-y-1">
                            <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-500">
                                <span>{t('growthForecast.expensesSubtotal', 'Total expenses / mo')}</span>
                                <span className="tabular-nums">− {isValueVisible ? formatTWDCompact(includedExpense) : '•••'}</span>
                            </div>
                            <div className="flex items-center justify-between text-xs font-semibold pt-1.5 border-t border-gray-100 dark:border-gray-700">
                                <span className="text-gray-700 dark:text-gray-200">{t('growthForecast.monthlySavings', 'Net savings / mo')}</span>
                                <span className={cn('tabular-nums', monthlySavings >= 0 ? 'text-prosperity-700 dark:text-prosperity-400' : 'text-error-700 dark:text-error-500')}>
                                    {isValueVisible ? formatTWD(monthlySavings) : '•••'}
                                </span>
                            </div>
                        </div>
                    </div>
                </div>
            )}
            </div>{/* end 2:1 grid */}

            {/* Stage ladder — compact 4-step strip showing which financial stage
                the user is in and what the gate metric for each stage is. */}
            <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2">
                {stages.map((s, i) => {
                    const stateStyle = {
                        ok: 'bg-prosperity-50 dark:bg-prosperity-900/20 border-prosperity-200 dark:border-prosperity-700 text-prosperity-700 dark:text-prosperity-300',
                        warn: 'bg-warning-50 dark:bg-warning-900/20 border-warning-200 dark:border-warning-700 text-warning-700 dark:text-warning-300',
                        todo: 'bg-error-50 dark:bg-error-900/20 border-error-200 dark:border-error-700 text-error-700 dark:text-error-300',
                        none: 'bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-500',
                    }[s.state];
                    const dot = { ok: '✅', warn: '⚠️', todo: '🔴', none: '○' }[s.state];
                    return (
                        <div key={s.key} className={cn('rounded-lg border px-2.5 py-1.5 text-xs', stateStyle)}>
                            <div className="flex items-center gap-1 font-medium mb-0.5">
                                <span aria-hidden="true">{dot}</span>
                                <span>{t(`growthForecast.stage_${s.key}`, s.label)}</span>
                                {i < stages.length - 1 && <span aria-hidden="true" className="ml-auto text-gray-300 dark:text-gray-600">›</span>}
                            </div>
                            <div className="tabular-nums opacity-80">{isValueVisible ? s.metric : '•••'}</div>
                        </div>
                    );
                })}
            </div>

            {/* Disclaimer */}
            <div className="mt-4 flex items-start gap-1.5 text-xs text-gray-500 dark:text-gray-500">
                <InformationCircleIcon className="w-3.5 h-3.5 flex-shrink-0 mt-px" />
                <p>
                    {hasHistory
                        ? t('growthForecast.disclaimerHistory', 'The estimate replays your assumptions over the past 3 months so you can see how well it tracks reality. Future markets vary.')
                        : t('growthForecast.disclaimer', 'Estimate only. Assumes steady saving and a constant return — real markets vary.')}
                </p>
            </div>
        </Card>
    );
}
