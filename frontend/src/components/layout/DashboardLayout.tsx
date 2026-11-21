'use client';

import { useState, useEffect, ReactNode } from 'react';
import Link from 'next/link';
import { useTranslation } from 'react-i18next';
import { MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import { NotificationBell } from '@/components/layout/NotificationBell';
import { WhatsNewModal } from '@/components/whatsnew/WhatsNewModal';
import { WhatsNewButton } from '@/components/whatsnew/WhatsNewButton';
import { DashboardSidebar } from './DashboardSidebar';
import { MobileBottomNav } from './MobileBottomNav';
import { CommandPalette, openCommandPalette } from './CommandPalette';
import { ProductTour } from '@/components/tour/ProductTour';
import { TourButton } from '@/components/tour/TourButton';
import { PageTitle } from './PageTitle';
import { cn } from '@/utils/cn';
import { SidebarProvider } from '@/contexts/SidebarContext';
import { DemoBanner } from './DemoBanner';

interface DashboardLayoutProps {
  children: ReactNode;
  rightSidebar?: ReactNode;
  topBarActions?: ReactNode;
}

export function DashboardLayout({ children, rightSidebar, topBarActions }: DashboardLayoutProps) {
  // Default collapsed state based on screen size
  // Tablet (md-lg): collapsed by default
  // Desktop (lg+): expanded by default
  const { t } = useTranslation('common');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [isMounted, setIsMounted] = useState(false);

  // Auto-collapse/expand sidebar based on screen size
  useEffect(() => {
    const saved = localStorage.getItem('sidebar_collapsed');

    const handleResize = () => {
      // Only apply screen-size defaults when user hasn't expressed a preference
      if (saved !== null) return;
      if (window.innerWidth >= 1280) {
        setSidebarCollapsed(false);
      } else if (window.innerWidth >= 768) {
        setSidebarCollapsed(true);
      }
    };

    // Set initial state: saved preference takes priority over screen-size default
    if (saved !== null) {
      setSidebarCollapsed(JSON.parse(saved));
    } else {
      handleResize();
    }

    setIsMounted(true);

    // Listen for window resize
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const handleToggleCollapsed = () => {
    const next = !sidebarCollapsed;
    setSidebarCollapsed(next);
    localStorage.setItem('sidebar_collapsed', JSON.stringify(next));
  };

  return (
    <SidebarProvider collapsed={isMounted ? sidebarCollapsed : true}>
      <a
        href="#main-content"
        className="sr-only focus-visible:not-sr-only focus-visible:fixed focus-visible:top-4 focus-visible:left-4 focus-visible:z-[100] focus-visible:px-4 focus-visible:py-2 focus-visible:bg-white focus-visible:text-primary-700 focus-visible:rounded-lg focus-visible:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
      >
        Skip to main content
      </a>
      <div className="h-[100dvh] flex bg-gray-50 dark:bg-gray-900">
        {/* Left Sidebar */}
        <DashboardSidebar
          collapsed={isMounted ? sidebarCollapsed : true}
          onToggleCollapsed={handleToggleCollapsed}
        />

        {/* Main Content Area */}
        <div
          className={cn(
            'flex-1 flex flex-col overflow-hidden transition-all duration-300',
            isMounted ? (sidebarCollapsed ? 'md:ml-14' : 'md:ml-64') : 'md:ml-14'
          )}
        >
          {/* Inside the content column, not the root layout: there the fixed
              sidebar covered its left edge, and it sat outside this 100dvh
              shell, making every page a banner's height taller than the screen. */}
          <DemoBanner />

          {/* Mobile Header Bar — no hamburger: its drawer listed the same pages as
              the tab bar's More sheet. Search, the drawer's one extra, sits here. */}
          <div className="md:hidden bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between px-3 py-1">
            <Link href="/dashboard" className="flex items-center space-x-2 min-h-[44px] hover:opacity-80 transition-opacity">
              <div className="w-8 h-8 bg-gradient-to-br from-primary-600 to-primary-500 rounded-lg flex items-center justify-center">
                <span className="text-white font-bold text-lg">A</span>
              </div>
              <span className="text-xl font-bold text-gray-900 dark:text-white">Aspiro</span>
            </Link>

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={openCommandPalette}
                aria-label={t('navigation.search', 'Search')}
                data-tour="search"
                className="flex h-11 w-11 items-center justify-center rounded-full text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
              >
                <MagnifyingGlassIcon className="w-5 h-5" />
              </button>
              <TourButton />
              <div className="flex items-center gap-1" data-tour="updates">
                <WhatsNewButton />
                <NotificationBell />
              </div>
            </div>
          </div>

          {/* Desktop top bar */}
          <div className="hidden md:flex items-center px-6 py-3 min-h-[52px] border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
            <PageTitle />
            <div className="flex-1" />
            {topBarActions && (
              <div className="flex items-center gap-2 mr-3" data-tour="page-actions">{topBarActions}</div>
            )}
            <div className="flex items-center gap-1">
              <TourButton />
              <div className="flex items-center gap-1" data-tour="updates">
                <WhatsNewButton />
                <NotificationBell />
              </div>
            </div>
          </div>

          {/* Main Dashboard Content */}
          <div className="flex-1 flex overflow-hidden">
            {/* Primary Content */}
            <main
              id="main-content"
              tabIndex={-1}
              className="flex-1 overflow-y-auto p-3 pb-[calc(5.5rem+env(safe-area-inset-bottom,0px))] sm:p-4 sm:pb-[calc(5.5rem+env(safe-area-inset-bottom,0px))] md:pb-4 lg:p-6 focus:outline-none"
            >
              {/* Wider past 1920px: a 1600px cap left 352px blank either side at 2560. */}
              <div className="max-w-[1600px] min-[1920px]:max-w-[2000px] mx-auto">
                {children}
              </div>
            </main>

            {/* Right Sidebar */}
            {rightSidebar && (
              <aside className="hidden lg:block w-80 bg-white dark:bg-gray-800 border-l border-gray-200 dark:border-gray-700 overflow-y-auto">
                <div className="p-6">
                  {rightSidebar}
                </div>
              </aside>
            )}
          </div>
        </div>

      </div>

      {/* Mobile Bottom Navigation */}
      <MobileBottomNav />

      {/* ⌘K from anywhere in the app — mounted here so every authenticated
          page has it, not only the ones that remember to include it. */}
      <CommandPalette />

      {/* App-wide "What's New" — auto-opens once after a new release */}
      <WhatsNewModal />

      {/* Page tours: the "?" in the top bar, and a one-time invitation */}
      <ProductTour />
    </SidebarProvider>
  );
}