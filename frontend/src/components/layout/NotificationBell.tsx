'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslation } from 'react-i18next';
import { cn } from '@/utils/cn';
import {
  useMarkNotificationAsRead,
  useMarkAllNotificationsRead,
} from '@/hooks/api-hooks';
import { useAppMode } from '@/hooks/useAppMode';
import { apiClient } from '@/lib/api-client';
import { useQuery } from '@tanstack/react-query';

interface NotifData {
  id: string;
  type: string;
  title: string;
  message: string;
  priority: string;
  is_read: boolean;
  is_actionable?: boolean;
  action_url?: string;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Demo data
// ---------------------------------------------------------------------------

const DEMO_NOTIFICATIONS: NotifData[] = [
  {
    id: 'demo-notif-1',
    type: 'goal_reminder',
    title: 'Emergency Fund — 75% reached',
    message: "You're only $1,250 away from completing your Emergency Fund goal. Keep it up!",
    priority: 'medium',
    is_read: false,
    is_actionable: true,
    action_url: '/goals',
    created_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'demo-notif-2',
    type: 'achievement_unlocked',
    title: 'Achievement Unlocked!',
    message: '🔥 Weekly Warrior: You logged in 7 days in a row. +200 XP earned.',
    priority: 'low',
    is_read: false,
    is_actionable: true,
    action_url: '/achievements',
    created_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'demo-notif-3',
    type: 'transaction_alert',
    title: 'Large Transaction Detected',
    message: '$342 at Costco was recorded under Groceries.',
    priority: 'medium',
    is_read: true,
    is_actionable: true,
    action_url: '/transactions',
    created_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function relativeTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const diffMs = Date.now() - d.getTime();
  const mins = Math.floor(diffMs / 60000);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

interface TypeStyle {
  bg: string;
  color: string;
  emoji: string;
}

const TYPE_STYLES: Record<string, TypeStyle> = {
  goal_reminder:      { bg: 'bg-yellow-100 dark:bg-yellow-900/30', color: 'text-yellow-600 dark:text-yellow-400', emoji: '🎯' },
  transaction_alert:  { bg: 'bg-blue-100 dark:bg-blue-900/30',   color: 'text-blue-600 dark:text-blue-400',   emoji: '💳' },
  investment_alert:   { bg: 'bg-green-100 dark:bg-green-900/30',  color: 'text-green-600 dark:text-green-400',  emoji: '📈' },
  achievement_unlocked:{ bg: 'bg-purple-100 dark:bg-purple-900/30',color: 'text-purple-600 dark:text-purple-400',emoji: '🏆' },
  security_alert:     { bg: 'bg-red-100 dark:bg-red-900/30',     color: 'text-red-600 dark:text-red-400',     emoji: '🔒' },
};
const DEFAULT_STYLE: TypeStyle = { bg: 'bg-gray-100 dark:bg-gray-700', color: 'text-gray-500 dark:text-gray-400', emoji: '🔔' };

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function NotifItem({ n, onRead }: { n: NotifData; onRead: (id: string) => void }) {
  const router = useRouter();
  const style = TYPE_STYLES[n.type] ?? DEFAULT_STYLE;

  function handleClick() {
    if (!n.is_read) onRead(n.id);
    if (n.is_actionable && n.action_url) router.push(n.action_url);
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className={cn(
        'w-full flex items-start gap-3 px-4 py-3 text-left transition-colors',
        'hover:bg-gray-50 dark:hover:bg-gray-700/50',
        'focus:outline-none focus-visible:bg-gray-50',
        !n.is_read && 'bg-blue-50/50 dark:bg-blue-900/10'
      )}
    >
      <span className={cn('mt-1 h-2 w-2 shrink-0 rounded-full', !n.is_read ? 'bg-blue-500' : 'bg-transparent')} />
      <span className={cn('shrink-0 rounded-full p-1.5 text-base leading-none', style.bg)}>
        {style.emoji}
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn('block text-sm font-medium', !n.is_read ? 'text-gray-900 dark:text-white' : 'text-gray-700 dark:text-gray-300')}>
          {n.title}
        </span>
        <span className="mt-0.5 block text-xs text-gray-500 dark:text-gray-400 line-clamp-2">
          {n.message}
        </span>
        <span className="mt-1 block text-xs text-gray-400 dark:text-gray-500">
          {relativeTime(n.created_at)}
        </span>
      </span>
    </button>
  );
}

function EmptyState() {
  const { t } = useTranslation('common');
  return (
    <div className="flex flex-col items-center justify-center py-10 px-4 text-center">
      <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-gray-100 dark:bg-gray-700 text-2xl" aria-hidden="true">🔔</span>
      <p className="text-sm font-medium text-gray-700 dark:text-gray-300">{t('notifications.allCaughtUp', "You're all caught up!")}</p>
      <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">{t('notifications.noNew', 'No new notifications.')}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// NotificationBell
// ---------------------------------------------------------------------------

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { isDemo, isAuthenticated } = useAppMode();
  const { t } = useTranslation('common');

  const { data: liveNotifications = [] } = useQuery<NotifData[]>({
    queryKey: ['notifications'],
    queryFn: () => apiClient.getNotifications() as unknown as NotifData[],
    staleTime: 5 * 60 * 1000,
    // Fetch only when authenticated — gating on `!isDemo` alone races the
    // async demo-cookie detection and fires a 401 before demo mode resolves.
    enabled: isAuthenticated,
  });
  const markRead = useMarkNotificationAsRead();
  const markAllRead = useMarkAllNotificationsRead();

  const notifications: NotifData[] = isDemo ? DEMO_NOTIFICATIONS : liveNotifications;
  const unread = notifications.filter((n) => !n.is_read).length;

  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [open]);

  function handleRead(id: string) {
    if (!isDemo) markRead.mutate(id);
  }

  function handleMarkAll() {
    if (!isDemo) markAllRead.mutate();
  }

  return (
    <div ref={ref} className="relative">
      {/* Bell button */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={unread > 0 ? t('notifications.unreadCount', '{{label}}, {{count}} unread', { label: t('navigation.notifications'), count: unread }) : t('navigation.notifications')}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={cn(
          // 44px on touch screens, 36px from sm up where a pointer is precise.
          'relative flex h-11 w-11 sm:h-9 sm:w-9 items-center justify-center rounded-full',
          'text-gray-500 dark:text-gray-400',
          'hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500'
        )}
      >
        {/* Bell SVG (heroicons outline) */}
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-5 w-5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0" />
        </svg>
        {unread > 0 && (
          <span
            className="absolute -right-0.5 -top-0.5 flex h-[1.1rem] min-w-[1.1rem] items-center justify-center rounded-full bg-error-600 dark:bg-error-500 px-0.5 text-[10px] font-bold leading-none text-white"
            aria-hidden="true"
          >
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t('navigation.notifications')}
          className={cn(
            'absolute right-0 mt-2 w-80 sm:w-96 z-50',
            'rounded-xl border border-gray-200 dark:border-gray-700',
            'bg-white dark:bg-gray-800 shadow-lg overflow-hidden'
          )}
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-gray-100 dark:border-gray-700 px-4 py-3">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
              {t('navigation.notifications')}
              {unread > 0 && (
                <span className="ml-2 rounded-full bg-primary-100 px-1.5 py-0.5 text-xs font-medium text-primary-700 dark:bg-primary-900/40 dark:text-primary-300">
                  {unread} {t('notifications.new', 'new')}
                </span>
              )}
            </h2>
            <div className="flex items-center gap-1">
              {unread > 0 && (
                <button
                  type="button"
                  onClick={handleMarkAll}
                  disabled={markAllRead.isPending}
                  aria-label={t('notifications.markAllRead', 'Mark all notifications as read')}
                  className="rounded-md px-2 py-1 text-xs font-medium text-primary-600 hover:bg-primary-50 dark:text-primary-400 dark:hover:bg-primary-900/30 disabled:opacity-50 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                >
                  {t('notifications.markAllRead', 'Mark all read')}
                </button>
              )}
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label={t('common.close')}
                className="rounded-md p-1 min-w-[36px] min-h-[36px] flex items-center justify-center text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-4 w-4">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {/* List */}
          <div className="max-h-96 overflow-y-auto divide-y divide-gray-100 dark:divide-gray-700/50">
            {notifications.length === 0 ? (
              <EmptyState />
            ) : (
              notifications.map((n) => (
                <NotifItem key={n.id} n={n} onRead={handleRead} />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
