'use client';

import { useMemo } from 'react';
import { useGoals } from './useGoals';
import { GOAL_CATEGORIES } from '@/utils/constants';

/**
 * Goal-backed planning on top of the Growth Forecast model.
 *
 * For each active goal it answers the three affordability questions:
 *  - ETA: at the current pace, when does projected NET WORTH reach the target?
 *  - Required extra/mo: to hit the target BY its date, how much more must be
 *    saved each month (on top of current net savings)?
 *  - Status: affordable now / on track / short by X / eta-only / unreachable.
 *
 * Uses the exact same monthly recurrence as useGrowthForecast (invested part
 * compounds, cash part doesn't), so chips and chart always agree.
 */

export interface PlanInputs {
    /** Today's net worth (assets − debt) — the forecast anchor. */
    netWorth: number;
    /** Invested portion (Portfolio wallet) — compounds at the return rate. */
    portfolioWallet: number;
    /** Current monthly net savings (may be negative). */
    monthlySavings: number;
    /** Expected annual return, percent. */
    annualReturnPct: number;
    /** Share of savings routed to investments, 0–100. */
    investedPct: number;
}

export type GoalPlanStatus = 'affordable' | 'onTrack' | 'short' | 'etaOnly' | 'unreachable';

export interface GoalPlan {
    id: string;
    title: string;
    icon: string;
    category: string;
    targetAmount: number;
    targetDate: string | null;
    /** Months from now until the projection first reaches the target. 0 = already affordable. */
    etaMonths: number | null;
    /** Additional monthly saving needed to reach the target by targetDate (0 = on track). */
    requiredExtraPerMonth: number | null;
    status: GoalPlanStatus;
}

/** Planning horizon cap — beyond 40 years we call it unreachable at current pace. */
export const MAX_PLAN_MONTHS = 480;

function clamp01(v: number) {
    return Math.min(1, Math.max(0, v));
}

/** Net-worth trajectory under the forecast recurrence, index = months from now. */
export function planTrajectory(inputs: PlanInputs, months: number = MAX_PLAN_MONTHS): number[] {
    const r = inputs.annualReturnPct / 100 / 12;
    const invFrac = clamp01(inputs.investedPct / 100);
    let port = Math.max(0, inputs.portfolioWallet);
    let cash = inputs.netWorth - port;
    const out: number[] = [port + cash];
    for (let m = 1; m <= months; m++) {
        port = port * (1 + r) + inputs.monthlySavings * invFrac;
        cash = cash + inputs.monthlySavings * (1 - invFrac);
        out.push(port + cash);
    }
    return out;
}

interface GoalLike {
    id: string;
    title: string;
    category: string;
    targetAmount: number;
    targetDate?: string | null;
}

/** Months from now (ceil) until the given date; null when absent or in the past. */
function monthsUntil(dateStr: string | null | undefined): number | null {
    if (!dateStr) return null;
    const ms = new Date(dateStr).getTime() - Date.now();
    if (!Number.isFinite(ms) || ms <= 0) return null;
    return Math.max(1, Math.ceil(ms / (1000 * 60 * 60 * 24 * 30.44)));
}

/** Pure planner — exported for unit tests. */
export function planGoals(inputs: PlanInputs, goals: GoalLike[]): GoalPlan[] {
    const trajectory = planTrajectory(inputs);
    const r = inputs.annualReturnPct / 100 / 12;
    const invFrac = clamp01(inputs.investedPct / 100);

    return goals.map((g) => {
        const icon = GOAL_CATEGORIES.find((c) => c.id === g.category)?.icon ?? '🎯';
        const target = g.targetAmount;

        // ETA: first month the projected net worth covers the target.
        let etaMonths: number | null = null;
        for (let m = 0; m < trajectory.length; m++) {
            if (trajectory[m] >= target) { etaMonths = m; break; }
        }

        const deadline = monthsUntil(g.targetDate);
        let requiredExtraPerMonth: number | null = null;
        let status: GoalPlanStatus;

        if (etaMonths === 0) {
            status = 'affordable';
            if (deadline !== null) requiredExtraPerMonth = 0;
        } else if (deadline !== null) {
            const fvPlan = trajectory[Math.min(deadline, MAX_PLAN_MONTHS)];
            if (fvPlan >= target) {
                status = 'onTrack';
                requiredExtraPerMonth = 0;
            } else {
                // Extra X/mo splits like other savings: invested share compounds
                // (annuity factor), cash share accumulates linearly.
                const m = deadline;
                const annuity = r > 0 ? (Math.pow(1 + r, m) - 1) / r : m;
                const growthPerUnit = invFrac * annuity + (1 - invFrac) * m;
                requiredExtraPerMonth = growthPerUnit > 0
                    ? Math.ceil((target - fvPlan) / growthPerUnit)
                    : null;
                status = 'short';
            }
        } else {
            status = etaMonths !== null ? 'etaOnly' : 'unreachable';
        }

        return {
            id: g.id,
            title: g.title,
            icon,
            category: g.category,
            targetAmount: target,
            targetDate: g.targetDate ?? null,
            etaMonths,
            requiredExtraPerMonth,
            status,
        };
    });
}

const MAX_GOALS_SHOWN = 4;

/**
 * Active, plannable goals ranked for the forecast card: dated goals first
 * (nearest deadline), then undated by size. Emergency fund is a stage, not an
 * affordability goal, so it's excluded here.
 */
export function useGoalPlanning(inputs: PlanInputs): { plans: GoalPlan[]; isLoading: boolean } {
    const { data: goals = [], isLoading } = useGoals();

    const plans = useMemo(() => {
        const eligible = goals
            .filter(g =>
                g.status === 'active' &&
                g.category !== 'emergency_fund' &&
                (g.targetAmount ?? 0) > 0)
            .sort((a, b) => {
                const da = a.targetDate ? new Date(a.targetDate).getTime() : Infinity;
                const db = b.targetDate ? new Date(b.targetDate).getTime() : Infinity;
                return da !== db ? da - db : (a.targetAmount ?? 0) - (b.targetAmount ?? 0);
            })
            .slice(0, MAX_GOALS_SHOWN);
        return planGoals(inputs, eligible);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [goals, inputs.netWorth, inputs.portfolioWallet, inputs.monthlySavings, inputs.annualReturnPct, inputs.investedPct]);

    return { plans, isLoading };
}
