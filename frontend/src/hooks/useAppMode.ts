'use client';

import { useAuthContext } from '@/contexts/AuthContext';
import { useTranslation } from 'react-i18next';
import type { Session } from 'next-auth';

type AppMode = 'authenticated' | 'demo' | 'unauthenticated';

interface AppModeState {
  mode: AppMode;
  isAuthenticated: boolean;
  isDemo: boolean;
  user: Session['user'] | null;
  canPersistData: boolean;
  /** Raw NextAuth session — prefer `mode`/`isAuthenticated` where possible. */
  session: Session | null;
  /** Raw NextAuth status. `isLoading` is the preferred derived flag. */
  status: 'loading' | 'authenticated' | 'unauthenticated';
  /** True while the auth session is still resolving. */
  isLoading: boolean;
}

/**
 * Hook to manage application mode (authenticated vs demo).
 *
 * This is the single canonical source of truth for app mode. Components must
 * read auth/mode state from here (or `useAuthContext`) rather than calling
 * `useSession()` directly — `AuthContext` makes the one allowed `useSession()`
 * call for the entire app.
 */
export function useAppMode(): AppModeState {
  const { mode, isAuthenticated, isDemo, user, canPersistData, session, status } =
    useAuthContext();

  return {
    mode,
    isAuthenticated,
    isDemo,
    user,
    canPersistData,
    session,
    status,
    isLoading: status === 'loading',
  };
}

/**
 * Hook to get mode-aware messages and UI text
 */
export function useModeAwareUI() {
  const { mode, isDemo } = useAppMode();
  const { t } = useTranslation('common');

  const getModeIndicator = () => ({
    text: isDemo ? t('modeAware.demoBadge', 'Demo Mode') : t('modeAware.liveBadge', 'Live Data'),
    className: isDemo
      ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'
      : 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
  });

  const getModeMessage = (context: 'transactions' | 'settings' | 'general') => {
    if (isDemo) {
      switch (context) {
        case 'transactions':
          return t('modeAware.demoTransactions', 'Exploring with sample data - Sign in to save your transactions');
        case 'settings':
          return t('modeAware.demoSettings', 'Demo mode - Sign in to customize your settings');
        default:
          return t('modeAware.demoGeneral', 'Demo mode - Sign in to save your data');
      }
    }

    switch (context) {
      case 'transactions':
        return t('modeAware.liveTransactions', 'Track and manage your income and expenses');
      case 'settings':
        return t('modeAware.liveSettings', 'Manage your account, preferences, and appearance');
      default:
        return t('modeAware.liveGeneral', 'Your personal finance dashboard');
    }
  };

  const getSuccessMessage = (action: string) => {
    return isDemo
      ? t('modeAware.demoSuccess', 'Demo {{action}} added! Sign in to save your real data.', { action })
      : t('modeAware.liveSuccess', '{{action}} added successfully!', { action });
  };

  const getErrorMessage = (action: string) => {
    return isDemo
      ? t('modeAware.demoError', 'Demo mode: {{action}} not saved. Sign in to save your data.', { action })
      : t('modeAware.liveError', 'Failed to {{action}}. Please try again.', { action: action.toLowerCase() });
  };

  return {
    mode,
    isDemo,
    getModeIndicator,
    getModeMessage,
    getSuccessMessage,
    getErrorMessage,
  };
}