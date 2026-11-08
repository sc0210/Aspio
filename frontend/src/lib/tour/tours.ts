/**
 * The page tours: for each page, the parts worth pointing at, in reading order.
 *
 * A step's `target` is a `data-tour="…"` marker in the page; a step without one
 * is a centred card. Steps whose marker isn't on screen are skipped when the
 * tour starts, so one definition serves desktop and phone layouts (each shows
 * the markers it has). Copy is in the `common` namespace under `tour.<id>.*`,
 * with English here as the fallback.
 */

export interface TourStep {
  /** data-tour marker to spotlight; omitted for a centred card. */
  target?: string;
  key: string;
  title: string;
  body: string;
}

export interface Tour {
  id: string;
  /** Pathnames this tour belongs to (exact match). */
  paths: string[];
  steps: TourStep[];
}

/** Steps about the app shell, shared by every tour that ends with them. */
const SHELL: TourStep[] = [
  { target: 'nav', key: 'shell.nav', title: 'Getting around',
    body: 'Every page lives here: Transactions, Portfolio, Savings with partners, Goals, Loans and Month in Review.' },
  { target: 'nav-mobile', key: 'shell.navMobile', title: 'Getting around',
    body: 'The main pages are one tap away; More holds the rest.' },
  { target: 'search', key: 'shell.search', title: 'Search anything',
    body: 'Jump to any page or action. The shortcut is ⌘K (Ctrl+K on Windows).' },
  { target: 'updates', key: 'shell.updates', title: 'What’s new and alerts',
    body: 'Release notes for each update, and alerts for goals, payments due and shared bills.' },
  { target: 'tour-button', key: 'shell.tourButton', title: 'A tour on every page',
    body: 'Press this on any page for a tour of that page. That’s it, enjoy!' },
];

