/**
 * Every destination in the app's navigation, in one list.
 *
 * The sidebar, the mobile bottom bar's More sheet and the ⌘K palette all read
 * this. They used to keep three hand-maintained copies, which is how /chat and
 * /groups ended up sharing an icon — indistinguishable in the collapsed
 * sidebar, where the icon is all there is.
 *
 * Two rules hold this list to a size a person can scan, and
 * `__tests__/lib/navigation.test.ts` fails if either breaks:
 *
 *  1. A titled section holds 2–5 items. One item does not need a heading, and
 *     a heading above one row is where growth goes wrong — it makes "new
 *     section" the cheapest way to add a feature. Sections with no `titleKey`
 *     render as standalone rows.
 *  2. One icon per destination.
 *
 * A new page earns a row here only if it is a place you return to. A thing you
 * do once belongs behind a card on the page it relates to.
 */

import type { ComponentType, SVGProps } from 'react';
import { ALL_FEATURES, type Features } from '@/lib/features';
import {
  HomeIcon,
  CreditCardIcon,
  ChartBarIcon,
  TrophyIcon,
  ShieldCheckIcon,
  BanknotesIcon,
  CircleStackIcon,
  UserGroupIcon,
  SparklesIcon,
  HomeModernIcon,
  ArrowTrendingUpIcon,
  CalendarDaysIcon,
} from '@heroicons/react/24/outline';
import {
  HomeIcon as HomeIconSolid,
  CreditCardIcon as CreditCardIconSolid,
  ChartBarIcon as ChartBarIconSolid,
  TrophyIcon as TrophyIconSolid,
  ShieldCheckIcon as ShieldCheckIconSolid,
  BanknotesIcon as BanknotesIconSolid,
  CircleStackIcon as CircleStackIconSolid,
  UserGroupIcon as UserGroupIconSolid,
  SparklesIcon as SparklesIconSolid,
  HomeModernIcon as HomeModernIconSolid,
  ArrowTrendingUpIcon as ArrowTrendingUpIconSolid,
  CalendarDaysIcon as CalendarDaysIconSolid,
} from '@heroicons/react/24/solid';

export type NavIcon = ComponentType<SVGProps<SVGSVGElement>>;

export interface NavItem {
  nameKey: string;
  href: string;
  icon: NavIcon;
  iconSolid: NavIcon;
  /** Rides the mobile bottom bar itself rather than its More sheet. */
  primary?: boolean;
  /** Extra terms the ⌘K palette matches on, so search works in both languages. */
  keywords?: string[];
  /** An optional add-on the page depends on; hidden when the instance lacks it. */
  feature?: keyof Features;
}

export interface NavSection {
  /** Omit for a standalone row — a heading above one item states nothing. */
  titleKey?: string;
  items: NavItem[];
}

const DASHBOARD: NavItem = {
  nameKey: 'navigation.dashboard', href: '/dashboard',
  icon: HomeIcon, iconSolid: HomeIconSolid, primary: true,
  keywords: ['home', '首頁', '儀表板', '總覽'],
};

// The pages most readers open every week. Each is a standalone row at the top,
// never behind a heading, so a first look shows these and little else. /review
// is the one without a mobile tab: the bar holds four and More, and a monthly
// page is the one that can afford the extra tap.
const TRANSACTIONS: NavItem = {
  nameKey: 'navigation.transactions', href: '/transactions',
  icon: CreditCardIcon, iconSolid: CreditCardIconSolid, primary: true,
  keywords: ['expenses', 'income', 'spending', '交易', '記帳', '支出', '收入'],
};

const PORTFOLIO: NavItem = {
  nameKey: 'navigation.portfolio', href: '/portfolio',
  icon: ChartBarIcon, iconSolid: ChartBarIconSolid, primary: true,
  keywords: ['holdings', 'stocks', 'etf', '投資', '持股'],
};

const GOALS: NavItem = {
  nameKey: 'navigation.goals', href: '/goals',
  icon: TrophyIcon, iconSolid: TrophyIconSolid, primary: true,
  keywords: ['fire', 'target', '目標', '理財目標'],
};

// The other page you open on a schedule. It led an Analysis section beside
// /reports and /chat until both were retired (2026-09-17). The old /reports
// keywords come with it, since a reader searching "報表" now wants this page.
const REVIEW: NavItem = {
  nameKey: 'navigation.review', href: '/review',
  icon: CalendarDaysIcon, iconSolid: CalendarDaysIconSolid,
  keywords: ['month', 'recap', 'monthly', 'report', '回顧', '月報', '本月', '報表'],
};

