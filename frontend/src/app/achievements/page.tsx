'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { PageHeader } from '@/components/layout/PageHeader';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { AchievementDetailModal } from '@/components/goals/AchievementDetailModal';
import { cn } from '@/utils/cn';
import {
  useGamificationStats,
  useAchievementProgress,
  useUpdateStreak,
  useCheckAchievements,
} from '@/hooks/api-hooks';
import { useAppMode } from '@/hooks/useAppMode';
import type { AchievementProgress, GamificationStats } from '@/lib/api-client';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Card } from '@/components/ui/Card';
import { useIsMobile } from '@/hooks/useMediaQuery';

// ---------------------------------------------------------------------------
// Demo data
// ---------------------------------------------------------------------------

const DEMO_STATS: GamificationStats = {
  user_id: 'demo',
  level: 5,
  experience_points: 2340,
  experience_to_next_level: 660,
  total_achievements: 4,
  achievements_by_rarity: { common: 3, rare: 1 },
  streak_info: {
    current_login_streak: 7,
    longest_login_streak: 23,
    last_streak_update: new Date().toISOString(),
    streak_bonus_earned: 70,
  },
  recent_achievements: [],
  digital_adoption_score: 65,
  savings_discipline_score: 80,
  investment_knowledge_score: 45,
  community_engagement_score: 20,
};

/**
 * Zeroed stats for a signed-in user whose gamification fetch failed. Falling
 * back to DEMO_STATS here would show a real account someone else's 7-day streak
 * and level 5 — indistinguishable from live data, and it never changes.
 */
const EMPTY_STATS: GamificationStats = {
  user_id: '',
  level: 1,
  experience_points: 0,
  experience_to_next_level: 100,
  total_achievements: 0,
  achievements_by_rarity: {},
  streak_info: {
    current_login_streak: 0,
    longest_login_streak: 0,
    last_streak_update: null,
    streak_bonus_earned: 0,
  },
  recent_achievements: [],
  digital_adoption_score: 0,
  savings_discipline_score: 0,
  investment_knowledge_score: 0,
  community_engagement_score: 0,
};

