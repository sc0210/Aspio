/**
 * Period filtering for the /portfolio/trend series.
 *
 * The daily-performance series only has market days, so "the last 30 points"
 * is not "the last 30 days": weekends and holidays stretch it to ~6 weeks, and
 * a 1Y preset reached back ~17 months. The presets are calendar windows, so
 * they are cut by date — every comparison is on `YYYY-MM-DD` strings, which
 * sort the same as the dates they name.
 *
 * "Today" is the business day in Asia/Taipei (the backend's `business_today()`),
 * not the viewer's clock, so the window lines up with the series' last point.
 */

import { businessToday } from './businessDate';

export { businessToday };

export type TrendPreset = 7 | 30 | 90 | 365 | 'ytd' | '3y' | '5y' | 'max' | 'custom';

interface TrendCustomRange {
    startDate: Date | null;
    endDate: Date | null;
}

const pad = (n: number) => String(n).padStart(2, '0');

function parseDay(day: string): { y: number; m: number; d: number } {
    const [y, m, d] = day.split('-').map(Number);
    return { y, m, d };
}

function formatUtcDay(dt: Date): string {
    return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

/** The day `n` calendar days before `day` (`YYYY-MM-DD` in, `YYYY-MM-DD` out). */
export function shiftDays(day: string, n: number): string {
    const { y, m, d } = parseDay(day);
    return formatUtcDay(new Date(Date.UTC(y, m - 1, d - n)));
}

/** The same calendar day `n` years earlier (Feb 29 rolls to Mar 1). */
export function shiftYears(day: string, n: number): string {
    const { y, m, d } = parseDay(day);
    return formatUtcDay(new Date(Date.UTC(y - n, m - 1, d)));
}

/**
 * First day (inclusive) a preset covers, or null when it has no lower bound
 * (`max`, and `custom`, which is bounded separately).
 */
export function presetStartDay(preset: TrendPreset, today: string): string | null {
    if (typeof preset === 'number') return shiftDays(today, preset);
    if (preset === 'ytd') return `${today.slice(0, 4)}-01-01`;
    if (preset === '3y') return shiftYears(today, 3);
    if (preset === '5y') return shiftYears(today, 5);
    return null;
}

/**
 * The DateRangePicker builds its dates from `new Date('YYYY-MM-DD')` (UTC
 * midnight) and displays them with `toISOString()`, so the UTC day is the day
 * the user picked.
 */
const pickerDay = (date: Date): string => date.toISOString().slice(0, 10);

export function filterTrendByPreset<T extends { date: string }>(
    data: T[],
    preset: TrendPreset,
    customRange: TrendCustomRange,
    today: string = businessToday(),
): T[] {
    if (!data || data.length === 0) return [];
    if (preset === 'max') return data;

    if (preset === 'custom') {
        const { startDate, endDate } = customRange;
        if (!startDate || !endDate) return data;
        const from = pickerDay(startDate);
        const to = pickerDay(endDate);
        return data.filter((p) => p.date.slice(0, 10) >= from && p.date.slice(0, 10) <= to);
    }

    const from = presetStartDay(preset, today);
    if (!from) return data;
    return data.filter((p) => p.date.slice(0, 10) >= from);
}

interface TrendReturnPoint {
    value: number;
    costBasis?: number;
    capitalAdded?: number;
}

/**
 * All-time return % (value vs cost basis) for the WHOLE series, independent of
 * the selected period.
 *
 * When the backend sends a cumulative `costBasis`, the latest point's value and
 * cost basis already are the all-time figure. When it doesn't (demo data), the
 * chart rebuilds cost basis from the first point's value plus later
 * `capitalAdded` — and fed only the period slice, that made "all-time" equal
 * the period return for any period without contributions. So this one is
 * always computed over the full series. Mirrors AssetTrendChart's cost-basis
 * fallback.
 */
export function allTimeReturnPercent(data: TrendReturnPoint[]): number | null {
    if (!Array.isArray(data) || data.length === 0) return null;
    const last = data[data.length - 1];
    const lastValue = Number(last.value) || 0;
    const hasBackendCostBasis = data.some((p) => p.costBasis != null && p.costBasis > 0);

    let cost: number;
    if (hasBackendCostBasis) {
        cost = Number(last.costBasis) || 0;
    } else {
        cost = 0;
        data.forEach((p, i) => {
            const added = Number(p.capitalAdded) || 0;
            if (i === 0) cost = added > 0 ? added : Number(p.value) || 0;
            else cost += added;
        });
    }
    if (!(cost > 0)) return null;
    return ((lastValue - cost) / cost) * 100;
}
