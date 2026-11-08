'use client';

import Link from 'next/link';
import { useTranslation } from 'react-i18next';
import { ChevronRightIcon } from '@heroicons/react/24/outline';
import { Card } from '@/components/ui/Card';

const STEPS = [
  { step: 1, key: 'recordIncome', href: '/transactions/add' },
  { step: 2, key: 'trackExpenses', href: '/transactions/add' },
  { step: 3, key: 'addInvestments', href: '/portfolio/add' },
  { step: 4, key: 'setGoal', href: '/goals' },
] as const;

/**
 * The first steps for someone with nothing recorded yet. `grid` is the full
 * dashboard's row of four cards; `list` stacks them for the phone and compact
 * views, which showed a new user nothing but zeros.
 */
export function GetStarted({ variant = 'grid' }: { variant?: 'grid' | 'list' }) {
  const { t } = useTranslation('dashboard');
  const title = t('dashboard:onboarding.title');
  const subtitle = t('dashboard:onboarding.subtitle');

  if (variant === 'list') {
    return (
      <section aria-label={title} className="rounded-3xl border border-primary-200 dark:border-primary-800/50 bg-gradient-to-br from-primary-50 to-indigo-50 dark:from-primary-900/10 dark:to-indigo-900/10 p-4">
        <h2 className="text-base font-bold text-gray-900 dark:text-white">{title}</h2>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">{subtitle}</p>
        <ol className="space-y-2">
          {STEPS.map(({ step, key, href }) => (
            <li key={step}>
              <Link href={href} className="block rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400">
                <Card shadow="none" padding="none" className="flex items-center gap-3 min-h-[56px] px-3 py-2.5">
                <span className="w-7 h-7 rounded-full bg-primary-100 dark:bg-primary-900/40 text-primary-700 dark:text-primary-300 text-xs font-bold flex items-center justify-center flex-shrink-0">{step}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-gray-900 dark:text-white">{t(`dashboard:onboarding.steps.${key}.title`)}</span>
                  <span className="block text-xs text-gray-600 dark:text-gray-400">{t(`dashboard:onboarding.steps.${key}.desc`)}</span>
                </span>
                <ChevronRightIcon className="w-4 h-4 text-gray-400 flex-shrink-0" aria-hidden="true" />
                </Card>
              </Link>
            </li>
          ))}
        </ol>
      </section>
    );
  }

  return (
    <section aria-label={title} className="animate-fade-in-up animation-delay-150">
      <div className="rounded-2xl border border-primary-200 dark:border-primary-800/50 bg-gradient-to-br from-primary-50 to-indigo-50 dark:from-primary-900/10 dark:to-indigo-900/10 p-5">
        <h2 className="text-base font-semibold text-gray-900 dark:text-white mb-1">{title}</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">{subtitle}</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {STEPS.map(({ step, key, href }) => (
            // The link wraps the card rather than being one: a surface is not a
            // control, and `Card` has no business rendering an anchor.
            <Link key={step} href={href} className="group block">
              <Card radius="xl" shadow="none" padding="sm"
                className="h-full flex flex-col gap-2 hover:border-primary-300 dark:hover:border-primary-600 hover:shadow-sm transition-all">
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-primary-100 dark:bg-primary-900/40 text-primary-700 dark:text-primary-300 text-xs font-bold flex items-center justify-center flex-shrink-0">{step}</span>
                  <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">{t(`dashboard:onboarding.steps.${key}.title`)}</p>
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400 leading-snug">{t(`dashboard:onboarding.steps.${key}.desc`)}</p>
                <span className="mt-auto text-xs font-medium text-primary-700 dark:text-primary-400 group-hover:underline">{t(`dashboard:onboarding.steps.${key}.cta`)} &rarr;</span>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
