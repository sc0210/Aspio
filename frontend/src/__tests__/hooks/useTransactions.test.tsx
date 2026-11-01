/**
 * useTransactions: the authenticated fetch (single page, or every page with
 * dedup for export/import), the demo-mode filter that mirrors the server's, and
 * the optimistic create/delete that must roll back when the server refuses.
 */
import { useMemo } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import toast from 'react-hot-toast';
import { useAuthContext } from '@/contexts/AuthContext';
import { useDemo } from '@/contexts/DemoContext';
import { transactionService } from '@/services/transactionService';
import { useTransactions } from '@/hooks/useTransactions';
import type { Transaction } from '@/shared/types';
import { createQueryClient, createQueryWrapper } from '../utils/queryWrapper';

jest.mock('react-hot-toast', () => {
  const t = Object.assign(jest.fn(), { success: jest.fn(), error: jest.fn(), dismiss: jest.fn() });
  return { __esModule: true, default: t, toast: t };
});

jest.mock('@/contexts/DemoContext', () => ({ useDemo: jest.fn() }));

jest.mock('@/services/transactionService', () => ({
  transactionService: {
    getTransactions: jest.fn(),
    createTransaction: jest.fn(),
    updateTransaction: jest.fn(),
    deleteTransaction: jest.fn(),
  },
}));

const mockAuth = useAuthContext as jest.Mock;
const mockUseDemo = useDemo as jest.Mock;
const svc = transactionService as jest.Mocked<typeof transactionService>;
const toastMock = toast as unknown as { success: jest.Mock; error: jest.Mock };

const tx = (id: string, over: Partial<Transaction> = {}): Transaction => ({
  id, userId: 'u1', type: 'expense', amount: 100, currency: 'TWD', category: 'Food',
  description: `row ${id}`, date: new Date(2026, 9, 10), walletType: 'life', tags: [],
  createdAt: new Date(), updatedAt: new Date(), ...over,
} as Transaction);

const addDemoTransaction = jest.fn();

