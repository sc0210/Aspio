import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TransactionList } from '@/components/transactions/TransactionList';
import toast from 'react-hot-toast';
import type { Transaction } from '@/shared/types';

// --- mocks ---

const mockMutateAsync = jest.fn();
const mockDeleteMutation = {
  mutateAsync: mockMutateAsync,
  isPending: false,
};
const mockUpdateMutateAsync = jest.fn();
const mockUpdateMutation = {
  mutateAsync: mockUpdateMutateAsync,
  isPending: false,
};

// The factory replaces the WHOLE module, so every hook the component imports has
// to appear here — TransactionList also calls useUpdateTransaction, and a missing
// entry surfaces as "useUpdateTransaction is not a function" rather than anything
// pointing at this mock.
jest.mock('@/hooks/api-hooks', () => ({
  useDeleteTransaction: () => mockDeleteMutation,
  useUpdateTransaction: () => mockUpdateMutation,
  useSetDayOrder: () => ({ mutateAsync: jest.fn(), isPending: false }),
}));

jest.mock('react-hot-toast', () => {
  // The default export is callable — the component uses `toast(jsx, opts)` for the
  // undoable bulk-delete toast, not just toast.success/error. Mocking it as a plain
  // object fails inside the handler with "_reacthottoast.default is not a function".
  const t = Object.assign(jest.fn(() => 'toast-id'), {
    success: jest.fn(),
    error: jest.fn(),
    dismiss: jest.fn(),
    custom: jest.fn(),
  });
  return { __esModule: true, default: t, toast: t };
});

jest.mock('react-i18next', () => ({
  // i18next calls .use(initReactI18next) at import time; a mock without it
  // makes lib/i18n throw and the whole suite dies before any test runs.
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        'transactions:date.today': 'Today',
        'transactions:date.yesterday': 'Yesterday',
        'transactions:date.daysAgo': `${opts?.count} days ago`,
        'transactions:list.selectedCount': `${opts?.count} selected`,
        'transactions:list.export': 'Export',
        'transactions:list.delete': 'Delete',
        'transactions:list.deleting': 'Deleting...',
        'transactions:list.edit': 'Edit',
        'transactions:list.noResults': 'No transactions found',
        'transactions:list.adjustSearch': 'Try adjusting your search',
        'transactions:list.transactionCount': `${opts?.count}`,
        'transactions:list.confirmDeleteTitle': 'Delete transaction',
        'transactions:list.confirmDeleteCancel': 'Cancel',
        'transactions:list.confirmDeleteAction': 'Delete',
        'transactions:deleteConfirmation': 'Are you sure you want to delete this transaction?',
        'transactions:bulkDeleteConfirmation': `Delete ${opts?.count} transactions?`,
        'transactions:toast.deleted': 'Deleted',
        'transactions:toast.deleteFailed': 'Delete failed',
        'transactions:toast.bulkDeleted': `${opts?.count} deleted`,
      };
      return map[key] ?? key;
    },
  }),
}));

jest.mock('@/contexts/PrivacyContext', () => ({
  usePrivacy: () => ({ isValueVisible: true }),
}));

jest.mock('@/utils/formatters', () => ({
  toTWD: (amount: number) => amount,
  formatCurrency: (amount: number, currency = 'TWD') => `${currency}${amount}`,
  formatTWD: (amount: number) => `TWD${amount}`,
}));

jest.mock('@/utils/highlight', () => ({
  highlight: (text: string) => text,
}));

jest.mock('@/utils/logger', () => ({
  log: { error: jest.fn() },
}));

