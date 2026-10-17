/** The demo holding-detail chart ends on the price the demo holding shows. */
import { getDemoHistoricalPrices } from '@/data/demoData';
import { DEMO_PORTFOLIO } from '@/contexts/DemoContext';

describe('getDemoHistoricalPrices anchors', () => {
    it.each(DEMO_PORTFOLIO.holdings.map((h) => [h.symbol, h.currentPrice, h.currency] as const))(
        '%s ends on its demo price %p in %s',
        (symbol, price, currency) => {
            const series = getDemoHistoricalPrices(symbol, 365);
            expect(series[series.length - 1].close).toBe(price);
            expect(series.every((p) => p.currency === currency)).toBe(true);
            // Stays near the price rather than wandering off a hash-based base.
            const closes = series.map((p) => p.close);
            expect(Math.max(...closes)).toBeLessThan(price * 1.2);
            expect(Math.min(...closes)).toBeGreaterThan(price * 0.8);
        },
    );
});
