import React from 'react';
import { render, screen } from '@testing-library/react';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import commonEn from '@/locales/en/common.json';
import CompareStatCards from '@/components/compare/CompareStatCards';
import type { PeerStatCard } from '@/shared/types';

// Real i18n with the en bundle, so a missing key fails here rather than
// rendering its English fallback (see the i18n fallback note in memory).
i18n.use(initReactI18next).init({
  lng: 'en',
  fallbackLng: 'en',
  ns: ['common'],
  defaultNS: 'common',
  resources: { en: { common: commonEn } },
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

const card = (totals: Partial<PeerStatCard['wallet_totals']> = {}): PeerStatCard => ({
  user_id: 'u1',
  username: 'me',
  name: 'Me',
  avatar_url: null,
  is_self: true,
  wallet_totals: {
    portfolio_total: 7_000_000,
    emergency_total: 560_000,
    cash_total: 0,
    life_total: 1_000_000,
    debt_total: 3_800_000,
    net_worth: 4_760_000,
    ...totals,
  },
});

const row = (label: string) => screen.getByText(label).parentElement as HTMLElement;

describe('CompareStatCards', () => {
  it('lists debt as a deduction above a net worth that is net of it', () => {
    render(<CompareStatCards users={[card()]} currency="TWD" />);

    expect(commonEn.compare.statDebt).toBe('Debt');
    expect(row('Debt')).toHaveTextContent(/-NT\$3,800,000/);
    expect(row('Net Worth')).toHaveTextContent(/NT\$4,760,000/);
  });

  it('shows no debt as a plain zero', () => {
    render(<CompareStatCards users={[card({ debt_total: 0, net_worth: 8_560_000 })]} currency="TWD" />);

    expect(row('Debt')).toHaveTextContent(/NT\$0/);
    expect(row('Debt').textContent).not.toContain('-');
  });
});
