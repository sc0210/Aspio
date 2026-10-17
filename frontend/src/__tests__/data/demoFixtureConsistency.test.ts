/**
 * Demo figures must be derived, not restated.
 *
 * This exact drift recurred four times on one branch: the dashboard hardcoded
 * zero debt while /loans showed NT$3.85M; a loan card drew a 24% progress bar
 * beside a 76%-repaid balance; Reports kept the pre-change total in two
 * literals. Each was a copy of a number that lived somewhere else, and each
 * made a visitor see the same account differently on consecutive screens.
 *
 * These assert the relationships rather than the values, so changing a fixture
 * stays a one-line edit — and forgetting a dependent copy fails here.
 */

import { DEMO_PORTFOLIO, buildDemoRebalancingData } from '@/contexts/DemoContext';
import { demoLoans } from '@/data/demoData';

describe('each demo loan agrees with its own progress bar', () => {
    it.each(demoLoans.map((l) => [l.name, l] as const))(
        '%s',
        (_name, loan) => {
            const repaid =
                ((loan.principal_amount - loan.current_balance) /
                    loan.principal_amount) *
                100;
            // The card renders the bar from progress_pct and the amounts from
            // the balances, so a stale field contradicts the row it sits in.
            expect(loan.progress_pct).toBeCloseTo(repaid, 0);
        },
    );
});

/**
 * /rebalancing was the fifth transcription of the demo portfolio.
 *
 * It listed four assets — two the portfolio does not hold — all at delta 0 /
 * HOLD, against a /portfolio page showing two holdings and a 75/25 split. So a
 * demo of a rebalancing tool showed a portfolio needing no rebalancing. Nothing
 * caught it because the fixture was a literal beside the one it contradicted.
 */
describe('the /rebalancing fixture describes the portfolio /portfolio shows', () => {
    const rebalancing = buildDemoRebalancingData();
    const isHolding = (asset: string) =>
        DEMO_PORTFOLIO.holdings.some((h) => asset.startsWith(h.symbol));

    it('prices each holding at the value the holdings table shows', () => {
        for (const holding of DEMO_PORTFOLIO.holdings) {
            const line = rebalancing.allocations.find((a) =>
                a.asset.startsWith(holding.symbol),
            );
            expect(line).toBeDefined();
            expect(line?.currentValue).toBe(holding.totalValue);
        }
    });

    it('adds the cash lines to the portfolio wallet, and nothing else', () => {
        const total = rebalancing.allocations.reduce((s, a) => s + a.currentValue, 0);
        expect(total).toBe(rebalancing.totalAssets);

        const heldHere = rebalancing.allocations
            .filter((a) => isHolding(a.asset))
            .reduce((s, a) => s + a.currentValue, 0);
        expect(heldHere).toBe(DEMO_PORTFOLIO.totalValue);
    });

    it('states percentages out of 100, not fractions', () => {
        // A fraction here rendered the allocation legend as "0.6%" for 60%.
        const current = rebalancing.allocations.reduce((s, a) => s + a.currentPct, 0);
        const target = rebalancing.allocations.reduce((s, a) => s + a.targetPct, 0);
        expect(current).toBeCloseTo(100, 6);
        expect(target).toBeCloseTo(100, 6);
    });

    it('derives every delta from the gap it names', () => {
        for (const a of rebalancing.allocations) {
            expect(a.targetValue).toBeCloseTo(
                (rebalancing.totalAssets * a.targetPct) / 100,
                6,
            );
            expect(a.delta).toBeCloseTo(a.targetValue - a.currentValue, 6);
            expect(a.suggestedAmount).toBeCloseTo(Math.abs(a.delta), 6);
        }
    });

    it('has something to rebalance, and one action per thing', () => {
        expect(rebalancing.allocations.some((a) => a.action === 'SELL')).toBe(true);
        expect(rebalancing.allocations.some((a) => a.action === 'BUY')).toBe(true);
        expect(rebalancing.actions.map((a) => a.asset)).toEqual(
            rebalancing.allocations
                .filter((a) => a.action !== 'HOLD')
                .map((a) => a.asset),
        );
        // The sale funds the purchase: no outside money, nothing left over.
        expect(rebalancing.availableFunds).toBeGreaterThan(0);
        expect(rebalancing.availableFunds).toBeCloseTo(rebalancing.totalDeficit, 6);
    });
});
