/**
 * What the lot editor does with a purchase date.
 *
 * `purchaseDate` is a stored instant. The lot row renders it with
 * `toLocaleDateString()` — the viewer's day — while the edit prefill used
 * `toISOString().split('T')[0]`, the UTC day. Those are different days for anything
 * bought after 16:00 UTC in Taipei, so opening the editor showed one date in the
 * input and another in the row it came from.
 *
 * And Save sent `purchaseDate` whatever the user had come to change, so correcting a
 * share count moved the purchase — and the backend, which re-dates the linked Life
 * Wallet expense to match, moved the expense with it, across a month boundary for
 * anything bought near the 1st.
 *
 * Two fixes, and only one of them is about the prefill. The app's business day is
 * fixed at Asia/Taipei, a date input is read in whatever zone the device is in, and
 * the user travels (the Pi is reachable off-LAN over Tailscale) — so NO prefill is
 * right for every viewer, and re-sending an untouched one is a date change at any
 * other offset. The editor therefore sends a date only when the user changed it,
 * which needs no assumption about the viewer's zone at all.
 *
 * On the runner's timezone: setting TZ from inside a jsdom test is inert, and this
 * machine happens to be Asia/Taipei, so a hard-coded day here would have passed
 * locally for the wrong reason and gone red on CI, which runs UTC. The suite is now
 * pinned to Asia/Taipei in jest.global-setup.js, where it does take effect, so the
 * days below are deterministic everywhere — with a precondition that fails loudly if
 * that pin ever stops working, rather than quietly losing its teeth.
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
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

// 2026-08-31T20:00Z: 09-01 04:00 in Taipei, where such a purchase was booked, and
// 08-31 in UTC. A stamp whose UTC day and business day fall in different months.
const PURCHASE = '2026-08-31T20:00:00Z';

const localDay = (iso: string) => {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const utcDay = (iso: string) => new Date(iso).toISOString().slice(0, 10);

const lot = {
    id: 'lot-1',
    symbol: '0050',
    name: 'Yuanta Taiwan Top 50',
    quantity: 100,
    averageCost: 100,
    currentPrice: 100,
    totalValue: 10000,
    totalCost: 10000,
    gainLoss: 0,
    gainLossPercentage: 0,
    currency: 'TWD',
    purchaseDate: PURCHASE,
};

const openEditor = () => {
    const onUpdateLot = jest.fn().mockResolvedValue(undefined);
    render(
        <I18nextProvider i18n={i18n}>
            <HoldingDetailModal
                holdings={[lot]}
                symbol={lot.symbol}
                isValueVisible
                onClose={jest.fn()}
                onUpdateLot={onUpdateLot}
            />
        </I18nextProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Edit lot' }));
    return onUpdateLot;
};

describe('the lot editor and the purchase date', () => {
    it('sends no date at all when the user edits something else', async () => {
        const onUpdateLot = openEditor();

        fireEvent.change(screen.getByLabelText(en.fields.quantity), { target: { value: '110' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));

        await screen.findByRole('button', { name: 'Edit lot' });
        expect(onUpdateLot).toHaveBeenCalledTimes(1);
        // The heart of it, and true at every offset. A date the user never touched
        // cannot be re-sent: the backend compares it against a business day in
        // Asia/Taipei, so from a device at another offset the round trip would
        // itself read as a date change and move the Life Wallet expense.
        expect(onUpdateLot.mock.calls[0][1]).not.toHaveProperty('purchaseDate');
    });

    it('sends the date when the user does change it', async () => {
        const onUpdateLot = openEditor();

        fireEvent.change(screen.getByLabelText(en.fields.purchaseDate), {
            target: { value: '2026-09-05' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));

        await screen.findByRole('button', { name: 'Edit lot' });
        expect(onUpdateLot.mock.calls[0][1].purchaseDate).toBe('2026-09-05');
    });

    it('runs where the two readings differ, or it proves nothing', () => {
        // The precondition for the test below. Where an instant's local day equals
        // its UTC day — at UTC+0, or at any offset that does not straddle midnight
        // for this stamp — the fixed prefill and the toISOString() one it replaced
        // give the same answer, and no assertion can tell them apart. The pin in
        // jest.global-setup.js is what guarantees they differ, so if it ever stops
        // taking effect this fails instead of the next test going quietly toothless.
        expect(localDay(PURCHASE)).toBe('2026-09-01');
        expect(utcDay(PURCHASE)).toBe('2026-08-31');
    });

    it('prefills the day the row beside it is showing, not the UTC day', () => {
        openEditor();

        // The row renders toLocaleDateString(), so the input has to be the same day.
        expect(screen.getByLabelText(en.fields.purchaseDate)).toHaveValue('2026-09-01');
    });
});
