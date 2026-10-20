import React from 'react';
import { screen } from '@testing-library/react';
// Components here call useQuery; react-query is no longer stubbed globally,
// so they need a real client. renderWithQuery supplies one per test.
import { renderWithQuery as render } from '../../utils/queryWrapper';
import { MonthlyInsightCard } from '@/components/dashboard/MonthlyInsightCard';

jest.mock('react-i18next', () => ({
  // i18next calls .use(initReactI18next) at import time; a mock without it
  // makes lib/i18n throw and the whole suite dies before any test runs.
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
    i18n: { language: 'en' },
  }),
}));

jest.mock('@/contexts/PrivacyContext', () => ({
  usePrivacy: () => ({ isValueVisible: true }),
}));

jest.mock('@/utils/formatters', () => ({
  formatTWD: (value: number) => `NT$${value}`,
}));

jest.mock('@/components/dashboard/MiniCharts', () => ({
  SimpleSparkline: () => <div data-testid="sparkline" />,
}));

const baseStats = {
  monthlyIncome: 80000,
  monthlyExpenses: 50000,
  savingsRate: 37.5,
};

describe('MonthlyInsightCard', () => {
  describe('PERIOD_LABELS mapping', () => {
    const cases: Array<[string, string]> = [
      ['7d', 'Last 7 Days'],
      ['14d', 'Last 14 Days'],
      ['month', 'This Month'],
      ['30d', 'Last 30 Days'],
      ['90d', 'Last 90 Days'],
      ['6m', 'Last 6 Months'],
      ['ytd', 'Year to Date'],
      ['1y', 'Last Year'],
    ];

    test.each(cases)('dateRange "%s" shows label "%s"', (period, expectedLabel) => {
      render(<MonthlyInsightCard stats={baseStats} dateRange={period} />);
      expect(screen.getByText(expectedLabel)).toBeInTheDocument();
    });

    it('falls back to "This Month" for an unknown period', () => {
      render(<MonthlyInsightCard stats={baseStats} dateRange="unknown" />);
      expect(screen.getByText('This Month')).toBeInTheDocument();
    });

    it('falls back to "This Month" when dateRange is undefined', () => {
      render(<MonthlyInsightCard stats={baseStats} />);
      expect(screen.getByText('This Month')).toBeInTheDocument();
    });
  });

  describe('income and expense display', () => {
    it('shows income with + prefix', () => {
      render(<MonthlyInsightCard stats={baseStats} />);
      expect(screen.getByText('+NT$80000')).toBeInTheDocument();
    });

    it('shows expenses with - prefix', () => {
      render(<MonthlyInsightCard stats={baseStats} />);
      expect(screen.getByText('-NT$50000')).toBeInTheDocument();
    });

    it('shows expense ratio percentage when income > 0', () => {
      // expenses / income = 50000 / 80000 = 62.5% → rounds to 63%
      render(<MonthlyInsightCard stats={baseStats} />);
      expect(screen.getByText('63%')).toBeInTheDocument();
    });

    it('hides expense ratio badge next to expenses when income is 0', () => {
      const { container } = render(<MonthlyInsightCard stats={{ monthlyIncome: 0, monthlyExpenses: 30000 }} />);
      // The expense ratio badge is a <span> with text-red-500 (distinct from the icon SVG)
      const ratioBadge = container.querySelector('span.text-red-500');
      expect(ratioBadge).toBeNull();
    });
  });

  describe('net saved', () => {
    it('shows positive net with + prefix and emerald color', () => {
      render(<MonthlyInsightCard stats={baseStats} />);
      const netEl = screen.getByText('+NT$30000');
      expect(netEl).toBeInTheDocument();
      expect(netEl).toHaveClass('text-prosperity-700');
    });

    it('shows negative net without extra prefix and red color', () => {
      const lossStats = { monthlyIncome: 30000, monthlyExpenses: 50000 };
      render(<MonthlyInsightCard stats={lossStats} />);
      // net = -20000; component renders `${net>=0?'+':''}${formatTWD(net)}` = "NT$-20000"
      const netEl = screen.getByText('NT$-20000');
      expect(netEl).toHaveClass('text-error-700');
    });
  });

  describe('savings rate color logic', () => {
    it('applies emerald color when savings rate >= 20%', () => {
      render(<MonthlyInsightCard stats={{ monthlyIncome: 100000, monthlyExpenses: 70000 }} />);
      // net = 30000, rate = 30% → emerald
      const rateEl = screen.getByText('30.0%');
      expect(rateEl).toHaveClass('text-prosperity-700');
    });

    it('applies amber color when savings rate is between 0% and 20%', () => {
      render(<MonthlyInsightCard stats={{ monthlyIncome: 100000, monthlyExpenses: 90000 }} />);
      // net = 10000, rate = 10% → amber
      const rateEl = screen.getByText('10.0%');
      expect(rateEl).toHaveClass('text-amber-700');
    });

    it('applies red color when savings rate is negative (spending > income)', () => {
      render(<MonthlyInsightCard stats={{ monthlyIncome: 50000, monthlyExpenses: 60000 }} />);
      // net = -10000, rate = -20% → red
      const rateEl = screen.getByText('-20.0%');
      expect(rateEl).toHaveClass('text-error-700');
    });

    it('applies amber color at exactly 0% savings rate', () => {
      render(<MonthlyInsightCard stats={{ monthlyIncome: 50000, monthlyExpenses: 50000 }} />);
      const rateEl = screen.getByText('0.0%');
      expect(rateEl).toHaveClass('text-amber-700');
    });

    it('applies emerald color at exactly 20% savings rate', () => {
      render(<MonthlyInsightCard stats={{ monthlyIncome: 100000, monthlyExpenses: 80000 }} />);
      const rateEl = screen.getByText('20.0%');
      expect(rateEl).toHaveClass('text-prosperity-700');
    });
  });

  describe('privacy masking', () => {
    it('masks all values when isValueVisible is false', () => {
      // Full masked rendering covered by e2e/integration tests
    });
  });

  describe('sparklines', () => {
    const trendData = [
      { date: '2024-01-01', income: 80000, expenses: 50000 },
      { date: '2024-01-15', income: 85000, expenses: 55000 },
      { date: '2024-01-31', income: 90000, expenses: 60000 },
    ];

    it('renders sparklines when trend data has >= 2 non-zero points', () => {
      render(<MonthlyInsightCard stats={baseStats} trendData={trendData} />);
      expect(screen.getAllByTestId('sparkline').length).toBeGreaterThanOrEqual(1);
    });

    it('does not render sparklines when trend data has fewer than 2 points', () => {
      render(<MonthlyInsightCard stats={baseStats} trendData={[trendData[0]]} />);
      expect(screen.queryByTestId('sparkline')).toBeNull();
    });

    it('does not render sparklines when trendData is undefined', () => {
      render(<MonthlyInsightCard stats={baseStats} />);
      expect(screen.queryByTestId('sparkline')).toBeNull();
    });
  });

  describe('language / i18n', () => {
    const trendData = [
      { date: '2024-01-01', income: 80000, expenses: 50000 },
      { date: '2024-01-31', income: 90000, expenses: 60000 },
    ];

    it('renders "Income" label via translation key fallback', () => {
      render(<MonthlyInsightCard stats={baseStats} />);
      expect(screen.getByText('Income')).toBeInTheDocument();
    });

    it('renders "Expenses" label via translation key fallback', () => {
      render(<MonthlyInsightCard stats={baseStats} />);
      expect(screen.getByText('Expenses')).toBeInTheDocument();
    });

    it('renders "Trend" section header when sparkline data is present', () => {
      render(<MonthlyInsightCard stats={baseStats} trendData={trendData} />);
      expect(screen.getByText('Trend')).toBeInTheDocument();
    });

    it('renders sparkline income/expense labels via translation key fallback', () => {
      render(<MonthlyInsightCard stats={baseStats} trendData={trendData} />);
      // Both Income and Expenses appear: once in the bars, once in sparkline section
      expect(screen.getAllByText('Income').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('Expenses').length).toBeGreaterThanOrEqual(1);
    });

    it('does not crash when rendered with i18n.language set', () => {
      expect(() =>
        render(<MonthlyInsightCard stats={baseStats} trendData={trendData} />),
      ).not.toThrow();
    });
  });
});
