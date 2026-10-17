'use client';

import { useMemo, useState } from 'react';
import { Treemap, ResponsiveContainer, Tooltip } from 'recharts';
import { useTranslation } from 'react-i18next';
import { usePrivacy } from '@/contexts/PrivacyContext';
import { useDemo } from '@/contexts/DemoContext';
import { useDualModeQuery } from '@/hooks/useAuthenticatedQuery';
import { transactionService } from '@/services/transactionService';
import { formatCurrency, toTWD } from '@/utils/formatters';
import type { Transaction } from '@/shared/types';
import { isTransferCategory } from '@/utils/expenseGroups';

// Emerald (income) / red (expense) intensity by share of the parent total.
const INCOME = ['#065f46', '#047857', '#059669']; // emerald 800 · 700 · 600
const EXPENSE = ['#991b1b', '#b91c1c', '#dc2626']; // red 800 · 700 · 600

function catColor(share: number, isIncome: boolean): string {
  const scale = isIncome ? INCOME : EXPENSE;
  if (share >= 0.35) return scale[2];
  if (share >= 0.15) return scale[1];
  return scale[0];
}

const HIDE_TRANSFER_KEY = 'aspiro-heatmap-hide-transfer';

// Wallet-to-wallet transfers land as an income + expense "Transfer" category and
// can dwarf real cash flow — allow muting them. Detection is shared with the
// spending averages, so a spelling this recognises is one they exclude too.

interface CatInfo {
  key: string;
  label: string;
  isIncome: boolean;
  amount: number;
  share: number; // fraction of its type's total
  fill: string;
}
interface TxnInfo {
  id: string;
  label: string;
  amount: number;
  isIncome: boolean;
  catLabel: string;
  date?: string;
  fill: string;
}

function TreemapTile(props: {
  x?: number; y?: number; width?: number; height?: number;
  depth?: number; name?: string;
  cats?: Record<string, CatInfo>;
  txns?: Record<string, TxnInfo>;
  expanded?: string | null;
  onHoverCat?: (key: string) => void;
}) {
  const {
    x = 0, y = 0, width = 0, height = 0, depth = 0, name = '',
    cats = {}, txns = {}, expanded = null, onHoverCat,
  } = props;

  if (depth === 1) {
    // Income / Expense block outline.
    return <rect x={x} y={y} width={width} height={height} fill="none" stroke="#0b0f19" strokeWidth={3} />;
  }

  // depth 2 = category, depth 3 = individual transaction (when its category is expanded).
  const isTxn = depth >= 3 || !!txns[name];
  const info = isTxn ? txns[name] : cats[name];
  if (!info) return null;

  const isExpandedParent = !isTxn && expanded === name;
  const fill = isExpandedParent ? 'none' : info.fill;
  const label = isTxn ? (info as TxnInfo).label : (info as CatInfo).label;
  const showLabel = !isExpandedParent && width > 40 && height > 22;
  const showSub = !isExpandedParent && width > 56 && height > 40;
  const fontSize = Math.max(9, Math.min(14, Math.floor(width / 7)));

  return (
    <g
      onMouseEnter={!isTxn ? () => onHoverCat?.(name) : undefined}
      style={{ cursor: !isTxn ? 'pointer' : 'default' }}
    >
      <rect
        x={x} y={y} width={width} height={height}
        fill={fill}
        stroke="#0b0f19"
        strokeWidth={isExpandedParent ? 2 : 1}
      />
      {showLabel && (
        <text
          x={x + width / 2}
          y={y + height / 2 - (showSub ? 7 : 0)}
          textAnchor="middle" dominantBaseline="middle"
          fill="#ffffff" stroke="none" fontSize={fontSize} fontWeight={600}
        >
          {label.length > 14 ? `${label.slice(0, 13)}…` : label}
        </text>
      )}
      {showSub && (
        <text
          x={x + width / 2}
          y={y + height / 2 + 10}
          textAnchor="middle" dominantBaseline="middle"
          fill="#f8fafc" stroke="none" fontSize={11}
        >
          {isTxn
            ? formatCurrency((info as TxnInfo).amount, 'TWD', { compact: (info as TxnInfo).amount >= 100000, precision: 0 })
            : `${((info as CatInfo).share * 100).toFixed(0)}%`}
        </text>
      )}
    </g>
  );
}

