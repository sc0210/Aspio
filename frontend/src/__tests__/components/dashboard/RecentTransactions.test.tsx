import React from 'react';
import { render, screen } from '@testing-library/react';
import { RecentTransactions } from '@/components/dashboard/RecentTransactions';

// ─── Mock dependencies ───────────────────────────────────────────────────────

let mockLanguage = 'en';
let mockT = (key: string, fallback?: string, opts?: Record<string, unknown>): string => {
  const translations: Record<string, string> = {
    'common:time.today': 'Today',
    'common:time.yesterday': 'Yesterday',
    'common:time.daysAgo': `${opts?.count}d ago`,
    'dashboard:recentTransactions.viewAll': 'View all',
    'dashboard:recentTransactions.noTransactions': 'No transactions yet',
    'dashboard:recentTransactions.addFirst': 'Start tracking your finances',
    'dashboard:recentTransactions.addTransaction': 'Add Transaction',
  };
  return translations[key] ?? (typeof fallback === 'string' ? fallback : key);
};

jest.mock('react-i18next', () => ({
  // i18next calls .use(initReactI18next) at import time; a mock without it
  // makes lib/i18n throw and the whole suite dies before any test runs.
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({
    get t() { return mockT; },
    get i18n() { return { language: mockLanguage }; },
  }),
}));

const mockUseTransactions = jest.fn((..._args: unknown[]) => ({ transactions: mockTransactions, isLoading: false }));
jest.mock('@/hooks/useTransactions', () => ({
  useTransactions: (...args: unknown[]) => mockUseTransactions(...args),
}));

jest.mock('@/utils/formatters', () => ({
  formatCashAmount: (amount: number) => `$${amount}`,
}));

jest.mock('@/components/ui/LoadingSpinner', () => ({
  LoadingSpinner: () => <div data-testid="spinner" />,
}));

// ─── Fake transaction factory ─────────────────────────────────────────────────

let mockTransactions: ReturnType<typeof makeTransaction>[] = [];

