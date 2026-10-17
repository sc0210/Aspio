import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card } from '@/components/ui/Card';

/**
 * Streaming loading UI for the /housing route segment.
 *
 * Mirrors the stack the page renders — affordability, readiness scorecard, car
 * impact, the buy-vs-rent simulator and the principles panel — so the column
 * height is right before the content arrives. The page had error.tsx but no
 * loading.tsx.
 */
export default function HousingLoading() {
    return (
        <DashboardLayout>
            <div className="max-w-6xl mx-auto space-y-5 pb-8 animate-pulse">
                {/* PageHeader */}
                <div className="space-y-2">
                    <div className="h-7 w-72 max-w-full bg-gray-200 dark:bg-gray-700 rounded" />
                    <div className="h-4 w-96 max-w-full bg-gray-200 dark:bg-gray-700 rounded" />
                </div>

                {/* AffordabilityPanel */}
                <Card padding="none" radius="xl" shadow="none" className="h-44" />
                {/* ReadinessScorecard — four conditions */}
                <Card padding="md" radius="xl" shadow="none" className="space-y-3">
                    <div className="h-5 w-44 bg-gray-200 dark:bg-gray-700 rounded" />
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {[0, 1, 2, 3].map((i) => (
                            <div key={i} className="h-16 bg-gray-100 dark:bg-gray-700/50 rounded-lg" />
                        ))}
                    </div>
                </Card>
                {/* CarImpactPanel */}
                <Card padding="none" radius="xl" shadow="none" className="h-40" />
                {/* BuyVsRentSimulator — inputs beside a chart */}
                <Card padding="none" radius="xl" shadow="none" className="h-96" />
                {/* HousingPrinciples */}
                <Card padding="none" radius="xl" shadow="none" className="h-32" />
            </div>
        </DashboardLayout>
    );
}
