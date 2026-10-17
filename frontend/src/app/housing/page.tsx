'use client';

import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { PageHeader } from '@/components/layout/PageHeader';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { useIsMobile } from '@/hooks/useMediaQuery';
import { ReadinessScorecard } from '@/components/housing/ReadinessScorecard';
import { AffordabilityPanel } from '@/components/housing/AffordabilityPanel';
import { BuyVsRentSimulator, type SimulatorDerived } from '@/components/housing/BuyVsRentSimulator';
import { CarImpactPanel } from '@/components/housing/CarImpactPanel';
import { HousingPrinciples } from '@/components/housing/HousingPrinciples';
import { MobileHousing } from '@/components/housing/MobileHousing';
import { useHousingModel, INITIAL_DERIVED } from '@/components/housing/useHousingModel';

function DesktopHousingPage() {
    const { t } = useTranslation('common');

    // The simulator reports what its current inputs imply; every panel reads it
    // through useHousingModel, which the phone view shares.
    const [derived, setDerived] = useState<SimulatorDerived>(INITIAL_DERIVED);
    const handleDerived = useCallback((d: SimulatorDerived) => setDerived(d), []);
    const { seed, affordability, houseContext, cashFlowBasisMonths, showSpinner } = useHousingModel(derived);

    return (
        <DashboardLayout>
            <div className="max-w-6xl mx-auto space-y-5 pb-8">
                {/* Header */}
                <PageHeader
                    title={t('housing.pageTitle', 'Buy vs. Rent — House Plan')}
                    subtitle={t('housing.pageSubtitle', 'When can you buy — and stay financially calm afterwards? Plan it before you decide.')}
                    accent="indigo"
                />

                {showSpinner ? (
                    <div className="flex items-center justify-center py-24">
                        <LoadingSpinner />
                    </div>
                ) : (
                    <>
                        <AffordabilityPanel
                            inputs={affordability}
                            cashFlowBasisMonths={cashFlowBasisMonths}
                        />
                        <ReadinessScorecard
                            seed={seed}
                            cashNeededAtPurchase={derived.upfrontCash}
                            monthlyHousingCost={derived.monthlyHousingCost}
                            cashFlowBasisMonths={cashFlowBasisMonths}
                        />
                        <CarImpactPanel context={houseContext} />
                        <BuyVsRentSimulator onDerivedChange={handleDerived} />
                        <HousingPrinciples />
                    </>
                )}
            </div>
        </DashboardLayout>
    );
}

/**
 * Breakpoint switch (#344): phones get MobileHousing — affordability and readiness;
 * tablet/desktop get the full planner with the simulator.
 */
export default function HousingPage() {
    const isMobile = useIsMobile();
    if (isMobile === null) {
        return (
            <DashboardLayout>
                <div className="flex items-center justify-center py-24"><LoadingSpinner /></div>
            </DashboardLayout>
        );
    }
    return isMobile ? <MobileHousing /> : <DesktopHousingPage />;
}
