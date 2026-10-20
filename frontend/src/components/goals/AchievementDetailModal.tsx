'use client';

import { Fragment } from 'react';
import { Dialog, DialogPanel, DialogTitle, Transition, TransitionChild } from '@headlessui/react';
import { cn } from '@/utils/cn';
import type { AchievementProgress } from '@/lib/api-client';
import { useScrollLock } from '@/hooks/useScrollLock';

type Rarity = 'common' | 'rare' | 'epic' | 'legendary';

const RARITY_CONFIG: Record<
  Rarity,
  { label: string; badgeCls: string; ringCls: string; barCls: string; glowCls: string }
> = {
  common: {
    label: 'Common',
    badgeCls: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
    ringCls: 'ring-gray-200 dark:ring-gray-600',
    barCls: 'bg-gray-400',
    glowCls: 'from-gray-200/60 to-gray-100/0 dark:from-gray-700/60',
  },
  rare: {
    label: 'Rare',
    badgeCls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
    ringCls: 'ring-blue-300 dark:ring-blue-700',
    barCls: 'bg-blue-500',
    glowCls: 'from-blue-200/60 to-blue-100/0 dark:from-blue-900/50',
  },
  epic: {
    label: 'Epic',
    badgeCls: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
    ringCls: 'ring-purple-300 dark:ring-purple-700',
    barCls: 'bg-purple-500',
    glowCls: 'from-purple-200/60 to-purple-100/0 dark:from-purple-900/50',
  },
  legendary: {
    label: 'Legendary',
    badgeCls: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300',
    ringCls: 'ring-yellow-400 dark:ring-yellow-600',
    barCls: 'bg-yellow-500',
    glowCls: 'from-amber-200/70 to-yellow-100/0 dark:from-amber-900/50',
  },
};

function fullDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

interface AchievementDetailModalProps {
  achievement: AchievementProgress | null;
  onClose: () => void;
}

export function AchievementDetailModal({ achievement, onClose }: AchievementDetailModalProps) {
  // Headless UI locks the document element, but <main> is this app's scroll
  // container — lock that too or the page slides behind the dialog.
  useScrollLock(Boolean(achievement));
  const a = achievement;
  const rarity: Rarity = a && (a.rarity as Rarity) in RARITY_CONFIG ? (a.rarity as Rarity) : 'common';
  const cfg = RARITY_CONFIG[rarity];
  const pct = a ? Math.min(100, a.progress_percentage) : 0;

  return (
    <Transition appear show={!!a} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={onClose}>
        <TransitionChild
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black/50" />
        </TransitionChild>

        <div className="fixed inset-0 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4">
            <TransitionChild
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0 scale-95"
              enterTo="opacity-100 scale-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100 scale-100"
              leaveTo="opacity-0 scale-95"
            >
              <DialogPanel className="w-full max-w-md transform overflow-hidden rounded-2xl bg-white dark:bg-gray-800 shadow-xl transition-all">
                {a && (
                  <>
                    {/* Header with rarity glow */}
                    <div className={cn('relative bg-gradient-to-b px-6 pt-7 pb-6 text-center', cfg.glowCls)}>
                      <button
                        type="button"
                        onClick={onClose}
                        aria-label="Close"
                        className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full text-gray-500 dark:text-gray-400 hover:bg-black/5 dark:hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/60"
                      >
                        <span className="text-xl leading-none">×</span>
                      </button>

                      <div
                        className={cn(
                          'mx-auto flex h-20 w-20 items-center justify-center rounded-2xl bg-white dark:bg-gray-900 text-5xl shadow-sm ring-2',
                          cfg.ringCls,
                          !a.is_unlocked && 'grayscale opacity-70'
                        )}
                      >
                        {a.icon}
                      </div>

                      <span
                        className={cn(
                          'mt-3 inline-block rounded-full px-3 py-0.5 text-xs font-semibold',
                          cfg.badgeCls
                        )}
                      >
                        {cfg.label}
                      </span>

                      <DialogTitle className="mt-2 text-xl font-bold text-gray-900 dark:text-white">
                        {a.title}
                      </DialogTitle>
                      <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{a.description}</p>
                    </div>

                    <div className="space-y-5 px-6 pb-6">
                      {/* Status */}
                      {a.is_unlocked ? (
                        <div className="flex items-center justify-center gap-2 rounded-xl bg-prosperity-50 dark:bg-prosperity-900/20 py-3 text-sm font-medium text-prosperity-700 dark:text-prosperity-300">
                          <span aria-hidden>✓</span>
                          <span>Earned{a.unlocked_at ? ` on ${fullDate(a.unlocked_at)}` : ''}</span>
                        </div>
                      ) : (
                        <div>
                          <div className="mb-1.5 flex items-center justify-between text-xs font-medium text-gray-500 dark:text-gray-400">
                            <span>Progress</span>
                            <span>
                              {a.current_progress} / {a.required_progress} ({Math.round(pct)}%)
                            </span>
                          </div>
                          <div
                            role="progressbar"
                            aria-valuenow={Math.round(pct)}
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-label={`${a.title} progress`}
                            className="h-2.5 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700"
                          >
                            <div
                              className={cn('h-2.5 rounded-full transition-all duration-700', cfg.barCls)}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      )}

                      {/* Reward + category */}
                      <div className="grid grid-cols-2 gap-3">
                        <div className="rounded-xl border border-gray-100 dark:border-gray-700 p-3 text-center">
                          <p className="text-lg font-bold text-indigo-600 dark:text-indigo-400">
                            +{a.points_reward}
                          </p>
                          <p className="text-xs text-gray-500 dark:text-gray-400">XP reward</p>
                        </div>
                        <div className="rounded-xl border border-gray-100 dark:border-gray-700 p-3 text-center">
                          <p className="text-sm font-semibold capitalize text-gray-800 dark:text-gray-200">
                            {a.category}
                          </p>
                          <p className="text-xs text-gray-500 dark:text-gray-400">Category</p>
                        </div>
                      </div>

                      {/* Tips */}
                      {!a.is_unlocked && a.tips.length > 0 && (
                        <div>
                          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                            How to earn it
                          </p>
                          <ul className="space-y-1.5">
                            {a.tips.map((tip, i) => (
                              <li
                                key={i}
                                className="flex items-start gap-2 text-sm text-gray-600 dark:text-gray-300"
                              >
                                <span className="mt-0.5 text-indigo-400" aria-hidden>
                                  💡
                                </span>
                                <span>{tip}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </DialogPanel>
            </TransitionChild>
          </div>
        </div>
      </Dialog>
    </Transition>
  );
}
