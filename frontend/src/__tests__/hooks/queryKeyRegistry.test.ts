/**
 * A ratchet on the query-key registry.
 *
 * The defect this guards against is stale data that nothing reports. A hook
 * invents a query key at its call site; the invalidation groups are a separate
 * hand-written list; and the two drift. By 2026-09 nine key families were
 * invalidated by nothing at all — /review, the transactions summary tiles and
 * the dashboard's cash-flow insight card kept showing pre-edit numbers until
 * their staleTime expired. Every test passed the whole time, because nothing
 * ties a key to the thing that refreshes it.
 *
 * Three rules, all mechanical:
 *   1. every query key used in the app is registered in QUERY_KEYS
 *   2. every registered key is actually used by a query (no rot from either end)
 *   3. every registered key is either in a group or listed as ungrouped on purpose
 *
 * A new key therefore cannot ship without someone deciding how it refreshes.
 */

import fs from 'fs';
import path from 'path';
import {
    QUERY_KEYS,
    UNGROUPED_KEYS,
    isRefreshableQueryKey,
} from '@/hooks/useDataSynchronization';

const SRC = path.join(__dirname, '..', '..');

function walk(dir: string, out: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name !== '__tests__' && entry.name !== 'node_modules') walk(full, out);
        } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
            out.push(full);
        }
    }
    return out;
}

const files = ['hooks', 'components', 'app'].flatMap((d) => walk(path.join(SRC, d)));

/**
 * The first element of a query key, where it is a string literal. Covers both
 * `queryKey: ['x', …]` and the wrapper hooks that take the array positionally
 * (`useDualModeQuery(['x', …])`) — the second form is how
 * `transaction-page-stats` escaped an earlier audit that only looked for the
 * first.
 */
const KEY_PATTERNS = [
    /queryKey:\s*\[\s*'([a-z][\w-]*)'/g,
    /use(?:DualMode|Authenticated)Query[^(]*\(\s*\[\s*'([a-z][\w-]*)'/g,
    // A key object rather than an inline array — `foo: ['foo'] as const`.
    // api-hooks.ts kept a whole second registry in this shape, referenced as
    // `queryKeys.gamification`, so none of it was visible to the two patterns
    // above and `gamification` was live, unregistered and ungrouped.
    /^\s{2}[a-z]\w*:\s*\[\s*'([a-z][\w-]*)'\s*\]\s*as const/gm,
];

function usedKeys(): Map<string, string> {
    const found = new Map<string, string>();
    for (const file of files) {
        const src = fs.readFileSync(file, 'utf8');
        for (const pattern of KEY_PATTERNS) {
            for (const m of src.matchAll(pattern)) {
                if (!found.has(m[1])) found.set(m[1], path.relative(SRC, file));
            }
        }
    }
    return found;
}

const registered = new Set<string>(Object.values(QUERY_KEYS));

describe('query key registry', () => {
    it('finds the query keys to check', () => {
        // A regex that silently stops matching would make every test below pass.
        expect(usedKeys().size).toBeGreaterThan(10);
    });

    it('every query key used in the app is registered in QUERY_KEYS', () => {
        const unregistered = [...usedKeys()]
            .filter(([key]) => !registered.has(key))
            .map(([key, file]) => `${key}  (${file})`);

        expect(unregistered).toEqual([]);
    });

    /**
     * The other direction. The first version of this file only checked
     * keys -> registry, so an entry whose query had been deleted sat in the
     * groups forever, invalidating nothing: `market-data` outlived the hook
     * that used it by exactly one commit, and `rebalancing-dashboard` never
     * had a query at all — /rebalancing fetches imperatively, outside the
     * cache. Both directions, or the registry rots from the other end.
     *
     * Counts a reference through the constant (`QUERY_KEYS.FOO`) as well as
     * the literal, and ignores the registry file itself so that belonging to
     * a group does not count as being used.
     */
    it('every registered key is actually used by a query', () => {
        const registryFile = path.join(SRC, 'hooks', 'useDataSynchronization.ts');
        const referenced = new Set<string>();

        for (const file of files) {
            if (file === registryFile) continue;
            const src = fs.readFileSync(file, 'utf8');
            for (const m of src.matchAll(/QUERY_KEYS\.([A-Z_]+)/g)) referenced.add(m[1]);
            for (const [name, value] of Object.entries(QUERY_KEYS)) {
                if (src.includes(`'${value}'`)) referenced.add(name);
            }
        }

        const unused = Object.keys(QUERY_KEYS).filter((name) => !referenced.has(name));
        expect(unused).toEqual([]);
    });

    it('every registered key is grouped, or ungrouped on purpose', () => {
        const ungrouped = new Set<string>(UNGROUPED_KEYS);
        const orphans = [...registered].filter(
            (key) => !ungrouped.has(key) && !isRefreshableQueryKey([key])
        );

        expect(orphans).toEqual([]);
    });

    it('nothing is both grouped and declared ungrouped', () => {
        const contradictory = UNGROUPED_KEYS.filter((key) => isRefreshableQueryKey([key]));
        expect(contradictory).toEqual([]);
    });

    describe('the keys that were silently stale before this registry existed', () => {
        // Named individually: these are the regressions, and a future refactor
        // that drops one should say so out loud rather than quietly stop
        // refreshing a page again.
        it.each([
            ['transaction-page-stats', 'the /transactions summary tiles'],
            ['transaction-stats', 'transaction stats'],
            ['transaction-categories', 'the category dropdowns'],
            ['heatmap-month-transactions', "the dashboard's transaction heatmap"],
            ['income-by-category', 'the cash-flow insight card'],
            ['cashflow-spending-by-category', 'the cash-flow insight card'],
            ['review-spending', '/review'],
            ['review-goals', '/review'],
            ['review-context', '/review'],
            ['review-top-expenses', '/review'],
            ['portfolio-risk-metrics', 'portfolio analytics'],
            ['portfolio-realized-pnl', 'portfolio analytics'],
            ['portfolio-dividend-income', 'portfolio analytics'],
            ['portfolio-twr', '/lifecycle realized return'],
            ['wallet-trends', "the dashboard's net-worth chart"],
        ])('%s refreshes (%s)', (key) => {
            expect(isRefreshableQueryKey([key])).toBe(true);
        });
    });

    it('leaves non-ledger keys alone', () => {
        // Refreshing after a transaction should not re-fetch the FX table or
        // the admin panel; they are not derived from the ledger.
        expect(isRefreshableQueryKey([QUERY_KEYS.EXCHANGE_RATES])).toBe(false);
        expect(isRefreshableQueryKey([QUERY_KEYS.ADMIN])).toBe(false);
    });

    it('matches a key anywhere in the array, not just first', () => {
        expect(isRefreshableQueryKey(['review-spending', '2026-09'])).toBe(true);
        expect(isRefreshableQueryKey(['nonsense', 'wallet-trends'])).toBe(true);
        expect(isRefreshableQueryKey(['nonsense', 'also-nonsense'])).toBe(false);
    });
});
