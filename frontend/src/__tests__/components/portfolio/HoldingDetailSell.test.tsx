/**
 * Sell from a holding's detail dialog sells the holding, not its first lot.
 *
 * The dialog hands the list one lot; the list used to pass that lot straight to
 * the sell dialog, which caps the quantity at what it is given. A holding of two
 * lots (10 + 5) could then sell at most 10 from here, while the row's own Sell
 * offered all 15.
 */

import React from 'react';
import { fireEvent, screen, within } from '@testing-library/react';
import { renderWithQuery as render } from '../../utils/queryWrapper';
import '@testing-library/jest-dom';
import type { Holding } from '@/components/portfolio/HoldingsList';

jest.mock('react-i18next', () => ({
    initReactI18next: { type: '3rdParty', init: jest.fn() },
    useTranslation: () => ({
        t: (key: string, opts?: Record<string, unknown>) =>
            typeof opts?.defaultValue === 'string' ? (opts.defaultValue as string) : key,
    }),
}));

import { HoldingsList } from '@/components/portfolio/HoldingsList';

const lot = (id: string, quantity: number, averageCost: number): Holding => ({
    id,
    symbol: '0050',
    name: 'Yuanta Taiwan Top 50 ETF',
    type: 'etf',
    walletType: 'portfolio',
    market: 'TW',
    quantity,
    averageCost,
    currentPrice: 150,
    totalValue: quantity * 150,
    totalCost: quantity * averageCost,
    gainLoss: quantity * (150 - averageCost),
    gainLossPercentage: 0,
    currency: 'TWD',
} as Holding);

const LOTS = [lot('lot-a', 10, 100), lot('lot-b', 5, 130)];
const ROW = { ...lot('aggregated-0050-portfolio', 15, 110), lotIds: ['lot-a', 'lot-b'] } as Holding;

it('sells the whole holding from its detail dialog', async () => {
    const onSellHolding = jest.fn();
    render(
        <HoldingsList
            isValueVisible
            filters={{}}
            onFiltersChange={() => {}}
            holdings={[ROW]}
            allHoldings={LOTS}
            onSellHolding={onSellHolding}
        />,
    );

    fireEvent.click(screen.getAllByRole('button', { name: /^Open / })[0]);
    const dialog = await screen.findByRole('dialog', {}, { timeout: 5000 });
    fireEvent.click(within(dialog).getByRole('button', { name: /sellHolding|Sell holding/ }));

    expect(onSellHolding).toHaveBeenCalledTimes(1);
    expect(onSellHolding.mock.calls[0][0]).toMatchObject({ id: 'aggregated-0050-portfolio', quantity: 15 });
});
