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
const refetchProgress = jest.fn();
const buttonMutate = jest.fn();
let progress: AchievementProgress[] = [];
let streak = { isSuccess: true, isError: false };
let hookCalls = 0;

jest.mock('@/hooks/api-hooks', () => ({
  useGamificationStats: () => ({ data: undefined, isLoading: false, isError: false, refetch: jest.fn() }),
  useAchievementProgress: () => ({ data: progress, isLoading: false, isError: false, refetch: refetchProgress }),
  useUpdateStreak: () => ({ mutate: jest.fn(), ...streak }),
  // Each render takes two instances, in order: the button's, then the background claim's.
  useCheckAchievements: () =>
    ({ mutate: hookCalls++ % 2 === 0 ? buttonMutate : checkMutate, mutateAsync: jest.fn(), isPending: false }),
}));

import toast from 'react-hot-toast';
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

beforeEach(() => {
  checkMutate.mockClear();
  buttonMutate.mockClear();
  refetchProgress.mockClear();
  (toast.success as jest.Mock).mockClear();
  hookCalls = 0;
  streak = { isSuccess: true, isError: false };
});

const finished = () => [badge({}), badge({ achievement_type: 'hundred_transactions', current_progress: 3, required_progress: 100 })];

it('claims a finished badge that still reads locked, once', async () => {
  progress = finished();
  const { rerender } = render(<AchievementsPage />);
  await waitFor(() => expect(checkMutate).toHaveBeenCalledTimes(1));
  progress = [...progress]; // a refetch hands the effect a new array
  rerender(<AchievementsPage />);
  expect(checkMutate).toHaveBeenCalledTimes(1);
  expect(buttonMutate).not.toHaveBeenCalled();
});

it('does not call the server when nothing is left to claim', () => {
  progress = [
    badge({ is_unlocked: true, unlocked_at: '2026-11-01T00:00:00Z' }),
    badge({ achievement_type: 'hundred_transactions', current_progress: 3, required_progress: 100 }),
  ];
  render(<AchievementsPage />);
  expect(checkMutate).not.toHaveBeenCalled();
});

it('waits for the streak ping, which awards badges too', () => {
  progress = finished();
  streak = { isSuccess: false, isError: false };
  const { rerender } = render(<AchievementsPage />);
  expect(checkMutate).not.toHaveBeenCalled();
  streak = { isSuccess: true, isError: false };
  rerender(<AchievementsPage />);
  expect(checkMutate).toHaveBeenCalledTimes(1);
});

it('still claims when the streak ping failed', () => {
  progress = finished();
  streak = { isSuccess: false, isError: true };
  render(<AchievementsPage />);
  expect(checkMutate).toHaveBeenCalledTimes(1);
});

it('toasts what it earned and refetches progress either way', () => {
  progress = finished();
  render(<AchievementsPage />);
  const [, callbacks] = checkMutate.mock.calls[0];

  callbacks.onSuccess([]);
  expect(toast.success).not.toHaveBeenCalled();
  callbacks.onSuccess([{ achievement_type: 'first_transaction' }]);
  expect(toast.success).toHaveBeenCalledTimes(1);

  // Nothing earned here can still mean another tab claimed it: refetch anyway.
  callbacks.onSettled();
  expect(refetchProgress).toHaveBeenCalledTimes(1);
});
