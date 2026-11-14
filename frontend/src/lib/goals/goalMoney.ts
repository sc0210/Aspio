/**
 * How a goal's money reads on a card (backend: goals/reservations.py).
 *
 * Decimals arrive as strings, so every figure goes through Number().
 */

/** Money needed within this many months should not ride a market: a fall may
 *  not recover in time. */
export const HORIZON_MONTHS = 36;

const MONTH_MS = 30.44 * 86_400_000;

interface GoalMoneyFields {
  currentAmount: number | string;
  targetAmount: number | string;
  investedAmount?: number | string;
  atRiskAmount?: number | string;
  valueAmount?: number | string | null;
  /** An emergency-fund goal, whose valueAmount is the Emergency Wallet. */
  tracksEmergency?: boolean;
  targetDate?: string | Date | null;
  status?: string;
}

/**
 * Progress to show: at market value once some of the goal's money is invested,
 * else what was put in. The two are equal while nothing is invested (a sale's
 * gain or loss is a contribution row), so the switch never jumps; keeping
 * `currentAmount` then also keeps a figure set upstream, such as a retirement
 * goal's portfolio value.
 */
export function goalProgressAmount(goal: GoalMoneyFields): number {
  const invested = Number(goal.investedAmount) || 0;
  return (invested > 0 || goal.tracksEmergency) && goal.valueAmount != null
    ? Number(goal.valueAmount)
    : Number(goal.currentAmount) || 0;
}

/** Whole months to the target date, or null without one. */
export function monthsUntil(targetDate: GoalMoneyFields['targetDate']): number | null {
  if (!targetDate) return null;
  return (new Date(targetDate).getTime() - Date.now()) / MONTH_MS;
}

/** A goal not yet reached, due within HORIZON_MONTHS, with money in stocks,
 *  funds or crypto. */
export function goalHorizonRisk(goal: GoalMoneyFields): boolean {
  const reached =
    goal.status === 'completed' || goalProgressAmount(goal) >= Number(goal.targetAmount);
  const months = monthsUntil(goal.targetDate);
  return !reached && (Number(goal.atRiskAmount) || 0) > 0 && months !== null && months < HORIZON_MONTHS;
}
