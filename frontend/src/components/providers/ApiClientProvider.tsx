'use client';

import { useAuthContext } from '@/contexts/AuthContext';
import { useEffect, useRef, useState } from 'react';
import { apiClient } from '@/lib/api-client';
import { logger } from '@/utils/logger';

/**
 * Provider that syncs NextAuth session tokens with the API client
 * This ensures all API calls are properly authenticated
 */
export function ApiClientProvider({ children }: { children: React.ReactNode }) {
  const { session, status } = useAuthContext();
  const [tokenReady, setTokenReady] = useState(false);
  // Track whether the initial session resolution has completed at least once.
  // This prevents the spinner from reappearing during signOut (which also
  // briefly sets status back to 'loading'), creating the "multiple refresh" UX.
  const hasResolvedOnce = useRef(false);

  useEffect(() => {
    // Only block rendering on the very first session resolution.
    // Subsequent 'loading' states (e.g. during signOut) should not hide content.
    if (status === 'loading') {
      if (!hasResolvedOnce.current) {
        setTokenReady(false);
      }
      return;
    }

    hasResolvedOnce.current = true;

    if (session?.accessToken) {
      apiClient.setAccessToken(session.accessToken as string);
      setTokenReady(true);
      logger.debug('Access token set from session', {
        hasToken: !!session.accessToken,
        userEmail: session.user?.email,
        userId: session.user?.id
      }, 'API');
    } else if (status === 'authenticated' && session?.user) {
      // Authenticated but no backend access token — let AuthContext handle the
      // sign-out; here we just unblock rendering so the redirect can proceed.
      logger.warn('Authenticated session without accessToken', {
        userEmail: session.user?.email,
        status,
      }, 'API');
      apiClient.clearAccessToken();
      setTokenReady(true);
    } else {
      apiClient.clearAccessToken();
      setTokenReady(true);
      logger.debug('No session', { status }, 'API');
    }
  }, [session?.accessToken, session?.user, status]);

  // Safety timeout: if the initial session resolution takes more than 1.5 s
  // (network slow, server cold-start), unblock the app and let auth logic decide.
  useEffect(() => {
    if (tokenReady || hasResolvedOnce.current) return;
    const timer = setTimeout(() => {
      if (!hasResolvedOnce.current) {
        logger.warn('Session resolution timed out (>1.5s), unblocking app', undefined, 'API');
        hasResolvedOnce.current = true;
        apiClient.clearAccessToken();
        setTokenReady(true);
      }
    }, 1500);
    return () => clearTimeout(timer);
  }, [tokenReady]);

  if (!tokenReady) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  return <>{children}</>;
}