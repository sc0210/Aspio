import type { CreateGoalData } from '@/hooks/useGoals';

/**
 * What /goals?create=… asks for: '1' opens Create; 'retirement' opens it
 * prefilled (the Portfolio page's retirement link). Read by both the desktop
 * and the phone Goals views, so a link opens the same thing on either.
 */
export function createLinkDefaults(value: string | null): { open: boolean; defaults?: Partial<CreateGoalData>; returnToPortfolio?: boolean } {
  if (value === 'retirement') {
    return {
      open: true,
      returnToPortfolio: true,
      defaults: {
        title: 'Retirement Fund',
        category: 'retirement',
        priority: 'high',
        target_amount: 10000000, // 10M TWD default
        currency: 'TWD',
        target_date: `${new Date().getFullYear() + 10}-12-31`,
        description: 'Financial independence and retirement goal',
      },
    };
  }
  return { open: value === '1' };
}
