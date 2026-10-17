// Pure grid-building helpers for the daily P&L calendars.
//
// Markets trade Mon–Fri only, so both the full calendar (PortfolioCalendarHeatmap)
// and the dashboard mini calendar (PortfolioOverview) lay each week out as five
// weekday columns plus a weekly-sum column. Weekends are skipped entirely and the
// first/last weeks are padded with nulls so every week has exactly five day slots.
//
// These functions are dependency-light and pure so they can be unit-tested directly.
import type { AssetTrendDataPoint } from './AssetTrendChart';

export interface DayCell {
    date: Date;
    dateStr: string;
    change: number | null;
    changePercent: number | null;
    /** Priced from a live quote because the market has not published a close for
     *  this date yet — the figure is still moving. */
    provisional: boolean;
}

export interface MonthBlock {
    year: number;
    month: number; // 0-based
    label: string;
    days: (DayCell | null)[]; // weekdays only (Mon–Fri), padded to multiples of 5
}

export interface MiniCalCell {
    day: number;
    dateStr: string;
    change: number | null;
    changePercent: number | null;
    provisional: boolean;
}

// Build one month block per month spanned by `data`, each with Mon–Fri weekday
// cells padded to whole 5-day weeks. Used by the full calendar heatmap.
export function buildMonthBlocks(data: AssetTrendDataPoint[]): MonthBlock[] {
    const map = new Map<string, { change: number; changePercent: number; provisional: boolean }>();
    for (const pt of data) {
        map.set(pt.date.slice(0, 10), {
            change: pt.change,
            changePercent: pt.changePercent,
            provisional: pt.provisional ?? false,
        });
    }

    if (map.size === 0) return [];

    const dates = Array.from(map.keys()).sort();
    const firstDate = new Date(dates[0] + 'T00:00:00');
    const lastDate = new Date(dates[dates.length - 1] + 'T00:00:00');

    const blocks: MonthBlock[] = [];
    const cursor = new Date(firstDate.getFullYear(), firstDate.getMonth(), 1);
    const endMonth = new Date(lastDate.getFullYear(), lastDate.getMonth(), 1);

    while (cursor <= endMonth) {
        const year = cursor.getFullYear();
        const month = cursor.getMonth();
        const label = cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
        const daysInMonth = new Date(year, month + 1, 0).getDate();

        const days: (DayCell | null)[] = [];
        let started = false;

        for (let d = 1; d <= daysInMonth; d++) {
            const date = new Date(year, month, d);
            const jsDay = date.getDay(); // 0=Sun .. 6=Sat
            if (jsDay === 0 || jsDay === 6) continue; // skip weekends — markets closed
            const col = jsDay - 1; // Mon=0 .. Fri=4

            // Pad start once, up to the first weekday's column
            if (!started) {
                for (let i = 0; i < col; i++) days.push(null);
                started = true;
            }

            const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            const pt = map.get(dateStr);
            days.push({
                date,
                dateStr,
                change: pt?.change ?? null,
                changePercent: pt?.changePercent ?? null,
                provisional: pt?.provisional ?? false,
            });
        }

        // Pad end to complete the last week (5 weekdays)
        while (days.length % 5 !== 0) days.push(null);

        blocks.push({ year, month, label, days });
        cursor.setMonth(cursor.getMonth() + 1);
    }

    return blocks;
}

// Build the Mon–Fri weekday cells for a single month, padded to whole 5-day weeks.
// Used by the dashboard mini calendar.
export function buildMiniCalendarCells(
    year: number,
    month: number, // 0-based
    monthData: Map<string, { change: number; changePercent: number; provisional?: boolean }>,
): (MiniCalCell | null)[] {
    const monthPrefix = `${year}-${String(month + 1).padStart(2, '0')}`;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells: (MiniCalCell | null)[] = [];
    let started = false;
    for (let d = 1; d <= daysInMonth; d++) {
        const jsDay = new Date(year, month, d).getDay(); // 0=Sun .. 6=Sat
        if (jsDay === 0 || jsDay === 6) continue; // skip weekends — markets closed
        const col = jsDay - 1; // Mon=0 .. Fri=4
        if (!started) {
            for (let i = 0; i < col; i++) cells.push(null); // pad to first weekday's column
            started = true;
        }
        const dateStr = `${monthPrefix}-${String(d).padStart(2, '0')}`;
        const pt = monthData.get(dateStr);
        cells.push({
            day: d,
            dateStr,
            change: pt?.change ?? null,
            changePercent: pt?.changePercent ?? null,
            provisional: pt?.provisional ?? false,
        });
    }
    while (cells.length % 5 !== 0) cells.push(null);
    return cells;
}
