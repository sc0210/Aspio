'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslation } from 'react-i18next';
import { SparklesIcon } from '@heroicons/react/24/outline';
import { Modal } from '@/components/ui/Modal';
import { useWhatsNew } from '@/hooks/useWhatsNew';

/**
 * Auto-opening "What's New" dialog — mounted once app-wide. It pops up the first
 * time a user loads the app after a new release, lists the highlights they
 * haven't seen, and marks the version acknowledged on close. This is the
 * client-side "notify the user" mechanism (no backend notification needed).
 */
export function WhatsNewModal() {
    const { t, i18n } = useTranslation('common');
    const { hasUnseen, unseenEntries, markSeen } = useWhatsNew();
    const [open, setOpen] = useState(false);
    const [autoShown, setAutoShown] = useState(false);
    const zh = i18n.language?.startsWith('zh');

    // Auto-open exactly once per session when there is unseen news.
    useEffect(() => {
        if (hasUnseen && !autoShown) {
            setOpen(true);
            setAutoShown(true);
        }
    }, [hasUnseen, autoShown]);

    const close = () => {
        setOpen(false);
        markSeen();
    };

    if (!open || unseenEntries.length === 0) return null;

    return (
        <Modal isOpen={open} onClose={close} title={t('whatsNew.title', "What's New")}>
            <div className="space-y-5">
                {unseenEntries.map((entry) => (
                    <div key={entry.version}>
                        <div className="flex items-baseline justify-between gap-2 mb-2">
                            <h4 className="text-sm font-bold text-gray-900 dark:text-white">
                                {zh ? entry.title.zh : entry.title.en}
                            </h4>
                            <span className="text-xs text-gray-500 dark:text-gray-400 tabular-nums">{entry.date}</span>
                        </div>
                        <ul className="space-y-2">
                            {entry.highlights.map((h, i) => (
                                <li key={i} className="flex items-start gap-2.5">
                                    <span className="text-lg leading-none mt-0.5" aria-hidden="true">{h.emoji}</span>
                                    <span className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">
                                        {zh ? h.text.zh : h.text.en}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    </div>
                ))}
            </div>

            <div className="mt-6 flex items-center justify-between gap-3">
                <Link
                    href="/changelog"
                    onClick={close}
                    className="text-xs font-medium text-primary-600 dark:text-primary-400 hover:underline rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
                >
                    {t('whatsNew.viewAll', 'View all updates')}
                </Link>
                <button
                    type="button"
                    onClick={close}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 hover:bg-primary-700 px-4 py-2 text-sm font-semibold text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-800"
                >
                    <SparklesIcon className="w-4 h-4" />
                    {t('whatsNew.gotIt', 'Got it')}
                </button>
            </div>
        </Modal>
    );
}
