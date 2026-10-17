'use client';

import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { PageHeader } from '@/components/layout/PageHeader';
import { useWhatsNew } from '@/hooks/useWhatsNew';
import { Card } from '@/components/ui/Card';

/**
 * Full version history ("更新內容"). Visiting the page acknowledges the latest
 * release, so the "What's New" dot clears once the user has read it here.
 */
export default function ChangelogPage() {
    const { t, i18n } = useTranslation('common');
    const { entries, markSeen } = useWhatsNew();
    const zh = i18n.language?.startsWith('zh');

    useEffect(() => {
        markSeen();
    }, [markSeen]);

    return (
        <DashboardLayout>
            <div className="max-w-3xl mx-auto space-y-5 pb-8">
                <PageHeader
                    title={t('whatsNew.pageTitle', "What's New")}
                    subtitle={t('whatsNew.pageSubtitle', 'Recent improvements to your Aspiro experience.')}
                    accent="blue"
                />

                <ol className="relative border-l border-gray-200 dark:border-gray-700 ml-3 space-y-8">
                    {entries.map((entry) => (
                        <li key={entry.version} className="ml-6">
                            <span className="absolute -left-[9px] mt-1.5 h-4 w-4 rounded-full bg-primary-500 border-2 border-white dark:border-gray-900" aria-hidden="true" />
                            <Card padding="md">
                                <div className="flex items-baseline justify-between gap-2 mb-3">
                                    <h2 className="text-base font-bold text-gray-900 dark:text-white">
                                        {zh ? entry.title.zh : entry.title.en}
                                    </h2>
                                    <span className="text-xs text-gray-500 dark:text-gray-400 tabular-nums flex-shrink-0">{entry.date}</span>
                                </div>
                                <ul className="space-y-2.5">
                                    {entry.highlights.map((h, i) => (
                                        <li key={i} className="flex items-start gap-2.5">
                                            <span className="text-lg leading-none mt-0.5" aria-hidden="true">{h.emoji}</span>
                                            <span className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">
                                                {zh ? h.text.zh : h.text.en}
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                            </Card>
                        </li>
                    ))}
                </ol>
            </div>
        </DashboardLayout>
    );
}
