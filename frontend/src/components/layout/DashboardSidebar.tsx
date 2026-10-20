'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslation } from 'react-i18next';
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronDownIcon,
  XMarkIcon,
  MagnifyingGlassIcon,
} from '@heroicons/react/24/outline';
import { cn } from '@/utils/cn';
import { useDemo } from '@/contexts/DemoContext';
import { useIsAdmin } from '@/hooks/useAdmin';
import { useScrollLock } from '@/hooks/useScrollLock';
import { getNavigationSections, isNavItemAvailable, type NavSection } from '@/lib/navigation';
import { useFeatures } from '@/hooks/useFeatures';
import { openCommandPalette } from './CommandPalette';
import { AccountMenu } from './AccountMenu';

interface DashboardSidebarProps {
  open: boolean;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onClose: () => void;
}

const SECTION_STATE_KEY = 'aspiro-nav-sections';

/**
 * Which sections the reader has opened or closed, remembered.
 *
 * Read after mount rather than during render: the first paint has to match the
 * server's, and localStorage is not there. Until it resolves — and for any
 * section never toggled — a section is open if the current route is inside it,
 * so landing anywhere shows that section's neighbours and nothing else.
 */
function useSectionState() {
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});

  useEffect(() => {
    try {
      const stored = localStorage.getItem(SECTION_STATE_KEY);
      if (stored) setOverrides(JSON.parse(stored));
    } catch {
      /* private mode — defaults are fine */
    }
  }, []);

  const setSectionOpen = useCallback((key: string, isOpen: boolean) => {
    setOverrides((previous) => {
      const next = { ...previous, [key]: isOpen };
      try {
        localStorage.setItem(SECTION_STATE_KEY, JSON.stringify(next));
      } catch {
        /* private mode — non-fatal */
      }
      return next;
    });
  }, []);

  return { overrides, setSectionOpen };
}

