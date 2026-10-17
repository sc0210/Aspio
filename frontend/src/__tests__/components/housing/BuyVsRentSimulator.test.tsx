/**
 * The simulator is the page's source of truth for what a purchase costs.
 *
 * The readiness card already followed its cash figures, but the affordability
 * headline above it was priced from the module defaults, so dragging the mortgage
 * rate moved one card and not the other — two answers to the same question, on the
 * same screen. The terms travel with the derived figures now, and the page prices
 * the ceiling on them.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import en from '@/locales/en/common.json';
import {
    BuyVsRentSimulator,
    type SimulatorDerived,
} from '@/components/housing/BuyVsRentSimulator';
import { DEFAULT_BUY_VS_RENT } from '@/lib/housing';

jest.mock('@/contexts/PrivacyContext', () => ({
    usePrivacy: () => ({ isValueVisible: true }),
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

function renderSimulator() {
    const reported: SimulatorDerived[] = [];
    render(
        <I18nextProvider i18n={i18n}>
            <BuyVsRentSimulator onDerivedChange={(d) => reported.push(d)} />
        </I18nextProvider>,
    );
    // Folded by default; the sliders live inside.
    fireEvent.click(screen.getByRole('button', { name: /Buy vs\. Rent/ }));
    return { reported, latest: () => reported[reported.length - 1] };
}

const slider = (name: RegExp) => screen.getByRole('slider', { name });

describe('BuyVsRentSimulator — reported terms', () => {
    it('reports the default terms before anything is touched', () => {
        const { latest } = renderSimulator();
        expect(latest().terms).toEqual({
            downPaymentPct: DEFAULT_BUY_VS_RENT.downPaymentPct,
            buyingCostPct: DEFAULT_BUY_VS_RENT.buyingCostPct,
            ownershipCostPctPerYear: DEFAULT_BUY_VS_RENT.ownershipCostPctPerYear,
            mortgageRatePct: DEFAULT_BUY_VS_RENT.mortgageRatePct,
            mortgageTermYears: DEFAULT_BUY_VS_RENT.mortgageTermYears,
        });
    });

    it('reports a dragged mortgage rate, with the payment it produces', () => {
        const { latest } = renderSimulator();
        const before = latest();

        fireEvent.change(slider(/Mortgage rate/), { target: { value: '4' } });

        expect(latest().terms.mortgageRatePct).toBe(4);
        // A dearer loan on the same price costs more every month.
        expect(latest().monthlyPayment).toBeGreaterThan(before.monthlyPayment);
        expect(latest().terms.mortgageTermYears).toBe(before.terms.mortgageTermYears);
    });

    it('reports a dragged down payment, with the cash it takes at closing', () => {
        const { latest } = renderSimulator();
        const before = latest();

        fireEvent.change(slider(/Down payment/), { target: { value: '50' } });

        expect(latest().terms.downPaymentPct).toBe(50);
        expect(latest().upfrontCash).toBeGreaterThan(before.upfrontCash);
    });
});
