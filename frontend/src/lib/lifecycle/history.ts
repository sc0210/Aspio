/**
 * Leverage over a period, rather than only where it stands today.
 *
 * The headline ratio answers "am I on plan right now". It cannot answer the
 * question that actually decides whether the strategy is working: **which way
 * has it been moving, and did it ever go somewhere it should not have been.**
 * A position that reads 1.4× today looks identical whether it drifted down from
 * 1.9× or climbed from 1.1× — and only one of those is deleveraging.
 *
 * Reconstruction, not storage: nothing records past leverage. Two halves,
 * assembled per day.
 *
 *   assets — the wallet balances the trend endpoint replays from the ledger.
 *   debt   — the per-loan balances the same endpoint derives from the payments
 *            actually recorded against each loan.
 *
 * Both are measured. The debt half in particular is not an estimate: the same
 * payment transactions drive `current_balance` on the loan itself, so the series
 * and today's headline agree by construction rather than by luck.
 *
 * `debtBalanceAt` below is the fallback for a payload that carries no per-loan
 * breakdown, and walks a contractual schedule instead. It is deliberately the
 * second choice — a schedule drifts by every early or missed payment ever made.
 *
 * Pure functions; amounts in base currency.
 */

import { calcAmortization, type AmortizationResult } from '@/lib/finance/amortization';
import { localDateString } from '@/utils/formatters';
import { evaluatePosition } from './leverage';
import { monthsElapsed, type LifecycleLoan } from './spread';

/** One day of the reconstructed position. */
export interface LeverageHistoryPoint {
    /** Plain YYYY-MM-DD, as the trend endpoint returns it. */
    date: string;
    stockExposure: number;
    cashAssets: number;
    investmentDebt: number;
    netFinancialAssets: number;
    /**
     * Exposure ÷ net financial assets, or `null` for a day the position was
     * underwater. Null rather than Infinity so a chart breaks the line instead
     * of spiking it off the axis.
     */
    leverage: number | null;
}

/** The wallet-trend shape this consumes — kept structural so the hook's type is not a dependency. */
export interface WalletDayBalances {
    date: string;
    lifeWallet: number;
    portfolioWallet: number;
    emergencyWallet: number;
    /**
     * Outstanding balance per loan id on this date, as recorded.
     *
     * Absent only from a payload that predates the field (or the demo one,
     * where it is an empty object rather than missing — that distinction is
     * what lets "no debt" be told from "not reported").
     */
    debtByLoan?: Record<string, number>;
}

/**
 * A YYYY-MM-DD as local midnight.
 *
 * `new Date('2026-08-26')` is parsed as *UTC* midnight, and `monthsElapsed`
 * reads its `asOf` through local getters — so west of Greenwich the plain parse
 * lands on the previous calendar day and the loan reads a month behind for the
 * first days of every month. Building from the parts sidesteps the whole
 * question.
 */
function localMidnight(isoDate: string): Date {
    const [y, m, d] = isoDate.slice(0, 10).split('-').map(Number);
    return new Date(y, (m ?? 1) - 1, d ?? 1);
}

/**
 * What was owed on one loan on a given day.
 *
 * Exact at `now` for every loan, and accurate going back as long as payments
 * followed the contract. Two cases it can only estimate, both documented at the
 * call site in the UI:
 *
 *   * revolving credit (no term) has no schedule to walk, so its balance is
 *     held flat at today's — better than inventing an amortization it does not
 *     have;
 *   * a cleared loan reports zero for the whole window. Nothing records *when*
 *     the balance hit zero, and walking its schedule back from zero would post
 *     a month of principal onto every past day — a loan settled two years ago
 *     would show ~3 months of phantom debt across a 90-day window and
 *     manufacture a "you deleveraged" story out of it. Where the window really
 *     does straddle a payoff, the measured breakdown has the answer and this
 *     path is not used.
 */
export function debtBalanceAt(
    loan: LifecycleLoan,
    asOf: Date,
    now: Date = new Date(),
    schedules?: Map<string, AmortizationResult>,
): number {
    if (asOf >= now) return Math.max(0, loan.currentBalance);
    if (loan.currentBalance <= 0) return 0;

    // Before the money was borrowed there was no debt — without this the series
    // shows leverage on a loan that did not exist yet, which reads as a sudden
    // improvement on the day it was actually taken on.
    const startDay = String(loan.startDate ?? '').slice(0, 10);
    if (startDay && asOf < localMidnight(startDay)) return 0;

    if (!loan.termMonths || loan.principalAmount <= 0) {
        return Math.max(0, loan.currentBalance);
    }

    // A 1-year window over a 30-year loan rebuilds a 360-row schedule 365 times
    // without this — synchronously, inside a render-time useMemo.
    const cached = schedules?.get(loan.id);
    const { schedule } = cached ?? calcAmortization({
        principal: loan.principalAmount,
        annualRatePct: loan.annualRatePct,
        termYears: loan.termMonths / 12,
    });
    if (schedules && !cached) {
        schedules.set(loan.id, { schedule } as AmortizationResult);
    }

    const from = monthsElapsed(loan, asOf);
    const to = monthsElapsed(loan, now);

    let principalRepaidSince = 0;
    for (let i = from; i < to && i < schedule.length; i += 1) {
        principalRepaidSince += schedule[i].principal;
    }

    return Math.min(
        loan.principalAmount,
        Math.max(0, loan.currentBalance) + principalRepaidSince,
    );
}

/** Investment debt across the selected loans on a given day, by schedule. */
export function investmentDebtAt(
    loans: LifecycleLoan[],
    asOf: Date,
    now: Date = new Date(),
    schedules?: Map<string, AmortizationResult>,
): number {
    return loans.reduce((sum, loan) => sum + debtBalanceAt(loan, asOf, now, schedules), 0);
}

