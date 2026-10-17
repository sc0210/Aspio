/** The spread's "earned" figure says which measure it is: TWR since inception, or the per-lot IRR average. */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { SpreadPanel } from '@/components/lifecycle/SpreadPanel';

jest.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({
    t: (_k: string, f: string, o?: Record<string, unknown>) =>
      (typeof f === 'string' ? f : _k).replace(/\{\{(\w+)\}\}/g, (_m, n) => String(o?.[n] ?? '')),
  }),
}));
jest.mock('@/contexts/PrivacyContext', () => ({ usePrivacy: () => ({ isValueVisible: true, maskValue: (v: string) => v }) }));

const base = {
  spread: { spreadPct: 34.6, annualCarry: 100000, isPositive: true, unknown: false },
  debt: { blendedRatePct: 3, balance: 3_900_000 },
  interest: { paidToDate: 0, remaining: 0, remainingOnSchedule: 0 },
  realizedReturnPct: 37.6,
} as unknown as React.ComponentProps<typeof SpreadPanel>;

it('a TWR figure is labelled as an annual return, with its basis and start date', () => {
  render(<SpreadPanel {...base} realizedReturnSource="twr" realizedReturnSince="2023-07-17" />);
  expect(screen.getByText('Annual return')).toBeInTheDocument();
  expect(screen.getByText(/Time-weighted since 2023-07-17/)).toBeInTheDocument();
  expect(screen.getByText('37.6%')).toBeInTheDocument();
});

it('the per-lot fallback keeps the IRR label and no TWR caption', () => {
  render(<SpreadPanel {...base} realizedReturnSource="lots" />);
  expect(screen.getByText('Portfolio IRR')).toBeInTheDocument();
  expect(screen.queryByText(/Time-weighted since/)).not.toBeInTheDocument();
});
