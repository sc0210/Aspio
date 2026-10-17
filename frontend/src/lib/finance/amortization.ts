/**
 * Level-payment (annuity) loan amortization — pure functions, no data fetching.
 *
 * Generic to any fixed-rate amortizing loan: mortgages, personal loans (信貸),
 * auto loans. Lived under `lib/housing/mortgage.ts` until the lifecycle-investing
 * page needed the same math for investment debt; `lib/housing/mortgage.ts` now
 * re-exports from here under its original names.
 *
 * All amounts are in the account's base currency (TWD by default). Rates are
 * given as annual percentages (e.g. 2.1 = 2.1%/yr) and converted to a monthly
 * rate internally.
 */

interface AmortizationInputs {
    /** Loan principal. */
    principal: number;
    /** Annual interest rate, in percent (e.g. 2.1). */
    annualRatePct: number;
    /** Loan term in years (e.g. 30). */
    termYears: number;
}

export interface AmortizationMonth {
    /** 1-indexed month number. */
    month: number;
    /** Interest portion of this month's payment. */
    interest: number;
    /** Principal portion of this month's payment. */
    principal: number;
    /** Remaining loan balance after this payment. */
    balance: number;
}

export interface AmortizationResult {
    /** Level monthly payment (principal + interest). */
    monthlyPayment: number;
    /** Total interest paid over the full term. */
    totalInterest: number;
    /** Total of all payments over the full term. */
    totalPaid: number;
    /** Number of monthly payments (termYears * 12). */
    months: number;
    /** Full amortization schedule, one row per month. */
    schedule: AmortizationMonth[];
}

/**
 * Level-payment (annuity) loan.
 *
 * M = P · r · (1+r)^n / ((1+r)^n − 1), with r = monthly rate, n = months.
 * Handles the r = 0 (interest-free) edge case as a straight-line payoff.
 */
export function calcAmortization({ principal, annualRatePct, termYears }: AmortizationInputs): AmortizationResult {
    const months = Math.max(1, Math.round(termYears * 12));
    const p = Math.max(0, principal);
    const r = annualRatePct / 100 / 12;

    let monthlyPayment: number;
    if (r === 0) {
        monthlyPayment = p / months;
    } else {
        const factor = Math.pow(1 + r, months);
        monthlyPayment = (p * r * factor) / (factor - 1);
    }

    const schedule: AmortizationMonth[] = [];
    let balance = p;
    let totalInterest = 0;

    for (let m = 1; m <= months; m++) {
        const interest = balance * r;
        let principalPaid = monthlyPayment - interest;
        // Guard against tiny floating-point overshoot on the final payment.
        if (principalPaid > balance) principalPaid = balance;
        balance = Math.max(0, balance - principalPaid);
        totalInterest += interest;
        schedule.push({ month: m, interest, principal: principalPaid, balance });
    }

    return {
        monthlyPayment,
        totalInterest,
        totalPaid: p + totalInterest,
        months,
        schedule,
    };
}
/**
 * Interest accrued over the first `monthsElapsed` months of the schedule.
 * Used to show what leverage has cost so far, assuming payments stayed on plan.
 */
export function interestThroughMonth(result: AmortizationResult, monthsElapsed: number): number {
    if (monthsElapsed <= 0) return 0;
    const end = Math.min(monthsElapsed, result.schedule.length);
    let sum = 0;
    for (let i = 0; i < end; i++) sum += result.schedule[i].interest;
    return sum;
}

/**
 * Months until a balance is cleared at a given fixed monthly payment.
 *
 * Solves the amortization identity for n rather than stepping a schedule, so a
 * caller can ask "how much longer?" from any mid-loan balance:
 *
 *     n = −ln(1 − B·r/P) / ln(1+r)
 *
 * Returns null when the payment never clears the balance — either it is zero or
 * it does not even cover the monthly interest, in which case the log argument
 * would be non-positive and the loan runs forever.
 */
export function monthsToPayoff(
    balance: number,
    annualRatePct: number,
    monthlyPayment: number,
): number | null {
    if (balance <= 0) return 0;
    if (monthlyPayment <= 0) return null;

    const r = annualRatePct / 100 / 12;
    if (r <= 0) return Math.ceil(balance / monthlyPayment);

    const monthlyInterest = balance * r;
    if (monthlyPayment <= monthlyInterest) return null;

    return Math.ceil(-Math.log(1 - monthlyInterest / monthlyPayment) / Math.log(1 + r));
}
