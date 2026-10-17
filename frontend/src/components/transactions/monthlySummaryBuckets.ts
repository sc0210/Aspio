/**
 * The Monthly Summary's buckets and row shape, shared by the desktop page and the
 * phone view so their legends cannot drift apart (they did once already, when Debt
 * was split out of Others). Add or recolour a bucket here only.
 */

export interface MonthlySummaryRow {
    month: string; // YYYY-MM
    housing: number;
    eat: number;
    investment?: number;
    /** Wallet-to-wallet moves — its own bucket, not "others" spending. Absent on
     *  a response from before the API reported it. */
    transfer?: number;
    /** Loan and other debt repayments. Split out of `others`, where servicing 信貸
     *  was reading as discretionary spending. Optional for the same reason as
     *  `transfer`: a cached response from before the API reported it. */
    debt?: number;
    others: number;
    /** Every outflow, transfer legs included (see `transfer`). */
    total: number;
    income: number;
}

/**
 * What a month actually spent: every outflow except moves between the user's own
 * wallets. The API counts a transfer's outgoing leg in `total` but drops the
 * incoming one from `income`, so `income - total` read NT$30k moved to Emergency as
 * NT$30k spent. Phone and desktop both answer "what did I keep" with this.
 */
export const spendingOf = (row: Pick<MonthlySummaryRow, 'total' | 'transfer'>): number =>
    Math.max(0, (row.total || 0) - (row.transfer || 0));

export type SummaryBucketKey = 'housing' | 'eat' | 'investment' | 'transfer' | 'debt' | 'others';

/** In display order. `name` labels the desktop chart; its lower case is the
 *  `transactions:monthlySummaryPage.*` key the phone view translates. */
export const SUMMARY_BUCKETS: { key: SummaryBucketKey; name: string; color: string }[] = [
    { key: 'housing', name: 'Housing', color: '#3b82f6' },
    { key: 'eat', name: 'Eat', color: '#f59e0b' },
    { key: 'investment', name: 'Invest', color: '#10b981' },
    { key: 'transfer', name: 'Transfer', color: '#64748b' },
    { key: 'debt', name: 'Debt', color: '#be123c' },
    { key: 'others', name: 'Others', color: '#8b5cf6' },
];
