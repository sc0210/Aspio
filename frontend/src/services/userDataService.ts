'use client';

import { apiClient } from '@/lib/api-client';
import { getSession } from 'next-auth/react';
import type { Session } from 'next-auth';
import { log } from '@/utils/logger';

interface UserDataCache {
  userId: string;
  lastLogin: Date;
  calculatedStats?: {
    totalBalance: number;
    monthlyIncome: number;
    monthlyExpenses: number;
    netWorth: number;
    savingsRate: number;
    lastCalculated: Date;
  };
  preferences?: {
    currency: string;
    dateFormat: string;
    dashboardLayout: Record<string, unknown>;
    favoriteCategories: string[];
    quickActions: string[];
  };
  sessionData?: {
    recentActivity: Record<string, unknown>[];
    topCategories: Record<string, unknown>[];
    goalProgress: Record<string, unknown>[];
    lastSynced: Date;
  };
}

class UserDataService {
  private readonly CACHE_PREFIX = 'aspiro_user_';
  private readonly CACHE_EXPIRY = 24 * 60 * 60 * 1000; // 24 hours
  private currentSession: Session | null = null;

  /**
   * Get the current authenticated session (always fresh from server)
   */
  async getCurrentSession(): Promise<Session | null> {
    // Always fetch fresh session to avoid stale token issues after refresh rotation
    this.currentSession = await getSession();
    return this.currentSession;
  }

  /**
   * Update the current session reference
   */
  updateSession(session: Session | null): void {
    this.currentSession = session;
  }

  /**
   * Get current user ID from session
   */
  async getCurrentUserId(): Promise<string | null> {
    const session = await this.getCurrentSession();
    return session?.user?.id || null;
  }

  /**
   * Check if user is currently authenticated
   */
  async isAuthenticated(): Promise<boolean> {
    const session = await this.getCurrentSession();
    return !!(session?.accessToken && session?.user?.id);
  }

  /**
   * Store user data in local storage for faster subsequent logins
   */
  async cacheUserData(userId: string, data: Partial<UserDataCache>): Promise<void> {
    try {
      const existingCache = this.getUserCache(userId) || { userId, lastLogin: new Date() };
      const updatedCache: UserDataCache = {
        ...existingCache,
        ...data,
        userId,
        lastLogin: new Date(),
      };

      localStorage.setItem(
        `${this.CACHE_PREFIX}${userId}`,
        JSON.stringify(updatedCache)
      );
    } catch (error) {
      log.warn('Failed to cache user data', error, 'UserDataService');
    }
  }

  /**
   * Retrieve cached user data for faster loading
   */
  getUserCache(userId: string): UserDataCache | null {
    try {
      const cached = localStorage.getItem(`${this.CACHE_PREFIX}${userId}`);
      if (!cached) return null;

      const data: UserDataCache = JSON.parse(cached);
      const lastLogin = new Date(data.lastLogin);
      const now = new Date();

      // Check if cache is expired
      if (now.getTime() - lastLogin.getTime() > this.CACHE_EXPIRY) {
        this.clearUserCache(userId);
        return null;
      }

      return data;
    } catch (error) {
      log.warn('Failed to retrieve cached user data', error, 'UserDataService');
      return null;
    }
  }

  /**
   * Clear user cache (logout, expired data, etc.)
   */
  clearUserCache(userId: string): void {
    try {
      localStorage.removeItem(`${this.CACHE_PREFIX}${userId}`);
    } catch (error) {
      log.warn('Failed to clear user cache', error, 'UserDataService');
    }
  }

  /**
   * Store calculated financial stats to avoid recalculation
   */
  async cacheCalculatedStats(userId: string, stats: UserDataCache['calculatedStats']): Promise<void> {
    const statsWithTimestamp = {
      ...stats,
      lastCalculated: new Date(),
    } as UserDataCache['calculatedStats'];

    await this.cacheUserData(userId, { calculatedStats: statsWithTimestamp });

    // Deliberately local-only. This used to carry a TODO about syncing to
    // "backend cache endpoints", which were never built — and shouldn't be. The
    // backend already holds the authoritative records, and TanStack Query
    // caches the reads in memory; a third copy on the server would be a second
    // source of truth to keep in sync, not a feature. Anything that must
    // survive a device change belongs in a real table, not here.
  }

  /**
   * Get cached stats if they're recent, otherwise return null
   */
  getCachedStats(userId: string): UserDataCache['calculatedStats'] | null {
    const cache = this.getUserCache(userId);
    if (!cache?.calculatedStats) return null;

    const lastCalculated = new Date(cache.calculatedStats.lastCalculated);
    const now = new Date();
    const statsExpiry = 30 * 60 * 1000; // 30 minutes for stats

    if (now.getTime() - lastCalculated.getTime() > statsExpiry) {
      return null;
    }

    return cache.calculatedStats;
  }

  /**
   * Store user preferences for personalized experience
   */
  async cacheUserPreferences(userId: string, preferences: Partial<UserDataCache['preferences']>): Promise<void> {
    const cache = this.getUserCache(userId);
    const updatedPreferences = {
      ...cache?.preferences,
      ...preferences,
    };

    await this.cacheUserData(userId, { preferences: updatedPreferences as UserDataCache['preferences'] });
    
    // Sync to backend
    try {
      await apiClient.post('/user/preferences', updatedPreferences);
    } catch (error) {
      log.apiError('POST', '/user/preferences', error);
    }
  }

