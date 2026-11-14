import { createElement, type ReactNode } from 'react';
import { act, renderHook as rtlRenderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { portfolioService } from '@/services/portfolioService';
import { usePriceRefreshOnLogin } from '@/hooks/usePriceRefreshOnLogin';

jest.mock('@/services/portfolioService', () => ({
  portfolioService: { refreshPortfolioPrices: jest.fn() },
}));

let queryClient: QueryClient;

function renderHook<T>(hook: () => T) {
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
  return rtlRenderHook(hook, { wrapper });
}

const mockSession = useSession as jest.Mock;
const refresh = portfolioService.refreshPortfolioPrices as jest.Mock;

function signIn(accessToken: string | null = 'tok') {
  mockSession.mockReturnValue({ data: { user: { id: 'u1' }, accessToken }, status: 'authenticated' });
}

async function flush(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  sessionStorage.clear();
  localStorage.clear();
  refresh.mockResolvedValue({ success: true, data: { updated: 1, cached: 0 } });
  queryClient = new QueryClient();
});

afterEach(() => jest.useRealTimers());

it('refreshes once shortly after a fresh login with no cached prices', async () => {
  signIn();
  renderHook(() => usePriceRefreshOnLogin());
  expect(refresh).not.toHaveBeenCalled();

  await flush(500);
  expect(refresh).toHaveBeenCalledWith(false);
  expect(sessionStorage.getItem('last_login_check_u1')).not.toBeNull();
});

it('skips when it already checked within the hour', async () => {
  sessionStorage.setItem('last_login_check_u1', String(Date.now()));
  signIn();
  renderHook(() => usePriceRefreshOnLogin());
  await flush(500);
  expect(refresh).not.toHaveBeenCalled();
});

it('defers the refresh when prices are already cached', async () => {
  localStorage.setItem('aspiro_portfolio_prices_cache', '{}');
  refresh.mockRejectedValue(new Error('offline'));
  signIn();
  renderHook(() => usePriceRefreshOnLogin());

  await flush(500);
  expect(refresh).not.toHaveBeenCalled();
  await flush(2000);
  expect(refresh).toHaveBeenCalledTimes(1);
});

it('tolerates an unsuccessful refresh', async () => {
  refresh.mockResolvedValue({ success: false, message: 'rate limited' });
  signIn();
  renderHook(() => usePriceRefreshOnLogin());
  await flush(500);
  expect(refresh).toHaveBeenCalledTimes(1);
});

it.each([
  ['signed out', () => mockSession.mockReturnValue({ data: null, status: 'unauthenticated' })],
  ['token not issued yet', () => signIn(null)],
])('does nothing when %s', async (_label, arrange) => {
  arrange();
  renderHook(() => usePriceRefreshOnLogin());
  await flush(5000);
  expect(refresh).not.toHaveBeenCalled();
});

it('cancels the pending check on unmount', async () => {
  signIn();
  const { unmount } = renderHook(() => usePriceRefreshOnLogin());
  unmount();
  await flush(500);
  expect(refresh).not.toHaveBeenCalled();
});

it('refetches the dashboard once it has written new prices', async () => {
  // The page rendered from the stored prices before this returned; without a
  // refetch the fresh ones only showed on the next visit.
  const invalidate = jest.spyOn(queryClient, 'invalidateQueries');
  signIn();
  renderHook(() => usePriceRefreshOnLogin());
  await flush(500);
  expect(invalidate).toHaveBeenCalledWith(expect.objectContaining({ queryKey: ['portfolio'] }));
});

it('does not refetch when nothing changed', async () => {
  refresh.mockResolvedValue({ success: true, data: { updated: 0, cached: 3 } });
  const invalidate = jest.spyOn(queryClient, 'invalidateQueries');
  signIn();
  renderHook(() => usePriceRefreshOnLogin());
  await flush(500);
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(invalidate).not.toHaveBeenCalled();
});
