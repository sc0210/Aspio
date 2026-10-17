'use client';

import { useTranslation } from 'react-i18next';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { PageHeader } from '@/components/layout/PageHeader';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { useIsMobile } from '@/hooks/useMediaQuery';
import { PositionHeader } from '@/components/lifecycle/PositionHeader';
import { SafetyPanel } from '@/components/lifecycle/SafetyPanel';
import { SpreadPanel } from '@/components/lifecycle/SpreadPanel';
import { HomePurchasePanel } from '@/components/lifecycle/HomePurchasePanel';
import { GlidepathPanel } from '@/components/lifecycle/GlidepathPanel';
import { LeverageHistoryPanel } from '@/components/lifecycle/LeverageHistoryPanel';
import { InvestmentLoanPicker } from '@/components/lifecycle/InvestmentLoanPicker';
import { LifecyclePrinciples } from '@/components/lifecycle/LifecyclePrinciples';
import { MobileLifecycle } from '@/components/lifecycle/MobileLifecycle';
import { useLifecycleModel } from '@/components/lifecycle/useLifecycleModel';

/**
 * Lifecycle investing tracker.
 *
 * Ayres & Nalebuff's strategy — borrow when young so lifetime market exposure
 * is spread across more years — poses five questions, and this page answers
 * them in order:
 *
 *   1. What is my target exposure?      → PositionHeader (Samuelson share)
 *   2. Which way have I been moving?    → LeverageHistoryPanel (the trend)
 *   3. What could break this?           → SafetyPanel (forced-sale risk)
 *   4. Where am I on the glidepath?     → GlidepathPanel (the crossover)
 *   5. Is the spread actually positive? → SpreadPanel (measured, not assumed)
 *
 * Question 2 exists because the headline ratio is a single reading, and a
 * single reading cannot tell deleveraging from a good quarter — the market
 * moves that number as surely as any repayment does.
 *
 * All of it is derived client-side from data Aspiro already holds: the three
 * wallets, the loan records, and the per-holding IRR the backend computes.
 */
function DesktopLifecyclePage() {
    const { t } = useTranslation('common');
    const {
        lifeCash,
        position,
        target,
        tracking,
        preferences,
        walletTrend,
        historyLoans,
        livePosition,
        historyPeriod,
        setHistoryPeriod,
        trendLoading,
        stress,
        cashFlowBasisMonths,
        glidepathSeed,
        updatePreference,
        spread,
        debt,
        interest,
        realizedReturnPct,
        realizedReturn,
        loans,
        selectedLoanIds,
        toggleLoan,
        showSpinner,
    } = useLifecycleModel();

    return (
        <DashboardLayout>
            <div className="max-w-6xl mx-auto space-y-5 pb-8">
                <PageHeader
                    title={t('lifecycle.pageTitle', 'Lifecycle Investing')}
                    subtitle={t('lifecycle.pageSubtitle', 'Borrowing young spreads your market exposure across more years. Track the leverage, the spread, and the date you stop being a borrower.')}
                    accent="indigo"
                />

                {showSpinner ? (
                    <div className="flex items-center justify-center py-24">
                        <LoadingSpinner />
                    </div>
                ) : (
                    <>
                        <PositionHeader
                            position={position}
                            target={target}
                            tracking={tracking}
                            maxLeverage={preferences.maxLeverage}
                        />
                        <LeverageHistoryPanel
                            points={walletTrend ?? []}
                            loans={historyLoans}
                            today={livePosition}
                            targetLeverage={target.targetLeverage}
                            maxLeverage={preferences.maxLeverage}
                            period={historyPeriod}
                            onPeriodChange={setHistoryPeriod}
                            isLoading={trendLoading}
                        />
                        <SafetyPanel stress={stress} cashFlowBasisMonths={cashFlowBasisMonths} />
                        <GlidepathPanel
                            seed={glidepathSeed}
                            preferences={preferences}
                            onPreferenceChange={updatePreference}
                        />
                        <HomePurchasePanel position={position} spendableCash={lifeCash} maxLeverage={preferences.maxLeverage} />
                        <SpreadPanel
                            spread={spread}
                            debt={debt}
                            interest={interest}
                            realizedReturnPct={realizedReturnPct}
                            realizedReturnSource={realizedReturn.source}
                            realizedReturnSince={realizedReturn.since}
                        />
                        <InvestmentLoanPicker
                            loans={loans}
                            selectedIds={selectedLoanIds}
                            onToggle={toggleLoan}
                            configured={preferences.loansConfigured}
                        />
                        <LifecyclePrinciples />
                    </>
                )}
            </div>
        </DashboardLayout>
    );
}

/**
 * Breakpoint switch (#344): phones get MobileLifecycle — where the leverage stands
 * against target, and what could force a sale; tablet/desktop get all five panels.
 */
export default function LifecyclePage() {
    const isMobile = useIsMobile();
    if (isMobile === null) {
        return (
            <DashboardLayout>
                <div className="flex items-center justify-center py-24"><LoadingSpinner /></div>
            </DashboardLayout>
        );
    }
    return isMobile ? <MobileLifecycle /> : <DesktopLifecyclePage />;
}
