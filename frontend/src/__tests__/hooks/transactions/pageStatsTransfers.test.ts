/**
 * Demo mode computes the transactions page's totals in the browser instead of
 * asking the aggregate query, so it has to honour the same request: leave both
 * legs of a wallet transfer out. One 500k move between the user's own wallets is
 * stored as an expense leaving Life and an income arriving in Emergency, and
 * counting it raised income AND spending by 500k while the net stayed right.
 */

import { computeClientPageStats } from '@/hooks/transactions/useTransactionPageStats';
import type { Transaction } from '@/shared/types';

const txn = (over: Partial<Transaction>): Transaction => ({
    id: Math.random().toString(36).slice(2),
    userId: 'u1',
    type: 'expense',
    amount: 1000,
    currency: 'TWD',
    category: 'Dining',
    description: 'test',
    date: '2026-09-21',
    createdAt: new Date('2026-09-21'),
    updatedAt: new Date('2026-09-21'),
    ...over,
} as Transaction);

const salary = txn({ type: 'income', category: 'Salary', amount: 85_000 });
const dinner = txn({ type: 'expense', category: 'Dining', amount: 6_000 });
const transferOut = txn({
    type: 'expense', category: 'Transfer', amount: 500_000,
    walletType: 'life', transferGroupId: 'grp-1',
});
const transferIn = txn({
    type: 'income', category: 'Transfer', amount: 500_000,
    walletType: 'emergency', transferGroupId: 'grp-1',
});

const rows = [salary, dinner, transferOut, transferIn];

describe('computeClientPageStats — wallet transfers', () => {
    it('counts both legs by default, because the list below shows both', () => {
        const stats = computeClientPageStats(rows, rows).stats;
        expect(stats.totalIncome).toBe(585_000);
        expect(stats.totalExpenses).toBe(506_000);
    });

    it('drops both legs when asked, not just the expense one', () => {
        const stats = computeClientPageStats(rows, rows, { excludeTransfers: true }).stats;
        expect(stats.totalIncome).toBe(85_000);
        expect(stats.totalExpenses).toBe(6_000);
    });

    it('leaves the net income alone either way', () => {
        const counted = computeClientPageStats(rows, rows).stats;
        const excluded = computeClientPageStats(rows, rows, { excludeTransfers: true }).stats;
        expect(counted.netIncome).toBe(excluded.netIncome);
    });

    it('recognises a leg by its category when no group id was recorded', () => {
        const legacy = [salary, txn({ type: 'expense', category: 'Transfer', amount: 992_250 })];
        const stats = computeClientPageStats(legacy, legacy, { excludeTransfers: true }).stats;
        expect(stats.totalExpenses).toBe(0);
    });
});
