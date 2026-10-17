'use client';

import { useState, useEffect, ReactNode } from 'react';
import Link from 'next/link';
import { MenuIcon } from '@/components/ui/OptimizedIcons';
import { NotificationBell } from '@/components/notifications/NotificationBell';
import { WhatsNewModal } from '@/components/whatsnew/WhatsNewModal';
import { WhatsNewButton } from '@/components/whatsnew/WhatsNewButton';
import { DashboardSidebar } from './DashboardSidebar';
import { MobileBottomNav } from './MobileBottomNav';
import { CommandPalette } from './CommandPalette';
import { PageTitle } from './PageTitle';
import { cn } from '@/utils/cn';
import { SidebarProvider } from '@/contexts/SidebarContext';

interface DashboardLayoutProps {
  children: ReactNode;
  rightSidebar?: ReactNode;
  topBarActions?: ReactNode;
}

export function DashboardLayout({ children, rightSidebar, topBarActions }: DashboardLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // Default collapsed state based on screen size
  // Tablet (md-lg): collapsed by default
  // Desktop (lg+): expanded by default
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
          open={sidebarOpen}
          collapsed={isMounted ? sidebarCollapsed : true}
          onToggleCollapsed={handleToggleCollapsed}
          onClose={() => setSidebarOpen(false)}
        />

        {/* Main Content Area */}
        <div
          className={cn(
            'flex-1 flex flex-col overflow-hidden transition-all duration-300',
            isMounted ? (sidebarCollapsed ? 'md:ml-14' : 'md:ml-64') : 'md:ml-14'
          )}
        >
          {/* Mobile Header Bar */}
          <div className="md:hidden bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between px-4 py-3">
            <button
              onClick={() => setSidebarOpen(true)}
              aria-label="Open navigation menu"
              className="p-2 rounded-lg text-gray-500 hover:text-gray-700 hover:bg-gray-100 dark:text-gray-400 dark:hover:text-gray-200 dark:hover:bg-gray-700 transition-colors min-w-[48px] min-h-[48px] flex items-center justify-center"
            >
              <MenuIcon className="w-6 h-6" />
            </button>

            <Link href="/dashboard" className="flex items-center space-x-2 min-h-[44px] sm:min-h-0 hover:opacity-80 transition-opacity">
              <div className="w-8 h-8 bg-gradient-to-br from-primary-600 to-primary-500 rounded-lg flex items-center justify-center">
                <span className="text-white font-bold text-lg">A</span>
              </div>
              <span className="text-xl font-bold text-gray-900 dark:text-white">Aspiro</span>
            </Link>

            <div className="flex items-center gap-1">
              <WhatsNewButton />
              <NotificationBell />
            </div>
          </div>

          {/* Desktop top bar */}
          <div className="hidden md:flex items-center px-6 py-3 min-h-[52px] border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
            <PageTitle />
            <div className="flex-1" />
            {topBarActions && (
              <div className="flex items-center gap-2 mr-3">{topBarActions}</div>
            )}
            <div className="flex items-center gap-1">
              <WhatsNewButton />
              <NotificationBell />
            </div>
          </div>

          {/* Main Dashboard Content */}
          <div className="flex-1 flex overflow-hidden">
            {/* Primary Content */}
            <main
              id="main-content"
              tabIndex={-1}
              className="flex-1 overflow-y-auto p-3 pb-[calc(5.5rem+env(safe-area-inset-bottom,0px))] sm:p-4 sm:pb-4 lg:p-6 focus:outline-none"
            >
              <div className="max-w-[1600px] mx-auto">
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

        {/* Mobile Sidebar Overlay */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 bg-gray-600 bg-opacity-50 z-20 md:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}
      </div>

      {/* Mobile Bottom Navigation */}
      <MobileBottomNav />

      {/* ⌘K from anywhere in the app — mounted here so every authenticated
          page has it, not only the ones that remember to include it. */}
      <CommandPalette />

      {/* App-wide "What's New" — auto-opens once after a new release */}
      <WhatsNewModal />
    </SidebarProvider>
  );
}