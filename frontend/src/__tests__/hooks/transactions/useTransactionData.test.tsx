/**
 * useTransactionData: page size from the viewport, page reset on filter change,
 * demo-mode client paging, and the day totals for days split across pages.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { useTransactions } from '@/hooks/useTransactions';
import { transactionService } from '@/services/transactionService';
import { useTransactionData } from '@/hooks/transactions/useTransactionData';
import type { TransactionFilters } from '@/hooks/transactions/useTransactionFilters';
import type { Transaction } from '@/shared/types';
import { createQueryWrapper } from '../../utils/queryWrapper';

jest.mock('@/hooks/useDebounce', () => ({ useDebounce: <T,>(v: T) => v }));
jest.mock('@/hooks/useTransactions', () => ({ useTransactions: jest.fn() }));
jest.mock('@/services/transactionService', () => ({
  transactionService: { getPageStats: jest.fn() },
}));

const mockUseTransactions = useTransactions as jest.Mock;
const getPageStats = transactionService.getPageStats as jest.Mock;

const filters: TransactionFilters = {
  type: 'all', category: 'all', walletType: 'all', dateRange: 'all',
  sortBy: 'date', sortOrder: 'desc', startDate: '', endDate: '',
};

const tx = (id: string, day: number, type: Transaction['type'], amount: number) =>
  ({ id, type, amount, currency: 'TWD', date: new Date(2026, 9, day), walletType: 'life' }) as Transaction;

function serve(rows: Transaction[], meta?: { total: number; total_pages: number }) {
  mockUseTransactions.mockReturnValue({
    transactions: rows, meta, isLoading: false, isFetching: false, error: null, refetch: jest.fn(),
  });
}

function render(f: TransactionFilters = filters, search = '', isDemo = false) {
  return renderHook(
    ({ f, search }) => useTransactionData(f, search, undefined, isDemo),
    { wrapper: createQueryWrapper(), initialProps: { f, search } },
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 1344 }); // → 20 rows
});

it('sizes pages to the viewport within bounds and follows resizes', () => {
  serve([]);
  const { result } = render();
  expect(result.current.pageSize).toBe(20);

  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 100 });
  act(() => {
    window.dispatchEvent(new Event('resize'));
  });
  expect(result.current.pageSize).toBe(10);

  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 10_000 });
  act(() => {
    window.dispatchEvent(new Event('resize'));
  });
  expect(result.current.pageSize).toBe(30);
});

it('sends active filters to the API and snaps back to page 1 when they change', () => {
  serve([], { total: 100, total_pages: 5 });
  const { result, rerender } = render({ ...filters, type: 'expense', category: 'Food' }, 'coffee');

  expect(mockUseTransactions).toHaveBeenLastCalledWith(
    expect.objectContaining({ page: 1, limit: 20, type: 'expense', category: 'Food', walletType: undefined, search: 'coffee' }),
  );
  expect(result.current.total).toBe(100);
  expect(result.current.totalPages).toBe(5);

  act(() => result.current.setPage(3));
  expect(result.current.page).toBe(3);

  rerender({ f: { ...filters, walletType: 'emergency' }, search: 'coffee' });
  expect(result.current.page).toBe(1);
  expect(mockUseTransactions).toHaveBeenLastCalledWith(expect.objectContaining({ walletType: 'emergency', type: undefined }));
});

it('pages demo rows on the client and totals each visible day across the whole set', () => {
  const rows = Array.from({ length: 25 }, (_, i) => tx(`t${i}`, i < 21 ? 1 : 2, 'expense', 10));
  rows[20] = tx('income', 1, 'income', 500);
  serve(rows);

  const { result } = renderHook(() => useTransactionData(filters, '', undefined, true), { wrapper: createQueryWrapper() });

  expect(result.current.transactions).toHaveLength(20);
  expect(result.current.totalPages).toBe(2);
  expect(result.current.total).toBe(25);
  // Page 1 shows only day 1 rows; its header counts the income row on page 2.
  expect(result.current.dayTotals).toEqual({ [new Date(2026, 9, 1).toDateString()]: 500 - 20 * 10 });
  expect(getPageStats).not.toHaveBeenCalled();
});

it('fetches the full-day net for days that straddle a page break', async () => {
  serve([tx('a', 3, 'expense', 100), tx('b', 2, 'expense', 50)], { total: 40, total_pages: 2 });
  getPageStats.mockImplementation(({ dateRange }) =>
    Promise.resolve({ success: true, data: { stats: { netIncome: dateRange.start.getDate() === 3 ? -999 : -50 } } }),
  );

  const { result } = render();

  await waitFor(() => expect(Object.keys(result.current.dayTotals)).toHaveLength(2));
  expect(result.current.dayTotals[new Date(2026, 9, 3).toDateString()]).toBe(-999);
  expect(getPageStats).toHaveBeenCalledTimes(2);
});

it('leaves a day on the page figure when its total cannot load', async () => {
  serve([tx('a', 3, 'expense', 100)], { total: 40, total_pages: 2 });
  getPageStats.mockResolvedValue({ success: false, message: 'nope' });

  const { result } = render();

  await waitFor(() => expect(getPageStats).toHaveBeenCalled());
  expect(result.current.dayTotals).toEqual({});
});

it('does not fetch day totals for a single page or a non-date sort', () => {
  serve([tx('a', 3, 'expense', 100)], { total: 1, total_pages: 1 });
  render();
  serve([tx('a', 3, 'expense', 100)], { total: 40, total_pages: 2 });
  render({ ...filters, sortBy: 'amount' });
  expect(getPageStats).not.toHaveBeenCalled();
});
