'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SparklesIcon, ChevronDownIcon } from '@heroicons/react/24/outline';
import { cn } from '@/utils/cn';
import { LIFECYCLE_PRINCIPLES } from '@/lib/lifecycle';
import { Card } from '@/components/ui/Card';

/**
 * The guardrails that separate lifecycle investing from simply borrowing to buy
 * stocks. The gauges say *where you are*; these say *which of them you are not
 * allowed to ignore*. Rendered bilingually, following the app language.
 */
export function LifecyclePrinciples() {
    const { t, i18n } = useTranslation('common');
    const [open, setOpen] = useState(false);
    const zh = i18n.language?.startsWith('zh');

    return (
        <Card padding="md" clip>
            <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                className="w-full flex items-center justify-between gap-2 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
                aria-expanded={open}
            >
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-1.5">
                    <SparklesIcon className="w-4 h-4 text-amber-500" />
                    {t('lifecycle.principles.title', 'Rules of the strategy')}
                </h3>
                <ChevronDownIcon className={cn('w-4 h-4 text-gray-400 transition-transform', open && 'rotate-180')} />
            </button>

            <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">
                {t('lifecycle.principles.subtitle', 'Leverage is only defensible with guardrails. These are the ones that keep a bad market from becoming a permanent loss.')}
            </p>

            {open && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
                    {LIFECYCLE_PRINCIPLES.map((p, i) => (
                        <div key={i} className="rounded-xl border border-gray-100 dark:border-gray-700 bg-gray-50/60 dark:bg-gray-800/60 p-3">
                            <div className="flex items-start gap-2">
                                <span className="text-lg leading-none mt-0.5" aria-hidden="true">{p.emoji}</span>
                                <div className="min-w-0">
                                    <p className="text-xs font-semibold text-gray-800 dark:text-gray-100">
                                        {zh ? p.title.zh : p.title.en}
                                    </p>
                                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 leading-relaxed">
                                        {zh ? p.body.zh : p.body.en}
                                    </p>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </Card>
    );
}
