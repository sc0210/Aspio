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

const leverage = { now: 61.5, start: 52.93, debt: 3_765_740, invested: 6_123_098 };

beforeEach(() => {
  mockVisible = true;
});

describe('DashboardTodayStrip — Saved', () => {
  it('shows income and spending instead of a rate when income does not cover spending', () => {
    // 2026-11-21: NT$17,500 in, NT$153,046 out, which read "-774.5% savings rate".
    render(<DashboardTodayStrip income={17_500} expenses={153_046} periodLabel="This month" />);
    expect(screen.getByText('NT$-135546')).toBeInTheDocument();
    expect(screen.getByText('Income C17500 · Spent C153046')).toBeInTheDocument();
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
    expect(screen.getByText('61.5%')).toBeInTheDocument();
    expect(screen.getByText(/8\.6 pts/)).toBeInTheDocument();
    expect(screen.getByText('from 52.9%')).toBeInTheDocument();
    expect(screen.getByText('C3765740 debt / C6123098 invested')).toBeInTheDocument();
  });

  it('marks rising leverage red and falling green', () => {
    const { rerender } = render(
      <DashboardTodayStrip income={0} expenses={0} leverage={leverage} periodLabel="This month" />,
    );
    expect(screen.getByText(/8\.6 pts/).className).toMatch(/error/);
    rerender(
      <DashboardTodayStrip income={0} expenses={0} leverage={{ ...leverage, now: 50 }} periodLabel="This month" />,
    );
    expect(screen.getByText(/2\.9 pts/).className).toMatch(/prosperity/);
  });

  it('is left out without debt, and no longer repeats the portfolio value', () => {
    const { container } = render(<DashboardTodayStrip income={0} expenses={0} periodLabel="This month" />);
    expect(screen.queryByText(/Leverage/)).not.toBeInTheDocument();
    expect(container.querySelector('.grid-cols-1')).not.toBeNull();
  });

  it('hides the amounts but keeps the ratio when values are hidden', () => {
    mockVisible = false;
    render(<DashboardTodayStrip income={17_500} expenses={153_046} leverage={leverage} periodLabel="This month" />);
    expect(screen.getByText('61.5%')).toBeInTheDocument();
    expect(screen.getByText('••• debt / ••• invested')).toBeInTheDocument();
    expect(screen.getByText('Income ••• · Spent •••')).toBeInTheDocument();
    expect(screen.queryByText(/3765740/)).not.toBeInTheDocument();
  });
});
