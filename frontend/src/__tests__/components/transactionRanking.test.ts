import { topTransactionsByAmount } from '@/components/transactions/transactionRanking';
import type { Transaction } from '@/shared/types';

// Minimal Transaction factory — only the fields the ranking logic reads matter;
// the rest are filled with valid defaults to satisfy the type.
function tx(overrides: Partial<Transaction> & { id: string }): Transaction {
  return {
    userId: 'u1',
    type: 'expense',
    amount: 0,
    currency: 'TWD',
    category: 'Other',
    description: '',
    date: '2026-06-01',
    createdAt: new Date('2026-06-01'),
    updatedAt: new Date('2026-06-01'),
    ...overrides,
  } as Transaction;
}

describe('topTransactionsByAmount', () => {
  it('returns expenses ranked by amount descending', () => {
    const transactions = [
      tx({ id: 'a', type: 'expense', amount: 100 }),
      tx({ id: 'b', type: 'expense', amount: 900 }),
      tx({ id: 'c', type: 'expense', amount: 500 }),
    ];

    const result = topTransactionsByAmount(transactions, 'expense');

    expect(result.map((r) => r.tx.id)).toEqual(['b', 'c', 'a']);
    expect(result.map((r) => r.twd)).toEqual([900, 500, 100]);
  });

  it('filters out the other transaction type', () => {
    const transactions = [
      tx({ id: 'exp', type: 'expense', amount: 100 }),
      tx({ id: 'inc', type: 'income', amount: 9999 }),
      tx({ id: 'xfer', type: 'transfer', amount: 8888 }),
    ];

    expect(topTransactionsByAmount(transactions, 'expense').map((r) => r.tx.id)).toEqual(['exp']);
    expect(topTransactionsByAmount(transactions, 'income').map((r) => r.tx.id)).toEqual(['inc']);
  });

  it('limits to the top 5 by default', () => {
    const transactions = Array.from({ length: 8 }, (_, i) =>
      tx({ id: `e${i}`, type: 'expense', amount: (i + 1) * 100 }),
    );

    const result = topTransactionsByAmount(transactions, 'expense');

    expect(result).toHaveLength(5);
    // Largest five: 800, 700, 600, 500, 400
    expect(result.map((r) => r.twd)).toEqual([800, 700, 600, 500, 400]);
  });

  it('honours a custom limit', () => {
    const transactions = Array.from({ length: 4 }, (_, i) =>
      tx({ id: `e${i}`, type: 'expense', amount: (i + 1) * 100 }),
    );

    expect(topTransactionsByAmount(transactions, 'expense', 2).map((r) => r.twd)).toEqual([400, 300]);
  });

  it('ranks by TWD-normalised amount across currencies', () => {
    // 100 USD = 3,150 TWD outranks a 3,000 TWD expense despite the smaller raw number.
    const transactions = [
      tx({ id: 'twd', type: 'expense', amount: 3000, currency: 'TWD' }),
      tx({ id: 'usd', type: 'expense', amount: 100, currency: 'USD' }),
    ];

    const result = topTransactionsByAmount(transactions, 'expense');

    expect(result.map((r) => r.tx.id)).toEqual(['usd', 'twd']);
    expect(result[0].twd).toBe(3150);
  });

  it('returns an empty array when there are no matching transactions', () => {
    expect(topTransactionsByAmount([], 'expense')).toEqual([]);
    expect(
      topTransactionsByAmount([tx({ id: 'inc', type: 'income', amount: 100 })], 'expense'),
    ).toEqual([]);
  });
});
