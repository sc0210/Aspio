'use client';

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { XMarkIcon } from '@heroicons/react/24/outline';

const STORAGE_KEY = 'aspiro-bigscreen-hint-dismissed';
// When this browser first saw the dashboard. Time, not a per-tab session flag,
// so a second tab opened during the first visit doesn't count as "later".
const FIRST_SEEN_KEY = 'aspiro-bigscreen-hint-first-seen';
const SHOW_AFTER_MS = 12 * 60 * 60 * 1000;

/**
 * A one-time, dismissible nudge steering phone users to a tablet/desktop for the
 * full, control-heavy experience. Dismissal persists in localStorage so it never
 * nags. It waits 12 hours after the first visit: on a first visit it stacked on top of the
 * demo banner and pushed the dashboard itself below the fold. Renders nothing
 * until storage has been read (avoids a flash).
 */
export function BiggerScreenHint() {
    const { t } = useTranslation('dashboard');
    const [show, setShow] = useState(false);

    useEffect(() => {
        try {
            if (localStorage.getItem(STORAGE_KEY) === '1') return;
            const firstSeen = Number(localStorage.getItem(FIRST_SEEN_KEY));
            if (!firstSeen) {
                localStorage.setItem(FIRST_SEEN_KEY, String(Date.now()));
                return;
            }
            setShow(Date.now() - firstSeen >= SHOW_AFTER_MS);
        } catch {
            /* storage unavailable — dismissal couldn't persist, so don't nag */
        }
    }, []);

    const dismiss = () => {
        try {
            localStorage.setItem(STORAGE_KEY, '1');
        } catch {
            /* private mode — non-fatal */
        }
        setShow(false);
    };

    if (!show) return null;

    return (
        <div className="flex items-center gap-2 rounded-2xl border border-primary-200 dark:border-primary-800/50 bg-primary-50 dark:bg-primary-900/20 px-3.5 py-2.5 text-[12.5px] font-medium leading-snug text-primary-800 dark:text-primary-200">
            <span aria-hidden="true" className="text-sm">📱</span>
            <span className="min-w-0">
                {t('mobile.bigScreenHint', 'Want full control? Open Aspiro on a tablet or desktop for detailed tables & editing.')}
            </span>
            <button
                type="button"
                onClick={dismiss}
                aria-label={t('mobile.dismissHint', 'Dismiss')}
                // 44px hit area: the icon stays 16px, but a p-1 button measured
                // 24x24 on a phone — well under the 44px minimum this codebase
                // already uses elsewhere, and this is a touch-only component.
                className="ml-auto -mr-1 flex-shrink-0 inline-flex items-center justify-center min-w-[44px] min-h-[44px] rounded-lg text-primary-400 hover:text-primary-700 dark:hover:text-primary-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
            >
                <XMarkIcon className="w-4 h-4" />
            </button>
        </div>
    );
}
