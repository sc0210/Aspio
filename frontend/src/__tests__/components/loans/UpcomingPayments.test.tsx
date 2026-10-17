/** The next 30 days of loan payments: soonest first, overdue flagged, amounts masked in privacy mode. */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { UpcomingPayments } from '@/components/loans/UpcomingPayments';
import type { DebtAccount } from '@/services/loanService';

const mockVisible = { value: true };
jest.mock('@/contexts/PrivacyContext', () => ({ usePrivacy: () => ({ isValueVisible: mockVisible.value }) }));
jest.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => (o && 'count' in o ? `${k}:${o.count}` : k),
    i18n: { language: 'en' },
  }),
}));

const iso = (offset: number) => {
  const d = new Date(); d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const loan = (id: string, name: string, offset: number, min: number) =>
  ({ id, name, status: 'active', currency: 'TWD', minimum_payment: min, next_payment_date: iso(offset) }) as unknown as DebtAccount;

beforeEach(() => {
  mockVisible.value = true;
  jest.useFakeTimers().setSystemTime(new Date(2026, 9, 8, 12)); // not the wall clock
});
afterEach(() => jest.useRealTimers());

it('lists payments soonest first with when they fall due', () => {
  render(<UpcomingPayments loans={[loan('a', 'Card', 12, 5000), loan('b', 'Mortgage', -2, 22000)]} />);
  const rows = screen.getAllByRole('listitem').map((li) => li.textContent);
  expect(rows[0]).toMatch(/Mortgage.*upcoming.overdue:2/);
  expect(rows[1]).toMatch(/Card.*upcoming.inDays:12/);
});

it('says when nothing is due, and masks amounts in privacy mode', () => {
  const { unmount } = render(<UpcomingPayments loans={[]} />);
  expect(screen.getByText('upcoming.none:30')).toBeInTheDocument();
  unmount();
  mockVisible.value = false;
  render(<UpcomingPayments loans={[loan('a', 'Card', 3, 5000)]} />);
  expect(screen.queryByText(/5,000/)).not.toBeInTheDocument();
});

it('loans in different currencies get no single total, and say so', () => {
  const usd = { ...loan('u', 'USD loan', 5, 300), currency: 'USD' } as unknown as DebtAccount;
  render(<UpcomingPayments loans={[loan('a', 'Card', 3, 5000), usd]} />);
  expect(screen.getByText('upcoming.mixedCurrencies')).toBeInTheDocument();
});
