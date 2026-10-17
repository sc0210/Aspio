/** The phone portfolio hero shows the time-weighted annual return, when the backend has one. */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MobilePortfolio } from '@/components/portfolio/MobilePortfolio';

const mockRisk: { value: unknown } = { value: null };
const mockGetRisk = jest.fn(() => Promise.resolve(mockRisk.value));
jest.mock('@/services/portfolioService', () => ({
  portfolioService: { getRiskMetrics: () => mockGetRisk() },
}));
jest.mock('@/hooks/usePortfolio', () => ({
  usePortfolio: () => ({
    isLoading: false,
    portfolio: { data: { totalValue: 7_000_000, totalGainLoss: 2_000_000, totalGainLossPercentage: 40, todayGainLoss: 10_000, todayGainLossPercentage: 0.14, holdings: [{ id: 'h1', symbol: '0050', name: '0050', type: 'etf', quantity: 100, totalValue: 7_000_000, currency: 'TWD', gainLoss: 2_000_000, gainLossPercentage: 40 }] } },
  }),
}));
const mockDemo = { value: false };
jest.mock('@/hooks/useAppMode', () => ({ useAppMode: () => ({ user: { email: 'me@example.com' }, isDemo: mockDemo.value }) }));
jest.mock('@/contexts/PrivacyContext', () => ({ usePrivacy: () => ({ isValueVisible: true }) }));
jest.mock('@/components/layout/DashboardLayout', () => ({ DashboardLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
jest.mock('@/components/dashboard/BiggerScreenHint', () => ({ BiggerScreenHint: () => null }));
jest.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({ t: (_k: string, f?: string) => (typeof f === 'string' ? f : _k) }),
}));

afterEach(() => { mockDemo.value = false; });

const show = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MobilePortfolio />
  </QueryClientProvider>,
);

it('shows the annual return under today\'s change', async () => {
  mockRisk.value = { cagrPercentage: 40.43 };
  show();
  expect(await screen.findByText('+40.4%')).toBeInTheDocument();
  expect(screen.getByText('Annual return')).toBeInTheDocument();
});

it('shows nothing when there is no annual return yet', async () => {
  mockRisk.value = { cagrPercentage: null };
  show();
  await screen.findByText('Portfolio Value');
  expect(screen.queryByText('Annual return')).not.toBeInTheDocument();
});

it('asks the backend in demo mode too: it serves demo risk metrics unauthenticated', async () => {
  mockDemo.value = true;
  mockRisk.value = { cagrPercentage: 11.2 };
  mockGetRisk.mockClear();
  show();
  expect(await screen.findByText('+11.2%')).toBeInTheDocument();
  expect(mockGetRisk).toHaveBeenCalled(); // a re-added `enabled: !isDemo` fails here
});
