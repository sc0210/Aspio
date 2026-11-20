import { isPriceStale } from '@/components/portfolio/holdingRowStyles';

const NOW = Date.parse('2026-11-21T10:00:00+08:00'); // a Saturday morning in Taipei
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();

describe('isPriceStale', () => {
    it('does not flag a closed market\'s last close over a weekend', () => {
        // Friday's close, ~20h old on Saturday: was "stale" under a flat 4h rule.
        expect(isPriceStale(hoursAgo(20), 'closed', NOW)).toBe(false);
        expect(isPriceStale(hoursAgo(70), 'closed', NOW)).toBe(false);
    });

    it('flags a closed market\'s price once it is days old (a missed update)', () => {
        expect(isPriceStale(hoursAgo(100), 'closed', NOW)).toBe(true);
    });

    it('keeps the 4h rule while the market trades, and for unknown sessions', () => {
        expect(isPriceStale(hoursAgo(5), 'open', NOW)).toBe(true);
        expect(isPriceStale(hoursAgo(3), 'open', NOW)).toBe(false);
        expect(isPriceStale(hoursAgo(5), undefined, NOW)).toBe(true);
    });

    it('treats no timestamp as stale', () => {
        expect(isPriceStale(undefined, 'closed', NOW)).toBe(true);
    });
});

describe('isPriceStale with the backend verdict', () => {
    it('defers to priceStale when the server sends it (holidays are its call)', () => {
        // Lunar New Year: a 7-day-old close on a closed market is not stale if the server says so.
        expect(isPriceStale(hoursAgo(168), 'closed', NOW, false)).toBe(false);
        expect(isPriceStale(hoursAgo(1), 'open', NOW, true)).toBe(true);
    });

    it('sits on the boundary the fallback uses', () => {
        expect(isPriceStale(hoursAgo(96), 'closed', NOW)).toBe(false);
        expect(isPriceStale(hoursAgo(96.1), 'closed', NOW)).toBe(true);
        expect(isPriceStale(hoursAgo(4), 'open', NOW)).toBe(false);
    });
});