export function TransactionHeatmap() {
  const { t } = useTranslation('common');
  const { isValueVisible } = usePrivacy();
  const { demoTransactions } = useDemo();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [hideTransfer, setHideTransfer] = useState<boolean>(
    () => typeof window !== 'undefined' && localStorage.getItem(HIDE_TRANSFER_KEY) === '1',
  );
  const toggleTransfer = () =>
    setHideTransfer(prev => {
      const next = !prev;
      try { localStorage.setItem(HIDE_TRANSFER_KEY, next ? '1' : '0'); } catch { /* ignore */ }
      return next;
    });

  // Current calendar month, computed once per mount so the query key is stable.
  const dateRange = useMemo(() => {
    const now = new Date();
    return { start: new Date(now.getFullYear(), now.getMonth(), 1), end: now };
  }, []);

  const { data: transactions = [], isLoading } = useDualModeQuery<Transaction[]>(
    ['heatmap-month-transactions', dateRange.start.toISOString(), dateRange.end.toISOString()],
    () => transactionService.getAllTransactions({ dateRange }),
    () =>
      demoTransactions.filter(tx => {
        const d = typeof tx.date === 'string' ? new Date(tx.date) : tx.date;
        return d >= dateRange.start && d <= dateRange.end;
      }),
    { staleTime: 1000 * 60 * 2, refetchOnWindowFocus: false },
  );

  const { cats, txns, catItems, count } = useMemo(() => {
    // Group this month's income/expense transactions by category, keeping the
    // individual items (TWD-normalized) so a category can drill down on hover.
    const grouped = new Map<string, { label: string; isIncome: boolean; amount: number; items: { id: string; amount: number }[] }>();
    const txns: Record<string, TxnInfo> = {};

    for (const tx of transactions) {
      if (tx.type !== 'income' && tx.type !== 'expense') continue; // skip transfers
      const amount = toTWD(Number(tx.amount) || 0, tx.currency || 'TWD');
      if (amount <= 0) continue;
      const isIncome = tx.type === 'income';
      const cat = tx.category || t('portfolio.sectorOther', 'Other');
      if (hideTransfer && isTransferCategory(cat)) continue;
      const key = `${cat}__${tx.type}`;
      const entry = grouped.get(key) ?? { label: cat, isIncome, amount: 0, items: [] };
      entry.amount += amount;
      entry.items.push({ id: String(tx.id), amount });
      grouped.set(key, entry);
      txns[String(tx.id)] = {
        id: String(tx.id),
        label: tx.description || cat,
        amount,
        isIncome,
        catLabel: cat,
        date: typeof tx.date === 'string' ? tx.date : tx.date?.toISOString?.().slice(0, 10),
        fill: '#4b5563', // set below once category total is known
      };
    }

    let incomeTotal = 0, expenseTotal = 0;
    for (const e of grouped.values()) {
      if (e.isIncome) incomeTotal += e.amount;
      else expenseTotal += e.amount;
    }

    const cats: Record<string, CatInfo> = {};
    const catItems: Record<string, { name: string; size: number }[]> = {};
    for (const [key, e] of grouped.entries()) {
      const typeTotal = e.isIncome ? incomeTotal : expenseTotal;
      cats[key] = {
        key,
        label: e.label,
        isIncome: e.isIncome,
        amount: e.amount,
        share: typeTotal > 0 ? e.amount / typeTotal : 0,
        fill: catColor(typeTotal > 0 ? e.amount / typeTotal : 0, e.isIncome),
      };
      e.items.sort((a, b) => b.amount - a.amount);
      catItems[key] = e.items.map(it => ({ name: it.id, size: it.amount }));
      // Shade each transaction by its share of the category (biggest = strongest).
      for (const it of e.items) {
        const info = txns[it.id];
        if (info) info.fill = catColor(e.amount > 0 ? it.amount / e.amount : 0, e.isIncome);
      }
    }

    return { cats, txns, catItems, count: grouped.size };
  }, [transactions, t, hideTransfer]);

  const treeData = useMemo(() => {
    const build = (isIncome: boolean) =>
      Object.values(cats)
        .filter(c => c.isIncome === isIncome)
        .sort((a, b) => b.amount - a.amount)
        .map(c =>
          expanded === c.key && catItems[c.key]?.length
            ? { name: c.key, children: catItems[c.key] }
            : { name: c.key, size: c.amount },
        );

    const tree: { name: string; children: unknown[] }[] = [];
    const income = build(true);
    const expense = build(false);
    if (income.length) tree.push({ name: 'income', children: income });
    if (expense.length) tree.push({ name: 'expense', children: expense });
    return tree;
  }, [cats, catItems, expanded]);

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm p-4 sm:p-6 h-full">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-gray-900 dark:text-white">
          {t('transactions.heatmapTitle', 'Cash Flow Heatmap')}
        </h2>
        <div className="flex items-center gap-2 shrink-0">
          <div className="flex items-center gap-2 text-[11px] text-gray-500 dark:text-gray-400">
            <span className="inline-flex items-center gap-1">
              <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: INCOME[2] }} />
              {t('transactions.heatmapIncome', 'Income')}
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: EXPENSE[2] }} />
              {t('transactions.heatmapExpense', 'Expense')}
            </span>
          </div>
          {/* Mute the wallet-transfer category, which otherwise dominates the map */}
          <button
            type="button"
            onClick={toggleTransfer}
            aria-pressed={hideTransfer}
            title={t('transactions.heatmapTransferHint', 'Wallet transfers are recorded as income + expense and can dominate the map')}
            className="shrink-0 text-[10px] font-semibold px-2 py-1 rounded-md border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 focus-visible:ring-2 focus-visible:ring-primary-500 transition-colors"
          >
            {hideTransfer ? t('transactions.heatmapShowTransfer', 'Show transfers') : t('transactions.heatmapHideTransfer', 'Hide transfers')}
          </button>
        </div>
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
        {t('transactions.heatmapSubtitleHover', 'This month · tile size = amount · hover a category to see its transactions')}
      </p>

      {isLoading ? (
        <div className="h-72 sm:h-80 mt-4 rounded-xl bg-gray-100 dark:bg-gray-700/40 animate-pulse" />
      ) : count === 0 ? (
        <div className="h-72 sm:h-80 mt-4 flex items-center justify-center rounded-xl bg-gray-50 dark:bg-gray-700/20">
          <p className="text-sm text-gray-500 dark:text-gray-400 text-center px-6">
            {t('transactions.heatmapEmpty', 'No transactions this month yet.')}
          </p>
        </div>
      ) : (
        <div className="h-72 sm:h-80 mt-4 w-full" onMouseLeave={() => setExpanded(null)}>
          <ResponsiveContainer width="100%" height="100%">
            <Treemap
              data={treeData}
              dataKey="size"
              stroke="#0b0f19"
              isAnimationActive={false}
              content={
                <TreemapTile cats={cats} txns={txns} expanded={expanded} onHoverCat={setExpanded} />
              }
            >
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload || !payload.length) return null;
                  const leaf = payload[0]?.payload as { name?: string } | undefined;
                  const key = leaf?.name;
                  if (!key) return null;
                  const txn = txns[key];
                  const cat = cats[key];
                  const info = txn ?? cat;
                  if (!info) return null;
                  const isIncome = info.isIncome;
                  return (
                    <div className="rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 shadow-lg max-w-[240px]">
                      <p className="text-xs font-bold text-gray-900 dark:text-white truncate">
                        {txn ? txn.label : (cat as CatInfo).label}
                      </p>
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        {txn ? `${txn.catLabel}${txn.date ? ` · ${txn.date}` : ''}` : ''}
                        {!txn && (isIncome ? t('transactions.heatmapIncome', 'Income') : t('transactions.heatmapExpense', 'Expense'))}
                      </p>
                      <div className="mt-1 flex items-center justify-between gap-4 text-xs">
                        <span className="text-gray-900 dark:text-white font-medium">
                          {isValueVisible ? formatCurrency(info.amount, 'TWD', { compact: info.amount >= 100000, precision: 0 }) : '•••'}
                        </span>
                        {!txn && <span className="text-gray-500 dark:text-gray-400">{((cat as CatInfo).share * 100).toFixed(1)}%</span>}
                      </div>
                    </div>
                  );
                }}
              />
            </Treemap>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
