'use client';

import { useTranslation } from 'react-i18next';
import { useLifeCash } from '@/hooks/useGoals';
import { usePrivacy } from '@/contexts/PrivacyContext';
import { formatTWD } from '@/utils/formatters';
import { cn } from '@/utils/cn';
import { Card } from '@/components/ui/Card';

/**
 * Life Wallet, the part goals hold, and what is left to spend
 * (goals/reservations.py). Shown where money is set aside, so the effect of a
 * reservation is visible where it is made. Nothing in demo mode or while loading.
 */
export function LifeCashSummary({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation('goals');
  const { data: cash } = useLifeCash();
  const { isValueVisible } = usePrivacy();
  if (!cash) return null;

  const money = (n: number) => (isValueVisible ? formatTWD(n) : '•••••');
  const negative = cash.available < 0;
  const items = [
    { key: 'life', label: t('goals:reserve.summaryLife'), value: money(cash.lifeBalance) },
    { key: 'reserved', label: t('goals:reserve.summaryReserved'), value: money(cash.reserved) },
    { key: 'available', label: t('goals:reserve.summaryAvailable'), value: money(cash.available), strong: true },
  ];

  return (
    <section aria-label={t('goals:reserve.summaryAria')}>
      <Card padding={compact ? 'sm' : 'md'} radius="xl" shadow="none">
        <dl className={cn('grid grid-cols-3', compact ? 'gap-2' : 'gap-3')}>
          {items.map(({ key, label, value, strong }) => (
            <div key={key} className="min-w-0">
              <dt className="text-xs font-medium text-gray-500 dark:text-gray-400">{label}</dt>
              <dd
                className={cn(
                  'tabular-nums truncate',
                  compact ? 'text-sm' : 'text-lg',
                  strong ? 'font-bold' : 'font-semibold',
                  strong && negative ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-white',
                )}
              >
                {value}
              </dd>
            </div>
          ))}
        </dl>
        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
          {negative ? t('goals:reserve.summaryOverspent') : t('goals:reserve.summaryHint')}
        </p>
      </Card>
    </section>
  );
}
