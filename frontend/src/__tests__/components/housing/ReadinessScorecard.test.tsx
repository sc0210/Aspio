/**
 * "Adjust my numbers" is a what-if, not a new source of truth.
 *
 * Each field the user types is pinned so it stops following their account, which
 * is the point while they are experimenting and a trap afterwards: the score kept
 * standing on typed-in figures with nothing on screen saying so, and no way back
 * short of reloading the page.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import en from '@/locales/en/common.json';
import { ReadinessScorecard, type ReadinessSeed } from '@/components/housing/ReadinessScorecard';

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

const WAN = 10_000;

const seed: ReadinessSeed = {
    debtBalance: 0,
    liquidFunds: 3_000_000,
    financialAssets: 5_000_000,
    monthlyIncome: 85_000,
    monthlyExpenses: 60_000,
};

function renderCard(over: Partial<ReadinessSeed> = {}) {
    const view = render(
        <I18nextProvider i18n={i18n}>
            <ReadinessScorecard
                seed={{ ...seed, ...over }}
                cashNeededAtPurchase={8_250_000}
                monthlyHousingCost={86_000}
                cashFlowBasisMonths={12}
            />
        </I18nextProvider>,
    );
    // The card is folded by default; everything asserted below lives inside it.
    fireEvent.click(screen.getByRole('button', { name: /Am I ready to buy\?/ }));
    return view;
}

// By its exact field label: the gauge above it carries the same words in its
// aria-label, so a loose regex matches both.
const liquidField = () =>
    screen.getByRole('spinbutton', { name: en.housing.ready.fLiquid }) as HTMLInputElement;
const resetButton = () => screen.queryByRole('button', { name: /Reset to my data/ });
const editedFlag = () => screen.queryByText(/using figures you edited/);
const refiFlag = () => screen.queryByText(/assuming the debt is refinanced/);

describe('ReadinessScorecard — adjusted figures', () => {
    it('follows the account until something is edited', () => {
        renderCard();
        expect(editedFlag()).not.toBeInTheDocument();
        expect(resetButton()).not.toBeInTheDocument();
        expect(screen.getByText(/income\/expense: 12-mo average/)).toBeInTheDocument();
    });

    it('says so, and offers a way back, once a figure is edited', () => {
        renderCard();
        fireEvent.click(screen.getByRole('button', { name: /Adjust my numbers/ }));
        fireEvent.change(liquidField(), { target: { value: '1200' } }); // 1,200萬

        expect(liquidField().value).toBe('1200');
        expect(editedFlag()).toBeInTheDocument();

        fireEvent.click(resetButton()!);
        expect(liquidField().value).toBe(String(seed.liquidFunds / WAN));
        expect(editedFlag()).not.toBeInTheDocument();
        expect(resetButton()).not.toBeInTheDocument();
    });

    it('un-pins a field typed back to the figure the account already shows', () => {
        renderCard();
        fireEvent.click(screen.getByRole('button', { name: /Adjust my numbers/ }));
        fireEvent.change(liquidField(), { target: { value: '1200' } });
        expect(editedFlag()).toBeInTheDocument();

        fireEvent.change(liquidField(), { target: { value: String(seed.liquidFunds / WAN) } });
        expect(editedFlag()).not.toBeInTheDocument();
        expect(resetButton()).not.toBeInTheDocument();
    });

    it('un-pins on the displayed figure, not the exact balance behind it', () => {
        // A real balance is never a round 萬: the field shows "300" for 3,000,417, so
        // typing 300 has to mean "as my account has it" or the field stays pinned for
        // good — which is the trap this whole affordance exists to close.
        const odd = 3_000_417;
        renderCard({ liquidFunds: odd });
        fireEvent.click(screen.getByRole('button', { name: /Adjust my numbers/ }));
        expect(liquidField().value).toBe('300');

        fireEvent.change(liquidField(), { target: { value: '1200' } });
        expect(editedFlag()).toBeInTheDocument();

        fireEvent.change(liquidField(), { target: { value: '300' } });
        expect(editedFlag()).not.toBeInTheDocument();
        expect(resetButton()).not.toBeInTheDocument();
    });

    it('calls the refinanced tick a scenario, not an edited figure, and clears it on reset', () => {
        // With no debt to refinance the tick changes no figure, so claiming the score
        // stands on typed-in numbers would be wrong — it is an assumption, and says so.
        renderCard();
        fireEvent.click(screen.getByRole('button', { name: /Adjust my numbers/ }));
        const refi = screen.getByRole('checkbox', { name: /Debt refinanced to a low rate/ });
        fireEvent.click(refi);

        expect(refi).toBeChecked();
        expect(refiFlag()).toBeInTheDocument();
        expect(editedFlag()).not.toBeInTheDocument();

        fireEvent.click(resetButton()!);
        expect(refi).not.toBeChecked();
        expect(refiFlag()).not.toBeInTheDocument();
    });

    it('discloses both assumptions when both are in play', () => {
        renderCard({ debtBalance: 1_200_000 });
        fireEvent.click(screen.getByRole('button', { name: /Adjust my numbers/ }));
        fireEvent.change(liquidField(), { target: { value: '1200' } });
        fireEvent.click(screen.getByRole('checkbox', { name: /Debt refinanced to a low rate/ }));

        // The score stands on an edited figure AND a refinance that has not happened.
        expect(editedFlag()).toBeInTheDocument();
        expect(refiFlag()).toBeInTheDocument();
    });

    it('keeps focus in the header when the reset button removes itself', () => {
        renderCard();
        const adjust = screen.getByRole('button', { name: /Adjust my numbers/ });
        fireEvent.click(adjust);
        fireEvent.change(liquidField(), { target: { value: '1200' } });

        fireEvent.click(resetButton()!);
        // The button that was just activated is gone; focus must not fall to <body>.
        expect(document.activeElement).toBe(screen.getByRole('button', { name: /Done|Adjust my numbers/ }));
    });
});
