import { act, renderHook } from '@testing-library/react';
import { useSession } from 'next-auth/react';
import { portfolioService } from '@/services/portfolioService';
import { usePriceRefreshOnLogin } from '@/hooks/usePriceRefreshOnLogin';

jest.mock('@/services/portfolioService', () => ({
  portfolioService: { refreshPortfolioPrices: jest.fn() },
}));

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
