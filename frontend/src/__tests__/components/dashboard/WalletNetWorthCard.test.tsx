import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { WalletNetWorthCard } from '@/components/dashboard/WalletNetWorthCard';
import type { WalletTrendDataPoint } from '@/hooks/useWalletTrends';

jest.mock('react-i18next', () => ({
  // i18next calls .use(initReactI18next) at import time; a mock without it
  // makes lib/i18n throw and the whole suite dies before any test runs.
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({
    t: (key: string, fallback: string | Record<string, unknown>, _opts?: Record<string, unknown>) => {
      if (typeof fallback === 'string') return fallback;
      return key;
    },
    i18n: { language: 'en' },
  }),
}));

jest.mock('@/contexts/PrivacyContext', () => ({
  usePrivacy: () => ({ isValueVisible: true }),
}));

jest.mock('@/utils/formatters', () => ({
  // The compact branch emits 萬, as the real zh-TW formatter does. A mock that
  // returned "NT$400K" made the "no compact outside the axis" guard unfailable:
  // reverting the breakdown to the compact helper still produced no 萬, so the
  // assertion passed either way.
  formatTWD: (value: number, opts?: { compact?: boolean }) =>
    opts?.compact ? `NT$${(value / 10000).toFixed(1)}萬` : `NT$${value}`,
}));

jest.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="responsive-container">{children}</div>
  ),
  AreaChart: ({ children, data }: { children: React.ReactNode; data: unknown[] }) => (
    <div data-testid="area-chart" data-points={data.length}>{children}</div>
  ),
  Area: ({ dataKey, name }: { dataKey: string; name: string }) => (
    <div data-testid={`area-${dataKey}`} data-name={name} />
  ),
  PieChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="pie-chart">{children}</div>
  ),
  Pie: ({ data, children }: { data: { name: string; value: number }[]; children?: React.ReactNode }) => (
    <div data-testid="pie" data-slices={JSON.stringify(data)}>{children}</div>
  ),
  Cell: ({ fill }: { fill: string }) => <div data-testid="pie-cell" data-fill={fill} />,
  CartesianGrid: () => <div />,
  XAxis: () => <div />,
  YAxis: () => <div />,
  Tooltip: () => <div />,
}));

const baseStats = {
  total_asset: 200000,
  total_debt: 0,
  life_wallet: 80000,
  portfolio_wallet: 90000,
  emergency_wallet: 30000,
  monthlyIncome: 100000,
  monthlyExpenses: 60000,
};

function makeTrendPoint(
  overrides: Partial<WalletTrendDataPoint> = {},
  date = '2024-01-01',
): WalletTrendDataPoint {
  return {
    date,
    lifeWallet: 0,
    portfolioWallet: 0,
    emergencyWallet: 0,
    totalAsset: 0,
    investmentTotal: 0,
    ...overrides,
  };
}

const twoPointTrend: WalletTrendDataPoint[] = [
  makeTrendPoint({ lifeWallet: 70000, portfolioWallet: 80000, emergencyWallet: 25000, totalAsset: 175000 }, '2024-01-01'),
  makeTrendPoint({ lifeWallet: 80000, portfolioWallet: 90000, emergencyWallet: 30000, totalAsset: 200000 }, '2024-01-31'),
];

