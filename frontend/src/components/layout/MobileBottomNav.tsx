'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslation } from 'react-i18next';

import {
  EllipsisHorizontalIcon,
  Cog6ToothIcon,
  ArrowLeftOnRectangleIcon,
  GlobeAltIcon,
} from '@heroicons/react/24/outline';
import { EllipsisHorizontalIcon as EllipsisHorizontalIconSolid } from '@heroicons/react/24/solid';

import { cn } from '@/utils/cn';
import { useDemo } from '@/contexts/DemoContext';
import { useAuthContext } from '@/contexts/AuthContext';
import { languages } from '@/lib/i18n';
import { getSecondaryNavItems, primaryNavItems } from '@/lib/navigation';
import { useFeatures } from '@/hooks/useFeatures';
import { changeAppLanguage, signOutCompletely } from '@/lib/session-actions';
import { useDialog } from '@/hooks/useDialog';

// ---------------------------------------------------------------------------
// Tab configuration
// ---------------------------------------------------------------------------

interface NavTab {
  label: string;
  href: string;
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  iconSolid: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  /** When true this tab opens the More sheet instead of navigating */
  isMore?: boolean;
}

// The four tabs are `primary` in lib/navigation, so the bar and the sidebar
// cannot disagree about what matters. Everything else is in the More sheet.
const NAV_TABS: NavTab[] = [
  ...primaryNavItems.map((item) => ({
    label: item.nameKey,
    href: item.href,
    icon: item.icon,
    iconSolid: item.iconSolid,
  })),
  {
    label: 'navigation.more',
    href: '#',
    icon: EllipsisHorizontalIcon,
    iconSolid: EllipsisHorizontalIconSolid,
    isMore: true,
  },
];

// ---------------------------------------------------------------------------
// Helper — determine which tab is active from the current pathname
// ---------------------------------------------------------------------------

function useActiveTab(pathname: string): string {
  // Derived from the same `primary` flags the bar renders from — a hardcoded
  // list here would keep rendering a tab that highlighting had stopped knowing
  // about, with nothing to catch it.
  return primaryNavItems.find((item) => pathname.startsWith(item.href))?.href ?? pathname;
}

// ---------------------------------------------------------------------------
// More bottom sheet
// ---------------------------------------------------------------------------

interface MoreSheetProps {
  open: boolean;
  onClose: () => void;
  isDemoMode: boolean;
  onDisableDemo: () => void;
}

