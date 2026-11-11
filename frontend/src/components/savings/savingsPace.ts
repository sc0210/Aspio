import type { SavingRecord, SharedGoalOut } from '@/shared/types';

/** How far back "your recent pace" looks: about three months. */
export const PACE_WINDOW_DAYS = 90;

/** Past this many months a projection says nothing useful: "more than 10 years" instead of a date. */
export const PACE_HORIZON_MONTHS = 120;

export type PaceForecast =
  /** Nothing left to save on the active goals. */
  | { kind: 'done' }
  /** Nothing saved in the window: no pace to project from. */
  | { kind: 'stalled'; remaining: number }
  /** Saving, but so slowly the finish is beyond the horizon. */
  | { kind: 'far'; perMonth: number; remaining: number }
  | {
      kind: 'pace';
      /** Saved per month over the window, both people together. */
      perMonth: number;
      remaining: number;
      /** 'YYYY-MM' the active goals would all be reached at this pace. */
      finish: string;
      /** Whole months after the latest active deadline; 0 when on time or there is no deadline. */
      monthsLate: number;
    };

const dayNumber = (isoDay: string) => Date.UTC(+isoDay.slice(0, 4), +isoDay.slice(5, 7) - 1, +isoDay.slice(8, 10)) / 86_400_000;
const monthIndex = (isoDay: string) => +isoDay.slice(0, 4) * 12 + (+isoDay.slice(5, 7) - 1);
const monthOfIndex = (i: number) => `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;

/**
 * When the active goals would all be reached if you both keep saving as you
 * have over the last ~3 months. `records` are every active goal's records;
 * `today` is the business day ('YYYY-MM-DD').
 */
export function paceForecast(goals: SharedGoalOut[], records: SavingRecord[], today: string): PaceForecast {
  const active = goals.filter((g) => g.status !== 'completed');
  const remaining = active.reduce((s, g) => s + Math.max(0, g.target_amount - g.total_amount), 0);
  if (remaining <= 0) return { kind: 'done' };

  const activeIds = new Set(active.map((g) => g.id));
  const end = dayNumber(today);
  const saved = records
    .filter((r) => activeIds.has(r.goal_id))
    .filter((r) => { const d = dayNumber(r.record_date); return d > end - PACE_WINDOW_DAYS && d <= end; })
    .reduce((s, r) => s + r.amount, 0);
  if (saved <= 0) return { kind: 'stalled', remaining };

  const perMonth = saved / (PACE_WINDOW_DAYS / 30.44);
  // Under a dollar a month would read "NT$0 a month": no pace worth projecting.
  if (Math.round(perMonth) < 1) return { kind: 'stalled', remaining };
  const months = Math.ceil(remaining / perMonth);
  if (months > PACE_HORIZON_MONTHS) return { kind: 'far', perMonth, remaining };
  const finishIndex = monthIndex(today) + months;
  const deadlines = active.map((g) => g.target_date).filter((d): d is string => !!d).map((d) => monthIndex(d.slice(0, 10)));
  const latest = deadlines.length ? Math.max(...deadlines) : null;
  return {
    kind: 'pace',
    perMonth,
    remaining,
    finish: monthOfIndex(finishIndex),
    monthsLate: latest === null ? 0 : Math.max(0, finishIndex - latest),
  };
}
