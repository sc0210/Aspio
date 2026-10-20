'use client';

import { Component, ErrorInfo, ReactNode } from 'react';
import { QueryClient } from '@tanstack/react-query';
import { log } from '@/utils/logger';

interface Props {
  children: ReactNode;
  queryClient?: QueryClient;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
  errorInfo?: ErrorInfo;
  retryCount: number;
}

/**
 * Caps chunk-error auto-reloads at one per tab session. Only cleared by a
 * successful mount, never from the error path.
 */
const RELOAD_KEY = 'datasync_chunk_reload';

/**
 * Error boundary that handles data synchronization errors
 * Provides recovery mechanisms for auth-related data issues
 */
export class DataSyncErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      retryCount: 0,
    };
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      error,
      retryCount: 0,
    };
  }

  componentDidMount() {
    // A clean mount is the only thing that replenishes the reload budget.
    // Clearing it from componentDidCatch instead would mean a persistent chunk
    // error alternates reload / clear-flag / reload forever — the flag has to
    // survive until something actually renders successfully.
    if (!this.state.hasError) {
      sessionStorage.removeItem(RELOAD_KEY);
    }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('DataSyncErrorBoundary caught an error:', error, errorInfo);

    // Webpack/HMR chunk loading errors are transient dev-mode issues.
    // Auto-reload once to recover — guard against infinite loops via sessionStorage.
    const isChunkError = error.stack?.includes('__webpack_require__') || error.stack?.includes('webpack.js');
    if (isChunkError && !sessionStorage.getItem(RELOAD_KEY)) {
      sessionStorage.setItem(RELOAD_KEY, '1');
      window.location.reload();
      return;
    }
    // Budget spent: fall through to the error UI rather than reloading again.

    // Log to external service in production
    if (process.env.NODE_ENV === 'production') {
      // TODO: Send to error reporting service
    }

    this.setState({
      error,
      errorInfo,
    });
  }

  handleRetry = () => {
    const { queryClient } = this.props;
    
    // Clear React Query cache to reset data state
    if (queryClient) {
      queryClient.clear();
      log.debug('Cleared query cache due to error recovery', undefined, 'ErrorBoundary');
    }

    // Reset error boundary state
    this.setState(prevState => ({
      hasError: false,
      error: undefined,
      errorInfo: undefined,
      retryCount: prevState.retryCount + 1,
    }));
    
    // Force a page refresh if retry count is high
    if (this.state.retryCount >= 2) {
      log.warn('Multiple retries failed, forcing page refresh', undefined, 'ErrorBoundary');
      window.location.reload();
    }
  };

  handleReset = () => {
    // Clear all local storage and session storage
    localStorage.clear();
    sessionStorage.clear();
    
    // Clear React Query cache
    if (this.props.queryClient) {
      this.props.queryClient.clear();
    }
    
    // Redirect to home page
    window.location.href = '/';
  };

  render() {
    if (this.state.hasError) {
      // Custom fallback UI
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
          <div className="max-w-md w-full mx-4">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6">
              <div className="text-center">
                <div className="text-red-700 dark:text-red-500 mb-4">
                  <svg
                    className="w-16 h-16 mx-auto"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16c-.77.833.192 2.5 1.732 2.5z"
                    />
                  </svg>
                </div>
                
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
                  Data Synchronization Error
                </h2>
                
                <p className="text-gray-600 dark:text-gray-400 mb-6">
                  We encountered an issue loading your dashboard data. This might be due to a 
                  network issue or authentication problem.
                </p>
                
                <div className="space-y-3">
                  <button
                    onClick={this.handleRetry}
                    className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    Try Again ({3 - this.state.retryCount} attempts left)
                  </button>
                  
                  <button
                    onClick={this.handleReset}
                    className="w-full px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
                  >
                    Reset Application
                  </button>
                </div>
                
                {process.env.NODE_ENV === 'development' && (
                  <details className="mt-6 text-left">
                    <summary className="cursor-pointer text-sm text-gray-600 hover:text-gray-700">
                      Debug Information
                    </summary>
                    <div className="mt-2 p-3 bg-gray-100 dark:bg-gray-700 rounded text-xs">
                      <div className="mb-2">
                        <strong>Error:</strong> {this.state.error?.message}
                      </div>
                      <div>
                        <strong>Stack:</strong>
                        <pre className="mt-1 overflow-x-auto">
                          {this.state.error?.stack}
                        </pre>
                      </div>
                    </div>
                  </details>
                )}
              </div>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}