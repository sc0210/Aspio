import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card } from '@/components/ui/Card';

/**
 * Streaming loading UI for the /review route segment.
 *
 * Mirrors the real page's shell — max-w-6xl column, header, context card, then
 * the 2/1 split of breakdowns and side cards — so the layout is already in
 * place when the content lands and nothing shifts. The page had error.tsx but
 * no loading.tsx, so navigating to it painted nothing until the chunk arrived.
 */
export default function ReviewLoading() {
    return (
        <DashboardLayout>
            <div className="max-w-6xl mx-auto space-y-5 pb-8 animate-pulse">
                {/* PageHeader */}
                <div className="space-y-2">
                    <div className="h-7 w-52 bg-gray-200 dark:bg-gray-700 rounded" />
                    <div className="h-4 w-80 max-w-full bg-gray-200 dark:bg-gray-700 rounded" />
                </div>

                {/* MonthContextCard */}
                <Card padding="none" radius="xl" shadow="none" className="h-28" />

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                    {/* Spending + income breakdowns */}
                    <div className="lg:col-span-2 space-y-5">
                        {[0, 1].map((i) => (
                            <Card key={i} padding="md" radius="xl" shadow="none" className="space-y-3">
                                <div className="h-5 w-40 bg-gray-200 dark:bg-gray-700 rounded" />
                                {[0, 1, 2, 3].map((row) => (
                                    <div key={row} className="flex items-center gap-3">
                                        <div className="h-3 w-24 bg-gray-200 dark:bg-gray-700 rounded" />
                                        <div className="h-2 flex-1 bg-gray-200 dark:bg-gray-700 rounded-full" />
                                        <div className="h-3 w-20 bg-gray-200 dark:bg-gray-700 rounded" />
                                    </div>
                                ))}
                            </Card>
                        ))}
                    </div>

                    {/* Wealth move + goals today */}
                    <div className="space-y-5">
                        <Card padding="none" radius="xl" shadow="none" className="h-56" />
                        <Card padding="none" radius="xl" shadow="none" className="h-44" />
                    </div>
                </div>
            </div>
        </DashboardLayout>
    );
}
