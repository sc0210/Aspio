'use client';

import { useTranslation } from 'react-i18next';
import type { PeerStatCard } from '@/shared/types';
import { formatCurrency as formatCurrencyUtil } from '@/utils/formatters';
import { PERSON_COLORS, personColors } from './personColors';

interface CompareStatCardsProps {
  users: PeerStatCard[];
  /** Display currency (the signed-in user's preferred currency). */
  currency: string;
}


export default function CompareStatCards({ users, currency }: CompareStatCardsProps) {
  const { t } = useTranslation('common');
  const formatCurrency = (value: number) => money(value, currency);
  const colors = personColors(users.map((u) => u.user_id), users.find((u) => u.is_self)?.user_id);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {users.map((user) => (
        <div
          key={user.user_id}
          className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm"
        >
          <div className="flex items-center gap-3 mb-4">
            <div
              className={`w-10 h-10 rounded-full ${(colors.get(user.user_id) ?? PERSON_COLORS[0]).avatar} flex items-center justify-center text-white font-semibold text-sm shrink-0`}
            >
              {user.name.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">
                  {user.name}
                </p>
                {user.is_self && (
                  <span className="shrink-0 text-xs font-medium px-1.5 py-0.5 rounded-full bg-primary-100 dark:bg-primary-900/40 text-primary-700 dark:text-primary-300">
                    {t('compare.youBadge', 'You')}
                  </span>
                )}
              </div>
              {user.username && (
                <p className="text-xs text-gray-500 dark:text-gray-400 truncate">@{user.username}</p>
              )}
            </div>
          </div>

          <div className="space-y-2.5">
            <StatRow label={t('compare.statPortfolio', 'Portfolio')} value={user.wallet_totals.portfolio_total} currency={currency} />
            <StatRow label={t('compare.statEmergency', 'Emergency Fund')} value={user.wallet_totals.emergency_total} currency={currency} />
            <StatRow label={t('compare.statCashHoldings', 'Cash in portfolio')} value={user.wallet_totals.cash_total} currency={currency} />
            <StatRow label={t('compare.statLife', 'Life Wallet')} value={user.wallet_totals.life_total} currency={currency} />
            {/* Shown negative: the net worth below is the rows above less this. */}
            <StatRow label={t('compare.statDebt', 'Debt')} value={user.wallet_totals.debt_total ? -user.wallet_totals.debt_total : 0} currency={currency} />
            <div className="pt-2 border-t border-gray-100 dark:border-gray-700">
              <div className="flex justify-between items-center">
                <span className="text-sm font-semibold text-gray-900 dark:text-white">
                  {t('compare.statNetWorth', 'Net Worth')}
                </span>
                <span className="text-sm font-bold text-gray-900 dark:text-white">
                  {formatCurrency(user.wallet_totals.net_worth)}
                </span>
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// en-US so TWD shows its distinct "NT$" (zh-TW renders a bare "$"); whole dollars
// for TWD, as everywhere else in the app, instead of "NT$2,000,000.00".
const money = (value: number, currency: string) =>
  formatCurrencyUtil(value, currency, { locale: 'en-US', ...(currency === 'TWD' ? { precision: 0 } : {}) });

function StatRow({ label, value, currency }: { label: string; value: number; currency: string }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-xs text-gray-500 dark:text-gray-400">{label}</span>
      <span className="text-xs font-medium text-gray-900 dark:text-white tabular-nums">{money(value, currency)}</span>
    </div>
  );
}
