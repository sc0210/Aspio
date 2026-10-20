'use client';

import Link from 'next/link';
import { useTranslation } from 'react-i18next';
import { SparklesIcon } from '@heroicons/react/24/outline';
import { useWhatsNew } from '@/hooks/useWhatsNew';

/**
 * Compact top-bar entry point to the changelog, with an unseen-release dot.
 * Complements the sidebar link so mobile users (whose sidebar is behind the
 * hamburger) have a one-tap way to reach "What's New".
 */
export function WhatsNewButton() {
    const { t } = useTranslation('common');
    const { hasUnseen } = useWhatsNew();

    return (
        <Link
            href="/changelog"
            aria-label={hasUnseen
                ? t('whatsNew.unseenAria', "What's New — new updates available")
                : t('navigation.whatsNew', "What's New")}
            // p-2 alone measured 40x40 on a phone; hold a 44px floor on touch
            // screens and fall back to the tighter box once a pointer is likely.
            className="relative p-2 min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 rounded-lg text-gray-600 hover:text-gray-700 hover:bg-gray-100 dark:text-gray-400 dark:hover:text-gray-200 dark:hover:bg-gray-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 flex items-center justify-center"
        >
            <SparklesIcon className="w-6 h-6 md:w-5 md:h-5" />
            {hasUnseen && (
                <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-primary-500 ring-2 ring-white dark:ring-gray-800" aria-hidden="true" />
            )}
        </Link>
    );
}