function makeTransaction(overrides: {
  id?: string;
  date?: string;
  description?: string;
  category?: string;
  amount?: number;
  type?: 'income' | 'expense';
  currency?: string;
}) {
  return {
    id: overrides.id ?? '1',
    date: overrides.date ?? new Date().toISOString(),
    description: overrides.description ?? 'Test',
    category: overrides.category ?? 'Other',
    amount: overrides.amount ?? 1000,
    type: overrides.type ?? 'expense',
    currency: overrides.currency ?? 'TWD',
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('RecentTransactions', () => {
  beforeEach(() => {
    mockTransactions = [];
    mockLanguage = 'en';
    mockUseTransactions.mockClear();
  });

  describe('empty state', () => {
    it('shows no-transactions message when list is empty', () => {
      render(<RecentTransactions />);
      expect(screen.getByText('No transactions yet')).toBeInTheDocument();
    });
  });

  describe('date formatting — relative time via t()', () => {
    it('shows "Today" for a transaction dated today', () => {
      mockTransactions = [makeTransaction({ date: new Date().toISOString() })];
      render(<RecentTransactions />);
      expect(screen.getByText('Today')).toBeInTheDocument();
    });

    it('shows "Yesterday" for a transaction dated yesterday', () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      mockTransactions = [makeTransaction({ date: yesterday.toISOString() })];
      render(<RecentTransactions />);
      expect(screen.getByText('Yesterday')).toBeInTheDocument();
    });

    it('shows "Xd ago" for a transaction 3 days old', () => {
      const threeDaysAgo = new Date();
      threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
      mockTransactions = [makeTransaction({ date: threeDaysAgo.toISOString() })];
      render(<RecentTransactions />);
      expect(screen.getByText('3d ago')).toBeInTheDocument();
    });

    it('shows a locale-formatted date for transactions older than 7 days', () => {
      const old = new Date('2020-01-15');
      mockTransactions = [makeTransaction({ date: old.toISOString() })];
      render(<RecentTransactions />);
      // Should render something that includes the month+day (not "Today"/"Yesterday")
      const dateCells = screen.queryByText('Today');
      expect(dateCells).toBeNull();
    });
  });

  describe('language switch — relative time labels change', () => {
    it('uses translation key for "Today" (language-agnostic)', () => {
      // Simulate zh-TW returning different text
      mockLanguage = 'zh-TW';
      mockT = (key: string, fallback?: string) => {
        if (key === 'common:time.today') return '今天';
        return fallback ?? key;
      };
      mockTransactions = [makeTransaction({ date: new Date().toISOString() })];
      render(<RecentTransactions />);
      expect(screen.getByText('今天')).toBeInTheDocument();
    });

    it('uses translation key for "Yesterday" in zh-TW', () => {
      mockLanguage = 'zh-TW';
      mockT = (key: string, fallback?: string) => {
        if (key === 'common:time.yesterday') return '昨天';
        return fallback ?? key;
      };
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      mockTransactions = [makeTransaction({ date: yesterday.toISOString() })];
      render(<RecentTransactions />);
      expect(screen.getByText('昨天')).toBeInTheDocument();
    });
  });

  describe('transaction list rendering', () => {
    it('shows transaction description', () => {
      mockTransactions = [makeTransaction({ description: 'Coffee Shop' })];
      render(<RecentTransactions />);
      expect(screen.getByText('Coffee Shop')).toBeInTheDocument();
    });

    it('shows income with + prefix', () => {
      mockTransactions = [makeTransaction({ type: 'income', amount: 5000 })];
      render(<RecentTransactions />);
      expect(screen.getByText('+$5000')).toBeInTheDocument();
    });

    it('shows expense with - prefix', () => {
      mockTransactions = [makeTransaction({ type: 'expense', amount: 1200 })];
      render(<RecentTransactions />);
      expect(screen.getByText('-$1200')).toBeInTheDocument();
    });

    it('asks the query for only 5 transactions', () => {
      // The cap is applied by the query, not the component — there is no slice
      // in the render path. This used to feed the hook 8 rows and assert the
      // 6th was dropped, which asserted a trim that has never existed; all it
      // proved was that the mock returned whatever it was told to.
      mockTransactions = Array.from({ length: 8 }, (_, i) =>
        makeTransaction({ id: String(i), description: `Item ${i}` }),
      );
      render(<RecentTransactions />);

      expect(mockUseTransactions).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 5, sortBy: 'date', sortOrder: 'desc' }),
      );
    });

    it('renders every transaction the query returns', () => {
      mockTransactions = Array.from({ length: 3 }, (_, i) =>
        makeTransaction({ id: String(i), description: `Item ${i}` }),
      );
      render(<RecentTransactions />);

      ['Item 0', 'Item 1', 'Item 2'].forEach((description) => {
        expect(screen.getByText(description)).toBeInTheDocument();
      });
    });
  });

  describe('always the latest five', () => {
    it('sends no date range: the widget does not follow the period selector', () => {
      // Following it told an established user "No transactions yet" on a quiet 7D.
      render(<RecentTransactions />);
      const callArgs = mockUseTransactions.mock.calls[0]?.[0] as Record<string, unknown> | undefined;
      expect(callArgs?.dateRange).toBeUndefined();
    });

    it('shows at most five rows even when the source returns more (demo ignores limit)', () => {
      mockTransactions = Array.from({ length: 14 }, (_, i) =>
        makeTransaction({ id: String(i), description: `Item ${i}` }),
      );
      render(<RecentTransactions />);
      expect(screen.getByText('Item 4')).toBeInTheDocument();
      expect(screen.queryByText('Item 5')).toBeNull();
    });

    it('picks the latest five by date, whatever order the source returns', () => {
      const day = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
      mockTransactions = [
        makeTransaction({ id: 'old', description: 'Backdated', date: day(30) }),
        ...Array.from({ length: 5 }, (_, i) => makeTransaction({ id: String(i), description: `Recent ${i}`, date: day(i) })),
      ];
      render(<RecentTransactions />);
      expect(screen.queryByText('Backdated')).toBeNull();
      expect(screen.getByText('Recent 4')).toBeInTheDocument();
    });
  });
});
