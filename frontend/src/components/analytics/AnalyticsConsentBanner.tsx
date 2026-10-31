/**
 * Analytics Consent Banner
 * Asks once, per browser, before any analytics runs. Shown only when analytics
 * can actually run (a provider is configured and Do Not Track is off): asking
 * for consent to collect nothing would be noise.
 */

'use client';

import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { XMarkIcon, ShieldCheckIcon } from '@heroicons/react/24/outline';
import { setAnalyticsConsent, isAnalyticsAvailable, defaultAnalyticsConfig, ANALYTICS_CONSENT_EVENT } from '@/lib/analytics/config';
import { analyticsProvider } from '@/lib/analytics/provider';
import { Button } from '@/components/ui/Button';
import { cn } from '@/utils/cn';

export function AnalyticsConsentBanner() {
    const { t } = useTranslation('common');
    const [isVisible, setIsVisible] = useState(false);
    const [isExpanded, setIsExpanded] = useState(false);

    useEffect(() => {
        if (!isAnalyticsAvailable()) return;

        // Check if user has already made a consent choice
        const consentKey = 'aspiro_analytics_consent';
        const consent = localStorage.getItem(consentKey);

        // Show banner if no consent decision has been made
        if (!consent) {
            // A choice made elsewhere (Settings, another tab) retires the banner, so a
            // later tap here cannot silently overwrite it.
            const hideOnChoice = () => {
                if (localStorage.getItem(consentKey)) setIsVisible(false);
            };
            window.addEventListener(ANALYTICS_CONSENT_EVENT, hideOnChoice);
            window.addEventListener('storage', hideOnChoice);
            // Delay showing banner slightly for better UX
            const timer = setTimeout(() => {
                if (!localStorage.getItem(consentKey)) setIsVisible(true);
            }, 1000);
            return () => {
                clearTimeout(timer);
                window.removeEventListener(ANALYTICS_CONSENT_EVENT, hideOnChoice);
                window.removeEventListener('storage', hideOnChoice);
            };
        }
    }, []);

    const handleAccept = () => {
        setAnalyticsConsent(true);
        analyticsProvider.initialize().catch(() => {
        });
        setIsVisible(false);
    };

    const handleDecline = () => {
        setAnalyticsConsent(false);
        setIsVisible(false);
    };

    if (!isVisible) {
        return null;
    }

    const usesCloudflare = !!defaultAnalyticsConfig.providers.cloudflare?.enabled;

    return (
        <div
          role="region"
          aria-label="Privacy and analytics consent"
          className="fixed bottom-0 left-0 right-0 z-50 p-4 pb-[calc(3.5rem+env(safe-area-inset-bottom,0px))] sm:p-6"
        >
            <div className="max-w-4xl mx-auto">
                <div className={cn(
                    'bg-white dark:bg-gray-800 rounded-lg shadow-2xl border border-gray-200 dark:border-gray-700',
                    'transform transition-all duration-300 ease-in-out motion-reduce:transition-none',
                    isVisible ? 'translate-y-0 opacity-100' : 'translate-y-full opacity-0'
                )}>
                    <div className="p-4 sm:p-6">
                        {/* Header */}
                        <div className="flex items-start gap-4 mb-4">
                            <div className="flex-shrink-0">
                                <ShieldCheckIcon className="w-8 h-8 text-primary-700 dark:text-primary-400" aria-hidden="true" />
                            </div>
                            <div className="flex-1">
                                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                                    {t('analyticsConsent.title', 'Privacy & Analytics')}
                                </h3>
                                <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">
                                    {t('analyticsConsent.body', 'May Aspiro count which pages are used and how fast they load? It helps us improve the app, and never includes your financial data.')}
                                    {!isExpanded && (
                                        <button
                                            onClick={() => setIsExpanded(true)}
                                            className="ml-1 text-primary-700 dark:text-primary-400 hover:underline font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1 rounded"
                                            aria-expanded={isExpanded}
                                            aria-controls="analytics-details"
                                        >
                                            {t('analyticsConsent.learnMore', 'Learn more')}
                                        </button>
                                    )}
                                </p>

                                {isExpanded && (
                                    <div id="analytics-details" className="mt-3 space-y-2 text-sm text-gray-600 dark:text-gray-400">
                                        <p className="font-medium text-gray-700 dark:text-gray-300">
                                            {t('analyticsConsent.collectedTitle', 'What is collected:')}
                                        </p>
                                        <ul className="list-disc list-inside space-y-1 ml-2">
                                            <li>{t('analyticsConsent.collectedPages', 'Pages visited and the site you came from')}</li>
                                            <li>{t('analyticsConsent.collectedDevice', 'Browser, device type and country')}</li>
                                            <li>{t('analyticsConsent.collectedSpeed', 'How fast pages load')}</li>
                                        </ul>

                                        <p className="font-medium text-gray-700 dark:text-gray-300 mt-3">
                                            {t('analyticsConsent.notCollectedTitle', 'What is never collected:')}
                                        </p>
                                        <ul className="list-disc list-inside space-y-1 ml-2">
                                            <li>{t('analyticsConsent.notAmounts', 'Amounts, balances or transactions')}</li>
                                            <li>{t('analyticsConsent.notIdentity', 'Your name, email or account details')}</li>
                                        </ul>

                                        <p className="mt-3">
                                            {usesCloudflare && (
                                                <>{t('analyticsConsent.cloudflare', 'Analytics is provided by Cloudflare Web Analytics, which sets no cookies and does not fingerprint visitors.')}{' '}</>
                                            )}
                                            {t('analyticsConsent.dnt', 'Nothing is sent if your browser asks sites not to track you.')}{' '}
                                            {t('analyticsConsent.changeLater', 'You can change this anytime in Settings → Privacy & Display.')}
                                        </p>
                                    </div>
                                )}
                            </div>
                            <button
                                onClick={handleDecline}
                                className="flex-shrink-0 p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center text-gray-500 dark:text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 rounded"
                                aria-label="Dismiss privacy banner"
                            >
                                <XMarkIcon className="w-5 h-5" aria-hidden="true" />
                            </button>
                        </div>

                        {/* Actions */}
                        <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
                            <Button
                                onClick={handleAccept}
                                className="flex-1 sm:flex-none"
                                size="sm"
                            >
                                {t('analyticsConsent.accept', 'Accept Analytics')}
                            </Button>
                            <Button
                                onClick={handleDecline}
                                variant="secondary"
                                className="flex-1 sm:flex-none"
                                size="sm"
                            >
                                {t('analyticsConsent.decline', 'Decline')}
                            </Button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
