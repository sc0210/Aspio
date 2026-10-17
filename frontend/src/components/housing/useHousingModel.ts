'use client';

import { useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useAppMode } from '@/hooks/useAppMode';
import { useOptimizedDashboard } from '@/hooks/useOptimizedDashboard';
import { useAnnualCashFlow } from '@/hooks/useAnnualCashFlow';
import { projectBuyVsRent, loanTermsOf, DEFAULT_BUY_VS_RENT, DEFAULT_TARGETS, type HouseTimelineContext } from '@/lib/housing';
import type { AffordabilityInputs } from '@/lib/housing/affordability';
import type { ReadinessSeed } from '@/components/housing/ReadinessScorecard';
import type { SimulatorDerived } from '@/components/housing/BuyVsRentSimulator';

const INITIAL = projectBuyVsRent(DEFAULT_BUY_VS_RENT);

/**
 * Constant starting point so the readiness card has sane cash figures before the
 * simulator mounts and reports its own derived values.
 *
 * What the simulator's defaults imply, before anyone touches it. The full page
 * replaces it as the simulator changes; the phone view (#344) has no simulator,
 * so it reads the plan on these defaults throughout.
 */
export const INITIAL_DERIVED: SimulatorDerived = {
    housePrice: DEFAULT_BUY_VS_RENT.housePrice,
    upfrontCash: INITIAL.upfrontCash,
    monthlyPayment: INITIAL.monthlyPayment,
    monthlyHousingCost:
        INITIAL.monthlyPayment +
        (DEFAULT_BUY_VS_RENT.housePrice * DEFAULT_BUY_VS_RENT.ownershipCostPctPerYear) / 100 / 12,
    terms: loanTermsOf(DEFAULT_BUY_VS_RENT),
};

/**
 * The inputs every /housing panel reads, from the user's real balances and cash
 * flow, given what the simulator currently implies. Shared by the full page and
 * the phone view so the two cannot disagree. Also redirects a signed-out visitor.
 */
export function useHousingModel(derived: SimulatorDerived) {
    const { isAuthenticated, isDemo, isLoading: authLoading } = useAppMode();
    const router = useRouter();

    const { data: dash, isLoading: dashLoading } = useOptimizedDashboard('month');
    const stats = dash?.data?.stats;
    // Trailing 12-month average for income/expenses — a stable cash-flow basis
    // that smooths seasonal spikes, far better than a single current month.
    const cashFlow = useAnnualCashFlow();

    useEffect(() => {
        if (!authLoading && !isAuthenticated && !isDemo) router.replace('/auth/signin');
    }, [authLoading, isAuthenticated, isDemo, router]);

    const seed: ReadinessSeed = useMemo(
        () => ({
            debtBalance: stats?.total_debt ?? 0,
            // 可動用資金: cash (Life) + easily-liquidated investments (Portfolio).
            liquidFunds: (stats?.life_wallet ?? 0) + (stats?.portfolio_wallet ?? 0),
            // 金融資產: all financial assets today (no property yet).
            financialAssets: stats?.total_asset ?? 0,
            // Prefer the trailing 12-month average; fall back to the dashboard's
            // current-month figure until enough history exists.
            monthlyIncome: cashFlow.hasData ? cashFlow.avgMonthlyIncome : (stats?.monthlyIncome ?? 0),
            monthlyExpenses: cashFlow.hasData ? cashFlow.avgMonthlyExpense : (stats?.monthlyExpenses ?? 0),
        }),
        [stats, cashFlow.hasData, cashFlow.avgMonthlyIncome, cashFlow.avgMonthlyExpense],
    );

    const cashFlowBasisMonths = cashFlow.hasData ? cashFlow.monthsAveraged : 0;

    // "What can I afford?" — same live figures as the scorecard, run backwards, and
    // priced on the borrowing terms currently set in the simulator. Reading the
    // constants instead left this headline answering for a 2.1% 30-year loan while
    // the card under it had already moved to whatever the user dragged.
    const affordability: AffordabilityInputs = useMemo(
        () => ({
            financialAssets: seed.financialAssets,
            liquidFunds: seed.liquidFunds,
            monthlyIncome: seed.monthlyIncome,
            monthlyExpenses: seed.monthlyExpenses,
            ...derived.terms,
        }),
        [seed, derived.terms],
    );

    // Context the car-impact panel measures a car purchase against.
    const houseContext: HouseTimelineContext = useMemo(
        () => ({
            currentLiquid: seed.liquidFunds,
            monthlySavings: Math.max(0, seed.monthlyIncome - seed.monthlyExpenses),
            liquidTarget: DEFAULT_TARGETS.liquidFundsMin,
            annualReturnPct: 6,
            currentDebt: seed.debtBalance,
        }),
        [seed.liquidFunds, seed.monthlyIncome, seed.monthlyExpenses, seed.debtBalance],
    );

    const showSpinner = authLoading || (isAuthenticated && dashLoading && !stats);

    return { seed, affordability, houseContext, cashFlowBasisMonths, showSpinner };
}
