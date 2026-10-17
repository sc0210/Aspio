/**
 * Tests for ComprehensiveDashboard — focused on the period-mapping fix and rendering.
 * Heavy child components are mocked to keep tests fast.
 */
import React from 'react';
import { screen } from '@testing-library/react';
// Components here call useQuery; react-query is no longer stubbed globally,
// so they need a real client. renderWithQuery supplies one per test.
import { renderWithQuery as render } from '../../utils/queryWrapper';

// ─── Mock all hooks and heavy dependencies ──────────────────────────────────

const mockUseOptimizedDashboard = jest.fn();
const mockUseWalletTrends = jest.fn();

jest.mock('@/hooks/useOptimizedDashboard', () => ({
  useOptimizedDashboard: (...args: unknown[]) => mockUseOptimizedDashboard(...args),
}));

jest.mock('@/hooks/useWalletTrends', () => ({
  useWalletTrends: (...args: unknown[]) => mockUseWalletTrends(...args),
  // The strip prepends this so its deltas span the whole period rather than
  // one day less of it. Undefined here is the documented fallback — the tests
  // below assert on the series, not on the opening balance.
  useWalletTrendBaseline: () => ({ data: undefined }),
}));

jest.mock('@/hooks/useAppMode', () => ({
  useAppMode: () => ({ isDemo: false, user: { name: 'Test User' } }),
}));

