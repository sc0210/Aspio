/**
 * Analytics Consent Banner
 * Cookie consent and privacy-compliant analytics opt-in
 */

'use client';

import { useState, useEffect } from 'react';
import { XMarkIcon, ShieldCheckIcon } from '@heroicons/react/24/outline';
import { setAnalyticsConsent } from '@/lib/analytics/config';
import { analyticsProvider } from '@/lib/analytics/provider';
import { Button } from '@/components/ui/Button';
import { cn } from '@/utils/cn';

export function AnalyticsConsentBanner() {
    const [isVisible, setIsVisible] = useState(false);
    const [isExpanded, setIsExpanded] = useState(false);

    useEffect(() => {
        // Check if user has already made a consent choice
        const consentKey = 'aspiro_analytics_consent';
        const consent = localStorage.getItem(consentKey);

        // Show banner if no consent decision has been made
        if (!consent) {
            // Delay showing banner slightly for better UX
            const timer = setTimeout(() => setIsVisible(true), 1000);
            return () => clearTimeout(timer);
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

    return (
        <div
          role="region"
          aria-label="Privacy and analytics consent"
          className="fixed bottom-0 left-0 right-0 z-50 p-4 pb-[calc(3.5rem+env(safe-area-inset-bottom,0px))] sm:p-6"
        >
            <div className="max-w-4xl mx-auto">
                <div className={cn(
                    'bg-white dark:bg-gray-800 rounded-lg shadow-2xl border border-gray-200 dark:border-gray-700',
                    'transform transition-all duration-300 ease-in-out',
                    isVisible ? 'translate-y-0 opacity-100' : 'translate-y-full opacity-0'
                )}>
                    <div className="p-4 sm:p-6">
                        {/* Header */}
                        <div className="flex items-start gap-4 mb-4">
                            <div className="flex-shrink-0">
                                <ShieldCheckIcon className="w-8 h-8 text-primary-600 dark:text-primary-400" />
                            </div>
                            <div className="flex-1">
                                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                                    Privacy & Analytics
                                </h3>
                                <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">
                                    We use privacy-respectful analytics to understand how you use Aspiro and improve your experience.
                                    {!isExpanded && (
                                        <button
                                            onClick={() => setIsExpanded(true)}
                                            className="ml-1 text-primary-600 dark:text-primary-400 hover:underline font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1 rounded"
                                            aria-expanded={isExpanded}
                                            aria-controls="analytics-details"
                                        >
                                            Learn more
                                        </button>
                                    )}
                                </p>

                                {isExpanded && (
                                    <div id="analytics-details" className="mt-3 space-y-2 text-sm text-gray-600 dark:text-gray-400">
                                        <p className="font-medium text-gray-700 dark:text-gray-300">
                                            What we track:
                                        </p>
                                        <ul className="list-disc list-inside space-y-1 ml-2">
                                            <li>Page views and feature usage patterns</li>
                                            <li>Report generation and export events</li>
                                            <li>General navigation and interaction behavior</li>
                                            <li>Performance metrics and error reports</li>
                                        </ul>

                                        <p className="font-medium text-gray-700 dark:text-gray-300 mt-3">
                                            What we DON&apos;T track:
                                        </p>
                                        <ul className="list-disc list-inside space-y-1 ml-2">
                                            <li>Your personal financial amounts or balances</li>
                                            <li>Transaction details or descriptions</li>
                                            <li>Account numbers or sensitive information</li>
                                            <li>Personally identifiable information (PII)</li>
                                        </ul>

                                        <p className="mt-3">
                                            All analytics are anonymized, IP addresses are masked, and we respect your browser&apos;s &quot;Do Not Track&quot; setting.
                                            You can change your preference anytime in Settings.
                                        </p>
                                    </div>
                                )}
                            </div>
                            <button
                                onClick={handleDecline}
                                className="flex-shrink-0 p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                                aria-label="Dismiss privacy banner"
                            >
                                <XMarkIcon className="w-5 h-5" />
                            </button>
                        </div>

                        {/* Actions */}
                        <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
                            <Button
                                onClick={handleAccept}
                                className="flex-1 sm:flex-none"
                                size="sm"
                            >
                                Accept Analytics
                            </Button>
                            <Button
                                onClick={handleDecline}
                                variant="secondary"
                                className="flex-1 sm:flex-none"
                                size="sm"
                            >
                                Decline
                            </Button>
                            {!isExpanded && (
                                <button
                                    onClick={() => setIsExpanded(true)}
                                    className="text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 font-medium sm:ml-auto focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1 rounded min-h-[44px] px-2"
                                    aria-expanded={isExpanded}
                                >
                                    Customize
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
