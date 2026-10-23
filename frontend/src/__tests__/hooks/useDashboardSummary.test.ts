/**
 * useDashboardSummary: the numbers the compact and mobile dashboards share.
 * selectPrimaryGoal has its own suite; this covers the hook around it — the
 * month's net-worth change measured from the baseline, the expense share, the
 * portfolio figures, and the demo-only synthetic sparkline.
 */
import { renderHook } from '@testing-library/react';
import { useAppMode } from '@/hooks/useAppMode';
import { useOptimizedDashboard } from '@/hooks/useOptimizedDashboard';
import { useWalletTrendBaseline, useWalletTrends } from '@/hooks/useWalletTrends';
import { useGoals } from '@/hooks/useGoals';
import { useDashboardSummary } from '@/hooks/useDashboardSummary';

jest.mock('@/hooks/useAppMode', () => ({ useAppMode: jest.fn() }));
jest.mock('@/hooks/useOptimizedDashboard', () => ({ useOptimizedDashboard: jest.fn() }));
jest.mock('@/hooks/useWalletTrends', () => ({ useWalletTrends: jest.fn(), useWalletTrendBaseline: jest.fn() }));
jest.mock('@/hooks/useGoals', () => ({ useGoals: jest.fn() }));

const mode = useAppMode as jest.Mock;
const dashboard = useOptimizedDashboard as jest.Mock;
const trends = useWalletTrends as jest.Mock;
const baseline = useWalletTrendBaseline as jest.Mock;
const goals = useGoals as jest.Mock;

const point = (totalAsset: number, debtBalance = 0) => ({ totalAsset, debtBalance });

function arrange({
  isDemo = false,
  stats = { total_asset: 1_200_000, total_debt: 200_000, monthlyIncome: 80_000, monthlyExpenses: 20_000, portfolio_wallet: 500_000 },
  portfolio = { totalGainLoss: 50_000, gainLossPercentage: 11.1, totalValue: 550_000 } as Record<string, number> | null,
  series = [point(1_000_000, 100_000), point(1_100_000, 150_000), point(1_200_000, 200_000)],
  open = point(900_000, 50_000) as ReturnType<typeof point> | null,
  goalList = [] as unknown[],
} = {}) {
  mode.mockReturnValue({ isDemo });
  dashboard.mockReturnValue({ data: { data: { stats, portfolio: portfolio ?? undefined } }, isLoading: false });
  trends.mockReturnValue({ data: series });
  baseline.mockReturnValue({ data: open ?? undefined });
  goals.mockReturnValue({ data: goalList });
  return renderHook(() => useDashboardSummary()).result.current;
}

beforeEach(() => jest.clearAllMocks());

it('asks every source for the calendar month', () => {
  arrange();
  expect(dashboard).toHaveBeenCalledWith('month');
  expect(trends).toHaveBeenCalledWith('month');
  expect(baseline).toHaveBeenCalledWith('month');
});

it('measures the month from the baseline, not the first point in the window', () => {
  const s = arrange();
  expect(s.netWorth).toBe(1_000_000);
  // Baseline 850k → last point 1.0M.
  expect(s.changeAbs).toBe(150_000);
  expect(s.changePct).toBeCloseTo((150_000 / 850_000) * 100);
  expect(s.spark).not.toBeNull();
  expect(s.spark!.line.startsWith('M5.0,')).toBe(true);
});

it('falls back to the window alone without a baseline', () => {
  const s = arrange({ open: null });
  // 900k → 1.0M
  expect(s.changeAbs).toBe(100_000);
});

it('derives cash flow and portfolio figures', () => {
  const s = arrange();
  expect(s.net).toBe(60_000);
  expect(s.expenseShare).toBe(25);
  expect(s.pnl).toBe(50_000);
  expect(s.pnlPct).toBe(11.1);
  expect(s.portfolioValue).toBe(550_000);
});

it('caps the expense share, and treats spending without income as 100%', () => {
  expect(arrange({ stats: { total_asset: 0, total_debt: 0, monthlyIncome: 100, monthlyExpenses: 300, portfolio_wallet: 0 } }).expenseShare).toBe(100);
  expect(arrange({ stats: { total_asset: 0, total_debt: 0, monthlyIncome: 0, monthlyExpenses: 5, portfolio_wallet: 0 } }).expenseShare).toBe(100);
  expect(arrange({ stats: { total_asset: 0, total_debt: 0, monthlyIncome: 0, monthlyExpenses: 0, portfolio_wallet: 0 } }).expenseShare).toBe(0);
});

it('uses the portfolio wallet when the portfolio payload is missing', () => {
  expect(arrange({ portfolio: null }).portfolioValue).toBe(500_000);
});

it('never fakes a series for a real account', () => {
  const s = arrange({ series: [], open: null });
  expect(s.spark).toBeNull();
  expect(s.changeAbs).toBe(0);
  expect(s.changePct).toBe(0);
});

it('synthesises a rising series ending at net worth in demo mode', () => {
  const s = arrange({ isDemo: true, series: [], open: null });
  expect(s.spark).not.toBeNull();
  expect(s.changeAbs).toBeGreaterThan(0);
  expect(s.changeAbs).toBe(1_000_000 - Math.round(1_000_000 * 0.92));
});

it('features the largest goal', () => {
  const s = arrange({
    goalList: [
      { id: 'a', title: 'Car', targetAmount: '600000', currentAmount: '300000' },
      { id: 'b', title: 'House', targetAmount: '1000000', currentAmount: '250000' },
    ],
  });
  expect(s.primaryGoal?.id).toBe('b');
  expect(s.goalPct).toBe(25);
});

it('handles an empty dashboard payload', () => {
  mode.mockReturnValue({ isDemo: false });
  dashboard.mockReturnValue({ data: undefined, isLoading: true });
  trends.mockReturnValue({ data: undefined });
  baseline.mockReturnValue({ data: undefined });
  goals.mockReturnValue({ data: undefined });
  const s = renderHook(() => useDashboardSummary()).result.current;
  expect(s).toMatchObject({ netWorth: 0, income: 0, portfolioValue: 0, primaryGoal: null, isLoading: true });
});
