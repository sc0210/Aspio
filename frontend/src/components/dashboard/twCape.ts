// What the desktop CAPE card and the phone highlight share. No recharts here,
// so the phone dashboard can use it without pulling the chart library in.
import type { CapeBand } from '@/hooks/useTwCape';

export const BAND_LABEL: Record<CapeBand, string> = { cheap: 'Cheap', fair: 'Fair', expensive: 'Expensive' };

export const BAND_STYLE: Record<CapeBand, string> = {
  cheap: 'bg-prosperity-100 dark:bg-prosperity-900/40 text-prosperity-700 dark:text-prosperity-300',
  fair: 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300',
  expensive: 'bg-warning-100 dark:bg-warning-900/40 text-warning-800 dark:text-warning-300',
};

/** "2015-03" as a short month and year in the UI language ("Mar 2015", "2015年3月"). */
export function monthLabel(isoMonth: string | null | undefined, language: string): string {
  const [y, m] = (isoMonth ?? '').split('-').map(Number);
  // A malformed month would make Intl throw while rendering the dashboard.
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) return '';
  return new Intl.DateTimeFormat(language, { year: 'numeric', month: 'short' }).format(new Date(y, m - 1, 1));
}
