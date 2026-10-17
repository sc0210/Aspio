/** A saved /housing scenario shown as its effect on leverage; a link to /housing when none is saved. */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { HomePurchasePanel } from '@/components/lifecycle/HomePurchasePanel';
import { DEFAULT_BUY_VS_RENT } from '@/lib/housing/buyVsRent';
import { SCENARIOS_KEY } from '@/lib/housing/scenarios';
import type { Position } from '@/lib/lifecycle/leverage';

jest.mock('@/contexts/PrivacyContext', () => ({ usePrivacy: () => ({ isValueVisible: true }) }));
jest.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({
    t: (_k: string, f: string, o?: Record<string, unknown>) =>
      (typeof f === 'string' ? f : _k).replace(/\{\{(\w+)\}\}/g, (_m, n) => String(o?.[n] ?? '')),
  }),
}));

const position: Position = {
  stockExposure: 6e6, cashAssets: 2e6, investmentDebt: 3e6, netFinancialAssets: 5e6, netWorth: 5e6,
  leverage: 1.2, borrowedShare: 0.5, isUnderwater: false,
};

beforeEach(() => window.localStorage.clear());

it('links to /housing when no scenario is saved', () => {
  render(<HomePurchasePanel position={position} spendableCash={2e6} maxLeverage={2} />);
  expect(screen.getByRole('link', { name: /Open the house plan/ })).toHaveAttribute('href', '/housing');
});

it('shows the saved scenario\'s effect on leverage', () => {
  window.localStorage.setItem(SCENARIOS_KEY, JSON.stringify([
    { id: 'a', name: 'Banqiao', inputs: { ...DEFAULT_BUY_VS_RENT, housePrice: 10_000_000, downPaymentPct: 20 } },
  ]));
  render(<HomePurchasePanel position={position} spendableCash={2e6} maxLeverage={2} />);
  expect(screen.getByText(/Banqiao: .* leaves at closing/)).toBeInTheDocument();
  // 2.3M at closing (20% down + 3% costs) from 2M cash + 0.3M stock: 5.7M / 2.7M ≈ 2.11×, over the 2× ceiling.
  expect(screen.getByText('1.20× → 2.11×')).toBeInTheDocument();
  expect(screen.getByText(/over your 2× ceiling/)).toBeInTheDocument();
});


it('shows a shortfall instead of pretending the purchase is funded', () => {
  window.localStorage.setItem(SCENARIOS_KEY, JSON.stringify([
    { id: 'b', name: 'Xinyi', inputs: { ...DEFAULT_BUY_VS_RENT, housePrice: 60_000_000, downPaymentPct: 20 } },
  ]));
  render(<HomePurchasePanel position={position} spendableCash={2e6} maxLeverage={2} />);
  expect(screen.getByText("Can't fund")).toBeInTheDocument();
  expect(screen.getByText('1.20× → —')).toBeInTheDocument();
  expect(screen.queryByText(/over your/)).not.toBeInTheDocument();
  expect(screen.queryByText('Investments sold')).not.toBeInTheDocument();
});
