import {
  buildMonthBlocks,
  buildMiniCalendarCells,
  type MonthBlock,
  type DayCell,
  type MiniCalCell,
} from '@/components/portfolio/calendarGrid';
import type { AssetTrendDataPoint } from '@/components/portfolio/AssetTrendChart';

// Independently compute the weekday (Mon–Fri) day-of-month numbers for a month,
// used as the source of truth the builders must reproduce.
function weekdaysOf(year: number, month: number): number[] {
  const out: number[] = [];
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  for (let d = 1; d <= daysInMonth; d++) {
    const wd = new Date(year, month, d).getDay();
    if (wd !== 0 && wd !== 6) out.push(d);
  }
  return out;
}

function pt(date: string, change: number): AssetTrendDataPoint {
  return { date, value: 1000, change, changePercent: change / 100 };
}

describe('buildMiniCalendarCells', () => {
  // Reference points (UTC-stable): Jan 1 2025 = Wed, Feb 1 2025 = Sat,
  // Jun 1 2025 = Sun, Aug 1 2025 = Fri, Sep 1 2025 = Mon.
  const cases: Array<{ name: string; year: number; month: number; firstNonNullDay: number; leadingNulls: number }> = [
    { name: 'month starting mid-week (Jan 2025, Wed)', year: 2025, month: 0, firstNonNullDay: 1, leadingNulls: 2 },
    { name: 'month starting on a Saturday (Feb 2025)', year: 2025, month: 1, firstNonNullDay: 3, leadingNulls: 0 },
    { name: 'month starting on a Sunday (Jun 2025)', year: 2025, month: 5, firstNonNullDay: 2, leadingNulls: 0 },
    { name: 'month starting on a Friday (Aug 2025)', year: 2025, month: 7, firstNonNullDay: 1, leadingNulls: 4 },
    { name: 'month starting on a Monday (Sep 2025)', year: 2025, month: 8, firstNonNullDay: 1, leadingNulls: 0 },
  ];

  it.each(cases)('$name: only weekdays, padded to 5-day weeks', ({ year, month, firstNonNullDay, leadingNulls }) => {
    const cells = buildMiniCalendarCells(year, month, new Map());
    const nonNull = cells.filter((c): c is MiniCalCell => c !== null);

    // Padded to whole 5-day weeks
    expect(cells.length % 5).toBe(0);

    // Exactly the month's weekdays, in order, weekends excluded
    expect(nonNull.map((c) => c.day)).toEqual(weekdaysOf(year, month));

    // Every retained cell really is a weekday
    for (const c of nonNull) {
      const wd = new Date(year, month, c.day).getDay();
      expect(wd).toBeGreaterThanOrEqual(1);
      expect(wd).toBeLessThanOrEqual(5);
    }

    // Leading padding aligns the first weekday to its Mon=0..Fri=4 column
    expect(cells.findIndex((c) => c !== null)).toBe(leadingNulls);
    expect(nonNull[0].day).toBe(firstNonNullDay);
  });

  it('attaches change/changePercent to matching weekday cells', () => {
    const monthData = new Map([
      ['2025-01-15', { change: 250, changePercent: 1.5 }], // Wed
    ]);
    const cells = buildMiniCalendarCells(2025, 0, monthData);
    const jan15 = cells.find((c) => c?.dateStr === '2025-01-15');
    expect(jan15?.change).toBe(250);
    expect(jan15?.changePercent).toBe(1.5);

    // A day with no data stays null-valued
    const jan16 = cells.find((c) => c?.dateStr === '2025-01-16');
    expect(jan16?.change).toBeNull();
  });

  it('never emits a weekend cell even if weekend data is supplied', () => {
    const monthData = new Map([
      ['2025-01-04', { change: 999, changePercent: 9 }], // Saturday
      ['2025-01-05', { change: 888, changePercent: 8 }], // Sunday
    ]);
    const cells = buildMiniCalendarCells(2025, 0, monthData);
    const dates = cells.filter((c): c is MiniCalCell => c !== null).map((c) => c.dateStr);
    expect(dates).not.toContain('2025-01-04');
    expect(dates).not.toContain('2025-01-05');
  });
});

describe('buildMonthBlocks', () => {
  it('returns no blocks for empty data', () => {
    expect(buildMonthBlocks([])).toEqual([]);
  });

  it('builds one padded weekday block per spanned month', () => {
    const data: AssetTrendDataPoint[] = [
      pt('2025-01-01', 10), // Wed — sets range start
      pt('2025-01-04', 999), // Sat — must be ignored
      pt('2025-01-15', 250), // Wed — value mapped onto its cell
      pt('2025-02-28', -30), // Fri — sets range end
    ];
    const blocks: MonthBlock[] = buildMonthBlocks(data);

    // Jan + Feb 2025
    expect(blocks.map((b) => [b.year, b.month])).toEqual([
      [2025, 0],
      [2025, 1],
    ]);

    for (const block of blocks) {
      expect(block.days.length % 5).toBe(0);
      const nonNull = block.days.filter((d): d is DayCell => d !== null);
      expect(nonNull.map((d) => d.date.getDate())).toEqual(weekdaysOf(block.year, block.month));
      for (const cell of nonNull) {
        const wd = cell.date.getDay();
        expect(wd).toBeGreaterThanOrEqual(1);
        expect(wd).toBeLessThanOrEqual(5);
      }
    }

    // January starts on Wednesday → two leading nulls, then Jan 1
    const jan = blocks[0];
    expect(jan.days.findIndex((d) => d !== null)).toBe(2);
    expect(jan.days[2]?.dateStr).toBe('2025-01-01');

    // Weekend data point excluded; weekday data point mapped
    const janDates = jan.days.filter((d): d is DayCell => d !== null).map((d) => d.dateStr);
    expect(janDates).not.toContain('2025-01-04');
    const jan15 = jan.days.find((d) => d?.dateStr === '2025-01-15');
    expect(jan15?.change).toBe(250);
  });
});

describe('provisional days', () => {
  // The US session ends after midnight in Taipei, so the newest day is priced from
  // live quotes until its close is published — and its figure moves when it lands.
  // The grid has to carry that through, or the calendar cannot say so.
  it('carries the flag onto the month-block cell', () => {
    const blocks = buildMonthBlocks([
      { date: '2026-09-18', value: 1000, change: 10, changePercent: 1 },
      { date: '2026-09-21', value: 1100, change: 100, changePercent: 10, provisional: true },
    ]);
    const cells = blocks[0].days.filter((c): c is DayCell => c !== null);

    expect(cells.find(c => c.dateStr === '2026-09-18')!.provisional).toBe(false);
    expect(cells.find(c => c.dateStr === '2026-09-21')!.provisional).toBe(true);
  });

  it('carries it onto the mini-calendar cell', () => {
    const cells = buildMiniCalendarCells(2026, 8, new Map([
      ['2026-09-18', { change: 10, changePercent: 1 }],
      ['2026-09-21', { change: 100, changePercent: 10, provisional: true }],
    ]));
    const byDay = (d: number) => cells.find((c): c is MiniCalCell => c?.day === d)!;

    expect(byDay(18).provisional).toBe(false);
    expect(byDay(21).provisional).toBe(true);
  });

  it('defaults to settled, so a day without the field is not marked', () => {
    const cells = buildMiniCalendarCells(2026, 8, new Map([
      ['2026-09-18', { change: 10, changePercent: 1 }],
    ]));
    expect(cells.find((c): c is MiniCalCell => c?.day === 18)!.provisional).toBe(false);
  });
});
