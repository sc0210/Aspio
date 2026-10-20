'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useTranslation } from 'react-i18next';
import { HomeModernIcon } from '@heroicons/react/24/outline';
import { Card } from '@/components/ui/Card';
import { usePrivacy } from '@/contexts/PrivacyContext';
import { formatTWDCompact } from '@/utils/formatters';
import { cn } from '@/utils/cn';
import type { Position } from '@/lib/lifecycle';
import { homePurchaseImpact } from '@/lib/lifecycle/homePurchase';
import { projectBuyVsRent } from '@/lib/housing/buyVsRent';
import { loadScenarios, type SavedScenario } from '@/lib/housing/scenarios';

interface Props {
    position: Position;
    /** The Life wallet: what may be spent. The Emergency fund stays a reserve. */
    spendableCash: number;
    maxLeverage: number;
}

/**
 * What a home from /housing would do to the borrow-to-invest position: the
 * cash that leaves at closing comes out of cash first, then investments, and
 * either way net financial assets fall — so leverage rises.
 */
export function HomePurchasePanel({ position, spendableCash, maxLeverage }: Props) {
    const { t } = useTranslation('common');
    const { isValueVisible } = usePrivacy();
    const [scenarios, setScenarios] = useState<SavedScenario[]>([]);
    const [selected, setSelected] = useState<string | null>(null);

    // Saved on /housing in this browser; read after mount (storage differs from the server pass).
    useEffect(() => {
        const list = loadScenarios();
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setScenarios(list);
        setSelected(list[0]?.id ?? null);
    }, []);

    const scenario = scenarios.find((s) => s.id === selected) ?? null;
    const impact = useMemo(() => {
        if (!scenario) return null;
        const r = projectBuyVsRent(scenario.inputs);
        const monthlyHousingCost = r.monthlyPayment
            + (scenario.inputs.housePrice * scenario.inputs.ownershipCostPctPerYear) / 100 / 12;
        return homePurchaseImpact(position, {
            upfrontCash: r.upfrontCash,
            monthlyHousingCost,
            monthlyRent: scenario.inputs.monthlyRent,
        }, maxLeverage, spendableCash);
    }, [scenario, position, maxLeverage, spendableCash]);

    const money = (v: number) => (isValueVisible ? formatTWDCompact(v) : '•••');
    const lev = (v: number) => (Number.isFinite(v) ? `${v.toFixed(2)}×` : t('lifecycle.home.underwater', 'underwater'));

    return (
        <Card padding="md">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-1.5">
                    <HomeModernIcon className="w-4 h-4 text-indigo-500" />
                    {t('lifecycle.home.title', 'If you bought a home')}
                </h3>
                {scenarios.length > 1 && (
                    <select value={selected ?? ''} onChange={(e) => setSelected(e.target.value)}
                        aria-label={t('lifecycle.home.scenario', 'Scenario')}
                        className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-2 py-1 text-sm text-gray-900 dark:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400">
                        {scenarios.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                )}
            </div>

            {!impact ? (
                <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                    {t('lifecycle.home.none', 'Save a buy-vs-rent scenario on the house plan page (in this browser) to see what the purchase does to your leverage.')}{' '}
                    <Link href="/housing" className="font-medium text-indigo-600 dark:text-indigo-400 hover:underline">
                        {t('lifecycle.home.toHousing', 'Open the house plan')} →
                    </Link>
                </p>
            ) : (
                <>
                    <p className="mt-1 mb-4 text-sm text-gray-500 dark:text-gray-500">
                        {t('lifecycle.home.subtitle', '{{name}}: {{amount}} leaves at closing, from Life cash then investments; the Emergency fund stays a reserve. The house is not a financial asset, so net financial assets fall by all of it.', {
                            name: scenario!.name, amount: money(impact.upfrontCash),
                        })}
                    </p>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <Stat label={t('lifecycle.home.fromCash', 'From Life cash')} value={money(impact.fromCash)}
                            sub={t('lifecycle.home.cashLeft', '{{amount}} left', { amount: money(impact.cashLeft) })} />
                        {impact.shortfall > 0 ? (
                            <Stat label={t('lifecycle.home.shortfall', "Can't fund")} value={money(impact.shortfall)} tone="bad"
                                sub={t('lifecycle.home.shortfallSub', 'more than your cash and investments together')} />
                        ) : (
                            <Stat label={t('lifecycle.home.fromStock', 'Investments sold')} value={money(impact.fromStock)}
                                tone={impact.fromStock > 0 ? 'warn' : undefined} />
                        )}
                        {/* A purchase that can't be funded has no "after" to describe. */}
                        <Stat label={t('lifecycle.home.leverage', 'Leverage')}
                            value={impact.shortfall > 0 ? `${lev(impact.leverageBefore)} → —` : `${lev(impact.leverageBefore)} → ${lev(impact.leverageAfter)}`}
                            tone={impact.shortfall <= 0 && impact.exceedsMaxLeverage ? 'bad' : undefined}
                            sub={impact.shortfall <= 0 && impact.exceedsMaxLeverage ? t('lifecycle.home.overMax', 'over your {{max}}× ceiling', { max: maxLeverage }) : undefined} />
                        <Stat label={t('lifecycle.home.monthly', 'Monthly cash flow')}
                            value={`${impact.monthlyCashFlowChange > 0 ? '−' : impact.monthlyCashFlowChange < 0 ? '+' : ''}${money(Math.abs(impact.monthlyCashFlowChange))}`}
                            tone={impact.monthlyCashFlowChange > 0 ? 'warn' : undefined}
                            sub={t('lifecycle.home.monthlySub', 'mortgage and upkeep, less the rent that stops')} />
                    </div>
                </>
            )}
        </Card>
    );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'warn' | 'bad' }) {
    return (
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-3">
            <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
            <p className={cn('mt-0.5 text-base font-bold tabular-nums',
                tone === 'bad' ? 'text-error-700 dark:text-error-400'
                    : tone === 'warn' ? 'text-amber-700 dark:text-amber-400' : 'text-gray-900 dark:text-white')}>
                {value}
            </p>
            {sub && <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-500">{sub}</p>}
        </div>
    );
}
