/**
 * Shared "is this a retirement goal" heuristic.
 *
 * Goals are matched by category first, then by title keyword as a fallback —
 * a goal named "Retirement Fund" should count even if its category wasn't
 * set to "retirement" precisely. Used by both the dashboard's GoalsOverview
 * (portfolio-linked mini tracker) and the portfolio page's
 * useRetirementProjection so the same goal is recognized consistently in
 * both places instead of drifting into two different heuristics.
 */
export function isRetirementGoal(goal: { category?: string; title: string }): boolean {
  const title = goal.title?.toLowerCase() ?? '';
  return (
    goal.category?.toLowerCase() === 'retirement' ||
    title.includes('retire') ||
    // "FIRE" only as the capitalised acronym and a whole word. Lower-cased and
    // as a substring it matched "Fireplace renovation" and "Fire insurance
    // fund", and a matched goal is credited the entire portfolio. Mirrored in
    // backend reports/services.py::_is_retirement_goal.
    /\bFIRE\b/.test(goal.title ?? '') ||
    title.includes('財務自由') ||
    title.includes('退休')
  );
}

/**
 * The one goal the portfolio counts toward, or null.
 *
 * A retirement goal's progress is the portfolio, but the portfolio exists once:
 * crediting every matching goal counted it again for each, so two retirement
 * goals doubled the total and could read past 100%. The credit goes to the
 * active match with the largest target, or to any match if none is active,
 * ties broken by id. Mirrored in backend
 * reports/services.py::_portfolio_credited_goal_id, so /goals, the dashboard
 * and /review credit the same goal.
 */
export function portfolioCreditedGoal<
  T extends { id: string; title: string; category?: string; status?: string; targetAmount: number | string },
>(goals: T[]): T | null {
  const matches = goals.filter(isRetirementGoal);
  if (matches.length === 0) return null;
  const active = matches.filter((goal) => goal.status === 'active');
  const pool = active.length > 0 ? active : matches;
  return pool.reduce((best, goal) => {
    const difference = Number(goal.targetAmount) - Number(best.targetAmount);
    return difference > 0 || (difference === 0 && goal.id > best.id) ? goal : best;
  });
}
