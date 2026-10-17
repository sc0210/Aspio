'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useTranslation } from 'react-i18next';
import { ChevronRightIcon, UserGroupIcon } from '@heroicons/react/24/outline';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { Card } from '@/components/ui/Card';
import { usePrivacy } from '@/contexts/PrivacyContext';
import { useAppMode } from '@/hooks/useAppMode';
import { apiClient } from '@/lib/api-client';
import { groupsPosition, type GroupPositionInput, type GroupBalanceEdge } from '@/lib/groups/position';
import { formatCurrency } from '@/utils/formatters';
import {
    DEMO_GROUP_SELF_ID,
    demoGroupBalances,
    demoGroups,
    demoLineLinkStatus,
} from '@/data/demoData';

type LinkStatus = { linked: boolean; display_name?: string };
type Group = { id: string; name: string | null; currency: string; member_count: number };
type GroupBalances = { balances: GroupBalanceEdge[]; member_names: Record<string, string> };

function fmt(amount: number, currency: string) {
    return formatCurrency(Math.abs(amount), currency, { precision: 0 });
}

/** How many counterparties a group row names before collapsing to "+N more". */
const ROW_NAMES = 2;

/**
 * LINE groups on a phone (#344): one question answered first — across every
 * group, am I owed or do I owe? Then each group with your share of it; tapping
 * one opens the group, where expenses are added and debts settled.
 */
