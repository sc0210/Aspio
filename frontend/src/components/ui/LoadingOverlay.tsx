'use client';

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FadeInOut, ScaleFade } from './CSSAnimations';
import { cn } from '@/utils/cn';

interface LoadingOverlayProps {
  isLoading: boolean;
  /** Defaults to the shared "Loading…" string, so callers may omit it. */
  message?: string;
  showProgress?: boolean;
  progress?: number;
}

export function LoadingOverlay({
  isLoading,
  message,
  showProgress = false,
  progress = 0
}: LoadingOverlayProps) {
  const { t } = useTranslation('common');
  const [dots, setDots] = useState('');
  const [showHint, setShowHint] = useState(false);

  useEffect(() => {
    if (!isLoading) {
      setShowHint(false);
      return;
    }

    const interval = setInterval(() => {
      setDots(prev => {
        if (prev === '...') return '';
        return prev + '.';
      });
    }, 500);

    // Show hint after 2 seconds
    const hintTimer = setTimeout(() => setShowHint(true), 2000);

    return () => {
      clearInterval(interval);
      clearTimeout(hintTimer);
    };
  }, [isLoading]);

  return (
    <FadeInOut show={isLoading} duration={200}>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center backdrop-blur-sm"
      >
        {/* Backdrop */}
        <div className="absolute inset-0 bg-black/20 dark:bg-black/40" />

        {/* Loading Content */}
        <ScaleFade show={isLoading} duration={300}>
          <div className="relative z-10 bg-white/90 dark:bg-gray-800/90 backdrop-blur-sm rounded-2xl p-8 shadow-2xl border border-gray-200/50 dark:border-gray-700/50 max-w-sm mx-4">
            {/* Spinner */}
            <div className="flex flex-col items-center space-y-6">
              <div className="relative">
                {/* Outer spinning ring */}
                <div className="w-16 h-16 border-4 border-primary-200 dark:border-primary-800 rounded-full animate-spin-slow" />

                {/* Inner spinning arc */}
                <div className="absolute inset-0 w-16 h-16 border-4 border-transparent border-t-primary-500 border-r-primary-500 rounded-full animate-spin-reverse" />

                {/* Center dot */}
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-3 h-3 bg-primary-500 rounded-full animate-pulse" />
                </div>
              </div>

              {/* Loading Text */}
              <div className="text-center">
                <p className="text-gray-700 dark:text-gray-300 font-medium text-lg animate-pulse">
                  {message ?? t('common.loading')}
                  <span className="w-6 inline-block text-left">{dots}</span>
                </p>

                {/* Progress Bar */}
                {showProgress && (
                  <div className="mt-4 w-full">
                    <div className="flex justify-between text-sm text-gray-600 dark:text-gray-400 mb-2">
                      <span>{t('loadingOverlay.progress')}</span>
                      <span>{Math.round(progress)}%</span>
                    </div>
                    <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2 overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-primary-500 to-primary-600 rounded-full relative overflow-hidden transition-all duration-500 ease-out"
                        style={{ width: `${progress}%` }}
                      >
                        {/* Shimmer effect */}
                        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent animate-shimmer" />
                      </div>
                    </div>
                  </div>
                )}

                {/* Subtle hint */}
                <p
                  className={cn(
                    "text-xs text-gray-500 dark:text-gray-400 mt-3 transition-opacity duration-500",
                    showHint ? "opacity-60" : "opacity-0"
                  )}
                >
                  {t('loadingOverlay.hint')}
                </p>
              </div>
            </div>
          </div>
        </ScaleFade>
      </div>
    </FadeInOut>
  );
}
