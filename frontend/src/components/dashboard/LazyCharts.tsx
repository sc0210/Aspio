'use client';

/**
 * Lazy-loaded chart components for better performance
 *
 * recharts is ~386KB and should only be loaded when charts are visible.
 * This file exports dynamically imported versions of chart components.
 */

import dynamic from 'next/dynamic';
// Loading skeleton for charts
const ChartSkeleton = ({ height = 300 }: { height?: number }) => (
    <div
        className="animate-pulse bg-gray-200 dark:bg-gray-700 rounded-lg"
        style={{ height }}
        role="status"
        aria-label="Loading chart"
    >
        <div className="flex items-center justify-center h-full">
            <svg className="w-8 h-8 text-gray-300 dark:text-gray-600" fill="none" viewBox="0 0 24 24">
                <path
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M3 15l4-4 4 4 4-8 4 4"
                />
            </svg>
        </div>
    </div>
);

// Lazy load PortfolioOverview (uses recharts PieChart)
export const LazyPortfolioOverview = dynamic(
    () => import('./PortfolioOverview').then(mod => ({ default: mod.PortfolioOverview })),
    {
        loading: () => <ChartSkeleton height={300} />,
        ssr: false
    }
);
