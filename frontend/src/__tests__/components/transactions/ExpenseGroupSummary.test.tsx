import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import transactionsZh from '@/locales/zh-TW/transactions.json';
import commonZh from '@/locales/zh-TW/common.json';
import { ExpenseGroupSummary } from '@/components/transactions/ExpenseGroupSummary';
import type { TransactionFilters } from '@/hooks/transactions/useTransactionFilters';

// This component's category labels are hard-coded Traditional Chinese and the
// rest of its copy comes from the zh-TW bundle, which is also the app's default
// language. lib/i18n never initialises under Jest, so a key-echoing
// useTranslation renders "transactions:filters.noExpensesInRange" instead of
// the sentence a user actually sees. Init the real library synchronously.
i18n.use(initReactI18next).init({
  lng: 'zh-TW',
  fallbackLng: 'zh-TW',
  ns: ['transactions', 'common'],
  defaultNS: 'common',
  resources: { 'zh-TW': { transactions: transactionsZh, common: commonZh } },
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

jest.mock('@/contexts/PrivacyContext', () => ({
  usePrivacy: () => ({ isValueVisible: true }),
}));

jest.mock('@/utils/formatters', () => ({
  formatTWD: (value: number) => `NT$${value}`,
}));

// Stub UI primitives so we don't need their full render trees
jest.mock('@/components/ui/Button', () => ({
  Button: ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => <button onClick={onClick}>{children}</button>,
}));
jest.mock('@/components/ui/Input', () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));

// TransactionFilters requires startDate/endDate; omitting them made this a
// shape the component is never handed in production.
const defaultFilters: TransactionFilters = {
  type: 'all',
  category: 'all',
  walletType: 'all',
  dateRange: 'month',
  sortBy: 'date',
  sortOrder: 'desc',
  startDate: '',
  endDate: '',
};

const defaultProps = {
  filters: defaultFilters,
  onFiltersChange: jest.fn(),
  searchQuery: '',
  onSearchChange: jest.fn(),
  onExport: jest.fn(),
  totalTransactions: 10,
};

function makeBreakdown(category: string, amount: number) {
  return { category, amount, type: 'expense', color: '#ef4444' };
}

describe('ExpenseGroupSummary', () => {
  describe('Transportation group (new)', () => {
    it('renders Transportation row when transportation expenses exist', () => {
      const expenseBreakdown = [makeBreakdown('Transportation', 15000)];
      render(
        <ExpenseGroupSummary
          {...defaultProps}
          categoryBreakdown={[]}
          expenseCategoryBreakdown={expenseBreakdown}
        />
      );
      expect(screen.getByText(new RegExp('交通'))).toBeInTheDocument();
    });

    it('correctly buckets "Transportation" into Transportation group, not Others', () => {
      const expenseBreakdown = [
        makeBreakdown('Transportation', 20000),
        makeBreakdown('Other stuff', 10000),
      ];
      render(
        <ExpenseGroupSummary
          {...defaultProps}
          categoryBreakdown={[]}
          expenseCategoryBreakdown={expenseBreakdown}
        />
      );

      // Transportation row should show NT$20000
      expect(screen.getByText('NT$20000')).toBeInTheDocument();
      // Others should show NT$10000 (not NT$30000 if transportation were miscategorised)
      expect(screen.getByText('NT$10000')).toBeInTheDocument();
    });

    it('correctly buckets "交通" (Chinese) into Transportation group', () => {
      const expenseBreakdown = [makeBreakdown('交通', 8000)];
      render(
        <ExpenseGroupSummary
          {...defaultProps}
          categoryBreakdown={[]}
          expenseCategoryBreakdown={expenseBreakdown}
        />
      );
      // NT$8000 appears in both the category card and the total — both are correct
      expect(screen.getAllByText('NT$8000').length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Wallet transfers', () => {
    /** The legend row for a group, found by its icon — the type filter carries the
     *  same words, and the totals carry the same amounts. */
    const legendRow = (icon: string) =>
      screen.getByText(new RegExp(icon)).parentElement as HTMLElement;

    it('keeps a transfer out of Others, where it read as spending', () => {
      render(
        <ExpenseGroupSummary
          {...defaultProps}
          categoryBreakdown={[]}
          expenseCategoryBreakdown={[
            makeBreakdown('Transfer', 190000),
            makeBreakdown('Other stuff', 3000),
          ]}
        />
      );

      // Its own row, at its own amount — not 193,000 of "other" spending.
      expect(legendRow('🔁')).toHaveTextContent('轉帳');
      expect(legendRow('🔁')).toHaveTextContent('NT$190000');
      expect(legendRow('🎯')).toHaveTextContent('NT$3000');
    });

    it('recognises the spellings people and importers actually write', () => {
      render(
        <ExpenseGroupSummary
          {...defaultProps}
          categoryBreakdown={[]}
          expenseCategoryBreakdown={[
            makeBreakdown('Bank Transfer', 100000),
            makeBreakdown('轉帳支出', 90000),
          ]}
        />
      );
      expect(legendRow('🔁')).toHaveTextContent('NT$190000');
    });

    it('leaves a category that merely mentions a transfer in its own group', () => {
      // A transfer fee is real spending; only the move itself is not.
      render(
        <ExpenseGroupSummary
          {...defaultProps}
          categoryBreakdown={[]}
          expenseCategoryBreakdown={[makeBreakdown('轉帳手續費', 15)]}
        />
      );
      expect(legendRow('🎯')).toHaveTextContent('NT$15');
    });
  });

  describe('All 5 groups rendered', () => {
    it('renders labels for all 5 category groups', () => {
      render(
        <ExpenseGroupSummary
          {...defaultProps}
          categoryBreakdown={[]}
          expenseCategoryBreakdown={[
            makeBreakdown('Food & Dining', 10000),
            makeBreakdown('Transportation', 5000),
            makeBreakdown('Housing', 20000),
            makeBreakdown('Investment', 15000),
            makeBreakdown('Other stuff', 3000),
          ]}
        />
      );
      // Each legend row renders "{icon} {label}" inside one span, so the label
      // is never its own exact text node.
      ['飲食', '交通', '住房', '投資', '其他'].forEach((label) => {
        expect(screen.getByText(new RegExp(label))).toBeInTheDocument();
      });
    });
  });

  describe('Progress bar segments', () => {
    it('renders a segment for each non-zero group', () => {
      const { container } = render(
        <ExpenseGroupSummary
          {...defaultProps}
          categoryBreakdown={[]}
          expenseCategoryBreakdown={[
            makeBreakdown('Food & Dining', 50000),
            makeBreakdown('Transportation', 25000),
          ]}
        />
      );
      // Each segment is a div with inline backgroundColor style
      const segments = container.querySelectorAll('[style*="background-color"]');
      expect(segments.length).toBeGreaterThanOrEqual(2);
    });

    it('shows percentage label in segments wide enough (≥15%)', () => {
      // 80000/100000 = 80% (≥15 → label shown); 20000/100000 = 20% (≥15 → also shown)
      // Use a tiny 3rd category that falls below 15% to test the hidden case
      render(
        <ExpenseGroupSummary
          {...defaultProps}
          categoryBreakdown={[]}
          expenseCategoryBreakdown={[
            makeBreakdown('Food & Dining', 80000),   // 80% → label visible
            makeBreakdown('Transportation', 15000),  // 15% → label visible (boundary)
            makeBreakdown('Housing', 5000),          // 5% → label hidden
          ]}
        />
      );
      // 80% and 15% segments should show inline labels (total = 100000)
      expect(screen.getByText('80.0%')).toBeInTheDocument();
      expect(screen.getByText('15.0%')).toBeInTheDocument();
      // 5% segment should NOT show an inline label
      expect(screen.queryByText('5%')).toBeNull();
    });
  });

  describe('formatTWD replaces inline formatCurrency', () => {
    it('displays amount formatted by formatTWD mock (not en-SG locale)', () => {
      render(
        <ExpenseGroupSummary
          {...defaultProps}
          categoryBreakdown={[]}
          expenseCategoryBreakdown={[makeBreakdown('Food & Dining', 99999)]}
        />
      );
      // formatTWD mock returns "NT$99999"; old inline formatCurrency would have returned "S$99,999"
      // Value appears in both the category card and the total row
      expect(screen.getAllByText('NT$99999').length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('empty state', () => {
    it('shows empty message when there are no expense transactions', () => {
      render(
        <ExpenseGroupSummary
          {...defaultProps}
          categoryBreakdown={[]}
          expenseCategoryBreakdown={[]}
        />
      );
      // The component renders this message in both the chart slot and the
      // legend slot, so there is legitimately more than one node.
      expect(screen.getAllByText(/篩選範圍內無支出記錄/).length).toBeGreaterThan(0);
    });
  });

  describe('filter controls', () => {
    it('calls onFiltersChange when transaction type changes', () => {
      const onFiltersChange = jest.fn();
      render(
        <ExpenseGroupSummary
          {...defaultProps}
          onFiltersChange={onFiltersChange}
          categoryBreakdown={[]}
          expenseCategoryBreakdown={[]}
        />
      );
      const typeSelect = screen.getByDisplayValue('所有交易');
      fireEvent.change(typeSelect, { target: { value: 'expense' } });
      expect(onFiltersChange).toHaveBeenCalledWith(expect.objectContaining({ type: 'expense' }));
    });

    it('shows custom date inputs when dateRange is "custom"', () => {
      render(
        <ExpenseGroupSummary
          {...defaultProps}
          filters={{ ...defaultFilters, dateRange: 'custom' }}
          categoryBreakdown={[]}
          expenseCategoryBreakdown={[]}
        />
      );
      // Labels are present (labels use text, not htmlFor)
      expect(screen.getByText('開始日期')).toBeInTheDocument();
      expect(screen.getByText('結束日期')).toBeInTheDocument();
    });
  });
  // A failed page-stats request hands every panel an empty array, which is
  // indistinguishable from a filter that genuinely matched nothing. Blaming the
  // date range for a 500 is what made this bug hard to recognise.
  describe('failed load', () => {
    const emptyBreakdowns = { categoryBreakdown: [], expenseCategoryBreakdown: [] };

    it('says the panel failed instead of "no expenses in range"', () => {
      render(<ExpenseGroupSummary {...defaultProps} {...emptyBreakdowns} error />);

      expect(screen.queryByText('篩選範圍內無支出記錄')).toBeNull();
      expect(screen.queryByText('篩選範圍內無收入記錄')).toBeNull();
      expect(screen.getAllByText('無法載入此區塊').length).toBeGreaterThanOrEqual(3);
    });

    it('offers a retry on each failed panel', () => {
      const onRetry = jest.fn();
      render(<ExpenseGroupSummary {...defaultProps} {...emptyBreakdowns} error onRetry={onRetry} />);

      const retries = screen.getAllByText('重試');
      expect(retries.length).toBeGreaterThanOrEqual(3);
      fireEvent.click(retries[0]);
      expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('keeps the empty-range copy when the load succeeded', () => {
      render(<ExpenseGroupSummary {...defaultProps} {...emptyBreakdowns} />);

      expect(screen.getAllByText('篩選範圍內無支出記錄').length).toBeGreaterThanOrEqual(1);
      expect(screen.queryByText('無法載入此區塊')).toBeNull();
    });
  });
});
