import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RecordPaymentModal } from '@/components/loans/RecordPaymentModal';
import type { DebtAccount } from '@/services/loanService';

const mockMutateAsync = jest.fn().mockResolvedValue({});

jest.mock('@/hooks/useLoans', () => ({
  useRecordPayment: () => ({
    mutateAsync: mockMutateAsync,
    isPending: false,
  }),
}));

jest.mock('react-i18next', () => ({
  // i18next calls .use(initReactI18next) at import time; a mock without it
  // makes lib/i18n throw and the whole suite dies before any test runs.
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        'paymentModal.title': 'Record Payment',
        'paymentModal.currentBalance': 'Current balance',
        'paymentModal.paymentDate': 'Payment Date *',
        'paymentModal.totalPayment': 'Total Payment (TWD) *',
        'paymentModal.principalPortion': 'Principal Portion (TWD) *',
        'paymentModal.interestPortion': 'Interest Portion (TWD)',
        'paymentModal.balanceAfter': 'Balance after payment',
        'paymentModal.cancel': 'Cancel',
        'paymentModal.recording': 'Recording…',
        'paymentModal.record': 'Record Payment',
        'paymentModal.error.exceedsBalance': `Cannot exceed current balance (${opts?.amount ?? ''})`,
        'paymentModal.error.splitMismatch': 'Principal + interest must equal total',
      };
      if (key === 'paymentModal.error.exceedsBalance') {
        return `Cannot exceed current balance (${opts?.amount ?? ''})`;
      }
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
  current_balance: 100_000,
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
  progress_pct: 98,
  months_remaining: 3,
  payoff_months_estimate: 3,
  total_interest_remaining: 200,
  next_payment_date: '2026-06-15',
};

beforeEach(() => jest.clearAllMocks());

describe('RecordPaymentModal', () => {
  it('renders modal title', () => {
    render(<RecordPaymentModal loan={mockLoan} onClose={jest.fn()} />);
    expect(screen.getByRole('heading', { name: 'Record Payment' })).toBeInTheDocument();
  });

  it('shows loan name as subtitle', () => {
    render(<RecordPaymentModal loan={mockLoan} onClose={jest.fn()} />);
    expect(screen.getByText('Home Mortgage')).toBeInTheDocument();
  });

  it('displays current balance label', () => {
    render(<RecordPaymentModal loan={mockLoan} onClose={jest.fn()} />);
    expect(screen.getByText('Current balance')).toBeInTheDocument();
  });

  it('submit button is disabled when principalPortion is 0', () => {
    render(<RecordPaymentModal loan={mockLoan} onClose={jest.fn()} />);
    const submitBtn = screen.getByText('Record Payment', { selector: 'button[type="submit"]' });
    expect(submitBtn).toBeDisabled();
  });

  it('shows error when principalPortion exceeds current_balance', () => {
    render(<RecordPaymentModal loan={mockLoan} onClose={jest.fn()} />);

    // Set total amount first
    const totalInput = screen.getByLabelText('Total Payment (TWD) *');
    fireEvent.change(totalInput, { target: { value: '200000' } });

    // Set principal greater than balance
    const principalInput = screen.getByLabelText('Principal Portion (TWD) *');
    fireEvent.change(principalInput, { target: { value: '200000' } });

    expect(screen.getByText(/Cannot exceed current balance/)).toBeInTheDocument();
  });

  it('shows balance-after-payment preview when principal is valid', () => {
    render(<RecordPaymentModal loan={mockLoan} onClose={jest.fn()} />);

    const totalInput = screen.getByLabelText('Total Payment (TWD) *');
    fireEvent.change(totalInput, { target: { value: '30000' } });

    const principalInput = screen.getByLabelText('Principal Portion (TWD) *');
    fireEvent.change(principalInput, { target: { value: '29000' } });

    // Balance after = 100000 - 29000 = 71000
    expect(screen.getByText('Balance after payment')).toBeInTheDocument();
  });

  it('auto-calculates interest portion as total - principal', () => {
    render(<RecordPaymentModal loan={mockLoan} onClose={jest.fn()} />);

    const totalInput = screen.getByLabelText('Total Payment (TWD) *');
    fireEvent.change(totalInput, { target: { value: '30000' } });

    const principalInput = screen.getByLabelText('Principal Portion (TWD) *');
    fireEvent.change(principalInput, { target: { value: '29000' } });

    // Interest input should be read-only and show 1000
    const interestInput = screen.getByLabelText('Interest Portion (TWD)') as HTMLInputElement;
    expect(interestInput.readOnly).toBe(true);
    expect(Number(interestInput.value)).toBe(1000);
  });

  it('calls mutateAsync with correct data on submit', async () => {
    const onClose = jest.fn();
    render(<RecordPaymentModal loan={mockLoan} onClose={onClose} />);

    const totalInput = screen.getByLabelText('Total Payment (TWD) *');
    fireEvent.change(totalInput, { target: { value: '30000' } });

    const principalInput = screen.getByLabelText('Principal Portion (TWD) *');
    fireEvent.change(principalInput, { target: { value: '29000' } });

    const submitBtn = screen.getByText('Record Payment', { selector: 'button[type="submit"]' });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledWith({
        id: 'loan-1',
        data: expect.objectContaining({
          total_amount: 30000,
          principal_portion: 29000,
          interest_portion: 1000,
        }),
      });
    });
  });

  it('calls onClose after successful payment', async () => {
    const onClose = jest.fn();
    render(<RecordPaymentModal loan={mockLoan} onClose={onClose} />);

    const totalInput = screen.getByLabelText('Total Payment (TWD) *');
    fireEvent.change(totalInput, { target: { value: '30000' } });

    const principalInput = screen.getByLabelText('Principal Portion (TWD) *');
    fireEvent.change(principalInput, { target: { value: '29000' } });

    fireEvent.click(screen.getByText('Record Payment', { selector: 'button[type="submit"]' }));

    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
  });

  it('calls onClose when Cancel clicked', () => {
    const onClose = jest.fn();
    render(<RecordPaymentModal loan={mockLoan} onClose={onClose} />);
    fireEvent.click(screen.getByText('Cancel'));
    expect(onClose).toHaveBeenCalled();
  });

  it('initialises total amount to minimum_payment', () => {
    render(<RecordPaymentModal loan={mockLoan} onClose={jest.fn()} />);
    const totalInput = screen.getByLabelText('Total Payment (TWD) *') as HTMLInputElement;
    expect(Number(totalInput.value)).toBe(30000);
  });
});
