'use client';

import { useTranslation } from 'react-i18next';
import Link from 'next/link';
import { BanknotesIcon, ExclamationTriangleIcon, InformationCircleIcon } from '@heroicons/react/24/outline';
import { usePrivacy } from '@/contexts/PrivacyContext';
import { formatTWDCompact } from '@/utils/formatters';
import { cn } from '@/utils/cn';
import type { DebtAccount } from '@/services/loanService';
import { Card } from '@/components/ui/Card';


interface Props {
    loans: DebtAccount[];
    selectedIds: string[];
    onToggle: (loanId: string) => void;
    configured: boolean;
}

/**
 * Which loans funded the portfolio.
 *
 * `DebtAccount` has no field marking a loan's purpose, so the strategy's most
 * basic input — how much of your debt is investment debt — has to be chosen
 * here and remembered locally. A mortgage and a margin-substitute personal loan
 * are both debt, but only one belongs in the leverage ratio.
 */
export function InvestmentLoanPicker({ loans, selectedIds, onToggle, configured }: Props) {
    const { t } = useTranslation('common');
    const { isValueVisible } = usePrivacy();

    const active = loans.filter((l) => l.status === 'active');

    if (active.length === 0) {
        return (
            <Card padding="md">
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-1.5 mb-2">
                    <BanknotesIcon className="w-4 h-4 text-indigo-500" />
                    {t('lifecycle.loans.title', 'Which loans funded the portfolio?')}
                </h3>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                    {t('lifecycle.loans.none', 'No active loans recorded yet.')}{' '}
                    <Link href="/loans" className="text-indigo-600 dark:text-indigo-400 underline underline-offset-2 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400">
                        {t('lifecycle.loans.addOne', 'Add one on the Loans page')}
                    </Link>
                    {' '}{t('lifecycle.loans.thenReturn', 'and it will appear here.')}
                </p>
            </Card>
        );
    }

    return (
        <Card padding="md">
            <div className="flex items-start justify-between gap-2 mb-1">
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-1.5">
                    <BanknotesIcon className="w-4 h-4 text-indigo-500" />
                    {t('lifecycle.loans.title', 'Which loans funded the portfolio?')}
                </h3>
                <span className="text-sm text-gray-500 dark:text-gray-500 shrink-0">
                    {t('lifecycle.loans.count', '{{n}} selected', { n: selectedIds.length })}
                </span>
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-500 mb-3">
                {t('lifecycle.loans.hint', 'Only these count as investment debt. A mortgage or car loan affects net worth but is not part of the strategy.')}
            </p>

            {/* Before the user pins a choice the selection is auto-derived, so say
                so — a silent guess about which debt is investment debt would
                quietly change every number on the page. */}
            {!configured && (
                selectedIds.length > 0 ? (
                    <div className="mb-3 flex items-start gap-2 rounded-xl border border-primary-200 dark:border-primary-700/50 bg-primary-50 dark:bg-primary-900/20 p-2.5">
                        <InformationCircleIcon className="w-4 h-4 text-primary-500 shrink-0 mt-0.5" />
                        <p className="text-sm text-primary-700 dark:text-primary-300 leading-relaxed">
                            {t('lifecycle.loans.autoSelected', 'Your personal loans are counted as investment debt by default. Untick any that funded something else.')}
                        </p>
                    </div>
                ) : (
                    <div className="mb-3 flex items-start gap-2 rounded-xl border border-warning-200 dark:border-warning-700/50 bg-warning-50 dark:bg-warning-900/20 p-2.5">
                        <ExclamationTriangleIcon className="w-4 h-4 text-warning-700 dark:text-warning-500 shrink-0 mt-0.5" />
                        <p className="text-sm text-warning-700 dark:text-warning-300 leading-relaxed">
                            {t('lifecycle.loans.unconfigured', 'None of your loans look like investment debt. Tick the ones that funded the portfolio — every gauge above reads zero until you do.')}
                        </p>
                    </div>
                )
            )}

            <div className="space-y-2">
                {active.map((loan) => {
                    const checked = selectedIds.includes(loan.id);
                    return (
                        <label
                            key={loan.id}
                            className={cn(
                                'flex items-center gap-3 rounded-xl border p-3 cursor-pointer transition-colors',
                                checked
                                    ? 'border-indigo-300 dark:border-indigo-600/60 bg-indigo-50/70 dark:bg-indigo-900/20'
                                    : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/40',
                            )}
                        >
                            <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => onToggle(loan.id)}
                                className="rounded border-gray-300 dark:border-gray-600 text-indigo-600 focus-visible:ring-indigo-500 cursor-pointer"
                            />
                            <div className="min-w-0 flex-1">
                                <p className="text-xs font-semibold text-gray-800 dark:text-gray-100 truncate">{loan.name}</p>
                                <p className="text-xs text-gray-500 dark:text-gray-400">
                                    {loan.interest_rate}% APR
                                    {loan.months_remaining != null && (
                                        <> · {t('lifecycle.loans.monthsLeft', '{{n}} mo left', { n: loan.months_remaining })}</>
                                    )}
                                </p>
                            </div>
                            <span className="text-xs font-bold tabular-nums text-gray-700 dark:text-gray-200 shrink-0">
                                {isValueVisible ? formatTWDCompact(loan.current_balance) : '•••'}
                            </span>
                        </label>
                    );
                })}
            </div>
        </Card>
    );
}
