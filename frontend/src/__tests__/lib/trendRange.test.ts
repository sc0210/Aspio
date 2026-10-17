import {
    allTimeReturnPercent,
    businessToday,
    filterTrendByPreset,
    presetStartDay,
    shiftDays,
    shiftYears,
} from '@/lib/portfolio/trendRange';

/** Market days only (Mon–Fri) between two YYYY-MM-DD days, inclusive. */
function marketDays(from: string, to: string): { date: string; value: number }[] {
    const out: { date: string; value: number }[] = [];
    const [fy, fm, fd] = from.split('-').map(Number);
    const [ty, tm, td] = to.split('-').map(Number);
    const end = Date.UTC(ty, tm - 1, td);
    for (let t = Date.UTC(fy, fm - 1, fd); t <= end; t += 86400000) {
        const d = new Date(t);
        const dow = d.getUTCDay();
        if (dow === 0 || dow === 6) continue;
        out.push({ date: d.toISOString().slice(0, 10), value: 100 });
    }
    return out;
}

const TODAY = '2026-10-09'; // a Friday
const series = marketDays('2020-01-01', TODAY);
const noCustom = { startDate: null, endDate: null };

describe('businessToday', () => {
    it('is the Taipei calendar day, not the UTC one', () => {
        // 2026-10-08T17:30Z is 01:30 on the 9th in Taipei.
        expect(businessToday(new Date('2026-10-08T17:30:00Z'))).toBe('2026-10-09');
        // 2026-10-09T15:59Z is 23:59 on the 9th in Taipei.
        expect(businessToday(new Date('2026-10-09T15:59:00Z'))).toBe('2026-10-09');
        expect(businessToday(new Date('2026-10-09T16:00:00Z'))).toBe('2026-10-10');
    });
});

describe('date shifting', () => {
    it('shifts by calendar days across month and year ends', () => {
        expect(shiftDays('2026-10-09', 30)).toBe('2026-09-09');
        expect(shiftDays('2026-01-05', 7)).toBe('2025-12-29');
        expect(shiftDays('2024-03-01', 1)).toBe('2024-02-29');
    });

    it('shifts by years, rolling Feb 29 forward', () => {
        expect(shiftYears('2026-10-09', 3)).toBe('2023-10-09');
        expect(shiftYears('2028-02-29', 1)).toBe('2027-03-01');
    });

    it('starts YTD on Jan 1 of the business year', () => {
        expect(presetStartDay('ytd', TODAY)).toBe('2026-01-01');
        expect(presetStartDay('max', TODAY)).toBeNull();
    });
});

describe('filterTrendByPreset', () => {
    it('30D covers calendar days, not 30 market-day points', () => {
        const out = filterTrendByPreset(series, 30, noCustom, TODAY);
        expect(out[0].date).toBe('2026-09-09');
        expect(out[out.length - 1].date).toBe(TODAY);
        // 31 calendar days inclusive hold 23 market days — a slice(-30) reached
        // back to late August.
        expect(out.length).toBe(23);
    });

    it('7D and 90D start exactly N days back (or the next market day)', () => {
        expect(filterTrendByPreset(series, 7, noCustom, TODAY)[0].date).toBe('2026-10-02');
        // 2026-07-11 is a Saturday, so the first point is Monday the 13th.
        expect(filterTrendByPreset(series, 90, noCustom, TODAY)[0].date).toBe('2026-07-13');
    });

    it('1Y starts a year back, not ~17 months back', () => {
        const out = filterTrendByPreset(series, 365, noCustom, TODAY);
        expect(out[0].date).toBe('2025-10-09');
    });

    it('YTD, 3Y and 5Y cut by date', () => {
        expect(filterTrendByPreset(series, 'ytd', noCustom, TODAY)[0].date).toBe('2026-01-01');
        expect(filterTrendByPreset(series, '3y', noCustom, TODAY)[0].date).toBe('2023-10-09');
        // 2021-10-09 is a Saturday.
        expect(filterTrendByPreset(series, '5y', noCustom, TODAY)[0].date).toBe('2021-10-11');
    });

    it('MAX returns the whole series', () => {
        expect(filterTrendByPreset(series, 'max', noCustom, TODAY)).toBe(series);
    });

    it('custom keeps both picked days inclusive', () => {
        const out = filterTrendByPreset(
            series,
            'custom',
            { startDate: new Date('2026-09-01'), endDate: new Date('2026-09-04') },
            TODAY,
        );
        expect(out.map((p) => p.date)).toEqual(['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04']);
    });

    it('custom without both ends returns everything', () => {
        expect(
            filterTrendByPreset(series, 'custom', { startDate: new Date('2026-09-01'), endDate: null }, TODAY),
        ).toBe(series);
    });

    it('handles an empty series', () => {
        expect(filterTrendByPreset([], 30, noCustom, TODAY)).toEqual([]);
    });
});

describe('allTimeReturnPercent', () => {
    it('uses the latest backend cost basis when present', () => {
        expect(
            allTimeReturnPercent([
                { value: 100, costBasis: 100 },
                { value: 150, costBasis: 120 },
            ]),
        ).toBeCloseTo(25);
    });

    it('without cost basis, measures from the full series start, not a period slice', () => {
        const full = [
            { value: 100 },
            { value: 200 },
            { value: 220 },
        ];
        // All-time: 100 → 220 = +120%. The last-two-point slice alone would read +10%.
        expect(allTimeReturnPercent(full)).toBeCloseTo(120);
    });

    it('adds contributions to the fallback cost basis', () => {
        expect(
            allTimeReturnPercent([
                { value: 100 },
                { value: 300, capitalAdded: 100 },
            ]),
        ).toBeCloseTo(50);
    });

    it('is null with no data or no cost', () => {
        expect(allTimeReturnPercent([])).toBeNull();
        expect(allTimeReturnPercent([{ value: 0 }])).toBeNull();
    });
});
