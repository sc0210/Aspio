'use client';

import Link from 'next/link';
import { useTranslation } from 'react-i18next';
import { useFeatures } from '@/hooks/useFeatures';

type Place = 'splits' | 'groups' | 'loans';

/**
 * Aspiro has three ways to track money between people, on three pages: a bill
 * split with one partner (Savings, Shared spending), a group's bills on LINE
 * (Groups), and money lent or borrowed (Loans). Each page points to the other
 * two, so nobody tracks the same debt in the wrong place. Groups is left out
 * when this instance has no LINE bot.
 */
export function RelatedMoneyLinks({ current }: { current: Place }) {
  const { t } = useTranslation('common');
  const { lineBot } = useFeatures();

  const all: { place: Place; href: string; text: string; link: string }[] = [
    { place: 'splits', href: '/savings?tab=splits',
      text: t('relatedMoney.splits', 'Splitting a bill with one partner?'), link: t('relatedMoney.splitsLink', 'Shared spending') },
    { place: 'groups', href: '/groups',
      text: t('relatedMoney.groups', 'Splitting with a group on LINE?'), link: t('relatedMoney.groupsLink', 'Groups') },
    { place: 'loans', href: '/loans',
      text: t('relatedMoney.loans', 'Lent or borrowed money?'), link: t('relatedMoney.loansLink', 'Loans') },
  ];
  const others = all.filter((x) => x.place !== current && (x.place !== 'groups' || lineBot));
  if (others.length === 0) return null;

  return (
    <p className="text-xs text-gray-600 dark:text-gray-400">
      {others.map((x, i) => (
        <span key={x.place}>
          {i > 0 && ' · '}
          {x.text}{' '}
          <Link href={x.href} className="font-medium text-primary-700 dark:text-primary-400 underline-offset-2 hover:underline">
            {x.link}
          </Link>
        </span>
      ))}
    </p>
  );
}
