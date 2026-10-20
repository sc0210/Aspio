/**
 * useOptimizedDashboard assembles the dashboard header from four calls. The money
 * rules it must keep (docs/FINANCIAL_TERMINOLOGY.md):
 *   Total Asset = life + portfolio + emergency, Net worth = Total Asset − debt,
 *   Investment Total = the Portfolio wallet only.
 * And the Investments gain is portfolio-wallet holdings only, with foreign-currency
 * gains converted to TWD before they are added to TWD ones.
 */
import { renderHook, waitFor } from '@testing-library/react';
import { useAuthContext } from '@/contexts/AuthContext';
import { useDemo } from '@/contexts/DemoContext';
import { dashboardService } from '@/services/dashboardService';
import { portfolioService } from '@/services/portfolioService';
import { useOptimizedDashboard } from '@/hooks/useOptimizedDashboard';
import { demoLoans } from '@/data/demoData';
import { createQueryWrapper } from '../utils/queryWrapper';

jest.mock('@/contexts/DemoContext', () => ({ useDemo: jest.fn() }));

jest.mock('@/services/dashboardService', () => ({
  dashboardService: {
    getDashboardStats: jest.fn(),
    getRecentActivity: jest.fn(),
    getHistoricalTrends: jest.fn(),
  },
}));

jest.mock('@/services/portfolioService', () => ({
  portfolioService: { getPortfolio: jest.fn() },
}));

const mockAuth = useAuthContext as jest.Mock;
const dash = dashboardService as jest.Mocked<typeof dashboardService>;
const portfolio = portfolioService as jest.Mocked<typeof portfolioService>;

const demoState = {
  getDemoStats: () => ({
    life_wallet: 40000, portfolio_wallet: 150000, emergency_wallet: 60000, total_asset: 250000,
    investment_total: 150000, monthlyIncome: 70000, monthlyExpenses: 30000, savingsRate: 57, portfolioChange: 4,
  }),
  demoTransactions: [{ id: 'd1' }, { id: 'd2' }],
  demoPortfolio: {
    totalValue: 150000, totalGainLoss: 15000, totalGainLossPercentage: 11.1,
    holdings: [{ symbol: '0050', name: 'Yuanta 50', totalValue: 150000, gainLoss: 15000, gainLossPercentage: 11.1 }],
  },
};

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
  (useDemo as jest.Mock).mockReturnValue(demoState);
}

// Native-currency holdings; the overview total is TWD. 1,000 + 500 TWD plus
// USD 100 at 32 = 4,700 → the derived rate is 32.
const holdings = [
  { symbol: '0050', name: 'Yuanta 50', totalValue: 1000, gainLoss: 100, gainLossPercentage: 11.1, currency: 'TWD', walletType: 'portfolio' },
  { symbol: 'VT', name: 'Vanguard', totalValue: 100, gainLoss: 10, gainLossPercentage: 11.1, currency: 'USD' },
  { symbol: '00878', name: 'Parked', totalValue: 500, gainLoss: 50, gainLossPercentage: 11.1, currency: 'TWD', walletType: 'emergency' },
];

function authenticatedReplies() {
  dash.getDashboardStats.mockResolvedValue({
    success: true,
    data: {
      life_wallet: 20000, portfolio_wallet: 4200, emergency_wallet: 30000, total_debt: 10000,
      total_income: 50000, total_expenses: 20000, savings_rate: 60, investment_return: 5,
      monthly_change: 1200, upcoming_bills: 3,
    },
  } as never);
  portfolio.getPortfolio.mockResolvedValue({
    success: true,
    data: { holdings, totalValue: '4700', totalGainLoss: '160', totalGainLossPercentage: '3.5' },
  } as never);
  dash.getRecentActivity.mockResolvedValue({
    success: true,
    data: [{ id: 'a1', type: 'goal_completed', title: 'Bike', description: 'Done', date: '2026-10-19' }, {}],
  } as never);
  dash.getHistoricalTrends.mockResolvedValue({
    success: true,
    data: { dataPoints: [{ date: '2026-10-01', income: 1, expenses: 2, balance: 3, netWorth: 4 }] },
  } as never);
}