export function MobileGroups() {
    const { t } = useTranslation('groups');
    const { isDemo, user, isLoading: authLoading } = useAppMode();
    const { isValueVisible } = usePrivacy();
    const [linked, setLinked] = useState<boolean | null>(null);
    const [inputs, setInputs] = useState<GroupPositionInput[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(false);
    const [reloadKey, setReloadKey] = useState(0);

    // Group members are keyed by Aspiro user id, so "you" is the session's id.
    const selfId = isDemo ? DEMO_GROUP_SELF_ID : (user?.id ?? '');

    useEffect(() => {
        if (isDemo) {
            setLinked(demoLineLinkStatus.linked);
            setInputs(
                demoGroups.map((g) => ({
                    id: g.id,
                    name: g.name,
                    currency: g.currency,
                    balances: demoGroupBalances[g.id]?.balances ?? [],
                    member_names: demoGroupBalances[g.id]?.member_names ?? {},
                })),
            );
            setLoading(false);
            return;
        }

        let cancelled = false;
        setLoadError(false);
        setLoading(true);
        (async () => {
            try {
                const status = (await apiClient.get<LinkStatus>('/line-bot/link-status')).data;
                if (cancelled) return;
                setLinked(!!status?.linked);
                if (!status?.linked) return;
                const groups = (await apiClient.get<Group[]>('/line-bot/groups')).data ?? [];
                // One balances call per group — people are in a handful of groups,
                // and the hero needs every one of them to be right.
                const balances = await Promise.all(
                    groups.map((g) =>
                        apiClient
                            .get<GroupBalances>(`/line-bot/groups/${g.id}/balances`)
                            .then((r) => r.data ?? null)
                            .catch(() => null),
                    ),
                );
                if (cancelled) return;
                setInputs(
                    groups.map((g, i) => ({
                        id: g.id,
                        name: g.name,
                        currency: g.currency,
                        balances: balances[i]?.balances ?? [],
                        member_names: balances[i]?.member_names ?? {},
                        // Unknown, not zero: a failed call must never read as "settled".
                        failed: balances[i] === null,
                    })),
                );
            } catch {
                // Unknown, not "not linked": a blip must not tell a linked user to link.
                if (!cancelled) setLoadError(true);
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [isDemo, reloadKey]);

    const position = useMemo(() => groupsPosition(inputs, selfId), [inputs, selfId]);
    const hide = (s: string) => (isValueVisible ? s : '••••');

    return (
        <DashboardLayout>
            <div className="max-w-md mx-auto space-y-4 pb-4">
                <h1 className="pt-1 text-xl font-extrabold tracking-tight text-gray-900 dark:text-white">{t('title')}</h1>

                {loading || authLoading ? (
                    <div className="flex items-center justify-center py-24"><LoadingSpinner /></div>
                ) : loadError || (!isDemo && !selfId) ? (
                    <div className="rounded-3xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 p-8 text-center">
                        <p className="text-sm font-semibold text-amber-700 dark:text-amber-300">⚠ {t('errors.generic')}</p>
                        {loadError && (
                            <button type="button" onClick={() => setReloadKey((k) => k + 1)}
                                className="mt-3 min-h-[44px] rounded-xl border border-gray-300 dark:border-gray-600 px-4 text-sm font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-400">
                                {t('mobile.retry')}
                            </button>
                        )}
                    </div>
                ) : !linked ? (
                    <div className="rounded-3xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 p-8 text-center space-y-3">
                        <p className="font-bold text-gray-900 dark:text-white">{t('notLinked.title')}</p>
                        <p className="text-sm text-gray-500 dark:text-gray-400">{t('notLinked.description')}</p>
                        <Link href="/link-line"
                            className="inline-flex items-center justify-center min-h-[44px] rounded-xl bg-[#06C755] hover:bg-[#05b34d] px-4 text-sm font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-400">
                            {t('notLinked.button')}
                        </Link>
                    </div>
                ) : inputs.length === 0 ? (
                    <div className="rounded-3xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 p-8 text-center space-y-2">
                        <UserGroupIcon className="w-8 h-8 mx-auto text-gray-400" />
                        <p className="font-bold text-gray-900 dark:text-white">{t('noGroups.title')}</p>
                        <p className="text-sm text-gray-500 dark:text-gray-400">{t('noGroups.description', { command: '/link' })}</p>
                    </div>
                ) : (
                    <>
                        {/* HERO — net across every group, per currency */}
                        <section className="rounded-3xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-sm p-5">
                            <p className="text-[13px] font-bold text-gray-500 dark:text-gray-400">{t('mobile.position')}</p>
                            {position.failedCount > 0 && (
                                <p className="mt-1 text-[12px] font-semibold text-amber-700 dark:text-amber-300">
                                    ⚠ {t('mobile.failedCaveat', { count: position.failedCount })}
                                </p>
                            )}
                            {position.totals.length === 0 ? (
                                position.failedCount > 0 ? null : (
                                <p className="mt-2 text-[22px] font-extrabold tracking-tight text-green-600 dark:text-green-400">
                                    ✓ {t('mobile.allSquare')}
                                </p>
                                )
                            ) : (
                                position.totals.map((tot, i) => (
                                    <div key={tot.currency} className={i > 0 ? 'mt-4 pt-4 border-t border-gray-100 dark:border-gray-700' : 'mt-1'}>
                                        <p className={`text-[32px] leading-none font-extrabold tracking-tight tabular-nums ${
                                            tot.net > 0 ? 'text-green-600 dark:text-green-400'
                                                : tot.net < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-gray-900 dark:text-white'}`}>
                                            {tot.net > 0 ? '+' : tot.net < 0 ? '−' : ''}{hide(fmt(tot.net, tot.currency))}
                                        </p>
                                        <p className="mt-1.5 text-[12.5px] font-semibold text-gray-500 dark:text-gray-400">
                                            {tot.net > 0 ? t('mobile.netOwedToYou') : tot.net < 0 ? t('mobile.netYouOwe') : t('mobile.even')}
                                        </p>
                                        <div className="mt-3 grid grid-cols-2 gap-2">
                                            <div className="rounded-2xl bg-green-50 dark:bg-green-900/20 px-3 py-2.5">
                                                <p className="text-[11.5px] font-bold text-green-800 dark:text-green-200">{t('mobile.owedToYou')}</p>
                                                <p className="text-[15px] font-extrabold tabular-nums text-green-900 dark:text-green-100">{hide(fmt(tot.owedToYou, tot.currency))}</p>
                                            </div>
                                            <div className="rounded-2xl bg-rose-50 dark:bg-rose-900/20 px-3 py-2.5">
                                                <p className="text-[11.5px] font-bold text-rose-800 dark:text-rose-200">{t('mobile.youOwe')}</p>
                                                <p className="text-[15px] font-extrabold tabular-nums text-rose-900 dark:text-rose-100">{hide(fmt(tot.youOwe, tot.currency))}</p>
                                            </div>
                                        </div>
                                    </div>
                                ))
                            )}
                        </section>

                        {/* Each group, with your share of it */}
                        <section className="space-y-2.5">
                            {position.groups.map((g) => {
                                const shown = g.counterparties.slice(0, ROW_NAMES);
                                const extra = g.counterparties.length - shown.length;
                                return (
                                    <Link key={g.id} href={`/groups/${g.id}`}
                                        className="block rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-400">
                                        <Card padding="sm" radius="2xl" shadow="none" hover>
                                        <div className="flex items-center gap-3">
                                        <div className="w-10 h-10 rounded-full bg-green-100 dark:bg-green-900/30 grid place-items-center shrink-0">
                                            <UserGroupIcon className="w-5 h-5 text-green-600 dark:text-green-400" />
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-baseline justify-between gap-2">
                                                <p className="text-sm font-bold text-gray-900 dark:text-white truncate">{g.name || 'LINE Group'}</p>
                                                {g.net !== 0 && (
                                                    <p className={`shrink-0 text-sm font-extrabold tabular-nums ${
                                                        g.net > 0 ? 'text-green-600 dark:text-green-400' : 'text-rose-600 dark:text-rose-400'}`}>
                                                        {g.net > 0 ? '+' : '−'}{hide(fmt(g.net, g.currency))}
                                                    </p>
                                                )}
                                            </div>
                                            <p className="mt-0.5 text-[11.5px] font-medium text-gray-500 dark:text-gray-400 truncate">
                                                {g.failed
                                                    ? <span className="text-amber-700 dark:text-amber-300">⚠ {t('mobile.failedRow')}</span>
                                                    : g.counterparties.length === 0
                                                    ? (g.settled ? `✓ ${t('allSettled')}` : t('mobile.nothingBetween'))
                                                    : [
                                                        ...shown.map((c) =>
                                                            c.amount > 0
                                                                ? `${t('mobile.owesYou', { name: c.name })} ${hide(fmt(c.amount, c.currency))}`
                                                                : `${t('mobile.youOweName', { name: c.name })} ${hide(fmt(c.amount, c.currency))}`,
                                                        ),
                                                        ...(extra > 0 ? [t('mobile.more', { count: extra })] : []),
                                                    ].join(' · ')}
                                            </p>
                                        </div>
                                        <ChevronRightIcon className="w-4 h-4 text-gray-400 shrink-0" />
                                        </div>
                                        </Card>
                                    </Link>
                                );
                            })}
                        </section>
                    </>
                )}
            </div>
        </DashboardLayout>
    );
}
