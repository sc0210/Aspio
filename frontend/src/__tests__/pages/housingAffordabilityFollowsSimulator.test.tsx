/**
 * One page, one answer about the same mortgage.
 *
 * The readiness card followed the simulator's cash figures while the affordability
 * headline above it was priced from the module defaults, so dragging the mortgage
 * rate moved the card and left the headline quoting a 2.1% loan — two answers to
 * the same question, on the same screen, with a comment claiming they agreed.
 */

import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import en from '@/locales/en/common.json';
import HousingPage from '@/app/housing/page';

jest.mock('next/navigation', () => ({
    useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
}));
jest.mock('@/contexts/PrivacyContext', () => ({
    usePrivacy: () => ({ isValueVisible: true }),
}));
jest.mock('@/components/layout/DashboardLayout', () => ({
    DashboardLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
jest.mock('@/hooks/useAppMode', () => ({
    useAppMode: () => ({ isAuthenticated: true, isDemo: false, isLoading: false }),
}));
// Deliberately not round: a real balance never is, and the 萬 fields round it.
// Rich by default, so the monthly budget is what limits the price and a dearer
// mortgage shows up in the headline. `RICH`/`MODEST` pick which limit binds.
const RICH = 20_000_417;
const MODEST = 3_000_417;
const mockAccount = { liquid: RICH, assets: RICH };
jest.mock('@/hooks/useOptimizedDashboard', () => ({
    useOptimizedDashboard: () => ({
        data: {
            data: {
                stats: {
                    total_debt: 0,
                    life_wallet: mockAccount.liquid,
                    portfolio_wallet: 0,
                    total_asset: mockAccount.assets,
                    monthlyIncome: 0,
                    monthlyExpenses: 0,
                },
            },
        },
        isLoading: false,
    }),
}));
// A household with real room to borrow, so the ceiling is a number that can move.
jest.mock('@/hooks/useAnnualCashFlow', () => ({
    useAnnualCashFlow: () => ({
        avgMonthlyIncome: 150_000,
        avgMonthlyExpense: 60_000,
        monthsAveraged: 12,
        hasData: true,
        isLoading: false,
    }),
}));

const i18n = i18next.createInstance();
i18n.use(initReactI18next).init({
    lng: 'en',
    fallbackLng: 'en',
    ns: ['common'],
    defaultNS: 'common',
    resources: { en: { common: en } },
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
});

/** The headline figure, e.g. "NT$12.4M", as a number of NT$. */
function comfortablePrice(): number {
    const label = screen.getByText(/Comfortable price today/);
    const shown = within(label.parentElement as HTMLElement).getAllByText(/NT\$/)[0].textContent ?? '';
    const [, digits, suffix] = shown.match(/NT\$([\d.]+)([MK]?)/) ?? [];
    const scale = suffix === 'M' ? 1_000_000 : suffix === 'K' ? 1_000 : 1;
    return Number(digits) * scale;
}

/**
 * The affordability panel carries its own copy of these sliders, so once its fold is
 * open the page holds two. The simulator's are the ones rendered last.
 */
const simulatorSlider = (name: RegExp) => {
    const all = screen.getAllByRole('slider', { name });
    return all[all.length - 1];
};

/** The affordability panel's own copy — rendered first, above the simulator. */
const panelSlider = (name: RegExp) => screen.getAllByRole('slider', { name })[0];

describe('/housing — the headline and the simulator price the same loan', () => {
    beforeEach(() => {
        mockAccount.liquid = RICH;
        mockAccount.assets = RICH;
    });

    it('re-prices the affordable ceiling when the mortgage rate is dragged', () => {
        render(
            <I18nextProvider i18n={i18n}>
                <HousingPage />
            </I18nextProvider>,
        );

        const atDefaultRate = comfortablePrice();
        expect(atDefaultRate).toBeGreaterThan(0);

        // Open the simulator and make borrowing dearer.
        fireEvent.click(screen.getByRole('button', { name: /Buy vs\. Rent/ }));
        fireEvent.change(simulatorSlider(/Mortgage rate/), { target: { value: '5.5' } });

        // The same monthly budget buys less house at 5.5% than at 2.1%.
        expect(comfortablePrice()).toBeLessThan(atDefaultRate);
    });

    it('keeps following the simulator after an unrelated field is edited here', () => {
        // A whole-object override used to snapshot the loan terms as a side effect of
        // editing anything at all, so touching "monthly income" quietly pinned the
        // mortgage rate and the headline stopped following the slider again.
        render(
            <I18nextProvider i18n={i18n}>
                <HousingPage />
            </I18nextProvider>,
        );

        fireEvent.click(screen.getByRole('button', { name: /Try a different situation/ }));
        fireEvent.change(screen.getByRole('spinbutton', { name: /Monthly income/ }), {
            target: { value: '200000' },
        });
        const afterEdit = comfortablePrice();

        fireEvent.click(screen.getByRole('button', { name: /Buy vs\. Rent/ }));
        fireEvent.change(simulatorSlider(/Mortgage rate/), { target: { value: '5.5' } });

        expect(comfortablePrice()).toBeLessThan(afterEdit);
    });

    it('un-pins a 萬 field typed back to the balance the account actually holds', () => {
        // Assets are edited in 萬, so the field can only ever hand back a round 萬 —
        // never the account's own 3,000,417. Comparing raw values meant the field
        // stayed pinned for good once touched, and silently stopped following the
        // account. What proves it un-pinned is that a later balance change flows in.
        mockAccount.liquid = MODEST;
        mockAccount.assets = MODEST;
        const { rerender } = render(
            <I18nextProvider i18n={i18n}>
                <HousingPage />
            </I18nextProvider>,
        );

        const atAccountAssets = comfortablePrice();
        fireEvent.click(screen.getByRole('button', { name: /Try a different situation/ }));
        const assets = screen.getByRole('spinbutton', { name: /Financial assets/ });
        expect(assets).toHaveValue(300); // 3,000,417 shown as 300萬

        fireEvent.change(assets, { target: { value: '100' } });
        expect(comfortablePrice()).toBeLessThan(atAccountAssets);

        // Typed back to what the account shows.
        fireEvent.change(assets, { target: { value: '300' } });
        expect(comfortablePrice()).toBe(atAccountAssets);

        // The account grows: an un-pinned field follows it, a pinned one does not.
        mockAccount.assets = 40_000_000;
        mockAccount.liquid = 40_000_000;
        rerender(
            <I18nextProvider i18n={i18n}>
                <HousingPage />
            </I18nextProvider>,
        );
        expect(comfortablePrice()).toBeGreaterThan(atAccountAssets);
    });

    it('honours a sub-1% move of its own mortgage-rate slider', () => {
        // That slider steps in 0.05. Comparing the new value against the live one at a
        // precision of 1 made 2.1 → 2.3 look like "back to my data", so the override was
        // dropped, the slider snapped back and the headline never moved.
        render(
            <I18nextProvider i18n={i18n}>
                <HousingPage />
            </I18nextProvider>,
        );

        const atDefault = comfortablePrice();
        fireEvent.click(screen.getByRole('button', { name: /Try a different situation/ }));
        const rate = panelSlider(/Mortgage rate/);
        expect(rate).toHaveValue('2.1');

        fireEvent.change(rate, { target: { value: '2.3' } });

        expect(rate).toHaveValue('2.3');
        expect(comfortablePrice()).toBeLessThan(atDefault);

        // And dragged back onto the live rate, it lets go again — the price alone
        // cannot show that (an override pinned AT the live value prices the same),
        // so this asserts the panel is no longer holding anything.
        fireEvent.change(rate, { target: { value: '2.1' } });
        expect(comfortablePrice()).toBe(atDefault);
        expect(screen.queryByRole('button', { name: /Reset to my data/ })).not.toBeInTheDocument();
    });

    it('re-prices it when the down payment is dragged', () => {
        render(
            <I18nextProvider i18n={i18n}>
                <HousingPage />
            </I18nextProvider>,
        );

        const atDefault = comfortablePrice();
        fireEvent.click(screen.getByRole('button', { name: /Buy vs\. Rent/ }));
        fireEvent.change(simulatorSlider(/Down payment/), { target: { value: '10' } });

        // Borrowing more of the price makes the monthly cost, not the cash, the limit.
        expect(comfortablePrice()).not.toBe(atDefault);
    });
});