async function load(range?: Parameters<typeof useOptimizedDashboard>[0]) {
  const { result } = renderHook(() => useOptimizedDashboard(range), { wrapper: createQueryWrapper() });
  await waitFor(() => expect(result.current.isSuccess || result.current.isError).toBe(true), { timeout: 3000 });
  return result.current;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('authenticated', () => {
  beforeEach(() => setMode(false));

  it('derives totals from the three wallets and nets out debt', async () => {
    authenticatedReplies();

    const { data } = await load('ytd');
    const stats = data!.data!.stats;

    expect(dash.getDashboardStats).toHaveBeenCalledWith('ytd');
    expect(dash.getHistoricalTrends).toHaveBeenCalledWith('ytd');
    expect(stats).toMatchObject({
      life_wallet: 20000, portfolio_wallet: 4200, emergency_wallet: 30000,
      total_asset: 54200, total_debt: 10000, investment_total: 4200,
      netWorth: 44200, totalAssets: 54200, portfolioValue: 4200,
      monthlyIncome: 50000, monthlyExpenses: 20000, savingsRate: 60, portfolioGrowth: 5,
      monthlyChange: 1200, upcomingBills: 3,
    });
  });

  it('converts foreign gains to TWD and leaves emergency holdings out of Investments', async () => {
    authenticatedReplies();

    const { data } = await load();
    const p = data!.data!.portfolio;

    // 100 TWD + 10 USD × 32 = 420; the emergency 00878 gain is not counted.
    expect(p.totalGainLoss).toBeCloseTo(420, 6);
    // Cost basis is the TWD wallet value minus that gain: 4,200 − 420.
    expect(p.gainLossPercentage).toBeCloseTo((420 / 3780) * 100, 6);
    expect(p.totalValue).toBe(4200);
    expect(p.holdings.map((h) => h.symbol)).toEqual(['0050', 'VT']);
  });

  it('maps activities and passes trend points through', async () => {
    authenticatedReplies();

    const { data } = await load();

    expect(data!.data!.activities[0]).toMatchObject({
      id: 'a1', type: 'goal_completed', title: 'Bike', description: 'Done', timestamp: new Date('2026-10-19'),
    });
    expect(data!.data!.activities[1]).toMatchObject({ type: 'achievement_unlocked', title: 'Activity', description: '' });
    expect(data!.data!.trendData).toHaveLength(1);
    expect(data!.data!.walletTrendData).toEqual([]);
  });

  it('still renders the wallets when the portfolio, activity and trend calls fail', async () => {
    authenticatedReplies();
    portfolio.getPortfolio.mockRejectedValue(new Error('down'));
    dash.getRecentActivity.mockRejectedValue(new Error('down'));
    dash.getHistoricalTrends.mockRejectedValue(new Error('down'));

    const { data } = await load();

    expect(data!.data!.stats.total_asset).toBe(54200);
    expect(data!.data!.portfolio).toMatchObject({ totalGainLoss: 0, gainLossPercentage: 0, holdings: [] });
    expect(data!.data!.activities).toEqual([]);
    expect(data!.data!.trendData).toEqual([]);
  });

  it('treats non-finite stats as zero rather than printing NaN', async () => {
    authenticatedReplies();
    dash.getDashboardStats.mockResolvedValue({
      success: true, data: { life_wallet: Number.NaN, portfolio_wallet: Infinity, emergency_wallet: 5 },
    } as never);

    const { data } = await load();

    expect(data!.data!.stats).toMatchObject({ life_wallet: 0, portfolio_wallet: 0, total_asset: 5, netWorth: 5 });
  });

  it('fails the query when the stats response is unusable', async () => {
    authenticatedReplies();
    dash.getDashboardStats.mockResolvedValue({ success: false } as never);

    const result = await load();

    expect(result.isError).toBe(true);
    expect((result.error as Error).message).toBe('Invalid dashboard stats response structure');
  });
});

describe('demo', () => {
  beforeEach(() => setMode(true));

  it('subtracts the same active demo loans the loans page shows', async () => {
    const { data } = await load();
    const stats = data!.data!.stats;
    const expectedDebt = demoLoans
      .filter((l) => l.status === 'active')
      .reduce((sum, l) => sum + Number(l.current_balance || 0), 0);

    expect(expectedDebt).toBeGreaterThan(0);
    expect(stats.total_debt).toBe(expectedDebt);
    expect(stats.netWorth).toBe(250000 - expectedDebt);
    expect(stats.totalAssets).toBe(250000);
    expect(data!.data!.portfolio.holdings[0]).toMatchObject({ symbol: '0050', value: 150000 });
    expect(dash.getDashboardStats).not.toHaveBeenCalled();
  });
});
