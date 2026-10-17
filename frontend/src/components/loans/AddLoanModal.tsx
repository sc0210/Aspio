'use client';

import { useState, FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { useCreateLoan } from '@/hooks/useLoans';
import { DebtAccountCreate, LoanAccountType } from '@/services/loanService';
import { useDialog } from '@/hooks/useDialog';

const ACCOUNT_TYPE_VALUES: LoanAccountType[] = [
  'personal_loan',
  'mortgage',
  'auto_loan',
  'student_loan',
  'credit_card',
  'other',
];

interface Props {
  onClose: () => void;
}

export function AddLoanModal({ onClose }: Props) {
  const { panelRef, dialogProps } = useDialog({ isOpen: true, onClose: onClose });

  const { t } = useTranslation('loans');
  const createLoan = useCreateLoan();
  const today = new Date().toISOString().split('T')[0];

  const [form, setForm] = useState<DebtAccountCreate>({
    name: '',
    lender_name: '',
    account_type: 'personal_loan',
    principal_amount: 0,
    interest_rate: 0,
    minimum_payment: 0,
    payment_due_day: 1,
    start_date: today,
    term_months: undefined,
    currency: 'TWD',
    notes: '',
  });

  const set = (key: keyof DebtAccountCreate, value: DebtAccountCreate[keyof DebtAccountCreate]) =>
    setForm(prev => ({ ...prev, [key]: value }));

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const payload: DebtAccountCreate = {
      ...form,
      principal_amount: Number(form.principal_amount),
      interest_rate: Number(form.interest_rate),
      minimum_payment: Number(form.minimum_payment),
      payment_due_day: Number(form.payment_due_day),
      term_months: form.term_months ? Number(form.term_months) : undefined,
      lender_name: form.lender_name || undefined,
      notes: form.notes || undefined,
    };
    await createLoan.mutateAsync(payload);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div
        ref={panelRef}
        {...dialogProps}
        aria-labelledby="add-loan-modal-title"
        className="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-lg shadow-xl overflow-y-auto max-h-[90vh]"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 id="add-loan-modal-title" className="text-base font-semibold text-gray-900 dark:text-white">{t('addModal.title')}</h2>
          <button type="button" onClick={onClose} aria-label={t('common.close', 'Close')} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700">
            <XMarkIcon className="w-5 h-5 text-gray-500" aria-hidden="true" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {/* Loan name */}
          <div>
            <label htmlFor="add-name" className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">{t('addModal.loanNameRequired')}</label>
            <input
              id="add-name"
              required
              type="text"
              placeholder={t('addModal.loanNamePlaceholder')}
              value={form.name}
              onChange={e => set('name', e.target.value)}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-white px-3 py-2 focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:border-transparent outline-none"
            />
          </div>

          {/* Lender + type */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="add-lender" className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">{t('addModal.lender')}</label>
              <input
                id="add-lender"
                type="text"
                placeholder={t('addModal.lenderPlaceholder')}
                value={form.lender_name}
                onChange={e => set('lender_name', e.target.value)}
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-white px-3 py-2 focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:border-transparent outline-none"
              />
            </div>
            <div>
              <label htmlFor="add-type" className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">{t('addModal.typeRequired')}</label>
              <select
                id="add-type"
                required
                value={form.account_type}
                onChange={e => set('account_type', e.target.value as LoanAccountType)}
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-white px-3 py-2 focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:border-transparent outline-none"
              >
                {ACCOUNT_TYPE_VALUES.map(value => (
                  <option key={value} value={value}>{t(`accountTypes.${value}`)}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Principal + balance */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="add-principal" className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">{t('addModal.principalAmount')}</label>
              <input
                id="add-principal"
                required
                type="number"
                inputMode="numeric"
                onWheel={(e) => e.currentTarget.blur()}
                min="1"
                step="1"
                placeholder="1000000"
                value={form.principal_amount || ''}
                onChange={e => set('principal_amount', e.target.value)}
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-white px-3 py-2 focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:border-transparent outline-none"
              />
            </div>
            <div>
              <label htmlFor="add-balance" className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">{t('addModal.currentBalance')}</label>
              <input
                id="add-balance"
                type="number"
                inputMode="numeric"
                onWheel={(e) => e.currentTarget.blur()}
                min="0"
                step="1"
                placeholder={t('addModal.currentBalancePlaceholder')}
                value={form.current_balance || ''}
                onChange={e => set('current_balance', e.target.value ? Number(e.target.value) : undefined)}
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-white px-3 py-2 focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:border-transparent outline-none"
              />
            </div>
          </div>

          {/* Rate + min payment */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="add-rate" className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">{t('addModal.interestRate')}</label>
              <input
                id="add-rate"
                required
                type="number"
                inputMode="decimal"
                onWheel={(e) => e.currentTarget.blur()}
                min="0"
                step="0.01"
                placeholder="2.75"
                value={form.interest_rate || ''}
                onChange={e => set('interest_rate', e.target.value)}
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-white px-3 py-2 focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:border-transparent outline-none"
              />
            </div>
            <div>
              <label htmlFor="add-minpay" className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">{t('addModal.minPayment')}</label>
              <input
                id="add-minpay"
                required
                type="number"
                inputMode="numeric"
                onWheel={(e) => e.currentTarget.blur()}
                min="1"
                step="1"
                placeholder="30000"
                value={form.minimum_payment || ''}
                onChange={e => set('minimum_payment', e.target.value)}
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-white px-3 py-2 focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:border-transparent outline-none"
              />
            </div>
          </div>

          {/* Due day + term + start date */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label htmlFor="add-dueday" className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">{t('addModal.dueDay')}</label>
              <input
                id="add-dueday"
                required
                type="number"
                inputMode="numeric"
                onWheel={(e) => e.currentTarget.blur()}
                min="1"
                max="31"
                placeholder="15"
                value={form.payment_due_day || ''}
                onChange={e => set('payment_due_day', e.target.value)}
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-white px-3 py-2 focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:border-transparent outline-none"
              />
            </div>
            <div>
              <label htmlFor="add-term" className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">{t('addModal.termMonths')}</label>
              <input
                id="add-term"
                type="number"
                inputMode="numeric"
                onWheel={(e) => e.currentTarget.blur()}
                min="1"
                placeholder="360"
                value={form.term_months || ''}
                onChange={e => set('term_months', e.target.value ? Number(e.target.value) : undefined)}
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-white px-3 py-2 focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:border-transparent outline-none"
              />
            </div>
            <div>
              <label htmlFor="add-startdate" className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">{t('addModal.startDate')}</label>
              <input
                id="add-startdate"
                required
                type="date"
                value={form.start_date}
                onChange={e => set('start_date', e.target.value)}
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-white px-3 py-2 focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:border-transparent outline-none"
              />
            </div>
          </div>

          {/* Notes */}
          <div>
            <label htmlFor="add-notes" className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">{t('addModal.notes')}</label>
            <textarea
              id="add-notes"
              rows={2}
              placeholder={t('addModal.notesPlaceholder')}
              value={form.notes}
              onChange={e => set('notes', e.target.value)}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-white px-3 py-2 focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:border-transparent outline-none resize-none"
            />
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 rounded-xl border border-gray-300 dark:border-gray-600 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              {t('addModal.cancel')}
            </button>
            <button
              type="submit"
              disabled={createLoan.isPending}
              className="flex-1 py-2.5 rounded-xl bg-primary-600 hover:bg-primary-700 text-sm font-medium text-white transition-colors disabled:opacity-50"
            >
              {createLoan.isPending ? t('addModal.creating') : t('addModal.add')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