const CORE: NavItem[] = [DASHBOARD, TRANSACTIONS, PORTFOLIO, GOALS, REVIEW];

// Money that involves other people or debt. Useful once you have it, noise
// before, so it sits behind a heading that stays shut until you are inside it.
const LOANS_SHARING: NavItem[] = [
  {
    nameKey: 'navigation.loans', href: '/loans',
    icon: BanknotesIcon, iconSolid: BanknotesIconSolid,
    keywords: ['debt', 'borrow', '貸款', '負債'],
  },
  {
    // Was UsersIcon — two heads beside /groups' three, which the collapsed
    // sidebar renders one row apart with nothing else to tell them apart. A
    // stack of coins says what the page is for rather than who is in it.
    nameKey: 'navigation.savings', href: '/savings',
    icon: CircleStackIcon, iconSolid: CircleStackIconSolid,
    // /compare folded in as this page's second tab; its search terms came with it.
    keywords: ['shared', 'pot', '共同儲蓄', '存錢', 'compare', 'peers', 'benchmark', '比較', '同儕'],
  },
  {
    // Was ChatBubbleLeftRightIcon — the same glyph as /chat, which the
    // collapsed sidebar renders with nothing else to tell them apart.
    nameKey: 'navigation.groups', href: '/groups',
    icon: UserGroupIcon, iconSolid: UserGroupIconSolid,
    keywords: ['split', 'line', '群組', '分帳'],
    // Groups are LINE groups: without a configured bot there are none to show.
    feature: 'lineBot',
  },
];

// Simulators and extras. /housing and /lifecycle model specific strategies, and
// shown up front to a new reader they read as advice, so they stay closed by default.
const MORE_TOOLS: NavItem[] = [
  {
    nameKey: 'navigation.housing', href: '/housing',
    icon: HomeModernIcon, iconSolid: HomeModernIconSolid,
    keywords: ['buy', 'rent', 'mortgage', '買房', '租屋', '房貸'],
  },
  {
    nameKey: 'navigation.lifecycle', href: '/lifecycle',
    icon: ArrowTrendingUpIcon, iconSolid: ArrowTrendingUpIconSolid,
    keywords: ['leverage', 'borrow to invest', '槓桿', '生命週期'],
  },
  {
    nameKey: 'navigation.achievements', href: '/achievements',
    icon: SparklesIcon, iconSolid: SparklesIconSolid,
    keywords: ['badges', 'streak', 'xp', '成就', '徽章'],
  },
];

const ADMIN: NavItem = {
  nameKey: 'navigation.admin', href: '/admin',
  icon: ShieldCheckIcon, iconSolid: ShieldCheckIconSolid,
  keywords: ['users', 'admin', '管理'],
};

/**
 * The sidebar's sections for this reader on this instance. Items whose add-on
 * is not configured are dropped here, once, so no nav surface can forget to.
 */
export function getNavigationSections(isAdmin: boolean, features: Features): NavSection[] {
  const sections: NavSection[] = [
    ...CORE.map((item) => ({ items: [item] })),
    { titleKey: 'navigation.sections.loans_sharing', items: LOANS_SHARING },
    { titleKey: 'navigation.sections.more_tools', items: MORE_TOOLS },
  ];

  if (isAdmin) sections.push({ items: [ADMIN] });

  return sections
    .map((section) => ({ ...section, items: section.items.filter((item) => isNavItemAvailable(item, features)) }))
    .filter((section) => section.items.length > 0);
}

/** Whether `item`'s add-on, if it has one, is configured on this instance. */
export function isNavItemAvailable(item: NavItem, features: Features): boolean {
  return !item.feature || features[item.feature];
}

/** Flat list, in sidebar order — what the ⌘K palette searches. */
export function getNavigationItems(isAdmin: boolean, features: Features): NavItem[] {
  return getNavigationSections(isAdmin, features).flatMap((section) => section.items);
}

/** The bottom bar's own tabs; everything else goes in its More sheet. None depends on an add-on. */
export const primaryNavItems: NavItem[] = getNavigationItems(false, ALL_FEATURES).filter((i) => i.primary);

/** The More sheet's links. */
export function getSecondaryNavItems(features: Features): NavItem[] {
  return getNavigationItems(false, features).filter((i) => !i.primary);
}
