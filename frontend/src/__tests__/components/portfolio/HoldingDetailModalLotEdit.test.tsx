/**
 * Editing a lot's total cost and current value in the holding modal.
 *
 * A USD lending position (USDT-LEND) could not record interest: the lot row
 * offered quantity and average cost, while its total cost and current value
 * were read-only, and nothing anywhere set the price of a holding no feed
 * prices. The row now takes both totals, and a current value only where the
 * holding is manually priced: on a quoted holding the next price refresh would
 * overwrite it, and the backend refuses it.
 *
 * Real i18next rather than the key-echoing stub, so the inputs are found by the
 * labels a reader sees.
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { HoldingDetailModal } from '@/components/portfolio/HoldingDetailModal';
import en from '@/locales/en/portfolio.json';

jest.mock('react-hot-toast', () => ({
    __esModule: true,
    default: { success: jest.fn(), error: jest.fn() },
}));

const i18n = i18next.createInstance();
i18n.use(initReactI18next).init({
    lng: 'en',
    ns: ['portfolio'],
    defaultNS: 'portfolio',
    resources: { en: { portfolio: en } },
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
});

const lot = (overrides: Record<string, unknown>) => ({
    id: 'lot-1',
    symbol: 'USDT-LEND',
    name: 'Bitfinex Lending USD',
    quantity: 10688.88,
    averageCost: 1,
    currentPrice: 1,
    totalValue: 10688.88,
    totalCost: 10688.88,
    gainLoss: 0,
    gainLossPercentage: 0,
    currency: 'USD',
    purchaseDate: '2026-01-01T00:00:00Z',
    ...overrides,
});

const open = (holding: ReturnType<typeof lot>) => {
    const onUpdateLot = jest.fn().mockResolvedValue(undefined);
    render(
        <I18nextProvider i18n={i18n}>
            <HoldingDetailModal
                holdings={[holding]}
                symbol={holding.symbol}
                isValueVisible
                onClose={jest.fn()}
                onUpdateLot={onUpdateLot}
            />
        </I18nextProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Edit lot' }));
    return onUpdateLot;
};

describe('HoldingDetailModal lot editing', () => {
    it('saves a typed total cost and current value on a manually priced holding', async () => {
        const onUpdateLot = open(lot({ manuallyPriced: true }));

        fireEvent.change(screen.getByLabelText(en.fields.totalCost), { target: { value: '10000' } });
        fireEvent.change(screen.getByLabelText(en.fields.currentValue), { target: { value: '10712.34' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));

        await waitFor(() => expect(onUpdateLot).toHaveBeenCalledTimes(1));
        const [lotId, updates] = onUpdateLot.mock.calls[0];
        expect(lotId).toBe('lot-1');
        expect(updates.quantity).toBe(10688.88);
        expect(updates.quantity * updates.averageCost).toBeCloseTo(10000, 6);
        expect(updates.quantity * updates.currentPrice).toBeCloseTo(10712.34, 6);
    });

    it('shows gain from the typed figures before saving', () => {
        open(lot({ manuallyPriced: true }));

        fireEvent.change(screen.getByLabelText(en.fields.totalCost), { target: { value: '10000' } });

        // 10,688.88 value against 10,000 cost, in the row being edited.
        expect(screen.getAllByText('+$688.88').length).toBeGreaterThan(0);
    });

    it('offers no current value, and sends no price, on a quoted holding', async () => {
        const onUpdateLot = open(lot({ symbol: 'AAPL', name: 'Apple', manuallyPriced: false }));

        expect(screen.queryByLabelText(en.fields.currentValue)).not.toBeInTheDocument();
        // Total cost is still editable: what you paid is yours to correct anywhere.
        fireEvent.change(screen.getByLabelText(en.fields.totalCost), { target: { value: '9000' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));

        await waitFor(() => expect(onUpdateLot).toHaveBeenCalledTimes(1));
        const updates = onUpdateLot.mock.calls[0][1];
        expect(updates).not.toHaveProperty('currentPrice');
        expect(updates.quantity * updates.averageCost).toBeCloseTo(9000, 6);
    });
});
