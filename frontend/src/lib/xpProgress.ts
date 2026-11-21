/**
 * How far through the current level, 0–100. Both figures are 0 for a brand-new
 * account, and 0/0 made the bar NaN% wide with aria-valuenow="NaN".
 */
export function xpProgressPercent(stats: { experience_points: number; experience_to_next_level: number }): number {
  const total = stats.experience_points + stats.experience_to_next_level;
  return total > 0 ? Math.round(Math.min(100, (stats.experience_points / total) * 100)) : 0;
}
