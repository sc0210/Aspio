'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { PageHeader } from '@/components/layout/PageHeader';
import { RebalancingSkeleton } from '@/components/dashboard/RebalancingSkeleton';

// AssetAllocationCard directly imports recharts PieChart — lazy-load so
// recharts is not pulled into the rebalancing page initial bundle.
const AssetAllocationCard = dynamic(
  () => import('@/components/dashboard/AssetAllocationCard').then(m => ({ default: m.AssetAllocationCard })),
  { ssr: false, loading: () => <div className="animate-pulse bg-gray-200 dark:bg-gray-700 rounded-xl h-64" role="status" aria-label="Loading allocation chart" /> }
);
import { RebalancingPlanCard } from '@/components/dashboard/RebalancingPlanCard';
import { FXTrackerCard } from '@/components/dashboard/FXTrackerCard';
import { WhatIfSimulator } from '@/components/dashboard/WhatIfSimulator';
import { MobileRebalancing } from '@/components/portfolio/MobileRebalancing';
import { useAppMode } from '@/hooks/useAppMode';
import { useIsMobile } from '@/hooks/useMediaQuery';
import { useDemo } from '@/contexts/DemoContext';
import { rebalancingService, RebalancingDashboardData } from '@/services/rebalancingService';
import {
  ChartBarIcon,
  ShoppingCartIcon,
  CurrencyDollarIcon,
  BeakerIcon
} from '@heroicons/react/24/outline';
import { DemoAlert } from '@/components/ui/Alert';
import { log } from '@/utils/logger';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';

