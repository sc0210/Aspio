import { niceAxis } from '@/utils/niceAxis';

describe('niceAxis', () => {
    it('snaps to round, evenly spaced ticks', () => {
        const { domain, ticks } = niceAxis(1_925_000, 2_043_000, { padRatio: 0 });
        expect(domain).toEqual([ticks[0], ticks[ticks.length - 1]]);
        const steps = new Set(ticks.slice(1).map((t, i) => t - ticks[i]));
        expect(steps.size).toBe(1);
        expect(domain[0]).toBeLessThanOrEqual(1_925_000);
        expect(domain[1]).toBeGreaterThanOrEqual(2_043_000);
    });

    // A negative net worth (debt above assets) was clipped at 0.
    it('keeps negative data below zero', () => {
        const { domain } = niceAxis(-3_900_000, 500_000);
        expect(domain[0]).toBeLessThanOrEqual(-3_900_000);
    });

    it('floors non-negative data at 0', () => {
        expect(niceAxis(10, 1_000).domain[0]).toBe(0);
    });

    // One price point, or a value that never moves, had a 0-based axis and no ticks.
    it('bands a flat series around its value', () => {
        const { domain, ticks } = niceAxis(2_000_000, 2_000_000);
        expect(domain[0]).toBeGreaterThan(0);
        expect(domain[0]).toBeLessThan(2_000_000);
        expect(domain[1]).toBeGreaterThan(2_000_000);
        expect(ticks.length).toBeGreaterThan(1);
    });

    it('keeps ticks distinct for a small flat value', () => {
        const { ticks } = niceAxis(10, 10);
        expect(new Set(ticks).size).toBe(ticks.length);
        expect(ticks.length).toBeGreaterThan(1);
    });

    // A new account: every point is 0. Ticks at 0, 0.5 and 1 printed "NT$0, NT$1, NT$1".
    it('gives an all-zero series a single baseline tick', () => {
        expect(niceAxis(0, 0)).toEqual({ domain: [0, 1], ticks: [0] });
    });
});
