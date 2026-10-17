/**
 * "For next month": prompts read off the month's figures, money masked in
 * privacy mode, and no card at all when there is nothing worth saying.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { NextMonthCard } from '@/components/review/NextMonthCard';
import { buildMonthReview, monthRange } from '@/lib/review';

const mockVisible = { value: true };
jest.mock('@/contexts/PrivacyContext', () => ({
  usePrivacy: () => ({ maskValue: (v: string) => (mockVisible.value ? v : '••••') }),
}));
jest.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({
    t: (_k: string, fallback: string, o?: Record<string, unknown>) =>
      (typeof fallback === 'string' ? fallback : _k).replace(/\{\{(\w+)\}\}/g, (_m, n) => String(o?.[n] ?? '')),
  }),
}));

const sep = monthRange('2026-09', new Date(2026, 9, 20));
const spending = (income: number, cats: Record<string, number>) => ({
  totalIncome: income,
  totalExpenses: Object.values(cats).reduce((s, v) => s + v, 0),
  categoryBreakdown: Object.entries(cats).map(([category, amount]) => ({ category, amount })),
});

beforeEach(() => { mockVisible.value = true; });

it('says what overspending cost and where to look, with a link', () => {
  const r = buildMonthReview(sep, spending(50_000, { Rent: 40_000, Dining: 15_000 }), spending(50_000, { Rent: 40_000, Dining: 5_000 }));
  render(<NextMonthCard review={r} />);
  expect(screen.getByRole('heading', { name: 'For next month' })).toBeInTheDocument();
  expect(screen.getByText(/more than came in\. Rent is the biggest line/)).toBeInTheDocument();
  expect(screen.getAllByRole('link')[0]).toHaveAttribute('href', '/transactions');
});

it('masks every amount in privacy mode', () => {
  mockVisible.value = false;
  const r = buildMonthReview(sep, spending(50_000, { Rent: 40_000, Dining: 15_000 }), spending(50_000, { Rent: 40_000, Dining: 5_000 }));
  const { container } = render(<NextMonthCard review={r} />);
  expect(container.textContent).not.toMatch(/\d{1,3},\d{3}/);
  expect(container.textContent).toContain('••••');
});

it('renders nothing when nothing is worth saying', () => {
  // A steady 25% month, same as last: no rule fires.
  const r = buildMonthReview(sep, spending(100_000, { Rent: 75_000 }), spending(100_000, { Rent: 75_000 }));
  const { container } = render(<NextMonthCard review={r} />);
  expect(container).toBeEmptyDOMElement();
});
