/**
 * Emergency-fund runway for demo mode: the emergency wallet over the LAST COMPLETE
 * calendar month's spending.
 *
 * Demo stats are month-to-date, which is a partial month on every day but the
 * last: dividing by it read dozens of months early in the month and fell daily,
 * and scaling it by the day count blew up on the 1st, when rent lands.
 */
export function demoEmergencyRunway(
  emergency: number,
  transactions: ReadonlyArray<{ type: string; amount: number; date: string | Date }>,
  now: Date = new Date(),
): number | null {
  const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const end = new Date(now.getFullYear(), now.getMonth(), 1);
  const spent = transactions
    .filter((t) => t.type === 'expense')
    .filter((t) => {
      const d = new Date(t.date);
      return d >= start && d < end;
    })
    .reduce((sum, t) => sum + Number(t.amount || 0), 0);
  return spent > 0 ? emergency / spent : null;
}
