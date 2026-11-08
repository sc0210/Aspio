/**
 * The same day next month, as YYYY-MM-DD; the last day when next month is
 * shorter (31 Jan → 28/29 Feb), the way a monthly bill moves.
 */
export function sameDayNextMonth(isoDay: string): string {
  const [y, m, d] = isoDay.split('-').map(Number);
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate(); // m is 1-based: this is next month's last day
  const day = Math.min(d, lastDay);
  const next = new Date(Date.UTC(y, m, day)); // month index m = next month
  return next.toISOString().slice(0, 10);
}
