/**
 * The transaction filters live in the URL.
 *
 * They used to be plain component state. Editing a transaction is a separate page, so
 * saving unmounted the list and every filter reset to its default — you would narrow
 * to one category, correct a row, and come back to an unfiltered list. In the URL they
 * survive that round trip, a refresh and the back button, and the view can be linked
 * to.
 *
 * Reading them back is the half that has to be defensive: anyone can type anything
 * into an address bar, and whatever comes out of it is passed to the API.
 */

import { act, renderHook } from '@testing-library/react';

import { useTransactionFilters } from '@/hooks/transactions/useTransactionFilters';

const replace = jest.fn();
let search = new URLSearchParams();

jest.mock('next/navigation', () => ({
    useRouter: () => ({ replace }),
    usePathname: () => '/transactions',
    useSearchParams: () => search,
}));

const at = (query: string) => {
    search = new URLSearchParams(query);
};

/** The query string the hook last wrote to the address bar. */
const written = () => {
    if (replace.mock.calls.length === 0) return null;
    const url: string = replace.mock.calls[replace.mock.calls.length - 1][0];
    return url.includes('?') ? url.slice(url.indexOf('?') + 1) : '';
};

describe('transaction filters in the URL', () => {
    beforeEach(() => {
        replace.mockClear();
        at('');
        jest.useFakeTimers({
            doNotFake: ['performance', 'queueMicrotask', 'nextTick', 'requestAnimationFrame'],
        });
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    describe('reading', () => {
        it('starts from the defaults when the URL is bare', () => {
            const { result } = renderHook(() => useTransactionFilters());

            expect(result.current.filters).toMatchObject({
                type: 'all',
                category: 'all',
                walletType: 'all',
                dateRange: 'month',
            });
            expect(result.current.searchQuery).toBe('');
            // Nothing to correct, so the address bar is left alone.
            expect(replace).not.toHaveBeenCalled();
        });

        it('restores a filtered view, which is the whole point', () => {
            at('type=expense&category=Dining,Coffee&wallet=life&range=custom&from=2026-09-01&to=2026-09-30&q=latte');

            const { result } = renderHook(() => useTransactionFilters());

            expect(result.current.filters).toMatchObject({
                type: 'expense',
                category: 'Dining,Coffee',
                walletType: 'life',
                dateRange: 'custom',
                startDate: '2026-09-01',
                endDate: '2026-09-30',
            });
            expect(result.current.searchQuery).toBe('latte');
            expect(result.current.activeFilters.map((f) => f.key)).toEqual(
                expect.arrayContaining(['type', 'category', 'dateRange', 'walletType']),
            );
        });

        it.each([
            ['type', 'type=banana', 'type', 'all'],
            ['wallet', 'wallet=offshore', 'walletType', 'all'],
            ['range', 'range=forever', 'dateRange', 'month'],
            ['sort', 'sort=amount;drop+table', 'sortBy', 'date'],
            ['order', 'order=sideways', 'sortOrder', 'desc'],
            ['from', 'from=yesterday', 'startDate', ''],
            ['to', 'to=2026-13-45x', 'endDate', ''],
        ])('falls back to the default for a junk %s', (_p, query, field, expected) => {
            // Passing it through would reach the backend and come back as a
            // confusingly empty list, which reads as "I have no transactions".
            at(query);

            const { result } = renderHook(() => useTransactionFilters());

            expect(result.current.filters[field as 'type']).toBe(expected);
        });

        it('keeps a category name as typed, since categories are free text', () => {
            at('category=' + encodeURIComponent('早餐 & 點心'));

            const { result } = renderHook(() => useTransactionFilters());

            expect(result.current.filters.category).toBe('早餐 & 點心');
        });
    });

    describe('writing', () => {
        it('puts a narrowed filter in the URL', () => {
            const { result } = renderHook(() => useTransactionFilters());

            act(() => {
                result.current.setFilters((prev) => ({ ...prev, type: 'expense' }));
            });

            expect(written()).toBe('type=expense');
        });

        it('leaves defaults out, so an untouched list keeps a clean URL', () => {
            at('type=expense');
            const { result } = renderHook(() => useTransactionFilters());

            act(() => {
                result.current.setFilters((prev) => ({ ...prev, type: 'all' }));
            });

            // The whole query goes, not just the value — replace() is called with the
            // bare path.
            expect(replace).toHaveBeenLastCalledWith('/transactions', { scroll: false });
        });

        it('waits for the typing to stop before rewriting the URL', () => {
            const { result } = renderHook(() => useTransactionFilters());

            act(() => result.current.setSearchQuery('c'));
            act(() => result.current.setSearchQuery('co'));
            act(() => result.current.setSearchQuery('cof'));
            // Mid-typing: the address bar has not moved for any of those keystrokes.
            expect(replace).not.toHaveBeenCalled();

            act(() => {
                jest.advanceTimersByTime(500);
            });

            expect(written()).toBe('q=cof');
            expect(replace).toHaveBeenCalledTimes(1);
        });

        it('replaces rather than pushes, so adjusting a filter is not a history step', () => {
            const { result } = renderHook(() => useTransactionFilters());

            act(() => {
                result.current.setFilters((prev) => ({ ...prev, walletType: 'life' }));
            });

            // Pushing would bury the page the user arrived from under one entry per
            // adjustment, so Back would walk the filter history instead of leaving.
            expect(replace).toHaveBeenCalledWith('/transactions?wallet=life', {
                scroll: false,
            });
        });

        it('clearing takes everything back out of the URL', () => {
            at('type=expense&wallet=life&q=coffee');
            const { result } = renderHook(() => useTransactionFilters());

            act(() => result.current.clearAllFilters());
            act(() => {
                jest.advanceTimersByTime(500); // the search box is debounced
            });

            expect(replace).toHaveBeenLastCalledWith('/transactions', { scroll: false });
        });

        it('dropping a custom range drops its endpoints with it', () => {
            at('range=custom&from=2026-09-01&to=2026-09-30');
            const { result } = renderHook(() => useTransactionFilters());

            act(() => result.current.removeFilter('dateRange'));

            // Left behind, they would come back the next time 'custom' was picked.
            expect(written()).toBe('');
            expect(result.current.filters.startDate).toBe('');
            expect(result.current.filters.endDate).toBe('');
        });

        it('leaves parameters it does not own alone', () => {
            at('type=expense&highlight=abc123');
            const { result } = renderHook(() => useTransactionFilters());

            act(() => {
                result.current.setFilters((prev) => ({ ...prev, walletType: 'life' }));
            });

            const query = new URLSearchParams(written() ?? '');
            expect(query.get('highlight')).toBe('abc123');
            expect(query.get('wallet')).toBe('life');
        });
    });
});
