'use client';

/**
 * GlobalErrorBoundary
 *
 * React class-based error boundary that:
 *  1. Catches synchronous render/lifecycle errors anywhere in the tree.
 *  2. Reports them through analyticsProvider.track() if consent is present.
 *  3. Shows a user-friendly fallback UI instead of a blank screen.
 *
 * Place this once, wrapping the entire page content in layout.tsx.
 */

import React from 'react';
import { analyticsProvider } from '@/lib/analytics/provider';
import { shouldTrackAnalytics, hasAnalyticsConsent } from '@/lib/analytics/config';

interface Props {
  children: React.ReactNode;
  /** Optional custom fallback UI. Receives a reset callback. */
  fallback?: (reset: () => void) => React.ReactNode;
}

interface State {
  hasError: boolean;
  errorMessage: string;
}

export class GlobalErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
  }

  static getDerivedStateFromError(error: unknown): State {
    const message =
      error instanceof Error ? error.message : 'An unexpected error occurred';
    return { hasError: true, errorMessage: message };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo) {
    // Only report if the user has consented and DNT is not set
    if (shouldTrackAnalytics() && hasAnalyticsConsent()) {
      const message =
        error instanceof Error ? error.message : String(error);
      const stack =
        error instanceof Error ? (error.stack ?? '').slice(0, 500) : '';

      analyticsProvider.track('js_error', {
        error_type: 'react_boundary',
        // Truncate to avoid accidentally capturing values from the stack
        error_message: message.slice(0, 200),
        error_stack: stack,
        component_stack: (info.componentStack ?? '').slice(0, 500),
        page: typeof window !== 'undefined' ? window.location.pathname : '',
      });
    }

    // Always log to console so developers can investigate
    console.error('[GlobalErrorBoundary] Caught render error:', error, info);
  }

  handleReset = () => {
    this.setState({ hasError: false, errorMessage: '' });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback(this.handleReset);
      }

      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 px-4">
          <div className="max-w-md w-full text-center">
            <div className="mb-6">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
                <svg
                  className="w-8 h-8 text-red-600 dark:text-red-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
                  />
                </svg>
              </div>
              <h1 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
                Something went wrong
              </h1>
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
                An unexpected error occurred. Your financial data is safe — please
                try refreshing the page.
              </p>
            </div>

            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <button
                onClick={this.handleReset}
                className="px-4 py-2 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
              >
                Try again
              </button>
              <button
                onClick={() => (window.location.href = '/')}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 focus-visible:ring-offset-2"
              >
                Go to dashboard
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