  /**
   * Get user preferences with fallbacks
   */
  getUserPreferences(userId: string): UserDataCache['preferences'] {
    const cache = this.getUserCache(userId);
    return cache?.preferences || {
      currency: 'TWD',
      dateFormat: 'DD/MM/YYYY',
      dashboardLayout: {} as Record<string, unknown>,
      favoriteCategories: [],
      quickActions: ['add-transaction', 'add-goal'],
    };
  }

  /**
   * Cache session data for faster subsequent loads
   */
  async cacheSessionData(userId: string, sessionData: Partial<UserDataCache['sessionData']>): Promise<void> {
    const cache = this.getUserCache(userId);
    const updatedSessionData = {
      ...cache?.sessionData,
      ...sessionData,
      lastSynced: new Date(),
    };

    await this.cacheUserData(userId, { sessionData: updatedSessionData as UserDataCache['sessionData'] });
  }

  /**
   * Get fresh session data or cached if recent
   */
  getSessionData(userId: string): UserDataCache['sessionData'] | null {
    const cache = this.getUserCache(userId);
    if (!cache?.sessionData) return null;

    const lastSynced = new Date(cache.sessionData.lastSynced);
    const now = new Date();
    const sessionExpiry = 10 * 60 * 1000; // 10 minutes for session data

    if (now.getTime() - lastSynced.getTime() > sessionExpiry) {
      return null;
    }

    return cache.sessionData;
  }

  /**
   * Initialize user data on login using current session
   */
  async initializeUserSession(providedUserId?: string): Promise<UserDataCache | null> {
    try {
      const session = await this.getCurrentSession();
      const userId = providedUserId || session?.user?.id;
      
      if (!userId) {
        log.warn('No user ID available for session initialization', undefined, 'UserDataService');
        return null;
      }

      // Ensure we're authenticated before initializing
      if (!(await this.isAuthenticated())) {
        log.warn('User not authenticated, skipping session initialization', undefined, 'UserDataService');
        return null;
      }

      // Try to get cached data first
      let cachedData = this.getUserCache(userId);
      
      if (!cachedData) {
        // Create default cache data since backend cache endpoints aren't implemented yet
        cachedData = {
          userId,
          lastLogin: new Date(),
          calculatedStats: {
            totalBalance: 0,
            monthlyIncome: 0,
            monthlyExpenses: 0,
            netWorth: 0,
            savingsRate: 0,
            lastCalculated: new Date(),
          },
          preferences: {
            currency: 'USD',
            dateFormat: 'YYYY-MM-DD',
            dashboardLayout: {},
            favoriteCategories: [],
            quickActions: [],
          },
          sessionData: { 
            recentActivity: [], 
            topCategories: [], 
            goalProgress: [], 
            lastSynced: new Date() 
          },
        } as UserDataCache;
        
        // Cache the default data
        await this.cacheUserData(userId, cachedData);
      }

      return cachedData;
    } catch (error) {
      log.error('Failed to initialize user session', error, 'UserDataService');
      return null;
    }
  }

  /**
   * Clear all cached data (logout) - automatically gets user ID from session
   */
  async clearAllUserData(providedUserId?: string): Promise<void> {
    const userId = providedUserId || (await this.getCurrentUserId());
    
    if (userId) {
      this.clearUserCache(userId);

      // Only localStorage to clear — see cacheCalculatedStats. There is no
      // server-side copy of this cache to invalidate; signing out already
      // discards the session that gates the real data.
    }

    // Clear session reference
    this.currentSession = null;
  }

  /**
   * Sync local cache with backend - automatically gets user ID from session
   */
  async syncUserData(providedUserId?: string): Promise<void> {
    try {
      const userId = providedUserId || (await this.getCurrentUserId());
      
      if (!userId) {
        log.warn('No user ID available for sync', undefined, 'UserDataService');
        return;
      }

      // Ensure we're authenticated before syncing
      if (!(await this.isAuthenticated())) {
        log.warn('User not authenticated, skipping sync', undefined, 'UserDataService');
        return;
      }

      const cache = this.getUserCache(userId);
      if (!cache) return;

      // Nothing to push — this cache is local by design (see
      // cacheCalculatedStats). The call is kept as the hook's auth-change
      // entry point, which reads the cache and warms it.
      log.debug('User data sync completed (localStorage only)', undefined, 'UserDataService');
    } catch (error) {
      log.warn('Failed to sync user data', error, 'UserDataService');
    }
  }

  /**
   * Automatic session initialization when authentication state changes
   */
  async onAuthStateChange(session: Session | null): Promise<void> {
    this.updateSession(session);
    
    if (session?.user?.id) {
      // User logged in - initialize session
      await this.initializeUserSession(session.user.id);
    } else {
      // User logged out - clear any cached data
      await this.clearAllUserData();
    }
  }
}

export const userDataService = new UserDataService();