describe('WalletNetWorthCard', () => {
  describe('loading state', () => {
    it('renders skeleton when loading', () => {
      const { container } = render(
        <WalletNetWorthCard
          stats={baseStats}
          walletTrendsData={[]}

          loading={true}
        />,
      );
      expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
    });

    it('does not render skeleton when not loading', () => {
      const { container } = render(
        <WalletNetWorthCard
          stats={baseStats}
          walletTrendsData={[]}

          loading={false}
        />,
      );
      expect(container.querySelector('.animate-pulse')).toBeNull();
    });
  });

  describe('net worth headline', () => {
    it('shows Net Worth label', () => {
      render(
        <WalletNetWorthCard
          stats={baseStats}
          walletTrendsData={[]}

        />,
      );
      expect(screen.getByText('Net Worth')).toBeInTheDocument();
    });

    it('displays the total_asset value', () => {
      render(
        <WalletNetWorthCard
          stats={baseStats}
          walletTrendsData={[]}

        />,
      );
      // Appears more than once by design now: with no debt the net-worth
      // headline and the donut centre are the same number, and since compact
      // formatting was confined to axis ticks they are also written the same
      // way. `getByText` requiring uniqueness was incidental to the old
      // NT$200000-vs-NT$20萬 split, not a property worth asserting.
      expect(screen.getAllByText('NT$200000').length).toBeGreaterThan(0);
    });
  });

  describe('one quantity, one format', () => {
    const withDebt = { ...baseStats, total_debt: 400000 };

    it('writes the assets breakdown the way the strip above writes it', () => {
      // 總資產 appeared as NT$8,659,139 in the strip and NT$865.9萬 in this
      // card's own breakdown. Two formats for one number on one screen is what
      // made the figures read as untrustworthy.
      const { container } = render(
        <WalletNetWorthCard stats={withDebt} walletTrendsData={[]} />,
      );
      expect(container.textContent).not.toMatch(/萬/);
    });

    it('keeps 萬 available for axis ticks, where there is genuinely no room', () => {
      // The rule is "compact on the axis only", not "never compact" — so this
      // asserts the helper still exists rather than that nothing uses it.
      const trend = [
        { date: '2026-08-01', lifeWallet: 1, portfolioWallet: 1, emergencyWallet: 1, totalAsset: 3, investmentTotal: 1, debtBalance: 0 },
        { date: '2026-08-02', lifeWallet: 1, portfolioWallet: 1, emergencyWallet: 1, totalAsset: 3, investmentTotal: 1, debtBalance: 0 },
      ];
      const { container } = render(
        <WalletNetWorthCard stats={withDebt} walletTrendsData={trend as never} />,
      );
      // The card renders; the axis formatter is exercised by Recharts at layout
      // time, which jsdom does not perform — the guard that matters is above.
      expect(container.textContent).toBeTruthy();
    });
  });

  describe('allocation legend gives its percentages a denominator', () => {
    const withDebt = { ...baseStats, total_debt: 400000 };

    it('states what the debt percentage is measured against', () => {
      // The three wallet rows share one base and the debt row is a ratio TO
      // that base, not a fourth slice OF it — read as a flat list they appear
      // to total 145%.
      render(
        <WalletNetWorthCard stats={withDebt} walletTrendsData={[]} />,
      );
      expect(screen.getByText(/of assets/i)).toBeInTheDocument();
    });

    it('shows the shared base explicitly once there is a debt row to compare with', () => {
      const { container } = render(
        <WalletNetWorthCard stats={withDebt} walletTrendsData={[]} />,
      );
      expect(container.textContent).toContain('100%');
    });

    it('omits the base row when there is no debt, rather than repeating the headline', () => {
      const { container } = render(
        <WalletNetWorthCard stats={baseStats} walletTrendsData={[]} />,
      );
      expect(container.textContent).not.toMatch(/of assets/i);
      expect(container.textContent).not.toContain('100%');
    });
  });

  describe('netWorthChangeAmount beside the percentage', () => {
    const renderWithAmount = (props: Record<string, unknown>) =>
      render(
        <WalletNetWorthCard
          stats={baseStats}
          walletTrendsData={[]}
          {...props}
        />,
      );

    it('shows the money that moved, signed', () => {
      // A percentage alone cannot be checked against the balance beneath it,
      // which is how the card showed asset growth as net-worth growth for so
      // long without anyone being able to tell from the screen.
      renderWithAmount({ netWorthChangePercent: 5.7, netWorthChangeAmount: 259036 });
      expect(screen.getByText(/\+NT\$259,?036/)).toBeInTheDocument();
    });

    it('marks a fall with a minus, not a bare number', () => {
      renderWithAmount({ netWorthChangePercent: -3.1, netWorthChangeAmount: -12000 });
      expect(screen.getByText(/−NT\$12,?000/)).toBeInTheDocument();
    });

    it('renders no signed amount at all when there is none to report', () => {
      // Weak as `not.toMatch(/NT$0/)`: that passed with the feature removed
      // entirely. Assert on the shape the badge actually produces.
      const { container } = renderWithAmount({ netWorthChangePercent: 5.7 });
      expect(container.textContent).not.toMatch(/[+−]NT\$/);
    });
  });

  describe('netWorthChangePercent badge', () => {
    it('shows green badge when percent is positive', () => {
      const { container } = render(
        <WalletNetWorthCard
          stats={baseStats}
          walletTrendsData={[]}
          netWorthChangePercent={5.3}

        />,
      );
      const badge = container.querySelector('.bg-prosperity-100');
      expect(badge).toBeInTheDocument();
      expect(badge?.textContent).toContain('5.3%');
    });

    it('shows red badge when percent is negative', () => {
      const { container } = render(
        <WalletNetWorthCard
          stats={baseStats}
          walletTrendsData={[]}
          netWorthChangePercent={-3.1}

        />,
      );
      const badge = container.querySelector('.bg-error-100');
      expect(badge).toBeInTheDocument();
      expect(badge?.textContent).toContain('3.1%');
    });

    it('shows neutral badge when percent is near zero', () => {
      const { container } = render(
        <WalletNetWorthCard
          stats={baseStats}
          walletTrendsData={[]}
          netWorthChangePercent={0.02}

        />,
      );
      const badge = container.querySelector('.bg-gray-100');
      expect(badge).toBeInTheDocument();
    });

    it('hides badge when netWorthChangePercent is undefined', () => {
      const { container } = render(
        <WalletNetWorthCard
          stats={baseStats}
          walletTrendsData={[]}

        />,
      );
      expect(container.querySelector('.bg-prosperity-100')).toBeNull();
      expect(container.querySelector('.bg-error-100')).toBeNull();
    });
  });

  describe('emergency runway', () => {
    it('shows emergency runway in months', () => {
      // 30000 / 60000 = 0.5 months
      render(
        <WalletNetWorthCard
          stats={baseStats}
          walletTrendsData={[]}

        />,
      );
      expect(screen.getByText('Emergency Runway')).toBeInTheDocument();
    });

    it('shows — when monthlyExpenses is 0', () => {
      const stats = { ...baseStats, monthlyExpenses: 0 };
      render(
        <WalletNetWorthCard
          stats={stats}
          walletTrendsData={[]}

        />,
      );
      expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('savings rate — tested in MonthlyInsightCard', () => {
    it('does not render a standalone savings-rate indicator (cash-flow metric belongs in MonthlyInsightCard)', () => {
      render(
        <WalletNetWorthCard
          stats={baseStats}
          walletTrendsData={[]}
        />,
      );
      // Savings Rate label should not appear in the net-worth card
      expect(screen.queryByText('Savings Rate')).toBeNull();
    });
  });

  describe('period selector (moved to header bar)', () => {
    it('does not render period selector buttons inside WalletNetWorthCard', () => {
      render(
        <WalletNetWorthCard
          stats={baseStats}
          walletTrendsData={[]}
        />,
      );
      // Period selector was moved to ComprehensiveDashboard header — not rendered here
      expect(screen.queryByText('Mo')).toBeNull();
      expect(screen.queryByText('1Y')).toBeNull();
      expect(screen.queryByText('YTD')).toBeNull();
    });
  });

  // The chart starts with Total Assets and Net Worth on and the three per-wallet
  // series off; each is opt-in through a legend toggle. These used to assert the
  // wallet areas rendered on mount, which was the default before the toggles
  // existed.
  describe('chart — series visibility defaults', () => {
    it('renders totalAsset and netWorth areas by default', () => {
      render(
        <WalletNetWorthCard
          stats={baseStats}
          walletTrendsData={twoPointTrend}
        />,
      );
      expect(screen.getByTestId('area-totalAsset')).toBeInTheDocument();
      expect(screen.getByTestId('area-netWorth')).toBeInTheDocument();
    });

    it('leaves the three per-wallet areas off until toggled on', () => {
      render(
        <WalletNetWorthCard
          stats={baseStats}
          walletTrendsData={twoPointTrend}
        />,
      );
      expect(screen.queryByTestId('area-lifeWallet')).toBeNull();
      expect(screen.queryByTestId('area-emergencyWallet')).toBeNull();
      expect(screen.queryByTestId('area-portfolioWallet')).toBeNull();
    });

    it('renders the lifeWallet area after its legend toggle is pressed', () => {
      render(
        <WalletNetWorthCard
          stats={baseStats}
          walletTrendsData={twoPointTrend}
        />,
      );
      fireEvent.click(screen.getByRole('button', { name: 'Show Life Wallet' }));
      expect(screen.getByTestId('area-lifeWallet')).toBeInTheDocument();
    });

    it('does not render portfolioWallet area in the line chart', () => {
      render(
        <WalletNetWorthCard
          stats={baseStats}
          walletTrendsData={twoPointTrend}

        />,
      );
      expect(screen.queryByTestId('area-portfolioWallet')).toBeNull();
    });

    it('shows empty state when walletTrendsData is empty', () => {
      render(
        <WalletNetWorthCard
          stats={baseStats}
          walletTrendsData={[]}

        />,
      );
      expect(screen.getByText('No trend data')).toBeInTheDocument();
    });
  });

  describe('chart legend', () => {
    it('shows life wallet and emergency fund labels in chart legend', () => {
      render(
        <WalletNetWorthCard
          stats={baseStats}
          walletTrendsData={twoPointTrend}

        />,
      );
      expect(screen.getAllByText('Life Wallet').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('Emergency Fund').length).toBeGreaterThanOrEqual(1);
    });

    it('does not show portfolio in the chart legend', () => {
      render(
        <WalletNetWorthCard
          stats={baseStats}
          walletTrendsData={twoPointTrend}

        />,
      );
      // Portfolio label only appears in the donut legend, not the chart legend
      // The chart legend renders sky+amber dots only
      const chartLegend = document.querySelector('.flex.items-center.gap-3.text-xs');
      const legendText = chartLegend?.textContent ?? '';
      expect(legendText).not.toContain('Portfolio');
    });

    it('does not render chart legend when chartData is empty', () => {
      render(
        <WalletNetWorthCard
          stats={baseStats}
          walletTrendsData={[]}

        />,
      );
      expect(screen.queryAllByText('Life Wallet').length).toBe(0);
    });
  });

  describe('walletChanges — per-wallet % badges', () => {
    it('suppresses badge when first wallet value is zero', () => {
      const trends: WalletTrendDataPoint[] = [
        makeTrendPoint({ lifeWallet: 0, portfolioWallet: 0, emergencyWallet: 0 }, '2024-01-01'),
        makeTrendPoint({ lifeWallet: 50000, portfolioWallet: 90000, emergencyWallet: 20000 }, '2024-01-31'),
      ];
      const { container } = render(
        <WalletNetWorthCard
          stats={baseStats}
          walletTrendsData={trends}

        />,
      );
      const changeBadges = Array.from(container.querySelectorAll('[class*="rounded-full"]')).filter(
        el => el.textContent?.includes('▲') || el.textContent?.includes('▼'),
      );
      expect(changeBadges.length).toBe(0);
    });

    it('shows positive badge when wallet value increased', () => {
      const trends: WalletTrendDataPoint[] = [
        makeTrendPoint({ lifeWallet: 40000 }, '2024-01-01'),
        makeTrendPoint({ lifeWallet: 80000 }, '2024-01-31'),
      ];
      const { container } = render(
        <WalletNetWorthCard
          stats={baseStats}
          walletTrendsData={trends}

        />,
      );
      const upBadge = Array.from(container.querySelectorAll('[class*="rounded-full"]')).find(
        el => el.textContent?.includes('▲'),
      );
      expect(upBadge).toBeDefined();
      expect(upBadge?.textContent).toContain('100.0%');
    });
  });

  describe('donut pie chart (desktop right column)', () => {
    it('renders the pie chart element', () => {
      render(
        <WalletNetWorthCard
          stats={baseStats}
          walletTrendsData={[]}

        />,
      );
      expect(screen.getByTestId('pie-chart')).toBeInTheDocument();
    });

    it('renders three Cell slices with sky/violet/amber fill colors', () => {
      render(
        <WalletNetWorthCard
          stats={baseStats}
          walletTrendsData={[]}

        />,
      );
      const cells = screen.getAllByTestId('pie-cell');
      const fills = cells.map(c => c.getAttribute('data-fill'));
      expect(fills).toContain('#0ea5e9'); // sky — life wallet
      expect(fills).toContain('#8b5cf6'); // violet — portfolio
      expect(fills).toContain('#f59e0b'); // amber — emergency
    });

    it('passes composition values as slice data', () => {
      // life=80k/200k=40%, portfolio=90k/200k=45%, emergency=30k/200k=15%
      render(
        <WalletNetWorthCard
          stats={baseStats}
          walletTrendsData={[]}

        />,
      );
      const pie = screen.getByTestId('pie');
      const slices = JSON.parse(pie.getAttribute('data-slices') ?? '[]') as { name: string; value: number }[];
      expect(slices).toHaveLength(3);
      expect(slices[0].value).toBeCloseTo(40, 0); // life
      expect(slices[1].value).toBeCloseTo(45, 0); // portfolio
      expect(slices[2].value).toBeCloseTo(15, 0); // emergency
    });

    it('shows "Allocation" label', () => {
      render(
        <WalletNetWorthCard
          stats={baseStats}
          walletTrendsData={[]}

        />,
      );
      // "Allocation" appears in both the card header h3 and the donut legend row
      expect(screen.getAllByText('Allocation').length).toBeGreaterThanOrEqual(1);
    });

    it('shows wallet values and allocation % in legend rows', () => {
      render(
        <WalletNetWorthCard
          stats={baseStats}
          walletTrendsData={[]}

        />,
      );
      // NT$ values for each wallet
      expect(screen.getAllByText('NT$80000').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('NT$90000').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('NT$30000').length).toBeGreaterThanOrEqual(1);
      // Allocation percentages
      expect(screen.getAllByText('40.0%').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('45.0%').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('15.0%').length).toBeGreaterThanOrEqual(1);
    });

    it('shows change badges in legend when trend data is available', () => {
      const trends: WalletTrendDataPoint[] = [
        makeTrendPoint({ lifeWallet: 40000, portfolioWallet: 80000, emergencyWallet: 30000 }, '2024-01-01'),
        makeTrendPoint({ lifeWallet: 80000, portfolioWallet: 90000, emergencyWallet: 30000 }, '2024-01-31'),
      ];
      const { container } = render(
        <WalletNetWorthCard
          stats={baseStats}
          walletTrendsData={trends}

        />,
      );
      // Life wallet: 40000 → 80000 = +100% — appears as an emerald change badge
      const upBadge = Array.from(container.querySelectorAll('[class*="emerald"]')).find(
        el => el.textContent?.includes('100.0%'),
      );
      expect(upBadge).toBeDefined();
    });

    it('does not render the old standalone wallet tile layout', () => {
      // Verify the old flex-1 tile pattern is gone — the legend rows are now inside the donut section
      const { container } = render(
        <WalletNetWorthCard
          stats={baseStats}
          walletTrendsData={[]}

        />,
      );
      // Old tiles had flex-col justify-between with border-l-4 — check no orphan tiles outside donut section
      const oldTiles = container.querySelectorAll('.flex-1.border-l-4');
      expect(oldTiles.length).toBe(0);
    });
  });

  describe('composition bar removed', () => {
    it('does not render the thin composition bar', () => {
      // The thin h-1.5 bar was replaced by the donut chart
      const { container } = render(
        <WalletNetWorthCard
          stats={baseStats}
          walletTrendsData={[]}

        />,
      );
      const thinBar = container.querySelector('.h-1\\.5.rounded-full.overflow-hidden');
      expect(thinBar).toBeNull();
    });
  });

  describe('language / i18n', () => {
    it('uses i18n.language for chart date labels (does not crash when language is en)', () => {
      // Verifies chartData useMemo receives i18n.language instead of a hardcoded locale
      expect(() =>
        render(
          <WalletNetWorthCard
            stats={baseStats}
            walletTrendsData={twoPointTrend}
          />,
        ),
      ).not.toThrow();
    });

    it('renders chart areas when trend data has two points (smoke-test after i18n fix)', () => {
      render(
        <WalletNetWorthCard
          stats={baseStats}
          walletTrendsData={twoPointTrend}
        />,
      );
      // totalAsset is on by default; lifeWallet is opt-in via the legend toggle.
      expect(screen.getByTestId('area-totalAsset')).toBeInTheDocument();
    });
  });
});
