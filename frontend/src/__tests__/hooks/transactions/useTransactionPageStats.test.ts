/**
 * useTransactionPageStats: what it asks the backend for (authenticated), and
 * how it filters the fixture set itself (demo). The query plumbing is
 * useDualModeQuery's own concern, so the two functions handed to it are
 * captured and run directly.
 */
import { renderHook } from '@testing-library/react';
import { useDemo } from '@/contexts/DemoContext';
import { useDualModeQuery } from '@/hooks/useAuthenticatedQuery';
import { transactionService } from '@/services/transactionService';
import { useTransactionPageStats } from '@/hooks/transactions/useTransactionPageStats';
import type { TransactionFilters } from '@/hooks/transactions/useTransactionFilters';
import type { Transaction } from '@/shared/types';

jest.mock('@/hooks/useDebounce', () => ({ useDebounce: <T,>(v: T) => v }));
jest.mock('@/contexts/DemoContext', () => ({ useDemo: jest.fn() }));
jest.mock('@/hooks/useAuthenticatedQuery', () => ({ useDualModeQuery: jest.fn() }));
jest.mock('@/services/transactionService', () => ({ transactionService: { getPageStats: jest.fn() } }));

const dualMode = useDualModeQuery as jest.Mock;
const getPageStats = transactionService.getPageStats as jest.Mock;

const all: TransactionFilters = {
  type: 'all', category: 'all', walletType: 'all', dateRange: 'all',
  sortBy: 'date', sortOrder: 'desc', startDate: '', endDate: '',
};

const tx = (over: Partial<Transaction>) =>
  ({ id: Math.random().toString(36), type: 'expense', amount: 100, currency: 'TWD', category: 'Dining',
     description: 'lunch', date: '2026-10-10', walletType: 'life', tags: [], ...over }) as Transaction;

const fixtures = [
  tx({ id: 'salary', type: 'income', category: 'Salary', amount: 50_000, description: 'October pay' }),
  tx({ id: 'ramen', amount: 300, tags: ['japan'], paymentMethod: 'LINE Pay' }),
  tx({ id: 'taxi', category: 'Transport', amount: 450, location: 'Taipei 101', walletType: 'emergency' }),
  tx({ id: 'old', category: 'Dining', amount: 999, date: '2026-01-05', subcategory: 'Dessert' }),
];

function render(filters = all, search = '', range?: { start: Date; end: Date }, excludeTransfers = false) {
  dualMode.mockReturnValue({ data: 'stats', isLoading: false, isFetching: true, error: null, refetch: jest.fn() });
  const { result } = renderHook(() => useTransactionPageStats(filters, search, range, excludeTransfers));
  const [key, authFn, demoFn, options] = dualMode.mock.calls.at(-1)!;
  return { result: result.current, key, authFn, demoFn, options };
}

beforeEach(() => {
  jest.clearAllMocks();
  (useDemo as jest.Mock).mockReturnValue({ demoTransactions: fixtures, demoRevision: 3 });
});

it('exposes the query state', () => {
  const { result } = render();
  expect(result).toMatchObject({ pageStats: 'stats', isLoading: false, isFetching: true, error: null });
});

it('keys on every filter, the search, the window, the toggle and the demo revision', () => {
  const range = { start: new Date('2026-10-01T00:00:00Z'), end: new Date('2026-10-31T00:00:00Z') };
  const { key } = render({ ...all, type: 'expense', category: 'Dining' }, 'ra', range, true);
  expect(key).toEqual([
    'transaction-page-stats', 'expense', 'Dining', 'all', 'ra',
    range.start.toISOString(), range.end.toISOString(), true, 3,
  ]);
});

it('holds the previous figures while a new key loads', () => {
  const { options } = render();
  expect(options.placeholderData('prev')).toBe('prev');
});

describe('authenticated request', () => {
  it('sends only the active filters', async () => {
    getPageStats.mockResolvedValue({ success: true, data: { stats: {} } });
    const { authFn } = render({ ...all, walletType: 'emergency' }, 'coffee', undefined, true);
    await authFn();
    expect(getPageStats).toHaveBeenCalledWith({
      type: undefined, category: undefined, walletType: 'emergency', search: 'coffee',
      dateRange: undefined, excludeTransfers: true,
    });
  });

  it('throws when the backend refuses', async () => {
    getPageStats.mockResolvedValue({ success: false, message: 'boom' });
    await expect(render().authFn()).rejects.toThrow('boom');
    getPageStats.mockResolvedValue({ success: true });
    await expect(render().authFn()).rejects.toThrow('Failed to load transaction stats');
  });
});

describe('demo computation', () => {
  const ids = (stats: { topExpenses: Transaction[]; topIncome: Transaction[] }) =>
    [...stats.topIncome, ...stats.topExpenses].map((t) => t.id).sort();

  it('filters by type and window', () => {
    const s = render({ ...all, type: 'expense' }, '', { start: new Date('2026-10-01'), end: new Date('2026-10-31') }).demoFn();
    expect(ids(s)).toEqual(['ramen', 'taxi']);
    expect(s.stats.totalExpenses).toBe(750);
  });

  it('the Transfer type matches both legs, which are stored as expense and income', () => {
    (useDemo as jest.Mock).mockReturnValue({
      demoTransactions: [
        ...fixtures,
        tx({ id: 'out', category: 'Transfer', amount: 1000, transferGroupId: 'g1' }),
        tx({ id: 'in', type: 'income', category: 'Transfer', amount: 1000, walletType: 'emergency', transferGroupId: 'g1' }),
        tx({ id: 'fee', category: '轉帳手續費', amount: 15 }),
      ],
      demoRevision: 3,
    });
    const s = render({ ...all, type: 'transfer' }).demoFn();
    expect(ids(s)).toEqual(['in', 'out']);
    expect(s.stats.totalIncome).toBe(1000);
    expect(s.stats.totalExpenses).toBe(1000);
  });

  it.each([
    ['description', 'october', ['salary']],
    ['category', 'transport', ['taxi']],
    ['subcategory', 'dessert', ['old']],
    ['tag with or without #', '#japan', ['ramen']],
    ['payment method', 'line pay', ['ramen']],
    ['location', '101', ['taxi']],
    ['amount', '450', ['taxi']],
    ['blank query', '   ', ['old', 'ramen', 'salary', 'taxi']],
  ])('searches by %s', (_label, query, expected) => {
    expect(ids(render(all, query).demoFn())).toEqual(expected);
  });

  it('applies category and wallet filters to the totals but not the dropdown breakdown', () => {
    const s = render({ ...all, category: 'Dining,Transport', walletType: 'life' }).demoFn();
    expect(ids(s)).toEqual(['old', 'ramen']);
    expect(s.categoryBreakdown.map((c: { category: string }) => c.category).sort()).toEqual(['Dining', 'Salary', 'Transport']);
  });
});
