/** The month's biggest single expenses: ranked rows, masked money, honest empty/error states. */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { TopExpensesCard } from '@/components/review/TopExpensesCard';
import { monthRange } from '@/lib/review';

const mockState: { data?: unknown[]; isLoading: boolean; isError: boolean } = { isLoading: false, isError: false };
jest.mock('@/hooks/useReviewTopExpenses', () => ({ useReviewTopExpenses: () => mockState }));
const mockVisible = { value: true };
jest.mock('@/contexts/PrivacyContext', () => ({
  usePrivacy: () => ({ maskValue: (v: string) => (mockVisible.value ? v : '••••') }),
}));
jest.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({ t: (_k: string, f: string) => f, i18n: { language: 'en' } }),
}));

const range = monthRange('2026-09', new Date(2026, 9, 20));
const rows = [
  { id: 'a', description: 'Rent', category: 'Housing', amount: 20_000, currency: 'TWD', date: '2026-09-03' },
  { id: 'b', description: '', category: 'Travel', amount: 300, currency: 'USD', date: '2026-09-14' },
];

beforeEach(() => {
  mockVisible.value = true;
  Object.assign(mockState, { data: rows, isLoading: false, isError: false });
});

it('lists the rows in order, each in its own currency, falling back to the category name', () => {
  render(<TopExpensesCard range={range} />);
  const items = screen.getAllByRole('listitem').map((li) => li.textContent);
  expect(items[0]).toMatch(/Rent.*Housing.*Sep 3.*20,000/);
  expect(items[1]).toMatch(/Travel.*\$300|Travel.*300/);
});

it('masks amounts in privacy mode', () => {
  mockVisible.value = false;
  render(<TopExpensesCard range={range} />);
  expect(screen.queryByText(/20,000/)).not.toBeInTheDocument();
  expect(screen.getAllByText('••••')).toHaveLength(2);
});

it('says when it failed rather than showing an empty month', () => {
  Object.assign(mockState, { data: undefined, isError: true });
  render(<TopExpensesCard range={range} />);
  expect(screen.getByText(/couldn't be loaded/)).toBeInTheDocument();
  expect(screen.queryByText(/No spending recorded/)).not.toBeInTheDocument();
});

it('demo rows sit inside the month on screen, none after its last elapsed day', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { demoReviewTopExpenses } = require('@/data/demoReview') as typeof import('@/data/demoReview');
  const running = demoReviewTopExpenses({ key: '2026-10', days: 8 });
  expect(running.every((r) => /^2026-10-0[1-8]$/.test(r.date))).toBe(true);
  expect(demoReviewTopExpenses({ key: '2026-09', days: 30 }).map((r) => r.date)).toContain('2026-09-21');
});
