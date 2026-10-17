'use client';

import { useTranslation } from 'react-i18next';
import { ArrowLeftIcon } from '@heroicons/react/24/outline';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { BiggerScreenHint } from '@/components/dashboard/BiggerScreenHint';
import { usePrivacy } from '@/contexts/PrivacyContext';
import type { AssetAllocation, RebalancingAction } from '@/services/rebalancingService';
import { formatCurrency } from '@/utils/formatters';

import { isNearTarget, isOffTarget } from '@/lib/portfolio/rebalanceThreshold';

function fmt(value: number) {
    return formatCurrency(value, 'TWD', value >= 100000 ? { compact: true } : { precision: 0 });
}

/** "0050 (Yuanta Taiwan 50)" → ["0050", "Yuanta Taiwan 50"]. */
function splitLabel(asset: string): [string, string | null] {
    const m = asset.match(/^(.*?)\s*\((.*)\)\s*$/);
    return m ? [m[1], m[2]] : [asset, null];
}

function driftTone(points: number) {
    if (isOffTarget(points)) return { bar: 'bg-rose-500', text: 'text-rose-600 dark:text-rose-400' };
    if (isNearTarget(points)) return { bar: 'bg-amber-500', text: 'text-amber-600 dark:text-amber-400' };
    return { bar: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400' };
}

/** Only what this view reads, so the demo fixtures (no assetName) fit too. */
type Allocation = Pick<AssetAllocation, 'asset' | 'currentPct' | 'targetPct' | 'currentValue'>;
type Action = Pick<RebalancingAction, 'asset' | 'action' | 'amount' | 'shares' | 'currentPrice'>;

interface MobileRebalancingProps {
    allocations: Allocation[];
    actions: Action[];
    onBack: () => void;
}

/**
 * Phones get one question answered: is my portfolio where I want it, and if not,
 * what do I trade? A drift bar per asset (current fill, target tick) replaces the
 * donut and the seven-column table; the trades follow. Editing targets, the FX
 * tracker and the What-If simulator stay on the full page.
 */
export function MobileRebalancing({ allocations, actions, onBack }: MobileRebalancingProps) {
    const { t } = useTranslation(['dashboard', 'common']);
    const { isValueVisible } = usePrivacy();
    const hide = (s: string) => (isValueVisible ? s : '••••');

    const cur = (a: Allocation) => a.currentPct || 0;
    const tgt = (a: Allocation) => a.targetPct || 0;
    const drift = (a: Allocation) => cur(a) - tgt(a);
    const offTarget = allocations.filter((a) => isOffTarget(Math.abs(drift(a))));
    // Scale every bar to the largest share on the page, so 60% vs 10% reads at a glance.
    const scale = Math.max(1, ...allocations.map((a) => Math.max(cur(a), tgt(a)))) * 1.1;
    const sorted = [...allocations].sort((a, b) => Math.abs(drift(b)) - Math.abs(drift(a)));
    const trades = [...actions].sort((a, b) => (a.action === b.action ? b.amount - a.amount : a.action === 'SELL' ? -1 : 1));
    // What the trades below actually move: the larger of the two sides, so a plan
    // funded partly by idle cash (buys > sells) still shows its full size.
    const sum = (side: 'BUY' | 'SELL') => trades.filter((a) => a.action === side).reduce((s, a) => s + (a.amount || 0), 0);
    const toMove = Math.max(sum('SELL'), sum('BUY'));

    return (
        <DashboardLayout>
            <div className="max-w-md mx-auto space-y-4 pb-4">
                <div className="flex items-center gap-2 pt-1">
                    <button type="button" onClick={onBack} aria-label={t('rebalancing.page.back')}
                        className="grid place-items-center w-11 h-11 -ml-2 rounded-full text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400">
                        <ArrowLeftIcon className="w-5 h-5" />
                    </button>
                    <h1 className="text-xl font-extrabold tracking-tight text-gray-900 dark:text-white">{t('rebalancing.page.title')}</h1>
                </div>

                <BiggerScreenHint />

                {/* HERO — on target or not, and how much has to move */}
                <section className="rounded-3xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-sm p-5">
                    {allocations.length === 0 ? (
                        <>
                            <p className="text-[13px] font-bold text-gray-500 dark:text-gray-400">{t('allocation.title')}</p>
                            <p className="mt-2 text-[13px] text-gray-500 dark:text-gray-400">
                                {t('mobile.rebalance.noTargets', 'No target allocation yet. Set your targets on a tablet or desktop.')}
                            </p>
                        </>
                    ) : offTarget.length > 0 ? (
                        <>
                            <p className="text-[13px] font-bold text-rose-600 dark:text-rose-400">⚠️ {t('allocation.needsRebalancing')}</p>
                            <p className="mt-1 text-[32px] leading-none font-extrabold tracking-tight text-gray-900 dark:text-white">
                                {t('mobile.rebalance.offTarget', { count: offTarget.length, defaultValue: '{{count}} off target' })}
                            </p>
                            <p className="mt-2 text-[12.5px] font-semibold text-gray-500 dark:text-gray-400">
                                {t('allocation.overThreshold')}
                            </p>
                            {toMove > 0 && (
                                <div className="mt-4 rounded-2xl bg-gray-50 dark:bg-gray-900/40 px-4 py-3 flex items-center justify-between">
                                    <span className="text-[12.5px] font-bold text-gray-600 dark:text-gray-300">
                                        {t('mobile.rebalance.toMove', 'To move')}
                                    </span>
                                    <span className="text-[17px] font-extrabold tabular-nums text-gray-900 dark:text-white">
                                        {hide(fmt(toMove))}
                                    </span>
                                </div>
                            )}
                        </>
                    ) : (
                        <>
                            <p className="text-[13px] font-bold text-emerald-600 dark:text-emerald-400">✓ {t('rebalancing.balanced.title')}</p>
                            <p className="mt-2 text-[13px] text-gray-500 dark:text-gray-400">{t('rebalancing.balanced.description')}</p>
                        </>
                    )}
                </section>

                {/* Drift per asset: bar = current share, tick = target */}
                {allocations.length > 0 && <section className="rounded-3xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-sm p-5">
                    <div className="flex items-baseline justify-between">
                        <h2 className="text-[15px] font-extrabold text-gray-900 dark:text-white">{t('allocation.title')}</h2>
                        <span className="text-[11.5px] font-semibold text-gray-400 dark:text-gray-500">
                            {t('mobile.rebalance.legend', 'Bar = now · Line = target')}
                        </span>
                    </div>
                    <ul className="mt-3 space-y-4">
                        {sorted.map((a) => {
                            const d = drift(a);
                            const tone = driftTone(Math.abs(d));
                            const [code, name] = splitLabel(a.asset);
                            return (
                                <li key={a.asset}>
                                    <div className="flex items-baseline justify-between gap-3">
                                        <p className="min-w-0 truncate text-[14px] font-bold text-gray-900 dark:text-white">
                                            {code}
                                            {name && <span className="ml-1.5 text-[12px] font-semibold text-gray-400 dark:text-gray-500">{name}</span>}
                                        </p>
                                        <span className={`shrink-0 text-[12.5px] font-extrabold tabular-nums ${tone.text}`}>
                                            {d > 0 ? '+' : ''}{d.toFixed(1)} {t('mobile.rebalance.points', 'pp')}
                                        </span>
                                    </div>
                                    <div className="relative mt-1.5 h-2.5 rounded-full bg-gray-100 dark:bg-gray-700" role="img"
                                        aria-label={t('mobile.rebalance.barLabel', {
                                            current: cur(a).toFixed(1), target: tgt(a).toFixed(1),
                                            defaultValue: 'Now {{current}}%, target {{target}}%',
                                        })}>
                                        <div className={`absolute inset-y-0 left-0 rounded-full ${tone.bar}`}
                                            style={{ width: `${Math.min(100, (cur(a) / scale) * 100)}%` }} />
                                        <div className="absolute -top-1 -bottom-1 w-0.5 rounded bg-gray-900 dark:bg-white"
                                            style={{ left: `${Math.min(100, (tgt(a) / scale) * 100)}%` }} />
                                    </div>
                                    <div className="mt-1 flex justify-between text-[11.5px] font-semibold tabular-nums text-gray-500 dark:text-gray-400">
                                        <span>{cur(a).toFixed(1)}% · {hide(fmt(a.currentValue || 0))}</span>
                                        <span>{t('mobile.rebalance.target', { pct: tgt(a).toFixed(1), defaultValue: 'Target {{pct}}%' })}</span>
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                </section>}

                {/* The trades that close the gap: sells first, they fund the buys */}
                {trades.length > 0 && (
                    <section className="rounded-3xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-sm p-5">
                        <h2 className="text-[15px] font-extrabold text-gray-900 dark:text-white">{t('mobile.rebalance.trades', 'Suggested trades')}</h2>
                        <ul className="mt-2 divide-y divide-gray-100 dark:divide-gray-700">
                            {trades.map((a) => {
                                const sell = a.action === 'SELL';
                                const [code] = splitLabel(a.asset);
                                return (
                                    <li key={`${a.action}-${a.asset}`} className="flex items-center gap-3 py-3">
                                        <span className={`shrink-0 rounded-lg px-2 py-1 text-[11.5px] font-extrabold ${sell
                                            ? 'bg-rose-50 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300'
                                            : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'}`}>
                                            {sell ? t('allocation.action.sell') : t('allocation.action.buy')}
                                        </span>
                                        <div className="min-w-0 flex-1">
                                            <p className="truncate text-[14px] font-bold text-gray-900 dark:text-white">{code}</p>
                                            {/* Hidden with the amount: shares × price gives it back.
                                                Formatted as RebalancingPlanCard does on desktop. */}
                                            {isValueVisible && a.shares != null && a.shares > 0 && a.currentPrice != null && a.currentPrice > 0 ? (
                                                <p className="text-[11.5px] font-semibold text-gray-500 dark:text-gray-400 tabular-nums">
                                                    {t('rebalancing.plan.shareEstimate', {
                                                        shares: a.shares.toFixed(0),
                                                        price: fmt(a.currentPrice),
                                                    })}
                                                </p>
                                            ) : null}
                                        </div>
                                        <span className="shrink-0 text-[15px] font-extrabold tabular-nums text-gray-900 dark:text-white">
                                            {hide(fmt(a.amount))}
                                        </span>
                                    </li>
                                );
                            })}
                        </ul>
                    </section>
                )}

                <p className="text-center px-4 pt-1 text-xs font-semibold leading-relaxed text-gray-400 dark:text-gray-500">
                    {t('mobile.fullRebalancing', 'Edit targets, FX tracker & What-If')}
                    <br />
                    <span className="text-primary-600 dark:text-primary-400">→ {t('mobile.onLargerScreen', 'on tablet / desktop')}</span>
                </p>
            </div>
        </DashboardLayout>
    );
}
