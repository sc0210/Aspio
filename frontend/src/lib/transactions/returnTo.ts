'use client';

/**
 * Carrying a filtered list view through an edit and back.
 *
 * Editing a transaction is a separate page, and it returns with
 * `router.push('/transactions')`. That remounts the list, so filters, the search box
 * and the page number all reset to defaults — you filter to one category, correct a
 * row, and land back on an unfiltered list. The filters now live in the list's URL,
 * so the fix is to carry that URL to the edit page and push it back afterwards.
 *
 * `router.back()` would be simpler and usually right, since filter changes use
 * `replace` and so leave no intermediate history. But an edit page opened directly —
 * a bookmark, a shared link, a notification — has no history to go back to, and
 * `back()` would take the user out of the app. An explicit parameter always knows
 * where to land.
 */

import { usePathname, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';

export const RETURN_TO_PARAM = 'returnTo';

/** Where an edit lands when it has nothing better to go on. */
const TRANSACTIONS_LIST = '/transactions';

/**
 * A `returnTo` is a user-supplied string that becomes a navigation, so it is checked
 * rather than trusted: an in-app transactions path and nothing else. This rejects
 * absolute URLs, protocol-relative `//host` (which a browser treats as absolute), and
 * any path outside the list — so a crafted link cannot turn "save" into a redirect off
 * the site or deeper into the app.
 */
export function safeReturnTo(raw: string | null | undefined): string {
    if (!raw) return TRANSACTIONS_LIST;

    let value = raw;
    try {
        value = decodeURIComponent(raw);
    } catch {
        return TRANSACTIONS_LIST; // malformed percent-encoding
    }

    if (!value.startsWith('/')) return TRANSACTIONS_LIST; // absolute or scheme-relative
    if (value.startsWith('//')) return TRANSACTIONS_LIST; // "//evil.example" is absolute
    if (value.includes('\\')) return TRANSACTIONS_LIST; // backslash tricks

    const [path] = value.split('?');
    if (path !== TRANSACTIONS_LIST) return TRANSACTIONS_LIST;

    return value;
}

/** `/transactions/edit/<id>?returnTo=<the list view to come back to>` */
function editHrefFor(id: string, listUrl: string): string {
    const base = `${TRANSACTIONS_LIST}/edit/${encodeURIComponent(id)}`;
    // Nothing to carry when the list is unfiltered — keeps the common URL clean.
    if (!listUrl || listUrl === TRANSACTIONS_LIST) return base;
    return `${base}?${RETURN_TO_PARAM}=${encodeURIComponent(listUrl)}`;
}

/**
 * Builds edit links that carry the view they were clicked from.
 *
 * Safe to call per row: both hooks read from context the whole list already
 * re-renders on, so this adds no subscriptions of its own.
 */
export function useEditHref(): (id: string) => string {
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const query = searchParams.toString();

    return useCallback(
        (id: string) => editHrefFor(id, query ? `${pathname}?${query}` : pathname),
        [pathname, query],
    );
}
