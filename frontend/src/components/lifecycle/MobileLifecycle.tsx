'use client';

import { useTranslation } from 'react-i18next';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { BiggerScreenHint } from '@/components/dashboard/BiggerScreenHint';
import { PositionHeader } from '@/components/lifecycle/PositionHeader';
import { SafetyPanel } from '@/components/lifecycle/SafetyPanel';
import { useLifecycleModel } from '@/components/lifecycle/useLifecycleModel';

/**
 * The strategy on a phone (#344): question 1, where the leverage stands against
 * its target (PositionHeader), and question 3, what could force a sale
 * (SafetyPanel) — the two you check, rather than study. The history chart, the
 * glidepath, the spread and the loan picker stay on the full page.
 */
export function MobileLifecycle() {
    const { t } = useTranslation(['common', 'dashboard']);
    const { position, target, tracking, preferences, stress, cashFlowBasisMonths, showSpinner } =
        useLifecycleModel();

    return (
        <DashboardLayout>
            <div className="max-w-md mx-auto space-y-4 pb-4">
                <h1 className="pt-1 text-xl font-extrabold tracking-tight text-gray-900 dark:text-white">
                    {t('common:lifecycle.pageTitle', 'Lifecycle Investing')}
                </h1>

                <BiggerScreenHint />

                {showSpinner ? (
                    <div className="flex items-center justify-center py-24"><LoadingSpinner /></div>
                ) : (
                    <>
                        <PositionHeader
                            position={position}
                            target={target}
                            tracking={tracking}
                            maxLeverage={preferences.maxLeverage}
                        />
                        <SafetyPanel stress={stress} cashFlowBasisMonths={cashFlowBasisMonths} />
                    </>
                )}

                <p className="text-center px-4 pt-1 text-xs font-semibold leading-relaxed text-gray-400 dark:text-gray-500">
                    {t('dashboard:mobile.fullLifecycle', 'Leverage history, glidepath, spread & loan picker')}
                    <br />
                    <span className="text-primary-600 dark:text-primary-400">→ {t('dashboard:mobile.onLargerScreen', 'on tablet / desktop')}</span>
                </p>
            </div>
        </DashboardLayout>
    );
}
