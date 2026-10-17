'use client';

import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslation } from 'react-i18next';
import { PlusIcon } from '@heroicons/react/24/outline';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { BiggerScreenHint } from '@/components/dashboard/BiggerScreenHint';
import { useGoals, type Goal } from '@/hooks/useGoals';
import { usePortfolio } from '@/hooks/usePortfolio';
import { selectPrimaryGoal } from '@/hooks/useDashboardSummary';
import { usePrivacy } from '@/contexts/PrivacyContext';
import { GOAL_CATEGORIES } from '@/utils/constants';
import { formatTWD, formatTWDCompact } from '@/utils/formatters';
import { Card } from '@/components/ui/Card';

const RING = '#10b981';

function catMeta(category: string) {
    const m = GOAL_CATEGORIES.find((c) => c.id === category);
    return { icon: m?.icon ?? '🎯', name: m?.name ?? category };
}
function pct(g: Goal) {
    // Derive from the amounts first. The backend's progressPercentage is computed
    // from the stored current_amount, which is always 0 for a retirement goal — so
    // preferring it would discard the portfolio override applied upstream and put
    // the ring back at 0%.
    const target = Number(g.targetAmount) || 0;
    const current = Number(g.currentAmount) || 0;
    if (target > 0) return Math.min(100, Math.max(0, (current / target) * 100));
    if (typeof g.progressPercentage === 'number') return Math.min(100, Math.max(0, g.progressPercentage));
    return 0;
}

