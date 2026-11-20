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
