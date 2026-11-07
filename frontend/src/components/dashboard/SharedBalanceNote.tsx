'use client';

import Link from 'next/link';
import { useTranslation } from 'react-i18next';
import { UsersIcon } from '@heroicons/react/24/outline';
import { useSplitBalances } from '@/hooks/useSplitBalances';
import { usePrivacy } from '@/contexts/PrivacyContext';
import { formatCurrency } from '@/utils/formatters';
import { Card } from '@/components/ui/Card';

const money = (value: number, currency: string) =>
  formatCurrency(Math.abs(value), currency, currency === 'TWD' ? { precision: 0 } : {});

/**
 * Why the cash wallets differ from the bank while shared bills are open.
 *
 * Splits are on a share basis: each ledger holds only its owner's share. Pay a
 * 1,000 dinner and split it, and the app counts 500 spent while the bank shows
 * 1,000 gone, until the partner pays you back. Without saying so, the wallet
 * total just looks wrong. Renders nothing when nobody owes anything.
 */
export function SharedBalanceNote() {
  const { t } = useTranslation('dashboard');
  const { isValueVisible } = usePrivacy();
  const { data } = useSplitBalances();

  const owed = (data ?? []).flatMap((b) =>
    b.balances.filter((x) => x.net !== 0).map((x) => ({ name: b.partner_name, ...x })),
  );
  if (owed.length === 0) return null;

  // Per currency: > 0, the wallets read higher than the bank; < 0, lower.
  const totals = new Map<string, number>();
  for (const x of owed) totals.set(x.currency, (totals.get(x.currency) ?? 0) + x.net);
  const hidden = '•••';
  const show = (value: number, currency: string) => (isValueVisible ? money(value, currency) : hidden);

  return (
    <section aria-label={t('sharedBalance.label', 'Shared bills')}>
      <Card padding="none" shadow="none" className="px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3">
      <div className="flex items-start gap-3 flex-1 min-w-0">
        <span className="grid place-items-center w-9 h-9 rounded-lg bg-sky-50 dark:bg-sky-900/30 flex-shrink-0">
          <UsersIcon className="w-5 h-5 text-sky-700 dark:text-sky-300" aria-hidden="true" />
        </span>
        <div className="min-w-0 text-sm">
          <p className="font-semibold text-gray-900 dark:text-white">
            {owed.map((x, i) => (
              <span key={`${x.name}-${x.currency}`}>
                {i > 0 && ' · '}
                {x.net > 0
                  ? t('sharedBalance.owesYou', '{{name}} owes you {{amount}}', { name: x.name, amount: show(x.net, x.currency) })
                  : t('sharedBalance.youOwe', 'You owe {{name}} {{amount}}', { name: x.name, amount: show(x.net, x.currency) })}
              </span>
            ))}
          </p>
          <p className="text-gray-600 dark:text-gray-400">
            {[...totals.entries()].filter(([, v]) => v !== 0).map(([currency, v]) => (
              <span key={currency} className="block">
                {v > 0
                  ? t('sharedBalance.higher', 'Your wallets count only your share of shared bills, so they read {{amount}} more than your bank until you’re paid back.', { amount: show(v, currency) })
                  : t('sharedBalance.lower', 'Your wallets already count your share of shared bills, so they read {{amount}} less than your bank until you pay it.', { amount: show(v, currency) })}
              </span>
            ))}
          </p>
        </div>
      </div>
      <Link
        href="/savings?tab=splits"
        className="self-start sm:self-center shrink-0 inline-flex items-center min-h-[44px] px-3 rounded-lg text-sm font-semibold text-primary-700 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/20"
      >
        {t('sharedBalance.settle', 'Settle up')} &rarr;
      </Link>
      </Card>
    </section>
  );
}
