/**
 * What a transaction change has to refresh.
 *
 * Pages derived from transactions go stale silently. The global config sets
 * `staleTime: 5min` with `refetchOnMount: true`, and that combination does NOT
 * refetch on navigation — `true` only refetches data already considered stale.
 * So a page whose query is not invalidated keeps serving the old numbers for up
 * to five minutes, and clicking into it does nothing.
 *
 * That is what happened to /loans: an expense carrying a `loan_id` reduces the
 * loan's balance on the server
 * (`transactions/services.py::_apply_loan_payment`), but the loans query was in
 * no invalidation group, so the page showed the pre-payment balance.
 */

// jest.setup.js mocks this module app-wide, so `new QueryClient()` would be a
// stub without setQueryData. This suite is about real cache behaviour, so it
// unmocks it for itself.
jest.unmock('@tanstack/react-query');
const { QueryClient } =
    jest.requireActual('@tanstack/react-query') as typeof import('@tanstack/react-query');
type QueryClient = InstanceType<typeof QueryClient>;

import { QUERY_KEYS, invalidateDashboardData, invalidateAllFinancialData } from '@/hooks/useDataSynchronization';

/** Seed one cached, fresh entry per key so staleness is observable. */
function seed(client: QueryClient, keys: string[]) {
    for (const key of keys) {
        client.setQueryData([key], { seeded: true });
    }
}

const isStale = (client: QueryClient, key: string) =>
    client.getQueryState([key])?.isInvalidated === true;

describe('a transaction or portfolio change invalidates everything derived from it', () => {
    let client: QueryClient;

    beforeEach(() => {
        client = new QueryClient({
            defaultOptions: { queries: { retry: false, staleTime: 5 * 60 * 1000 } },
        });
    });

    afterEach(() => client.clear());

    const DERIVED = [
        QUERY_KEYS.DASHBOARD,
        QUERY_KEYS.OPTIMIZED_DASHBOARD,
        QUERY_KEYS.WALLET_TRENDS,
        QUERY_KEYS.PORTFOLIO,
        QUERY_KEYS.LOANS,
    ];

    it.each(DERIVED)('%s is invalidated', (key) => {
        seed(client, DERIVED);
        invalidateDashboardData(client);
        expect(isStale(client, key)).toBe(true);
    });

    /**
     * The write path, not the button. `isRefreshableQueryKey` covers the manual
     * refresh, and the registry test covers that — but the bug this file is
     * about is what a SAVE invalidates, which is a different code path. These
     * are the pages that were silently serving pre-edit numbers: none of them
     * was referenced by any invalidateQueries call anywhere in the app.
     */
    it.each([
        [QUERY_KEYS.REVIEW_SPENDING, '/review spending'],
        [QUERY_KEYS.REVIEW_GOALS, '/review goals'],
        [QUERY_KEYS.REVIEW_CONTEXT, '/review context'],
        [QUERY_KEYS.REVIEW_TOP_EXPENSES, '/review biggest expenses'],
        [QUERY_KEYS.TRANSACTION_PAGE_STATS, 'the /transactions summary tiles'],
        [QUERY_KEYS.INCOME_BY_CATEGORY, 'the cash-flow insight card'],
        [QUERY_KEYS.CASHFLOW_SPENDING_BY_CATEGORY, 'the cash-flow insight card'],
        [QUERY_KEYS.HEATMAP_MONTH_TRANSACTIONS, 'the dashboard heatmap'],
        [QUERY_KEYS.MONTHLY_SUMMARY, '/transactions/monthly-summary'],
    ])('a save invalidates %s (%s)', (key: string, _what: string) => {
        seed(client, [key]);
        invalidateDashboardData(client);
        expect(isStale(client, key)).toBe(true);
    });

    it('leaves goals and the profile alone', () => {
        // Goals have no link to transactions on the backend — a contribution
        // goes through its own endpoint, which invalidates its own queries.
        // Sweeping them in here would be a refetch nobody asked for on every
        // transaction edit. The first version of this test named GOALS in the
        // comment and asserted USER_PROFILE, so it would not have caught that.
        seed(client, [QUERY_KEYS.GOALS, QUERY_KEYS.USER_PROFILE]);
        invalidateDashboardData(client);
        expect(isStale(client, QUERY_KEYS.GOALS)).toBe(false);
        expect(isStale(client, QUERY_KEYS.USER_PROFILE)).toBe(false);
    });

    it('a sign-in clears loans too, which carry no user id in their key', () => {
        // GOALS keys include the user id; LOANS_KEY is a bare ['loans'], so
        // only the auth-transition invalidation stops one account seeing the
        // previous one's balances in the same tab.
        seed(client, [QUERY_KEYS.LOANS]);
        invalidateAllFinancialData(client);
        expect(isStale(client, QUERY_KEYS.LOANS)).toBe(true);
    });

    it('announces the change for hooks that listen rather than poll', () => {
        const heard = jest.fn();
        window.addEventListener('dashboard-data-updated', heard);
        invalidateDashboardData(client);
        window.removeEventListener('dashboard-data-updated', heard);
        expect(heard).toHaveBeenCalled();
    });
});

describe('a user-scoped loans key still answers to the shared invalidations', () => {
    /**
     * The loans key carries the account now, so two users in one tab cannot
     * share a cache entry. The risk in doing that is silent: every invalidation
     * in the app matches by PREFIX — `['loans']` from the shared groups,
     * `['loans', id, 'payments']` from the payment mutations — so a scope
     * inserted in the middle of the key would stop matching them and the page
     * would quietly stop refreshing.
     *
     * Hence the scope goes last, and hence this test.
     */
    let client: QueryClient;

    beforeEach(() => {
        client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    });
    afterEach(() => client.clear());

    const LIST = [QUERY_KEYS.LOANS, 'user-1'];
    const PAYMENTS = [QUERY_KEYS.LOANS, 'loan-9', 'payments', 'user-1'];

    it('two accounts do not share one cache entry', () => {
        client.setQueryData([QUERY_KEYS.LOANS, 'user-1'], ['a-loans']);
        client.setQueryData([QUERY_KEYS.LOANS, 'user-2'], ['b-loans']);

        expect(client.getQueryData([QUERY_KEYS.LOANS, 'user-1'])).toEqual(['a-loans']);
        expect(client.getQueryData([QUERY_KEYS.LOANS, 'user-2'])).toEqual(['b-loans']);
    });

    it('the transaction invalidation still reaches a scoped list', () => {
        client.setQueryData(LIST, ['seeded']);
        invalidateDashboardData(client);
        expect(client.getQueryState(LIST)?.isInvalidated).toBe(true);
    });

    it('a sign-in still clears every account\'s loans', () => {
        client.setQueryData([QUERY_KEYS.LOANS, 'user-1'], ['a']);
        client.setQueryData([QUERY_KEYS.LOANS, 'user-2'], ['b']);
        invalidateAllFinancialData(client);
        expect(client.getQueryState([QUERY_KEYS.LOANS, 'user-1'])?.isInvalidated).toBe(true);
        expect(client.getQueryState([QUERY_KEYS.LOANS, 'user-2'])?.isInvalidated).toBe(true);
    });

    it('a payment invalidation still reaches the scoped payment history', () => {
        // The mutation invalidates ['loans', loanId, 'payments'] — the scope
        // sits after it, so this remains a prefix match.
        client.setQueryData(PAYMENTS, ['p1']);
        client.invalidateQueries({ queryKey: [QUERY_KEYS.LOANS, 'loan-9', 'payments'] });
        expect(client.getQueryState(PAYMENTS)?.isInvalidated).toBe(true);
    });
});
