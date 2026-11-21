/**
 * Chart colours. Recharts takes colours as strings, not classes, so charts had
 * written Tailwind's hex values out by hand: 252 literals, the same handful
 * repeated in 33 files, with light/dark pairs re-spelled per chart.
 *
 * Gain/loss is not here: a market move follows the gains-in-red preference, so
 * use `rgb(var(--rise-500))` / `rgb(var(--fall-500))` or `useMarketColors()`.
 */

/** Series colours: Tailwind's 500 shades, except `gray`, which is gray-400 (the muted series). */
export const SERIES = {
  sky: '#0ea5e9',
  blue: '#3b82f6',
  indigo: '#6366f1',
  violet: '#8b5cf6',
  emerald: '#10b981',
  amber: '#f59e0b',
  orange: '#f97316',
  rose: '#f43f5e',
  red: '#ef4444',
  slate: '#64748b',
  gray: '#9ca3af',
} as const;

/** Axes, gridlines and tooltip surfaces, per theme. */
export function chartChrome(isDark: boolean) {
  return {
    /** Gridlines: gray-700 / gray-200. */
    grid: isDark ? '#374151' : '#e5e7eb',
    /** Tick labels: gray-400 / gray-500. */
    tick: isDark ? '#9ca3af' : '#6b7280',
    /** Card and tooltip surface: gray-800 / white. */
    surface: isDark ? '#1f2937' : '#ffffff',
    /** Tooltip and cursor borders: gray-600 / gray-300. */
    border: isDark ? '#4b5563' : '#d1d5db',
  } as const;
}
