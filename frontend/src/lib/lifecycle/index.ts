/**
 * Lifecycle-investing toolkit — pure client-side calculators for the
 * "借錢投資進度" tracking page. No data fetching lives here.
 *
 * Reading order: `samuelson` sets the dollar target, `leverage` measures where
 * you stand against it, `stress` asks what a bad market does to that position,
 * `spread` asks whether the borrowing is paying for itself, and `glidepath`
 * projects the whole thing forward to the crossover. `history` runs the same
 * position calculation backwards over the wallet snapshots, so the leverage you
 * are tracking can be read as a trend rather than as a single reading.
 */
export * from './samuelson';
export * from './leverage';
export * from './stress';
export * from './spread';
export * from './glidepath';
export * from './history';
export * from './principles';

/**
 * Starting assumptions.
 *
 * `samuelsonSharePct` defaults to 67% rather than the book's own 83%: the book
 * derives its number from a risk aversion most people do not actually have, and
 * practitioners who run the strategy for real typically settle between 50% and
 * 67%. It is a control on the page — this is only where the slider starts.
 */
export const DEFAULT_LIFECYCLE = {
    samuelsonSharePct: 67,
    maxLeverage: 2,
    retirementAge: 65,
    /** Discount rate for future savings — a modest real rate, not the equity return. */
    discountRatePct: 4,
    savingsGrowthPct: 2,
    expectedReturnPct: 7,
    investedSharePct: 80,
} as const;
