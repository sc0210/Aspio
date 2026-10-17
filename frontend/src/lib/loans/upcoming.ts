/**
 * The loan payments falling due in the next few weeks, across every active loan.
 *
 * The API gives each loan one `next_payment_date`; a loan due on the 5th whose
 * next date is 3 days away is also due again within a 30-day window, so later
 * months are projected from the same day of month. A date already in the past
 * is kept and flagged overdue rather than dropped: that is the one you most
 * need to see.
 */

export interface UpcomingLoanLike {
    id: string;
    name: string;
    status: string;
    currency: string;
    minimum_payment: number | string;
    next_payment_date: string | null;
}

interface UpcomingPayment {
    loanId: string;
    name: string;
    /** YYYY-MM-DD. */
    date: string;
    amount: number;
    currency: string;
    /** Negative when overdue, 0 today. */
    daysAway: number;
}

const DAY_MS = 86_400_000;

function parseDay(s: string): Date {
    const [y, m, d] = s.slice(0, 10).split('-').map(Number);
    return new Date(y, m - 1, d);
}

function dayString(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Same day next month, clamped to the month's last day (the 31st becomes the 30th or the 28th). */
function nextMonth(d: Date, dayOfMonth: number): Date {
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    const last = new Date(y, m + 1, 0).getDate();
    return new Date(y, m, Math.min(dayOfMonth, last));
}

export function upcomingPayments(
    loans: ReadonlyArray<UpcomingLoanLike>,
    today: Date,
    horizonDays = 30,
): UpcomingPayment[] {
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    // Calendar arithmetic, not milliseconds: a DST change must not move the edge.
    const horizon = new Date(start.getFullYear(), start.getMonth(), start.getDate() + horizonDays);
    const out: UpcomingPayment[] = [];
    for (const loan of loans) {
        if (loan.status !== 'active' || !loan.next_payment_date) continue;
        const amount = Number(loan.minimum_payment) || 0;
        if (amount <= 0) continue; // no minimum set: nothing to remind about
        let due = parseDay(loan.next_payment_date);
        const dayOfMonth = due.getDate();
        const push = (d: Date) => out.push({
            loanId: loan.id,
            name: loan.name,
            date: dayString(d),
            amount,
            currency: loan.currency || 'TWD',
            daysAway: Math.round((d.getTime() - start.getTime()) / DAY_MS),
        });
        // Overdue: the recorded date once. The months between it and today are
        // not invented as further missed payments — only the future is projected.
        if (due < start) {
            push(due);
            while (due < start) due = nextMonth(due, dayOfMonth);
        }
        for (let guard = 0; due <= horizon && guard < 3; guard++) {
            push(due);
            due = nextMonth(due, dayOfMonth);
        }
    }
    return out.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
}
