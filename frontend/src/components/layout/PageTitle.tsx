'use client';

import { usePathname } from 'next/navigation';
import { useTranslation } from 'react-i18next';
import { getNavigationItems } from '@/lib/navigation';

/**
 * The page's name in the desktop top bar, with its parent as a breadcrumb.
 *
 * Top-level titles are read off `lib/navigation` rather than listed again
 * here. This file used to keep its own copy of the routes, and the copy fell
 * behind: /housing and /lifecycle were added to the sidebar and never to the
 * map, so both rendered a top bar with nothing in it. Deriving them means a
 * page cannot reach the sidebar without also having a title.
 *
 * `SUBROUTES` is the remainder — pages that are not sidebar destinations,
 * either because they are children of one (/transactions/add) or because they
 * are reached from inside another (/rebalancing, from the portfolio overflow
 * menu). A parent is named by href, so its label resolves from the same single
 * source as its own row.
 */

/** href → nameKey, for everything the sidebar can reach. */
const DESTINATIONS: Record<string, string> = Object.fromEntries(
  getNavigationItems(true).map((item) => [item.href, item.nameKey]),
);

interface SubRoute {
  titleKey: string;
  /** Parent's href — its label comes from DESTINATIONS, never a second spelling. */
  parentHref?: string;
}

const SUBROUTES: Record<string, SubRoute> = {
  '/settings': { titleKey: 'navigation.settings' },
  '/changelog': { titleKey: 'navigation.whatsNew' },
  '/rebalancing': { titleKey: 'navigation.rebalancing', parentHref: '/portfolio' },
  '/transactions/add': { titleKey: 'navigation.addTransaction', parentHref: '/transactions' },
  '/transactions/scan': { titleKey: 'navigation.scanReceipt', parentHref: '/transactions' },
  '/transactions/monthly-summary': { titleKey: 'navigation.monthlySummary', parentHref: '/transactions' },
  '/portfolio/add': { titleKey: 'navigation.addInvestment', parentHref: '/portfolio' },
  '/portfolio/trend': { titleKey: 'navigation.trend', parentHref: '/portfolio' },
};

/** Routes carrying an id. Ordered — first match wins. */
const DYNAMIC: [RegExp, SubRoute][] = [
  [/^\/portfolio\/edit\/[^/]+$/, { titleKey: 'navigation.editInvestment', parentHref: '/portfolio' }],
  [/^\/portfolio\/holdings\/[^/]+/, { titleKey: 'navigation.holdings', parentHref: '/portfolio' }],
  [/^\/transactions\/edit\/[^/]+$/, { titleKey: 'navigation.editTransaction', parentHref: '/transactions' }],
  [/^\/groups\/[^/]+$/, { titleKey: 'navigation.groupDetail', parentHref: '/groups' }],
];

function matchRoute(pathname: string): SubRoute | null {
  if (DESTINATIONS[pathname]) return { titleKey: DESTINATIONS[pathname] };
  if (SUBROUTES[pathname]) return SUBROUTES[pathname];

  for (const [pattern, entry] of DYNAMIC) {
    if (pattern.test(pathname)) return entry;
  }

  // A deeper path under a known destination still names that destination.
  const prefix = Object.keys(DESTINATIONS)
    .filter((href) => pathname.startsWith(href + '/'))
    .sort((a, b) => b.length - a.length)[0];
  return prefix ? { titleKey: DESTINATIONS[prefix] } : null;
}

export function PageTitle() {
  const pathname = usePathname();
  const { t } = useTranslation('common');

  const entry = matchRoute(pathname);
  if (!entry) return null;

  const parentKey = entry.parentHref ? DESTINATIONS[entry.parentHref] : undefined;

  return (
    <div className="flex items-center gap-1.5 min-w-0">
      {parentKey && (
        <>
          <span className="text-sm text-gray-400 dark:text-gray-500 truncate">{t(parentKey)}</span>
          <span className="text-sm text-gray-400 dark:text-gray-500" aria-hidden="true">/</span>
        </>
      )}
      <h1 className="text-sm font-semibold text-gray-800 dark:text-gray-100 truncate">
        {t(entry.titleKey)}
      </h1>
    </div>
  );
}
