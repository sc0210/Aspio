/**
 * api-hooks: the transaction mutations TransactionList uses, and the
 * gamification reads/writes behind the achievements page and account menu.
 *
 * The transaction cases seed the cache the way the transactions page really
 * does — useTransactions caches the ApiResponse (`{ data: [...] }`) under a key
 * useDualModeQuery extends with mode and user id. Both optimistic updates used to
 * write the exact key ['transactions'] or skip the `{ data }` shape, so they did
 * nothing on that page; these would have caught it.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { useAuthContext } from '@/contexts/AuthContext';
import { useDemo } from '@/contexts/DemoContext';
import { apiClient } from '@/lib/api-client';
import { transactionService } from '@/services/transactionService';
import {
  useSetDayOrder,
  useUpdateTransaction,
  useDeleteTransaction,
  useMarkNotificationAsRead,
  useMarkAllNotificationsRead,
  useGamificationStats,
  useAchievementProgress,
  useUpdateStreak,
  useCheckAchievements,
} from '@/hooks/api-hooks';
import type { Transaction } from '@/shared/types';
import { createQueryClient, createQueryWrapper } from '../utils/queryWrapper';

jest.mock('@/contexts/DemoContext', () => ({ useDemo: jest.fn() }));

jest.mock('@/lib/api-client', () => ({
  apiClient: {
    updateTransaction: jest.fn(),
    deleteTransaction: jest.fn(),
    markNotificationAsRead: jest.fn(),
    markAllNotificationsRead: jest.fn(),
    getGamificationStats: jest.fn(),
    getAchievementProgress: jest.fn(),
    updateLoginStreak: jest.fn(),
    checkAllAchievements: jest.fn(),
  },
}));

jest.mock('@/services/transactionService', () => ({
  transactionService: { setDayOrder: jest.fn() },
}));

const api = apiClient as unknown as Record<string, jest.Mock>;
const mockAuth = useAuthContext as jest.Mock;
const removeDemoTransaction = jest.fn();

const PAGE_KEY = ['transactions', { page: 1 }, 'authenticated', 'u1'];
const row = (id: string, amount = 100) => ({ id, amount, description: id }) as unknown as Transaction;

function setMode(isDemo: boolean) {
  mockAuth.mockReturnValue({
    mode: isDemo ? 'demo' : 'authenticated',
    isAuthenticated: !isDemo,
    isDemo,
    user: isDemo ? null : { id: 'u1' },
    canPersistData: !isDemo,
    session: null,
    status: isDemo ? 'unauthenticated' : 'authenticated',
  });
  (useDemo as jest.Mock).mockReturnValue({ removeDemoTransaction });
}

function seeded() {
  const client = createQueryClient();
  client.setQueryData(PAGE_KEY, { success: true, data: [row('a'), row('b')] });
  client.setQueryData(['transactions', 'legacy-array'], [row('a'), row('b')]);
  client.setQueryData(['transactions', 'paginated'], { transactions: [row('a'), row('b')], total: 2 });
  // Same prefix, not a row list: must be left alone.
  client.setQueryData(['transactions', 'stats'], { data: { totalIncome: 5 } });
  return client;
}

const ids = (client: ReturnType<typeof createQueryClient>) => ({
  page: (client.getQueryData(PAGE_KEY) as { data: Transaction[] }).data.map((t) => t.id),
  legacy: (client.getQueryData(['transactions', 'legacy-array']) as Transaction[]).map((t) => t.id),
  paginated: (client.getQueryData(['transactions', 'paginated']) as { transactions: Transaction[] }).transactions.map((t) => t.id),
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  setMode(false);
});

afterEach(() => jest.restoreAllMocks());

describe('useDeleteTransaction', () => {
  it('removes the row from every cached list shape at once', async () => {
    const client = seeded();
    let finish!: () => void;
    api.deleteTransaction.mockReturnValue(new Promise<void>((r) => { finish = r; }));
    const { result } = renderHook(() => useDeleteTransaction(), { wrapper: createQueryWrapper(client) });

    act(() => { result.current.mutate('a'); });

    await waitFor(() => expect(ids(client)).toEqual({ page: ['b'], legacy: ['b'], paginated: ['b'] }));
    expect(client.getQueryData(['transactions', 'stats'])).toEqual({ data: { totalIncome: 5 } });
    await act(async () => { finish(); });
  });

  it('restores every list when the server refuses', async () => {
    const client = seeded();
    api.deleteTransaction.mockRejectedValue(new Error('Forbidden'));
    const { result } = renderHook(() => useDeleteTransaction(), { wrapper: createQueryWrapper(client) });

    await act(async () => {
      await expect(result.current.mutateAsync('a')).rejects.toThrow('Forbidden');
    });

    expect(ids(client)).toEqual({ page: ['a', 'b'], legacy: ['a', 'b'], paginated: ['a', 'b'] });
  });

  it('in demo mode removes the demo row and never calls the API', async () => {
    setMode(true);
    const { result } = renderHook(() => useDeleteTransaction(), { wrapper: createQueryWrapper() });

    await act(async () => { await result.current.mutateAsync('demo-1'); });

    expect(removeDemoTransaction).toHaveBeenCalledWith('demo-1');
    expect(api.deleteTransaction).not.toHaveBeenCalled();
  });
});

describe('useUpdateTransaction', () => {
  it('applies the edit to every cached list at once', async () => {
    const client = seeded();
    let finish!: (v: unknown) => void;
    api.updateTransaction.mockReturnValue(new Promise((r) => { finish = r; }));
    const { result } = renderHook(() => useUpdateTransaction(), { wrapper: createQueryWrapper(client) });

    act(() => { result.current.mutate({ id: 'b', data: { amount: 999 } }); });

    await waitFor(() => {
      const page = (client.getQueryData(PAGE_KEY) as { data: Transaction[] }).data;
      expect(page.find((t) => t.id === 'b')!.amount).toBe(999);
    });
    const legacy = client.getQueryData(['transactions', 'legacy-array']) as Transaction[];
    expect(legacy.find((t) => t.id === 'b')!.amount).toBe(999);
    expect(legacy.find((t) => t.id === 'a')!.amount).toBe(100);
    await act(async () => { finish({ id: 'b', amount: 999 }); });
  });

  it('rolls the edit back when the server refuses', async () => {
    const client = seeded();
    api.updateTransaction.mockRejectedValue(new Error('Locked'));
    const { result } = renderHook(() => useUpdateTransaction(), { wrapper: createQueryWrapper(client) });

    await act(async () => {
      await expect(result.current.mutateAsync({ id: 'b', data: { amount: 999 } })).rejects.toThrow('Locked');
    });

    const page = (client.getQueryData(PAGE_KEY) as { data: Transaction[] }).data;
    expect(page.find((t) => t.id === 'b')!.amount).toBe(100);
  });

  it('does not splice the raw backend reply into the cache', async () => {
    const client = seeded();
    // The API returns the snake_case row; it must not replace the mapped one.
    api.updateTransaction.mockResolvedValue({ id: 'b', amount: 999, transaction_date: '2026-10-20' });
    const invalidate = jest.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useUpdateTransaction(), { wrapper: createQueryWrapper(client) });

    await act(async () => { await result.current.mutateAsync({ id: 'b', data: { amount: 999 } }); });

    const page = (client.getQueryData(PAGE_KEY) as { data: Array<Record<string, unknown>> }).data;
    expect(page.find((t) => t.id === 'b')).not.toHaveProperty('transaction_date');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['transactions'] });
  });
});

describe('useSetDayOrder', () => {
  it('saves the order and refreshes the transactions queries', async () => {
    const client = createQueryClient();
    const invalidate = jest.spyOn(client, 'invalidateQueries');
    (transactionService.setDayOrder as jest.Mock).mockResolvedValue(['b', 'a']);
    const { result } = renderHook(() => useSetDayOrder(), { wrapper: createQueryWrapper(client) });

    await act(async () => { await result.current.mutateAsync({ date: '2026-10-20', ids: ['b', 'a'] }); });

    expect(transactionService.setDayOrder).toHaveBeenCalledWith('2026-10-20', ['b', 'a']);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['transactions'], exact: false });
  });
});

describe('notifications', () => {
  it('useMarkNotificationAsRead marks one and refreshes the bell', async () => {
    const client = createQueryClient();
    const invalidate = jest.spyOn(client, 'invalidateQueries');
    api.markNotificationAsRead.mockResolvedValue(undefined);
    const { result } = renderHook(() => useMarkNotificationAsRead(), { wrapper: createQueryWrapper(client) });

    await act(async () => { await result.current.mutateAsync('n1'); });

    expect(api.markNotificationAsRead).toHaveBeenCalledWith('n1');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['notifications'] });
  });

  it('useMarkAllNotificationsRead marks all and refreshes the bell', async () => {
    const client = createQueryClient();
    const invalidate = jest.spyOn(client, 'invalidateQueries');
    api.markAllNotificationsRead.mockResolvedValue(undefined);
    const { result } = renderHook(() => useMarkAllNotificationsRead(), { wrapper: createQueryWrapper(client) });

    await act(async () => { await result.current.mutateAsync(); });

    expect(api.markAllNotificationsRead).toHaveBeenCalled();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['notifications'] });
  });
});

describe('gamification', () => {
  it('useGamificationStats returns the stats, or null instead of an error', async () => {
    api.getGamificationStats.mockResolvedValueOnce({ level: 3 });
    const ok = renderHook(() => useGamificationStats(), { wrapper: createQueryWrapper() });
    await waitFor(() => expect(ok.result.current.data).toEqual({ level: 3 }));

    api.getGamificationStats.mockRejectedValueOnce(new Error('down'));
    const failed = renderHook(() => useGamificationStats(), { wrapper: createQueryWrapper() });
    await waitFor(() => expect(failed.result.current.isSuccess).toBe(true));
    expect(failed.result.current.data).toBeNull();
  });

  it('useGamificationStats can be held back', () => {
    renderHook(() => useGamificationStats({ enabled: false }), { wrapper: createQueryWrapper() });
    expect(api.getGamificationStats).not.toHaveBeenCalled();
  });

  it('useAchievementProgress degrades to an empty list', async () => {
    api.getAchievementProgress.mockRejectedValue(new Error('down'));
    const { result } = renderHook(() => useAchievementProgress(), { wrapper: createQueryWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });

  it.each([
    [{ streak_updated: false }, []],
    [{ streak_updated: true, new_achievements: [] }, [['gamification']]],
    [{ streak_updated: true, new_achievements: [{ id: 'x' }] }, [['gamification'], ['achievements']]],
  ])('useUpdateStreak refreshes only what changed (%#)', async (reply, keys) => {
    const client = createQueryClient();
    const invalidate = jest.spyOn(client, 'invalidateQueries');
    api.updateLoginStreak.mockResolvedValue(reply);
    const { result } = renderHook(() => useUpdateStreak(), { wrapper: createQueryWrapper(client) });

    await act(async () => { await result.current.mutateAsync(); });

    expect(invalidate.mock.calls.map(([f]) => (f as { queryKey: unknown[] }).queryKey)).toEqual(keys);
  });

  it.each([
    [[], [['gamification']]],
    [[{ id: 'x' }], [['gamification'], ['achievements']]],
  ])('useCheckAchievements refreshes achievements only when one unlocked (%#)', async (unlocked, keys) => {
    const client = createQueryClient();
    const invalidate = jest.spyOn(client, 'invalidateQueries');
    api.checkAllAchievements.mockResolvedValue(unlocked);
    const { result } = renderHook(() => useCheckAchievements(), { wrapper: createQueryWrapper(client) });

    await act(async () => { await result.current.mutateAsync(); });

    expect(invalidate.mock.calls.map(([f]) => (f as { queryKey: unknown[] }).queryKey)).toEqual(keys);
  });
});
