'use client';

import { useMemo } from 'react';
import { useGoals, type Goal } from './useGoals';
import { portfolioCreditedGoal } from '@/utils/goalMatchers';

/**
 * Financial journey stages based on portfolio value relative to goals.
 * Each stage provides motivation through clear progression milestones.
 */
type FinancialStage =
    | 'starting'       // Just getting started, building habits
    | 'foundation'     // Emergency fund building
    | 'accumulating'   // Active saving & investing phase
    | 'growing'        // Compound growth is visible
    | 'accelerating'   // Momentum is strong, halfway+
    | 'coasting'       // Could stop contributing, growth carries you
    | 'independence'   // Financially independent / retired
    ;

export interface StageInfo {
    key: FinancialStage;
    label: string;
    emoji: string;
    description: string;
    motivationalMessage: string;
    color: string;
    bgGradient: string;
    borderColor: string;
    minProgress: number; // minimum % to enter this stage
}

export const FINANCIAL_STAGES: StageInfo[] = [
    {
        key: 'starting',
        label: 'Getting Started',
        emoji: '🌱',
        description: 'Building your financial foundation',
        motivationalMessage: 'Every expert was once a beginner. Your first step matters most!',
        color: 'text-emerald-600 dark:text-emerald-400',
        bgGradient: 'from-emerald-50 to-emerald-100 dark:from-emerald-900/20 dark:to-emerald-800/20',
        borderColor: 'border-emerald-200 dark:border-emerald-800/50',
        minProgress: 0,
    },
    {
        key: 'foundation',
        label: 'Building Foundation',
        emoji: '🧱',
        description: 'Establishing safety nets & good habits',
        motivationalMessage: 'A strong foundation makes everything else possible. Keep stacking!',
        color: 'text-blue-600 dark:text-blue-400',
        bgGradient: 'from-blue-50 to-blue-100 dark:from-blue-900/20 dark:to-blue-800/20',
        borderColor: 'border-blue-200 dark:border-blue-800/50',
        minProgress: 5,
    },
    {
        key: 'accumulating',
        label: 'Accumulating',
        emoji: '📈',
        description: 'Actively growing your wealth',
        motivationalMessage: 'You\'re building real momentum. Each contribution compounds over time!',
        color: 'text-indigo-600 dark:text-indigo-400',
        bgGradient: 'from-indigo-50 to-indigo-100 dark:from-indigo-900/20 dark:to-indigo-800/20',
        borderColor: 'border-indigo-200 dark:border-indigo-800/50',
        minProgress: 15,
    },
    {
        key: 'growing',
        label: 'Growth Phase',
        emoji: '🌳',
        description: 'Compound growth is working for you',
        motivationalMessage: 'Your money is making money. The snowball effect is real!',
        color: 'text-purple-600 dark:text-purple-400',
        bgGradient: 'from-purple-50 to-purple-100 dark:from-purple-900/20 dark:to-purple-800/20',
        borderColor: 'border-purple-200 dark:border-purple-800/50',
        minProgress: 30,
    },
    {
        key: 'accelerating',
        label: 'Accelerating',
        emoji: '🚀',
        description: 'Past the halfway mark — unstoppable momentum',
        motivationalMessage: 'More than halfway there! Your future self is cheering you on!',
        color: 'text-amber-600 dark:text-amber-400',
        bgGradient: 'from-amber-50 to-amber-100 dark:from-amber-900/20 dark:to-amber-800/20',
        borderColor: 'border-amber-200 dark:border-amber-800/50',
        minProgress: 50,
    },
    {
        key: 'coasting',
        label: 'Coast FIRE',
        emoji: '⛵',
        description: 'Growth alone could carry you to the goal',
        motivationalMessage: 'Even without new contributions, time is on your side. Amazing work!',
        color: 'text-teal-600 dark:text-teal-400',
        bgGradient: 'from-teal-50 to-teal-100 dark:from-teal-900/20 dark:to-teal-800/20',
        borderColor: 'border-teal-200 dark:border-teal-800/50',
        minProgress: 75,
    },
    {
        key: 'independence',
        label: 'Financial Freedom',
        emoji: '🏆',
        description: 'You\'ve reached financial independence!',
        motivationalMessage: 'Congratulations! You\'ve achieved what most only dream of. Freedom!',
        color: 'text-amber-600 dark:text-amber-400',
        bgGradient: 'from-yellow-50 to-amber-100 dark:from-yellow-900/20 dark:to-amber-800/20',
        borderColor: 'border-yellow-300 dark:border-yellow-700/50',
        minProgress: 100,
    },
];

