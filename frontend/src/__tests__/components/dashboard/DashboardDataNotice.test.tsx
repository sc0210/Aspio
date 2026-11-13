/**
 * The home-page notice that says when figures are missing or out of date
 * instead of showing them as if they were complete.
 */
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { DashboardDataNotice } from '@/components/dashboard/DashboardDataNotice';
import type { PortfolioHolding } from '@/shared/types';

jest.mock('react-i18next', () => {
  const fill = (text: string, vars?: Record<string, unknown>) =>
    text.replace(/\{\{(\w+)\}\}/g, (_: string, k: string) => String(vars?.[k] ?? ''));
  const t = (key: string, arg?: string | Record<string, unknown>) =>
    typeof arg === 'string' ? arg : fill(String(arg?.defaultValue ?? key), arg);
  const translation = { t, i18n: { language: 'en' } };
  return { initReactI18next: { type: '3rdParty', init: () => {} }, useTranslation: () => translation };
});

let mockDemo = false;
jest.mock('@/hooks/useAppMode', () => ({ useAppMode: () => ({ isDemo: mockDemo }) }));

let mockHoldings: PortfolioHolding[] = [];
jest.mock('@/hooks/usePortfolio', () => ({
  usePortfolio: () => ({ holdings: mockHoldings, isLoading: false }),
}));

const mockRefresh = jest.fn();
jest.mock('@/services/portfolioService', () => ({
  portfolioService: { refreshPortfolioPrices: (...args: unknown[]) => mockRefresh(...args) },
}));
let mockRates: Record<string, number> | undefined;
jest.mock('@/hooks/useExchangeRates', () => ({
  useExchangeRates: () => ({ data: mockRates ? { rates: mockRates } : undefined }),
}));
jest.mock('react-hot-toast', () => ({ __esModule: true, default: { error: jest.fn() } }));

function holding(overrides: Partial<PortfolioHolding>): PortfolioHolding {
  return {
    id: 'h', symbol: '0050', name: '0050', type: 'etf', quantity: 10, averageCost: 100,
    currentPrice: 102.5, totalValue: 1025, totalCost: 1000, gainLoss: 25, gainLossPercentage: 2.5,
    currency: 'TWD', exchange: 'TWSE', market: 'TW', walletType: 'portfolio',
    marketState: 'closed', priceSession: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date()),
    previousClose: 100.95, lastUpdated: new Date(),
    ...overrides,
  };
}

let client: QueryClient;
function renderNotice() {
  return render(
    <QueryClientProvider client={client}>
      <DashboardDataNotice />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockDemo = false;
  mockHoldings = [holding({})];
  mockRefresh.mockReset();
  mockRates = undefined;
  sessionStorage.clear();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

it('stays silent when everything loaded and is current', () => {
  const { container } = renderNotice();
  expect(container).toBeEmptyDOMElement();
});

it('names stale prices and refreshes them on request', async () => {
  mockHoldings = [holding({ symbol: '2330', priceSession: '2020-01-06' })];
  mockRefresh.mockResolvedValue({ success: true, data: { updated: 1 } });
  const invalidate = jest.spyOn(client, 'invalidateQueries');
  renderNotice();

  expect(screen.getByText(/Prices for 2330 are from/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Refresh prices' }));
  await waitFor(() => expect(mockRefresh).toHaveBeenCalledWith(true));
  await waitFor(() => expect(invalidate).toHaveBeenCalled());
});

it('says which holdings are left out of today\'s change', () => {
  mockHoldings = [holding({ symbol: 'BTC-USD', previousClose: undefined })];
  renderNotice();
  expect(screen.getByText(/No previous close for BTC-USD/)).toBeInTheDocument();
});

it('counts a section that failed to load and retries it', async () => {
  const fetcher = jest.fn().mockRejectedValue(new Error('500'));
  const Failing = () => {
    // A mounted widget whose query failed.
    useQuery({ queryKey: ['dashboard'], queryFn: fetcher });
    return null;
  };
  render(
    <QueryClientProvider client={client}>
      <Failing />
      <DashboardDataNotice />
    </QueryClientProvider>,
  );

  expect(await screen.findByText(/1 section\(s\) couldn't load/)).toBeInTheDocument();
  const calls = fetcher.mock.calls.length;
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Retry' })); });
  await waitFor(() => expect(fetcher.mock.calls.length).toBeGreaterThan(calls));
});

it('ignores failures outside the financial figures, and refetches that kept their data', async () => {
  const fail = jest.fn().mockRejectedValue(new Error('500'));
  client.setQueryData(['portfolio', 'u1'], { data: { holdings: [] } }); // had data before failing
  const Widgets = () => {
    useQuery({ queryKey: ['notifications'], queryFn: fail });
    useQuery({ queryKey: ['portfolio', 'u1'], queryFn: fail, staleTime: 0, refetchOnMount: 'always' });
    return null;
  };
  render(
    <QueryClientProvider client={client}>
      <Widgets />
      <DashboardDataNotice />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(fail).toHaveBeenCalledTimes(2));
  await act(async () => { await Promise.resolve(); });
  expect(screen.queryByText(/couldn't load/)).not.toBeInTheDocument();
});

it('stays dismissed for the same problems, and comes back for a new one', () => {
  mockHoldings = [holding({ symbol: 'BTC-USD', previousClose: undefined })];
  const { rerender } = renderNotice();
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
  expect(screen.queryByRole('status')).not.toBeInTheDocument();

  mockHoldings = [...mockHoldings, holding({ id: 'x', symbol: 'ETH-USD', previousClose: undefined })];
  rerender(
    <QueryClientProvider client={client}>
      <DashboardDataNotice />
    </QueryClientProvider>,
  );
  expect(screen.getByText(/BTC-USD, ETH-USD/)).toBeInTheDocument();
});

it('names a currency with no rate, and drops it when the rates arrive', () => {
  mockHoldings = [holding({ currency: 'XYZ' })];
  const { rerender } = renderNotice();
  expect(screen.getByText(/No exchange rate for XYZ/)).toBeInTheDocument();

  mockRates = { XYZ: 4.2 };
  rerender(
    <QueryClientProvider client={client}>
      <DashboardDataNotice />
    </QueryClientProvider>,
  );
  expect(screen.queryByText(/No exchange rate/)).not.toBeInTheDocument();
});

it('shows nothing in demo mode', () => {
  mockDemo = true;
  mockHoldings = [holding({ previousClose: undefined })];
  const { container } = renderNotice();
  expect(container).toBeEmptyDOMElement();
});
