'use client';

import { useCallback } from 'react';
import { useAppMode } from './useAppMode';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';

interface ApiError extends Error {
  statusCode?: number;
  response?: {
    status?: number;
    data?: {
      message?: string;
      detail?: string;
    };
  };
  isNetworkError?: boolean;
}

/**
 * Centralized API error handling hook
 * Provides consistent error handling across the application
 */
export function useApiErrorHandler() {
  const { isDemo } = useAppMode();
  const { t } = useTranslation(['common']);

  const handleApiError = useCallback((error: ApiError, context?: string) => {
    console.error(`API Error${context ? ` in ${context}` : ''}:`, error);

    // Network errors
    if (error.isNetworkError || !error.statusCode) {
      if (isDemo) {
        toast.error(t('common:apiErrors.demoMode'));
      } else {
        toast.error(t('common:apiErrors.networkError'));
      }
      return;
    }

    // Authentication errors
    if (error.statusCode === 401) {
      if (isDemo) {
        toast.error(t('common:apiErrors.demoAuth'));
      } else {
        toast.error(t('common:apiErrors.authRequired'));
        // Could trigger sign-in flow here
      }
      return;
    }

    // Authorization errors
    if (error.statusCode === 403) {
      toast.error(t('common:apiErrors.forbidden'));
      return;
    }

    // Not found errors
    if (error.statusCode === 404) {
      toast.error(t('common:apiErrors.notFound'));
      return;
    }

    // Validation errors
    if (error.statusCode === 422) {
      const validationMessage = error.response?.data?.message || 'Invalid data provided';
      toast.error(validationMessage);
      return;
    }

    // Server errors
    if (error.statusCode >= 500) {
      toast.error(t('common:apiErrors.serverError'));
      return;
    }

    // Rate limiting
    if (error.statusCode === 429) {
      toast.error(t('common:apiErrors.tooManyRequests'));
      return;
    }

    // Generic error
    const message = error.message || 'An unexpected error occurred';
    toast.error(message);
  }, [isDemo, t]);

  const handleQueryError = useCallback((error: unknown, context?: string) => {
    // Convert React Query errors to our ApiError format
    const err = error as Partial<ApiError>;
    const apiError: ApiError = {
      name: err.name || 'ApiError',
      message: err.message || 'Unknown error',
      statusCode: err.response?.status || err.statusCode,
      response: err.response,
      isNetworkError: !err.response && !err.statusCode,
    };

    handleApiError(apiError, context);
  }, [handleApiError]);

  const createErrorHandler = useCallback((context: string) => {
    return (error: unknown) => handleQueryError(error, context);
  }, [handleQueryError]);

  const getErrorMessage = useCallback((error: unknown) => {
    if (!error) return 'Unknown error';

    const err = error as Partial<ApiError>;

    if (err.statusCode === 401) {
      return isDemo ? 'Demo mode: Authentication required' : 'Please sign in to access this feature';
    }

    if (err.statusCode === 404) {
      return 'Data not found';
    }

    if (err.statusCode !== undefined && err.statusCode >= 500) {
      return 'Server error occurred';
    }

    if (err.isNetworkError || !err.statusCode) {
      return isDemo ? 'Demo mode: Using sample data' : 'Connection error';
    }

    return err.message || 'An error occurred';
  }, [isDemo]);

  const isRetryableError = useCallback((error: unknown) => {
    if (!error) return false;

    const err = error as Partial<ApiError>;

    // Don't retry auth errors in demo mode
    if (err.statusCode === 401 && isDemo) return false;

    // Retry network errors and server errors
    return !!(err.isNetworkError || (err.statusCode !== undefined && (err.statusCode >= 500 || err.statusCode === 429)));
  }, [isDemo]);

  return {
    handleApiError,
    handleQueryError,
    createErrorHandler,
    getErrorMessage,
    isRetryableError,
  };
}