export interface RetirementProjection {
    /** Current total portfolio value */
    currentValue: number;
    /** Target retirement/FIRE number */
    targetValue: number;
    /** Overall progress percentage (0-100+) */
    progressPercent: number;
    /** Current financial stage */
    stage: StageInfo;
    /** Index of current stage (0-6) */
    stageIndex: number;
    /** Estimated monthly savings rate based on portfolio growth */
    estimatedMonthlySavings: number;
    /** Years to reach target at current pace */
    yearsToTarget: number | null;
    /** Target year for reaching independence */
    targetYear: number | null;
    /** Projected milestones with amounts and dates */
    milestones: MilestonePoint[];
    /** Whether user has set up retirement goals */
    hasRetirementGoal: boolean;
    /** The retirement goal if found */
    retirementGoal: Goal | null;
    /** All active goals for context */
    goals: Goal[];
    /** Whether data is loading */
    isLoading: boolean;
    /** Safe withdrawal amount (4% rule) */
    safeWithdrawalAmount: number;
    /** Monthly passive income at current portfolio size */
    monthlyPassiveIncome: number;
    /**
     * Monthly contribution required to reach targetValue by the goal's target date.
     * Uses PMT formula: PMT = (FV - PV*(1+r)^n) * r / ((1+r)^n - 1)
     * Returns null if goal has no target date and yearsToTarget is unknown.
     */
    monthlyRequired: number | null;
}

export interface MilestonePoint {
    /** Stable id the UI translates against — never the label. */
    key: string;
    label: string;
    amount: number;
    emoji: string;
    reached: boolean;
    progress: number; // 0-100 for this specific milestone
}

function getStageForProgress(progress: number): { stage: StageInfo; index: number } {
    let stageIndex = 0;
    for (let i = FINANCIAL_STAGES.length - 1; i >= 0; i--) {
        if (progress >= FINANCIAL_STAGES[i].minProgress) {
            stageIndex = i;
            break;
        }
    }
    return { stage: FINANCIAL_STAGES[stageIndex], index: stageIndex };
}

function generateMilestones(targetValue: number, currentValue: number): MilestonePoint[] {
    // Create meaningful milestones based on target
    // `key` is what the UI translates against. The label was the only
    // identifier these had, so a copy change would have silently swapped a
    // milestone's translation for its neighbour's.
    const milestoneRatios = [
        { ratio: 0.01, key: 'firstStep', label: 'First Step', emoji: '👣' },
        { ratio: 0.05, key: 'foundation', label: 'Foundation', emoji: '🧱' },
        { ratio: 0.10, key: 'tenPercent', label: '10% Mark', emoji: '🎯' },
        { ratio: 0.25, key: 'quarter', label: 'Quarter Way', emoji: '📊' },
        { ratio: 0.50, key: 'halfway', label: 'Halfway', emoji: '⚡' },
        { ratio: 0.75, key: 'threeQuarters', label: 'Three Quarters', emoji: '🔥' },
        { ratio: 1.00, key: 'freedom', label: 'Freedom!', emoji: '🏆' },
    ];

    return milestoneRatios.map(({ ratio, key, label, emoji }) => {
        const amount = targetValue * ratio;
        const reached = currentValue >= amount;
        const progress = reached ? 100 : Math.min(100, (currentValue / amount) * 100);
        return { key, label, amount, emoji, reached, progress };
    });
}

/**
 * Hook that computes retirement/financial independence projections
 * from portfolio data and financial goals.
 */
