'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { userDataService } from '@/services/userDataService';
import { useAppMode } from './useAppMode';
import { logger } from '@/utils/logger';

interface UserSessionData {
  isInitialized: boolean;
  isLoading: boolean;
  userData: Record<string, unknown> | null;
  error: string | null;
}

/**
 * Hook to manage user session persistence and data caching
 * Automatically handles session initialization, data persistence, and cleanup
 */
export function useUserSession(): UserSessionData {
  const { data: session, status } = useSession();
  const { isAuthenticated } = useAppMode();
  const [sessionData, setSessionData] = useState<UserSessionData>({
    isInitialized: false,
    isLoading: false,
    userData: null,
    error: null,
  });

  // Initialize user session when authentication state changes
  useEffect(() => {
    const initializeSession = async () => {
      if (status === 'loading') {
        setSessionData(prev => ({ ...prev, isLoading: true, error: null }));
        return;
      }

      if (isAuthenticated && session?.user?.id) {
        setSessionData(prev => ({ ...prev, isLoading: true, error: null }));
        
        try {
          // Initialize user session with data persistence
          const userData = await userDataService.initializeUserSession(session.user.id);
          
          setSessionData({
            isInitialized: true,
            isLoading: false,
            userData: userData as Record<string, unknown> | null,
            error: null,
          });

          logger.info('Session initialized', { userId: session.user.id }, 'Session');
        } catch (error) {
          logger.error('Failed to initialize session', error, 'Session');
          setSessionData({
            isInitialized: false,
            isLoading: false,
            userData: null,
            error: error instanceof Error ? error.message : 'Failed to initialize session',
          });
        }
      } else {
        // User not authenticated - clear session data
        await userDataService.clearAllUserData();
        setSessionData({
          isInitialized: false,
          isLoading: false,
          userData: null,
          error: null,
        });
      }
    };

    initializeSession();
  }, [session, status, isAuthenticated]);

  // Handle session changes
  useEffect(() => {
    userDataService.onAuthStateChange(session);
  }, [session]);

  // Auto-sync user data periodically for authenticated users
  useEffect(() => {
    if (!isAuthenticated || !session?.user?.id) return;

    const syncInterval = setInterval(async () => {
      try {
        await userDataService.syncUserData(session.user.id);
        logger.debug('Data synced to backend', undefined, 'Sync');
      } catch (error) {
        logger.warn('Failed to sync data', error, 'Sync');
      }
    }, 5 * 60 * 1000); // Sync every 5 minutes

    return () => clearInterval(syncInterval);
  }, [isAuthenticated, session?.user?.id]);

  return sessionData;
}