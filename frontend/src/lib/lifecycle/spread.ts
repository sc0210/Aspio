/**
 * The spread — what leverage earns minus what it costs.
 *
 * The entire case for borrowing to invest is that the portfolio out-earns the
 * loan. That is an assumption at the start and a measurement afterwards, so
 * this module works from real figures: the actual APR on the loans, and the
 * interest that has actually been paid to date.
 *
 * `LifecycleLoan` is a structural type rather than the `DebtAccount` API model,
 * so the calculators stay free of service imports and trivially testable.
 */

import { calcAmortization, interestThroughMonth } from '@/lib/finance/amortization';

export interface LifecycleLoan {
    id: string;
    name: string;
    /** Remaining principal owed. */
    currentBalance: number;
    /** Original loan amount. */
    principalAmount: number;
    /** Annual rate (APR) in percent, e.g. 2.75. */
    annualRatePct: number;
    /** Contractual monthly payment. */
    monthlyPayment: number;
    /** ISO date the loan started. */
    startDate: string;
    /** Total term in months; null for revolving credit. */
    termMonths: number | null;
}

export interface DebtAggregate {
    /** Combined outstanding balance. */
    balance: number;
    /** Combined monthly payment. */
    monthlyPayment: number;
    /** Balance-weighted APR — the rate the whole position actually pays. */
    blendedRatePct: number;
    /** Longest remaining term across the loans, in months. */
    maxRemainingMonths: number;
    loanCount: number;
}

export function aggregateDebt(loans: LifecycleLoan[]): DebtAggregate {
    // A repaid loan owes nothing, so it contributes nothing — not a balance, not
    // a payment, not a weight on the blended rate. Filtering here rather than at
    // each call site is what keeps a cleared-but-still-active loan (balance 0,
    // `minimum_payment` never zeroed) from leaking a phantom obligation into the
    // stress gauges and the freed-payment term. Skipping the whole loan also
    // covers the case where only one of several has cleared, which a guard on
    // the aggregate balance cannot see.
    const owing = loans.filter((l) => l.currentBalance > 0);

    const balance = owing.reduce((s, l) => s + l.currentBalance, 0);
    const monthlyPayment = owing.reduce((s, l) => s + Math.max(0, l.monthlyPayment), 0);

    // Weight by balance: a 5,000,000 loan at 2% and a 50,000 card at 15% is a
    // 2.1% position, not an 8.5% one.
    const blendedRatePct =
        balance > 0
            ? owing.reduce((s, l) => s + l.currentBalance * l.annualRatePct, 0) / balance
            : 0;

    const maxRemainingMonths = owing.reduce(
        (m, l) => Math.max(m, remainingMonths(l)),
        0,
    );

    return { balance, monthlyPayment, blendedRatePct, maxRemainingMonths, loanCount: owing.length };
}

/**
 * The day of the given month a payment falls due for a loan that started on
 * `startDay`.
 *
 * Clamped to the month's length, so a loan that started on the 31st falls due
 * on the 28th in February rather than on a day that never arrives. Comparing
 * raw day numbers instead would mean a short month can never complete a
 * period, leaving such a loan reading a month behind for the whole of it.
 */
function dueDayIn(year: number, month: number, startDay: number): number {
    const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    return Math.min(startDay, daysInMonth);
}

/** Whole payment periods completed since the loan started, floored at 0. */
export function monthsElapsed(loan: LifecycleLoan, asOf: Date = new Date()): number {
    const start = new Date(loan.startDate);
    if (!Number.isFinite(start.getTime())) return 0;
    // `startDate` is a plain YYYY-MM-DD, which `new Date` parses as UTC
    // midnight, so read its calendar parts back in UTC — local getters would
    // shift it a day earlier anywhere west of Greenwich. `asOf` is a clock
    // instant, so its *local* calendar day is the one to compare against.
    let months =
        (asOf.getFullYear() - start.getUTCFullYear()) * 12 +
        (asOf.getMonth() - start.getUTCMonth());
    // A period is complete only once the day-of-month has come round again —
    // the same rule the backend applies in `_months_elapsed`. Counting
    // calendar months alone credits a payment up to a month before it is
    // actually made, which overstates interest paid and understates the term
    // left, and puts this page at odds with the loans page for most of a month.
    if (asOf.getDate() < dueDayIn(asOf.getFullYear(), asOf.getMonth(), start.getUTCDate())) {
        months -= 1;
    }
    return Math.max(0, months);
}

/** Payments left on the contractual schedule. Revolving credit reports 0. */
function remainingMonths(loan: LifecycleLoan, asOf: Date = new Date()): number {
    if (!loan.termMonths) return 0;
    return Math.max(0, loan.termMonths - monthsElapsed(loan, asOf));
}

