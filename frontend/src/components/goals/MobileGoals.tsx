'use client';

import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { canMoveGoalCash, goalHorizonRisk, goalProgressAmount } from '@/lib/goals/goalMoney';
import { LifeCashSummary } from '@/components/goals/LifeCashSummary';
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

// The same windows the desktop page uses, loaded only when opened.
const CreateGoalModal = dynamic(
    () => import('@/components/goals/CreateGoalModal').then((m) => ({ default: m.CreateGoalModal })),
    { ssr: false },
);
const ContributeModal = dynamic(
    () => import('@/components/goals/ContributeModal').then((m) => ({ default: m.ContributeModal })),
    { ssr: false },
);

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
    const current = goalProgressAmount(g);
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
    // Create and Reserve / Release open here; links elsewhere arrive as
    // /goals?create=1, which used to open nothing on a phone.
    const [createOpen, setCreateOpen] = useState(false);
    const [moneyGoal, setMoneyGoal] = useState<Goal | null>(null);
    const goCreate = () => setCreateOpen(true);
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        if (params.get('create') === '1') {
            setCreateOpen(true);
            params.delete('create');
            const rest = params.toString();
            router.replace(rest ? `/goals?${rest}` : '/goals');
        }
    }, [router]);
    // Same rule as the desktop card (goalMoney.ts): nothing to move on a
    // reached goal holding no cash, or an emergency fund holding none.
    const moneyButton = (g: Goal) => canMoveGoalCash(g) ? (
        <button
            type="button"
            onClick={() => setMoneyGoal(g)}
            aria-label={t('goals:reserve.mobileButtonFor', { title: g.title })}
            className="inline-flex min-h-11 items-center rounded-lg border border-primary-200 dark:border-primary-800 px-3 text-sm font-semibold text-primary-700 dark:text-primary-300 hover:bg-primary-50 dark:hover:bg-primary-900/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
        >
            {t('goals:reserve.mobileButton')}
        </button>
    ) : g.tracksEmergency ? (
        <p className="text-xs text-gray-500 dark:text-gray-400">{t('goals:reserve.tracksEmergency')}</p>
    ) : null;

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
                        className="grid place-items-center w-11 h-11 rounded-full bg-primary-700 hover:bg-primary-800 text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400">
                        <PlusIcon className="w-5 h-5" />
                    </button>
                </div>

                <BiggerScreenHint />

                {/* Life Wallet: what goals hold and what is left to spend */}
                <LifeCashSummary compact />

                {model.count === 0 ? (
                    <div className="rounded-3xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 p-8 text-center space-y-3">
                        <p className="text-4xl" aria-hidden="true">🎯</p>
                        <p className="text-sm text-gray-500 dark:text-gray-400">{t('goals:empty.title', 'No goals yet')}</p>
                        <button type="button" onClick={goCreate}
                            className="inline-flex items-center gap-1.5 rounded-xl bg-primary-700 hover:bg-primary-800 px-4 py-2.5 text-sm font-semibold text-white">
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
                                <section data-tour="goals-m-hero" className="rounded-3xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-sm p-5 flex items-center gap-5">
                                    <svg viewBox="0 0 100 100" className="w-[112px] h-[112px] flex-shrink-0 -rotate-90" aria-hidden="true">
                                        <circle cx="50" cy="50" r="42" fill="none" stroke="currentColor" strokeWidth="9" className="text-gray-100 dark:text-gray-700" />
                                        <circle cx="50" cy="50" r="42" fill="none" stroke={RING} strokeWidth="9" strokeLinecap="round"
                                            strokeDasharray={C} strokeDashoffset={C * (1 - p / 100)} />
                                    </svg>
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-1.5">
                                            <span className="text-base" aria-hidden="true">{meta.icon}</span>
                                            <p className="text-sm font-bold text-gray-500 dark:text-gray-400 truncate">{g.title}</p>
                                        </div>
                                        <p className="mt-1 text-[30px] leading-none font-extrabold tracking-tight tabular-nums text-gray-900 dark:text-white">{Math.round(p)}%</p>
                                        <p className="mt-1.5 text-[12.5px] font-semibold text-gray-500 dark:text-gray-400 tabular-nums">
                                            {isValueVisible ? formatTWD(goalProgressAmount(g)) : hidden} / {isValueVisible ? formatTWDCompact(g.targetAmount || 0) : '•••'}
                                        </p>
                                        {eta && <p className="mt-0.5 text-xs font-medium text-gray-500 dark:text-gray-400">🗓 {eta}</p>}
                                        {goalHorizonRisk(g) && (
                                            <p role="note" className="mt-1.5 text-xs font-medium text-amber-700 dark:text-amber-400">
                                                {t('goals:invest.horizonShort')}
                                            </p>
                                        )}
                                        <div className="mt-3">{moneyButton(g)}</div>
                                    </div>
                                </section>
                            );
                        })()}

                        {/* Other goals — compact cards with progress bars */}
                        {model.rest.length > 0 && (
                            <section data-tour="goals-m-list" className="space-y-2.5">
                                <p className="px-1 text-sm font-extrabold tracking-tight text-gray-900 dark:text-white">{t('goals:sections.otherGoals', 'Other goals')}</p>
                                {model.rest.map((g) => {
                                    const p = pct(g);
                                    const meta = catMeta(g.category);
                                    return (
                                        <Card key={g.id} padding="sm" shadow="none">
                                            <div className="flex items-center gap-3">
                                                <span className="grid place-items-center w-9 h-9 rounded-xl bg-gray-100 dark:bg-gray-700 text-lg flex-shrink-0" aria-hidden="true">{meta.icon}</span>
                                                <div className="min-w-0 flex-1">
                                                    <p className="text-sm font-bold text-gray-900 dark:text-white truncate">{g.title}</p>
                                                    <p className="text-xs font-medium text-gray-500 dark:text-gray-400 tabular-nums">
                                                        {isValueVisible ? formatTWDCompact(goalProgressAmount(g)) : '•••'} / {isValueVisible ? formatTWDCompact(g.targetAmount || 0) : '•••'}
                                                    </p>
                                                </div>
                                                <span className="text-base font-extrabold tabular-nums text-prosperity-700 dark:text-prosperity-400 flex-shrink-0">{Math.round(p)}%</span>
                                            </div>
                                            <div className="mt-3 h-2 rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden">
                                                <div className="h-full rounded-full transition-all" style={{ width: `${p}%`, background: RING }} />
                                            </div>
                                            {goalHorizonRisk(g) && (
                                                <p role="note" className="mt-2 text-xs font-medium text-amber-700 dark:text-amber-400">
                                                    {t('goals:invest.horizonShort')}
                                                </p>
                                            )}
                                            <div className="mt-3 flex justify-end">{moneyButton(g)}</div>
                                        </Card>
                                    );
                                })}
                            </section>
                        )}
                    </>
                )}

                <p className="text-center px-4 pt-1 text-xs font-semibold leading-relaxed text-gray-500 dark:text-gray-400">
                    {t('goals:reserve.mobileMore', 'Milestones & achievements')}
                    <br />
                    <span className="text-primary-700 dark:text-primary-400">→ {t('dashboard:mobile.onLargerScreen', 'on tablet / desktop')}</span>
                </p>
            </div>

            {createOpen && <CreateGoalModal isOpen onClose={() => setCreateOpen(false)} />}
            {moneyGoal && (
                <ContributeModal
                    isOpen
                    onClose={() => setMoneyGoal(null)}
                    goalId={moneyGoal.id}
                    goalTitle={moneyGoal.title}
                    currentAmount={Number(moneyGoal.currentAmount)}
                    targetAmount={Number(moneyGoal.targetAmount)}
                    currency={moneyGoal.currency || 'TWD'}
                    reservedAmount={Number(moneyGoal.reservedAmount ?? 0)}
                />
            )}
        </DashboardLayout>
    );
}
