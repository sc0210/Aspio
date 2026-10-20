'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Button } from '@/components/ui/Button';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import { apiClient } from '@/lib/api-client';
import { useTranslation } from 'react-i18next';
import { useAppMode } from '@/hooks/useAppMode';
import { formatCurrency } from '@/utils/formatters';
import {
  demoGroups,
  demoGroupBalances,
  demoGroupMembers,
  demoGroupExpenses,
} from '@/data/demoData';

// ─── API response types ───────────────────────────────────────────────────────

interface Group {
  id: string;
  name: string | null;
  currency: string;
}

interface GroupBalance {
  owed_by: string;
  owed_to: string;
  amount: string;
  currency: string;
}

interface GroupBalancesResponse {
  group_id: string;
  currency: string;
  balances: GroupBalance[];
  member_names: Record<string, string>;
}

interface Member {
  user_id: string;
  display_name: string | null;
  line_user_id: string;
}

interface ExpenseSplit {
  user_id: string;
  amount: string;
}

interface Expense {
  id: string;
  payer_id: string;
  amount: string;
  currency: string;
  description: string;
  note?: string | null;
  created_at: string;
  splits: ExpenseSplit[];
}

// The demo "current user" — mirrors the seeded Alex Chen in demoData fixtures.
const DEMO_CURRENT_USER_ID = 'demo-gm-alex';

// ─── Derived types ────────────────────────────────────────────────────────────