export const TOURS: Tour[] = [
  {
    id: 'dashboard',
    paths: ['/', '/dashboard'],
    steps: [
      { key: 'dashboard.intro', title: 'Welcome to Aspiro',
        body: 'A one-minute look at this page. Use Next and Back, or the arrow keys; Esc ends the tour.' },
      { target: 'dash-wallets', key: 'dashboard.wallets', title: 'Net worth and three wallets',
        body: 'Life is your day-to-day cash, Emergency your safety fund, Portfolio your investments. Net worth is all three, less any debt.' },
      { target: 'dash-shared', key: 'dashboard.shared', title: 'Shared bills',
        body: 'When you split bills with a partner, this says who owes whom, and why your wallets differ from your bank until it’s settled.' },
      { target: 'dash-flow', key: 'dashboard.flow', title: 'Money in and out',
        body: 'Income, spending and what you kept over the period you pick.' },
      ...SHELL,
    ],
  },
  {
    id: 'transactions',
    paths: ['/transactions'],
    steps: [
      { key: 'transactions.intro', title: 'Transactions',
        body: 'Every income and expense. Every figure in the app is worked out from these.' },
      { target: 'page-actions', key: 'transactions.actions', title: 'Add, search, import',
        body: 'Add a transaction, search, scan a receipt, or bring in a CSV from your bank or another app with Export / Import.' },
      { target: 'tx-stats', key: 'transactions.stats', title: 'At a glance',
        body: 'Income, spending and net for whatever the filters show.' },
      { target: 'tx-filters', key: 'transactions.filters', title: 'Filter and analyse',
        body: 'Narrow by type, wallet, dates or category, show only shared bills, and see where the money went.' },
      { target: 'tx-list', key: 'transactions.list', title: 'Your transactions',
        body: 'Grouped by day. Each row’s ⋮ menu edits it, deletes it, or splits it with a partner.' },
      // The phone layout: a focused view, with the full tools on a larger screen.
      { target: 'tx-m-hero', key: 'transactions.mHero', title: 'This month',
        body: 'What you’ve spent against what came in so far this month.' },
      { target: 'tx-m-recent', key: 'transactions.mRecent', title: 'Recent transactions',
        body: 'Your latest entries by day; tap one to edit it. Filters, search and import are on a larger screen.' },
      { target: 'tour-button', key: 'shell.tourButton', title: 'A tour on every page',
        body: 'Press this on any page for a tour of that page. That’s it, enjoy!' },
    ],
  },
  {
    id: 'portfolio',
    paths: ['/portfolio'],
    steps: [
      { key: 'portfolio.intro', title: 'Portfolio',
        body: 'Your investments: stocks, ETFs and crypto, with prices kept up to date.' },
      { target: 'page-actions', key: 'portfolio.actions', title: 'Add and manage',
        body: 'Add a holding, refresh prices, switch between list and allocation, and import or export from the ⋯ menu.' },
      { target: 'pf-stats', key: 'portfolio.stats', title: 'How it’s doing',
        body: 'Total value, returns and risk across everything you hold.' },
      { target: 'pf-holdings', key: 'portfolio.holdings', title: 'Holdings',
        body: 'Each position with its value and return. Buying one takes the cash from your Life Wallet; selling puts it back.' },
      { target: 'pf-m-hero', key: 'portfolio.mHero', title: 'Your portfolio',
        body: 'Total value, your gain, and how it’s spread across assets.' },
      { target: 'pf-m-holdings', key: 'portfolio.mHoldings', title: 'Top holdings',
        body: 'Your biggest positions, each with its value and return. Adding and editing holdings is on a larger screen.' },
      { target: 'tour-button', key: 'shell.tourButton', title: 'A tour on every page',
        body: 'Press this on any page for a tour of that page. That’s it, enjoy!' },
    ],
  },
  {
    id: 'savings',
    paths: ['/savings'],
    steps: [
      { key: 'savings.intro', title: 'Saving with others',
        body: 'Goals you save toward with a partner, and bills you split with them.' },
      { target: 'sav-members', key: 'savings.members', title: 'Partners',
        body: 'The people you save and split with. Add Member sends an invite; they accept from their own account.' },
      { target: 'sav-tabs', key: 'savings.tabs', title: 'Three views',
        body: 'Shared goals you save toward together, Shared spending for split bills and settling up, and Compare.' },
      { target: 'tour-button', key: 'shell.tourButton', title: 'A tour on every page',
        body: 'Press this on any page for a tour of that page. That’s it, enjoy!' },
    ],
  },
  {
    id: 'goals',
    paths: ['/goals'],
    steps: [
      { key: 'goals.intro', title: 'Goals',
        body: 'What you’re saving toward, and how close you are.' },
      { target: 'page-actions', key: 'goals.actions', title: 'Create a goal',
        body: 'Name it, set a target and a date; contributions move it along.' },
      { target: 'goals-retire', key: 'goals.retire', title: 'Retirement',
        body: 'Tracks your Portfolio against a retirement target of your choosing.' },
      { target: 'goals-filters', key: 'goals.filters', title: 'Filter',
        body: 'Show goals by status or category.' },
      { target: 'goals-m-hero', key: 'goals.mHero', title: 'Your main goal',
        body: 'How close your top goal is, at a glance.' },
      { target: 'goals-m-list', key: 'goals.mList', title: 'Other goals',
        body: 'Every other goal, with how far along it is.' },
      { target: 'tour-button', key: 'shell.tourButton', title: 'A tour on every page',
        body: 'Press this on any page for a tour of that page. That’s it, enjoy!' },
    ],
  },
  {
    id: 'loans',
    paths: ['/loans'],
    steps: [
      { key: 'loans.intro', title: 'Loans and debt',
        body: 'What you owe, what’s due next, and when you’ll be clear.' },
      { target: 'page-actions', key: 'loans.actions', title: 'Add a loan',
        body: 'Enter what’s still owed today; past payments aren’t needed.' },
      { target: 'loans-stats', key: 'loans.stats', title: 'Your debt',
        body: 'The total owed and the next payment.' },
      { target: 'loans-plan', key: 'loans.plan', title: 'Debt-free date',
        body: 'When you’ll be clear at today’s payments, and what extra money would change.' },
      { target: 'loans-list', key: 'loans.list', title: 'Each loan',
        body: 'Record a payment here, or link an expense to a loan when you add it so it pays the loan down.' },
      { target: 'loans-m-hero', key: 'loans.mHero', title: 'What you owe',
        body: 'Your total debt, and the next payment due.' },
      { target: 'loans-m-list', key: 'loans.mList', title: 'Each loan',
        body: 'How far along each loan is, and a tap to record a payment.' },
      { target: 'tour-button', key: 'shell.tourButton', title: 'A tour on every page',
        body: 'Press this on any page for a tour of that page. That’s it, enjoy!' },
    ],
  },
  {
    id: 'review',
    paths: ['/review'],
    steps: [
      { key: 'review.intro', title: 'Month in Review',
        body: 'One month, read as a story: what came in, what went out, and what changed.' },
      { target: 'rev-month', key: 'review.month', title: 'Pick a month',
        body: 'Any month you have data for.' },
      { target: 'rev-hero', key: 'review.hero', title: 'The verdict',
        body: 'Did you spend less than you earned, and by how much.' },
      { target: 'rev-breakdown', key: 'review.breakdown', title: 'Where it went',
        body: 'Spending by category, and where the income came from.' },
      { target: 'tour-button', key: 'shell.tourButton', title: 'A tour on every page',
        body: 'Press this on any page for a tour of that page. That’s it, enjoy!' },
    ],
  },
];

export function tourFor(pathname: string | null): Tour | undefined {
  if (!pathname) return undefined;
  return TOURS.find((t) => t.paths.includes(pathname));
}

/** Per-browser memory: whether the first-visit invitation was answered, and which tours were finished. */
export const TOUR_STORAGE_KEY = 'aspiro-tour';
export const TOUR_EVENT = 'aspiro:start-tour';

export interface TourMemory {
  prompted: boolean;
  done: string[];
}

export function readTourMemory(): TourMemory {
  try {
    const raw = localStorage.getItem(TOUR_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return { prompted: Boolean(parsed.prompted), done: Array.isArray(parsed.done) ? parsed.done : [] };
  } catch {
    return { prompted: false, done: [] };
  }
}

export function writeTourMemory(update: Partial<TourMemory>): void {
  try {
    localStorage.setItem(TOUR_STORAGE_KEY, JSON.stringify({ ...readTourMemory(), ...update }));
  } catch {
    // Private mode / blocked storage: the invitation may show again, nothing worse.
  }
}

export function startTour(): void {
  window.dispatchEvent(new Event(TOUR_EVENT));
}
