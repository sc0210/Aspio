/**
 * Maps granular transaction categories into the four high-level spending buckets
 * used on the Transactions page (Food / Transport / Housing / Other), so the
 * Growth Forecast card groups expenses the same way the user already sees them.
 *
 * Investment-type categories are tracked separately and EXCLUDED from spending —
 * money moved into investments is saving, not a living expense — and so are wallet
 * transfers (see `isWalletTransfer`).
 *
 * The category LISTS below are shared with `ExpenseGroupSummary` on the Transactions
 * page, which colours and filters by them, and which uses `isTransferCategory` to give
 * transfers their own slice rather than folding them into "others". Its bucketing is
 * still its own: that page shows investment purchases and transfers as labelled
 * groups, where these hooks leave both out of a spending average entirely.
 */

export type ExpenseGroupKey = 'food' | 'transport' | 'housing' | 'other';

interface ExpenseGroupDef {
    key: ExpenseGroupKey;
    /** English fallback label (card localises via i18n key `growthForecast.group_<key>`). */
    label: string;
    icon: string;
}

export const EXPENSE_GROUPS: ExpenseGroupDef[] = [
    { key: 'housing', label: 'Housing', icon: '🏠' },
    { key: 'food', label: 'Food', icon: '🍔' },
    { key: 'transport', label: 'Transport', icon: '🚗' },
    { key: 'other', label: 'Other', icon: '🎯' },
];

// Exported so the Transactions page (ExpenseGroupSummary) colours and filters by the
// same category membership instead of keeping a parallel copy.
export const FOOD_CATEGORIES = [
    '飲食', '食品', '餐飲', 'Dining', 'Food & Dining', 'Groceries', 'Food',
    'dining', 'food_dining', 'food', 'groceries',
];
export const TRANSPORT_CATEGORIES = [
    '交通', '運輸', 'Transportation', 'Transport', 'transit', 'transportation', 'transport',
];
export const HOUSING_CATEGORIES = [
    '住房', '房租', '水電費', 'Housing', 'Rent', 'Utilities', 'housing', 'rent', 'utilities',
];
// The categories the Transactions quick-filter offers first, when the current
// result set actually contains them. These are stored category VALUES, not
// display text — they are matched against `transaction.category`, so they stay
// in the language the rows were written in and are never translated.
export const PRIORITY_CATEGORIES = [
    '飲食',     // Food & Dining
    '交通',     // Transportation
    '購物',     // Shopping
    '娛樂',     // Entertainment
    '住房',     // Housing
    '醫療保健', // Healthcare
];

// Wallet transfers are the user's own money moving between their wallets
// (Life ↔ Emergency), not spending. Both legs are stored as a matching income and
// expense row sharing a `transfer_group_id`, so counting the expense leg while the
// earned-income whitelist drops the matching inflow invents spending that never
// happened: an emergency-fund top-up showed up as consumption of the same size,
// which on a trailing average was enough to pin housing affordability at zero.
//
// The whole category has to BE a transfer, not merely contain the word. The spelling
// varies with whoever typed or imported it — "Transfer", "Bank Transfer", "Transfer to
// Emergency", 轉帳支出 — but a substring rule would also swallow 薪資轉帳 (salary paid by
// bank transfer) and 轉帳手續費 (a transfer fee), dropping real income and real spending
// out of the averages: the same silent miscount, from the opposite direction.
// Deliberately NOT 調帳 — a bookkeeping adjustment is a correction, not a wallet move.
const TRANSFER_PATTERN =
    /^(?:(?:bank|wallet|internal|account)\s+)?transfers?(?:\s+(?:to|from|in|out|between)\b.*)?$|^(?:轉帳|轉賬|轉移|轉入|轉出)(?:支出|收入)?$/i;

/** True for a category that names a wallet-to-wallet move, in either language. */
export function isTransferCategory(category: string | null | undefined): boolean {
    return TRANSFER_PATTERN.test((category ?? '').trim());
}

export const INVESTMENT_CATEGORIES = [
    '投資', '股票', '基金', '債券', '加密貨幣', '證券',
    'Investment', 'Investment Purchase', 'Investment Return', 'Investment Returns',
    'investment purchase', 'investment return', 'Stocks', 'Stock', 'ETF', 'Bonds',
    'Crypto', 'Cryptocurrency', 'investing', 'investment', 'stocks', 'etf', 'bonds',
    'crypto', 'securities',
];

/** Returns the spending bucket for a category, or `null` for investment (excluded). */
export function getExpenseGroupKey(category: string | null | undefined): ExpenseGroupKey | null {
    const c = (category ?? '').trim();
    if (FOOD_CATEGORIES.includes(c)) return 'food';
    if (TRANSPORT_CATEGORIES.includes(c)) return 'transport';
    if (HOUSING_CATEGORIES.includes(c)) return 'housing';
    if (INVESTMENT_CATEGORIES.includes(c)) return null; // saving, not a living expense
    if (isTransferCategory(c)) return null;             // own-wallet move, not spending
    return 'other';
}

// Recurring EARNED income categories — salary / wages / freelance / business /
// commission. This is a WHITELIST, not a blacklist: a user's non-salary inflows
// are open-ended (loans, gifts, refunds, investment proceeds, one-off "Other"
// deposits) and any of them would inflate a monthly average, so only these count.
const EARNED_INCOME_KEYWORDS = [
    'salary', 'wage', 'payroll', 'paycheck',
    'freelance', 'contract', 'consult',
    'business', 'commission',
    '薪', '工資', '月薪', '兼職', '自由', '接案', '事業', '營業', '佣金', '提成',
];

/** The fields needed to recognise a wallet-transfer leg on a transaction row. */
interface TransferRowFields {
    category?: string | null;
    /** Camel-case as the frontend service maps it. */
    transferGroupId?: string | null;
    /** Snake-case as the API sends it, for rows read straight off the wire. */
    transfer_group_id?: string | null;
}

/**
 * True for either leg of a wallet transfer, which no spending or income average
 * should include. `transfer_group_id` is the reliable signal — `create_transfer`
 * stamps it on both rows — and the category check covers legs written before that
 * column existed.
 */
export function isWalletTransfer(row: TransferRowFields): boolean {
    if (row.transferGroupId || row.transfer_group_id) return true;
    return isTransferCategory(row.category);
}

/**
 * True only for recurring EARNED income (salary, freelance, business, commission).
 * Everything else — gifts, loans, transfers, refunds, investment sale proceeds /
 * dividends, and one-off "Other" inflows — is excluded so the forecast's monthly
 * income reflects what actually recurs. The income field stays editable for overrides.
 */
export function isEarnedIncome(category: string | null | undefined): boolean {
    const c = (category ?? '').trim().toLowerCase();
    return EARNED_INCOME_KEYWORDS.some(k => c.includes(k));
}
