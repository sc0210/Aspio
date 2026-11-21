'use client';

import { useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useAppMode } from '@/hooks/useAppMode';
import { useOptimizedDashboard } from '@/hooks/useOptimizedDashboard';
import { useAnnualCashFlow } from '@/hooks/useAnnualCashFlow';
import { projectBuyVsRent, loanTermsOf, DEFAULT_BUY_VS_RENT, DEFAULT_TARGETS, type HouseTimelineContext } from '@/lib/housing';
import { calcAffordability, type AffordabilityInputs } from '@/lib/housing/affordability';
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
/** What the simulator's default terms imply at `housePrice`. */
function derivedAt(housePrice: number): SimulatorDerived {
    const inputs = { ...DEFAULT_BUY_VS_RENT, housePrice };
    const r = housePrice === DEFAULT_BUY_VS_RENT.housePrice ? INITIAL : projectBuyVsRent(inputs);
    return {
        housePrice,
        upfrontCash: r.upfrontCash,
        monthlyPayment: r.monthlyPayment,
        monthlyHousingCost: r.monthlyPayment + (housePrice * inputs.ownershipCostPctPerYear) / 100 / 12,
        terms: loanTermsOf(inputs),
    };
}

export const INITIAL_DERIVED: SimulatorDerived = derivedAt(DEFAULT_BUY_VS_RENT.housePrice);

/**
 * The inputs every /housing panel reads, from the user's real balances and cash
 * flow, given what the simulator currently implies. Shared by the full page and
 * the phone view so the two cannot disagree. Also redirects a signed-out visitor.
 */
export function useHousingModel(derived: SimulatorDerived) {
    const { isAuthenticated, isDemo, isLoading: authLoading } = useAppMode();
    const router = useRouter();

    const { data: dash, isLoading: dashLoading, isError: dashFailed, refetch: refetchDash } = useOptimizedDashboard('month');
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

    // The price the plan starts from: what the affordability headline calls
    // comfortable, floored to a 10萬 step. It used to be a fixed NT$25M default the
    // page never showed, so "Am I ready to buy?" scored a house far above the one
    // the headline recommended — and on phones it could not be changed at all.
    // Priced on the default terms, not the simulator's: the desktop simulator's
    // price follows this until the user sets one, so it must move only with the
    // user's data, never with their own slider changes.
    const startingPrice = useMemo(() => {
        const max = calcAffordability({ ...affordability, ...loanTermsOf(DEFAULT_BUY_VS_RENT) }).maxPrice;
        // Check the floored value: under NT$100K it floors to 0, a free house.
        const floored = Math.floor(max / 100_000) * 100_000;
        return floored > 0 ? floored : DEFAULT_BUY_VS_RENT.housePrice;
    }, [affordability]);
    const startingDerived: SimulatorDerived = useMemo(() => derivedAt(startingPrice), [startingPrice]);

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

    // The 12-month basis too: until it arrives the seed falls back to one month.
    const showSpinner = authLoading || (isAuthenticated && ((dashLoading && !stats) || cashFlow.isLoading));

    // With no stats every input is 0, and the verdicts read as confident answers
    // about NT$0 of assets. Say the data did not load instead.
    // The 12-month cash flow too: failed, the seed quietly fell back to one month.
    const cashFlowFailed = cashFlow.isError && !cashFlow.hasData;
    const loadFailed = !isDemo && ((dashFailed && !stats) || cashFlowFailed);
    const retry = () => {
        if (dashFailed) void refetchDash();
        if (cashFlowFailed) cashFlow.refetch();
    };

    return { seed, affordability, houseContext, cashFlowBasisMonths, showSpinner, loadFailed, retry, startingPrice, startingDerived };
}
