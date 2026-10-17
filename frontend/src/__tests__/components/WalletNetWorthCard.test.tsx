import React from 'react';
import { render } from '@testing-library/react';
import { WalletNetWorthCard } from '@/components/dashboard/WalletNetWorthCard';

// ── Module mocks ─────────────────────────────────────────────────────────────

jest.mock('react-i18next', () => ({
  // i18next calls .use(initReactI18next) at import time; a mock without it
  // makes lib/i18n throw and the whole suite dies before any test runs.
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
    i18n: { language: 'en', changeLanguage: jest.fn() },
  }),
}));

jest.mock('@/contexts/PrivacyContext', () => ({
  usePrivacy: () => ({ isValueVisible: true }),
}));

jest.mock('@/utils/formatters', () => ({
  formatTWD: (v: number) => `TWD ${v}`,
}));

// Stub recharts to avoid SVG rendering issues in jsdom
jest.mock('recharts', () => {
  const Stub = ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="recharts-stub">{children}</div>
  );
  return {
    ResponsiveContainer: Stub,
    AreaChart: Stub,
    Area: () => null,
    XAxis: () => null,
    YAxis: () => null,
    CartesianGrid: () => null,
    Tooltip: () => null,
    PieChart: Stub,
    Pie: () => null,
    Cell: () => null,
  };
});

// ── Helpers ───────────────────────────────────────────────────────────────────

const defaultStats = {
  total_asset: 1_000_000,
  total_debt: 0,
  life_wallet: 400_000,
  portfolio_wallet: 400_000,
  emergency_wallet: 200_000,
  monthlyIncome: 50_000,
  monthlyExpenses: 20_000,
};

// `investmentTotal` is required by WalletTrendDataPoint and was missing here,
// so this fixture was a shape the component never actually receives. It is the
// Portfolio wallet's total, which for these points is the portfolio balance.
const trendData = [
  { date: '2026-04-01', totalAsset: 900_000, lifeWallet: 360_000, portfolioWallet: 360_000, emergencyWallet: 180_000, investmentTotal: 360_000, debtBalance: 0 },
  { date: '2026-05-01', totalAsset: 1_000_000, lifeWallet: 400_000, portfolioWallet: 400_000, emergencyWallet: 200_000, investmentTotal: 400_000, debtBalance: 0 },
];

function renderCard(overrides = {}) {
  return render(
    <WalletNetWorthCard
      stats={defaultStats}
      walletTrendsData={trendData}
      netWorthChangePercent={5.0}
      {...overrides}
    />
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('WalletNetWorthCard — mobile UX fixes', () => {
  describe('No text-[10px] class', () => {
    it('rendered output does not contain the text-[10px] class anywhere', () => {
      const { container } = renderCard();
      // Walk the entire rendered subtree looking for the banned class
      const allElements = container.querySelectorAll('*');
      const hasBannedClass = Array.from(allElements).some((el) =>
        el.className && el.className.toString().includes('text-[10px]')
      );
      expect(hasBannedClass).toBe(false);
    });
  });

  describe('No break-all class on value elements', () => {
    it('the net-worth value paragraph does not have break-all class', () => {
      const { container } = renderCard();
      // The main net worth value is in a <p> with aria-label starting with "Net worth:"
      const netWorthEl = container.querySelector('[aria-label^="Net worth"]');
      expect(netWorthEl).toBeInTheDocument();
      expect(netWorthEl!.className).not.toContain('break-all');
    });

    it('no element in the card has a break-all class', () => {
      const { container } = renderCard();
      const allElements = container.querySelectorAll('*');
      const hasBreakAll = Array.from(allElements).some((el) =>
        el.className && el.className.toString().includes('break-all')
      );
      expect(hasBreakAll).toBe(false);
    });
  });

  describe('Value elements use truncate instead', () => {
    it('the net-worth value paragraph has truncate class', () => {
      const { container } = renderCard();
      const netWorthEl = container.querySelector('[aria-label^="Net worth"]');
      expect(netWorthEl).toBeInTheDocument();
      expect(netWorthEl!.className).toContain('truncate');
    });
  });
});
