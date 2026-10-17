/**
 * The hues both lifecycle charts draw with.
 *
 * Shared rather than repeated so "your leverage" is the same colour on the
 * glidepath and on the history chart — the two sit on one page and are read as
 * one story, an invariant a second literal cannot enforce.
 *
 * indigo-500 / amber-500: a CVD-safe pair.
 */
export const LIFECYCLE_CHART_COLORS = { actual: '#6366f1', target: '#f59e0b' } as const;