/**
 * What the selected loans owed on a day, from the recorded payments.
 *
 * The endpoint reports every loan; the strategy only counts the ones the user
 * marked as investment debt, so the subset is summed here rather than reading
 * the total it also publishes.
 */
function measuredDebtFor(
    loans: LifecycleLoan[],
    byLoan: Record<string, number>,
): number {
    return loans.reduce((sum, loan) => sum + (Number(byLoan[loan.id]) || 0), 0);
}

interface LeverageHistoryInputs {
    /** Daily wallet balances, oldest first. */
    points: WalletDayBalances[];
    /** The loans the user marked as investment debt. */
    loans: LifecycleLoan[];
    /**
     * Today's position as the rest of the page computes it.
     *
     * The final point is *known*, not inferred, so it should not be read off a
     * trend series that may lag a day or round differently — the headline and
     * the last point of the chart sit on the same screen, and a reader who sees
     * them disagree has no way to tell which one is wrong.
     */
    today?: { stockExposure: number; cashAssets: number; investmentDebt: number };
    now?: Date;
}



/**
 * The position, day by day.
 *
 * Each day goes through `evaluatePosition` — the same function behind the
 * headline — so the historical ratio cannot drift from the live one through a
 * second definition of leverage.
 */
export function buildLeverageHistory({
    points,
    loans,
    today,
    now = new Date(),
}: LeverageHistoryInputs): LeverageHistoryPoint[] {
    // One schedule per loan for the whole window, not one per loan per day.
    const schedules = new Map<string, AmortizationResult>();

    const rows = points.map((p) => {
        const asOf = localMidnight(p.date);
        const position = evaluatePosition({
            stockExposure: Number(p.portfolioWallet) || 0,
            cashAssets: (Number(p.lifeWallet) || 0) + (Number(p.emergencyWallet) || 0),
            // Recorded payments where the payload has them; a contractual
            // schedule only where it does not.
            investmentDebt: p.debtByLoan
                ? measuredDebtFor(loans, p.debtByLoan)
                : investmentDebtAt(loans, asOf, now, schedules),
        });

        return toPoint(p.date, position);
    });

    if (!today) return rows;

    const todayRow = toPoint(localDateString(now), evaluatePosition(today));
    // Replace rather than append when the series already reaches today —
    // otherwise the chart shows the same day twice, at two different values.
    return rows.length && rows[rows.length - 1].date === todayRow.date
        ? [...rows.slice(0, -1), todayRow]
        : [...rows, todayRow];
}

function toPoint(date: string, position: ReturnType<typeof evaluatePosition>): LeverageHistoryPoint {
    return {
        date,
        stockExposure: position.stockExposure,
        cashAssets: position.cashAssets,
        investmentDebt: position.investmentDebt,
        netFinancialAssets: position.netFinancialAssets,
        // Null rather than Infinity so a chart breaks the line instead of
        // spiking it off the axis.
        leverage: Number.isFinite(position.leverage) ? position.leverage : null,
    };
}

interface LeverageHistorySummary {
    /** Leverage at the start and end of the window, when measurable. */
    start: number | null;
    end: number | null;
    /** end − start, in leverage points. Null when either end is unmeasurable. */
    change: number | null;
    peak: { value: number; date: string } | null;
    trough: { value: number; date: string } | null;
    /** Days spent above the hard ceiling — the one number that is not a preference. */
    daysOverCeiling: number;
    /** Days the position was underwater, where no ratio exists. */
    daysUnderwater: number;
    /** Debt at the start and end, so the reader can see *why* the ratio moved. */
    debtStart: number;
    debtEnd: number;
    /**
     * Whether the window contained any borrowing at all.
     *
     * Not derivable from the two ends: a loan taken out and cleared inside the
     * window reads as zero at both of them, and calling that "never borrowed"
     * would suppress the leverage narration for the one window where the user
     * actually was levered.
     */
    everBorrowed: boolean;
}

/**
 * Reduce the series to what is worth stating in words.
 *
 * The direction of travel matters more than any single day, so `change` is the
 * headline: leverage falling while debt falls is the strategy working, while
 * leverage falling only because the market rose is not the same thing — which
 * is why debt at both ends is reported beside it.
 */
export function summarizeLeverageHistory(
    rows: LeverageHistoryPoint[],
    maxLeverage: number,
): LeverageHistorySummary {
    const measured = rows.filter((r): r is LeverageHistoryPoint & { leverage: number } =>
        r.leverage !== null);

    const start = measured.length ? measured[0].leverage : null;
    const end = measured.length ? measured[measured.length - 1].leverage : null;

    let peak: { value: number; date: string } | null = null;
    let trough: { value: number; date: string } | null = null;
    for (const row of measured) {
        if (!peak || row.leverage > peak.value) peak = { value: row.leverage, date: row.date };
        if (!trough || row.leverage < trough.value) trough = { value: row.leverage, date: row.date };
    }

    return {
        start,
        end,
        change: start !== null && end !== null ? end - start : null,
        peak,
        trough,
        daysOverCeiling: measured.filter((r) => r.leverage > maxLeverage).length,
        daysUnderwater: rows.length - measured.length,
        // From the *measured* ends, matching `start`/`end` above. Reading debt
        // off the raw ends instead would attribute a change in leverage to a
        // repayment that happened on a day the change was never measured
        // against — the two figures are only meaningful read together.
        debtStart: measured.length ? measured[0].investmentDebt : 0,
        debtEnd: measured.length ? measured[measured.length - 1].investmentDebt : 0,
        /** True when any day in the window carried investment debt. */
        everBorrowed: rows.some((r) => r.investmentDebt > 0),
    };
}
