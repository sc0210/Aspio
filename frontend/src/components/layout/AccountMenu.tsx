'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslation } from 'react-i18next';
import { Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react';
import {
  ChevronUpDownIcon,
  Cog6ToothIcon,
  EyeIcon,
  EyeSlashIcon,
  GlobeAltIcon,
  MegaphoneIcon,
  ArrowLeftOnRectangleIcon,
} from '@heroicons/react/24/outline';
import { cn } from '@/utils/cn';
import { Avatar } from '@/components/ui/Avatar';
import { useDemo } from '@/contexts/DemoContext';
import { useAuthContext } from '@/contexts/AuthContext';
import { usePrivacy } from '@/contexts/PrivacyContext';
import { useWhatsNew } from '@/hooks/useWhatsNew';
import { useGamificationStats } from '@/hooks/api-hooks';
import { languages } from '@/lib/i18n';
import { changeAppLanguage, signOutCompletely } from '@/lib/session-actions';

interface AccountMenuProps {
  collapsed: boolean;
  /** Closes the mobile drawer behind the menu when an item navigates. */
  onNavigate: () => void;
}

/**
 * Who you are, and the five things you do to the app rather than in it.
 *
 * Language, privacy, What's New, settings and sign out used to be five rows at
 * the foot of the sidebar, in the same treatment as Portfolio and Goals — so
 * Settings looked exactly as important as the pages you visit daily, and the
 * five of them cost more vertical space than a whole nav section. They belong
 * to the account, so they live behind it.
 */
export function AccountMenu({ collapsed, onNavigate }: AccountMenuProps) {
  const { t, i18n } = useTranslation('common');
  const pathname = usePathname();
  const { session, isAuthenticated } = useAuthContext();
  const { isDemoMode, disableDemo } = useDemo();
  const { isValueVisible, toggleValueVisibility } = usePrivacy();
  const { hasUnseen: hasWhatsNew } = useWhatsNew();
  // Fetch only when authenticated — gating on `!isDemoMode` alone races the
  // async demo-cookie detection and fires a 401 before demo mode resolves.
  const { data: gamificationStats } = useGamificationStats({ enabled: isAuthenticated });

  const name = isDemoMode ? 'Alex Chen' : (session?.user?.name || 'User');
  const level = isDemoMode ? 5 : gamificationStats?.level;
  const xp = isDemoMode ? 2340 : gamificationStats?.experience_points;
  const xpPercent = isDemoMode
    ? 78
    : gamificationStats
      ? Math.round(Math.min(100, (gamificationStats.experience_points /
          (gamificationStats.experience_points + gamificationStats.experience_to_next_level)) * 100))
      : 0;

  const handleSignOut = async () => {
    onNavigate();
    if (isDemoMode) {
      disableDemo();
      return;
    }
    await signOutCompletely('/');
  };

  const itemClass = (active: boolean, tone: 'default' | 'danger' = 'default') =>
    cn(
      'flex w-full items-center gap-3 px-3 py-2.5 text-sm font-medium rounded-lg transition-colors text-left',
      tone === 'danger'
        ? 'text-error-700 dark:text-error-400'
        : 'text-gray-600 dark:text-gray-300',
      active && (tone === 'danger'
        ? 'bg-error-50 text-error-700 dark:bg-error-900/20 dark:text-error-300'
        : 'bg-gray-100 text-gray-900 dark:bg-gray-700/60 dark:text-white'),
    );

  return (
    <Menu as="div" className="relative">
      <MenuButton
        aria-label={t('navigation.accountMenu', 'Account menu')}
        className={cn(
          'group flex w-full items-center gap-3 rounded-xl px-2 py-2 transition-colors',
          'hover:bg-gray-100 dark:hover:bg-gray-700/60',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400',
          collapsed && 'justify-center px-0',
        )}
      >
        <span className="relative flex-shrink-0">
          <Avatar
            src={isDemoMode ? '/avatars/demo-user.png' : (session?.user?.image || undefined)}
            alt={name}
            name={name}
            size={collapsed ? 'sm' : 'md'}
          />
          {hasWhatsNew && (
            <span
              className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-primary-500 ring-2 ring-white dark:ring-gray-800"
              aria-hidden="true"
            />
          )}
        </span>

        {!collapsed && (
          <>
            <span className="min-w-0 flex-1 text-left">
              <span className="block truncate text-sm font-semibold text-gray-900 dark:text-white">{name}</span>
              <span className="block text-xs font-medium text-primary-700 dark:text-primary-400">
                {isDemoMode ? '✨ Premium' : '🔰 Basic'}
              </span>
            </span>
            <ChevronUpDownIcon className="w-4 h-4 flex-shrink-0 text-gray-500 dark:text-gray-400" />
          </>
        )}
      </MenuButton>

      <MenuItems
        anchor={{ to: 'top start', gap: 8 }}
        className="z-50 w-64 rounded-xl border border-gray-200 bg-white p-1.5 shadow-lg focus:outline-none dark:border-gray-700 dark:bg-gray-800"
      >
        {/* Language — buttons rather than menu items, so picking one does not
            close the menu out from under a reader comparing the two. */}
        <div className="flex items-center gap-2 px-3 py-2">
          <GlobeAltIcon className="w-4 h-4 flex-shrink-0 text-gray-500 dark:text-gray-400" />
          <span className="flex-1 text-sm text-gray-600 dark:text-gray-400">
            {t('navigation.language', 'Language')}
          </span>
          <span className="flex items-center gap-1">
            {languages.map((lang) => (
              <button
                key={lang.code}
                type="button"
                onClick={() => changeAppLanguage(i18n, lang.code)}
                className={cn(
                  'rounded-md px-2 py-0.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400',
                  i18n.language === lang.code
                    ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300'
                    : 'text-gray-600 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-200',
                )}
              >
                {lang.flag} {lang.code === 'zh-TW' ? '繁中' : 'EN'}
              </button>
            ))}
          </span>
        </div>

        <MenuItem>
          {({ focus }) => (
            <button type="button" onClick={toggleValueVisibility} className={itemClass(focus)}>
              {isValueVisible
                ? <EyeSlashIcon className="w-4 h-4 flex-shrink-0 text-gray-500 dark:text-gray-400" />
                : <EyeIcon className="w-4 h-4 flex-shrink-0 text-warning-700 dark:text-warning-400" />}
              {isValueVisible
                ? t('navigation.hideValues', 'Hide values')
                : t('navigation.showValues', 'Show values')}
            </button>
          )}
        </MenuItem>

        <MenuItem>
          {({ focus }) => (
            <Link
              href="/changelog"
              onClick={onNavigate}
              aria-current={pathname.startsWith('/changelog') ? 'page' : undefined}
              className={itemClass(focus)}
            >
              <MegaphoneIcon className="w-4 h-4 flex-shrink-0 text-gray-500 dark:text-gray-400" />
              <span className="flex items-center gap-2">
                {t('navigation.whatsNew', "What's New")}
                {hasWhatsNew && (
                  <span className="rounded-full bg-primary-50 px-1.5 py-0.5 text-xs font-semibold text-primary-700 dark:bg-primary-900/30 dark:text-primary-400">
                    {t('navigation.new', 'New')}
                  </span>
                )}
              </span>
            </Link>
          )}
        </MenuItem>

        <MenuItem>
          {({ focus }) => (
            <Link
              href="/settings"
              onClick={onNavigate}
              aria-current={pathname.startsWith('/settings') ? 'page' : undefined}
              className={itemClass(focus)}
            >
              <Cog6ToothIcon className="w-4 h-4 flex-shrink-0 text-gray-500 dark:text-gray-400" />
              {t('navigation.settings')}
            </Link>
          )}
        </MenuItem>

        <div className="my-1 h-px bg-gray-100 dark:bg-gray-700" />

        <MenuItem>
          {({ focus }) => (
            <button type="button" onClick={handleSignOut} className={itemClass(focus, 'danger')}>
              <ArrowLeftOnRectangleIcon className="w-4 h-4 flex-shrink-0" />
              {isDemoMode ? t('navigation.exitDemo') : t('navigation.signOut')}
            </button>
          )}
        </MenuItem>
      </MenuItems>

      {/* XP sits under the trigger rather than inside it: it is status, not a
          control, and nesting a progressbar in a button reads as one. */}
      {!collapsed && (gamificationStats || isDemoMode) && (
        <div className="mt-2 space-y-1 px-2">
          <div className="flex items-center justify-between">
            <span className="rounded-full bg-primary-100 px-2 py-0.5 text-xs font-semibold text-primary-700 dark:bg-primary-900/40 dark:text-primary-300">
              Lv {level}
            </span>
            <span className="text-xs text-gray-500 dark:text-gray-500">{xp} XP</span>
          </div>
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={xpPercent}
            aria-label="XP progress"
            className="h-1.5 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-600"
          >
            <div
              className="h-1.5 rounded-full bg-gradient-to-r from-primary-500 to-prosperity-500 transition-all duration-500"
              style={{ width: `${xpPercent}%` }}
            />
          </div>
        </div>
      )}
    </Menu>
  );
}
