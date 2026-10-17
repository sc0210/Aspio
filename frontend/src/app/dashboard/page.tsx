'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthContext } from '@/contexts/AuthContext';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { ComprehensiveDashboard } from '@/components/dashboard/ComprehensiveDashboard';
import { MobileDashboard } from '@/components/dashboard/MobileDashboard';
import { CompactDashboard } from '@/components/dashboard/CompactDashboard';
import { useIsMobile } from '@/hooks/useMediaQuery';
import { useDashboardViewMode } from '@/hooks/useDashboardViewMode';

/**
 * Dashboard Page
 *
 * Phones (< md) always render the focused, glanceable MobileDashboard. On
 * tablet/desktop the user chooses between a "compact" focus view (CompactDashboard)
 * and the "full" power dashboard (ComprehensiveDashboard) via a top-bar toggle;
 * the choice persists. Only one mounts, so the heavy full-dashboard widgets never
 * load in compact or mobile mode.
 *
 * Access modes: Authenticated · Demo (sample data). Redirects to sign-in when
 * the auth check completes with no access.
 */
export default function DashboardPage() {
    const { isAuthenticated, isDemo, status } = useAuthContext();
    const router = useRouter();

    const isLoading = status === 'loading';
    const isMobile = useIsMobile(); // null until the breakpoint resolves (post-mount)
    const [viewMode] = useDashboardViewMode(); // null until the preference resolves
    const hasAccess = isAuthenticated || isDemo;

    useEffect(() => {
        if (!isLoading && !hasAccess) {
            router.replace('/auth/signin');
        }
    }, [isLoading, hasAccess, router]);

    // Wait for the auth check, the breakpoint, AND (on desktop) the view preference
    // before committing to a layout — avoids a flash of the wrong view.
    if (isLoading || isMobile === null || (!isMobile && viewMode === null)) {
        return (
            <div
                className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900"
                role="status"
                aria-label="Loading dashboard"
            >
                <LoadingSpinner size="lg" />
            </div>
        );
    }

    if (!hasAccess) {
        return null;
    }

    if (isMobile) return <MobileDashboard />;
    return viewMode === 'compact' ? <CompactDashboard /> : <ComprehensiveDashboard />;
}