// headlessui Menu — render children directly so we can click items
jest.mock('@headlessui/react', () => {
  const MenuItem = ({ children }: { children: React.ReactNode | ((bag: { active: boolean }) => React.ReactNode) }) => {
    const rendered = typeof children === 'function' ? children({ active: false }) : children;
    return <>{rendered}</>;
  };
  const MenuItems = ({ children }: { children: React.ReactNode }) => <div>{children}</div>;
  const MenuButton = ({ children, ...props }: { children: React.ReactNode } & Record<string, unknown>) => <button {...(props as React.ButtonHTMLAttributes<HTMLButtonElement>)}>{children}</button>;
  const Menu = ({ children }: { children: React.ReactNode }) => <div>{children}</div>;
  Menu.Button = MenuButton;
  Menu.Items = MenuItems;
  Menu.Item = MenuItem;
  const Transition = ({ children }: { children: React.ReactNode }) => <>{children}</>;

  // Headless UI v2 exposes these as named exports (MenuButton/MenuItems/MenuItem)
  // rather than only as Menu.Button etc., and the component imports them that
  // way. Omitting them renders as "Element type is invalid ... got: undefined",
  // which points at the component rather than at this mock.
  const Dialog = ({ open, children }: { open?: boolean; children: React.ReactNode }) =>
    open === false ? null : <div role="dialog">{children}</div>;
  const DialogPanel = ({ children }: { children: React.ReactNode }) => <div>{children}</div>;
  const DialogTitle = ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>;

  return {
    Menu, MenuButton, MenuItems, MenuItem,
    Transition,
    Dialog, DialogPanel, DialogTitle,
    Fragment: React.Fragment,
  };
});

// --- helpers ---

function makeTransaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: 'tx1',
    userId: 'user1',
    type: 'expense',
    amount: 500,
    currency: 'TWD',
    category: 'Food & Dining',
    description: 'Test expense',
    date: new Date('2024-03-15T10:00:00Z'),
    paymentMethod: 'cash',
    tags: [],
    createdAt: new Date('2024-03-15T10:00:00Z'),
    updatedAt: new Date('2024-03-15T10:00:00Z'),
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockDeleteMutation.isPending = false;
});

