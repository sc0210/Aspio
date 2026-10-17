'use client';

import { useTranslation } from 'react-i18next';
import { Squares2X2Icon, ViewfinderCircleIcon } from '@heroicons/react/24/outline';
import { TOP_BAR_SEGMENTED, topBarSegment } from '@/components/layout/topBarStyles';
import { useDashboardViewMode, type DashboardViewMode } from '@/hooks/useDashboardViewMode';

/**
 * Compact ⇄ Full segmented control for the desktop dashboard top bar. Advertises
 * that both a glanceable view and the full power tool exist. Renders nothing until
 * the stored preference resolves (avoids a flash of the wrong active state).
 */
export function DashboardViewToggle() {
    const { t } = useTranslation('dashboard');
    const [mode, setMode] = useDashboardViewMode();
    if (mode === null) return null;

    const options: { key: DashboardViewMode; label: string; Icon: typeof Squares2X2Icon }[] = [
        { key: 'compact', label: t('view.compact', 'Compact'), Icon: ViewfinderCircleIcon },
        { key: 'full', label: t('view.full', 'Full'), Icon: Squares2X2Icon },
    ];

    return (
        <div
            role="group"
            aria-label={t('view.label', 'Dashboard view')}
            className={TOP_BAR_SEGMENTED}
        >
            {options.map(({ key, label, Icon }) => {
                const active = mode === key;
                return (
                    <button
                        key={key}
                        type="button"
                        onClick={() => setMode(key)}
                        aria-pressed={active}
                        className={topBarSegment(active)}
                    >
                        <Icon className="w-4 h-4" />
                        {label}
                    </button>
                );
            })}
        </div>
    );
}