const DEMO_PROGRESS: AchievementProgress[] = [
  {
    achievement_type: 'FIRST_TRANSACTION',
    title: 'First Steps',
    description: 'Recorded your first transaction',
    category: 'financial',
    icon: '📝',
    rarity: 'common',
    points_reward: 100,
    current_progress: 1,
    required_progress: 1,
    progress_percentage: 100,
    is_unlocked: true,
    unlocked_at: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    tips: [],
  },
  {
    achievement_type: 'FIRST_GOAL',
    title: 'Goal Setter',
    description: 'Created your first financial goal',
    category: 'planning',
    icon: '🎯',
    rarity: 'common',
    points_reward: 150,
    current_progress: 1,
    required_progress: 1,
    progress_percentage: 100,
    is_unlocked: true,
    unlocked_at: new Date(Date.now() - 25 * 24 * 60 * 60 * 1000).toISOString(),
    tips: [],
  },
  {
    achievement_type: 'DAILY_LOGIN_STREAK_7',
    title: 'Weekly Warrior',
    description: 'Logged in for 7 consecutive days',
    category: 'engagement',
    icon: '🔥',
    rarity: 'common',
    points_reward: 200,
    current_progress: 1,
    required_progress: 1,
    progress_percentage: 100,
    is_unlocked: true,
    unlocked_at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
    tips: [],
  },
  {
    achievement_type: 'GOAL_COMPLETED',
    title: 'Goal Achiever',
    description: 'Completed your first financial goal',
    category: 'planning',
    icon: '🏆',
    rarity: 'common',
    points_reward: 200,
    current_progress: 1,
    required_progress: 1,
    progress_percentage: 100,
    is_unlocked: true,
    unlocked_at: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
    tips: [],
  },
  {
    achievement_type: 'HUNDRED_TRANSACTIONS',
    title: 'Transaction Master',
    description: 'Record 100 transactions',
    category: 'financial',
    icon: '💯',
    rarity: 'rare',
    points_reward: 500,
    current_progress: 47,
    required_progress: 100,
    progress_percentage: 47,
    is_unlocked: false,
    unlocked_at: null,
    tips: ['Add your daily expenses', 'Import past transactions to catch up faster'],
  },
  {
    achievement_type: 'FIVE_GOALS_COMPLETED',
    title: 'Goal Master',
    description: 'Complete 5 financial goals',
    category: 'planning',
    icon: '⭐',
    rarity: 'rare',
    points_reward: 750,
    current_progress: 1,
    required_progress: 5,
    progress_percentage: 20,
    is_unlocked: false,
    unlocked_at: null,
    tips: ['Create savings goals for vacations, emergency fund, or big purchases'],
  },
  {
    achievement_type: 'DAILY_LOGIN_STREAK_30',
    title: 'Monthly Master',
    description: 'Log in for 30 consecutive days',
    category: 'engagement',
    icon: '⭐',
    rarity: 'epic',
    points_reward: 1000,
    current_progress: 7,
    required_progress: 30,
    progress_percentage: 23,
    is_unlocked: false,
    unlocked_at: null,
    tips: ['Check your dashboard each morning', 'Set a daily reminder'],
  },
  {
    achievement_type: 'QR_PAYMENT_MASTER',
    title: 'QR Payment Pro',
    description: 'Use QR payments 20 times',
    category: 'regional',
    icon: '📱',
    rarity: 'rare',
    points_reward: 300,
    current_progress: 3,
    required_progress: 20,
    progress_percentage: 15,
    is_unlocked: false,
    unlocked_at: null,
    tips: ['Log QR payments when you scan to pay at stores'],
  },
  {
    achievement_type: 'DAILY_LOGIN_STREAK_100',
    title: 'Legendary Streaker',
    description: 'Log in for 100 consecutive days',
    category: 'engagement',
    icon: '👑',
    rarity: 'legendary',
    points_reward: 5000,
    current_progress: 7,
    required_progress: 100,
    progress_percentage: 7,
    is_unlocked: false,
    unlocked_at: null,
    tips: ['A legendary commitment to financial awareness'],
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Rarity = 'common' | 'rare' | 'epic' | 'legendary';
type Tab = 'all' | 'unlocked' | 'locked';
type SortKey = 'default' | 'progress' | 'rarity' | 'name';

const RARITY_CONFIG: Record<Rarity, { label: string; badgeCls: string; borderCls: string; barCls: string }> = {
  common:    { label: 'Common',    badgeCls: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',       borderCls: 'border-gray-200 dark:border-gray-600',   barCls: 'bg-gray-400' },
  rare:      { label: 'Rare',      badgeCls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',   borderCls: 'border-blue-300 dark:border-blue-700',   barCls: 'bg-blue-500' },
  epic:      { label: 'Epic',      badgeCls: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300', borderCls: 'border-purple-300 dark:border-purple-700', barCls: 'bg-purple-500' },
  legendary: { label: 'Legendary', badgeCls: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300', borderCls: 'border-yellow-400 dark:border-yellow-600', barCls: 'bg-yellow-500' },
};

const RARITY_ORDER: Record<Rarity, number> = { legendary: 0, epic: 1, rare: 2, common: 3 };

// Streak milestones the backend rewards (DAILY_LOGIN_STREAK_7/30/100).
const STREAK_MILESTONES = [7, 30, 100];

// Takes `t` rather than calling the hook: this is a plain helper, not a
// component, and its four phrasings differ per language.
function relativeTime(dateStr: string, t: TFunction) {
  const d = new Date(dateStr);
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days === 0) return t('goals:achievements.relative.today');
  if (days === 1) return t('goals:achievements.relative.yesterday');
  if (days < 30) return t('goals:achievements.relative.daysAgo', { count: days });
  const months = Math.floor(days / 30);
  return t('goals:achievements.relative.monthsAgo', { count: months });
}

function nextMilestone(streak: number): number | null {
  return STREAK_MILESTONES.find((m) => m > streak) ?? null;
}

// ---------------------------------------------------------------------------
// Score Card
// ---------------------------------------------------------------------------

function ScoreCard({ label, score, emoji }: { label: string; score: number; emoji: string }) {
  const pct = Math.min(100, score);
  const color =
    pct >= 70 ? 'bg-prosperity-500' : pct >= 40 ? 'bg-warning-500' : 'bg-error-500';

  return (
    <Card padding="sm" radius="xl" shadow="none">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-1.5">
          <span className="text-lg">{emoji}</span>
          {label}
        </span>
        <span className="text-lg font-bold text-gray-900 dark:text-white">{score}</span>
      </div>
      <div
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${label} score`}
        className="h-2 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700"
      >
        <div className={cn('h-2 rounded-full transition-all duration-700', color)} style={{ width: `${pct}%` }} />
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Streak strip — last 7 days, with next-milestone nudge
// ---------------------------------------------------------------------------

function StreakStrip({ streak, longest }: { streak: number; longest: number }) {
  const { t } = useTranslation(['goals']);
  const today = new Date();
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() - (6 - i));
    // The last `streak` days (up to 7) count as active.
    const offsetFromToday = 6 - i;
    const active = offsetFromToday < Math.min(streak, 7);
    return {
      label: d.toLocaleDateString(undefined, { weekday: 'narrow' }),
      isToday: offsetFromToday === 0,
      active,
    };
  });

  const target = nextMilestone(streak);
  const remaining = target ? target - streak : 0;

  return (
    <Card padding="md" radius="xl" shadow="none">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className="text-2xl" aria-hidden>🔥</span>
          <div>
            <p className="text-sm font-semibold text-gray-900 dark:text-white">
              {streak}-day streak
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400">Best: {longest} days</p>
          </div>
        </div>
        {target ? (
          <span className="rounded-full bg-amber-50 dark:bg-amber-900/20 px-3 py-1 text-xs font-medium text-amber-700 dark:text-amber-300">
            {remaining} day{remaining === 1 ? '' : 's'} to {target}-day badge
          </span>
        ) : (
          <span className="rounded-full bg-prosperity-50 dark:bg-prosperity-900/20 px-3 py-1 text-xs font-medium text-prosperity-700 dark:text-prosperity-300">
            {t('goals:achievements.allStreaksEarned')}
          </span>
        )}
      </div>

      <div className="flex items-center justify-between gap-1.5" role="list" aria-label={t('goals:achievements.last7Days')}>
        {days.map((d, i) => (
          <div key={i} className="flex flex-1 flex-col items-center gap-1.5" role="listitem">
            <div
              className={cn(
                'flex h-9 w-full max-w-[44px] items-center justify-center rounded-lg text-sm transition-colors',
                d.active
                  ? 'bg-gradient-to-br from-amber-400 to-orange-500 text-white shadow-sm'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-300 dark:text-gray-600',
                d.isToday && 'ring-2 ring-amber-500 ring-offset-1 ring-offset-white dark:ring-offset-gray-800'
              )}
              aria-label={d.active ? 'Active day' : 'Inactive day'}
            >
              {d.active ? '🔥' : '·'}
            </div>
            <span className="text-xs font-medium uppercase text-gray-500 dark:text-gray-500">
              {d.label}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Achievement Card (clickable)
// ---------------------------------------------------------------------------

function AchievementCard({ a, onSelect }: { a: AchievementProgress; onSelect: (a: AchievementProgress) => void }) {
  const { t } = useTranslation(['goals']);
  const rarity = (a.rarity as Rarity) in RARITY_CONFIG ? (a.rarity as Rarity) : 'common';
  const cfg = RARITY_CONFIG[rarity];

  return (
    <button
      type="button"
      onClick={() => onSelect(a)}
      aria-label={`View ${a.title} details`}
      className={cn(
        'group w-full text-left rounded-xl border bg-white dark:bg-gray-800 p-4 flex flex-col gap-2 transition-all hover:shadow-md hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/60',
        cfg.borderCls,
        !a.is_unlocked && 'opacity-60 hover:opacity-100'
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className={cn('text-3xl', !a.is_unlocked && 'grayscale')}>{a.icon}</span>
        <span className={cn('rounded-full px-2 py-0.5 text-xs font-semibold', cfg.badgeCls)}>
          {cfg.label}
        </span>
      </div>
      <div>
        <p className="font-semibold text-gray-900 dark:text-white text-sm">{a.title}</p>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-2">{a.description}</p>
      </div>

      {a.is_unlocked ? (
        <p className="text-xs text-prosperity-700 dark:text-prosperity-400 font-medium">
          {t('goals:achievements.earnedOn', { when: a.unlocked_at ? relativeTime(a.unlocked_at, t) : '' })}
        </p>
      ) : (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
            <span>{a.current_progress} / {a.required_progress}</span>
            <span>{Math.round(a.progress_percentage)}%</span>
          </div>
          <div
            role="progressbar"
            aria-valuenow={Math.round(Math.min(100, a.progress_percentage))}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`${a.title} achievement progress`}
            className="h-1.5 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700"
          >
            <div
              className={cn('h-1.5 rounded-full transition-all duration-700', cfg.barCls)}
              style={{ width: `${Math.min(100, a.progress_percentage)}%` }}
            />
          </div>
        </div>
      )}

      <p className="text-xs text-primary-700 dark:text-primary-400 font-medium">+{a.points_reward} XP</p>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AchievementsPage() {
  const { t } = useTranslation(['goals', 'dashboard']);
  const { isDemo, isAuthenticated } = useAppMode();
  const [tab, setTab] = useState<Tab>('all');
  const [category, setCategory] = useState<string>('all');
  const [sortKey, setSortKey] = useState<SortKey>('default');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<AchievementProgress | null>(null);

  // Fetch only when authenticated — gating on `!isDemo` alone races the async
  // demo-cookie detection and fires a 401 before demo mode resolves.
  const { data: liveStats, isLoading: statsLoading } = useGamificationStats({ enabled: isAuthenticated });
  const { data: liveProgress, isLoading: progressLoading } = useAchievementProgress({ enabled: isAuthenticated });
  const updateStreak = useUpdateStreak();
  const checkAchievements = useCheckAchievements();

  const stats: GamificationStats = isDemo ? DEMO_STATS : (liveStats ?? EMPTY_STATS);
  const progress: AchievementProgress[] = useMemo(
    () => (isDemo ? DEMO_PROGRESS : (liveProgress ?? [])),
    [isDemo, liveProgress]
  );

  const isLoading = !isDemo && (statsLoading || progressLoading);

  // Ping the streak once per mount in live mode. The backend is idempotent per
  // day, so this just keeps "current streak" honest and may award login badges.
  const streakPinged = useRef(false);
  useEffect(() => {
    // Only ping when authenticated — avoids a premature 401 during the brief
    // window before demo/auth state resolves.
    if (!isAuthenticated || streakPinged.current) return;
    streakPinged.current = true;
    updateStreak.mutate(undefined, {
      onSuccess: (res) => {
        if (res?.new_achievements?.length) {
          res.new_achievements.forEach((ach) =>
            toast.success(t('goals:achievements.streakBadgeToast', { name: ach.title ?? t('goals:achievements.fallbackName') }), { duration: 5000 })
          );
        }
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated]);

  const handleCheck = () => {
    if (isDemo) {
      toast('Sign in to sync real achievements ✨', { icon: 'ℹ️' });
      return;
    }
    toast.promise(checkAchievements.mutateAsync(), {
      loading: 'Checking for new achievements…',
      success: (earned) =>
        earned.length
          ? t('goals:achievements.newAchievements', { count: earned.length })
          : t('goals:achievements.allCaughtUp'),
      error: t('goals:achievements.checkFailed'),
    });
  };

  const categories = useMemo(() => {
    const set = new Set(progress.map((a) => a.category).filter(Boolean));
    return ['all', ...Array.from(set)];
  }, [progress]);

  const displayed = useMemo(() => {
    let list = progress;
    if (tab === 'unlocked') list = list.filter((a) => a.is_unlocked);
    else if (tab === 'locked') list = list.filter((a) => !a.is_unlocked);
    if (category !== 'all') list = list.filter((a) => a.category === category);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (a) => a.title.toLowerCase().includes(q) || a.description.toLowerCase().includes(q)
      );
    }
    const sorted = [...list];
    switch (sortKey) {
      case 'progress':
        sorted.sort((a, b) => b.progress_percentage - a.progress_percentage);
        break;
      case 'rarity':
        sorted.sort(
          (a, b) =>
            (RARITY_ORDER[a.rarity as Rarity] ?? 9) - (RARITY_ORDER[b.rarity as Rarity] ?? 9)
        );
        break;
      case 'name':
        sorted.sort((a, b) => a.title.localeCompare(b.title));
        break;
      default:
        break;
    }
    return sorted;
  }, [progress, tab, category, search, sortKey]);

  // Phones (#344): the streak first, then the badges closest to unlocking. The
  // scores and the searchable grid are for browsing — they stay on bigger screens.
  const isMobile = useIsMobile();
  const phone = isMobile === true;
  const almostThere = useMemo(
    () => progress
      .filter((a) => !a.is_unlocked && a.progress_percentage > 0)
      .sort((a, b) => b.progress_percentage - a.progress_percentage)
      .slice(0, 3),
    [progress],
  );

  const xpDenominator = stats.experience_points + stats.experience_to_next_level;
  const xpPct = xpDenominator > 0
    ? Math.min(100, (stats.experience_points / xpDenominator) * 100)
    : 0;

  const streakStrip = (
    <StreakStrip
      streak={stats.streak_info.current_login_streak}
      longest={stats.streak_info.longest_login_streak}
    />
  );

  return (
    <DashboardLayout>
      <div className="space-y-6 max-w-4xl mx-auto">
        <PageHeader
            title={t('goals:achievements.title')}
            subtitle={t('goals:achievements.subtitle')}
            accent="amber"
        />

        {isLoading ? (
          <div className="flex justify-center py-20"><LoadingSpinner /></div>
        ) : (
          <>
            {/* On phones the streak is the hero, above the level card. */}
            {phone && streakStrip}

            {/* Level & XP card */}
            <Card padding="lg" radius="xl" shadow="none">
              <div className="flex flex-wrap items-center gap-6">
                {/* Level badge */}
                <div className="flex flex-col items-center">
                  <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-primary-500 to-primary-600 shadow-sm">
                    <span className="text-2xl font-black text-white">{stats.level}</span>
                  </div>
                  <span className="mt-1 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">{t('goals:achievements.level')}</span>
                </div>

                {/* XP bar */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                      {stats.experience_points.toLocaleString()} XP
                    </span>
                    <span className="text-xs text-gray-500 dark:text-gray-500">
                      {stats.experience_to_next_level.toLocaleString()} to next level
                    </span>
                  </div>
                  <div
                    role="progressbar"
                    aria-valuenow={Math.round(xpPct)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`Level ${stats.level} XP progress: ${Math.round(xpPct)}%`}
                    className="h-3 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700"
                  >
                    <div
                      aria-hidden="true"
                      className="h-3 rounded-full bg-gradient-to-r from-primary-500 to-primary-600 transition-all duration-700"
                      style={{ width: `${xpPct}%` }}
                    />
                  </div>
                </div>

                {/* Total achievements */}
                <div className="flex flex-col items-center gap-0.5">
                  <span className="text-2xl">🏆</span>
                  <span className="text-xl font-bold text-gray-900 dark:text-white">{stats.total_achievements}</span>
                  <span className="text-xs text-gray-500 dark:text-gray-400">{t('goals:achievements.unlocked')}</span>
                </div>

                {/* Check for new achievements */}
                <button
                  type="button"
                  onClick={handleCheck}
                  disabled={checkAchievements.isPending}
                  className="ml-auto inline-flex items-center gap-2 rounded-lg bg-primary-700 px-4 py-2.5 min-h-[44px] text-sm font-medium text-white shadow-sm transition-colors hover:bg-primary-800 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/60 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-800"
                >
                  <span className={cn('text-base', checkAchievements.isPending && 'animate-spin')} aria-hidden>
                    {checkAchievements.isPending ? '⏳' : '🔄'}
                  </span>
                  {checkAchievements.isPending ? t('goals:achievements.checking') : t('goals:achievements.checkForNew')}
                </button>
              </div>

              {/* Rarity breakdown */}
              {Object.keys(stats.achievements_by_rarity).length > 0 && (
                <div className="mt-4 flex flex-wrap gap-2 pt-4 border-t border-gray-100 dark:border-gray-700">
                  {(Object.entries(stats.achievements_by_rarity) as [Rarity, number][]).map(([r, count]) => {
                    const cfg = RARITY_CONFIG[r] ?? RARITY_CONFIG.common;
                    return (
                      <span key={r} className={cn('rounded-full px-3 py-1 text-xs font-semibold', cfg.badgeCls)}>
                        {count} {cfg.label}
                      </span>
                    );
                  })}
                </div>
              )}
            </Card>

            {!phone && streakStrip}

            {phone && (
              <section className="space-y-3">
                <h2 className="text-base font-semibold text-gray-800 dark:text-gray-200">
                  {t('goals:achievements.almostThere', 'Almost there')}
                </h2>
                {almostThere.length === 0 ? (
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {t('goals:achievements.allCaughtUp')}
                  </p>
                ) : (
                  <div className="grid grid-cols-1 gap-3">
                    {almostThere.map((a) => (
                      <AchievementCard key={a.achievement_type} a={a} onSelect={setSelected} />
                    ))}
                  </div>
                )}
                <p className="text-center px-4 pt-1 text-xs font-semibold leading-relaxed text-gray-500 dark:text-gray-500">
                  {t('dashboard:mobile.fullAchievements', 'Every badge, scores, search & filters')}
                  <br />
                  <span className="text-primary-700 dark:text-primary-400">→ {t('dashboard:mobile.onLargerScreen', 'on tablet / desktop')}</span>
                </p>
              </section>
            )}

            {/* Regional Scores */}
            {!phone && (
            <div>
              <h2 className="text-base font-semibold text-gray-800 dark:text-gray-200 mb-3">{t('goals:achievements.financialScores')}</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <ScoreCard label={t('goals:achievements.scores.digitalAdoption')}    score={stats.digital_adoption_score}    emoji="📱" />
                <ScoreCard label={t('goals:achievements.scores.savingsDiscipline')}  score={stats.savings_discipline_score}  emoji="💰" />
                <ScoreCard label={t('goals:achievements.scores.investmentKnowledge')} score={stats.investment_knowledge_score} emoji="📈" />
                <ScoreCard label={t('goals:achievements.scores.communityEngagement')} score={stats.community_engagement_score} emoji="👥" />
              </div>
            </div>
            )}

            {/* Achievement Grid */}
            {!phone && (
            <div>
              <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                <h2 className="text-base font-semibold text-gray-800 dark:text-gray-200">{t('goals:achievements.title')}</h2>
                <div role="tablist" aria-label={t('goals:achievements.filterStatus')} className="flex rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
                  {/* Loop variable renamed from `t` — it shadowed the translator. */}
                  {(['all', 'unlocked', 'locked'] as const).map((tabKey) => (
                    <button
                      key={tabKey}
                      role="tab"
                      type="button"
                      aria-selected={tab === tabKey}
                      onClick={() => setTab(tabKey)}
                      className={cn(
                        'px-4 py-2.5 min-h-[44px] text-xs font-medium capitalize transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500/60',
                        tab === tabKey
                          ? 'bg-primary-700 text-white'
                          : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'
                      )}
                    >
                      {t(`goals:achievements.tabs.${tabKey}`)}
                    </button>
                  ))}
                </div>
              </div>

              {/* Toolbar: search + category + sort */}
              <div className="flex flex-wrap items-center gap-2 mb-4">
                <div className="relative flex-1 min-w-[180px]">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 dark:text-gray-400" aria-hidden>🔍</span>
                  <input
                    type="search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder={t('goals:achievements.searchPlaceholder')}
                    aria-label={t('goals:achievements.searchLabel')}
                    className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 py-2.5 pl-9 pr-3 text-sm text-gray-900 dark:text-white placeholder-gray-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/60"
                  />
                </div>

                <label className="sr-only" htmlFor="sort-select">{t('goals:achievements.sortLabel')}</label>
                <select
                  id="sort-select"
                  value={sortKey}
                  onChange={(e) => setSortKey(e.target.value as SortKey)}
                  className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 py-2.5 px-3 text-sm text-gray-700 dark:text-gray-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/60"
                >
                  <option value="default">{t('goals:achievements.sortDefault')}</option>
                  <option value="progress">{t('goals:achievements.sortProgress')}</option>
                  <option value="rarity">{t('goals:achievements.sortRarity')}</option>
                  <option value="name">{t('goals:achievements.sortName')}</option>
                </select>
              </div>

              {/* Category chips */}
              {categories.length > 2 && (
                <div className="flex flex-wrap gap-2 mb-4" role="group" aria-label={t('goals:achievements.filterCategory')}>
                  {categories.map((c) => (
                    <button
                      key={c}
                      type="button"
                      aria-pressed={category === c}
                      onClick={() => setCategory(c)}
                      className={cn(
                        'rounded-full px-3 py-1.5 text-xs font-medium capitalize transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/60',
                        category === c
                          ? 'bg-gray-900 dark:bg-white text-white dark:text-gray-900'
                          : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                      )}
                    >
                      {c === 'all' ? 'All' : c}
                    </button>
                  ))}
                </div>
              )}

              {displayed.length === 0 ? (
                <div className="rounded-xl border border-gray-200 dark:border-gray-700 py-12 text-center">
                  <p className="text-2xl mb-2">🏆</p>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {search.trim() || category !== 'all'
                      ? 'No achievements match your filters.'
                      : 'No achievements yet. Keep going!'}
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {displayed.map((a) => (
                    <AchievementCard key={a.achievement_type} a={a} onSelect={setSelected} />
                  ))}
                </div>
              )}
            </div>
            )}
          </>
        )}
      </div>

      <AchievementDetailModal achievement={selected} onClose={() => setSelected(null)} />
    </DashboardLayout>
  );
}
