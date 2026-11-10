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

export type RepeatFrequency = 'weekly' | 'monthly' | 'yearly';

/** English fallbacks for `savings.splits.repeat.every.*`, one place for the form and the list. */
export const EVERY: Record<RepeatFrequency, string> = { weekly: 'Every week', monthly: 'Every month', yearly: 'Every year' };

/**
 * The next date a bill comes round, as the backend steps it: a week on, the same
 * day next month (clamped), or the same day next year (29 Feb → 28 Feb).
 */
export function nextOccurrence(isoDay: string, frequency: RepeatFrequency): string {
  if (frequency === 'monthly') return sameDayNextMonth(isoDay);
  const [y, m, d] = isoDay.split('-').map(Number);
  if (frequency === 'weekly') return new Date(Date.UTC(y, m - 1, d + 7)).toISOString().slice(0, 10);
  const lastDay = new Date(Date.UTC(y + 1, m, 0)).getUTCDate(); // that month next year
  return new Date(Date.UTC(y + 1, m - 1, Math.min(d, lastDay))).toISOString().slice(0, 10);
}

/** What a bill costs per month on average: a weekly one 52 times a year, a yearly one once. */
export function perMonth(amount: number, frequency: string): number {
  if (frequency === 'weekly') return (amount * 52) / 12;
  if (frequency === 'yearly') return amount / 12;
  return amount;
}
