'use client';

import { useState, FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { useRecordPayment } from '@/hooks/useLoans';
import { DebtAccount } from '@/services/loanService';
import { formatCurrency } from '@/utils/formatters';
import { useDialog } from '@/hooks/useDialog';

const fmt = (value: number, currency = 'TWD') => formatCurrency(value, currency, { precision: 0 });

interface Props {
  loan: DebtAccount;
  onClose: () => void;
}

export function RecordPaymentModal({ loan, onClose }: Props) {
  const { panelRef, dialogProps } = useDialog({ isOpen: true, onClose: onClose });

  const { t } = useTranslation('loans');
  const recordPayment = useRecordPayment();
  const today = new Date().toISOString().split('T')[0];

  const [paymentDate, setPaymentDate] = useState(today);
  const [totalAmount, setTotalAmount] = useState(Number(loan.minimum_payment));
  const [principalPortion, setPrincipalPortion] = useState(0);
  const interestPortion = Math.max(0, totalAmount - principalPortion);

  const principalError =
    principalPortion > Number(loan.current_balance)
      ? t('paymentModal.error.exceedsBalance', { amount: fmt(loan.current_balance, loan.currency) })
      : principalPortion + interestPortion !== totalAmount
      ? t('paymentModal.error.splitMismatch')
      : null;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (principalError) return;
    await recordPayment.mutateAsync({
      id: loan.id,
      data: {
        payment_date: paymentDate,
        total_amount: Number(totalAmount),
        principal_portion: Number(principalPortion),
        interest_portion: Number(interestPortion),
      },
    });
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div
        ref={panelRef}
        {...dialogProps}
        aria-labelledby="record-payment-modal-title"
        className="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-md shadow-xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <div>
            <h2 id="record-payment-modal-title" className="text-base font-semibold text-gray-900 dark:text-white">{t('paymentModal.title')}</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400">{loan.name}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700">
            <XMarkIcon className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {/* Balance context */}
          <div className="bg-gray-50 dark:bg-gray-700/50 rounded-xl p-3 flex justify-between text-sm">
            <span className="text-gray-500 dark:text-gray-400">{t('paymentModal.currentBalance')}</span>
            <span className="font-semibold text-gray-900 dark:text-white">{fmt(loan.current_balance, loan.currency)}</span>
          </div>

          {/* Payment date */}
          <div>
            <label htmlFor="pay-date" className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">{t('paymentModal.paymentDate')}</label>
            <input
              id="pay-date"
              required
              type="date"
              value={paymentDate}
              onChange={e => setPaymentDate(e.target.value)}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-white px-3 py-2 focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:border-transparent outline-none"
            />
          </div>

          {/* Total amount */}
          <div>
            <label htmlFor="pay-total" className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">{t('paymentModal.totalPayment')}</label>
            <input
              id="pay-total"
              required
              type="number"
              inputMode="numeric"
              onWheel={(e) => e.currentTarget.blur()}
              min="1"
              step="1"
              value={totalAmount || ''}
              onChange={e => setTotalAmount(Number(e.target.value))}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-white px-3 py-2 focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:border-transparent outline-none"
            />
          </div>

          {/* Split */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="pay-principal" className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">{t('paymentModal.principalPortion')}</label>
              <input
                id="pay-principal"
                required
                type="number"
                inputMode="numeric"
                onWheel={(e) => e.currentTarget.blur()}
                min="0"
                step="1"
                value={principalPortion || ''}
                onChange={e => setPrincipalPortion(Number(e.target.value))}
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-white px-3 py-2 focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:border-transparent outline-none"
              />
            </div>
            <div>
              <label htmlFor="pay-interest" className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">{t('paymentModal.interestPortion')}</label>
              <input
                id="pay-interest"
                readOnly
                type="number"
                inputMode="decimal"
                onWheel={(e) => e.currentTarget.blur()}
                value={interestPortion}
                className="w-full rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700/50 text-sm text-gray-600 dark:text-gray-400 px-3 py-2 outline-none cursor-not-allowed"
              />
            </div>
          </div>

          {/* Error */}
          {principalError && (
            <p className="text-xs text-red-600 dark:text-red-400">{principalError}</p>
          )}

          {/* New balance preview */}
          {!principalError && principalPortion > 0 && (
            <div className="bg-primary-50 dark:bg-primary-900/20 rounded-xl p-3 flex justify-between text-sm">
              <span className="text-gray-600 dark:text-gray-400">{t('paymentModal.balanceAfter')}</span>
              <span className="font-semibold text-primary-700 dark:text-primary-400">
                {fmt(Math.max(0, loan.current_balance - principalPortion), loan.currency)}
              </span>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 rounded-xl border border-gray-300 dark:border-gray-600 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              {t('paymentModal.cancel')}
            </button>
            <button
              type="submit"
              disabled={recordPayment.isPending || !!principalError || principalPortion <= 0}
              className="flex-1 py-2.5 rounded-xl bg-primary-600 hover:bg-primary-700 text-sm font-medium text-white transition-colors disabled:opacity-50"
            >
              {recordPayment.isPending ? t('paymentModal.recording') : t('paymentModal.record')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
