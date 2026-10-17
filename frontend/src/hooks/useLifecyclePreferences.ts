'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { DEFAULT_LIFECYCLE } from '@/lib/lifecycle';

/**
 * Settings for the lifecycle-investing tracker.
 *
 * Kept in localStorage rather than on the user record: these are planning
 * assumptions the page reads back, not financial facts other features depend
 * on, and `DebtAccount` has no field marking a loan's purpose — so which loans
 * count as investment debt is a choice this page has to remember on its own.
 */
export interface LifecyclePreferences {
    /** Birth year, used to derive current age. */
    birthYear: number;
    retirementAge: number;
    /** Target share of lifetime wealth in stocks, in percent. */
    samuelsonSharePct: number;
    /** Hard leverage ceiling — the book's rule is 2:1. */
    maxLeverage: number;
    /** Discount rate applied to future savings. */
    discountRatePct: number;
    /** Expected annual growth of your savings. */
    savingsGrowthPct: number;
    /** Expected annual portfolio return, used for the projection. */
    expectedReturnPct: number;
    /** Share of monthly savings routed into stocks, 0–100. */
    investedSharePct: number;
    /** IDs of the loans taken on to invest. Empty = none selected yet. */
    investmentLoanIds: string[];
    /** Set once the user has picked their loans, so we stop nagging. */
    loansConfigured: boolean;
}

const STORAGE_KEY = 'aspiro-lifecycle-preferences';

const CURRENT_YEAR = new Date().getFullYear();

export const DEFAULT_LIFECYCLE_PREFERENCES: LifecyclePreferences = {
    birthYear: CURRENT_YEAR - 30,
    retirementAge: DEFAULT_LIFECYCLE.retirementAge,
    samuelsonSharePct: DEFAULT_LIFECYCLE.samuelsonSharePct,
    maxLeverage: DEFAULT_LIFECYCLE.maxLeverage,
    discountRatePct: DEFAULT_LIFECYCLE.discountRatePct,
    savingsGrowthPct: DEFAULT_LIFECYCLE.savingsGrowthPct,
    expectedReturnPct: DEFAULT_LIFECYCLE.expectedReturnPct,
    investedSharePct: DEFAULT_LIFECYCLE.investedSharePct,
    investmentLoanIds: [],
    loansConfigured: false,
};

/**
 * Bounds for every stored number, matching the sliders that set them.
 *
 * Enforced on read, not just in the UI: localStorage outlives any given app
 * version and can be hand-edited, so a stale or tampered value would otherwise
 * flow straight into the calculators — a `maxLeverage` of 50 silently rewrites
 * the ceiling the whole page is measured against.
 */
const BOUNDS: Record<string, readonly [number, number]> = {
    birthYear: [1950, CURRENT_YEAR - 18],
    retirementAge: [45, 80],
    samuelsonSharePct: [30, 100],
    maxLeverage: [1, 2],
    discountRatePct: [0, 10],
    savingsGrowthPct: [0, 8],
    expectedReturnPct: [0, 12],
    investedSharePct: [0, 100],
};

export function coerceLifecyclePreferences(
    parsed: Partial<LifecyclePreferences>,
): LifecyclePreferences {
    const d = DEFAULT_LIFECYCLE_PREFERENCES;
    const num = (key: keyof typeof BOUNDS, v: unknown, fallback: number) => {
        if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
        const [lo, hi] = BOUNDS[key];
        return Math.min(hi, Math.max(lo, v));
    };
    return {
        birthYear: num('birthYear', parsed.birthYear, d.birthYear),
        retirementAge: num('retirementAge', parsed.retirementAge, d.retirementAge),
        samuelsonSharePct: num('samuelsonSharePct', parsed.samuelsonSharePct, d.samuelsonSharePct),
        maxLeverage: num('maxLeverage', parsed.maxLeverage, d.maxLeverage),
        discountRatePct: num('discountRatePct', parsed.discountRatePct, d.discountRatePct),
        savingsGrowthPct: num('savingsGrowthPct', parsed.savingsGrowthPct, d.savingsGrowthPct),
        expectedReturnPct: num('expectedReturnPct', parsed.expectedReturnPct, d.expectedReturnPct),
        investedSharePct: num('investedSharePct', parsed.investedSharePct, d.investedSharePct),
        investmentLoanIds: Array.isArray(parsed.investmentLoanIds)
            ? parsed.investmentLoanIds.filter((id): id is string => typeof id === 'string')
            : d.investmentLoanIds,
        loansConfigured: parsed.loansConfigured ?? d.loansConfigured,
    };
}

export function useLifecyclePreferences() {
    const [preferences, setPreferences] = useState<LifecyclePreferences>(DEFAULT_LIFECYCLE_PREFERENCES);
    const [isLoaded, setIsLoaded] = useState(false);

    useEffect(() => {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) setPreferences(coerceLifecyclePreferences(JSON.parse(raw) as Partial<LifecyclePreferences>));
        } catch {
            setPreferences(DEFAULT_LIFECYCLE_PREFERENCES);
        } finally {
            setIsLoaded(true);
        }
    }, []);

    const persist = useCallback((next: LifecyclePreferences) => {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        } catch {
            // Private browsing / quota — the page still works for this session.
        }
    }, []);

    const updatePreference = useCallback(
        <K extends keyof LifecyclePreferences>(key: K, value: LifecyclePreferences[K]) => {
            setPreferences((prev) => {
                const next = { ...prev, [key]: value };
                persist(next);
                return next;
            });
        },
        [persist],
    );

    /**
     * Pin the investment-loan selection.
     *
     * Callers pass the complete list because until this is called the effective
     * selection is *derived* (see `defaultInvestmentLoanIds`), not stored — so a
     * toggle has to be computed against what the user can actually see ticked,
     * not against the empty array sitting in storage.
     */
    const setInvestmentLoanIds = useCallback(
        (ids: string[]) => {
            setPreferences((prev) => {
                const next: LifecyclePreferences = {
                    ...prev,
                    investmentLoanIds: ids,
                    loansConfigured: true,
                };
                persist(next);
                return next;
            });
        },
        [persist],
    );

    const resetPreferences = useCallback(() => {
        setPreferences(DEFAULT_LIFECYCLE_PREFERENCES);
        persist(DEFAULT_LIFECYCLE_PREFERENCES);
    }, [persist]);

    const currentAge = Math.max(18, CURRENT_YEAR - preferences.birthYear);

    return useMemo(
        () => ({ preferences, currentAge, isLoaded, updatePreference, setInvestmentLoanIds, resetPreferences }),
        [preferences, currentAge, isLoaded, updatePreference, setInvestmentLoanIds, resetPreferences],
    );
}

/**
 * Loan types that plausibly funded a portfolio, used to pick a sensible default
 * before the user has said anything.
 *
 * Anyone opening this page is by definition borrowing to invest, so defaulting
 * to "nothing selected" leaves every gauge reading zero on first visit. A
 * mortgage, car or student loan is never investment debt; a personal loan
 * (信貸) — the margin substitute this strategy actually uses in Taiwan — nearly
 * always is.
 */
const AUTO_SELECT_TYPES = new Set(['personal_loan', 'other']);

export function defaultInvestmentLoanIds(
    loans: { id: string; status: string; account_type: string }[],
): string[] {
    return loans
        .filter((l) => l.status === 'active' && AUTO_SELECT_TYPES.has(l.account_type))
        .map((l) => l.id);
}
