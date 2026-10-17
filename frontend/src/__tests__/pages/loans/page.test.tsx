import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import LoansPage from '@/app/loans/page';
import type { DebtAccount, DebtAccountSummary } from '@/services/loanService';
import { useLoans } from '@/hooks/useLoans';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockDeleteMutateAsync = jest.fn().mockResolvedValue({});

jest.mock('@/hooks/useLoans', () => ({
  useLoans: jest.fn(),
  useDeleteLoan: jest.fn(() => ({
    mutateAsync: mockDeleteMutateAsync,
    isPending: false,
  })),
}));

jest.mock('@/components/layout/DashboardLayout', () => ({
  DashboardLayout: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="layout">{children}</div>
  ),
}));

// Lightweight stand-ins so we can assert modals open/close
jest.mock('@/components/loans/LoanCard', () => ({
  LoanCard: ({ loan, onRecordPayment, onEdit, onDelete }: { loan: DebtAccount; onRecordPayment: (loan: DebtAccount) => void; onEdit: (loan: DebtAccount) => void; onDelete: (loan: DebtAccount) => void }) => (
    <div data-testid={`loan-card-${loan.id}`}>
      <span>{loan.name}</span>
      <button onClick={() => onRecordPayment(loan)}>RecordPayment</button>
      <button onClick={() => onEdit(loan)}>Edit</button>
      <button onClick={() => onDelete(loan)}>Delete</button>
    </div>
  ),
}));

jest.mock('@/components/loans/AddLoanModal', () => ({
  AddLoanModal: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="add-loan-modal">
      <button onClick={onClose}>CloseAddModal</button>
    </div>
  ),
}));

jest.mock('@/components/loans/EditLoanModal', () => ({
  EditLoanModal: ({ loan, onClose }: { loan: DebtAccount; onClose: () => void }) => (
    <div data-testid="edit-loan-modal">
      <span>Editing: {loan.name}</span>
      <button onClick={onClose}>CloseEditModal</button>
    </div>
  ),
}));

jest.mock('@/components/loans/RecordPaymentModal', () => ({
  RecordPaymentModal: ({ loan, onClose }: { loan: DebtAccount; onClose: () => void }) => (
    <div data-testid="record-payment-modal">
      <span>Payment for: {loan.name}</span>
      <button onClick={onClose}>ClosePaymentModal</button>
    </div>
  ),
}));

// The planner has its own suite; here it would only need a fuller i18n stub.
jest.mock('@/components/loans/PayoffPlanner', () => ({ PayoffPlanner: () => null }));
jest.mock('@/components/loans/UpcomingPayments', () => ({ UpcomingPayments: () => null }));

jest.mock('@/components/ui/LoadingSpinner', () => ({
  LoadingSpinner: () => <div data-testid="loading-spinner" />,
}));

jest.mock('react-i18next', () => ({
  // i18next calls .use(initReactI18next) at import time; a mock without it
  // makes lib/i18n throw and the whole suite dies before any test runs.
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        'title': 'Loans & Debt',
        'subtitle': 'Track your debt accounts and monthly repayments',
        'addLoan': 'Add Loan',
        'addFirstLoan': 'Add Your First Loan',
        'summary.totalDebt': 'Total Debt',
        'summary.activeLoans': 'Active Loans',
        'summary.nextPayment': 'Next Payment',
        'summary.on': `on ${opts?.date ?? ''}`,
        'emptyState.title': 'No loans recorded',
        'emptyState.description': 'Track mortgages, personal loans, and credit card debt',
        'deleteModal.title': 'Remove Loan?',
        'deleteModal.message': `Remove ${opts?.name ?? ''}`,
        'deleteModal.cancel': 'Cancel',
        'deleteModal.remove': 'Remove',
        'deleteModal.removing': 'Removing…',
      };
      if (key === 'sections.active') return `Active (${opts?.count ?? ''})`;
      if (key === 'sections.paidOff') return `Paid Off (${opts?.count ?? ''})`;
      if (key === 'summary.totalLoans') return `${opts?.count ?? ''} total loans`;
      if (key === 'deleteModal.message') return `Remove ${opts?.name ?? ''}`;
      return map[key] ?? key;
    },
  }),
}));

