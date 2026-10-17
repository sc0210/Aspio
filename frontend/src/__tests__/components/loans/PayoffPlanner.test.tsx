/**
 * The loans payoff planner: a debt-free date, what extra money changes against
 * minimums only, and a plain warning when a budget never clears the debt.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { PayoffPlanner } from '@/components/loans/PayoffPlanner';
import type { DebtAccount } from '@/services/loanService';

const mockVisible = { value: true };
jest.mock('@/contexts/PrivacyContext', () => ({ usePrivacy: () => ({ isValueVisible: mockVisible.value }) }));
// Recharts needs a measured container jsdom can't give; the chart is not what's under test.
jest.mock('recharts', () => {
  const Stub = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return { ResponsiveContainer: Stub, LineChart: Stub, Line: () => null, XAxis: () => null, YAxis: () => null, CartesianGrid: () => null, Tooltip: () => null };
});
jest.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => (o && 'span' in o ? `${k}:${o.span}` : o && 'amount' in o ? `${k}:${o.amount}` : k),
    i18n: { language: 'en' },
  }),
}));

const loan = (over: Partial<DebtAccount>): DebtAccount => ({
  id: 'x', user_id: 'u', name: 'Loan', lender_name: null, account_type: 'personal_loan' as DebtAccount['account_type'],
  principal_amount: 0, current_balance: 0, interest_rate: 0, minimum_payment: 0, payment_due_day: 5,
  start_date: '2026-01-01', term_months: null, currency: 'TWD', status: 'active' as DebtAccount['status'], notes: null,
  created_at: '', updated_at: '', progress_pct: null, months_remaining: null, payoff_months_estimate: null,
  total_interest_remaining: null, next_payment_date: null, ...over,
});

beforeEach(() => {
  mockVisible.value = true;
  window.localStorage.clear();
});

it('shows a date, then how much sooner extra money gets there', () => {
  render(<PayoffPlanner loans={[loan({ id: 'a', name: 'Card', current_balance: 12_000, minimum_payment: 1_000 })]} />);
  expect(screen.getByText('planner.in:planner.years')).toBeInTheDocument();
  expect(screen.getByText('planner.sameAsMinimums')).toBeInTheDocument();

  fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '1000' } });
  expect(screen.getByText('planner.sooner:planner.months')).toBeInTheDocument();
  expect(window.localStorage.getItem('aspiro-payoff-extra')).toBe('1000');
});

it('warns when a minimum is below the interest and the budget never clears', () => {
  render(<PayoffPlanner loans={[loan({ current_balance: 100_000, interest_rate: 12, minimum_payment: 500 })]} />);
  expect(screen.getByText('planner.never')).toBeInTheDocument();
  expect(screen.getByText(/planner.stalled/)).toBeInTheDocument();
});

it('accepts decimal fields that arrive as strings', () => {
  render(<PayoffPlanner loans={[loan({ current_balance: '12000' as unknown as number, minimum_payment: '1000' as unknown as number })]} />);
  expect(screen.queryByText('planner.never')).not.toBeInTheDocument();
});

it('lists payoff order and switches strategy', () => {
  const loans = [
    loan({ id: 's', name: 'Small cheap', current_balance: 5_000, interest_rate: 2, minimum_payment: 200 }),
    loan({ id: 'b', name: 'Big dear', current_balance: 50_000, interest_rate: 15, minimum_payment: 1_000 }),
  ];
  render(<PayoffPlanner loans={loans} />);
  fireEvent.click(screen.getByRole('radio', { name: 'planner.snowball' }));
  expect(screen.getByRole('radio', { name: 'planner.snowball' })).toHaveAttribute('aria-checked', 'true');
  const items = screen.getAllByRole('listitem').map((li) => li.textContent);
  expect(items[0]).toContain('Small cheap');
});

it('masks money when values are hidden', () => {
  mockVisible.value = false;
  render(<PayoffPlanner loans={[loan({ current_balance: 100_000, interest_rate: 5, minimum_payment: 2_000 })]} />);
  expect(screen.getAllByText('••••').length).toBeGreaterThan(0);
});

it('when neither schedule clears, a smaller-but-real saving is still shown, labelled as capped', () => {
  render(<PayoffPlanner loans={[loan({ current_balance: 100_000, interest_rate: 12, minimum_payment: 500 })]} />);
  fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '200' } });
  expect(screen.getByText('planner.never')).toBeInTheDocument();
  expect(screen.queryByText('planner.sameAsMinimums')).not.toBeInTheDocument();
  expect(screen.getByText(/planner.savesCapped/)).toBeInTheDocument();
});

it('a loan with no minimum is explained as unpaid, not as out-run by interest', () => {
  render(<PayoffPlanner loans={[loan({ current_balance: 10_000, interest_rate: 0, minimum_payment: 0 })]} />);
  expect(screen.getByText(/planner.noPayment/)).toBeInTheDocument();
  expect(screen.queryByText(/planner.stalled/)).not.toBeInTheDocument();
});
