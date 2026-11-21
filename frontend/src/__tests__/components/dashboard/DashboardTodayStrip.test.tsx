import React from 'react';
import { render, screen } from '@testing-library/react';
import { DashboardTodayStrip } from '@/components/dashboard/DashboardTodayStrip';

// Interpolates the defaultValue, so the assertions read the copy a user sees;
// a key with no default renders as the key plus its values.
jest.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown> | string) => {
      if (typeof opts === 'string') return opts;
      const template = (opts?.defaultValue as string | undefined) ?? `${key}${opts ? ' ' + JSON.stringify(opts) : ''}`;
      return template.replace(/\{\{(\w+)\}\}/g, (_, k) => String(opts?.[k]));
    },
    i18n: { language: 'en' },
  }),
}));

let mockVisible = true;
jest.mock('@/contexts/PrivacyContext', () => ({
  usePrivacy: () => ({ isValueVisible: mockVisible }),
}));

jest.mock('@/utils/formatters', () => ({
  formatCurrency: (v: number, _c: string, o?: { compact?: boolean }) =>
    o?.compact ? `C${Math.round(v)}` : `NT$${Math.round(v)}`,
}));

const leverage = { now: 60, start: 50, debt: 3_000_000, invested: 5_000_000 };

beforeEach(() => {
  mockVisible = true;
});

describe('DashboardTodayStrip — Saved', () => {
  it('shows income and spending instead of a rate when income does not cover spending', () => {
    // Mid-month, before pay lands: 20,000 in against 150,000 out read "-650.0%".
    render(<DashboardTodayStrip income={20_000} expenses={150_000} periodLabel="This month" />);
    expect(screen.getByText('NT$-130000')).toBeInTheDocument();
    expect(screen.getByText('Income C20000 · Spent C150000')).toBeInTheDocument();
    expect(screen.queryByText(/savingsRate/)).not.toBeInTheDocument();
  });

  it('shows the rate once income covers spending', () => {
    render(<DashboardTodayStrip income={80_000} expenses={50_000} periodLabel="This month" />);
    expect(screen.getByText(/todayStrip\.savingsRate .*"rate":"37\.5"/)).toBeInTheDocument();
    expect(screen.queryByText(/^Income /)).not.toBeInTheDocument();
  });

  it('shows no rate with no income at all', () => {
    render(<DashboardTodayStrip income={0} expenses={0} periodLabel="This month" />);
    expect(screen.getByText('Income C0 · Spent C0')).toBeInTheDocument();
  });
});

describe('DashboardTodayStrip — Leverage', () => {
  it('states leverage now, where the period opened, and what it is made of', () => {
    render(<DashboardTodayStrip income={0} expenses={0} leverage={leverage} periodLabel="This month" />);
    expect(screen.getByText('60.0%')).toBeInTheDocument();
    expect(screen.getByText(/10\.0 pts/)).toBeInTheDocument();
    expect(screen.getByText('from 50.0%')).toBeInTheDocument();
    expect(screen.getByText('C3000000 debt / C5000000 invested')).toBeInTheDocument();
  });

  it('marks rising leverage red and falling green', () => {
    const { rerender } = render(
      <DashboardTodayStrip income={0} expenses={0} leverage={leverage} periodLabel="This month" />,
    );
    expect(screen.getByText(/10\.0 pts/).className).toMatch(/error/);
    rerender(
      <DashboardTodayStrip income={0} expenses={0} leverage={{ ...leverage, now: 45 }} periodLabel="This month" />,
    );
    expect(screen.getByText(/5\.0 pts/).className).toMatch(/prosperity/);
  });

  it('is left out without debt, and no longer repeats the portfolio value', () => {
    const { container } = render(<DashboardTodayStrip income={0} expenses={0} periodLabel="This month" />);
    expect(screen.queryByText(/Leverage/)).not.toBeInTheDocument();
    expect(container.querySelector('.grid-cols-1')).not.toBeNull();
  });

  it('keeps the column while the trend loads, so the layout does not jump', () => {
    const { container, rerender } = render(
      <DashboardTodayStrip income={0} expenses={0} hasDebt leverageLoading periodLabel="This month" />,
    );
    expect(container.querySelector('.grid-cols-2')).not.toBeNull();
    expect(screen.getByTestId('leverage-loading')).toBeInTheDocument();
    rerender(
      <DashboardTodayStrip income={0} expenses={0} hasDebt leverage={leverage} periodLabel="This month" />,
    );
    expect(container.querySelector('.grid-cols-2')).not.toBeNull();
    expect(screen.getByText('60.0%')).toBeInTheDocument();
  });

  it('states no ratio for debt with nothing invested', () => {
    render(<DashboardTodayStrip income={0} expenses={0} hasDebt periodLabel="This month" />);
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.queryByTestId('leverage-loading')).not.toBeInTheDocument();
  });

  it('hides the amounts but keeps the ratio when values are hidden', () => {
    mockVisible = false;
    render(<DashboardTodayStrip income={20_000} expenses={150_000} leverage={leverage} periodLabel="This month" />);
    expect(screen.getByText('60.0%')).toBeInTheDocument();
    expect(screen.getByText('••• debt / ••• invested')).toBeInTheDocument();
    expect(screen.getByText('Income ••• · Spent •••')).toBeInTheDocument();
    expect(screen.queryByText(/3000000/)).not.toBeInTheDocument();
  });
});
