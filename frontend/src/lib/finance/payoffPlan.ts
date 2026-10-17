/**
 * Debt payoff planning — pure functions, no data fetching.
 *
 * Simulates paying a set of loans month by month and answers: when am I debt
 * free, and how much interest does it cost? Two strategies share one budget —
 * every loan's minimum plus an optional extra — and differ only in which loan
 * the money left over after minimums goes to:
 *
 *   - avalanche: highest interest rate first (least interest paid overall)
 *   - snowball:  smallest balance first (fastest first win)
 *
 * The budget stays constant, so a paid-off loan's minimum rolls into the next
 * target. The baseline both are compared against is "minimums only": each loan
 * paid at its own minimum, nothing rolled over — what the lender's schedule
 * gives you if you change nothing.
 *
 * Rates are annual percentages (2.1 = 2.1%/yr), compounded monthly, matching
 * `amortization.ts`. All loans must share one currency; the caller filters.
 */

export type PayoffStrategy = 'avalanche' | 'snowball';

export interface PayoffLoan {
    id: string;
    name: string;
    balance: number;
    /** Annual interest rate, in percent. */
    annualRatePct: number;
    minimumPayment: number;
}

interface PayoffResult {
    /** Months until every balance is zero; `null` if it never gets there. */
    months: number | null;
    totalInterest: number;
    /** Loans in the order they are paid off, with the month each one clears. */
    payoffOrder: Array<{ id: string; name: string; month: number }>;
    /** Total balance after each month; index 0 is today. */
    series: number[];
}

/** 50 years — past this a plan is "never", not a date. */
export const MAX_MONTHS = 600;

// Below a cent a balance is cleared — float dust must not keep a loan alive.
const EPS = 0.005;

function order(loans: PayoffLoan[], strategy: PayoffStrategy): number[] {
    const idx = loans.map((_, i) => i);
    return strategy === 'avalanche'
        ? idx.sort((a, b) => loans[b].annualRatePct - loans[a].annualRatePct || loans[a].balance - loans[b].balance)
        : idx.sort((a, b) => loans[a].balance - loans[b].balance || loans[b].annualRatePct - loans[a].annualRatePct);
}

function simulate(loans: PayoffLoan[], plan: { strategy: PayoffStrategy; extra: number } | null): PayoffResult {
    const bal = loans.map((l) => Math.max(0, l.balance));
    const rate = loans.map((l) => Math.max(0, l.annualRatePct) / 100 / 12);
    const mins = loans.map((l) => Math.max(0, l.minimumPayment));
    // Targets ranked once, on today's balances — the usual way both methods are run.
    const targets = plan ? order(loans, plan.strategy) : [];
    const budget = plan ? mins.reduce((s, m) => s + m, 0) + Math.max(0, plan.extra) : 0;

    const payoffOrder: PayoffResult['payoffOrder'] = [];
    const cleared = bal.map((b) => b <= EPS);
    const series = [bal.reduce((s, b) => s + b, 0)];
    let totalInterest = 0;
    let month = 0;

    while (cleared.some((c) => !c) && month < MAX_MONTHS) {
        month++;
        for (let i = 0; i < bal.length; i++) {
            if (cleared[i]) continue;
            const interest = bal[i] * rate[i];
            bal[i] += interest;
            totalInterest += interest;
        }

        let pool = budget;
        for (let i = 0; i < bal.length; i++) {
            if (cleared[i]) continue;
            const pay = Math.min(mins[i], bal[i]);
            bal[i] -= pay;
            pool -= pay;
        }
        if (plan) {
            for (const i of targets) {
                if (pool <= EPS) break;
                if (bal[i] <= EPS) continue;
                const pay = Math.min(pool, bal[i]);
                bal[i] -= pay;
                pool -= pay;
            }
        }

        for (let i = 0; i < bal.length; i++) {
            if (!cleared[i] && bal[i] <= EPS) {
                cleared[i] = true;
                bal[i] = 0;
                payoffOrder.push({ id: loans[i].id, name: loans[i].name, month });
            }
        }
        series.push(bal.reduce((s, b) => s + b, 0));
    }

    return {
        months: cleared.every(Boolean) ? month : null,
        totalInterest,
        payoffOrder,
        series,
    };
}

/** Each loan at its own minimum, nothing rolled over. */
export function minimumsOnly(loans: PayoffLoan[]): PayoffResult {
    return simulate(loans, null);
}

/** One budget (all minimums + extra), leftovers aimed by strategy. */
export function payoffPlan(loans: PayoffLoan[], strategy: PayoffStrategy, extraMonthly: number): PayoffResult {
    return simulate(loans, { strategy, extra: extraMonthly });
}

/** The calendar month a plan of `months` lands in, counting from `from`. */
export function monthsFrom(from: Date, months: number): Date {
    return new Date(from.getFullYear(), from.getMonth() + months, 1);
}

/** The fields a loan record needs to be planned — structural, so this file
 *  doesn't depend on the service layer. Decimals may arrive as strings. */
interface DebtAccountLike {
    id: string;
    name: string;
    currency: string;
    current_balance: number | string;
    interest_rate: number | string;
    minimum_payment: number | string;
}

/**
 * Loans ready to plan. A plan never mixes currencies: it takes the currency
 * holding the most debt and reports how many loans in others it left out.
 */
export function planInputs(loans: ReadonlyArray<DebtAccountLike>): { currency: string; loans: PayoffLoan[]; excluded: number } {
    const byCurrency = new Map<string, number>();
    for (const l of loans) byCurrency.set(l.currency, (byCurrency.get(l.currency) ?? 0) + (Number(l.current_balance) || 0));
    const currency = [...byCurrency.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'TWD';
    const inPlan = loans.filter((l) => l.currency === currency);
    return {
        currency,
        loans: inPlan.map((l) => ({
            id: l.id,
            name: l.name,
            balance: Number(l.current_balance) || 0,
            annualRatePct: Number(l.interest_rate) || 0,
            minimumPayment: Number(l.minimum_payment) || 0,
        })),
        excluded: loans.length - inPlan.length,
    };
}
