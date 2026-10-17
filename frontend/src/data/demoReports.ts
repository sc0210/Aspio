// Demo-mode fixture for the goals report /review reads (GoalsTodayCard). It
// matches the shape reportsService returns, so the card renders exactly like
// the live experience with no backend call. The other /reports fixtures went
// with that page on 2026-09-17.

import type { GoalsReport } from '@/services/reportsService';

// ISO day (YYYY-MM-DD) for `offset` months before today, first of the month.
function monthStartIso(offset: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - offset, 1);
  return d.toISOString().slice(0, 10);
}

export const demoGoalsReport: GoalsReport = {
  totalGoals: 3,
  activeGoals: 3,
  completedGoals: 0,
  totalTargetAmount: 133_000,
  totalCurrentAmount: 63_200,
  overallProgress: 47.5,
  goalsOnTrack: 2,
  goalsBehind: 1,
  goalProgress: [
    {
      id: 'demo-goal-emergency',
      title: 'Emergency Fund',
      category: 'Emergency Fund',
      targetAmount: 25_000,
      currentAmount: 15_000,
      progressPercentage: 60,
      status: 'active',
      targetDate: monthStartIso(-6),
      daysRemaining: 180,
      onTrack: true,
      monthlyRequired: 1_667,
    },
    {
      id: 'demo-goal-house',
      title: 'House Down Payment',
      category: 'House Down Payment',
      targetAmount: 100_000,
      currentAmount: 45_000,
      progressPercentage: 45,
      status: 'active',
      targetDate: monthStartIso(-18),
      daysRemaining: 540,
      onTrack: false,
      monthlyRequired: 3_056,
    },
    {
      id: 'demo-goal-japan',
      title: 'Japan Vacation',
      category: 'Vacation',
      targetAmount: 8_000,
      currentAmount: 3_200,
      progressPercentage: 40,
      status: 'active',
      targetDate: monthStartIso(-4),
      daysRemaining: 120,
      onTrack: true,
      monthlyRequired: 1_200,
    },
  ],
  categorySummary: [
    { category: 'Emergency Fund', count: 1, totalTarget: 25_000, totalCurrent: 15_000, averageProgress: 60 },
    { category: 'House Down Payment', count: 1, totalTarget: 100_000, totalCurrent: 45_000, averageProgress: 45 },
    { category: 'Vacation', count: 1, totalTarget: 8_000, totalCurrent: 3_200, averageProgress: 40 },
  ],
  insights: [
    {
      type: 'warning',
      title: 'House Down Payment is behind pace',
      description: 'At the current rate it will finish late. Adding ~NT$3,000/mo brings it back on track.',
      impact: 'high',
    },
    {
      type: 'positive',
      title: 'Emergency Fund on track',
      description: 'Your safety net is 60% funded and pacing to hit its target on time.',
      impact: 'medium',
    },
  ],
};