export default function RebalancingPage() {
  const router = useRouter();
  const { t } = useTranslation(['dashboard', 'common']);
  const { isDemo } = useAppMode();
  const isMobile = useIsMobile();
  const { getDemoRebalancingData } = useDemo();
  const [activeTab, setActiveTab] = useState<'overview' | 'plan' | 'fx' | 'simulator'>('overview');
  const [authRebalancingData, setAuthRebalancingData] = useState<RebalancingDashboardData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch auth mode rebalancing data
  const fetchRebalancingData = useCallback(() => {
    if (!isDemo) {
      setIsLoading(true);
      setError(null);

      rebalancingService
        .getRebalancingDashboard()
        .then((data) => {
          setAuthRebalancingData(data);
        })
        .catch((err) => {
          log.error('Failed to fetch rebalancing data:', err);
          setError(t('rebalancing.page.loadFailed'));
        })
        .finally(() => {
          setIsLoading(false);
        });
    }
  }, [isDemo]);

  useEffect(() => {
    fetchRebalancingData();
  }, [fetchRebalancingData]);

  // Get rebalancing data based on mode
  const demoData = isDemo ? getDemoRebalancingData() : null;
  const rebalancingData = isDemo ? demoData : authRebalancingData;

  // `isMobile` is null until resolved: hold the skeleton rather than flash desktop.
  if (isLoading || isMobile === null) {
    // Paint the page shell immediately instead of a centered spinner so the
    // route becomes contentful right away (improves LCP / perceived load).
    return <RebalancingSkeleton />;
  }

  if (error || !rebalancingData) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="text-center">
            <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-2">
              {error || t('rebalancing.page.noData')}
            </h2>
            <p className="text-gray-600 dark:text-gray-400">
              {error ? t('rebalancing.page.tryAgain') : t('rebalancing.page.signInToView')}
            </p>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  if (isMobile) {
    return (
      <MobileRebalancing
        allocations={rebalancingData.allocations}
        actions={rebalancingData.actions}
        // Always the parent page, as the phone monthly summary goes to /transactions.
        // history.length cannot tell an in-app entry from Google or LINE before it,
        // so router.back() could leave Aspiro.
        onBack={() => router.push('/portfolio')}
      />
    );
  }

  const tabs = [
    { id: 'overview', label: t('rebalancing.tab.allocation'), icon: ChartBarIcon },
    { id: 'plan', label: t('rebalancing.tab.plan'), icon: ShoppingCartIcon },
    { id: 'fx', label: t('rebalancing.tab.fx'), icon: CurrencyDollarIcon },
    { id: 'simulator', label: t('whatIf.title'), icon: BeakerIcon },
  ] as const;

  const handleTargetUpdate = async (updates: { asset: string; targetPct: number }[]) => {
    try {
      await rebalancingService.updateTargetAllocations(updates);
      // Refresh data after successful update
      fetchRebalancingData();
    } catch (error) {
      log.error('Failed to update target allocations:', error);
      throw error; // Re-throw to let the component handle the error
    }
  };

  return (
    <DashboardLayout>
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <PageHeader
            title={t('rebalancing.page.title')}
            subtitle={t('rebalancing.page.subtitle')}
            accent="indigo"
            onBack={() => router.back()}
            backLabel={t('rebalancing.page.back')}
            className="mb-6"
        />

        {/* Demo Alert */}
        {isDemo && (
          <DemoAlert className="mb-6">
            <p>{t('common:demoAlert.rebalancing')}</p>
          </DemoAlert>
        )}

        {/* Tab Navigation */}
        <div className="mb-6 border-b border-gray-200 dark:border-gray-700">
          <nav className="flex overflow-x-auto scrollbar-hide -mb-px" aria-label="Tabs">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;

              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`
                    flex items-center py-3 px-3 sm:px-4 border-b-2 font-medium text-xs sm:text-sm transition-colors whitespace-nowrap flex-shrink-0 min-h-[48px] gap-1.5
                    ${isActive
                      ? 'border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400'
                      : 'border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600'
                    }
                  `}
                >
                  <Icon className="w-4 h-4 flex-shrink-0" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Tab Content */}
        <div className="space-y-6">
          {activeTab === 'overview' && (
            <AssetAllocationCard
              allocations={rebalancingData.allocations}
              totalAssets={rebalancingData.totalAssets}
              availableFunds={rebalancingData.availableFunds}
              lastUpdated={new Date()}
              onTargetUpdate={!isDemo ? handleTargetUpdate : undefined}
              isDemo={isDemo}
            />
          )}

          {activeTab === 'plan' && (
            <RebalancingPlanCard
              actions={rebalancingData.actions}
              availableFunds={rebalancingData.availableFunds}
              totalDeficit={rebalancingData.totalDeficit}
            />
          )}

          {activeTab === 'fx' && (
            <FXTrackerCard
              fxAccumulationTwd={rebalancingData.fxAccumulation?.[0]?.accumulatedTwd || 0}
              fxThreshold={rebalancingData.fxAccumulation?.[0]?.conversionThreshold || 80000}
              lastFxRate={rebalancingData.fxAccumulation?.[0]?.currentFxRate || 32.5}
              lastUpdated={new Date()}
              readyToConvert={rebalancingData.fxAccumulation?.[0]?.readyToConvert || false}
              onConvert={() => toast(t('rebalancing.page.fxComingSoon'), { icon: 'ℹ️' })}
            />
          )}

          {activeTab === 'simulator' && (
            <WhatIfSimulator
              assets={rebalancingData.allocations.map(a => ({
                asset: a.asset,
                currentValue: a.currentValue,
                targetPct: a.targetPct
              }))}
              totalAssets={rebalancingData.totalAssets}
            />
          )}
        </div>

        {/* Additional Info */}
        <div className="mt-8 p-6 bg-blue-50 dark:bg-blue-900/20 rounded-xl">
          <h3 className="text-lg font-semibold text-blue-900 dark:text-blue-100 mb-3">
            {t('rebalancing.page.about')}
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-blue-900 dark:text-blue-200">
            <div>
              <h4 className="font-medium mb-2">{t('rebalancing.tab.allocation')}</h4>
              <ul className="list-disc list-inside space-y-1 text-blue-800 dark:text-blue-300">
                <li>{t('rebalancing.page.help.allocation1')}</li>
                <li>{t('rebalancing.page.help.allocation2')}</li>
                <li>{t('rebalancing.page.help.allocation3')}</li>
              </ul>
            </div>
            <div>
              <h4 className="font-medium mb-2">{t('rebalancing.tab.plan')}</h4>
              <ul className="list-disc list-inside space-y-1 text-blue-800 dark:text-blue-300">
                <li>{t('rebalancing.page.help.plan1')}</li>
                <li>{t('rebalancing.page.help.plan2')}</li>
                <li>{t('rebalancing.page.help.plan3')}</li>
              </ul>
            </div>
            <div>
              <h4 className="font-medium mb-2">{t('rebalancing.tab.fx')}</h4>
              <ul className="list-disc list-inside space-y-1 text-blue-800 dark:text-blue-300">
                <li>{t('rebalancing.page.help.fx1')}</li>
                <li>{t('rebalancing.page.help.fx2')}</li>
                <li>{t('rebalancing.page.help.fx3')}</li>
              </ul>
            </div>
            <div>
              <h4 className="font-medium mb-2">{t('whatIf.title')}</h4>
              <ul className="list-disc list-inside space-y-1 text-blue-800 dark:text-blue-300">
                <li>{t('rebalancing.page.help.whatIf1')}</li>
                <li>{t('rebalancing.page.help.whatIf2')}</li>
                <li>{t('rebalancing.page.help.whatIf3')}</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