jest.mock('react-hot-toast', () => ({
  __esModule: true,
  default: { success: jest.fn(), error: jest.fn() },
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

const activeLoan: DebtAccount = {
  id: 'loan-1',
  user_id: 'user-1',
  name: 'Home Mortgage',
  lender_name: 'CTBC Bank',
  account_type: 'mortgage',
  principal_amount: 5_000_000,
  current_balance: 4_500_000,
  interest_rate: 2.5,
  minimum_payment: 30_000,
  payment_due_day: 15,
  start_date: '2024-01-01',
  term_months: 360,
  currency: 'TWD',
  status: 'active',
  notes: null,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
  progress_pct: 10,
  months_remaining: 280,
  payoff_months_estimate: 280,
  total_interest_remaining: 1_200_000,
  next_payment_date: '2026-06-15',
};

const paidOffLoan: DebtAccount = {
  ...activeLoan,
  id: 'loan-2',
  name: 'Car Loan',
  account_type: 'auto_loan',
  current_balance: 0,
  status: 'paid_off',
  progress_pct: 100,
  months_remaining: 0,
  payoff_months_estimate: 0,
  total_interest_remaining: 0,
  next_payment_date: null,
};

const mockSummary: DebtAccountSummary = {
  total_debt: 4_500_000,
  loan_count: 1,
  next_payment_date: '2026-06-15',
  next_payment_amount: 30_000,
  loans: [activeLoan],
};

function setupLoans(loans: DebtAccount[], summary: DebtAccountSummary | null = null, isLoading = false) {
  (useLoans as jest.Mock).mockReturnValue({ loans, summary, isLoading, error: null, refetch: jest.fn() });
}

beforeEach(() => jest.clearAllMocks());

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('LoansPage', () => {
  it('shows the loading skeleton when isLoading is true', () => {
    // The page paints LoansSkeleton rather than a full-screen spinner, so the
    // route is contentful immediately (LCP). It exposes role="status".
    setupLoans([], null, true);
    render(<LoansPage />);
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByTestId('loading-spinner')).toBeNull();
  });

  it('shows page title when not loading', () => {
    setupLoans([]);
    render(<LoansPage />);
    expect(screen.getByText('Loans & Debt')).toBeInTheDocument();
  });

  it('shows empty state when no loans', () => {
    setupLoans([]);
    render(<LoansPage />);
    expect(screen.getByText('No loans recorded')).toBeInTheDocument();
  });

  it('shows "Add Your First Loan" button in empty state', () => {
    setupLoans([]);
    render(<LoansPage />);
    expect(screen.getByText('Add Your First Loan')).toBeInTheDocument();
  });

  it('does not show empty state when loans exist', () => {
    setupLoans([activeLoan], mockSummary);
    render(<LoansPage />);
    expect(screen.queryByText('No loans recorded')).not.toBeInTheDocument();
  });

  it('shows Active section heading with count', () => {
    setupLoans([activeLoan], mockSummary);
    render(<LoansPage />);
    expect(screen.getByText('Active (1)')).toBeInTheDocument();
  });

  it('shows Paid Off section heading with count', () => {
    setupLoans([activeLoan, paidOffLoan], mockSummary);
    render(<LoansPage />);
    expect(screen.getByRole('heading', { name: 'Paid Off (1)' })).toBeInTheDocument();
  });

  it('does not show Paid Off section when no paid-off loans', () => {
    setupLoans([activeLoan], mockSummary);
    render(<LoansPage />);
    expect(screen.queryByText(/Paid Off \(/)).not.toBeInTheDocument();
  });

  it('renders LoanCard for each active loan', () => {
    setupLoans([activeLoan], mockSummary);
    render(<LoansPage />);
    expect(screen.getByTestId('loan-card-loan-1')).toBeInTheDocument();
    expect(screen.getByText('Home Mortgage')).toBeInTheDocument();
  });

  it('opens AddLoanModal when "Add Loan" header button is clicked', () => {
    setupLoans([]);
    render(<LoansPage />);
    fireEvent.click(screen.getByText('Add Loan'));
    expect(screen.getByTestId('add-loan-modal')).toBeInTheDocument();
  });

  it('opens AddLoanModal when "Add Your First Loan" button is clicked', () => {
    setupLoans([]);
    render(<LoansPage />);
    fireEvent.click(screen.getByText('Add Your First Loan'));
    expect(screen.getByTestId('add-loan-modal')).toBeInTheDocument();
  });

  it('closes AddLoanModal when onClose is called', () => {
    setupLoans([]);
    render(<LoansPage />);
    fireEvent.click(screen.getByText('Add Loan'));
    expect(screen.getByTestId('add-loan-modal')).toBeInTheDocument();
    fireEvent.click(screen.getByText('CloseAddModal'));
    expect(screen.queryByTestId('add-loan-modal')).not.toBeInTheDocument();
  });

  it('opens EditLoanModal when Edit is clicked on a loan card', () => {
    setupLoans([activeLoan], mockSummary);
    render(<LoansPage />);
    fireEvent.click(screen.getByText('Edit'));
    expect(screen.getByTestId('edit-loan-modal')).toBeInTheDocument();
    expect(screen.getByText('Editing: Home Mortgage')).toBeInTheDocument();
  });

  it('closes EditLoanModal when onClose is called', () => {
    setupLoans([activeLoan], mockSummary);
    render(<LoansPage />);
    fireEvent.click(screen.getByText('Edit'));
    fireEvent.click(screen.getByText('CloseEditModal'));
    expect(screen.queryByTestId('edit-loan-modal')).not.toBeInTheDocument();
  });

  it('opens RecordPaymentModal when RecordPayment is clicked', () => {
    setupLoans([activeLoan], mockSummary);
    render(<LoansPage />);
    fireEvent.click(screen.getByText('RecordPayment'));
    expect(screen.getByTestId('record-payment-modal')).toBeInTheDocument();
    expect(screen.getByText('Payment for: Home Mortgage')).toBeInTheDocument();
  });

  it('shows delete confirmation modal when Delete is clicked', () => {
    setupLoans([activeLoan], mockSummary);
    render(<LoansPage />);
    fireEvent.click(screen.getByText('Delete'));
    expect(screen.getByText('Remove Loan?')).toBeInTheDocument();
  });

  it('closes delete confirmation when Cancel is clicked', () => {
    setupLoans([activeLoan], mockSummary);
    render(<LoansPage />);
    fireEvent.click(screen.getByText('Delete'));
    fireEvent.click(screen.getByText('Cancel'));
    expect(screen.queryByText('Remove Loan?')).not.toBeInTheDocument();
  });

  it('calls deleteLoan.mutateAsync when Remove is clicked', async () => {
    setupLoans([activeLoan], mockSummary);
    render(<LoansPage />);
    fireEvent.click(screen.getByText('Delete'));
    fireEvent.click(screen.getByText('Remove'));
    await waitFor(() => {
      expect(mockDeleteMutateAsync).toHaveBeenCalledWith('loan-1');
    });
  });

  it('shows Total Debt chip when summary has loans', () => {
    setupLoans([activeLoan], mockSummary);
    render(<LoansPage />);
    expect(screen.getByText('Total Debt')).toBeInTheDocument();
  });

  it('shows Active Loans chip when summary has loans', () => {
    setupLoans([activeLoan], mockSummary);
    render(<LoansPage />);
    expect(screen.getByText('Active Loans')).toBeInTheDocument();
  });

  it('shows paid-off loan card in the Paid Off section', () => {
    setupLoans([activeLoan, paidOffLoan], mockSummary);
    render(<LoansPage />);
    expect(screen.getByTestId('loan-card-loan-2')).toBeInTheDocument();
    expect(screen.getByText('Car Loan')).toBeInTheDocument();
  });
});
