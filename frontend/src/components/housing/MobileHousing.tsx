'use client';

import { useTranslation } from 'react-i18next';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { BiggerScreenHint } from '@/components/dashboard/BiggerScreenHint';
import { AffordabilityPanel } from '@/components/housing/AffordabilityPanel';
import { ReadinessScorecard } from '@/components/housing/ReadinessScorecard';
import { useHousingModel, INITIAL_DERIVED } from '@/components/housing/useHousingModel';

/**
 * The house plan on a phone (#344): what you could pay today (the affordability
 * headline), then how ready you are (the four-condition scorecard). The simulator,
 * the car-impact panel and the principles are for sitting down with — they stay on
 * the full page. Without the simulator the plan uses its default loan terms.
 */
export function MobileHousing() {
    const { t } = useTranslation(['common', 'dashboard']);
    const { seed, affordability, cashFlowBasisMonths, showSpinner } = useHousingModel(INITIAL_DERIVED);

    return (
        <DashboardLayout>
            <div className="max-w-md mx-auto space-y-4 pb-4">
                <h1 className="pt-1 text-xl font-extrabold tracking-tight text-gray-900 dark:text-white">
                    {t('common:housing.pageTitle', 'Buy vs. Rent — House Plan')}
                </h1>

                <BiggerScreenHint />

                {showSpinner ? (
                    <div className="flex items-center justify-center py-24"><LoadingSpinner /></div>
                ) : (
                    <>
                        <AffordabilityPanel inputs={affordability} cashFlowBasisMonths={cashFlowBasisMonths} />
                        <ReadinessScorecard
                            seed={seed}
                            cashNeededAtPurchase={INITIAL_DERIVED.upfrontCash}
                            monthlyHousingCost={INITIAL_DERIVED.monthlyHousingCost}
                            cashFlowBasisMonths={cashFlowBasisMonths}
                        />
                    </>
                )}

                <p className="text-center px-4 pt-1 text-xs font-semibold leading-relaxed text-gray-400 dark:text-gray-500">
                    {t('dashboard:mobile.fullHousing', 'Buy-vs-rent simulator, loan terms & car impact')}
                    <br />
                    <span className="text-primary-600 dark:text-primary-400">→ {t('dashboard:mobile.onLargerScreen', 'on tablet / desktop')}</span>
                </p>
            </div>
        </DashboardLayout>
    );
}
