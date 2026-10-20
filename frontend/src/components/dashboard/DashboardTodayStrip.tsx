'use client';
import { useTranslation } from 'react-i18next';
import { usePrivacy } from '@/contexts/PrivacyContext';
import { formatCurrency } from '@/utils/formatters';

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
  netSaved: number;
  savingsRate: number;
  portfolioValue: number;
  portfolioChangePercent?: number;
  /** Absolute gain/loss behind portfolioChangePercent */
  portfolioChangeAmount?: number;
  currency?: string;
  isLoading?: boolean;
  periodLabel: string;
  /** When true, renders only the inner grid with no card wrapper (embed inside another card) */
  bare?: boolean;
}

const isNeutralPct = (pct: number) => Math.abs(pct) < 0.05;

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

function StripSkeleton({ columns }: { columns: 2 | 3 }) {
  return (
    <div className={`grid ${columns === 3 ? 'grid-cols-3' : 'grid-cols-2'} divide-x divide-gray-100 dark:divide-gray-700 animate-pulse`}>
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
  netSaved, savingsRate,
  portfolioValue, portfolioChangePercent, portfolioChangeAmount,
  periodLabel, fmt, fmtDelta,
  t,
}: {
  totalAssets?: number; totalAssetsChangePercent?: number; totalAssetsChangeAmount?: number;
  netSaved: number; savingsRate: number;
  portfolioValue: number; portfolioChangePercent?: number; portfolioChangeAmount?: number;
  periodLabel: string; fmt: (v: number) => string; fmtDelta: (v: number) => string;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  return (
    <div className={`grid ${totalAssets === undefined ? 'grid-cols-2' : 'grid-cols-3'} divide-x divide-gray-100 dark:divide-gray-700`}>
      {/* Column 1 — Total Assets, only where nothing else states it */}
      {totalAssets !== undefined && (
      <div className="px-2.5 sm:px-5 py-3 sm:py-4 flex flex-col gap-1">
        <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-500 font-medium">
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
        <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-500 font-medium truncate">
          {t('dashboard:todayStrip.saved')} &middot; {periodLabel}
        </p>
        <p
          className={`text-sm sm:text-xl font-bold tabular-nums leading-tight truncate ${netSaved >= 0 ? 'text-prosperity-700 dark:text-prosperity-400' : 'text-error-700 dark:text-error-400'}`}
          aria-label={`Net saved: ${fmt(netSaved)}`}
        >
          {fmt(netSaved)}
        </p>
        <p className="text-xs text-gray-500 dark:text-gray-500">
          {t('dashboard:todayStrip.savingsRate', { rate: savingsRate.toFixed(1) })}
        </p>
      </div>

      {/* Column 3 — Portfolio.
          The delta is the change in the Portfolio wallet's balance over the
          period, so it moves when you buy or sell as well as when the market
          does — buying a holding debits Life and credits Portfolio. Name the
          period and say so on hover, otherwise it reads as an investment
          return and disagrees with the ROI on the portfolio page. */}
      <div className="px-2.5 sm:px-5 py-3 sm:py-4 flex flex-col gap-1">
        <p
          className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-500 font-medium truncate"
          title={t('dashboard:todayStrip.portfolioChangeHint')}
        >
          {t('dashboard:todayStrip.portfolio')} &middot; {periodLabel}
        </p>
        <p
          className="text-sm sm:text-xl font-bold text-gray-900 dark:text-white tabular-nums leading-tight truncate"
          aria-label={`Portfolio value: ${fmt(portfolioValue)}`}
        >
          {fmt(portfolioValue)}
        </p>
        <div className="flex items-center gap-1.5 flex-wrap">
          <PctBadge pct={portfolioChangePercent} />
          <ChangeAmount amount={portfolioChangeAmount} pct={portfolioChangePercent} fmtDelta={fmtDelta} />
        </div>
      </div>
    </div>
  );
}

export function DashboardTodayStrip({
  totalAssets,
  totalAssetsChangePercent,
  totalAssetsChangeAmount,
  netSaved,
  savingsRate,
  portfolioValue,
  portfolioChangePercent,
  portfolioChangeAmount,
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

  const columns = totalAssets === undefined ? 2 : 3;

  if (bare) {
    return isLoading ? (
      <StripSkeleton columns={columns} />
    ) : (
      <StripGrid
        totalAssets={totalAssets} totalAssetsChangePercent={totalAssetsChangePercent}
        totalAssetsChangeAmount={totalAssetsChangeAmount}
        netSaved={netSaved} savingsRate={savingsRate}
        portfolioValue={portfolioValue} portfolioChangePercent={portfolioChangePercent}
        portfolioChangeAmount={portfolioChangeAmount}
        periodLabel={periodLabel} fmt={fmt} fmtDelta={fmtDelta} t={t}
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
          netSaved={netSaved} savingsRate={savingsRate}
          portfolioValue={portfolioValue} portfolioChangePercent={portfolioChangePercent}
          portfolioChangeAmount={portfolioChangeAmount}
          periodLabel={periodLabel} fmt={fmt} fmtDelta={fmtDelta} t={t}
        />
      )}
    </div>
  );
}
