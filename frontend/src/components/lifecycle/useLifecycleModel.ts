'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toTWD } from '@/utils/formatters';
import { useAppMode } from '@/hooks/useAppMode';
import { useOptimizedDashboard } from '@/hooks/useOptimizedDashboard';
import { useAnnualCashFlow } from '@/hooks/useAnnualCashFlow';
import { useLoans } from '@/hooks/useLoans';
import { useWalletTrends } from '@/hooks/useWalletTrends';
import { usePortfolioTwr } from '@/hooks/usePortfolioTwr';
import { usePortfolio } from '@/hooks/usePortfolio';
import { useLifecyclePreferences, defaultInvestmentLoanIds } from '@/hooks/useLifecyclePreferences';
import {
    aggregateDebt,
    computeTarget,
    evaluatePosition,
    evaluateSpread,
    evaluateStress,
    evaluateTracking,
    portfolioRealizedReturnPct,
    presentValueOfFutureSavings,
    freedPaymentFrom,
    totalInterestToDate,
    type LifecycleLoan,
} from '@/lib/lifecycle';
import type { GlidepathSeed } from '@/components/lifecycle/GlidepathPanel';
import type { LeverageHistoryPeriod } from '@/components/lifecycle/LeverageHistoryPanel';

/**
 * Money fields are typed `number` but arrive as STRINGS.
 *
 * They are `Decimal` on the backend and Pydantic serialises Decimal to a JSON
 * string ("2760000.00") — confirmed for both `DashboardStatsResponse` and the
 * loan schemas, and neither `dashboardService.getDashboardStats` nor
 * `useLoans` coerces on the way through. TypeScript cannot catch it because
 * the interfaces declare `number`, and most arithmetic (`-`, `*`, `Math.max`)
 * coerces silently, so the failure only surfaces where `+` is used and
 * concatenates. Coerce at this boundary; do not trust the declared types.
 *
 * The same trap produced the 總負債 card reading NT$0 (commit f51c7333).
 */
const num = (v: unknown): number => {
    const n = Number(v ?? 0);
    return Number.isFinite(n) ? n : 0;
};

/**
 * Everything /lifecycle derives, from the wallets, the loan records and the
 * per-holding IRR. Moved out of the page so the phone view (#344) reads the same
 * figures instead of a second copy of this arithmetic. Also redirects a
 * signed-out visitor.
 */
/** Share of TWR valuations that must rest on real stored closes before it is shown. */
const TWR_MIN_REAL_PRICE_SHARE = 0.9;

