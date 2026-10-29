/**
 * Deleting a lot from the holding modal goes through the in-app confirm.
 *
 * It used window.confirm until 2026-10-29. The confirm now opens inside this
 * modal, so Escape must cancel the delete without closing the modal too.
 * Real i18next in zh-TW, so a key missing from that locale shows up as its
 * English fallback and fails here.
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { HoldingDetailModal } from '@/components/portfolio/HoldingDetailModal';
import zh from '@/locales/zh-TW/portfolio.json';
import commonZh from '@/locales/zh-TW/common.json';

jest.mock('react-hot-toast', () => ({
    __esModule: true,
    default: { success: jest.fn(), error: jest.fn() },
}));

const i18n = i18next.createInstance();
i18n.use(initReactI18next).init({
    lng: 'zh-TW',
    ns: ['portfolio', 'common'],
    defaultNS: 'portfolio',
    resources: { 'zh-TW': { portfolio: zh, common: commonZh } },
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
});

const lot = (id: string) => ({
    id,
    symbol: '0050',
    name: 'Yuanta Taiwan 50',
    quantity: 100,
    averageCost: 150,
    currentPrice: 160,
    totalValue: 16000,
    totalCost: 15000,
    gainLoss: 1000,
    gainLossPercentage: 6.67,
    currency: 'TWD',
    purchaseDate: '2026-01-01T00:00:00Z',
});

const open = () => {
    const onDeleteLot = jest.fn().mockResolvedValue(undefined);
    const onClose = jest.fn();
    render(
        <I18nextProvider i18n={i18n}>
            <HoldingDetailModal
                holdings={[lot('lot-1'), lot('lot-2')]}
                symbol="0050"
                isValueVisible
                onClose={onClose}
                onDeleteLot={onDeleteLot}
            />
        </I18nextProvider>,
    );
    fireEvent.click(screen.getAllByRole('button', { name: zh.holdingModal.deleteLot })[0]);
    return { onDeleteLot, onClose };
};

describe('HoldingDetailModal lot delete', () => {
    beforeEach(() => {
        // useDialog defers its initial focus by a frame
        jest.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
            cb(0);
            return 0;
        });
    });
    afterEach(() => jest.restoreAllMocks());

    it('deletes the lot only once the confirm is accepted', async () => {
        const { onDeleteLot, onClose } = open();
        expect(onDeleteLot).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: commonZh.common.delete }));

        await waitFor(() => expect(onDeleteLot).toHaveBeenCalledWith('lot-1'));
        expect(onClose).not.toHaveBeenCalled();
        // focus stays inside the holding modal rather than on the deleted row's button
        await waitFor(() => expect(document.activeElement?.getAttribute('role')).toBe('dialog'));
    });

    it('cancels on Escape without deleting or closing the holding modal', () => {
        const { onDeleteLot, onClose } = open();
        expect(screen.getByRole('heading', { name: zh.holdingDelete.lotTitle })).toBeInTheDocument();

        fireEvent.keyDown(document, { key: 'Escape' });

        expect(screen.queryByRole('heading', { name: zh.holdingDelete.lotTitle })).not.toBeInTheDocument();
        expect(onDeleteLot).not.toHaveBeenCalled();
        expect(onClose).not.toHaveBeenCalled();
    });
});
