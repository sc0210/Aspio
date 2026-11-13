import { portfolioService } from '@/services/portfolioService';
import { DAILY_PERFORMANCE_DAYS_DEFAULT } from '@/lib/queryKeys';

/**
 * The one fetch behind `dailyPerformanceKey(…, DAILY_PERFORMANCE_DAYS_DEFAULT)`.
 *
 * The dashboard and the portfolio page share that cache entry. Each used to
 * bring its own fetch, and the portfolio page's turned a failure into [] —
 * so if it ran first, the dashboard's P&L calendar showed an empty month and
 * nothing could tell. A failure stays a failure here; an empty success is [].
 */
export async function fetchDailyPerformance() {
  const response = await portfolioService.getDailyPerformance(DAILY_PERFORMANCE_DAYS_DEFAULT);
  if (!response.success) throw new Error(response.message || 'Daily performance unavailable');
  return response.data ?? [];
}
