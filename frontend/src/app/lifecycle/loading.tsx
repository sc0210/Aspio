import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card } from '@/components/ui/Card';

/**
 * Streaming loading UI for the /lifecycle route segment.
 *
 * Mirrors the panel stack the page renders — position header, leverage history,
 * safety, glidepath, spread, the loan picker and the principles panel — so the
 * column is the right height before the content lands. The page had error.tsx
 * but no loading.tsx.
 */
export default function LifecycleLoading() {
    return (
        <DashboardLayout>
            <div className="max-w-6xl mx-auto space-y-5 pb-8 animate-pulse">
                {/* PageHeader */}
                <div className="space-y-2">
                    <div className="h-7 w-64 max-w-full bg-gray-200 dark:bg-gray-700 rounded" />
                    <div className="h-4 w-96 max-w-full bg-gray-200 dark:bg-gray-700 rounded" />
                </div>

                {/* PositionHeader — the headline leverage figures */}
                <Card padding="md" radius="xl" shadow="none">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        {[0, 1, 2, 3].map((i) => (
                            <div key={i} className="space-y-2">
                                <div className="h-3 w-20 bg-gray-200 dark:bg-gray-700 rounded" />
                                <div className="h-6 w-24 bg-gray-200 dark:bg-gray-700 rounded" />
                            </div>
                        ))}
                    </div>
                </Card>

                {/* LeverageHistoryPanel — a chart */}
                <Card padding="none" radius="xl" shadow="none" className="h-72" />
                {/* SafetyPanel */}
                <Card padding="none" radius="xl" shadow="none" className="h-44" />
                {/* GlidepathPanel */}
                <Card padding="none" radius="xl" shadow="none" className="h-64" />
                {/* SpreadPanel */}
                <Card padding="none" radius="xl" shadow="none" className="h-40" />
                {/* InvestmentLoanPicker */}
                <Card padding="none" radius="xl" shadow="none" className="h-36" />
                {/* LifecyclePrinciples */}
                <Card padding="none" radius="xl" shadow="none" className="h-32" />
            </div>
        </DashboardLayout>
    );
}
