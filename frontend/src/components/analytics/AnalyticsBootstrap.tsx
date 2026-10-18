'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { analyticsProvider } from '@/lib/analytics/provider';
import { hasAnalyticsConsent, shouldTrackAnalytics } from '@/lib/analytics/config';
import { webVitalsReporter } from '@/lib/vitals';
import { log } from '@/utils/logger';

/** Maximum length for error messages sent to analytics — avoids leaking stack details. */
const MAX_ERROR_MSG_LENGTH = 200;

/** Capture a client-side error and forward it to analytics (consent-gated). */
function reportClientError(
    errorType: 'unhandled_rejection' | 'global_error',
    message: string,
    source?: string
) {
    if (!shouldTrackAnalytics() || !hasAnalyticsConsent()) return;

    analyticsProvider.track('js_error', {
        error_type: errorType,
        error_message: message.slice(0, MAX_ERROR_MSG_LENGTH),
        // source is a filename/URL — safe to include but cap length
        error_source: (source ?? '').slice(0, 200),
        page: typeof window !== 'undefined' ? window.location.pathname : '',
    });
}

export function AnalyticsBootstrap() {
    const pathname = usePathname();

    // Initialise analytics on first mount; Web Vitals report through it (consent-gated)
    useEffect(() => {
        analyticsProvider.initialize().catch((error) => {
            log.warn('Analytics initialization failed', error, 'Analytics');
        });
        webVitalsReporter.init();
    }, []);

    // Track page views on navigation
    useEffect(() => {
        if (!pathname || !hasAnalyticsConsent()) {
            return;
        }

        analyticsProvider.pageView(pathname);
    }, [pathname]);

    // Re-initialise when the user grants consent (cross-tab storage event)
    useEffect(() => {
        const handleConsentChange = () => {
            if (!hasAnalyticsConsent()) {
                return;
            }

            analyticsProvider.initialize().catch((error) => {
                log.warn('Analytics re-initialization failed after consent change', error, 'Analytics');
            });
        };

        window.addEventListener('storage', handleConsentChange);
        return () => {
            window.removeEventListener('storage', handleConsentChange);
        };
    }, []);

    // Capture unhandled promise rejections
    useEffect(() => {
        const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
            const reason = event.reason;
            const message =
                reason instanceof Error
                    ? reason.message
                    : typeof reason === 'string'
                        ? reason
                        : 'Unhandled promise rejection';

            log.error('Unhandled promise rejection', reason, 'Analytics');
            reportClientError('unhandled_rejection', message);
        };

        window.addEventListener('unhandledrejection', handleUnhandledRejection);
        return () => {
            window.removeEventListener('unhandledrejection', handleUnhandledRejection);
        };
    }, []);

    // Capture uncaught synchronous errors that escape React's error boundary
    // (e.g. errors thrown in event handlers or third-party scripts)
    useEffect(() => {
        const handleGlobalError = (event: ErrorEvent) => {
            const message = event.message ?? 'Unknown error';
            const source = event.filename ?? '';

            log.error('Global uncaught error', { message, source, line: event.lineno }, 'Analytics');
            reportClientError('global_error', message, source);
        };

        window.addEventListener('error', handleGlobalError);
        return () => {
            window.removeEventListener('error', handleGlobalError);
        };
    }, []);

    return null;
}
