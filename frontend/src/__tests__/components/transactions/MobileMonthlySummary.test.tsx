/** The phone monthly summary: the year's net as the hero, months newest first. */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MobileMonthlySummary, type MobileMonthRow } from '@/components/transactions/MobileMonthlySummary';

jest.mock('@/contexts/PrivacyContext', () => ({ usePrivacy: () => ({ isValueVisible: true }) }));
jest.mock('@/components/layout/DashboardLayout', () => ({ DashboardLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
jest.mock('@/components/dashboard/BiggerScreenHint', () => ({ BiggerScreenHint: () => null }));
jest.mock('next/link', () => ({ __esModule: true, default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => <a href={href} {...rest}>{children}</a> }));
jest.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({
    i18n: { language: 'en-US' },
    t: (key: string, opt?: string | Record<string, unknown>) => {
      const text = typeof opt === 'string' ? opt : (opt?.defaultValue as string | undefined) ?? key;
      const vars = typeof opt === 'object' ? opt : {};
      return text.replace(/\{\{(\w+)\}\}/g, (_, v) => String(vars[v] ?? ''));
    },
  }),
}));

const month = (m: string, income: number, total: number): MobileMonthRow =>
  ({ month: m, income, total, housing: total, eat: 0, investment: 0, transfer: 0, debt: 0, others: 0 });

const totals = { housing: 90_000, eat: 0, investment: 0, transfer: 0, debt: 0, others: 0 };

const show = (months: MobileMonthRow[], income = 120_000, expenses = 90_000, bucketTotals = totals) =>
  render(
    <MobileMonthlySummary year={2026} yearOptions={[2026, 2025]} onYearChange={() => {}}
      months={months} income={income} expenses={expenses} totals={bucketTotals} />,
  );

// The list hides months still ahead, so pin "today" (a Taipei business day).
beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-10-13T04:00:00Z'));
});
afterEach(() => jest.useRealTimers());

it('leads with the year\'s net and the share of income kept', () => {
  show([month('2026-01', 60_000, 45_000), month('2026-02', 60_000, 45_000)]);
  expect(screen.getByText('NT$30,000')).toBeInTheDocument();
  expect(screen.getByText('Kept 25% of income')).toBeInTheDocument();
});

it('lists months newest first whatever order the API sends', () => {
  show([month('2026-02', 1, 0), month('2026-03', 1, 0), month('2026-01', 1, 0)]);
  const names = screen.getAllByText(/^(January|February|March)$/).map((el) => el.textContent);
  expect(names).toEqual(['March', 'February', 'January']);
});

it('shows the empty state for a year with no data', () => {
  show([], 0, 0);
  expect(screen.getByText('transactions:monthlySummaryPage.noDataForYear')).toBeInTheDocument();
  expect(screen.queryByText(/Kept/)).not.toBeInTheDocument();
});

it('leaves out the months still ahead, which the API sends as zeros', () => {
  const year = Array.from({ length: 12 }, (_, i) => month(`2026-${String(i + 1).padStart(2, '0')}`, i < 10 ? 60_000 : 0, 0));
  show(year);
  expect(screen.queryByText('November')).not.toBeInTheDocument();
  expect(screen.queryByText('December')).not.toBeInTheDocument();
  expect(screen.getAllByText(/^(January|February|March|April|May|June|July|August|September|October)$/)[0]).toHaveTextContent('October');
});

it('treats twelve zero months as no data, not a year that broke even', () => {
  const zeros = Array.from({ length: 12 }, (_, i) => month(`2025-${String(i + 1).padStart(2, '0')}`, 0, 0));
  show(zeros, 0, 0);
  expect(screen.getByText('transactions:monthlySummaryPage.noDataForYear')).toBeInTheDocument();
  expect(screen.queryByText(/Kept/)).not.toBeInTheDocument();
});

it('does not count a move between wallets as spending', () => {
  // 100k in, 50k spent, 30k moved Life -> Emergency: the API's total says 80k.
  const withTransfer = { ...totals, housing: 50_000, transfer: 30_000 };
  show([{ ...month('2026-01', 100_000, 80_000), housing: 50_000, transfer: 30_000 }], 100_000, 80_000, withTransfer);
  expect(screen.getAllByText('NT$50,000').length).toBeGreaterThan(0);
  expect(screen.getByText('Kept 50% of income')).toBeInTheDocument();
  expect(screen.getByText('Moved between your wallets: NT$30,000 (not spending)')).toBeInTheDocument();
});

it('reconciles a month with a transfer: income - spending = remaining', () => {
  // 60k in; 20k housing and a 10k move to Emergency, which the API puts in total.
  const jan = { ...month('2026-01', 60_000, 30_000), housing: 20_000, transfer: 10_000 };
  show([jan], 60_000, 30_000, { ...totals, housing: 20_000, transfer: 10_000 });
  expect(screen.getByText('January').nextSibling).toHaveTextContent('+NT$40,000');
});