function MoreSheet({ open, onClose, isDemoMode, onDisableDemo }: MoreSheetProps) {
  const { panelRef, dialogProps } = useDialog({ isOpen: open, onClose });
  const { t, i18n } = useTranslation('common');
  const pathname = usePathname();
  const features = useFeatures();

  const handleSignOut = async () => {
    onClose();
    await signOutCompletely('/');
  };

  const handleLanguageChange = (code: string) => changeAppLanguage(i18n, code);

  // Derived, so a page added to the sidebar reaches the phone too. The
  // hand-written list had five entries and silently omitted loans, groups,
  // housing, lifecycle and achievements.
  const sheetLinks = [
    ...getSecondaryNavItems(features).map((item) => ({
      href: item.href,
      icon: item.icon,
      labelKey: item.nameKey,
    })),
    { href: '/settings', icon: Cog6ToothIcon, labelKey: 'navigation.settings' },
  ];

  return (
    <>
      {open && (
        <div
          className="md:hidden fixed inset-0 z-40 bg-gray-900/60"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      <div
        ref={panelRef}
        {...(open ? dialogProps : {})}
        // The sheet stays mounted and slides out of view, so without inert its
        // links stay in the tab order and a keyboard user lands on an off-screen
        // menu. inert also keeps the closed sheet out of the a11y tree.
        inert={!open}
        aria-label={t('navigation.moreOptions', 'More options')}
        className={cn(
          'md:hidden fixed bottom-0 left-0 right-0 z-50',
          'bg-white dark:bg-gray-800 rounded-t-2xl shadow-2xl',
          'transform transition-transform duration-300 ease-out',
          open ? 'translate-y-0' : 'translate-y-full'
        )}
      >
        {/* Drag handle */}
        <div className="flex justify-center pt-3 pb-1" aria-hidden="true">
          <div className="w-10 h-1 rounded-full bg-gray-300 dark:bg-gray-600" />
        </div>

        {/* Sheet header */}
        <div className="px-4 pt-1 pb-3 border-b border-gray-100 dark:border-gray-700">
          <p className="text-sm font-semibold text-gray-900 dark:text-white">
            {t('navigation.more', 'More')}
          </p>
        </div>

        {/* Nav links */}
        <nav className="px-2 pt-2 pb-1 space-y-0.5 max-h-[50vh] overflow-y-auto">
          {sheetLinks.map(({ href, icon: Icon, labelKey }) => {
            const isActive = pathname === href || pathname.startsWith(href + '/');
            return (
              <Link
                key={href}
                href={href}
                onClick={onClose}
                className={cn(
                  'flex items-center w-full px-4 py-3 rounded-xl text-sm font-medium transition-colors min-h-[52px] touch-manipulation',
                  isActive
                    ? 'bg-primary-50 text-primary-700 dark:bg-primary-900/20 dark:text-primary-300'
                    : 'text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700'
                )}
              >
                <Icon className={cn(
                  'w-5 h-5 mr-3 flex-shrink-0',
                  isActive ? 'text-primary-500 dark:text-primary-400' : 'text-gray-500 dark:text-gray-500'
                )} />
                {t(labelKey)}
              </Link>
            );
          })}
        </nav>

        {/* Language toggle */}
        <div className="mx-2 px-4 py-3 rounded-xl border border-gray-100 dark:border-gray-700 mb-1">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <GlobeAltIcon className="w-5 h-5 text-gray-500 dark:text-gray-500 flex-shrink-0" />
              <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
                {t('navigation.language', 'Language')}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              {languages.map((lang) => (
                <button
                  key={lang.code}
                  onClick={() => handleLanguageChange(lang.code)}
                  aria-pressed={i18n.language === lang.code}
                  aria-label={lang.code === 'zh-TW' ? '繁體中文' : 'English'}
                  className={cn(
                    'px-3 py-2 min-h-[44px] rounded-lg text-sm font-medium transition-colors touch-manipulation',
                    i18n.language === lang.code
                      ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300'
                      : 'text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700'
                  )}
                >
                  {lang.flag} {lang.code === 'zh-TW' ? '繁中' : 'EN'}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Divider + sign-out */}
        <div className="px-2 pb-2">
          {isDemoMode ? (
            <button
              onClick={() => { onClose(); onDisableDemo(); }}
              className="flex items-center w-full px-4 py-3 rounded-xl text-sm font-medium text-error-700 dark:text-error-400 hover:bg-error-50 dark:hover:bg-error-900/20 transition-colors min-h-[52px] touch-manipulation"
            >
              <ArrowLeftOnRectangleIcon className="w-5 h-5 mr-3 flex-shrink-0" />
              {t('navigation.exitDemo')}
            </button>
          ) : (
            <button
              onClick={handleSignOut}
              className="flex items-center w-full px-4 py-3 rounded-xl text-sm font-medium text-error-700 dark:text-error-400 hover:bg-error-50 dark:hover:bg-error-900/20 transition-colors min-h-[52px] touch-manipulation"
            >
              <ArrowLeftOnRectangleIcon className="w-5 h-5 mr-3 flex-shrink-0" />
              {t('navigation.signOut')}
            </button>
          )}
        </div>

        <div className="pb-[env(safe-area-inset-bottom,0px)]" />
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// MobileBottomNav — the fixed tab bar
// ---------------------------------------------------------------------------

export function MobileBottomNav() {
  const pathname = usePathname();
  const activeHref = useActiveTab(pathname);
  const [sheetOpen, setSheetOpen] = useState(false);
  const { isDemoMode, disableDemo } = useDemo();
  const { t } = useTranslation('common');
  // session available for future use (e.g., showing user avatar in "More")
  useAuthContext();

  return (
    <>
      {/* Bottom tab bar — mobile only */}
      <nav
        aria-label="Mobile navigation"
        className={cn(
          'md:hidden',
          'fixed bottom-0 left-0 right-0 z-40',
          'bg-white dark:bg-gray-800',
          'border-t border-gray-200 dark:border-gray-700',
          // Was `pb-safe`, which no stylesheet defines. The mobile drawer
          // (DashboardSidebar) stops at this bar's top: 3.5rem + 1px + this inset.
          'pb-[env(safe-area-inset-bottom,0px)]'
        )}
      >
        <div className="flex items-stretch h-14">
          {NAV_TABS.map((tab) => {
            const isActive = tab.isMore ? sheetOpen : activeHref === tab.href;
            const Icon = isActive ? tab.iconSolid : tab.icon;

            if (tab.isMore) {
              return (
                <button
                  key="more"
                  onClick={() => setSheetOpen((prev) => !prev)}
                  aria-label={t('navigation.moreOptions')}
                  aria-expanded={sheetOpen}
                  aria-haspopup="dialog"
                  className={cn(
                    'flex-1 flex flex-col items-center justify-center gap-0.5',
                    'min-w-[44px] touch-manipulation transition-colors',
                    'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
                    isActive
                      ? 'text-primary-700 dark:text-primary-400'
                      : 'text-gray-500 dark:text-gray-400'
                  )}
                >
                  <Icon className="w-5 h-5 flex-shrink-0" aria-hidden="true" />
                  <span className="text-[10px] leading-none font-medium">{t(tab.label)}</span>
                </button>
              );
            }

            return (
              <Link
                key={tab.href}
                href={tab.href}
                aria-label={t(tab.label)}
                aria-current={isActive ? 'page' : undefined}
                onClick={() => {
                  // Close sheet if open when navigating
                  if (sheetOpen) setSheetOpen(false);
                }}
                className={cn(
                  'flex-1 flex flex-col items-center justify-center gap-0.5',
                  'min-w-[44px] touch-manipulation transition-colors',
                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
                  isActive
                    ? 'text-primary-700 dark:text-primary-400'
                    : 'text-gray-500 dark:text-gray-400'
                )}
              >
                <Icon className="w-5 h-5 flex-shrink-0" aria-hidden="true" />
                <span className="text-[10px] leading-none font-medium">{t(tab.label)}</span>
              </Link>
            );
          })}
        </div>
      </nav>

      {/* More bottom sheet */}
      <MoreSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        isDemoMode={isDemoMode}
        onDisableDemo={disableDemo}
      />
    </>
  );
}