// Reached indirectly through the header's view toggle; useDemo throws outside a
// DemoProvider and took the whole render down with it.
jest.mock('@/contexts/DemoContext', () => ({
  useDemo: () => ({
    isDemoMode: false,
    demoTransactions: [],
    enableDemo: jest.fn(),
    disableDemo: jest.fn(),
  }),
  DemoProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

jest.mock('@/hooks/useDataSynchronization', () => ({
  // Keep the real QUERY_KEYS. Stubbing only the two hooks dropped the constants
  // the module also exports, and child hooks that build cache keys from them
  // died on "Cannot read properties of undefined (reading 'PORTFOLIO')".
  ...jest.requireActual('@/hooks/useDataSynchronization'),
  useDataSynchronization: () => {},
  useDashboardRefresh: () => ({ refreshDashboard: jest.fn() }),
}));

jest.mock('@/hooks/usePriceRefreshOnLogin', () => ({
  usePriceRefreshOnLogin: () => {},
}));

jest.mock('@/hooks/useGoals', () => ({
  useGoals: () => ({ data: [], isLoading: false }),
}));

jest.mock('react-i18next', () => {
  // t's second argument is either a string default OR an options object with
  // interpolation values. Returning it unconditionally handed React the object
  // from `t('dashboard:todayStrip.savingsRate', { rate })` in
  // DashboardTodayStrip, which crashed the whole render with "Objects are not
  // valid as a React child (found: object with keys {rate})".
  const t = (key: string, fallback?: unknown) =>
    typeof fallback === 'string' ? fallback : key;
  const i18n = { language: 'en', changeLanguage: jest.fn() };
  const translation = { t, i18n };
  return {
    // i18next calls .use(initReactI18next) at import time; a mock without it
    // makes lib/i18n throw and the whole suite dies before any test runs.
    initReactI18next: { type: '3rdParty', init: () => {} },
    useTranslation: () => translation,
  };
});

jest.mock('@/components/layout/DashboardLayout', () => ({
  DashboardLayout: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dashboard-layout">{children}</div>
  ),
}));

jest.mock('@/components/ui/DashboardSkeleton', () => ({
  ComprehensiveDashboardSkeleton: () => <div data-testid="skeleton" />,
}));

jest.mock('@/components/ui/Alert', () => ({
  DemoAlert: () => <div data-testid="demo-alert" />,
}));

jest.mock('@/components/ui/DataRefreshButton', () => ({
  DataRefreshButton: () => <button data-testid="refresh-btn" />,
}));

jest.mock('@/components/help/FinancialTermsHelp', () => ({
  FinancialTermsHelp: () => <div />,
}));

jest.mock('@/components/dashboard/WalletNetWorthCard', () => ({
  WalletNetWorthCard: ({ dateRange }: { dateRange: string }) => (
    <div data-testid="wallet-card" data-daterange={dateRange} />
  ),
}));

jest.mock('@/components/dashboard/MonthlyInsightCard', () => ({
  MonthlyInsightCard: () => <div data-testid="monthly-insight" />,
}));

jest.mock('@/components/dashboard/MemoizedComponents', () => ({
  MemoizedRecentTransactions: () => <div data-testid="recent-transactions" />,
}));

jest.mock('@/components/dashboard/LazyCharts', () => ({
  LazyPortfolioOverview: () => <div data-testid="portfolio-overview" />,
}));

jest.mock('@/components/goals/GoalsOverview', () => ({
  GoalsOverview: () => <div data-testid="goals-overview" />,
}));

jest.mock('@/components/goals/EditGoalModal', () => ({
  EditGoalModal: () => null,
}));

jest.mock('@/components/goals/ContributeModal', () => ({
  ContributeModal: () => null,
}));

// ─── Helpers ────────────────────────────────────────────────────────────────

const emptyDashboard = {
  data: {
    stats: {
      life_wallet: 0, portfolio_wallet: 0, emergency_wallet: 0,
      total_asset: 0, investment_total: 0, totalBalance: 0,
      monthlyIncome: 0, monthlyExpenses: 0, savingsRate: 0,
      netWorth: 0, portfolioValue: 0, portfolioGrowth: 0,
      monthlyChange: 0, upcomingBills: 0, totalAssets: 0,
    },
    recentTransactions: [],
    portfolio: { totalValue: 0, totalGainLoss: 0, gainLossPercentage: 0, holdings: [] },
    activities: [],
    trendData: undefined,
    walletTrendData: [],
  },
};

function setupMocks(overrides?: { dashboardLoading?: boolean; dashboardError?: unknown }) {
  mockUseOptimizedDashboard.mockReturnValue({
    data: emptyDashboard,
    isLoading: overrides?.dashboardLoading ?? false,
    error: overrides?.dashboardError ?? null,
    isFetching: false,
  });
  mockUseWalletTrends.mockReturnValue({ data: [] });
}

// ─── Import the component AFTER mocks ───────────────────────────────────────
import { ComprehensiveDashboard } from '@/components/dashboard/ComprehensiveDashboard';

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('ComprehensiveDashboard', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('rendering', () => {
    it('renders the dashboard layout with key sections', async () => {
      setupMocks();
      render(<ComprehensiveDashboard />);
      expect(screen.getByTestId('dashboard-layout')).toBeInTheDocument();
      // WalletNetWorthCard is next/dynamic'd (it pulls in recharts), so it is
      // absent from the first synchronous render — the placeholder shows first.
      // findBy waits for the chunk to resolve; getBy would race it.
      expect(await screen.findByTestId('wallet-card')).toBeInTheDocument();
      expect(screen.getByTestId('portfolio-overview')).toBeInTheDocument();
      expect(screen.getByTestId('monthly-insight')).toBeInTheDocument();
      expect(screen.getByTestId('recent-transactions')).toBeInTheDocument();
    });

    it('states the balance once — the strip beneath it carries flow only', async () => {
      setupMocks();
      render(<ComprehensiveDashboard />);
      await screen.findByTestId('wallet-card');

      // The hero card owns the balance. Total Assets used to lead the strip
      // directly above it: two headline balances differing only by debt, with
      // nothing to say which one the page was about.
      expect(screen.getByLabelText('This period')).toBeInTheDocument();
      expect(
        screen.queryByText('dashboard:todayStrip.totalAssets'),
      ).not.toBeInTheDocument();
    });

    it('keeps the forecast and heatmaps closed until asked for', async () => {
      setupMocks();
      const { container } = render(<ComprehensiveDashboard />);
      await screen.findByTestId('wallet-card');

      const explore = container.querySelector('details');
      expect(explore).toBeInTheDocument();
      expect(explore).not.toHaveAttribute('open');

      // Both live inside it — they were full-width bands of chart between the
      // wallet card and the row that gets read every visit.
      expect(
        [...explore!.querySelectorAll('section')].map((s) => s.getAttribute('aria-label')),
      ).toEqual(['Growth Forecast', 'Heatmaps']);
    });

    it('shows skeleton while loading', () => {
      setupMocks({ dashboardLoading: true });
      // Override to simulate no cached data yet
      mockUseOptimizedDashboard.mockReturnValueOnce({
        data: undefined,
        isLoading: true,
        error: null,
        isFetching: false,
      });
      render(<ComprehensiveDashboard />);
      expect(screen.getByTestId('skeleton')).toBeInTheDocument();
    });

    it('shows error state when data fails to load', () => {
      mockUseOptimizedDashboard.mockReturnValue({
        data: undefined,
        isLoading: false,
        error: new Error('fetch failed'),
        isFetching: false,
      });
      mockUseWalletTrends.mockReturnValue({ data: [] });
      render(<ComprehensiveDashboard />);
      expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    });
  });

  describe('period-mapping fix: 7d passes through unchanged', () => {
    it('passes dateRange directly to useOptimizedDashboard without remapping', () => {
      setupMocks();
      render(<ComprehensiveDashboard />);
      // Default dateRange is 'month' — hook should receive 'month', not any remapped value
      expect(mockUseOptimizedDashboard).toHaveBeenCalledWith('month');
    });

    it('passes the same period to both useOptimizedDashboard and useWalletTrends', () => {
      setupMocks();
      render(<ComprehensiveDashboard />);
      const dashPeriod = mockUseOptimizedDashboard.mock.calls[0][0];
      const trendPeriod = mockUseWalletTrends.mock.calls[0][0];
      expect(dashPeriod).toBe(trendPeriod);
    });
  });

  describe('demo mode', () => {
    it('does not show demo alert when not in demo mode', () => {
      setupMocks();
      render(<ComprehensiveDashboard />);
      expect(screen.queryByTestId('demo-alert')).toBeNull();
    });
  });

  describe('language / i18n', () => {
    it('renders a date string in the header', () => {
      setupMocks();
      render(<ComprehensiveDashboard />);
      // The date element is rendered next to a CalendarIcon inside a <p>
      const dateEl = document.querySelector('p.text-xs');
      expect(dateEl?.textContent?.trim().length).toBeGreaterThan(0);
    });

    it('shows a greeting in the header', () => {
      setupMocks();
      render(<ComprehensiveDashboard />);
      // Greeting is always one of the three fallback strings
      const greetings = ['Good morning', 'Good afternoon', 'Good evening'];
      const found = greetings.some(g => screen.queryByText(new RegExp(g)));
      expect(found).toBe(true);
    });

    it('renders semantic section regions for wallet, cash-flow, and activity areas', () => {
      setupMocks();
      render(<ComprehensiveDashboard />);
      expect(screen.getByRole('region', { name: 'Wallet Overview' })).toBeInTheDocument();
      expect(screen.getByRole('region', { name: 'Cash Flow' })).toBeInTheDocument();
      expect(screen.getByRole('region', { name: 'Recent Activity' })).toBeInTheDocument();
    });
  });
});
