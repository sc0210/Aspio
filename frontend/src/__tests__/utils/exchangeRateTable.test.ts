/**
 * The rate table behind every summed total in the app.
 *
 * `toTWD` is called 21 times across ten files — the heatmaps, transaction day
 * totals, expense breakdown, annual cash flow — and converted with a fixed
 * table that had drifted 8% on EUR and 6% on SGD against live rates. Any total
 * containing a euro position was wrong by that much.
 *
 * What these pin is the swap: live rates replace the bootstrap values, a failed
 * fetch leaves them alone rather than zeroing the table, and `toTWD` stays
 * synchronous throughout so its call sites never had to change.
 */

import {
    toTWD,
    setExchangeRates,
    areRatesLive,
    getUnconvertedCurrencies,
    __resetExchangeRates,
} from '@/utils/formatters';

describe('the TWD conversion table', () => {
    beforeEach(() => __resetExchangeRates());
    afterAll(() => __resetExchangeRates());

    it('starts on the bootstrap table, and says so', () => {
        expect(areRatesLive()).toBe(false);
        expect(toTWD(100, 'USD')).toBeCloseTo(3150);  // the old fixed 31.5
    });

    it('converts with fetched rates once they arrive', () => {
        setExchangeRates({ TWD: 1, USD: 31.631, EUR: 36.7598 });

        expect(areRatesLive()).toBe(true);
        expect(toTWD(100, 'USD')).toBeCloseTo(3163.1);
        // The one that was most wrong: 34.0 hardcoded against 36.7598 live is
        // 8% understated on every euro holding in every total.
        expect(toTWD(100, 'EUR')).toBeCloseTo(3675.98);
    });

    it('is case-insensitive, as the old table was', () => {
        setExchangeRates({ USD: 31.631 });
        expect(toTWD(1, 'usd')).toBeCloseTo(31.631);
    });

    it('keeps the bootstrap value for a currency the server could not price', () => {
        // A missing code must not drop out of the table: a total that silently
        // omits a holding is worse than one that is slightly stale.
        setExchangeRates({ USD: 31.631 });
        expect(toTWD(100, 'SGD')).toBeCloseTo(2350);   // bootstrap 23.5, untouched
    });

    it('ignores an empty or unusable payload rather than emptying the table', () => {
        // The service rejects on failure, but a malformed success would
        // otherwise leave every conversion at 1:1 — the same parity bug the
        // backend endpoint had.
        setExchangeRates({});
        expect(areRatesLive()).toBe(false);
        expect(toTWD(100, 'USD')).toBeCloseTo(3150);

        setExchangeRates({ USD: 0, EUR: NaN, JPY: -1 });
        expect(areRatesLive()).toBe(false);
        expect(toTWD(100, 'USD')).toBeCloseTo(3150);
    });

    it('prices every currency the server offers, so none converts at parity', () => {
        // `toTWD` ends in `?? 1`. A code absent from the bootstrap table is a
        // holding summed as though one pound were one dollar — GBP was missing,
        // understating it ~97% on every paint before the first fetch resolved.
        // Keep in step with the list in market_data.py::get_exchange_rates.
        for (const code of ['TWD', 'USD', 'EUR', 'JPY', 'GBP', 'SGD', 'CNY', 'HKD']) {
            const converted = toTWD(1, code);
            if (code === 'TWD') continue;
            expect(converted).not.toBe(1);
        }
    });

    it('records a currency it cannot price instead of hiding the 1:1', () => {
        // The fallback still returns a number — `toTWD` runs inside reduce loops
        // that sum money, and throwing would take out a whole total for one bad
        // row. What changes is that the fallback is no longer invisible: the
        // sum is still slightly wrong, but a caller can find out and say so.
        expect(getUnconvertedCurrencies()).toEqual([]);

        expect(toTWD(100, 'KRW')).toBe(100);           // unconverted, not zeroed
        expect(getUnconvertedCurrencies()).toEqual(['KRW']);

        // A currency it can price leaves no trace.
        toTWD(100, 'USD');
        expect(getUnconvertedCurrencies()).toEqual(['KRW']);
    });

    it('leaves TWD alone', () => {
        setExchangeRates({ TWD: 1, USD: 31.631 });
        expect(toTWD(500, 'TWD')).toBe(500);
    });
});
