'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { useTranslation } from 'react-i18next';
import { XMarkIcon } from '@heroicons/react/24/outline';
import type { SharedGoalHistoryPoint, SharedGoalOut } from '@/shared/types';
import { apiClient } from '@/lib/api-client';
import { demoSharedGoalHistory } from '@/data/demoData';
import { formatCurrency as formatCurrencyUtil } from '@/utils/formatters';
import { useDialog } from '@/hooks/useDialog';

// Recharts loads only when a goal's history is opened, not with the Savings page.
const GoalHistoryChart = dynamic(() => import('@/components/savings/GoalHistoryChart'), { ssr: false });

const fmt = (v: number) => formatCurrencyUtil(v, 'TWD', { precision: 0 });

interface GoalHistoryModalProps {
  goal: SharedGoalOut | null;
  isDemo: boolean;
  onClose: () => void;
}

/**
 * How a shared goal filled up: each side's money set aside, by day.
 *
 * Read-only. Each partner adds to their own part with "Set aside money" (a
 * reservation on their personal goal); this shows the days and amounts, never
 * a note or what the money was invested in.
 */
export default function GoalHistoryModal({ goal, isDemo, onClose }: GoalHistoryModalProps) {
  const { t, i18n } = useTranslation('common');
  // Always mounted by /savings, so open only while a goal is shown: a constant
  // true held the page's scroll lock for as long as you were on it.
  const { panelRef, dialogProps } = useDialog({ isOpen: goal !== null, onClose });
  // Kept with the goal they are for, so another goal's history never shows.
  const [loaded, setLoaded] = useState<{ goalId: string; points: SharedGoalHistoryPoint[] | null } | null>(null);

  const goalId = goal?.id ?? null;
  useEffect(() => {
    if (!goalId || isDemo) return;
    let stale = false;
    apiClient.getSharedGoalHistory(goalId)
      .then((res) => { if (!stale) setLoaded({ goalId, points: res.data ?? [] }); })
      .catch(() => { if (!stale) setLoaded({ goalId, points: null }); });
    return () => { stale = true; };
  }, [goalId, isDemo]);

  if (!goal) return null;

  const points = isDemo
    ? (demoSharedGoalHistory[goal.id] ?? [])
    : loaded?.goalId === goal.id ? loaded.points : undefined;
  const day = (iso: string) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString(i18n?.language || 'en', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
  const newestFirst = points ? [...points].sort((a, b) => b.date.localeCompare(a.date)) : [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        {...dialogProps}
        aria-label={t('savings.history.dialogAria', 'History of {{title}}', { title: goal.title })}
        className="relative bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700 shrink-0">
          <div>
            <h2 className="text-base font-semibold text-gray-900 dark:text-white">
              {t('savings.history.title', 'History')}
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{goal.title}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('savings.history.close', 'Close')}
            className="p-1.5 min-w-[44px] min-h-[44px] flex items-center justify-center text-gray-500 dark:text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-5 py-4">
          {points === undefined ? (
            <div aria-hidden="true" className="h-40 rounded-lg bg-gray-100 dark:bg-gray-800 animate-pulse" />
          ) : points === null ? (
            <p role="alert" className="text-sm text-error-700 dark:text-error-400 bg-error-50 dark:bg-error-900/20 rounded-lg px-3 py-2">
              {t('savings.history.loadFailed', 'Failed to load the history')}
            </p>
          ) : points.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                {t('savings.history.emptyTitle', 'Nothing set aside yet')}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                {t('savings.history.emptyHint', 'Each of you adds to your part with “Set aside money”.')}
              </p>
            </div>
          ) : (
            <>
              <GoalHistoryChart points={points} target={goal.target_amount} partnerName={goal.peer_name} />
              <ul className="divide-y divide-gray-100 dark:divide-gray-800">
                {newestFirst.map((p) => (
                  <li key={`${p.date}-${p.side}`} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                    <span className="text-gray-600 dark:text-gray-400 tabular-nums">{day(p.date)}</span>
                    <span className="flex-1 min-w-0 truncate text-gray-900 dark:text-white">
                      {p.side === 'you' ? t('savings.card.you', 'You') : goal.peer_name}
                    </span>
                    <span className={`font-semibold tabular-nums ${p.amount < 0 ? 'text-gray-600 dark:text-gray-400' : 'text-gray-900 dark:text-white'}`}>
                      {p.amount < 0 ? `−${fmt(-p.amount)}` : `+${fmt(p.amount)}`}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
