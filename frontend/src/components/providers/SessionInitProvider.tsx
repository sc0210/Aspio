'use client';

import { ReactNode } from 'react';
import { useAuthContext } from '@/contexts/AuthContext';
import { useUserSession } from '@/hooks/useUserSession';
import { LoadingOverlay } from '@/components/ui/LoadingOverlay';

interface SessionInitProviderProps {
  children: ReactNode;
}

/**
 * Provider component that handles user session initialization and loading states
 * Should be placed inside SessionProvider but outside of main app content
 */
export function SessionInitProvider({ children }: SessionInitProviderProps) {
  const { status } = useAuthContext();
  const { isLoading: _isLoading, error } = useUserSession();

  // Only show loading overlay during initial session loading, not user session loading
  // This prevents blocking the UI when switching between demo and authenticated modes
  if (status === 'loading') {
    return (
      <LoadingOverlay
        isLoading={true}
        message="Loading..."
      />
    );
  }

  // Show error state if session initialization failed
  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
            Session Error
          </h2>
          <p className="text-gray-600 dark:text-gray-400 mb-4">
            {error}
          </p>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-primary-700 text-white rounded-lg hover:bg-primary-800 transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}