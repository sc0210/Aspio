import { renderHook } from '@testing-library/react';
import { useGrowthForecast } from '@/hooks/useGrowthForecast';

const baseInputs = {
    totalAsset: 100000,
    portfolioWallet: 40000,
    monthlyIncome: 50000,
    monthlyExpenses: 40000,
};

describe('useGrowthForecast', () => {
    it('projects above the savings-only baseline with positive savings + return', () => {
        const { result } = renderHook(() =>
            useGrowthForecast(baseInputs, {
                annualReturnPct: 12,
                monthlySavings: 10000,
                horizonMonths: 12,
                investedPct: 50,
            })
        );
        const f = result.current;
        expect(f.points).toHaveLength(13); // month 0..12
        expect(f.points[0].total).toBe(100000); // month 0 = today
        expect(f.startTotal).toBe(100000);
        expect(f.projectedTotal).toBeGreaterThan(f.baselineTotal);
        expect(f.baselineTotal).toBeGreaterThan(f.startTotal);
        expect(f.gain).toBeGreaterThan(0);
        expect(f.marketContribution).toBeGreaterThan(0);
        expect(f.gainPct).toBeCloseTo((f.gain / f.startTotal) * 100, 5);
    });

    it('with 0% return, the projection equals the savings-only baseline (pure contributions)', () => {
        const { result } = renderHook(() =>
            useGrowthForecast(baseInputs, {
                annualReturnPct: 0,
                monthlySavings: 10000,
                horizonMonths: 6,
                investedPct: 70, // split should not matter when return is 0
            })
        );
        const f = result.current;
        expect(f.projectedTotal).toBeCloseTo(f.baselineTotal, 6);
        // 100000 + 6 * 10000 = 160000 regardless of invested split
        expect(f.projectedTotal).toBeCloseTo(160000, 6);
        expect(f.marketContribution).toBeCloseTo(0, 6);
        expect(f.gainPct).toBeCloseTo(60, 6);
    });

    it('declines below the starting total when savings are negative', () => {
        const { result } = renderHook(() =>
            useGrowthForecast(baseInputs, {
                annualReturnPct: 0,
                monthlySavings: -5000,
                horizonMonths: 6,
                investedPct: 50,
            })
        );
        const f = result.current;
        expect(f.projectedTotal).toBeCloseTo(70000, 6); // 100000 - 6*5000
        expect(f.gain).toBeLessThan(0);
    });

    it('invPct=100 compounds the whole portfolio; savings=0 grows only P0', () => {
        const { result } = renderHook(() =>
            useGrowthForecast(
                { ...baseInputs, portfolioWallet: 100000, totalAsset: 100000 },
                { annualReturnPct: 12, monthlySavings: 0, horizonMonths: 12, investedPct: 100 }
            )
        );
        const f = result.current;
        // 100000 * (1 + 0.12/12)^12 = 100000 * 1.01^12 ≈ 112682.5
        expect(f.projectedTotal).toBeCloseTo(100000 * Math.pow(1.01, 12), 2);
    });

    it('invPct=0 routes all savings to cash; portfolio grows only on existing balance', () => {
        const { result } = renderHook(() =>
            useGrowthForecast(baseInputs, {
                annualReturnPct: 12,
                monthlySavings: 10000,
                horizonMonths: 12,
                investedPct: 0,
            })
        );
        const f = result.current;
        const lastPort = f.points[f.points.length - 1].portfolio;
        // portfolio only compounds the initial 40000, no contributions added
        expect(lastPort).toBeCloseTo(40000 * Math.pow(1.01, 12), 2);
        const lastCash = f.points[f.points.length - 1].cash;
        // cash = initial 60000 + 12 * 10000
        expect(lastCash).toBeCloseTo(60000 + 120000, 6);
    });
});