export interface InterestToDate {
    /** Interest paid so far, on the contractual schedule. */
    paid: number;
    /** Interest still to come if the loan runs to term. Zero once repaid. */
    remaining: number;
    /**
     * Interest over the full term — or, for a loan already repaid, what it
     * cost, since nothing further will accrue. Always equals paid + remaining.
     */
    total: number;
}

/**
 * What the borrowing has cost so far.
 *
 * Derived from the contractual amortization schedule rather than from payment
 * history: it needs no extra fetch and is exact as long as payments stayed on
 * plan. Early or missed payments will make it an estimate, which is why the UI
 * labels it as on-schedule.
 */
export function interestToDate(loan: LifecycleLoan, asOf: Date = new Date()): InterestToDate {
    if (!loan.termMonths || loan.principalAmount <= 0) {
        return { paid: 0, remaining: 0, total: 0 };
    }
    const schedule = calcAmortization({
        principal: loan.principalAmount,
        annualRatePct: loan.annualRatePct,
        termYears: loan.termMonths / 12,
    });
    const paid = interestThroughMonth(schedule, monthsElapsed(loan, asOf));
    // A repaid loan owes nothing more, whatever instalments the contractual
    // schedule still lists, so stop quoting future interest against a balance
    // of zero — that is what left "still ahead" reflecting the original
    // schedule for a loan already cleared. Reporting `total` as the paid
    // figure keeps the paid + remaining = total invariant intact.
    //
    // `paid` stays the on-schedule estimate above, which for a loan cleared
    // early is an upper bound: nothing records *when* the balance hit zero, so
    // the months are counted to today. Tightening it would need a payoff date
    // on the loan; the full-term total would be a looser bound, not a better
    // one. Consistent with this module's on-schedule basis either way.
    if (loan.currentBalance <= 0) {
        return { paid, remaining: 0, total: paid };
    }
    return {
        paid,
        remaining: Math.max(0, schedule.totalInterest - paid),
        total: schedule.totalInterest,
    };
}

export function totalInterestToDate(loans: LifecycleLoan[], asOf: Date = new Date()): InterestToDate {
    return loans.reduce<InterestToDate>(
        (acc, l) => {
            const i = interestToDate(l, asOf);
            return { paid: acc.paid + i.paid, remaining: acc.remaining + i.remaining, total: acc.total + i.total };
        },
        { paid: 0, remaining: 0, total: 0 },
    );
}

interface SpreadInputs {
    /** Annualized return the portfolio has actually delivered, in percent. */
    realizedReturnPct: number | null;
    /** Blended APR on the investment debt, in percent. */
    borrowingCostPct: number;
    /** Outstanding investment debt the spread is earned on. */
    debtBalance: number;
}

export interface SpreadResult {
    spreadPct: number | null;
    /** Annual currency value of the spread on the borrowed money. */
    annualCarry: number | null;
    isPositive: boolean;
    /** True when there's no return figure yet — too little history to judge. */
    unknown: boolean;
}

export function evaluateSpread({ realizedReturnPct, borrowingCostPct, debtBalance }: SpreadInputs): SpreadResult {
    if (realizedReturnPct === null || !Number.isFinite(realizedReturnPct)) {
        return { spreadPct: null, annualCarry: null, isPositive: false, unknown: true };
    }
    const spreadPct = realizedReturnPct - borrowingCostPct;
    return {
        spreadPct,
        annualCarry: (debtBalance * spreadPct) / 100,
        isPositive: spreadPct > 0,
        unknown: false,
    };
}

interface HoldingReturn {
    /**
     * Position value used as the weight, **in one common currency**.
     *
     * `PortfolioHolding.totalValue` from the API is in the holding's own
     * currency, so callers must convert (e.g. `toTWD`) before passing it here —
     * mixing raw USD and TWD values would silently under-weight the US book by
     * the exchange rate.
     */
    totalValue: number;
    /** Annualized IRR as a decimal (0.15 = 15%), as the API returns it. */
    irr?: number;
}

/**
 * Value-weighted annualized return across holdings, in percent.
 *
 * Uses the per-holding IRR the backend already computes, weighted by position
 * size, so a 10% IRR on a tiny position doesn't outvote a 6% IRR on the bulk of
 * the portfolio. Returns null when no holding has an IRR yet.
 */
export function portfolioRealizedReturnPct(holdings: HoldingReturn[]): number | null {
    let weight = 0;
    let weighted = 0;
    for (const h of holdings) {
        if (h.irr === undefined || h.irr === null || !Number.isFinite(h.irr)) continue;
        const w = Math.max(0, h.totalValue);
        if (w <= 0) continue;
        weight += w;
        weighted += w * h.irr;
    }
    if (weight <= 0) return null;
    return (weighted / weight) * 100;
}
