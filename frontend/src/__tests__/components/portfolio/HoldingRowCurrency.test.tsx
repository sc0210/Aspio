/**
 * A holding priced in another currency, shown in the account's currency too.
 *
 * The rule that matters is the negative one: when a rate cannot be had, the row
 * shows the native figure alone. It does NOT reach for the static table in
 * `utils/formatters.ts` (`USD: 31.5`, which is 8% out on EUR and 6% on SGD
 * against live rates), and it does not fall back to 1 — the endpoint used to
 * report parity for unpriceable pairs, which converts a USD position at 1:1 and
 * understates it about 31-fold.
 *
 * A wrong converted number is worse than no converted number, because the
 * native figure is at least interpretable.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { Holding } from '@/components/portfolio/HoldingsList';

jest.mock('react-i18next', () => ({
    initReactI18next: { type: '3rdParty', init: jest.fn() },
    useTranslation: () => ({
        t: (key: string, opts?: Record<string, unknown>) =>
            typeof opts?.defaultValue === 'string' ? (opts.defaultValue as string) : key,
    }),
}));

// The list is what decides whether a holding gets a rate at all. Stub the fetch
// so the test drives that decision, not the network.
jest.mock('@/hooks/useExchangeRates', () => ({
    useExchangeRates: () => ({
        rateFor: (currency?: string) =>
            currency?.toUpperCase() === 'USD' ? 31.631 : undefined,
    }),
}));

import { HoldingRow } from '@/components/portfolio/HoldingRow';
import { HoldingCardMobile } from '@/components/portfolio/HoldingCardMobile';
import { HoldingsList } from '@/components/portfolio/HoldingsList';

const usdHolding: Holding = {
    id: 'h1',
    symbol: 'VT',
    name: 'Vanguard Total World',
    type: 'etf',
    walletType: 'portfolio',
    market: 'US',
    quantity: 10,
    averageCost: 90,
    currentPrice: 100,
    totalValue: 1000,
    totalCost: 900,
    gainLoss: 100,
    gainLossPercentage: 11.1,
    currency: 'USD',
    exchange: 'NYSE',
    lastUpdated: new Date(),
};

const base = {
    holding: usdHolding,
    isSelected: false,
    isValueVisible: true,
    bulkEditMode: false,
    lotCount: 1,
    onToggleSelect: () => {},
    onOpen: () => {},
};

const inTable = (props: React.ComponentProps<typeof HoldingRow>) => (
    <table><tbody><HoldingRow {...props} /></tbody></table>
);

describe('a holding priced in another currency', () => {
    it('shows the base-currency equivalent beneath the native value', () => {
        render(inTable({ ...base, baseRate: 31.631, baseCurrency: 'TWD' }));

        // 1000 USD at 31.631 — the live rate, not the static table's 31.5.
        expect(screen.getByText(/≈/)).toBeInTheDocument();
        expect(screen.getByText(/31,631|31,631\.00/)).toBeInTheDocument();
    });

    it('shows nothing extra when the pair could not be priced', () => {
        // `baseRate` undefined is what `rateFor` returns for a currency the
        // server listed as unavailable. The row must not invent one.
        render(inTable({ ...base, baseRate: undefined, baseCurrency: 'TWD' }));

        expect(screen.queryByText(/≈/)).not.toBeInTheDocument();
        // And certainly not the 1:1 the endpoint used to report.
        expect(screen.queryByText(/NT\$1,000/)).not.toBeInTheDocument();
    });

    it('adds no second line for a holding already in the base currency', () => {
        // The list passes undefined for these rather than a rate of 1, so the
        // row never renders "NT$500 ≈ NT$500".
        render(inTable({
            ...base,
            holding: { ...usdHolding, currency: 'TWD', totalValue: 500 },
            baseRate: undefined,
        }));

        expect(screen.queryByText(/≈/)).not.toBeInTheDocument();
    });

    it('hides the converted figure when values are masked', () => {
        render(inTable({ ...base, baseRate: 31.631, isValueVisible: false }));
        expect(screen.queryByText(/≈/)).not.toBeInTheDocument();
    });
});

describe('the phone card follows the same rule', () => {
    // Shipped desktop-only the first time, which is the fourth instance of that
    // in this area — hence a test that names the surface rather than trusting
    // the two to stay in step.
    const card = {
        holding: usdHolding,
        isSelected: false,
        isValueVisible: true,
        bulkEditMode: false,
        lotCount: 1,
        onSelect: () => {},
        onToggleSelect: () => {},
    };

    it('shows the base-currency equivalent', () => {
        render(<HoldingCardMobile {...card} baseRate={31.631} baseCurrency="TWD" />);
        expect(screen.getByText(/≈/)).toBeInTheDocument();
    });

    it('shows nothing extra when the pair could not be priced', () => {
        render(<HoldingCardMobile {...card} baseRate={undefined} baseCurrency="TWD" />);
        expect(screen.queryByText(/≈/)).not.toBeInTheDocument();
    });
});

describe('the list decides which holdings get a converted line', () => {
    /**
     * The leaf components are covered above with hand-fed props. This covers the
     * wiring that computes them — `currency === base ? undefined : rateFor(...)`
     * — which is where the desktop/phone split actually lives, and where this
     * area has broken silently four times.
     */
    const twdHolding: Holding = {
        ...usdHolding, id: 'h2', symbol: '0050', name: 'Yuanta 50',
        currency: 'TWD', exchange: 'TWSE', market: 'TW', totalValue: 500,
    };

    it('converts the foreign holding and leaves the local one alone', () => {
        const { container } = render(
            <HoldingsList
                holdings={[usdHolding, twdHolding]}
                allHoldings={[usdHolding, twdHolding]}
                isValueVisible
                // Required by the props type. Nothing type-checks this file —
                // tsconfig excludes __tests__ — so these are passed because
                // they are part of the contract, not because a compiler asked.
                filters={{} as never}
                onFiltersChange={() => {}}
            />,
        );

        const approx = [...container.querySelectorAll('*')]
            .filter((el) => el.children.length === 0 && el.textContent?.includes('≈'))
            .map((el) => el.textContent!.trim());

        // Exactly one per surface — the desktop row AND the phone card. The
        // first version of this asserted `> 0`, which the desktop row satisfies
        // on its own, so removing the mobile wiring still passed. That is the
        // regression this test exists for, so it has to count.
        expect(approx).toHaveLength(2);
        expect(approx.every((t) => /NT\$/.test(t))).toBe(true);
        // Nothing for the TWD holding — no "NT$500 ≈ NT$500".
        expect(approx.some((t) => t.includes('500'))).toBe(false);
    });
});
