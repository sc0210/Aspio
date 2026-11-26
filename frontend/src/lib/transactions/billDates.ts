import { localDateString } from '@/utils/formatters';

/** "YYYY-MM-DD" as a local date (a Date of the string would be UTC midnight). */
export function parseDay(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** The bill's day in the month after `lastDate`, clamped to that month's length. */
export function nextAfter(lastDate: string, day: number): string {
  const last = parseDay(lastDate);
  const monthEnd = new Date(last.getFullYear(), last.getMonth() + 2, 0).getDate();
  return localDateString(new Date(last.getFullYear(), last.getMonth() + 1, Math.min(day, monthEnd)));
}
