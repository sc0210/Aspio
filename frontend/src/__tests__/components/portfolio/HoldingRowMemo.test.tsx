/**
 * The holding row stops re-rendering when nothing about it changed, and the
 * badge helpers stay in one place.
 *
 * `renderHoldingRow` was a function returning JSX — which reads like a
 * component but is not one: calling it inlines the elements into the parent's
 * render, so React had no boundary to skip and every row re-rendered whenever
 * anything in the list moved, each with its own sparkline. There is no React
 * Compiler in this project, so the boundary has to be drawn by hand, and the
 * memo is only as good as the props it is given.
 *
 * Renders are counted through `getMarketBadge`, which every row calls exactly
 * once — a real call the component already makes, rather than instrumentation
 * added for the test.
 */

import React from 'react';
import { fireEvent } from '@testing-library/react';
// Components here call useQuery; react-query is no longer stubbed globally,
// so they need a real client. renderWithQuery supplies one per test.
import { renderWithQuery as render } from '../../utils/queryWrapper';
import '@testing-library/jest-dom';
import type { Holding } from '@/components/portfolio/HoldingsList';

const mockGetMarketBadge = jest.fn();
jest.mock('@/components/portfolio/holdingRowStyles', () => {
    const actual = jest.requireActual('@/components/portfolio/holdingRowStyles');
    return {
        ...actual,
        getMarketBadge: (...args: unknown[]) => {
            mockGetMarketBadge(...args);
            return actual.getMarketBadge(...args);
        },
    };
});

jest.mock('react-i18next', () => ({
    initReactI18next: { type: '3rdParty', init: jest.fn() },
    useTranslation: () => ({
        t: (key: string, opts?: Record<string, unknown>) =>
            typeof opts?.defaultValue === 'string' ? (opts.defaultValue as string) : key,
    }),
}));

import { HoldingRow } from '@/components/portfolio/HoldingRow';
import { HoldingsList } from '@/components/portfolio/HoldingsList';
import { HoldingCardMobile } from '@/components/portfolio/HoldingCardMobile';

const holding: Holding = {
    id: 'h1',
    symbol: '0050',
    name: 'Yuanta Taiwan Top 50 ETF',
    type: 'etf',
    walletType: 'portfolio',
    market: 'TW',
    quantity: 100,
    averageCost: 100,
    currentPrice: 120,
    totalValue: 12000,
    totalCost: 10000,
    gainLoss: 2000,
    gainLossPercentage: 20,
    currency: 'TWD',
    exchange: 'TWSE',
    lastUpdated: new Date(),
};

const PROPS = {
    holding,
    isSelected: false,
    isValueVisible: true,
    bulkEditMode: false,
    lotCount: 1,
    onToggleSelect: () => {},
    onOpen: () => {},
};

/** The row is a <tr>; it needs a table around it to be valid markup. */
const inTable = (props: React.ComponentProps<typeof HoldingRow>) => (
    <table><tbody><HoldingRow {...props} /></tbody></table>
);

describe('HoldingRow re-rendering', () => {
    beforeEach(() => mockGetMarketBadge.mockClear());

    it('renders once for one mount', () => {
        render(inTable(PROPS));
        expect(mockGetMarketBadge).toHaveBeenCalledTimes(1);
    });

    it('skips a re-render when handed identical props', () => {
        const { rerender } = render(inTable(PROPS));
        rerender(inTable(PROPS));
        rerender(inTable(PROPS));

        // Without the memo this would be 3. That is the whole point: the parent
        // re-renders constantly — price ticks, filters, one checkbox — and none
        // of it reaches a row whose own inputs did not move.
        expect(mockGetMarketBadge).toHaveBeenCalledTimes(1);
    });

    it('re-renders when its own selection changes', () => {
        const { rerender } = render(inTable(PROPS));
        rerender(inTable({ ...PROPS, isSelected: true }));

        expect(mockGetMarketBadge).toHaveBeenCalledTimes(2);
    });

    it('is defeated by an unstable callback, which is why the list memoises its own', () => {
        const { rerender } = render(inTable({ ...PROPS, onToggleSelect: () => {} }));
        rerender(inTable({ ...PROPS, onToggleSelect: () => {} }));

        // A fresh arrow per render is a new prop, so the memo cannot help. This
        // is pinned deliberately: it documents why `HoldingsList` keeps
        // `toggleSelection` in a useCallback with a ref, rather than depending
        // on `selectedHoldings` and handing every row a new function per tick.
        expect(mockGetMarketBadge).toHaveBeenCalledTimes(2);
    });
});

/**
 * The guarantee that actually matters, and the one the first version of this
 * work got wrong.
 *
 * `HoldingsList` memoised the handlers it owns, but forwarded `onSellHolding`
 * straight through — and its caller passed a fresh arrow on every render. So
 * every row saw a new prop each time the section re-rendered, and the memo did
 * nothing on the exact interaction it was added for. The list now holds that
 * callback through a ref, which is what this pins: a caller that re-creates it
 * every render must not cost a single row render.
 */
