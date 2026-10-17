/**
 * Query keys that more than one page builds.
 *
 * A React Query key has to capture every input its queryFn uses, or two callers
 * asking for different data end up sharing one cache entry. The daily
 * performance key left out the day span while three callers asked for two
 * different spans:
 *
 *   dashboard  PortfolioOverview     365 days
 *   portfolio  usePortfolioData      365 days
 *   trend      /portfolio/trend    1,825 days (5y)
 *
 * All three keyed on `['portfolio-daily-performance', email]`, so whichever
 * mounted first filled the cache and the others rendered its answer. The
 * dashboard is the landing page, so in practice the trend page's 5-year presets
 * were being drawn from one year of data.
 *
 * The identity fallback was spelled three ways too ('anonymous' / 'demo' /
 * 'anon'), which split the demo-mode cache three ways for no reason.
 */

/** Days of history the dashboard and portfolio pages request. */
export const DAILY_PERFORMANCE_DAYS_DEFAULT = 365;

/** Days of history the trend page requests, so its longest preset has data. */
export const DAILY_PERFORMANCE_DAYS_MAX = 365 * 5;

/**
 * Cache key for `portfolioService.getDailyPerformance(days)`.
 *
 * The `'portfolio-daily-performance'` prefix is deliberately first: several
 * mutations invalidate by that prefix alone, and DataRefreshButton matches any
 * key containing `portfolio`. Appending the span keeps both working.
 */
export const dailyPerformanceKey = (
  identity: string | null | undefined,
  days: number,
) => ['portfolio-daily-performance', identity || 'anonymous', days] as const;
