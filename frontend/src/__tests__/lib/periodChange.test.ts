import { periodChange, netWorthOf } from '@/lib/dashboard/periodChange';

const pts = (...vals: number[]) => vals.map((totalAsset) => ({ totalAsset }));

describe('periodChange', () => {
    it('reports nothing without two endpoints to compare', () => {
        expect(periodChange(undefined, 'totalAsset')).toEqual({ percent: undefined, amount: undefined });
        expect(periodChange([], 'totalAsset')).toEqual({ percent: undefined, amount: undefined });
        expect(periodChange(pts(100), 'totalAsset')).toEqual({ percent: undefined, amount: undefined });
    });

    it('measures first to last, ignoring the path between', () => {
        const r = periodChange(pts(100, 5, 900, 150), 'totalAsset');
        expect(r.amount).toBe(50);
        expect(r.percent).toBeCloseTo(50, 6);
    });

    it('reports a fall as negative', () => {
        const r = periodChange(pts(200, 150), 'totalAsset');
        expect(r.amount).toBe(-50);
        expect(r.percent).toBeCloseTo(-25, 6);
    });

    it('still reports the amount when the window starts at zero', () => {
        // The new-user case: nothing at the start of the window, something now.
        // There is no percentage of nothing, but the money is real — hiding both
        // figures would show no delta at all.
        const r = periodChange(pts(0, 30_000), 'totalAsset');
        expect(r.percent).toBeUndefined();
        expect(r.amount).toBe(30_000);
    });

    it('reports nothing when the window starts and ends at zero', () => {
        expect(periodChange(pts(0, 0), 'totalAsset')).toEqual({ percent: undefined, amount: undefined });
    });

    it('reports a fall into the red from zero', () => {
        // The Life wallet goes negative on overspend, so `last` cannot be
        // assumed positive — hiding this would drop a real loss.
        const r = periodChange(pts(0, -500), 'totalAsset');
        expect(r.percent).toBeUndefined();
        expect(r.amount).toBe(-500);
    });

    it('measures the whole climb out of a negative start', () => {
        const r = periodChange(pts(-100, 50), 'totalAsset');
        expect(r.percent).toBeUndefined();
        expect(r.amount).toBe(150); // not 50
    });

    it('reports nothing when a negative balance did not move', () => {
        expect(periodChange(pts(-100, -100), 'totalAsset')).toEqual({ percent: undefined, amount: undefined });
    });

    it('reads whichever field it is asked for', () => {
        const series = [
            { totalAsset: 100, portfolioWallet: 10 },
            { totalAsset: 200, portfolioWallet: 40 },
        ];
        expect(periodChange(series, 'totalAsset').percent).toBeCloseTo(100, 6);
        expect(periodChange(series, 'portfolioWallet').percent).toBeCloseTo(300, 6);
    });
});

describe('netWorthOf — assets minus debt, never assets alone', () => {
    it('subtracts what is owed on the same day', () => {
        expect(netWorthOf({ totalAsset: 8_659_140, debtBalance: 3_883_409 })).toBe(4_775_731);
    });

    it('treats a payload without the field as debt-free', () => {
        // A series predating debtBalance; the rest of the dashboard makes the
        // same assumption, and it is right for an account with no loans.
        expect(netWorthOf({ totalAsset: 500 })).toBe(500);
    });

    it('separates borrowing from getting richer', () => {
        // The real month this was found in: NT$2.75M borrowed on the 17th lifted
        // assets 53.2% while net worth moved 5.7%. Reading the asset change as
        // net worth — which the Net Worth card did — overstated it ninefold, on
        // the one card whose whole job is the number after the borrowing.
        const open = { totalAsset: 5_651_437, debtBalance: 1_134_742 };
        const close = { totalAsset: 8_659_140, debtBalance: 3_883_409 };

        const assets = periodChange(
            [{ totalAsset: open.totalAsset }, { totalAsset: close.totalAsset }],
            'totalAsset',
        );
        const netWorth = periodChange(
            [{ netWorth: netWorthOf(open) }, { netWorth: netWorthOf(close) }],
            'netWorth',
        );

        expect(assets.percent).toBeCloseTo(53.2, 1);
        expect(netWorth.percent).toBeCloseTo(5.7, 1);
        expect(netWorth.amount).toBe(259_036);
    });

    it('reports a flat net worth when the borrowing is simply held as cash', () => {
        // Borrow a million, hold it: assets up, net worth unchanged. A card
        // reading the asset series would call this a gain.
        const before = { totalAsset: 1_000_000, debtBalance: 0 };
        const after = { totalAsset: 2_000_000, debtBalance: 1_000_000 };

        expect(netWorthOf(after) - netWorthOf(before)).toBe(0);
    });
});