// HoldingsList requires these three; they are irrelevant to what these tests
// measure (row re-renders), so they are supplied once rather than repeated.
// AdvancedFilters is entirely optional fields, so {} is a valid filter set.
const LIST_REQUIRED = {
    isValueVisible: true,
    filters: {},
    onFiltersChange: () => {},
} as const;

describe('an unstable callback from above cannot reach the rows', () => {
    const HOLDINGS = [holding, { ...holding, id: 'h2', symbol: 'VT', name: 'Vanguard Total World' }];

    it('re-rendering with a brand-new onSellHolding does not re-render the rows', () => {
        const { rerender } = render(
            <HoldingsList {...LIST_REQUIRED} holdings={HOLDINGS} onSellHolding={() => {}} />,
        );
        // What the mount costs is not the point (the table renders a header
        // pass too); that a re-render costs nothing more is.
        // Both surfaces render — the desktop table and the phone cards, the
        // latter hidden by CSS rather than unmounted. Neither may re-render.
        const afterMount = mockGetMarketBadge.mock.calls.length;
        expect(afterMount).toBeGreaterThan(0);

        // Exactly what the section did: a different function object each time.
        rerender(<HoldingsList {...LIST_REQUIRED} holdings={HOLDINGS} onSellHolding={() => {}} />);
        rerender(<HoldingsList {...LIST_REQUIRED} holdings={HOLDINGS} onSellHolding={() => {}} />);

        expect(mockGetMarketBadge).toHaveBeenCalledTimes(afterMount);
    });

    it('still hides the sell action when no handler is given', () => {
        // The ref must not turn "no handler" into "a handler that does nothing",
        // which would draw a sell button on every row.
        const withHandler = render(<HoldingsList {...LIST_REQUIRED} holdings={HOLDINGS} onSellHolding={() => {}} />);
        expect(withHandler.container.querySelectorAll('[title="Sell this holding"]').length)
            .toBeGreaterThan(0);
        withHandler.unmount();

        const without = render(<HoldingsList {...LIST_REQUIRED} holdings={HOLDINGS} />);
        expect(without.container.querySelectorAll('[title="Sell this holding"]')).toHaveLength(0);
    });
});

describe('HoldingCardMobile re-rendering', () => {
    // The phone counterpart of the block above. Covered indirectly through the
    // list too, but a failure there would not say which surface broke.
    const CARD = {
        holding,
        isSelected: false,
        isValueVisible: true,
        bulkEditMode: false,
        lotCount: 1,
        onSelect: () => {},
        onToggleSelect: () => {},
    };

    beforeEach(() => mockGetMarketBadge.mockClear());

    it('skips a re-render when handed identical props', () => {
        const { rerender } = render(<HoldingCardMobile {...CARD} />);
        rerender(<HoldingCardMobile {...CARD} />);
        rerender(<HoldingCardMobile {...CARD} />);
        expect(mockGetMarketBadge).toHaveBeenCalledTimes(1);
    });

    it('re-renders when its own selection changes', () => {
        const { rerender } = render(<HoldingCardMobile {...CARD} />);
        rerender(<HoldingCardMobile {...CARD} isSelected />);
        expect(mockGetMarketBadge).toHaveBeenCalledTimes(2);
    });
});

describe('lot counts are per wallet, not per symbol', () => {
    /**
     * The same security can sit in both the Portfolio and Emergency wallets.
     * The desktop table has always keyed its count by `symbol|wallet`; the
     * phone card counted by symbol alone, so it merged the two into one number.
     * Both surfaces read the same key now.
     */
    const SAME_SYMBOL_TWO_WALLETS = [
        { ...holding, id: 'p1', walletType: 'portfolio' as const },
        { ...holding, id: 'p2', walletType: 'portfolio' as const },
        { ...holding, id: 'e1', walletType: 'emergency' as const },
    ];

    it('does not merge two wallets into one count', () => {
        const { container } = render(
            <HoldingsList {...LIST_REQUIRED} holdings={SAME_SYMBOL_TWO_WALLETS} allHoldings={SAME_SYMBOL_TWO_WALLETS} />,
        );
        const badges = [...container.querySelectorAll('*')]
            .map((el) => el.textContent?.trim())
            .filter((txt) => txt && /^\d+×$/.test(txt));

        // Two portfolio lots and one emergency lot. Each holding is drawn on
        // both surfaces, so the two portfolio cards contribute a "2×" apiece
        // twice over; the lone emergency lot earns no badge at all, since the
        // badge only appears above one. Asserting the whole shape rather than
        // just the absence of "3×" — a count that drifted to "4×", or a badge
        // that stopped rendering, would pass that weaker check.
        expect(badges).toEqual(['2×', '2×', '2×', '2×']);
    });
});

