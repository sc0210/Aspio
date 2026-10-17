'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { cn } from '@/utils/cn';
import {
  PlusIcon,
  ArrowPathIcon,
  ArrowDownTrayIcon,
  EyeIcon,
  EyeSlashIcon,
  Bars4Icon,
  ChartPieIcon,
  ChartBarIcon,
  EllipsisVerticalIcon,
} from '@heroicons/react/24/outline';
import { Button } from '@/components/ui/Button';
import { usePrivacy } from '@/contexts/PrivacyContext';
import type { PortfolioViewState } from '@/hooks/portfolio/usePortfolioViewState';
import type { PortfolioModalsState } from '@/hooks/portfolio/usePortfolioModals';
import { formatDistanceToNow } from 'date-fns';
import { useTranslation } from 'react-i18next';

interface PortfolioHeaderProps {
  viewState: PortfolioViewState;
  modals: PortfolioModalsState;
  onRefresh: () => void;
  isRefreshing: boolean;
  onSyncHistorical?: () => void;
  isSyncingHistorical?: boolean;
  lastPriceUpdate?: Date;
  className?: string;
}

export function PortfolioHeader({
  viewState,
  modals,
  onRefresh,
  isRefreshing,
  onSyncHistorical,
  isSyncingHistorical = false,
  lastPriceUpdate,
  className,
}: PortfolioHeaderProps) {
  const { t } = useTranslation(['portfolio']);
  const { isValueVisible, toggleValueVisibility } = usePrivacy();
  const [menuOpen, setMenuOpen] = useState(false);
  // Refresh and "Sync Charts" overlap — refresh does the historical sync too —
  // so each must block while the other runs. One derivation, not one per button.
  const isBusy = isRefreshing || isSyncingHistorical;
  const menuRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div className={cn('mb-4 sm:mb-6', className)}>
      {/* Mobile: title on its own row (stays fully readable), toolbar below.
          sm+: single row with title left, buttons right. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-2">
        {/* Page Title */}
        <div className="min-w-0 sm:flex-1">
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100 truncate">
            {t('portfolio:title')}
          </h1>
          <p className="hidden sm:block mt-0.5 text-sm text-gray-500 dark:text-gray-400">
            {lastPriceUpdate
              ? t('portfolio:header.pricesUpdated', { timeAgo: formatDistanceToNow(lastPriceUpdate, { addSuffix: true }) })
              : t('portfolio:header.subtitle')}
          </p>
        </div>

        {/* All action buttons — icons-only on mobile; right-aligned on its own row */}
        <div className="flex items-center justify-end gap-1.5 sm:gap-2 flex-shrink-0">
          {/* Privacy Toggle */}
          <Button
            onClick={toggleValueVisibility}
            variant="outline"
            size="sm"
            title={isValueVisible ? t('portfolio:hideValues') : t('portfolio:showValues')}
            className="gap-1.5"
          >
            {isValueVisible ? (
              <><EyeSlashIcon className="w-4 h-4" /><span className="hidden sm:inline">{t('portfolio:header.hide')}</span></>
            ) : (
              <><EyeIcon className="w-4 h-4" /><span className="hidden sm:inline">{t('portfolio:header.show')}</span></>
            )}
          </Button>

          {/* View Type Toggle */}
          <div className="flex items-center gap-0.5 p-1 border border-gray-300 rounded-lg dark:border-gray-600">
            <button
              onClick={() => viewState.setViewType('list')}
              aria-label={t('portfolio:header.listView')}
              aria-pressed={viewState.viewType === 'list'}
              className={`px-2 sm:px-3 min-h-[34px] min-w-[40px] flex items-center justify-center text-sm font-medium rounded-md transition-colors touch-manipulation ${
                viewState.viewType === 'list'
                  ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100'
              }`}
            >
              <Bars4Icon className="w-4 h-4 sm:hidden" aria-hidden="true" />
              <span className="hidden sm:inline">{t('portfolio:header.listLabel')}</span>
            </button>
            <button
              onClick={() => viewState.setViewType('allocation')}
              aria-label={t('portfolio:header.allocationView')}
              aria-pressed={viewState.viewType === 'allocation'}
              className={`px-2 sm:px-3 min-h-[34px] min-w-[40px] flex items-center justify-center text-sm font-medium rounded-md transition-colors touch-manipulation ${
                viewState.viewType === 'allocation'
                  ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100'
              }`}
            >
              <ChartPieIcon className="w-4 h-4 sm:hidden" aria-hidden="true" />
              <span className="hidden sm:inline">{t('portfolio:header.allocationLabel')}</span>
            </button>
          </div>

          {/* Refresh */}
          <Button
            onClick={onRefresh}
            disabled={isBusy}
            variant="outline"
            size="sm"
            title={t('portfolio:header.refreshTitle')}
            className="gap-1.5"
          >
            <ArrowPathIcon className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">
              {isRefreshing ? t('portfolio:header.refreshing') : t('portfolio:refresh')}
            </span>
          </Button>

          {/* Overflow menu — relative container kept outside any overflow-x-auto ancestor */}
          <div className="relative" ref={menuRef}>
            <Button
              onClick={() => setMenuOpen(v => !v)}
              variant="outline"
              size="sm"
              title={t('portfolio:header.moreActions')}
              className="gap-1"
            >
              <EllipsisVerticalIcon className="w-4 h-4" />
            </Button>

            {menuOpen && (
              <div className="absolute right-0 mt-1 w-48 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 z-20 py-1">
                {onSyncHistorical && (
                  <button
                    onClick={() => { onSyncHistorical(); setMenuOpen(false); }}
                    disabled={isBusy}
                    className="flex items-center gap-2 w-full px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 transition-colors"
                  >
                    <ChartBarIcon className={`w-4 h-4 flex-shrink-0 ${isSyncingHistorical ? 'animate-spin' : ''}`} />
                    {isSyncingHistorical ? t('portfolio:header.syncingCharts') : t('portfolio:header.syncCharts')}
                  </button>
                )}
                <button
                  onClick={() => { modals.openImportExportModal(); setMenuOpen(false); }}
                  className="flex items-center gap-2 w-full px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                >
                  <ArrowDownTrayIcon className="w-4 h-4 flex-shrink-0" />
                  {t('portfolio:header.importExport')}
                </button>
              </div>
            )}
          </div>

          {/* Add Holding */}
          <Link href="/portfolio/add">
            <Button size="sm" className="gap-1.5">
              <PlusIcon className="w-4 h-4" />
              <span className="hidden sm:inline">{t('portfolio:header.addHolding')}</span>
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