describe('TransactionList', () => {
  describe('empty and loading states', () => {
    it('shows i18n no-results text when transaction list is empty', () => {
      render(<TransactionList transactions={[]} />);
      expect(screen.getByText('No transactions found')).toBeInTheDocument();
    });

    it('shows adjust-search hint in empty state', () => {
      render(<TransactionList transactions={[]} />);
      expect(screen.getByText('Try adjusting your search')).toBeInTheDocument();
    });

    it('shows loading skeleton when isLoading is true', () => {
      const { container } = render(<TransactionList transactions={[]} isLoading />);
      expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
    });
  });

  describe('delete confirmation modal (replaces window.confirm)', () => {
    it('does NOT call window.confirm when Delete is clicked', () => {
      const confirmSpy = jest.spyOn(window, 'confirm');
      render(<TransactionList transactions={[makeTransaction()]} />);

      // expand the date group first
      const header = screen.getByRole('button', { name: /Expand|Collapse/i });
      fireEvent.click(header);

      fireEvent.click(screen.getByText('Delete'));
      expect(confirmSpy).not.toHaveBeenCalled();
      confirmSpy.mockRestore();
    });

    it('shows confirmation modal when Delete is clicked', () => {
      render(<TransactionList transactions={[makeTransaction()]} />);

      const header = screen.getByRole('button', { name: /Expand|Collapse/i });
      fireEvent.click(header);

      fireEvent.click(screen.getByText('Delete'));
      expect(screen.getByText('Delete transaction')).toBeInTheDocument();
      expect(screen.getByText('Are you sure you want to delete this transaction?')).toBeInTheDocument();
    });

    it('closes the modal when Cancel is clicked', () => {
      render(<TransactionList transactions={[makeTransaction()]} />);

      const header = screen.getByRole('button', { name: /Expand|Collapse/i });
      fireEvent.click(header);

      fireEvent.click(screen.getByText('Delete'));
      expect(screen.getByText('Delete transaction')).toBeInTheDocument();

      fireEvent.click(screen.getByText('Cancel'));
      expect(screen.queryByText('Delete transaction')).toBeNull();
    });

    it('calls mutateAsync when the modal Delete button is confirmed', async () => {
      mockMutateAsync.mockResolvedValue({});
      render(<TransactionList transactions={[makeTransaction({ id: 'abc' })]} />);

      const header = screen.getByRole('button', { name: /Expand|Collapse/i });
      fireEvent.click(header);

      // Open the modal
      fireEvent.click(screen.getByText('Delete'));

      // The modal renders before grouped transactions in the DOM, so its confirm
      // button is the FIRST "Delete" found after the modal opens.
      const deleteButtons = screen.getAllByText('Delete');
      fireEvent.click(deleteButtons[0]);

      await waitFor(() => {
        expect(mockMutateAsync).toHaveBeenCalledWith('abc');
      });
    });

    it('closes the modal after confirmed deletion', async () => {
      mockMutateAsync.mockResolvedValue({});
      render(<TransactionList transactions={[makeTransaction()]} />);

      const header = screen.getByRole('button', { name: /Expand|Collapse/i });
      fireEvent.click(header);

      fireEvent.click(screen.getByText('Delete'));
      const deleteButtons = screen.getAllByText('Delete');
      fireEvent.click(deleteButtons[0]);

      await waitFor(() => {
        expect(screen.queryByText('Delete transaction')).toBeNull();
      });
    });
  });

  describe('bulk delete confirmation modal', () => {
    it('shows bulk delete modal with correct count when bulk Delete clicked', () => {
      // Both transactions on same date to get a single date group
      const txns = [
        makeTransaction({ id: '1', date: new Date('2024-03-15T10:00:00Z') }),
        makeTransaction({ id: '2', description: 'Second', date: new Date('2024-03-15T11:00:00Z') }),
      ];
      render(<TransactionList transactions={txns} />);

      const header = screen.getByRole('button', { name: /Expand|Collapse/i });
      fireEvent.click(header);

      // Select both transactions via checkboxes
      const checkboxes = screen.getAllByRole('checkbox');
      fireEvent.click(checkboxes[0]);
      fireEvent.click(checkboxes[1]);

      // The bulk actions bar now shows — click its Delete button
      // "Delete" appears in: bulk bar + both action menus; getByText would throw if multiple.
      // Use getAllByText and click the FIRST one (bulk bar renders before transactions in DOM).
      const deleteButtons = screen.getAllByText('Delete');
      fireEvent.click(deleteButtons[0]);

      // Bulk delete is no longer a confirmation modal — it fires an undoable toast
      // with a 5s grace window (handleBulkDelete). Assert the toast was raised with
      // the right count rather than looking for the removed "Delete N transactions?"
      // dialog.
      expect(toast).toHaveBeenCalledTimes(1);
      const [, opts] = (toast as unknown as jest.Mock).mock.calls[0];
      expect(opts).toEqual(expect.objectContaining({ duration: expect.any(Number) }));
      expect(mockMutateAsync).not.toHaveBeenCalled(); // nothing deleted yet
    });

    it('does NOT call mutateAsync until bulk confirm is clicked', () => {
      const txns = [makeTransaction({ id: '1', date: new Date('2024-03-15T10:00:00Z') })];
      render(<TransactionList transactions={txns} />);

      const header = screen.getByRole('button', { name: /Expand|Collapse/i });
      fireEvent.click(header);

      const checkboxes = screen.getAllByRole('checkbox');
      fireEvent.click(checkboxes[0]);

      // Open the bulk-delete modal by clicking Delete in the bulk bar
      const deleteButtons = screen.getAllByText('Delete');
      fireEvent.click(deleteButtons[0]);

      // Modal shown — but no deletion yet
      expect(mockMutateAsync).not.toHaveBeenCalled();
    });
  });

  describe('mobile checkboxes', () => {
    it('renders checkboxes without hidden sm:block — visible on all screen sizes', () => {
      const { container } = render(<TransactionList transactions={[makeTransaction()]} />);

      const header = screen.getByRole('button', { name: /Expand|Collapse/i });
      fireEvent.click(header);

      const checkboxes = container.querySelectorAll('input[type="checkbox"]');
      checkboxes.forEach(cb => {
        expect(cb).not.toHaveClass('hidden');
      });
    });
  });

  describe('i18n labels', () => {
    it('renders Edit label from t() not hardcoded Chinese', () => {
      render(<TransactionList transactions={[makeTransaction()]} />);

      const header = screen.getByRole('button', { name: /Expand|Collapse/i });
      fireEvent.click(header);

      expect(screen.getByText('Edit')).toBeInTheDocument();
      expect(screen.queryByText('編輯')).toBeNull();
    });

    it('renders Delete label from t() not hardcoded Chinese', () => {
      render(<TransactionList transactions={[makeTransaction()]} />);

      const header = screen.getByRole('button', { name: /Expand|Collapse/i });
      fireEvent.click(header);

      expect(screen.getByText('Delete')).toBeInTheDocument();
      expect(screen.queryByText('刪除')).toBeNull();
    });

    it('shows selected count from t() after selecting a transaction', () => {
      render(<TransactionList transactions={[makeTransaction()]} />);

      const header = screen.getByRole('button', { name: /Expand|Collapse/i });
      fireEvent.click(header);

      const checkboxes = screen.getAllByRole('checkbox');
      fireEvent.click(checkboxes[0]);

      expect(screen.getByText('1 selected')).toBeInTheDocument();
    });
  });

  describe('formatDate i18n', () => {
    it('shows "Today" label for transactions dated today', () => {
      const today = new Date().toISOString();
      render(<TransactionList transactions={[makeTransaction({ date: today })]} />);
      expect(screen.getByText(/Today/)).toBeInTheDocument();
    });

    it('shows "Yesterday" label for transactions dated yesterday', () => {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      render(<TransactionList transactions={[makeTransaction({ date: yesterday })]} />);
      expect(screen.getByText(/Yesterday/)).toBeInTheDocument();
    });

    it('shows "N days ago" label for transactions within the past week', () => {
      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
      render(<TransactionList transactions={[makeTransaction({ date: threeDaysAgo })]} />);
      expect(screen.getByText(/3 days ago/)).toBeInTheDocument();
    });

    it('shows absolute date for transactions older than 7 days', () => {
      // 2024-03-15 is well in the past — should show absolute date, no relative label
      render(<TransactionList transactions={[makeTransaction({ date: new Date('2024-03-15T10:00:00Z') })]} />);
      const header = screen.getByRole('button', { name: /Expand|Collapse/i });
      expect(header).toBeInTheDocument();
      // Should NOT show "Today", "Yesterday", or "days ago"
      expect(screen.queryByText(/Today/)).toBeNull();
      expect(screen.queryByText(/Yesterday/)).toBeNull();
      expect(screen.queryByText(/days ago/)).toBeNull();
    });

    it('does NOT render hardcoded Chinese relative labels (今天/昨天/天前)', () => {
      const today = new Date().toISOString();
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();

      render(
        <TransactionList
          transactions={[
            makeTransaction({ id: '1', date: today }),
            makeTransaction({ id: '2', date: yesterday, description: 'B' }),
            makeTransaction({ id: '3', date: twoDaysAgo, description: 'C' }),
          ]}
        />
      );

      expect(screen.queryByText(/今天/)).toBeNull();
      expect(screen.queryByText(/昨天/)).toBeNull();
      expect(screen.queryByText(/天前/)).toBeNull();
    });
  });

  describe('formatTWD / formatCurrency usage', () => {
    it('uses formatTWD for day total (not inline Intl.NumberFormat)', () => {
      const today = new Date().toISOString();
      render(<TransactionList transactions={[makeTransaction({ date: today, amount: 500, type: 'expense' })]} />);
      // dayTotal = -500 (expense); component: `${dayTotal>=0?'+':''}${formatTWD(dayTotal)}`
      // → '' + 'TWD-500' = 'TWD-500'
      // The old inline formatCurrency(en-SG) would have returned 'S$-500' or similar.
      expect(screen.getByText('TWD-500')).toBeInTheDocument();
    });

    it('uses formatCurrency for per-transaction amounts', () => {
      // Use a past date so the group does not auto-expand (we expand it manually)
      render(<TransactionList transactions={[makeTransaction({ date: new Date('2024-03-15T10:00:00Z'), amount: 250, currency: 'USD' })]} />);

      const header = screen.getByRole('button', { name: /Expand/i });
      fireEvent.click(header);

      // formatCurrency mock returns "${currency}${amount}" → component prepends "-" → "-USD250"
      expect(screen.getByText('-USD250')).toBeInTheDocument();
    });
  });
});
