/** A holding's lots on a phone: the per-lot cards and the Total card under them. */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { HoldingLotCards } from '@/components/portfolio/HoldingLotCards';
import { formatCurrency } from '@/utils/formatters';
import type { PortfolioHolding } from '@/shared/types';

jest.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({ t: (key: string) => (key === 'portfolio:holdingDetail.total' ? 'Total' : key) }),
}));

const lot = (over: Partial<PortfolioHolding>): PortfolioHolding =>
  ({
    id: 'lot',
    symbol: '0050',
    quantity: 100,
    averageCost: 100,
    totalCost: 10_000,
    totalValue: 11_000,
    gainLoss: 1_000,
    gainLossPercentage: 10,
    purchaseDate: '2026-09-01',
    currency: 'TWD',
    ...over,
  }) as PortfolioHolding;

const twoLots = [lot({ id: 'a' }), lot({ id: 'b', averageCost: 120, totalCost: 12_000, gainLoss: -1_000, gainLossPercentage: -8.33 })];
const total = lot({ id: 'total', quantity: 200, averageCost: 110, totalCost: 22_000, totalValue: 22_000, gainLoss: 0, gainLossPercentage: 0 });

const show = (props: Partial<React.ComponentProps<typeof HoldingLotCards>> = {}) =>
  render(<HoldingLotCards lots={twoLots} holding={total} currency="TWD" isValueVisible {...props} />);

it('sums several lots into a Total card with the holding\'s figures', () => {
  show();
  const card = screen.getByTestId('lot-total');
  expect(card).toHaveTextContent('Total');
  expect(card).toHaveTextContent(`200 × ${formatCurrency(110, 'TWD')} → ${formatCurrency(22_000, 'TWD')}`);
});

it('has no Total card for a single lot, which would only repeat it', () => {
  show({ lots: [twoLots[0]] });
  expect(screen.queryByTestId('lot-total')).not.toBeInTheDocument();
});

it('signs the total by the holding\'s own gain, so a loss never reads "+-"', () => {
  show({ holding: { ...total, gainLoss: -50, gainLossPercentage: -0.23 } });
  const card = screen.getByTestId('lot-total');
  expect(card).toHaveTextContent(formatCurrency(-50, 'TWD'));
  expect(card).toHaveTextContent('(-0.23%)');
  expect(card.textContent).not.toMatch(/\+-|\+\(-/);
  expect(card.querySelector('.text-error-600')).not.toBeNull();
});

it('masks every figure, the Total card\'s included, when values are hidden', () => {
  show({ isValueVisible: false });
  const card = screen.getByTestId('lot-total');
  expect(card).toHaveTextContent('•••••');
  expect(card).not.toHaveTextContent(formatCurrency(22_000, 'TWD'));
  expect(screen.queryByText(/%\)/)).not.toBeInTheDocument();
});