export function MobileGoals() {
    const { t, i18n } = useTranslation(['goals', 'dashboard', 'common']);
    const { data: goals = [], isLoading } = useGoals();
    // Retirement progress comes from the portfolio, so this view needs it too.
    const { portfolio } = usePortfolio();
    const portfolioTotalValue: number =
        (portfolio as { totalValue?: number } | undefined)?.totalValue ??
        (portfolio as { data?: { totalValue?: number } } | undefined)?.data?.totalValue ??
        0;
    const { isValueVisible } = usePrivacy();
    const router = useRouter();
    // The full desktop page owns the create modal (heavy form deps); on mobile we
    // route there with ?create=1 to keep this view lean.
    const goCreate = () => router.push('/goals?create=1');

    const model = useMemo(() => {
        const active = goals.filter((g) => g.status === 'active');
        const list = active.length ? active : goals;
        // Reuse the shared selector rather than picking the largest target inline.
        // It does two things this view was missing: a retirement goal shows the
        // portfolio as its progress (nothing is ever deposited into one, so it read
        // NT$0), and targets are compared numerically — the backend sends Decimal as
        // strings, and "600000" > "1000000" is true for strings, so the inline
        // reduce could feature the wrong goal.
        const { primaryGoal: primary } = selectPrimaryGoal(list, portfolioTotalValue);
        const rest = primary ? list.filter((g) => g.id !== primary.id) : list;
        return { primary, rest, count: list.length };
    }, [goals, portfolioTotalValue]);

    if (isLoading && goals.length === 0) {
        return (
            <DashboardLayout>
                <div className="flex items-center justify-center py-24"><LoadingSpinner size="lg" /></div>
            </DashboardLayout>
        );
    }

    const hidden = '••••';
    const C = 2 * Math.PI * 42; // ring circumference for r=42

    const etaText = (g: Goal) => {
        if (!g.targetDate) return null;
        const d = new Date(g.targetDate);
        if (!Number.isFinite(d.getTime())) return null;
        return d.toLocaleDateString(i18n.language, { year: 'numeric', month: 'short' });
    };

    return (
        <DashboardLayout>
            <div className="max-w-md mx-auto space-y-4 pb-4">
                <div className="flex items-center justify-between pt-1">
                    <h1 className="text-xl font-extrabold tracking-tight text-gray-900 dark:text-white">{t('goals:title', 'Goals')}</h1>
                    <button type="button" onClick={goCreate} aria-label={t('goals:create', 'New goal')}
                        className="grid place-items-center w-11 h-11 rounded-full bg-primary-600 hover:bg-primary-700 text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400">
                        <PlusIcon className="w-5 h-5" />
                    </button>
                </div>

                <BiggerScreenHint />

                {model.count === 0 ? (
                    <div className="rounded-3xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 p-8 text-center space-y-3">
                        <p className="text-4xl" aria-hidden="true">🎯</p>
                        <p className="text-sm text-gray-500 dark:text-gray-400">{t('goals:empty.title', 'No goals yet')}</p>
                        <button type="button" onClick={goCreate}
                            className="inline-flex items-center gap-1.5 rounded-xl bg-primary-600 hover:bg-primary-700 px-4 py-2.5 text-sm font-semibold text-white">
                            <PlusIcon className="w-4 h-4" /> {t('goals:createFirst', 'Create your first goal')}
                        </button>
                    </div>
                ) : (
                    <>
                        {/* HERO — primary goal ring */}
                        {model.primary && (() => {
                            const g = model.primary;
                            const p = pct(g);
                            const meta = catMeta(g.category);
                            const eta = etaText(g);
                            return (
                                <section className="rounded-3xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-sm p-5 flex items-center gap-5">
                                    <svg viewBox="0 0 100 100" className="w-[112px] h-[112px] flex-shrink-0 -rotate-90" aria-hidden="true">
                                        <circle cx="50" cy="50" r="42" fill="none" stroke="currentColor" strokeWidth="9" className="text-gray-100 dark:text-gray-700" />
                                        <circle cx="50" cy="50" r="42" fill="none" stroke={RING} strokeWidth="9" strokeLinecap="round"
                                            strokeDasharray={C} strokeDashoffset={C * (1 - p / 100)} />
                                    </svg>
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-1.5">
                                            <span className="text-base" aria-hidden="true">{meta.icon}</span>
                                            <p className="text-[13px] font-bold text-gray-500 dark:text-gray-400 truncate">{g.title}</p>
                                        </div>
                                        <p className="mt-1 text-[30px] leading-none font-extrabold tracking-tight tabular-nums text-gray-900 dark:text-white">{Math.round(p)}%</p>
                                        <p className="mt-1.5 text-[12.5px] font-semibold text-gray-500 dark:text-gray-400 tabular-nums">
                                            {isValueVisible ? formatTWD(g.currentAmount || 0) : hidden} / {isValueVisible ? formatTWDCompact(g.targetAmount || 0) : '•••'}
                                        </p>
                                        {eta && <p className="mt-0.5 text-[11.5px] font-medium text-gray-400 dark:text-gray-500">🗓 {eta}</p>}
                                    </div>
                                </section>
                            );
                        })()}

                        {/* Other goals — compact cards with progress bars */}
                        {model.rest.length > 0 && (
                            <section className="space-y-2.5">
                                <p className="px-1 text-[13px] font-extrabold tracking-tight text-gray-900 dark:text-white">{t('goals:sections.otherGoals', 'Other goals')}</p>
                                {model.rest.map((g) => {
                                    const p = pct(g);
                                    const meta = catMeta(g.category);
                                    return (
                                        <Card key={g.id} padding="sm" shadow="none">
                                            <div className="flex items-center gap-3">
                                                <span className="grid place-items-center w-9 h-9 rounded-xl bg-gray-100 dark:bg-gray-700 text-[17px] flex-shrink-0" aria-hidden="true">{meta.icon}</span>
                                                <div className="min-w-0 flex-1">
                                                    <p className="text-sm font-bold text-gray-900 dark:text-white truncate">{g.title}</p>
                                                    <p className="text-[11.5px] font-medium text-gray-400 dark:text-gray-500 tabular-nums">
                                                        {isValueVisible ? formatTWDCompact(g.currentAmount || 0) : '•••'} / {isValueVisible ? formatTWDCompact(g.targetAmount || 0) : '•••'}
                                                    </p>
                                                </div>
                                                <span className="text-[15px] font-extrabold tabular-nums text-prosperity-600 dark:text-prosperity-400 flex-shrink-0">{Math.round(p)}%</span>
                                            </div>
                                            <div className="mt-3 h-2 rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden">
                                                <div className="h-full rounded-full transition-all" style={{ width: `${p}%`, background: RING }} />
                                            </div>
                                        </Card>
                                    );
                                })}
                            </section>
                        )}
                    </>
                )}

                <p className="text-center px-4 pt-1 text-xs font-semibold leading-relaxed text-gray-400 dark:text-gray-500">
                    {t('dashboard:mobile.fullGoals', 'Milestones, contributions & achievements')}
                    <br />
                    <span className="text-primary-600 dark:text-primary-400">→ {t('dashboard:mobile.onLargerScreen', 'on tablet / desktop')}</span>
                </p>
            </div>

        </DashboardLayout>
    );
}