function setMode(isDemo: boolean, demoTransactions: Transaction[] = []) {
  mockAuth.mockReturnValue({
    mode: isDemo ? 'demo' : 'authenticated',
    isAuthenticated: !isDemo,
    isDemo,
    user: isDemo ? null : { id: 'u1' },
    canPersistData: !isDemo,
    session: isDemo ? null : { user: { id: 'u1' } },
    status: isDemo ? 'unauthenticated' : 'authenticated',
  });
  mockUseDemo.mockReturnValue({ demoTransactions, addDemoTransaction, demoRevision: 0 });
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('authenticated fetch', () => {
  beforeEach(() => setMode(false));

  it('fetches one page with the given options', async () => {
    const meta = { total: 1, page: 1, limit: 20, total_pages: 1, has_next: false, has_previous: false };
    svc.getTransactions.mockResolvedValue({ success: true, data: [tx('a')], meta } as never);

    const { result } = renderHook(() => useTransactions({ type: 'expense', page: 2 }), { wrapper: createQueryWrapper() });

    await waitFor(() => expect(result.current.transactions).toHaveLength(1));
    expect(svc.getTransactions).toHaveBeenCalledWith({ type: 'expense', page: 2 });
    expect(result.current.meta).toEqual(meta);
  });

  it('does not fetch when disabled, and returns a stable empty list', async () => {
    const { result, rerender } = renderHook(() => useTransactions({ enabled: false }), { wrapper: createQueryWrapper() });
    const first = result.current.transactions;
    rerender();

    expect(svc.getTransactions).not.toHaveBeenCalled();
    expect(result.current.transactions).toEqual([]);
    expect(result.current.transactions).toBe(first);
  });

  it('fetchAll walks pages of 200 until a short one, dropping rows seen twice', async () => {
    const page1 = Array.from({ length: 200 }, (_, i) => tx(`p1-${i}`));
    // A concurrent insert shifted the last row of page 1 onto page 2.
    const page2 = [tx('p1-199'), tx('p2-0'), tx('p2-1')];
    svc.getTransactions
      .mockResolvedValueOnce({ success: true, data: page1 } as never)
      .mockResolvedValueOnce({ success: true, data: page2, meta: { total: 202 } } as never);

    const { result } = renderHook(() => useTransactions({ fetchAll: true, walletType: 'life' }), { wrapper: createQueryWrapper() });

    await waitFor(() => expect(result.current.transactions).toHaveLength(202));
    expect(svc.getTransactions).toHaveBeenNthCalledWith(1, { fetchAll: true, walletType: 'life', page: 1, limit: 200 });
    expect(svc.getTransactions).toHaveBeenNthCalledWith(2, { fetchAll: true, walletType: 'life', page: 2, limit: 200 });
    expect(new Set(result.current.transactions.map((t) => t.id)).size).toBe(202);
    expect(result.current.meta).toEqual({ total: 202 });
  });

  it('fetchAll keeps the pages it has when a later page fails', async () => {
    svc.getTransactions
      .mockResolvedValueOnce({ success: true, data: Array.from({ length: 200 }, (_, i) => tx(`r${i}`)) } as never)
      .mockResolvedValueOnce({ success: false, message: 'timeout' } as never);

    const { result } = renderHook(() => useTransactions({ fetchAll: true }), { wrapper: createQueryWrapper() });

    await waitFor(() => expect(result.current.transactions).toHaveLength(200));
    expect(svc.getTransactions).toHaveBeenCalledTimes(2);
  });

  it('fetchAll surfaces a first-page failure instead of an empty success', async () => {
    svc.getTransactions.mockResolvedValue({ success: false, message: 'Unauthorized' } as never);

    const { result } = renderHook(() => useTransactions({ fetchAll: true }), { wrapper: createQueryWrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(svc.getTransactions).toHaveBeenCalledTimes(1);
    expect(result.current.transactions).toEqual([]);
  });
});

describe('demo filtering mirrors the server', () => {
  const rows = [
    tx('food', { category: 'Food', description: 'Ramen', amount: 280, tags: ['lunch'] }),
    tx('rent', { category: 'Housing', description: 'Rent', amount: 18000, walletType: 'emergency' }),
    tx('pay', { type: 'income', category: 'Salary', description: 'Payroll', amount: 60000 }),
    tx('old', { category: 'Food', description: 'Snack', date: new Date(2026, 0, 5), paymentMethod: 'Line Pay' }),
  ];

  async function filtered(options: Parameters<typeof useTransactions>[0]) {
    setMode(true, rows);
    const { result } = renderHook(() => useTransactions(options), { wrapper: createQueryWrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(svc.getTransactions).not.toHaveBeenCalled();
    return result.current.transactions.map((t) => t.id);
  }

  it.each([
    ['type', { type: 'income' as const }, ['pay']],
    ['comma-separated categories', { category: 'Food,Salary' }, ['food', 'pay', 'old']],
    ['wallet', { walletType: 'emergency' }, ['rent']],
    ['date range', { dateRange: { start: new Date(2026, 9, 1), end: new Date(2026, 9, 31) } }, ['food', 'rent', 'pay']],
    ['search on description', { search: 'ramen' }, ['food']],
    ['search on #tag', { search: '#lunch' }, ['food']],
    ['search on payment method', { search: 'line pay' }, ['old']],
    ['search on amount', { search: '18000' }, ['rent']],
    ['blank search', { search: '   ' }, ['food', 'rent', 'pay', 'old']],
  ])('%s', async (_label, options, expected) => {
    await expect(filtered(options)).resolves.toEqual(expected);
  });
});

it('demo Transfer filter returns both legs, which are stored as expense and income', async () => {
  setMode(true, [
    tx('food', { category: 'Food' }),
    tx('out', { category: 'Transfer', transferGroupId: 'g1' }),
    tx('in', { type: 'income', category: 'Transfer', walletType: 'emergency', transferGroupId: 'g1' }),
    tx('legacy', { category: '轉帳支出' }),
    tx('fee', { category: '轉帳手續費' }),
  ]);
  const { result } = renderHook(() => useTransactions({ type: 'transfer' }), { wrapper: createQueryWrapper() });
  await waitFor(() => expect(result.current.isLoading).toBe(false));
  expect(result.current.transactions.map((t) => t.id)).toEqual(['out', 'in', 'legacy']);
});

describe('createTransaction', () => {
  const input = { type: 'expense', amount: 50, currency: 'TWD', category: 'Food', description: 'Tea', date: new Date(), walletType: 'life', tags: [] } as never;

  it('in demo mode adds to the demo store and never calls the API', async () => {
    setMode(true);
    const { result } = renderHook(() => useTransactions(), { wrapper: createQueryWrapper() });

    let created: { data?: Transaction } | undefined;
    await act(async () => {
      created = await result.current.createTransaction(input);
    });

    expect(addDemoTransaction).toHaveBeenCalledWith(input);
    expect(svc.createTransaction).not.toHaveBeenCalled();
    expect(created!.data!.id).toMatch(/^demo-/);
    expect(toastMock.success).toHaveBeenCalled();
  });

  it('shows the row optimistically, then swaps in the saved one', async () => {
    setMode(false);
    const client = createQueryClient();
    svc.getTransactions.mockResolvedValue({ success: true, data: [tx('existing')] } as never);
    let resolveCreate!: (v: unknown) => void;
    svc.createTransaction.mockReturnValue(new Promise((r) => { resolveCreate = r; }) as never);

    const { result } = renderHook(() => useTransactions(), { wrapper: createQueryWrapper(client) });
    await waitFor(() => expect(result.current.transactions).toHaveLength(1));

    let pending!: Promise<unknown>;
    act(() => {
      pending = result.current.createTransaction(input);
    });

    await waitFor(() => expect(result.current.transactions).toHaveLength(2));
    expect(result.current.transactions[0].id).toMatch(/^temp-/);

    svc.getTransactions.mockResolvedValue({ success: true, data: [tx('saved'), tx('existing')] } as never);
    await act(async () => {
      resolveCreate({ success: true, data: tx('saved') });
      await pending;
    });

    await waitFor(() => expect(result.current.transactions.map((t) => t.id)).toEqual(['saved', 'existing']));
    expect(toastMock.success).toHaveBeenCalled();
  });

  it('rolls the optimistic row back and shows the error when the server refuses', async () => {
    setMode(false);
    svc.getTransactions.mockResolvedValue({ success: true, data: [tx('existing')] } as never);
    svc.createTransaction.mockRejectedValue(new Error('Insufficient balance'));

    const client = createQueryClient();
    const { result } = renderHook(() => useTransactions(), { wrapper: createQueryWrapper(client) });
    await waitFor(() => expect(result.current.transactions).toHaveLength(1));

    await act(async () => {
      await expect(result.current.createTransaction(input)).rejects.toThrow('Insufficient balance');
    });

    expect(result.current.transactions.map((t) => t.id)).toEqual(['existing']);
    expect(toastMock.error).toHaveBeenCalledWith('Insufficient balance');
  });
});

describe('updateTransaction / deleteTransaction', () => {
  beforeEach(() => setMode(false));

  it('update calls the service and toasts', async () => {
    svc.getTransactions.mockResolvedValue({ success: true, data: [] } as never);
    svc.updateTransaction.mockResolvedValue({ success: true } as never);
    const { result } = renderHook(() => useTransactions(), { wrapper: createQueryWrapper() });

    await act(async () => {
      await result.current.updateTransaction({ id: 't1', data: { amount: 9 } });
    });

    expect(svc.updateTransaction).toHaveBeenCalledWith('t1', { amount: 9 });
    expect(toastMock.success).toHaveBeenCalled();
  });

  it('update failure shows the error', async () => {
    svc.getTransactions.mockResolvedValue({ success: true, data: [] } as never);
    svc.updateTransaction.mockRejectedValue(new Error('Locked'));
    const { result } = renderHook(() => useTransactions(), { wrapper: createQueryWrapper() });

    await act(async () => {
      await expect(result.current.updateTransaction({ id: 't1', data: {} })).rejects.toThrow('Locked');
    });
    expect(toastMock.error).toHaveBeenCalledWith('Locked');
  });

  it('delete removes the row at once and restores it if the server refuses', async () => {
    svc.getTransactions.mockResolvedValue({ success: true, data: [tx('a'), tx('b')] } as never);
    let rejectDelete!: (e: Error) => void;
    svc.deleteTransaction.mockReturnValue(new Promise((_, rej) => { rejectDelete = rej; }) as never);

    const { result } = renderHook(() => useTransactions(), { wrapper: createQueryWrapper() });
    await waitFor(() => expect(result.current.transactions).toHaveLength(2));

    let pending!: Promise<unknown>;
    act(() => {
      pending = result.current.deleteTransaction('a').catch(() => undefined);
    });
    await waitFor(() => expect(result.current.transactions.map((t) => t.id)).toEqual(['b']));

    await act(async () => {
      rejectDelete(new Error('Forbidden'));
      await pending;
    });

    await waitFor(() => expect(result.current.transactions.map((t) => t.id)).toEqual(['a', 'b']));
    expect(toastMock.error).toHaveBeenCalledWith('Forbidden');
  });
});

describe('request cost of a create', () => {
  const input = { type: 'expense', amount: 50, currency: 'TWD', category: 'Food', description: 'Tea', date: new Date(), walletType: 'life', tags: [] } as never;
  const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 100)); });

  it('refetches only the mounted list, once', async () => {
    setMode(false);
    svc.getTransactions.mockResolvedValue({ success: true, data: [tx('existing')] } as never);
    svc.createTransaction.mockResolvedValue({ success: true, data: tx('saved') } as never);
    const client = createQueryClient();
    const wrapper = createQueryWrapper(client);

    // Lists the user visited earlier: cached, no longer on screen.
    for (const options of [{ type: 'income' as const }, { walletType: 'emergency' }, { page: 2 }]) {
      const { unmount } = renderHook(() => useTransactions(options), { wrapper });
      await settle();
      unmount();
    }
    const { result } = renderHook(() => useTransactions(), { wrapper });
    await waitFor(() => expect(result.current.transactions).toHaveLength(1));

    svc.getTransactions.mockClear();
    await act(async () => {
      await result.current.createTransaction(input);
    });
    await settle();

    expect(svc.getTransactions).toHaveBeenCalledTimes(1);
  });

  it('an off-screen filtered list never shows the new row it does not match', async () => {
    setMode(false);
    svc.getTransactions.mockImplementation(async (options) => ({
      success: true,
      data: options?.type === 'income' ? [tx('salary', { type: 'income' })] : [tx('existing')],
    }) as never);
    svc.createTransaction.mockResolvedValue({ success: true, data: tx('saved') } as never);
    const client = createQueryClient();
    const wrapper = createQueryWrapper(client);

    const incomeList = renderHook(() => useTransactions({ type: 'income' }), { wrapper });
    await waitFor(() => expect(incomeList.result.current.transactions).toHaveLength(1));
    incomeList.unmount();
    const { result } = renderHook(() => useTransactions(), { wrapper });
    await waitFor(() => expect(result.current.transactions).toHaveLength(1));

    await act(async () => {
      await result.current.createTransaction(input);
    });
    await settle();

    const seen: string[][] = [];
    const reopened = renderHook(() => {
      const hook = useTransactions({ type: 'income' });
      seen.push(hook.transactions.map((t) => t.id));
      return hook;
    }, { wrapper });
    await waitFor(() => expect(reopened.result.current.transactions).toHaveLength(1));
    expect(seen.flat()).not.toContain('saved');
  });

  it('a date range ending "now" hits the cache on the next mount the same day', async () => {
    setMode(false);
    svc.getTransactions.mockResolvedValue({ success: true, data: [] } as never);
    const wrapper = createQueryWrapper(createQueryClient());
    // As useExpenseBreakdown builds it: memoised per mount, so each mount gets a new "now".
    const useRangeToNow = () => {
      const dateRange = useMemo(() => ({ start: new Date(2026, 9, 1), end: new Date() }), []);
      return useTransactions({ dateRange });
    };

    const first = renderHook(useRangeToNow, { wrapper });
    await settle();
    first.unmount();
    await new Promise((r) => setTimeout(r, 5));
    renderHook(useRangeToNow, { wrapper });
    await settle();

    expect(svc.getTransactions).toHaveBeenCalledTimes(1);
  });
});
