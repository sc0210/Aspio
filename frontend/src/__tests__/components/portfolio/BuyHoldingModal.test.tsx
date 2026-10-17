/**
 * The buy summary's share line, rendered through real i18next.
 *
 * `buy.sharesTimesPrice` exists only as `_one`/`_other`. i18next enables plural
 * handling only when `count` is not a string (`needsPluralHandling = opt.count
 * !== undefined && !isString(opt.count)`), so passing the raw `quantity` input
 * string skipped the plural lookup, fell through to a bare `sharesTimesPrice`
 * that neither bundle defines, and rendered the key name under the total — in
 * both languages, on every purchase.
 *
 * This is deliberately not using the key-echoing `useTranslation` stub the other
 * component tests share. Under that stub `t()` returns the key for correct and
 * broken code alike, so the defect is invisible to it. The real bundles are
 * wired up instead, and the assertions are on what the reader sees.
 */

import React from 'react';
import { act, render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { BuyHoldingModal } from '@/components/portfolio/BuyHoldingModal';
import en from '@/locales/en/portfolio.json';
import zhTW from '@/locales/zh-TW/portfolio.json';

jest.mock('@/services/symbolService', () => ({
    __esModule: true,
    default: { searchSymbols: jest.fn().mockResolvedValue([]) },
}));

const BUNDLES = { en, 'zh-TW': zhTW };
type Lang = keyof typeof BUNDLES;

const instance = (lng: Lang) => {
    const i18n = i18next.createInstance();
    i18n.use(initReactI18next).init({
        lng,
        fallbackLng: 'en',
        ns: ['portfolio'],
        defaultNS: 'portfolio',
        resources: { en: { portfolio: en }, 'zh-TW': { portfolio: zhTW } },
        interpolation: { escapeValue: false },
        react: { useSuspense: false },
    });
    return i18n;
};

/**
 * Open the dialog, leave the search step, and enter a quantity and a price.
 *
 * Headless UI portals the dialog out of the render container, so everything is
 * queried off the document.
 */
const openWith = async (lng: Lang, quantity: string) => {
    const { buy } = BUNDLES[lng];

    render(
        <I18nextProvider i18n={instance(lng)}>
            <BuyHoldingModal isOpen onClose={jest.fn()} onBuy={jest.fn()} />
        </I18nextProvider>,
    );

    fireEvent.click(screen.getByText(buy.manualEntry));
    fireEvent.change(screen.getByLabelText(buy.field.quantity), { target: { value: quantity } });
    fireEvent.change(screen.getByLabelText(buy.field.price), { target: { value: '100' } });

    // Headless UI settles its focus management a microtask after the dialog
    // opens; flush it here so the update lands inside act().
    await act(async () => {});
};

/**
 * The one line under the total. Read as its own element rather than off the
 * body, whose text runs the fields together — "NT$250.00" and "2.5 shares"
 * abut with nothing between them.
 */
const shareLine = async (lng: Lang, quantity: string): Promise<string> => {
    await openWith(lng, quantity);
    return screen.getByText(/×/).textContent ?? '';
};

describe('BuyHoldingModal cost summary', () => {
    it.each([
        ['1', '1 share × NT$100.00'],
        ['3', '3 shares × NT$100.00'],
        // A fractional quantity is `other` in English, and buying 2.5 shares of
        // an ETF is ordinary here.
        ['2.5', '2.5 shares × NT$100.00'],
    ])('English renders the share line for a quantity of %s', async (quantity, expected) => {
        expect(await shareLine('en', quantity)).toBe(expected);
    });

    it('Chinese renders its own share line, not the English fallback', async () => {
        // zh-TW carries only `_other` — the one cardinal category Chinese has —
        // so a count of 1 must still resolve within the zh-TW bundle.
        expect(await shareLine('zh-TW', '1')).toBe('1 股 × NT$100.00');
    });

    it.each(['en', 'zh-TW'] as Lang[])('never renders the raw key at the reader in %s', async (lng) => {
        await openWith(lng, '3');
        expect(document.body).not.toHaveTextContent('sharesTimesPrice');
    });
});
