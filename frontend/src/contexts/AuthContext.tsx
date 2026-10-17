'use client';

import React, { createContext, useContext, ReactNode, useEffect, useRef } from 'react';
import { useSession } from 'next-auth/react';
import type { Session } from 'next-auth';
import { useDemo } from './DemoContext';
import { logger } from '@/utils/logger';

type AppMode = 'authenticated' | 'demo' | 'unauthenticated';

interface AuthContextValue {
  mode: AppMode;
  isAuthenticated: boolean;
  isDemo: boolean;
  user: Session['user'] | null;
  canPersistData: boolean;
  session: Session | null;
  status: 'loading' | 'authenticated' | 'unauthenticated';
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthContextProvider({ children }: { children: ReactNode }) {
  // Single session call for entire app
  const { data: session, status } = useSession();
  const { demoUser, isDemoMode } = useDemo();
  // Prevent signOut from being called more than once per session lifecycle.
  const signingOutRef = useRef(false);

  // Handle token refresh errors and missing backend tokens by signing out.
  // Skip entirely in demo mode — the user intentionally chose to use the app
  // without logging in, so a stale/expired JWT from a previous login should
  // not interrupt the demo session.
  useEffect(() => {
    if (signingOutRef.current) return;
    if (isDemoMode) return;

    if (session?.error === 'RefreshAccessTokenError') {
      signingOutRef.current = true;
      logger.error('Token refresh failed — redirecting to destroy route', undefined, 'Auth');
      // Use a hard navigation to /api/auth/destroy which clears ALL NextAuth cookies
      // server-side in one atomic response, avoiding the race condition where an
      // in-flight GET /api/auth/session re-encodes the error JWT cookie AFTER signOut()
      // clears it (the HttpOnly flag also prevents JS from clearing it directly).
      window.location.href = '/api/auth/destroy';
      return;
    }
    // If NextAuth says authenticated but there's no backend access token and no explicit
    // error, the backend auth step (OAuth callback / login) failed silently.
    if (status === 'authenticated' && session?.user && !session?.accessToken && !session?.error) {
      signingOutRef.current = true;
      logger.error('Authenticated session missing backend access token — destroying session', undefined, 'Auth');
      window.location.href = '/api/auth/destroy';
    }
  }, [session, status, isDemoMode]);

  // More strict authentication check: require both session AND accessToken
  const isAuthenticated = !!(
    session?.user &&
    status === 'authenticated' &&
    session?.accessToken &&
    !session?.error
  );

  // Only use demo mode if explicitly enabled via DemoContext AND not authenticated
  // This prevents automatic fallback to demo when session expires
  const isDemo = !isAuthenticated && isDemoMode;
  const mode: AppMode = isAuthenticated ? 'authenticated' : (isDemo ? 'demo' : 'unauthenticated');

  // Debug logging to help identify auth issues
  React.useEffect(() => {
    if (status === 'authenticated') {
      logger.debug('State updated', {
        status,
        hasSession: !!session,
        hasUser: !!session?.user,
        hasAccessToken: !!session?.accessToken,
        userEmail: session?.user?.email,
        mode,
        isAuthenticated,
        isDemo,
        hasError: !!session?.error
      }, 'Auth');

      if (!session?.accessToken) {
        logger.warn('Session exists but no accessToken, falling back to demo mode', undefined, 'Auth');
      }
    }
  }, [status, session, mode, isAuthenticated, isDemo]);

  const value: AuthContextValue = {
    mode,
    isAuthenticated,
    isDemo,
    user: isAuthenticated ? session?.user : demoUser,
    canPersistData: isAuthenticated,
    session,
    status,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuthContext() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuthContext must be used within AuthContextProvider');
  }
  return context;
}