export function DashboardSidebar({ open, collapsed, onToggleCollapsed, onClose }: DashboardSidebarProps) {
  const pathname = usePathname();
  const { t } = useTranslation('common');
  const { isDemoMode } = useDemo();
  const { isAdmin } = useIsAdmin();
  const { overrides, setSectionOpen } = useSectionState();
  const mobileSidebarRef = useRef<HTMLDivElement>(null);
  // The collapsed rail's tooltip, positioned in viewport coordinates.
  //
  // It cannot be a child of the row it describes: <nav> scrolls, and a box with
  // `overflow-y: auto` computes `overflow-x` to `auto` as well, so anything
  // reaching past the 56px rail is clipped away — including, silently, the
  // keyboard tooltip this exists to provide.
  const [railTooltip, setRailTooltip] = useState<{ label: string; top: number } | null>(null);

  const features = useFeatures();
  const navigationSections = getNavigationSections(isAdmin)
    .map((section) => ({ ...section, items: section.items.filter((item) => isNavItemAvailable(item, features)) }))
    .filter((section) => section.items.length > 0);
  const isActiveRoute = (href: string) => pathname === href || pathname.startsWith(href + '/');

  // Which section opens itself when the reader has expressed no preference.
  // Normally the one holding the current route — but the dashboard is a
  // standalone row, so landing there would otherwise show a lone link under
  // three shut headers. Finance is the group opened daily, so it stands in.
  const sectionWithActiveRoute = navigationSections.find(
    (section) => section.titleKey && section.items.some((item) => isActiveRoute(item.href)),
  );
  const defaultOpenKey =
    sectionWithActiveRoute?.titleKey ??
    navigationSections.find((section) => section.titleKey)?.titleKey;

  // Handle click outside to close mobile sidebar
  useEffect(() => {
    if (!open) return;

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (mobileSidebarRef.current && !mobileSidebarRef.current.contains(target)) {
        onClose();
      }
    };

    const timeoutId = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 50);

    return () => {
      clearTimeout(timeoutId);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [open, onClose]);

  // Freeze the page behind the drawer. This used to set body.style.overflow,
  // which does nothing here: <main> is the scroll container, not body.
  useScrollLock(open);

  // Swipe-left to close
  useEffect(() => {
    const element = mobileSidebarRef.current;
    if (!element || !open) return;

    let touchStartX = 0;
    const handleTouchStart = (e: TouchEvent) => { touchStartX = e.touches[0].clientX; };
    const handleTouchEnd = (e: TouchEvent) => {
      if (e.changedTouches[0].clientX - touchStartX < -50) onClose();
    };

    element.addEventListener('touchstart', handleTouchStart, false);
    element.addEventListener('touchend', handleTouchEnd, false);
    return () => {
      element.removeEventListener('touchstart', handleTouchStart);
      element.removeEventListener('touchend', handleTouchEnd);
    };
  }, [open, onClose]);

  const sidebarContent = ({ forceExpanded = false }: { forceExpanded?: boolean } = {}) => {
    const isCollapsed = collapsed && !forceExpanded;

    // The collapsed rail is icons only, so the name has to arrive on hover AND
    // on keyboard focus — the native `title` did neither for a keyboard, and
    // waited a second for a mouse.
    const showRailTooltip = (label: string, element: HTMLElement) => {
      if (!isCollapsed) return;
      const rect = element.getBoundingClientRect();
      setRailTooltip({ label, top: rect.top + rect.height / 2 });
    };

    const renderItems = (section: NavSection) =>
      section.items.map((item) => {
        const isActive = isActiveRoute(item.href);
        const Icon = isActive ? item.iconSolid : item.icon;
        const label = t(item.nameKey);

        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive ? 'page' : undefined}
            aria-label={isCollapsed ? label : undefined}
            onMouseEnter={(e) => showRailTooltip(label, e.currentTarget)}
            onFocus={(e) => showRailTooltip(label, e.currentTarget)}
            onMouseLeave={() => setRailTooltip(null)}
            onBlur={() => setRailTooltip(null)}
            onClick={(e) => {
              if (item.href === '/dashboard' && isDemoMode && pathname === '/dashboard') {
                e.preventDefault();
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }
              onClose();
            }}
            className={cn(
              'group relative flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors duration-150 touch-manipulation min-h-[44px]',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400',
              isCollapsed && 'justify-center px-2',
              isActive
                ? 'bg-primary-50 text-primary-700 dark:bg-primary-900/20 dark:text-primary-300'
                : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-700/60 dark:hover:text-white',
            )}
          >
            <Icon className={cn(
              'w-5 h-5 flex-shrink-0',
              isActive ? 'text-primary-500 dark:text-primary-400' : 'text-gray-500 dark:text-gray-500',
            )} />
            {!isCollapsed && <span className="truncate">{label}</span>}
          </Link>
        );
      });

    return (
      <>
        {/* Logo + collapse control */}
        <div className={cn(
          'flex items-center h-16 px-4 border-b border-gray-200 dark:border-gray-700 flex-shrink-0',
          isCollapsed ? 'justify-center' : 'justify-between',
        )}>
          {!isCollapsed && (
            <Link href="/dashboard" className="flex items-center gap-2.5" onClick={onClose}>
              <div className="w-8 h-8 bg-gradient-to-br from-primary-600 to-primary-500 rounded-lg flex items-center justify-center flex-shrink-0">
                <span className="text-white font-bold text-base">A</span>
              </div>
              <span className="text-xl font-bold text-gray-900 dark:text-white">Aspiro</span>
            </Link>
          )}

          <button
            onClick={onToggleCollapsed}
            aria-label={isCollapsed ? t('navigation.expandSidebar') : t('navigation.collapseSidebar')}
            className={cn(
              'hidden md:flex items-center justify-center p-2 rounded-lg text-gray-500 dark:text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:text-gray-200 dark:hover:bg-gray-700 transition-colors min-w-[44px] min-h-[44px]',
              isCollapsed && 'mx-auto',
            )}
          >
            {isCollapsed ? <ChevronRightIcon className="w-4 h-4" /> : <ChevronLeftIcon className="w-4 h-4" />}
          </button>

          <button
            onClick={onClose}
            aria-label={t('navigation.closeSidebar')}
            className="md:hidden flex items-center justify-center p-2 rounded-lg text-gray-500 dark:text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:text-gray-200 dark:hover:bg-gray-700 min-w-[44px] min-h-[44px] touch-manipulation transition-colors"
          >
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        {/* Search — the palette reaches every page, which is what lets this
            list stay short enough to scan. */}
        <div className={cn('pt-3', isCollapsed ? 'px-1' : 'px-3')}>
          <button
            type="button"
            onClick={() => { onClose(); openCommandPalette(); }}
            aria-label={t('navigation.search', 'Search')}
            className={cn(
              'group relative flex w-full items-center gap-3 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-500 dark:text-gray-400 transition-colors hover:border-primary-300 hover:text-gray-600 dark:border-gray-700 dark:hover:border-primary-600 dark:hover:text-gray-300',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400',
              isCollapsed && 'justify-center px-2',
            )}
          >
            <MagnifyingGlassIcon className="w-5 h-5 flex-shrink-0" />
            {!isCollapsed && (
              <>
                <span className="flex-1 text-left">{t('navigation.search', 'Search')}</span>
                <kbd className="rounded border border-gray-200 px-1.5 py-0.5 text-xs dark:border-gray-600">⌘K</kbd>
              </>
            )}
          </button>
        </div>

        {/* Navigation */}
        {/* Scrolling moves the rows out from under a stationary cursor without
            firing mouseleave, so the tooltip would go on naming the icon that
            used to be there. */}
        <nav
          onScroll={() => setRailTooltip(null)}
          className={cn('flex-1 py-3 overflow-y-auto space-y-1', isCollapsed ? 'px-1' : 'px-3')}
        >
          {navigationSections.map((section, index) => {
            const hasActiveRoute = section.items.some((item) => isActiveRoute(item.href));

            // A standalone row has no heading to collapse, and the collapsed
            // rail has no room for one — both render their items directly.
            if (!section.titleKey || isCollapsed) {
              return (
                <div key={section.titleKey ?? section.items[0].href} className="space-y-0.5">
                  {isCollapsed && index > 0 && (
                    <div className="mx-2 my-2 h-px bg-gray-200 dark:bg-gray-700" aria-hidden="true" />
                  )}
                  {renderItems(section)}
                </div>
              );
            }

            const sectionOpen = overrides[section.titleKey] ?? section.titleKey === defaultOpenKey;

            return (
              <div key={section.titleKey} className="pt-2">
                <button
                  type="button"
                  onClick={() => setSectionOpen(section.titleKey!, !sectionOpen)}
                  aria-expanded={sectionOpen}
                  className="flex w-full items-center gap-1.5 rounded-md px-3 py-1 text-xs font-semibold uppercase tracking-wider text-gray-500 transition-colors hover:text-gray-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 dark:text-gray-500 dark:hover:text-gray-300"
                >
                  <ChevronDownIcon
                    className={cn('w-3.5 h-3.5 flex-shrink-0 transition-transform duration-150', !sectionOpen && '-rotate-90')}
                  />
                  <span className="flex-1 text-left">{t(section.titleKey)}</span>
                  {/* Closed over the page you are on — say so, or the active
                      item simply vanishes. */}
                  {!sectionOpen && hasActiveRoute && (
                    <span className="w-1.5 h-1.5 rounded-full bg-primary-500" aria-hidden="true" />
                  )}
                </button>

                {sectionOpen && <div className="mt-0.5 space-y-0.5">{renderItems(section)}</div>}
              </div>
            );
          })}
        </nav>

        {/* Account — language, privacy, What's New, settings and sign out live
            in here rather than as five more rows above. */}
        <div className={cn(
          'border-t border-gray-200 dark:border-gray-700 py-2 flex-shrink-0',
          isCollapsed ? 'px-1' : 'px-2',
        )}>
          <AccountMenu collapsed={isCollapsed} onNavigate={onClose} />
        </div>

        {isCollapsed && railTooltip && (
          <span
            role="tooltip"
            style={{ top: railTooltip.top }}
            className="pointer-events-none fixed left-14 z-50 -translate-y-1/2 whitespace-nowrap rounded-md bg-gray-900 px-2 py-1 text-xs font-medium text-white shadow-lg dark:bg-gray-700"
          >
            {railTooltip.label}
          </span>
        )}
      </>
    );
  };

  return (
    <>
      {/* Desktop sidebar */}
      <div className={cn(
        'hidden md:flex md:flex-col md:fixed md:inset-y-0 bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 transition-all duration-300 z-30',
        collapsed ? 'md:w-14' : 'md:w-64',
      )}>
        {sidebarContent()}
      </div>

      {/* Mobile sidebar */}
      <div
        ref={mobileSidebarRef}
        className={cn(
          'md:hidden fixed inset-y-0 left-0 z-30 w-72 max-w-[85vw]',
          'bg-white dark:bg-gray-800',
          'border-r border-gray-200 dark:border-gray-700',
          'transform transition-transform duration-300 ease-in-out shadow-2xl',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        {sidebarContent({ forceExpanded: true })}
      </div>
    </>
  );
}
