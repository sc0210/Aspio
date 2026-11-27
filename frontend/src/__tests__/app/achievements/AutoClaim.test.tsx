/**
 * The achievements page claims finished badges on its own.
 *
 * Recording a transaction, holding or goal never checks badges, so a badge at
 * 1/1 kept reading "Locked" until the user found the "Check for new" button.
 * The page now runs that check once when it loads a finished, locked badge, and
 * leaves the server alone when there is nothing to claim.
 */

import React from 'react';
import { render, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { AchievementProgress } from '@/lib/api-client';

jest.mock('react-hot-toast', () => ({
  __esModule: true,
  default: Object.assign(jest.fn(), { success: jest.fn(), error: jest.fn(), promise: jest.fn() }),
}));

jest.mock('@/components/layout/DashboardLayout', () => ({
  DashboardLayout: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

jest.mock('@/hooks/useAppMode', () => ({
  useAppMode: () => ({ isDemo: false, isAuthenticated: true }),
}));

// Text is not asserted here; a bare t() keeps react-i18next quiet without an instance.
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : key) }),
}));

jest.mock('@/hooks/useMediaQuery', () => ({ useIsMobile: () => false }));

const checkMutate = jest.fn();
let progress: AchievementProgress[] = [];

jest.mock('@/hooks/api-hooks', () => ({
  useGamificationStats: () => ({ data: undefined, isLoading: false, isError: false, refetch: jest.fn() }),
  useAchievementProgress: () => ({ data: progress, isLoading: false, isError: false, refetch: jest.fn() }),
  useUpdateStreak: () => ({ mutate: jest.fn() }),
  useCheckAchievements: () => ({ mutate: checkMutate, mutateAsync: jest.fn() }),
}));

import AchievementsPage from '@/app/achievements/page';

const badge = (over: Partial<AchievementProgress>): AchievementProgress => ({
  achievement_type: 'first_transaction',
  title: 'First Steps',
  description: 'Record your first transaction',
  category: 'financial',
  icon: '📝',
  rarity: 'common',
  points_reward: 100,
  current_progress: 1,
  required_progress: 1,
  progress_percentage: 100,
  is_unlocked: false,
  unlocked_at: null,
  tips: [],
  ...over,
});

beforeEach(() => checkMutate.mockClear());

it('claims a finished badge that still reads locked, once', async () => {
  progress = [badge({}), badge({ achievement_type: 'hundred_transactions', current_progress: 3, required_progress: 100 })];
  const { rerender } = render(<AchievementsPage />);
  await waitFor(() => expect(checkMutate).toHaveBeenCalledTimes(1));
  progress = [...progress]; // a refetch hands the effect a new array
  rerender(<AchievementsPage />);
  expect(checkMutate).toHaveBeenCalledTimes(1);
});

it('does not call the server when nothing is left to claim', () => {
  progress = [
    badge({ is_unlocked: true, unlocked_at: '2026-11-01T00:00:00Z' }),
    badge({ achievement_type: 'hundred_transactions', current_progress: 3, required_progress: 100 }),
  ];
  render(<AchievementsPage />);
  expect(checkMutate).not.toHaveBeenCalled();
});
