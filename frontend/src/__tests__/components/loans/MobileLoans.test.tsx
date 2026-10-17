/**
 * The phone loans view (#344): total debt and the next payment up top, each active
 * loan with a Pay button that opens the payment form, and nothing paid-off.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { MobileLoans } from '@/components/loans/MobileLoans';

const mockVisible = { value: true };

const DEFAULT_LOANS = [
      { id: 'home', name: 'Mortgage', status: 'active', current_balance: 1200000, interest_rate: 2.1, minimum_payment: 22000, currency: 'TWD', progress_pct: 25, next_payment_date: '2026-11-05' },
      { id: 'card', name: 'Card instalments', status: 'active', current_balance: 45000, interest_rate: 15, minimum_payment: 5000, currency: 'TWD', progress_pct: 60, next_payment_date: null },
      { id: 'car', name: 'Old car loan', status: 'paid_off', current_balance: 0, currency: 'TWD', progress_pct: 100, next_payment_date: null },
    ];
const mockLoans: { value: Array<Record<string, unknown>> } = { value: DEFAULT_LOANS };

jest.mock('@/hooks/useLoans', () => ({
  useLoans: () => ({
    isLoading: false,
    loans: mockLoans.value,
    summary: { total_debt: 1245000, loan_count: 2, next_payment_amount: 22000, next_payment_date: '2026-11-05', loans: [] },
  }),
}));

jest.mock('@/contexts/PrivacyContext', () => ({
  usePrivacy: () => ({ isValueVisible: mockVisible.value }),
}));

jest.mock('@/components/loans/RecordPaymentModal', () => ({
  RecordPaymentModal: ({ loan }: { loan: { name: string } }) => <div role="dialog">paying {loan.name}</div>,
}));
jest.mock('@/components/loans/AddLoanModal', () => ({
  AddLoanModal: () => <div role="dialog">add loan</div>,
}));
jest.mock('@/components/loans/LoansSkeleton', () => ({ LoansSkeleton: () => null }));
// Has its own suite; here it only needs to be handed the active loans.
jest.mock('@/components/loans/UpcomingPayments', () => ({
  UpcomingPayments: ({ loans }: { loans: Array<{ id: string }> }) => <div data-testid="upcoming">{loans.map((l) => l.id).join(',')}</div>,
}));
jest.mock('@/components/dashboard/BiggerScreenHint', () => ({ BiggerScreenHint: () => null }));
jest.mock('@/components/layout/DashboardLayout', () => ({
  DashboardLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

jest.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({
    t: (k: string, opts?: Record<string, unknown> | string) => {
      if (typeof opts === 'string') return opts;
      const map: Record<string, string> = {
        'loans:card.recordPayment': 'Record Payment',
        'loans:summary.totalDebt': 'Total Debt',
        'loans:addLoan': 'Add Loan',
      };
      if (k === 'loans:card.remaining') return `${opts?.amount} remaining`;
      if (k === 'loans:planner.mobileDebtFree') return `Debt free by ${opts?.date}`;
      if (k === 'loans:planner.mobileNever') return 'Not cleared';
      return map[k] ?? k;
    },
    i18n: { language: 'en' },
  }),
}));

beforeEach(() => { mockVisible.value = true; mockLoans.value = DEFAULT_LOANS; });

it('leads with total debt and the next payment', () => {
  render(<MobileLoans />);
  expect(screen.getByText('Total Debt')).toBeInTheDocument();
  expect(screen.getByText(/1,245,000/)).toBeInTheDocument();
  expect(screen.getByText(/22,000/)).toBeInTheDocument();
});

it('lists the active loans only, each with a Pay button that opens the payment form', () => {
  render(<MobileLoans />);
  expect(screen.getByText('Mortgage')).toBeInTheDocument();
  expect(screen.getByText('Card instalments')).toBeInTheDocument();
  expect(screen.queryByText('Old car loan')).not.toBeInTheDocument();

  const pay = screen.getAllByRole('button', { name: 'Record Payment' });
  expect(pay).toHaveLength(2);
  fireEvent.click(pay[1]);
  expect(screen.getByRole('dialog')).toHaveTextContent('paying Card instalments');
});

it('masks every amount when values are hidden', () => {
  mockVisible.value = false;
  render(<MobileLoans />);
  expect(screen.queryByText(/1,245,000/)).not.toBeInTheDocument();
  expect(screen.queryByText(/22,000/)).not.toBeInTheDocument();
  expect(screen.queryByText(/1,200,000/)).not.toBeInTheDocument();
  expect(screen.getAllByText(/••••/).length).toBeGreaterThan(0);
});

it('says when the debt is gone at today\'s payments', () => {
  render(<MobileLoans />);
  // 1.245M at these terms, minimums rolling over: a real month, not "never".
  expect(screen.getByText(/Debt free by \w{3} 20\d\d/)).toBeInTheDocument();
});

it('no debt-free line when a loan in another currency would be left out of it', () => {
  mockLoans.value = [
    ...DEFAULT_LOANS,
    { id: 'usd', name: 'USD loan', status: 'active', current_balance: 5000, interest_rate: 5, minimum_payment: 200, currency: 'USD', progress_pct: 0, next_payment_date: null },
  ];
  render(<MobileLoans />);
  expect(screen.queryByText(/Debt free by|Not cleared/)).not.toBeInTheDocument();
});

it('a loan with no minimum reads "not cleared", not a budget verdict', () => {
  mockLoans.value = [
    { id: 'x', name: 'Family loan', status: 'active', current_balance: 100000, interest_rate: 0, minimum_payment: 0, currency: 'TWD', progress_pct: 0, next_payment_date: null },
  ];
  render(<MobileLoans />);
  expect(screen.getByText(/Not cleared/)).toBeInTheDocument();
});

it('shows the next 30 days of payments for the active loans', () => {
  render(<MobileLoans />);
  expect(screen.getByTestId('upcoming')).toHaveTextContent('home,card');
});
