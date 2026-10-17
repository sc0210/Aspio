import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { EditLoanModal } from '@/components/loans/EditLoanModal';
import type { DebtAccount } from '@/services/loanService';

const mockMutateAsync = jest.fn().mockResolvedValue({});

jest.mock('@/hooks/useLoans', () => ({
  useUpdateLoan: () => ({
    mutateAsync: mockMutateAsync,
    isPending: false,
  }),
}));

jest.mock('react-i18next', () => ({
  // i18next calls .use(initReactI18next) at import time; a mock without it
  // makes lib/i18n throw and the whole suite dies before any test runs.
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'editModal.title': 'Edit Loan',
        'editModal.status': 'Status',
        'editModal.saving': 'Saving…',
        'editModal.save': 'Save Changes',
        'addModal.loanNameRequired': 'Loan Name *',
        'addModal.lender': 'Lender',
        'addModal.interestRate': 'Annual Interest Rate (%) *',
        'addModal.minPayment': 'Monthly Min Payment (TWD) *',
        'addModal.dueDay': 'Due Day *',
        'addModal.termMonths': 'Term (months)',
        'addModal.notes': 'Notes',
        'addModal.cancel': 'Cancel',
        'status.active': 'Active',
        'status.paused': 'Paused',
        'status.paid_off': 'Paid Off',
      };
      return map[key] ?? key;
    },
  }),
}));

jest.mock('react-hot-toast', () => ({
  __esModule: true,
  default: { success: jest.fn(), error: jest.fn() },
}));

const mockLoan: DebtAccount = {
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
  notes: 'Some notes',
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
  progress_pct: 10,
  months_remaining: 280,
  payoff_months_estimate: 280,
  total_interest_remaining: 1_200_000,
  next_payment_date: '2026-06-15',
};

beforeEach(() => jest.clearAllMocks());

describe('EditLoanModal', () => {
  it('renders the edit modal title', () => {
    render(<EditLoanModal loan={mockLoan} onClose={jest.fn()} />);
    expect(screen.getByText('Edit Loan')).toBeInTheDocument();
  });

  it('shows the loan name as subtitle', () => {
    render(<EditLoanModal loan={mockLoan} onClose={jest.fn()} />);
    expect(screen.getByText('Home Mortgage')).toBeInTheDocument();
  });

  it('pre-populates the Loan Name field', () => {
    render(<EditLoanModal loan={mockLoan} onClose={jest.fn()} />);
    const nameInput = screen.getByLabelText('Loan Name *') as HTMLInputElement;
    expect(nameInput.value).toBe('Home Mortgage');
  });

  it('pre-populates the Lender field', () => {
    render(<EditLoanModal loan={mockLoan} onClose={jest.fn()} />);
    const lenderInput = screen.getByLabelText('Lender') as HTMLInputElement;
    expect(lenderInput.value).toBe('CTBC Bank');
  });

  it('pre-populates the Interest Rate field', () => {
    render(<EditLoanModal loan={mockLoan} onClose={jest.fn()} />);
    const rateInput = screen.getByLabelText('Annual Interest Rate (%) *') as HTMLInputElement;
    expect(rateInput.value).toBe('2.5');
  });

  it('pre-populates status select with current loan status', () => {
    render(<EditLoanModal loan={mockLoan} onClose={jest.fn()} />);
    const statusSelect = screen.getByLabelText('Status') as HTMLSelectElement;
    expect(statusSelect.value).toBe('active');
  });

  it('renders all three status options', () => {
    render(<EditLoanModal loan={mockLoan} onClose={jest.fn()} />);
    expect(screen.getByRole('option', { name: 'Active' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Paused' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Paid Off' })).toBeInTheDocument();
  });

  it('calls onClose when Cancel clicked', () => {
    const onClose = jest.fn();
    render(<EditLoanModal loan={mockLoan} onClose={onClose} />);
    fireEvent.click(screen.getByText('Cancel'));
    expect(onClose).toHaveBeenCalled();
  });

  it('calls mutateAsync with loan id and updated data on submit', async () => {
    const onClose = jest.fn();
    render(<EditLoanModal loan={mockLoan} onClose={onClose} />);

    fireEvent.change(screen.getByLabelText('Loan Name *'), { target: { value: 'Updated Mortgage' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Save Changes' }).closest('form')!);

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'loan-1',
          data: expect.objectContaining({ name: 'Updated Mortgage' }),
        })
      );
    });
  });

  it('calls onClose after successful submission', async () => {
    const onClose = jest.fn();
    render(<EditLoanModal loan={mockLoan} onClose={onClose} />);

    fireEvent.submit(screen.getByRole('button', { name: 'Save Changes' }).closest('form')!);

    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
  });

  it('allows changing the status to paused', () => {
    render(<EditLoanModal loan={mockLoan} onClose={jest.fn()} />);
    const statusSelect = screen.getByLabelText('Status') as HTMLSelectElement;
    fireEvent.change(statusSelect, { target: { value: 'paused' } });
    expect(statusSelect.value).toBe('paused');
  });

  it('pre-populates notes field', () => {
    render(<EditLoanModal loan={mockLoan} onClose={jest.fn()} />);
    const notesField = screen.getByLabelText('Notes') as HTMLTextAreaElement;
    expect(notesField.value).toBe('Some notes');
  });
});