export function useRetirementProjection(portfolioData: {
    totalValue?: number;
    totalCost?: number;
    totalGainLoss?: number;
    totalGainLossPercentage?: number;
    currency?: string;
    holdings?: unknown[];
} | null): RetirementProjection {
    // Fetch user's goals - fetch ALL goals (not just active) to ensure retirement goal is found
    // This is important because the retirement goal might be paused/completed but still needed for editing
    const { data: goals = [], isLoading: isLoadingGoals } = useGoals();

    return useMemo(() => {
        const currentValue = portfolioData?.totalValue || 0;
        const totalCost = portfolioData?.totalCost || 0;

        // Find retirement goal — first by explicit retirement category/keywords
        // (isRetirementGoal, shared with GoalsOverview so the dashboard and
        // portfolio page recognize the same goal consistently), then fall
        // back to the goal with the largest target amount so the "Edit Goal"
        // button always has something to open when goals exist.
        const retirementGoal = portfolioCreditedGoal(goals) || (goals.length > 0
            ? goals.reduce((largest, g) =>
                (g.targetAmount || 0) > (largest.targetAmount || 0) ? g : largest
              )
            : null);

        // Use retirement goal target, or estimate based on 25x annual expenses (4% rule)
        // Default to a reasonable target if no goal set
        const hasRetirementGoal = !!retirementGoal;
        const targetValue = retirementGoal?.targetAmount ||
            // If no goal, use 25x of current portfolio value as a big stretch target
            // Or a minimum default target
            Math.max(currentValue * 3, 10000000); // At least 10M TWD or 3x current

        const progressPercent = targetValue > 0 ? (currentValue / targetValue) * 100 : 0;
        const { stage, index: stageIndex } = getStageForProgress(progressPercent);

        // Estimate monthly savings from total cost & portfolio age
        // Rough heuristic: assume portfolio was built over time
        const holdingsCount = portfolioData?.holdings?.length || 0;
        const estimatedMonths = Math.max(12, holdingsCount * 2); // rough estimate
        const estimatedMonthlySavings = totalCost > 0 ? totalCost / estimatedMonths : 0;

        // Project years to target
        const remaining = targetValue - currentValue;
        const annualReturn = 0.07; // Assume 7% annual return
        let yearsToTarget: number | null = null;

        if (remaining <= 0) {
            yearsToTarget = 0;
        } else if (estimatedMonthlySavings > 0) {
            // Use future value of annuity formula
            // FV = PMT * ((1 + r)^n - 1) / r + PV * (1 + r)^n
            const monthlyRate = annualReturn / 12;
            const monthlySavings = estimatedMonthlySavings;

            // Binary search for n (months) where FV >= target
            let low = 0, high = 600; // max 50 years
            while (high - low > 1) {
                const mid = Math.floor((low + high) / 2);
                const fv = currentValue * Math.pow(1 + monthlyRate, mid) +
                    monthlySavings * (Math.pow(1 + monthlyRate, mid) - 1) / monthlyRate;
                if (fv >= targetValue) high = mid;
                else low = mid;
            }
            yearsToTarget = Math.ceil(high / 12);
        } else if (currentValue > 0) {
            // Growth only, no contributions
            yearsToTarget = Math.ceil(Math.log(targetValue / currentValue) / Math.log(1 + annualReturn));
        }

        const targetYear = yearsToTarget !== null ? new Date().getFullYear() + yearsToTarget : null;

        // Safe withdrawal calculations (4% rule)
        const safeWithdrawalAmount = currentValue * 0.04;
        const monthlyPassiveIncome = safeWithdrawalAmount / 12;

        // Monthly required: PMT formula — how much to save per month to hit target by deadline
        // PMT = (FV - PV*(1+r)^n) * r / ((1+r)^n - 1)  where r = monthly rate, n = months
        //
        // IMPORTANT: we only use the goal's explicit targetDate here.
        // We deliberately avoid falling back to yearsToTarget because that value was
        // computed *with* estimated monthly savings already included (binary search).
        // Using it as the PMT deadline would be circular: "you need 3 years WITH savings,
        // therefore WITH no savings you still reach it in 3 years" → falsely shows "Set!".
        let monthlyRequired: number | null = null;
        const monthlyRate = annualReturn / 12;
        let monthsRemaining: number | null = null;

        if (retirementGoal?.targetDate) {
            const msRemaining = new Date(retirementGoal.targetDate).getTime() - Date.now();
            const months = Math.round(msRemaining / (1000 * 60 * 60 * 24 * 30.44));
            if (months > 0) monthsRemaining = months;
        }
        // No fallback to yearsToTarget — without an explicit deadline show null ("—")

        if (monthsRemaining !== null && monthsRemaining > 0 && remaining > 0) {
            const factor = Math.pow(1 + monthlyRate, monthsRemaining);
            // future value already covered by portfolio growth
            const fvFromCurrent = currentValue * factor;
            const stillNeeded = targetValue - fvFromCurrent;
            if (stillNeeded <= 0) {
                // portfolio growth alone covers the gap
                monthlyRequired = 0;
            } else {
                monthlyRequired = (stillNeeded * monthlyRate) / (factor - 1);
            }
        }

        const milestones = generateMilestones(targetValue, currentValue);

        return {
            currentValue,
            targetValue,
            progressPercent: Math.min(progressPercent, 150), // cap at 150% for display
            stage,
            stageIndex,
            estimatedMonthlySavings,
            yearsToTarget,
            targetYear,
            milestones,
            hasRetirementGoal,
            retirementGoal,
            goals,
            isLoading: isLoadingGoals,
            safeWithdrawalAmount,
            monthlyPassiveIncome,
            monthlyRequired,
        };
    }, [portfolioData, goals, isLoadingGoals]);
}
