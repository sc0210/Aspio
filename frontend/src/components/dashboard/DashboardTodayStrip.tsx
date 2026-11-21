'use client';
import { useTranslation } from 'react-i18next';
import { usePrivacy } from '@/contexts/PrivacyContext';
import { formatCurrency } from '@/utils/formatters';
import type { LeverageChange } from '@/lib/dashboard/periodChange';

interface DashboardTodayStripProps {
  /**
   * Omit to drop the column entirely. The dashboard's hero card already states
   * net worth, and two headline balances one above the other left nothing to
   * say which one the page is about — so there the strip carries flow only.
   */
  totalAssets?: number;
  totalAssetsChangePercent?: number;
  /** Absolute change over the period, shown next to the percentage badge */
  totalAssetsChangeAmount?: number;
  income: number;
  expenses: number;
  /**
   * Debt against the Portfolio wallet over the period; omit (no debt) to drop
   * the column. Replaced a Portfolio value cell that repeated the Portfolio
   * section directly below it.
   */
  leverage?: LeverageChange;
  currency?: string;
  isLoading?: boolean;
  periodLabel: string;
  /** When true, renders only the inner grid with no card wrapper (embed inside another card) */
  bare?: boolean;
}

const isNeutralPct = (pct: number) => Math.abs(pct) < 0.05;

// Full class names: Tailwind only ships classes it finds spelled out.
const GRID_COLS: Record<number, string> = { 1: 'grid-cols-1', 2: 'grid-cols-2', 3: 'grid-cols-3' };

/** Leverage moved, in percentage points. Up is red: more of the portfolio is borrowed. */
function PointsBadge({ pts, label }: { pts: number; label: (abs: string) => string }) {
  const isNeutral = Math.abs(pts) < 0.05;
  const cls = isNeutral
    ? 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
    : pts > 0
    ? 'bg-error-100 dark:bg-error-900/40 text-error-700 dark:text-error-300'
    : 'bg-prosperity-100 dark:bg-prosperity-900/40 text-prosperity-700 dark:text-prosperity-300';
  const arrow = isNeutral ? '→' : pts > 0 ? '▲' : '▼';
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-semibold px-1.5 py-0.5 rounded-full ${cls}`}>
      {arrow} {label(Math.abs(pts).toFixed(1))}
    </span>
  );
}

function PctBadge({ pct }: { pct: number | undefined }) {
  if (pct === undefined) return null;
  const isNeutral = isNeutralPct(pct);
  const isUp = pct >= 0;
  const arrow = isNeutral ? '→' : isUp ? '▲' : '▼';

  const cls = isNeutral
    ? 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
    : isUp
    ? 'bg-prosperity-100 dark:bg-prosperity-900/40 text-prosperity-700 dark:text-prosperity-300'
    : 'bg-error-100 dark:bg-error-900/40 text-error-700 dark:text-error-300';

  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-semibold px-1.5 py-0.5 rounded-full ${cls}`}>
      {arrow} {Math.abs(pct).toFixed(1)}%
    </span>
  );
}

/** The percentage on its own says nothing about size — pair it with the actual amount moved. */
function ChangeAmount({ amount, pct, fmtDelta }: {
  amount: number | undefined;
  pct: number | undefined;
  fmtDelta: (v: number) => string;
}) {
  if (amount === undefined) return null;
  const isNeutral = pct !== undefined ? isNeutralPct(pct) : amount === 0;

  const cls = isNeutral
    ? 'text-gray-500 dark:text-gray-400'
    : amount >= 0
    ? 'text-prosperity-700 dark:text-prosperity-300'
    : 'text-error-700 dark:text-error-300';

  return (
    <span className={`text-xs font-semibold tabular-nums whitespace-nowrap ${cls}`}>
      {fmtDelta(amount)}
    </span>
  );
}

function StripSkeleton({ columns }: { columns: number }) {
  return (
    <div className={`grid ${GRID_COLS[columns]} divide-x divide-gray-100 dark:divide-gray-700 animate-pulse`}>
      {Array.from({ length: columns }, (_, i) => i).map((i) => (
        <div key={i} className="px-2.5 sm:px-5 py-3 sm:py-4 space-y-2">
          <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-2/3" />
          <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded w-4/5" />
          <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/2" />
        </div>
      ))}
    </div>
  );
}

