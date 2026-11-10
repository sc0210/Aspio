'use client';

import { useTranslation } from 'react-i18next';
import { TrashIcon, CheckCircleIcon, ListBulletIcon, PencilSquareIcon } from '@heroicons/react/24/outline';
import type { SharedGoalOut } from '@/shared/types';
import { formatCurrency as formatCurrencyUtil } from '@/utils/formatters';

interface SharedGoalCardProps {
  goal: SharedGoalOut;
  onViewRecords: (goal: SharedGoalOut) => void;
  onDelete: (goalId: string) => void;
  onEdit?: (goal: SharedGoalOut) => void;
  deleting?: boolean;
}

const formatCurrency = (value: number) => formatCurrencyUtil(value, 'TWD', { precision: 0 });

const MILESTONES = [25, 50, 75];

export default function SharedGoalCard({ goal, onViewRecords, onDelete, onEdit, deleting }: SharedGoalCardProps) {
  const { t } = useTranslation('common');
  const isCompleted = goal.status === 'completed';

  const daysLeft = goal.target_date
    ? Math.ceil((new Date(goal.target_date).getTime() - Date.now()) / 86_400_000)
    : null;

  // What a month takes to land on the date: the gap over the months left (at least one).
  const remaining = Math.max(0, goal.target_amount - goal.total_amount);
  const perMonth = daysLeft !== null && daysLeft > 0 && remaining > 0 && !isCompleted
    ? remaining / Math.max(1, daysLeft / 30.44)
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
      {/* Centred on the 44px icon buttons, and the title wraps: truncated, "新年禮物..." lost its point on a phone. */}
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 flex-1 min-w-0">
          {isCompleted && (
            <CheckCircleIcon className="w-5 h-5 text-prosperity-700 dark:text-prosperity-500 shrink-0" />
          )}
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white break-words min-w-0">
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
            className="p-1.5 min-w-[44px] min-h-[44px] flex items-center justify-center text-gray-500 dark:text-gray-400 hover:text-primary-600 dark:hover:text-primary-400 rounded-lg hover:bg-primary-50 dark:hover:bg-primary-900/20 transition-colors"
          >
            <ListBulletIcon className="w-4 h-4" aria-hidden="true" />
          </button>
          {onEdit && (
            <button
              type="button"
              onClick={() => onEdit(goal)}
              aria-label={t('savings.editGoal', 'Edit goal {{title}}', { title: goal.title })}
              className="p-1.5 min-w-[44px] min-h-[44px] flex items-center justify-center text-gray-500 dark:text-gray-400 hover:text-primary-600 dark:hover:text-primary-400 rounded-lg hover:bg-primary-50 dark:hover:bg-primary-900/20 transition-colors"
            >
              <PencilSquareIcon className="w-4 h-4" aria-hidden="true" />
            </button>
          )}
          {goal.is_creator && (
            <button
              type="button"
              onClick={() => onDelete(goal.id)}
              disabled={deleting}
              aria-label={t('savings.deleteGoal', 'Delete goal {{title}}', { title: goal.title })}
              className="p-1.5 min-w-[44px] min-h-[44px] flex items-center justify-center text-gray-500 dark:text-gray-400 hover:text-error-600 dark:hover:text-error-400 rounded-lg hover:bg-error-50 dark:hover:bg-error-900/20 transition-colors disabled:opacity-40"
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
            <span className="font-normal text-gray-500 dark:text-gray-400"> / {formatCurrency(goal.target_amount)}</span>
          </span>
          <span className={`font-bold text-sm ${isCompleted ? 'text-prosperity-700 dark:text-prosperity-400' : 'text-primary-700 dark:text-primary-400'}`}>
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
          <span className="text-xs text-gray-500 dark:text-gray-400 leading-tight">
            {motivation}
          </span>
          {daysLeft !== null && !isCompleted && (
            <span
              className={`text-xs font-semibold shrink-0 ml-2 ${
                daysLeft < 0
                  ? 'text-error-700 dark:text-error-400'
                  : daysLeft <= 14
                  ? 'text-amber-500 dark:text-amber-400'
                  : 'text-gray-500 dark:text-gray-400'
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
        {perMonth !== null && (
          <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
            {t('savings.card.pace', '{{amount}} a month between you reaches it on time', { amount: formatCurrency(Math.ceil(perMonth)) })}
          </p>
        )}
      </div>

      {/* Contributions: who put in what, and the share it makes, once each. */}
      <div className="pt-3 border-t border-gray-100 dark:border-gray-700 space-y-2">
        <div className="grid grid-cols-2 gap-3">
          <div className="min-w-0">
            <p className="text-xs font-medium text-primary-700 dark:text-primary-400 truncate">
              {t('savings.card.you', 'You')}
              {totalContributed > 0 && <span className="font-normal text-gray-600 dark:text-gray-400"> · {yourSplitPct.toFixed(0)}%</span>}
            </p>
            <p className="text-sm font-bold text-gray-900 dark:text-white tabular-nums">{formatCurrency(goal.your_amount)}</p>
          </div>
          <div className="min-w-0 text-right">
            <p className="text-xs font-medium text-prosperity-700 dark:text-prosperity-400 truncate">
              {goal.peer_name}
              {totalContributed > 0 && <span className="font-normal text-gray-600 dark:text-gray-400"> · {peerSplitPct.toFixed(0)}%</span>}
            </p>
            <p className="text-sm font-bold text-gray-900 dark:text-white tabular-nums">{formatCurrency(goal.peer_amount)}</p>
          </div>
        </div>

        {/* Contribution split bar */}
        {totalContributed > 0 && (
          <div>
            <div className="h-1.5 rounded-full flex overflow-hidden bg-gray-100 dark:bg-gray-700" aria-hidden="true">
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