describe('selection is per wallet, not per symbol', () => {
    /**
     * The same security in two wallets is two rows with two sets of lots.
     * Selection was keyed by symbol alone, so ticking the Portfolio row also
     * ticked the Emergency one and the bulk-edit counter said two.
     *
     * Nothing destructive consumes this selection today — it drives the
     * checkboxes and a count — so the bug was visible rather than dangerous.
     * It is still wrong, and keying it the way the lot count is keyed costs
     * nothing.
     */
    const TWO_WALLETS = [
        { ...holding, id: 'p1', walletType: 'portfolio' as const },
        { ...holding, id: 'e1', walletType: 'emergency' as const },
    ];

    // tbody only: the one in thead is select-all, and the mobile cards render
    // their own outside the table.
    const rowBoxes = (c: HTMLElement) =>
        [...c.querySelectorAll('tbody input[type="checkbox"]')] as HTMLInputElement[];

    it('ticking one wallet leaves the other alone', () => {
        const selected: string[][] = [];
        const { container, rerender } = render(
            <HoldingsList
                {...LIST_REQUIRED}
                holdings={TWO_WALLETS}
                allHoldings={TWO_WALLETS}
                bulkEditMode
                selectedHoldings={[]}
                onSelectionChange={(s) => selected.push(s)}
            />,
        );

        const boxes = rowBoxes(container);
        expect(boxes).toHaveLength(2);   // one row per wallet
        fireEvent.click(boxes[0]);

        // One key, carrying its wallet — not a bare symbol.
        expect(selected.at(-1)).toHaveLength(1);
        expect(selected.at(-1)![0]).toMatch(/\|(portfolio|emergency)$/);

        // Feed it back: exactly one row reads as selected.
        rerender(
            <HoldingsList
                {...LIST_REQUIRED}
                holdings={TWO_WALLETS}
                allHoldings={TWO_WALLETS}
                bulkEditMode
                selectedHoldings={selected.at(-1)!}
                onSelectionChange={() => {}}
            />,
        );
        expect(rowBoxes(container).filter((c) => c.checked)).toHaveLength(1);
    });
});

describe('the wallet-scoped key has exactly one spelling', () => {
    const fs2 = jest.requireActual('fs') as typeof import('fs');
    const path2 = jest.requireActual('path') as typeof import('path');
    const DIR2 = path2.join(__dirname, '../../../components/portfolio');

    /**
     * `holdingKey` was added and the four inline copies it was modelled on were
     * left behind — the same "fixed here, still wrong there" shape this area has
     * produced three times. If the `|| 'portfolio'` default ever changes, a
     * stray copy makes selection and the lot-count badge disagree again.
     */
    it.each(['HoldingsList.tsx', 'HoldingsListMobile.tsx', 'HoldingRow.tsx', 'HoldingCardMobile.tsx'])(
        '%s builds no key by hand',
        (file) => {
            const src = fs2.readFileSync(path2.join(DIR2, file), 'utf8');
            const inline = src
                .split('\n')
                .map((line, i) => ({ line: i + 1, text: line.trim() }))
                .filter(({ text }) => /\$\{\s*\w+\.symbol\s*\}\s*\|/.test(text));
            expect(inline).toEqual([]);
        },
    );
});

describe('select-all is per wallet too', () => {
    const TWO_WALLETS_ALL = [
        { ...holding, id: 'p1', walletType: 'portfolio' as const },
        { ...holding, id: 'e1', walletType: 'emergency' as const },
    ];

    it('selects both rows as distinct keys, not one merged symbol', () => {
        const selected: string[][] = [];
        const { container } = render(
            <HoldingsList
                {...LIST_REQUIRED}
                holdings={TWO_WALLETS_ALL}
                allHoldings={TWO_WALLETS_ALL}
                bulkEditMode
                selectedHoldings={[]}
                onSelectionChange={(s) => selected.push(s)}
            />,
        );

        const selectAll = container.querySelector('thead input[type="checkbox"]') as HTMLInputElement;
        expect(selectAll).toBeTruthy();
        fireEvent.click(selectAll);

        // Two rows, two keys. Keyed by symbol this collapsed to one entry, and
        // the count under the Bulk Edit button read 1 for two selected rows.
        expect(selected.at(-1)).toEqual(['0050|portfolio', '0050|emergency']);
    });
});

describe('holding badge helpers live in one place', () => {
    const fs = jest.requireActual('fs') as typeof import('fs');
    const path = jest.requireActual('path') as typeof import('path');
    const DIR = path.join(__dirname, '../../../components/portfolio');

    /**
     * These were copied into the desktop and mobile lists, and three had drifted:
     * `getCurrencyColor` upper-cased the code in one and not the other, so a
     * lowercase currency lost its colour on mobile only; `getTypeColor` painted
     * cash grey in one and emerald in the other. Nobody decided either — it is
     * what two copies do.
     */
    const HELPERS = [
        'isPriceStale',
        'formatTimeAgo',
        'getTypeColor',
        'getCurrencyColor',
        'getMarketBadge',
        'getWalletTypeBadge',
        'isCashHolding',
    ];

    it.each([
        'HoldingsList.tsx',
        'HoldingsListMobile.tsx',
        'HoldingRow.tsx',
        'HoldingCardMobile.tsx',
    ])(
        '%s defines none of them itself',
        (file) => {
            const src = fs.readFileSync(path.join(DIR, file), 'utf8');
            const redefined = HELPERS.filter((h) =>
                new RegExp(`^\\s*(?:export\\s+)?const ${h}\\s*=`, 'm').test(src),
            );
            expect(redefined).toEqual([]);
        },
    );
});
