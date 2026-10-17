import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { TransactionList } from '@/components/transactions/TransactionList';
import { Transaction } from '@/shared/types';

// The default export must be callable — the component uses `toast(jsx, opts)` for
// the undoable bulk delete, not only toast.success/error.
jest.mock('react-hot-toast', () => {
  const t = Object.assign(jest.fn(() => 'toast-id'), {
    success: jest.fn(),
    error: jest.fn(),
    dismiss: jest.fn(),
    custom: jest.fn(),
  });
  return { __esModule: true, default: t, toast: t };
});

// TransactionList calls both of these; without them the hooks return undefined
// and the component dies on `.isPending`.
// Without this, t() renders raw keys ("list.selectedCount") and every assertion
// on label text misses. Mirrors the map used by the sibling suite in
// components/transactions/TransactionList.test.tsx.
jest.mock('react-i18next', () => ({
  // This suite uses the REAL formatters, which import lib/i18n.ts, which calls
  // i18n.use(initReactI18next) at module load. Omitting it from a whole-module
  // mock fails the suite before a single test runs: "You are passing an
  // undefined module! Please check the object you are passing to i18next.use()".
  initReactI18next: { type: '3rdParty', init: jest.fn() },
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        'transactions:list.selectedCount': `${opts?.count} transaction selected`,
        'transactions:list.export': 'Export',
        'transactions:list.delete': 'Delete',
        'transactions:list.noResults': 'No transactions found',
      };
      return map[key] ?? (typeof opts?.defaultValue === 'string' ? (opts.defaultValue as string) : key);
    },
  }),
}));

jest.mock('@/hooks/api-hooks', () => ({
  useDeleteTransaction: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useUpdateTransaction: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useSetDayOrder: () => ({ mutateAsync: jest.fn(), isPending: false }),
}));

const mockTransactions: Transaction[] = [
  {
    id: '1',
    userId: 'user1',
    type: 'expense',
    amount: 25.50,
    currency: 'TWD',
    category: 'Food & Dining',
    description: 'Lunch at cafe',
    date: new Date('2024-01-15T12:00:00Z'),
    paymentMethod: 'credit_card',
    tags: ['lunch', 'work'],
    createdAt: new Date('2024-01-15T12:00:00Z'),
    updatedAt: new Date('2024-01-15T12:00:00Z')
  },
  {
    id: '2',
    userId: 'user1',
    type: 'income',
    amount: 3000.00,
    currency: 'TWD',
    category: 'Salary',
    description: 'Monthly salary',
    date: new Date('2024-01-01T09:00:00Z'),
    paymentMethod: 'bank_transfer',
    tags: ['salary'],
    createdAt: new Date('2024-01-01T09:00:00Z'),
    updatedAt: new Date('2024-01-01T09:00:00Z')
  }
];

/**
 * Render and open the date groups.
 *
 * TransactionList groups rows under collapsible date headers, and the groups
 * start collapsed — so every by-text assertion below (descriptions, amounts,
 * tags, payment methods, icons) finds nothing until they are expanded. This
 * suite predates that grouping.
 */
function renderExpanded(ui: React.ReactElement) {
  const result = render(ui);
  screen
    .queryAllByRole('button', { name: /Expand|Collapse/i })
    .forEach((header) => fireEvent.click(header));
  return result;
}

describe('TransactionList Component', () => {
  it('renders list of transactions', () => {
    renderExpanded(<TransactionList transactions={mockTransactions} />);
    
    expect(screen.getByText('Lunch at cafe')).toBeInTheDocument();
    expect(screen.getByText('Monthly salary')).toBeInTheDocument();
  });

  it('displays transaction amounts correctly with TWD currency', () => {
    renderExpanded(<TransactionList transactions={mockTransactions} />);
    
    // Check formatted amounts with TWD currency (using getAllByText since amounts appear in both header and transaction row)
    expect(screen.getAllByText('-NT$26')).toHaveLength(2); // rounded by formatTWD; row + group header
    expect(screen.getAllByText('+NT$3,000')).toHaveLength(2);
  });

  it('displays transaction categories', () => {
    renderExpanded(<TransactionList transactions={mockTransactions} />);
    
    expect(screen.getByText('Food & Dining')).toBeInTheDocument();
    expect(screen.getByText('Salary')).toBeInTheDocument();
  });

  it('shows loading state', () => {
    render(<TransactionList transactions={[]} isLoading={true} />);
    
    // Check for loading skeleton elements
    expect(screen.getAllByText('', { selector: '.animate-pulse' })).toHaveLength(5);
  });

  it('shows empty state when no transactions', () => {
    render(<TransactionList transactions={[]} />);
    
    expect(screen.getByText(/no transactions found/i)).toBeInTheDocument();
  });

  it('displays transaction tags', () => {
    renderExpanded(<TransactionList transactions={mockTransactions} />);
    
    expect(screen.getByText('#lunch')).toBeInTheDocument();
    expect(screen.getByText('#work')).toBeInTheDocument();
    expect(screen.getByText('#salary')).toBeInTheDocument();
  });

  it('displays payment methods', () => {
    renderExpanded(<TransactionList transactions={mockTransactions} />);
    
    expect(screen.getByText('credit_card')).toBeInTheDocument();
    expect(screen.getByText('bank_transfer')).toBeInTheDocument();
  });

  it('groups transactions by date', () => {
    renderExpanded(<TransactionList transactions={mockTransactions} />);
    
    // Should show date headers (using more flexible pattern)
    // Headers follow the runtime's locale, so build the expected text the same way.
    const header = (d: Date) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    expect(screen.getByText(header(new Date(2024, 0, 15)))).toBeInTheDocument();
    expect(screen.getByText(header(new Date(2024, 0, 1)))).toBeInTheDocument();
  });

  it('allows selecting transactions', () => {
    renderExpanded(<TransactionList transactions={mockTransactions} />);
    
    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes).toHaveLength(2); // One for each transaction
    
    fireEvent.click(checkboxes[0]);
    
    // Should show bulk actions when transaction selected
    expect(screen.getByText(/1 transaction selected/)).toBeInTheDocument();
  });

  it('shows category icons', () => {
    renderExpanded(<TransactionList transactions={mockTransactions} />);
    
    // Food & Dining should show food icon
    expect(screen.getByText('🍽️')).toBeInTheDocument();
    // Salary should show money icon
    expect(screen.getByText('💼')).toBeInTheDocument();
  });
});