function StripGrid({
  totalAssets, totalAssetsChangePercent, totalAssetsChangeAmount,
  income, expenses, leverage,
  periodLabel, fmt, fmtCompact, fmtDelta,
  t,
}: {
  totalAssets?: number; totalAssetsChangePercent?: number; totalAssetsChangeAmount?: number;
  income: number; expenses: number; leverage?: LeverageChange;
  periodLabel: string; fmt: (v: number) => string; fmtCompact: (v: number) => string;
  fmtDelta: (v: number) => string;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  const netSaved = income - expenses;
  // A rate is only a rate when income covers spending. Mid-month, before pay
  // lands, NT$17,500 in against NT$153,046 out read "-774.5%".
  const showRate = income > 0 && income >= expenses;
  const columns = 1 + (totalAssets !== undefined ? 1 : 0) + (leverage ? 1 : 0);

  return (
    <div className={`grid ${GRID_COLS[columns]} divide-x divide-gray-100 dark:divide-gray-700`}>
      {/* Column 1 — Total Assets, only where nothing else states it */}
      {totalAssets !== undefined && (
      <div className="px-2.5 sm:px-5 py-3 sm:py-4 flex flex-col gap-1">
        <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 font-medium">
          {t('dashboard:todayStrip.totalAssets')}
        </p>
        <p
          className="text-sm sm:text-xl font-bold text-gray-900 dark:text-white tabular-nums leading-tight truncate"
          aria-label={`Total assets: ${fmt(totalAssets)}`}
        >
          {fmt(totalAssets)}
        </p>
        <div className="flex items-center gap-1.5 flex-wrap">
          <PctBadge pct={totalAssetsChangePercent} />
          <ChangeAmount amount={totalAssetsChangeAmount} pct={totalAssetsChangePercent} fmtDelta={fmtDelta} />
        </div>
      </div>
      )}

      {/* Column 2 — Net Saved */}
      <div className="px-2.5 sm:px-5 py-3 sm:py-4 flex flex-col gap-1">
        <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 font-medium truncate">
          {t('dashboard:todayStrip.saved')} &middot; {periodLabel}
        </p>
        <p
          className={`text-sm sm:text-xl font-bold tabular-nums leading-tight truncate ${netSaved >= 0 ? 'text-prosperity-700 dark:text-prosperity-400' : 'text-error-700 dark:text-error-400'}`}
          aria-label={`Net saved: ${fmt(netSaved)}`}
        >
          {fmt(netSaved)}
        </p>
        <p className="text-xs leading-snug text-gray-500 dark:text-gray-400">
          {showRate
            ? t('dashboard:todayStrip.savingsRate', { rate: ((netSaved / income) * 100).toFixed(1) })
            : t('dashboard:todayStrip.incomeAndSpent', {
                income: fmtCompact(income),
                spent: fmtCompact(expenses),
                defaultValue: 'Income {{income}} · Spent {{spent}}',
              })}
        </p>
      </div>

      {/* Column 3 — Leverage: debt over the Portfolio wallet, where it opened
          and where it is now. Not on the net-worth card above (that one is debt
          over total assets) and not in the Portfolio section below. */}
      {leverage && (
      <div className="px-2.5 sm:px-5 py-3 sm:py-4 flex flex-col gap-1">
        <p
          className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 font-medium truncate"
          title={t('dashboard:todayStrip.leverageHint', {
            defaultValue: 'Debt as a share of your invested portfolio. It rises when markets fall or you borrow more, and falls as you repay or the portfolio grows.',
          })}
        >
          {t('dashboard:todayStrip.leverage', { defaultValue: 'Leverage' })} &middot; {periodLabel}
        </p>
        <p
          className="text-sm sm:text-xl font-bold text-gray-900 dark:text-white tabular-nums leading-tight truncate"
          aria-label={`Leverage: ${leverage.now.toFixed(1)}%`}
        >
          {leverage.now.toFixed(1)}%
        </p>
        {leverage.start !== undefined && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <PointsBadge
              pts={leverage.now - leverage.start}
              label={(pts) => t('dashboard:todayStrip.leveragePts', { pts, defaultValue: '{{pts}} pts' })}
            />
            <span className="text-xs text-gray-500 dark:text-gray-400 tabular-nums whitespace-nowrap">
              {t('dashboard:todayStrip.leverageFrom', {
                pct: leverage.start.toFixed(1),
                defaultValue: 'from {{pct}}%',
              })}
            </span>
          </div>
        )}
        <p className="text-xs leading-snug text-gray-500 dark:text-gray-400">
          {t('dashboard:todayStrip.leverageBasis', {
            debt: fmtCompact(leverage.debt),
            invested: fmtCompact(leverage.invested),
            defaultValue: '{{debt}} debt / {{invested}} invested',
          })}
        </p>
      </div>
      )}
    </div>
  );
}

export function DashboardTodayStrip({
  totalAssets,
  totalAssetsChangePercent,
  totalAssetsChangeAmount,
  income,
  expenses,
  leverage,
  currency = 'TWD',
  isLoading = false,
  periodLabel,
  bare = false,
}: DashboardTodayStripProps) {
  const { t } = useTranslation(['dashboard']);
  const { isValueVisible } = usePrivacy();
  const fmt = (v: number) =>
    isValueVisible ? formatCurrency(v, currency, { precision: 0 }) : '••••••';
  // Signed delta — the sign is carried by the prefix, so format the magnitude only.
  const fmtDelta = (v: number) =>
    isValueVisible ? `${v >= 0 ? '+' : '−'}${formatCurrency(Math.abs(v), currency, { precision: 0 })}` : '•••';

  const fmtCompact = (v: number) =>
    isValueVisible ? formatCurrency(v, currency, { compact: true }) : '•••';

  const columns = 1 + (totalAssets !== undefined ? 1 : 0) + (leverage ? 1 : 0);

  if (bare) {
    return isLoading ? (
      <StripSkeleton columns={columns} />
    ) : (
      <StripGrid
        totalAssets={totalAssets} totalAssetsChangePercent={totalAssetsChangePercent}
        totalAssetsChangeAmount={totalAssetsChangeAmount}
        income={income} expenses={expenses} leverage={leverage}
        periodLabel={periodLabel} fmt={fmt} fmtCompact={fmtCompact} fmtDelta={fmtDelta} t={t}
      />
    );
  }

  return (
    <div className="rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
      <div className="h-px bg-gradient-to-r from-primary-400/60 via-indigo-400/60 to-violet-400/60" />
      {isLoading ? (
        <StripSkeleton columns={columns} />
      ) : (
        <StripGrid
          totalAssets={totalAssets} totalAssetsChangePercent={totalAssetsChangePercent}
          totalAssetsChangeAmount={totalAssetsChangeAmount}
          income={income} expenses={expenses} leverage={leverage}
          periodLabel={periodLabel} fmt={fmt} fmtCompact={fmtCompact} fmtDelta={fmtDelta} t={t}
        />
      )}
    </div>
  );
}