interface MemberStat {
  name: string;
  paid: number;
  owes: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function short(uuid: string): string {
  return uuid.slice(0, 8);
}

function formatAmount(amount: string | number, currency: string): string {
  const n = typeof amount === 'string' ? parseFloat(amount) : amount;
  return `${currency} ${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function monthLabel(isoDate: string): string {
  const d = new Date(isoDate);
  return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

function shortDate(isoDate: string): string {
  const d = new Date(isoDate);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${mm}/${dd}`;
}

/**
 * Split `total` equally across `n` parties, distributing the rounding remainder
 * (in minor units) to the first members so the parts always sum to the total.
 */
function equalSplitAmounts(total: number, n: number): number[] {
  if (n <= 0) return [];
  const cents = Math.round(total * 100);
  const base = Math.floor(cents / n);
  let remainder = cents - base * n;
  return Array.from({ length: n }, () => {
    const extra = remainder > 0 ? 1 : 0;
    if (remainder > 0) remainder -= 1;
    return (base + extra) / 100;
  });
}

/** Recompute net pairwise balances from a list of expenses (demo-mode only). */
function recomputeBalances(
  expenses: Expense[],
  currency: string,
): GroupBalance[] {
  // net[id] > 0 => the group owes them; < 0 => they owe the group.
  const net: Record<string, number> = {};
  for (const e of expenses) {
    net[e.payer_id] = (net[e.payer_id] ?? 0) + parseFloat(e.amount);
    for (const s of e.splits) {
      net[s.user_id] = (net[s.user_id] ?? 0) - parseFloat(s.amount);
    }
  }
  const creditors = Object.entries(net)
    .filter(([, v]) => v > 0.005)
    .map(([id, v]) => ({ id, amt: v }))
    .sort((a, b) => b.amt - a.amt);
  const debtors = Object.entries(net)
    .filter(([, v]) => v < -0.005)
    .map(([id, v]) => ({ id, amt: -v }))
    .sort((a, b) => b.amt - a.amt);

  const out: GroupBalance[] = [];
  let ci = 0;
  let di = 0;
  while (ci < creditors.length && di < debtors.length) {
    const pay = Math.min(creditors[ci].amt, debtors[di].amt);
    if (pay > 0.005) {
      out.push({
        owed_by: debtors[di].id,
        owed_to: creditors[ci].id,
        amount: pay.toFixed(2),
        currency,
      });
    }
    creditors[ci].amt -= pay;
    debtors[di].amt -= pay;
    if (creditors[ci].amt < 0.005) ci += 1;
    if (debtors[di].amt < 0.005) di += 1;
  }
  return out;
}

/** Surface the backend message when present; otherwise a generic fallback. */
function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

function groupExpensesByMonth(expenses: Expense[]): Array<[string, Expense[]]> {
  const map = new Map<string, Expense[]>();
  for (const e of expenses) {
    const key = monthLabel(e.created_at);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(e);
  }
  return Array.from(map.entries());
}

function computeThisMonthStats(
  expenses: Expense[],
  nameMap: Record<string, string>,
): MemberStat[] {
  if (expenses.length === 0) return [];
  const now = new Date();
  const thisMonth = expenses.filter((e) => {
    const d = new Date(e.created_at);
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  });
  if (thisMonth.length === 0) return [];

  const paid: Record<string, number> = {};
  const owes: Record<string, number> = {};
  for (const e of thisMonth) {
    paid[e.payer_id] = (paid[e.payer_id] ?? 0) + parseFloat(e.amount);
    for (const s of e.splits) {
      owes[s.user_id] = (owes[s.user_id] ?? 0) + parseFloat(s.amount);
    }
  }

  const ids = new Set([...Object.keys(paid), ...Object.keys(owes)]);
  return Array.from(ids)
    .map((id) => ({
      name: nameMap[id] ?? short(id),
      paid: paid[id] ?? 0,
      owes: owes[id] ?? 0,
    }))
    .sort((a, b) => b.paid - a.paid);
}

const PAGE_SIZE = 50;

// ─── Page component ───────────────────────────────────────────────────────────

export default function GroupDetailPage() {
  const { t } = useTranslation('groups');
  const { isDemo } = useAppMode();
  const params = useParams();
  const groupId = params?.id as string;

  const [group, setGroup] = useState<Group | null>(null);
  const [balancesData, setBalancesData] = useState<GroupBalancesResponse | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Write-action UI state
  const [formMode, setFormMode] = useState<'add' | 'edit' | null>(null);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [settleTarget, setSettleTarget] = useState<GroupBalance | null>(null);

  const sortByCreatedDesc = useCallback(
    (list: Expense[]) =>
      [...list].sort(
        (a, b_) =>
          new Date(b_.created_at).getTime() - new Date(a.created_at).getTime(),
      ),
    [],
  );

  // Reusable loader so write actions can refetch the full group state.
  const reload = useCallback(async () => {
    if (!groupId) return;

    // Demo mode: render from fixtures, never call the backend.
    if (isDemo) {
      const demoGroup = demoGroups.find((g) => g.id === groupId) ?? null;
      setGroup(
        demoGroup
          ? { id: demoGroup.id, name: demoGroup.name, currency: demoGroup.currency }
          : null,
      );
      setBalancesData(demoGroupBalances[groupId] ?? null);
      setMembers(demoGroupMembers[groupId] ?? []);
      setExpenses(sortByCreatedDesc(demoGroupExpenses[groupId] ?? []));
      setLoading(false);
      return;
    }

    try {
      const [bRes, mRes, eRes, gRes] = await Promise.all([
        apiClient.get<GroupBalancesResponse>(`/line-bot/groups/${groupId}/balances`),
        apiClient.get<Member[]>(`/line-bot/groups/${groupId}/members`),
        apiClient.get<Expense[]>(`/line-bot/groups/${groupId}/expenses`),
        apiClient.get<Group[]>('/line-bot/groups'),
      ]);
      setBalancesData(bRes.data ?? null);
      setMembers(mRes.data ?? []);
      setExpenses(sortByCreatedDesc(eRes.data ?? []));
      setGroup((gRes.data ?? []).find((g) => g.id === groupId) ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errorLoading'));
    } finally {
      setLoading(false);
    }
  }, [groupId, isDemo, sortByCreatedDesc, t]);

  useEffect(() => {
    if (!groupId) return;
    reload();
    // Re-run only when the group or mode actually changes. `reload` is recreated
    // whenever `t` gets a new identity (react-i18next can return a fresh `t` each
    // render), so depending on `reload` here would re-fire the loader every render
    // and spin into a "Maximum update depth exceeded" loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, isDemo]);

  // Build unified name map
  const nameMap: Record<string, string> = {};
  for (const m of members) {
    if (m.display_name) nameMap[m.user_id] = m.display_name;
  }
  if (balancesData?.member_names) {
    for (const [id, name] of Object.entries(balancesData.member_names)) {
      if (!nameMap[id]) nameMap[id] = name;
    }
  }
  const resolveName = (id: string) => nameMap[id] ?? short(id);

  const currency = group?.currency ?? balancesData?.currency ?? '';
  const groupName = group?.name?.trim() || 'LINE Group';
  const avatarLetter = groupName.charAt(0).toUpperCase();
  const memberStats = computeThisMonthStats(expenses, nameMap);
  const visibleExpenses = expenses.slice(0, visibleCount);
  const grouped = groupExpensesByMonth(visibleExpenses);

  // ─── Write actions ──────────────────────────────────────────────────────────

  const defaultPayerId = useMemo(
    () =>
      isDemo
        ? DEMO_CURRENT_USER_ID
        : members[0]?.user_id ?? '',
    [isDemo, members],
  );

  const closeForm = () => {
    setFormMode(null);
    setEditingExpense(null);
  };

  // Build an Expense from form values (used for both the API payload and the
  // optimistic demo-state mutation).
  const buildSplits = (
    total: number,
    payerId: string,
    custom: Record<string, string> | null,
  ): ExpenseSplit[] => {
    if (custom) {
      return Object.entries(custom)
        .filter(([, v]) => parseFloat(v) > 0)
        .map(([user_id, amount]) => ({
          user_id,
          amount: parseFloat(amount).toFixed(2),
        }));
    }
    const parts = equalSplitAmounts(total, members.length || 1);
    return members.map((m, i) => ({ user_id: m.user_id, amount: parts[i].toFixed(2) }));
  };

  const saveExpense = async (values: ExpenseFormValues) => {
    const total = parseFloat(values.amount);
    const custom = values.splitMode === 'custom' ? values.customSplits : null;

    if (isDemo) {
      // Optimistic, session-only mutation of local React state. Compute the next
      // expense list first, then set both states sequentially — never nest a
      // setState inside another updater (render-phase updates run the updater
      // multiple times and corrupt the recomputed balances).
      const splits = buildSplits(total, values.payerId, custom);
      let next: Expense[];
      if (formMode === 'edit' && editingExpense) {
        next = expenses.map((e) =>
          e.id === editingExpense.id
            ? {
                ...e,
                payer_id: values.payerId,
                amount: total.toFixed(2),
                description: values.description,
                note: values.note || null,
                splits,
              }
            : e,
        );
      } else {
        const created: Expense = {
          id: `demo-gx-${Date.now()}`,
          payer_id: values.payerId,
          amount: total.toFixed(2),
          currency,
          description: values.description,
          note: values.note || null,
          created_at: new Date().toISOString(),
          splits,
        };
        next = [created, ...expenses];
      }
      setExpenses(sortByCreatedDesc(next));
      setBalancesData((bd) =>
        bd ? { ...bd, balances: recomputeBalances(next, currency) } : bd,
      );
      closeForm();
      return;
    }

    const payload: Record<string, unknown> = {
      amount: total.toFixed(2),
      description: values.description,
      payer_id: values.payerId || null,
      note: values.note || null,
    };
    if (custom) {
      payload.splits = Object.entries(custom)
        .filter(([, v]) => parseFloat(v) > 0)
        .map(([user_id, amount]) => ({
          user_id,
          amount: parseFloat(amount).toFixed(2),
        }));
    }

    if (formMode === 'edit' && editingExpense) {
      await apiClient.patch<Expense>(
        `/line-bot/groups/${groupId}/expenses/${editingExpense.id}`,
        payload,
      );
    } else {
      await apiClient.post<Expense>(`/line-bot/groups/${groupId}/expenses`, payload);
    }
    await reload();
    closeForm();
  };

  const deleteExpense = async (expense: Expense) => {
    if (isDemo) {
      const next = expenses.filter((e) => e.id !== expense.id);
      setExpenses(next);
      setBalancesData((bd) =>
        bd ? { ...bd, balances: recomputeBalances(next, currency) } : bd,
      );
      closeForm();
      return;
    }
    await apiClient.delete(`/line-bot/groups/${groupId}/expenses/${expense.id}`);
    await reload();
    closeForm();
  };

  const settleBalance = async (balance: GroupBalance, partialAmount: string | null) => {
    if (isDemo) {
      setBalancesData((bd) => {
        if (!bd) return bd;
        const settleAmt = partialAmount ? parseFloat(partialAmount) : parseFloat(balance.amount);
        const balances = bd.balances
          .map((b) => {
            if (b.owed_by !== balance.owed_by || b.owed_to !== balance.owed_to) return b;
            const remaining = parseFloat(b.amount) - settleAmt;
            return remaining > 0.005
              ? { ...b, amount: remaining.toFixed(2) }
              : null;
          })
          .filter((b): b is GroupBalance => b !== null);
        return { ...bd, balances };
      });
      setSettleTarget(null);
      return;
    }
    const body: Record<string, unknown> = {
      owed_by: balance.owed_by,
      owed_to: balance.owed_to,
    };
    if (partialAmount) body.amount = parseFloat(partialAmount).toFixed(2);
    await apiClient.post(`/line-bot/groups/${groupId}/settle`, body);
    await reload();
    setSettleTarget(null);
  };

  return (
    <DashboardLayout>
      <div className="max-w-lg mx-auto px-4 py-6 space-y-4">

        {/* Back link */}
        <Link
          href="/groups"
          className="inline-flex items-center gap-1.5 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          {t('back')}
        </Link>

        {/* Loading skeleton */}
        {loading && (
          <div className="space-y-3">
            {[1, 2, 3].map((n) => (
              <div
                key={n}
                className="rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 h-24 animate-pulse"
              />
            ))}
          </div>
        )}

        {/* Error state */}
        {error && (
          <div className="rounded-2xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-4 text-sm text-red-700 dark:text-red-400">
            {error}
          </div>
        )}

        {!loading && !error && (
          <>
            {/* Header card */}
            <div className="rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
              <div className="h-px bg-gradient-to-r from-green-400/60 via-emerald-400/60 to-teal-400/60" />
              <div className="flex items-center gap-3 p-4 sm:p-5">
                <div
                  className="w-11 h-11 rounded-full flex items-center justify-center text-white text-lg font-bold flex-shrink-0"
                  style={{ backgroundColor: '#06C755' }}
                >
                  {avatarLetter}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-base text-gray-900 dark:text-white truncate">
                    {groupName}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    {t('members', { count: members.length })} · {currency}
                  </p>
                </div>
                <span
                  className="text-xs font-semibold px-2 py-0.5 rounded-full text-white flex-shrink-0"
                  style={{ backgroundColor: '#06C755' }}
                >
                  LINE
                </span>
              </div>
              <div className="px-4 sm:px-5 pb-4 -mt-1">
                <button
                  type="button"
                  onClick={() => {
                    setEditingExpense(null);
                    setFormMode('add');
                  }}
                  className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl text-white text-sm font-semibold py-2.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[#06C755]"
                  style={{ backgroundColor: '#06C755' }}
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#05b34d')}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#06C755')}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  {t('addExpense')}
                </button>
              </div>
            </div>

            {isDemo && (
              <p className="text-sm text-amber-700 dark:text-amber-400 text-center -mt-1">
                {t('demoNote')}
              </p>
            )}

            {/* Balances card */}
            <div className="rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
              <div className="px-4 sm:px-5 pt-4 pb-1">
                <h2 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                  {t('allBalances')}
                </h2>
              </div>
              <div className="px-4 sm:px-5 pb-4 pt-2">
                {!balancesData || balancesData.balances.length === 0 ? (
                  <div className="rounded-xl bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 px-4 py-3 text-sm font-medium text-green-700 dark:text-green-400 text-center">
                    ✓ {t('allSettled')}
                  </div>
                ) : (
                  <ul className="space-y-2.5">
                    {balancesData.balances.map((b, i) => (
                      <li
                        key={`${b.owed_by}-${b.owed_to}-${i}`}
                        className="flex items-center justify-between text-sm gap-3"
                      >
                        <span className="text-gray-700 dark:text-gray-300 min-w-0 truncate">
                          <span className="font-semibold text-gray-900 dark:text-white">
                            {resolveName(b.owed_by)}
                          </span>
                          {' '}{t('owes')}{' '}
                          <span className="font-semibold text-gray-900 dark:text-white">
                            {resolveName(b.owed_to)}
                          </span>
                        </span>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <span className="font-bold text-red-700 dark:text-red-500">
                            {formatAmount(b.amount, b.currency)}
                          </span>
                          <button
                            type="button"
                            onClick={() => setSettleTarget(b)}
                            className="text-xs font-semibold px-2.5 py-1 rounded-full border border-green-200 dark:border-green-700 text-green-700 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-[#06C755]"
                          >
                            {t('settle')}
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            {/* This month per-member stats */}
            {memberStats.length > 0 && (
              <div className="rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
                <div className="px-4 sm:px-5 pt-4 pb-1">
                  <h2 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                    {t('thisMember')}
                  </h2>
                </div>
                <div className="px-4 sm:px-5 pb-4 pt-2 overflow-x-auto">
                  <table className="w-full text-sm min-w-[280px]">
                    <thead>
                      <tr className="text-xs text-gray-500 dark:text-gray-400 uppercase">
                        <th className="text-left pb-2 font-medium">{t('members')}</th>
                        <th className="text-right pb-2 font-medium">{t('paid')}</th>
                        <th className="text-right pb-2 font-medium">{t('owes')}</th>
                        <th className="text-right pb-2 font-medium">{t('net')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                      {memberStats.map((ms) => {
                        const net = ms.paid - ms.owes;
                        return (
                          <tr key={ms.name}>
                            <td className="py-2 font-medium text-gray-800 dark:text-gray-200 truncate max-w-[120px]">
                              {ms.name}
                            </td>
                            <td className="py-2 text-right text-gray-600 dark:text-gray-400">
                              {ms.paid.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                            </td>
                            <td className="py-2 text-right text-red-700 dark:text-red-500">
                              {ms.owes.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                            </td>
                            <td
                              className={`py-2 text-right font-semibold ${
                                net >= 0 ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-500'
                              }`}
                            >
                              {net >= 0 ? '+' : ''}
                              {net.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Expense history */}
            <div className="rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
              <div className="px-4 sm:px-5 pt-4 pb-1">
                <h2 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                  {t('history')}
                </h2>
              </div>

              {expenses.length === 0 ? (
                <p className="px-4 pb-5 pt-2 text-sm text-gray-500 dark:text-gray-400 text-center">
                  {t('noExpenses')}
                </p>
              ) : (
                <>
                  {grouped.map(([month, monthExpenses]) => (
                    <div key={month}>
                      <div className="sticky top-0 z-10 bg-gray-50 dark:bg-gray-800/80 backdrop-blur-sm px-4 py-1.5 border-t border-b border-gray-100 dark:border-gray-700">
                        <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                          {month}
                        </span>
                      </div>
                      <ul className="divide-y divide-gray-100 dark:divide-gray-800">
                        {monthExpenses.map((e) => (
                          <li key={e.id}>
                            <button
                              type="button"
                              onClick={() => {
                                setEditingExpense(e);
                                setFormMode('edit');
                              }}
                              className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#06C755]"
                            >
                              <div className="w-9 text-center flex-shrink-0">
                                <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
                                  {shortDate(e.created_at)}
                                </span>
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate">
                                  {e.description || '—'}
                                </p>
                                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                                  {t('paidBy')} {resolveName(e.payer_id)}
                                </p>
                              </div>
                              <span className="text-sm font-semibold text-gray-800 dark:text-gray-100 flex-shrink-0">
                                {formatAmount(e.amount, e.currency)}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}

                  {expenses.length >= PAGE_SIZE && visibleCount <= expenses.length && (
                    <div className="px-4 pb-4 pt-2">
                      <button
                        onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
                        className="w-full text-sm font-medium text-green-700 dark:text-green-400 hover:text-green-800 dark:hover:text-green-300 transition-colors py-2 rounded-xl border border-green-200 dark:border-green-700 hover:bg-green-50 dark:hover:bg-green-900/20"
                      >
                        {t('loadMore')}
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          </>
        )}
      </div>

      {/* Add / edit expense modal */}
      {formMode !== null && (
        <ExpenseFormModal
          mode={formMode}
          members={members}
          currency={currency}
          defaultPayerId={defaultPayerId}
          expense={editingExpense}
          resolveName={resolveName}
          onClose={closeForm}
          onSave={saveExpense}
          onDelete={deleteExpense}
        />
      )}

      {/* Settle modal */}
      {settleTarget && (
        <SettleModal
          balance={settleTarget}
          currency={currency}
          resolveName={resolveName}
          onClose={() => setSettleTarget(null)}
          onSettle={settleBalance}
        />
      )}
    </DashboardLayout>
  );
}

// ─── Expense form modal (add / edit / delete) ──────────────────────────────────

interface ExpenseFormValues {
  amount: string;
  description: string;
  note: string;
  payerId: string;
  splitMode: 'equal' | 'custom';
  customSplits: Record<string, string>;
}

interface ExpenseFormModalProps {
  mode: 'add' | 'edit';
  members: Member[];
  currency: string;
  defaultPayerId: string;
  expense: Expense | null;
  resolveName: (id: string) => string;
  onClose: () => void;
  onSave: (values: ExpenseFormValues) => Promise<void>;
  onDelete: (expense: Expense) => Promise<void>;
}

function ExpenseFormModal({
  mode,
  members,
  currency,
  defaultPayerId,
  expense,
  resolveName,
  onClose,
  onSave,
  onDelete,
}: ExpenseFormModalProps) {
  const { t } = useTranslation('groups');

  const isEdit = mode === 'edit';
  const hadCustomSplit = useMemo(() => {
    if (!expense) return false;
    const total = parseFloat(expense.amount);
    const equal = equalSplitAmounts(total, members.length || 1);
    // Treat as custom if the stored splits don't match an equal split across
    // all current members.
    if (expense.splits.length !== members.length) return true;
    return members.some((m, i) => {
      const s = expense.splits.find((sp) => sp.user_id === m.user_id);
      return !s || Math.abs(parseFloat(s.amount) - equal[i]) > 0.01;
    });
  }, [expense, members]);

  const [amount, setAmount] = useState(expense?.amount ?? '');
  const [description, setDescription] = useState(expense?.description ?? '');
  const [note, setNote] = useState(expense?.note ?? '');
  const [payerId, setPayerId] = useState(expense?.payer_id ?? defaultPayerId);
  const [splitMode, setSplitMode] = useState<'equal' | 'custom'>(
    hadCustomSplit ? 'custom' : 'equal',
  );
  const [customSplits, setCustomSplits] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const m of members) {
      const s = expense?.splits.find((sp) => sp.user_id === m.user_id);
      init[m.user_id] = s ? s.amount : '';
    }
    return init;
  });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const total = parseFloat(amount) || 0;
  const splitSum = useMemo(
    () =>
      Object.values(customSplits).reduce(
        (acc, v) => acc + (parseFloat(v) || 0),
        0,
      ),
    [customSplits],
  );
  const remaining = total - splitSum;

  const handleSubmit = async () => {
    setError(null);
    if (!(total > 0)) {
      setError(t('errors.amountRequired'));
      return;
    }
    if (!description.trim()) {
      setError(t('errors.descriptionRequired'));
      return;
    }
    if (splitMode === 'custom' && Math.abs(remaining) > 0.01) {
      setError(
        t('errors.splitMustSum', {
          total: formatCurrency(total, currency, { precision: 0 }),
        }),
      );
      return;
    }
    setSubmitting(true);
    try {
      await onSave({
        amount,
        description: description.trim(),
        note: note.trim(),
        payerId,
        splitMode,
        customSplits,
      });
    } catch (err) {
      setError(errorMessage(err, t('errors.generic')));
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!expense) return;
    setError(null);
    setSubmitting(true);
    try {
      await onDelete(expense);
    } catch (err) {
      setError(errorMessage(err, t('errors.generic')));
      setSubmitting(false);
      setConfirmingDelete(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title={isEdit ? t('editExpense') : t('addExpense')} size="md">
      {confirmingDelete && expense ? (
        <div className="space-y-4">
          <div>
            <p className="text-sm font-semibold text-gray-900 dark:text-white">
              {t('confirmDelete')}
            </p>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              {t('confirmDeleteBody')}
            </p>
          </div>
          {error && (
            <p className="text-sm text-red-700 dark:text-red-400" role="alert">
              {error}
            </p>
          )}
          <ModalFooter>
            <Button variant="outline" onClick={() => setConfirmingDelete(false)} disabled={submitting}>
              {t('cancel')}
            </Button>
            <Button variant="error" onClick={handleDelete} isLoading={submitting}>
              {submitting ? t('deleting') : t('delete')}
            </Button>
          </ModalFooter>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Amount */}
          <div>
            <label htmlFor="page-amount" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {t('amount')} ({currency})
            </label>
            <input
              id="page-amount"
              type="number"
              onWheel={(e) => e.currentTarget.blur()}
              inputMode="decimal"
              min="0"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-2.5 text-sm text-gray-900 dark:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#06C755]"
            />
          </div>

          {/* Description */}
          <div>
            <label htmlFor="page-description" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {t('description')}
            </label>
            <input
              id="page-description"
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('descriptionPlaceholder')}
              className="w-full rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-2.5 text-sm text-gray-900 dark:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#06C755]"
            />
          </div>

          {/* Note (optional) */}
          <div>
            <label htmlFor="page-note" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {t('note')}
            </label>
            <input
              id="page-note"
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t('notePlaceholder')}
              className="w-full rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-2.5 text-sm text-gray-900 dark:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#06C755]"
            />
          </div>

          {/* Payer */}
          <div>
            <label htmlFor="page-payer" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {t('payer')}
            </label>
            <select
              id="page-payer"
              value={payerId}
              onChange={(e) => setPayerId(e.target.value)}
              className="w-full rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-2.5 text-sm text-gray-900 dark:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#06C755]"
            >
              {members.map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {resolveName(m.user_id)}
                </option>
              ))}
            </select>
          </div>

          {/* Split mode */}
          <div>
            <span className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
              {t('splitMode')}
            </span>
            <div className="flex gap-2">
              {(['equal', 'custom'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setSplitMode(m)}
                  className={`flex-1 text-sm font-medium py-2 rounded-xl border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-[#06C755] ${
                    splitMode === m
                      ? 'border-[#06C755] text-[#06C755] bg-green-50 dark:bg-green-900/20'
                      : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300'
                  }`}
                >
                  {m === 'equal' ? t('splitEqually') : t('customSplit')}
                </button>
              ))}
            </div>
          </div>

          {/* Custom split inputs */}
          {splitMode === 'custom' && (
            <div className="space-y-2 rounded-xl bg-gray-50 dark:bg-gray-800/60 p-3">
              <p className="text-xs text-gray-500 dark:text-gray-400">{t('customSplitHint')}</p>
              {members.map((m) => (
                <div key={m.user_id} className="flex items-center justify-between gap-3">
                  <span className="text-sm text-gray-700 dark:text-gray-300 truncate">
                    {resolveName(m.user_id)}
                  </span>
                  <input
                    aria-label={`${t('groups:splitAmountFor', 'Split amount for')} ${resolveName(m.user_id)}`}
                    type="number"
                    onWheel={(e) => e.currentTarget.blur()}
                    inputMode="decimal"
                    min="0"
                    step="0.01"
                    value={customSplits[m.user_id] ?? ''}
                    onChange={(e) =>
                      setCustomSplits((prev) => ({ ...prev, [m.user_id]: e.target.value }))
                    }
                    className="w-28 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-2.5 py-1.5 text-sm text-right text-gray-900 dark:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#06C755]"
                  />
                </div>
              ))}
              <div className="flex items-center justify-between text-xs pt-1 border-t border-gray-200 dark:border-gray-700">
                <span className="text-gray-500 dark:text-gray-400">{t('splitTotal')}</span>
                <span
                  className={`font-semibold ${
                    Math.abs(remaining) > 0.01
                      ? 'text-red-700 dark:text-red-500'
                      : 'text-green-700 dark:text-green-400'
                  }`}
                >
                  {formatCurrency(splitSum, currency, { precision: 0 })}
                  {' · '}
                  {t('remaining')} {formatCurrency(remaining, currency, { precision: 0 })}
                </span>
              </div>
            </div>
          )}

          {error && (
            <p className="text-sm text-red-700 dark:text-red-400" role="alert">
              {error}
            </p>
          )}

          <ModalFooter className="flex-wrap gap-2">
            {isEdit && (
              <Button
                variant="error"
                onClick={() => setConfirmingDelete(true)}
                disabled={submitting}
                className="mr-auto"
              >
                {t('deleteExpense')}
              </Button>
            )}
            <Button variant="outline" onClick={onClose} disabled={submitting}>
              {t('cancel')}
            </Button>
            <Button onClick={handleSubmit} isLoading={submitting}>
              {submitting ? t('saving') : t('save')}
            </Button>
          </ModalFooter>
        </div>
      )}
    </Modal>
  );
}

// ─── Settle modal ───────────────────────────────────────────────────────────

interface SettleModalProps {
  balance: GroupBalance;
  currency: string;
  resolveName: (id: string) => string;
  onClose: () => void;
  onSettle: (balance: GroupBalance, partialAmount: string | null) => Promise<void>;
}

function SettleModal({ balance, currency, resolveName, onClose, onSettle }: SettleModalProps) {
  const { t } = useTranslation('groups');
  const [partial, setPartial] = useState(false);
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const outstanding = parseFloat(balance.amount);

  const handleSettle = async () => {
    setError(null);
    let partialAmount: string | null = null;
    if (partial) {
      const n = parseFloat(amount);
      if (!(n > 0)) {
        setError(t('errors.settleAmountInvalid'));
        return;
      }
      partialAmount = amount;
    }
    setSubmitting(true);
    try {
      await onSettle(balance, partialAmount);
    } catch (err) {
      setError(errorMessage(err, t('errors.generic')));
      setSubmitting(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title={t('settleTitle')} size="sm">
      <div className="space-y-4">
        <div className="rounded-xl bg-gray-50 dark:bg-gray-800/60 px-4 py-3">
          <p className="text-sm text-gray-700 dark:text-gray-300">
            {t('settleOwes', {
              from: resolveName(balance.owed_by),
              to: resolveName(balance.owed_to),
            })}
          </p>
          <p className="text-sm font-semibold text-gray-900 dark:text-white mt-1">
            {t('settleOutstanding', {
              amount: formatCurrency(outstanding, balance.currency || currency, { precision: 0 }),
            })}
          </p>
        </div>

        <div className="flex gap-2">
          {[false, true].map((p) => (
            <button
              key={String(p)}
              type="button"
              onClick={() => setPartial(p)}
              className={`flex-1 text-sm font-medium py-2 rounded-xl border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-[#06C755] ${
                partial === p
                  ? 'border-[#06C755] text-[#06C755] bg-green-50 dark:bg-green-900/20'
                  : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300'
              }`}
            >
              {p ? t('settlePartial') : t('settleFull')}
            </button>
          ))}
        </div>

        {partial && (
          <div>
            <label htmlFor="page-settleamountlabel" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {t('settleAmountLabel')} ({balance.currency || currency})
            </label>
            <input
              id="page-settleamountlabel"
              type="number"
              onWheel={(e) => e.currentTarget.blur()}
              inputMode="decimal"
              min="0"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-2.5 text-sm text-gray-900 dark:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#06C755]"
            />
          </div>
        )}

        {error && (
          <p className="text-sm text-red-700 dark:text-red-400" role="alert">
            {error}
          </p>
        )}

        <ModalFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            {t('cancel')}
          </Button>
          <Button onClick={handleSettle} isLoading={submitting}>
            {submitting ? t('settling') : t('settleConfirm')}
          </Button>
        </ModalFooter>
      </div>
    </Modal>
  );
}
