import { daysNeedingFullTotal, sumDayNet, transactionDayKey } from '@/components/transactions/dayTotals';
import type { Transaction } from '@/shared/types';

const row = (id: string, date: string, type: Transaction['type'], amount: number, extra: Partial<Transaction> = {}) =>
    ({ id, date, type, amount, currency: 'TWD', category: 'Food', description: id, ...extra }) as Transaction;

describe('sumDayNet', () => {
    it('nets a whole transfer to zero when both legs are in the day', () => {
        const day = [
            row('out', '2026-10-09', 'expense', 50_000, { transferGroupId: 'g' }),
            row('in', '2026-10-09', 'income', 50_000, { transferGroupId: 'g' }),
            row('lunch', '2026-10-09', 'expense', 120),
        ];
        expect(sumDayNet(day)).toBe(-120);
    });

    it('treats transfer-typed rows as neutral', () => {
        expect(sumDayNet([row('t', '2026-10-09', 'transfer', 999), row('pay', '2026-10-09', 'income', 10)])).toBe(10);
    });

    it('reproduces the split the E2E pass saw when only one page is summed', () => {
        // 14 rows today; a page break leaves the transfer's income leg on page 2.
        const page1 = [row('out', '2026-10-09', 'expense', 50_000, { transferGroupId: 'g' }), row('lunch', '2026-10-09', 'expense', 120)];
        const page2 = [row('in', '2026-10-09', 'income', 50_000, { transferGroupId: 'g' })];
        expect(sumDayNet(page1)).toBe(-50_120);
        expect(sumDayNet(page2)).toBe(50_000);
        // The whole day is what both pages must show.
        expect(sumDayNet([...page1, ...page2])).toBe(-120);
    });
});

describe('daysNeedingFullTotal', () => {
    const page = [
        row('a', '2026-10-09', 'expense', 1),
        row('b', '2026-10-08', 'expense', 1),
        row('c', '2026-10-07', 'expense', 1),
    ];

    it('is empty on a single page — every day is already whole', () => {
        expect(daysNeedingFullTotal(page, 1, true)).toEqual([]);
    });

    it('sorted by date, only the first and last day can straddle a page break', () => {
        expect(daysNeedingFullTotal(page, 3, true).map(transactionDayKey)).toEqual([
            transactionDayKey('2026-10-09'),
            transactionDayKey('2026-10-07'),
        ]);
    });

    it('under any other sort, fetches nothing — one request per day on the page was a storm', () => {
        expect(daysNeedingFullTotal(page, 3, false)).toEqual([]);
    });

    it('lists a day once even when it is both first and last', () => {
        const oneDay = [row('a', '2026-10-09', 'expense', 1), row('b', '2026-10-09', 'expense', 1)];
        expect(daysNeedingFullTotal(oneDay, 2, true)).toHaveLength(1);
    });
});
