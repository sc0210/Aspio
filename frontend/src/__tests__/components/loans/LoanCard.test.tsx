import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { LoanCard } from '@/components/loans/LoanCard';
import type { DebtAccount } from '@/services/loanService';

jest.mock('@/hooks/useLoans', () => ({
  usePaymentHistory: () => ({ payments: [], isLoading: false, error: null, refetch: jest.fn() }),
  // LoanCard renders LoanPaymentHistory, which calls these too. Omitting them
  // made every test in this file throw "useDeletePayment is not a function".
  useUpdatePayment: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useDeletePayment: () => ({ mutateAsync: jest.fn(), isPending: false }),
}));

jest.mock('react-i18next', () => ({
  // i18next calls .use(initReactI18next) at import time; a mock without it
  // makes lib/i18n throw and the whole suite dies before any test runs.
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const last = key.split('.').pop() ?? key;
      if (!opts) return last;
      return Object.entries(opts).reduce(
        (s, [k, v]) => s.replace(`{{${k}}}`, String(v)),
        last
      );
    },
  }),
}));

const baseLoan: DebtAccount = {
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
  ...baseLoan,
  id: 'loan-2',
  name: 'Car Loan',
  account_type: 'auto_loan',
  lender_name: null,
  current_balance: 0,
  status: 'paid_off',
  progress_pct: 100,
  months_remaining: 0,
  payoff_months_estimate: 0,
  total_interest_remaining: 0,
  next_payment_date: null,
};

const noop = jest.fn();

function renderCard(loan: DebtAccount, overrides?: Partial<Parameters<typeof LoanCard>[0]>) {
  return render(
    <LoanCard
      loan={loan}
      onRecordPayment={noop}
      onEdit={noop}
      onDelete={noop}
      {...overrides}
    />
  );
}

beforeEach(() => jest.clearAllMocks());

describe('LoanCard', () => {
  it('renders loan name', () => {
    renderCard(baseLoan);
    expect(screen.getByText('Home Mortgage')).toBeInTheDocument();
  });

  it('renders lender name when present', () => {
    renderCard(baseLoan);
    expect(screen.getByText('CTBC Bank')).toBeInTheDocument();
  });

  it('does not render lender row when lender_name is null', () => {
    renderCard(paidOffLoan);
    expect(screen.queryByText('CTBC Bank')).not.toBeInTheDocument();
  });

  it('renders account type badge using translation key', () => {
    renderCard(baseLoan);
    // t('accountTypes.mortgage') returns 'mortgage' from our mock (last key segment)
    expect(screen.getByText('mortgage')).toBeInTheDocument();
  });

  it('renders progress percentage in label', () => {
    renderCard(baseLoan);
    // t('card.repaid', { progress: '10.0' }) → 'repaid'
    expect(screen.getByText('repaid')).toBeInTheDocument();
  });

  it('renders interest rate metric', () => {
    renderCard(baseLoan);
    expect(screen.getByText('2.5%')).toBeInTheDocument();
  });

  it('renders months_remaining value', () => {
    renderCard(baseLoan);
    expect(screen.getByText(/280/)).toBeInTheDocument();
  });

  it('does not render months left when months_remaining is null', () => {
    const loan = { ...baseLoan, months_remaining: null };
    renderCard(loan);
    // months_remaining is null so no "monthsLeft" line is rendered
    expect(screen.queryByText(/monthsLeft/)).not.toBeInTheDocument();
  });

  it('shows Paid Off badge when status is paid_off', () => {
    renderCard(paidOffLoan);
    // t('card.paidOff') → 'paidOff'
    expect(screen.getByText('paidOff')).toBeInTheDocument();
  });

  it('does not show Paid Off badge for active loan', () => {
    renderCard(baseLoan);
    expect(screen.queryByText('paidOff')).not.toBeInTheDocument();
  });

  it('shows Record Payment button for active loan', () => {
    renderCard(baseLoan);
    // t('card.recordPayment') → 'recordPayment'
    expect(screen.getByText('recordPayment')).toBeInTheDocument();
  });

  it('hides Record Payment button for paid-off loan', () => {
    renderCard(paidOffLoan);
    expect(screen.queryByText('recordPayment')).not.toBeInTheDocument();
  });

  it('calls onRecordPayment with the loan when Record Payment clicked', () => {
    const onRecordPayment = jest.fn();
    renderCard(baseLoan, { onRecordPayment });
    fireEvent.click(screen.getByText('recordPayment'));
    expect(onRecordPayment).toHaveBeenCalledWith(baseLoan);
  });

  it('calls onEdit with the loan when edit button clicked', () => {
    const onEdit = jest.fn();
    renderCard(baseLoan, { onEdit });
    const editBtn = screen.getByLabelText('editLoan');
    fireEvent.click(editBtn);
    expect(onEdit).toHaveBeenCalledWith(baseLoan);
  });

  it('calls onDelete with the loan when delete button clicked', () => {
    const onDelete = jest.fn();
    renderCard(baseLoan, { onDelete });
    const deleteBtn = screen.getByLabelText('deleteLoan');
    fireEvent.click(deleteBtn);
    expect(onDelete).toHaveBeenCalledWith(baseLoan);
  });

  it('uses emerald border for paid-off loans', () => {
    const { container } = renderCard(paidOffLoan);
    expect(container.firstChild).toHaveClass('border-emerald-200');
  });

  it('uses default border for active loans', () => {
    const { container } = renderCard(baseLoan);
    expect(container.firstChild).toHaveClass('border-gray-200');
  });
});
