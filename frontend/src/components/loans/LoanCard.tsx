'use client';

import { useTranslation } from 'react-i18next';
import {
  CalendarDaysIcon,
  ChartBarIcon,
  CheckCircleIcon,
} from '@heroicons/react/24/outline';
import { DebtAccount, LoanAccountType } from '@/services/loanService';
import { LoanPaymentHistory } from './LoanPaymentHistory';
import { formatCurrency } from '@/utils/formatters';
import { Card } from '@/components/ui/Card';
import { cn } from '@/utils/cn';

const ACCOUNT_TYPE_COLORS: Record<LoanAccountType, string> = {
  personal_loan: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400',
  mortgage: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400',
  auto_loan: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  student_loan: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  credit_card: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  other: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
};

const fmt = (value: number, currency = 'TWD') => formatCurrency(value, currency, { precision: 0 });

function fmtDate(dateStr: string | null) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

interface LoanCardProps {
  loan: DebtAccount;
  onRecordPayment: (loan: DebtAccount) => void;
  onEdit: (loan: DebtAccount) => void;
  onDelete: (loan: DebtAccount) => void;
}

export function LoanCard({ loan, onRecordPayment, onEdit, onDelete }: LoanCardProps) {
  const { t } = useTranslation('loans');
  const isPaidOff = loan.status === 'paid_off';
  const progress = loan.progress_pct ?? 0;

  return (
    <Card
      radius="xl"
      className={cn(
        'flex flex-col gap-4 hover:border-primary-400 dark:hover:border-primary-500 hover:shadow-lg transition-all duration-200',
        isPaidOff && 'border-emerald-200 dark:border-emerald-800/50',
      )}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white leading-tight truncate">{loan.name}</h3>
          {loan.lender_name && (
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{loan.lender_name}</p>
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {isPaidOff && (
            <span className="flex items-center gap-1 text-xs font-medium text-prosperity-700 dark:text-prosperity-400 bg-prosperity-50 dark:bg-prosperity-900/30 px-2 py-0.5 rounded-full">
              <CheckCircleIcon className="w-3 h-3" /> {t('card.paidOff')}
            </span>
          )}
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${ACCOUNT_TYPE_COLORS[loan.account_type]}`}>
            {t(`accountTypes.${loan.account_type}`)}
          </span>
        </div>
      </div>

      {/* Balance + progress */}
      <div>
        <div className="flex justify-between items-baseline mb-2 gap-2">
          <span className="text-xl font-bold text-gray-900 dark:text-white truncate">
            {fmt(loan.current_balance, loan.currency)}
          </span>
          <span className="text-xs text-gray-500 dark:text-gray-400 shrink-0">
            / {fmt(loan.principal_amount, loan.currency)}
          </span>
        </div>

        <div
          role="progressbar"
          aria-valuenow={Math.min(Math.round(progress), 100)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Repayment progress"
          className="relative w-full h-2.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden"
        >
          <div
            className={`h-full rounded-full transition-all duration-500 ${isPaidOff ? 'bg-prosperity-500' : 'bg-primary-500'}`}
            style={{ width: `${Math.min(progress, 100)}%` }}
          />
        </div>

        <div className="flex justify-between items-center mt-1.5 gap-2">
          <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
            {t('card.repaid', { progress: progress.toFixed(1) })}
          </span>
          {!isPaidOff && (
            <span className="text-xs text-gray-500 dark:text-gray-400 shrink-0">
              {t('card.remaining', { amount: fmt(loan.current_balance, loan.currency) })}
            </span>
          )}
        </div>
      </div>

      {/* Key metrics */}
      <div className="grid grid-cols-2 gap-3 text-center">
        <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg py-2.5 px-3">
          <p className="text-xs text-gray-500 dark:text-gray-400">{t('card.rate')}</p>
          <p className="text-sm font-semibold text-gray-900 dark:text-white">{loan.interest_rate}%</p>
        </div>
        <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg py-2.5 px-3">
          <p className="text-xs text-gray-500 dark:text-gray-400">{t('card.minPayment')}</p>
          <p className="text-sm font-semibold text-gray-900 dark:text-white">{fmt(loan.minimum_payment, loan.currency)}</p>
        </div>
      </div>

      {/* Secondary info */}
      {!isPaidOff && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
          <div className="flex items-center gap-1">
            <CalendarDaysIcon className="w-3.5 h-3.5" />
            <span>{t('card.next', { date: fmtDate(loan.next_payment_date) })}</span>
          </div>
          {loan.months_remaining != null && (
            <div className="flex items-center gap-1">
              <ChartBarIcon className="w-3.5 h-3.5" />
              <span>{t('card.monthsLeft')}: {loan.months_remaining}</span>
            </div>
          )}
          {/* Surface the payoff estimate only when it contradicts the contract
              term — that gap means the stored minimum payment does not actually
              amortise the balance over the term, which is worth knowing. */}
          {loan.payoff_months_estimate != null &&
            loan.months_remaining != null &&
            loan.payoff_months_estimate !== loan.months_remaining && (
              <div className="flex items-center gap-1">
                <span
                  className="text-amber-700 dark:text-amber-400"
                  title={t('card.payoffEstimateHint')}
                >
                  {t('card.payoffEstimate', { count: loan.payoff_months_estimate })}
                </span>
              </div>
            )}
          {loan.total_interest_remaining != null && (
            <div className="flex items-center gap-1 w-full">
              <span>{t('card.interestLeft', { amount: fmt(loan.total_interest_remaining, loan.currency) })}</span>
            </div>
          )}
        </div>
      )}

      {/* Payment history */}
      <div className="border-t border-gray-100 dark:border-gray-700 pt-3">
        <LoanPaymentHistory loanId={loan.id} currency={loan.currency} />
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        {!isPaidOff && (
          <button
            onClick={(e) => { e.stopPropagation(); onRecordPayment(loan); }}
            className="flex-1 px-4 py-2.5 min-h-[44px] bg-primary-700 hover:bg-primary-800 text-white text-sm font-medium rounded-lg transition-colors duration-200 shadow-sm hover:shadow-md touch-manipulation"
          >
            {t('card.recordPayment')}
          </button>
        )}
        <button
          onClick={(e) => { e.stopPropagation(); onEdit(loan); }}
          aria-label={t('card.editLoan')}
          className="flex items-center justify-center gap-1.5 px-4 py-2.5 min-h-[44px] border-2 border-primary-300 dark:border-primary-600 hover:bg-primary-50 dark:hover:bg-primary-900/30 text-primary-700 dark:text-primary-300 text-sm font-semibold rounded-lg transition-all duration-200 hover:border-primary-400 dark:hover:border-primary-500 hover:shadow-sm touch-manipulation"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
          </svg>
          {t('card.edit')}
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(loan); }}
          aria-label={t('card.deleteLoan')}
          className="px-4 py-2.5 min-h-[44px] border border-red-300 dark:border-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 text-error-700 dark:text-error-400 text-sm font-medium rounded-lg transition-colors duration-200 touch-manipulation"
        >
          {t('card.delete')}
        </button>
      </div>
    </Card>
  );
}