export function useLifecycleModel() {
    const { isAuthenticated, isDemo, isLoading: authLoading } = useAppMode();
    const router = useRouter();

    const { data: dash, isLoading: dashLoading } = useOptimizedDashboard('month');
    const stats = dash?.data?.stats;

    // Trailing 12-month average — a stable cash-flow basis that smooths
    // seasonal spikes, the same seed the housing page uses.
    const cashFlow = useAnnualCashFlow();
    const { loans } = useLoans();
    const { holdings } = usePortfolio();
    const { preferences, currentAge, updatePreference, setInvestmentLoanIds } = useLifecyclePreferences();

    // Until the user pins a selection, default to their personal loans rather
    // than to nothing — otherwise the page reads zero on first visit for exactly
    // the people it is built for.
    const selectedLoanIds = useMemo(
        () => (preferences.loansConfigured
            ? preferences.investmentLoanIds
            : defaultInvestmentLoanIds(loans)),
        [preferences.loansConfigured, preferences.investmentLoanIds, loans],
    );

    const toggleLoan = useCallback(
        (loanId: string) => {
            setInvestmentLoanIds(
                selectedLoanIds.includes(loanId)
                    ? selectedLoanIds.filter((id) => id !== loanId)
                    : [...selectedLoanIds, loanId],
            );
        },
        [selectedLoanIds, setInvestmentLoanIds],
    );

    useEffect(() => {
        if (authLoading || isAuthenticated || isDemo) return;
        // DemoContext turns the demo cookie into `isDemo` in its own effect, one
        // render after NextAuth reports `unauthenticated`. Reading the same
        // cookie here closes that gap — otherwise a demo visitor gets bounced to
        // sign-in on the render in between.
        const demoCookie = document.cookie
            .split('; ')
            .find((row) => row.startsWith('demo-mode='))
            ?.split('=')[1];
        if (demoCookie === 'true') return;
        router.replace('/auth/signin');
    }, [authLoading, isAuthenticated, isDemo, router]);

    // ---- The position today -------------------------------------------------

    const monthlyIncome = cashFlow.hasData ? cashFlow.avgMonthlyIncome : num(stats?.monthlyIncome);
    const monthlyExpenses = cashFlow.hasData ? cashFlow.avgMonthlyExpense : num(stats?.monthlyExpenses);
    const monthlySavings = monthlyIncome - monthlyExpenses;
    const cashFlowBasisMonths = cashFlow.hasData ? cashFlow.monthsAveraged : 0;

    const stockExposure = num(stats?.portfolio_wallet);
    // `num()` is load-bearing here, not decoration: these two are added, and if
    // they arrive as strings `+` concatenates instead of summing.
    const lifeCash = num(stats?.life_wallet);
    const cashAssets = lifeCash + num(stats?.emergency_wallet);
    // Reserves you could reach without selling stock. The Emergency wallet is
    // the intended buffer; Life cash counts because it is equally reachable.
    const liquidReserve = cashAssets;

    // Only the loans the user marked as investment debt drive the strategy.
    const investmentLoans: LifecycleLoan[] = useMemo(
        () =>
            loans
                .filter((l) => l.status === 'active' && selectedLoanIds.includes(l.id))
                .map((l) => ({
                    id: l.id,
                    name: l.name,
                    currentBalance: num(l.current_balance),
                    principalAmount: num(l.principal_amount),
                    annualRatePct: num(l.interest_rate),
                    monthlyPayment: num(l.minimum_payment),
                    startDate: l.start_date,
                    termMonths: l.term_months === null ? null : num(l.term_months),
                })),
        [loans, selectedLoanIds],
    );

    // History needs the loans the *window* saw, not the ones outstanding today:
    // one repaid two months ago is closed now but was real debt for most of a
    // 90-day window, and dropping it would flatten exactly the deleveraging the
    // chart exists to show. `debtBalanceAt` reconstructs each balance, so a
    // closed loan contributes zero on the days after it was cleared anyway.
    const historyLoans: LifecycleLoan[] = useMemo(
        () =>
            loans
                .filter((l) => selectedLoanIds.includes(l.id))
                .map((l) => ({
                    id: l.id,
                    name: l.name,
                    currentBalance: num(l.current_balance),
                    principalAmount: num(l.principal_amount),
                    annualRatePct: num(l.interest_rate),
                    monthlyPayment: num(l.minimum_payment),
                    startDate: l.start_date,
                    termMonths: l.term_months === null ? null : num(l.term_months),
                })),
        [loans, selectedLoanIds],
    );

    const [historyPeriod, setHistoryPeriod] = useState<LeverageHistoryPeriod>('90d');
    const { data: walletTrend, isLoading: trendLoading } = useWalletTrends(historyPeriod);

    const debt = useMemo(() => aggregateDebt(investmentLoans), [investmentLoans]);
    const interest = useMemo(() => totalInterestToDate(investmentLoans), [investmentLoans]);

    // Memoised: it feeds a useMemo inside the panel, and a fresh object literal
    // every render would rebuild the whole series on every render.
    const livePosition = useMemo(
        () => ({ stockExposure, cashAssets, investmentDebt: debt.balance }),
        [stockExposure, cashAssets, debt.balance],
    );

    // Debt outside the strategy (mortgage, car) — reduces net worth but is not
    // part of the leverage ratio.
    const otherDebt = Math.max(0, num(stats?.total_debt) - debt.balance);

    const position = useMemo(
        () => evaluatePosition({ stockExposure, cashAssets, investmentDebt: debt.balance, otherDebt }),
        [stockExposure, cashAssets, debt.balance, otherDebt],
    );

    // ---- The target ---------------------------------------------------------

    const target = useMemo(() => {
        const pv = presentValueOfFutureSavings({
            monthlySavings: Math.max(0, monthlySavings),
            yearsToRetirement: Math.max(0, preferences.retirementAge - currentAge),
            discountRatePct: preferences.discountRatePct,
            savingsGrowthPct: preferences.savingsGrowthPct,
            // Today's savings are suppressed by the loan payment, and that ends
            // on a date we can compute. Price the raise in now, exactly as the
            // glidepath does, so this headline target and the chart's year-0
            // point cannot disagree.
            // Shared with the glidepath so the headline target and the chart's
            // year-0 point cannot derive this differently.
            ...freedPaymentFrom(debt.balance, debt.blendedRatePct, debt.monthlyPayment),
        });
        return computeTarget({
            netFinancialAssets: position.netFinancialAssets,
            pvFutureSavings: pv,
            samuelsonSharePct: preferences.samuelsonSharePct,
            maxLeverage: preferences.maxLeverage,
        });
    }, [monthlySavings, currentAge, preferences, position.netFinancialAssets, debt]);

    const tracking = useMemo(
        () => evaluateTracking(position, target.targetLeverage, target.targetExposure, preferences.maxLeverage),
        [position, target, preferences.maxLeverage],
    );

    // ---- Spread and stress --------------------------------------------------

    // Weights must be FX-normalised: `totalValue` is in the holding's own
    // currency, so weighting raw values would under-count a US position by the
    // USD/TWD rate and skew the blended IRR toward the TW book.
    //
    // Preferred: the time-weighted return since inception (backend `twr.py`),
    // which takes the timing of your own deposits out. The value-weighted
    // per-lot IRR is the fallback for demo mode and for a portfolio under a
    // year old, where TWR declines to annualise.
    const { data: twr } = usePortfolioTwr();
    const lotsReturnPct = useMemo(
        () => portfolioRealizedReturnPct(
            // The same set TWR measures: the Portfolio wallet, not the Emergency
            // reserve, so switching between the two sources changes the method,
            // not what is being measured.
            holdings.filter((h) => h.walletType !== 'emergency').map((h) => ({
                totalValue: toTWD(Number(h.totalValue) || 0, h.currency || 'TWD'),
                irr: h.irr,
            })),
        ),
        [holdings],
    );
    const realizedReturn = useMemo((): { pct: number | null; source: 'twr' | 'lots' | null; since: string | null } => {
        // Only when it rests on real prices: a TWR valued mostly on buy prices or
        // stale closes would look authoritative and drive the spread verdict.
        if (twr?.annualizedReturnPct != null && (twr.realPriceShare ?? 0) >= TWR_MIN_REAL_PRICE_SHARE) {
            return { pct: twr.annualizedReturnPct, source: 'twr', since: twr.startDate };
        }
        return { pct: lotsReturnPct, source: lotsReturnPct === null ? null : 'lots', since: null };
    }, [twr, lotsReturnPct]);
    const realizedReturnPct = realizedReturn.pct;

    const spread = useMemo(
        () => evaluateSpread({
            realizedReturnPct,
            borrowingCostPct: debt.blendedRatePct,
            debtBalance: debt.balance,
        }),
        [realizedReturnPct, debt.blendedRatePct, debt.balance],
    );

    const stress = useMemo(
        () => evaluateStress({
            stockExposure,
            cashAssets,
            investmentDebt: debt.balance,
            monthlyPayment: debt.monthlyPayment,
            monthlySavings,
            liquidReserve,
        }),
        [stockExposure, cashAssets, debt.balance, debt.monthlyPayment, monthlySavings, liquidReserve],
    );

    const glidepathSeed: GlidepathSeed = useMemo(
        () => ({
            stockExposure,
            cashAssets,
            debtBalance: debt.balance,
            debtAnnualRatePct: debt.blendedRatePct,
            debtMonthlyPayment: debt.monthlyPayment,
            monthlySavings,
            currentAge,
        }),
        [stockExposure, cashAssets, debt, monthlySavings, currentAge],
    );

    const showSpinner = authLoading || (isAuthenticated && dashLoading && !stats);


    return {
        realizedReturn, lifeCash, position, target, tracking, preferences, walletTrend, historyLoans, livePosition, historyPeriod, setHistoryPeriod, trendLoading, stress, cashFlowBasisMonths, glidepathSeed, updatePreference, spread, debt, interest, realizedReturnPct, loans, selectedLoanIds, toggleLoan, showSpinner,
    };
}
