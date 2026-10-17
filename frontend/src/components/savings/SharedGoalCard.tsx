'use client';

import { useTranslation } from 'react-i18next';
import { TrashIcon, CheckCircleIcon, ListBulletIcon } from '@heroicons/react/24/outline';
import type { SharedGoalOut } from '@/shared/types';
import { formatCurrency as formatCurrencyUtil } from '@/utils/formatters';

interface SharedGoalCardProps {
  goal: SharedGoalOut;
  onViewRecords: (goal: SharedGoalOut) => void;
  onDelete: (goalId: string) => void;
  deleting?: boolean;
}

const formatCurrency = (value: number) => formatCurrencyUtil(value, 'TWD', { precision: 0 });

const MILESTONES = [25, 50, 75];

export default function SharedGoalCard({ goal, onViewRecords, onDelete, deleting }: SharedGoalCardProps) {
  const { t } = useTranslation('common');
  const isCompleted = goal.status === 'completed';

  const daysLeft = goal.target_date
    ? Math.ceil((new Date(goal.target_date).getTime() - Date.now()) / 86_400_000)
    : null;

  const totalContributed = goal.your_amount + goal.peer_amount;
  const yourSplitPct = totalContributed > 0 ? (goal.your_amount / totalContributed) * 100 : 50;
  const peerSplitPct = 100 - yourSplitPct;

  const pct = goal.progress_pct;
  const motivation =
    pct >= 100 ? t('savings.card.motivation.done', '🎉 Goal reached! Celebrate together!')
    : pct >= 75 ? t('savings.card.motivation.almost', '⚡ Almost there — final push!')
    : pct >= 50 ? t('savings.card.motivation.halfway', '🔥 Over halfway — keep going!')
    : pct >= 25 ? t('savings.card.motivation.momentum', '🚀 Great momentum — stay consistent!')
    : t('savings.card.motivation.start', '💪 Great start — every contribution counts!');

  return (
    <div
      className={`bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm transition-shadow hover:shadow-md ${
        isCompleted ? 'ring-2 ring-prosperity-400/40 dark:ring-prosperity-500/30' : ''
      }`}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {isCompleted && (
            <CheckCircleIcon className="w-5 h-5 text-prosperity-500 shrink-0" />
          )}
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white truncate">
            {goal.title}
          </h3>
          {isCompleted && (
            <span className="shrink-0 text-xs font-medium px-1.5 py-0.5 rounded-full bg-prosperity-100 dark:bg-prosperity-900/40 text-prosperity-700 dark:text-prosperity-300">
              {t('savings.completed', 'Goal reached!')}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => onViewRecords(goal)}
            title={t('savings.card.viewRecords', 'View saving records')}
            aria-label={t('savings.card.viewRecordsFor', 'View saving records for {{title}}', { title: goal.title })}
            className="p-1.5 min-w-[44px] min-h-[44px] flex items-center justify-center text-gray-400 hover:text-primary-600 dark:hover:text-primary-400 rounded-lg hover:bg-primary-50 dark:hover:bg-primary-900/20 transition-colors"
          >
            <ListBulletIcon className="w-4 h-4" aria-hidden="true" />
          </button>
          {goal.is_creator && (
            <button
              type="button"
              onClick={() => onDelete(goal.id)}
              disabled={deleting}
              aria-label={t('savings.deleteGoal', 'Delete goal {{title}}', { title: goal.title })}
              className="p-1.5 min-w-[44px] min-h-[44px] flex items-center justify-center text-gray-400 hover:text-error-600 dark:hover:text-error-400 rounded-lg hover:bg-error-50 dark:hover:bg-error-900/20 transition-colors disabled:opacity-40"
            >
              <TrashIcon className="w-4 h-4" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      {/* Progress section */}
      <div className="mb-4">
        <div className="flex justify-between items-baseline text-xs mb-1.5">
          <span className="font-semibold text-gray-700 dark:text-gray-200">
            {formatCurrency(goal.total_amount)}
            <span className="font-normal text-gray-400 dark:text-gray-500"> / {formatCurrency(goal.target_amount)}</span>
          </span>
          <span className={`font-bold text-sm ${isCompleted ? 'text-prosperity-600 dark:text-prosperity-400' : 'text-primary-600 dark:text-primary-400'}`}>
            {goal.progress_pct.toFixed(1)}%
          </span>
        </div>

        {/* Progress bar with milestone ticks */}
        <div className="relative h-2.5 bg-gray-100 dark:bg-gray-700 rounded-full">
          <div
            role="progressbar"
            aria-valuenow={Math.round(Math.min(goal.progress_pct, 100))}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={t('savings.card.progressAria', '{{title}} progress', { title: goal.title })}
            className={`h-full rounded-full transition-all duration-700 ${isCompleted ? 'bg-prosperity-500' : 'bg-primary-500'}`}
            style={{ width: `${Math.min(goal.progress_pct, 100)}%` }}
          />
          {MILESTONES.map((m) => (
            <div
              key={m}
              style={{ left: `${m}%` }}
              className={`absolute top-0 w-px h-2.5 -translate-x-1/2 ${
                goal.progress_pct >= m ? 'bg-white/50' : 'bg-gray-300 dark:bg-gray-500'
              }`}
            />
          ))}
        </div>

        {/* Motivational text + deadline */}
        <div className="flex items-center justify-between mt-1.5">
          <span className="text-xs text-gray-400 dark:text-gray-500 leading-tight">
            {motivation}
          </span>
          {daysLeft !== null && !isCompleted && (
            <span
              className={`text-xs font-semibold shrink-0 ml-2 ${
                daysLeft < 0
                  ? 'text-error-500 dark:text-error-400'
                  : daysLeft <= 14
                  ? 'text-amber-500 dark:text-amber-400'
                  : 'text-gray-400 dark:text-gray-500'
              }`}
            >
              {daysLeft < 0
                ? t('savings.card.overdue', '{{days}}d overdue', { days: Math.abs(daysLeft) })
                : daysLeft === 0
                ? t('savings.card.dueToday', 'Due today!')
                : t('savings.card.daysLeft', '{{days}}d left', { days: daysLeft })}
            </span>
          )}
        </div>
      </div>

      {/* Contributions */}
      <div className="pt-3 border-t border-gray-100 dark:border-gray-700 space-y-2.5">
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-primary-50 dark:bg-primary-900/20 rounded-lg p-2.5">
            <p className="text-xs text-primary-600 dark:text-primary-400 font-medium mb-0.5">
              {t('savings.yourContribution', 'Your contribution')}
            </p>
            <p className="text-sm font-bold text-primary-700 dark:text-primary-300">
              {formatCurrency(goal.your_amount)}
            </p>
            <p className="text-xs text-primary-500 dark:text-primary-400 truncate">{goal.your_name}</p>
          </div>
          <div className="bg-prosperity-50 dark:bg-prosperity-900/20 rounded-lg p-2.5">
            <p className="text-xs text-prosperity-600 dark:text-prosperity-400 font-medium mb-0.5 truncate">
              {t('savings.peerContribution', "{{name}}'s contribution", { name: goal.peer_name })}
            </p>
            <p className="text-sm font-bold text-prosperity-700 dark:text-prosperity-300">
              {formatCurrency(goal.peer_amount)}
            </p>
            <p className="text-xs text-prosperity-500 dark:text-prosperity-400 truncate">{goal.peer_name}</p>
          </div>
        </div>

        {/* Contribution split bar */}
        {totalContributed > 0 && (
          <div>
            <div className="flex justify-between text-xs text-gray-400 dark:text-gray-500 mb-1">
              <span>{goal.your_name}: {yourSplitPct.toFixed(0)}%</span>
              <span>{peerSplitPct.toFixed(0)}%: {goal.peer_name}</span>
            </div>
            <div className="h-1.5 rounded-full flex overflow-hidden bg-gray-100 dark:bg-gray-700">
              <div
                style={{ width: `${yourSplitPct}%` }}
                className="bg-primary-400 transition-all duration-500"
              />
              <div
                style={{ width: `${peerSplitPct}%` }}
                className="bg-prosperity-400 transition-all duration-500"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
