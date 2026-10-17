'use client';

import { useState, FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { useUpdateLoan } from '@/hooks/useLoans';
import { DebtAccount, DebtAccountUpdate, LoanStatus } from '@/services/loanService';
import { useDialog } from '@/hooks/useDialog';

interface Props {
  loan: DebtAccount;
  onClose: () => void;
}

export function EditLoanModal({ loan, onClose }: Props) {
  const { panelRef, dialogProps } = useDialog({ isOpen: true, onClose: onClose });

  const { t } = useTranslation('loans');
  const updateLoan = useUpdateLoan();

  const [form, setForm] = useState<DebtAccountUpdate>({
    name: loan.name,
    lender_name: loan.lender_name ?? '',
    interest_rate: loan.interest_rate,
    minimum_payment: loan.minimum_payment,
    payment_due_day: loan.payment_due_day,
    term_months: loan.term_months ?? undefined,
    status: loan.status as LoanStatus,
    notes: loan.notes ?? '',
  });

  const set = (key: keyof DebtAccountUpdate, value: DebtAccountUpdate[keyof DebtAccountUpdate]) =>
    setForm(prev => ({ ...prev, [key]: value }));

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    await updateLoan.mutateAsync({
      id: loan.id,
      data: {
        ...form,
        lender_name: form.lender_name || undefined,
        notes: form.notes || undefined,
        interest_rate: Number(form.interest_rate),
        minimum_payment: Number(form.minimum_payment),
        payment_due_day: Number(form.payment_due_day),
        term_months: form.term_months ? Number(form.term_months) : undefined,
      },
    });
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div
        ref={panelRef}
        {...dialogProps}
        aria-labelledby="edit-loan-modal-title"
        className="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-lg shadow-xl overflow-y-auto max-h-[90vh]"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <div>
            <h2 id="edit-loan-modal-title" className="text-base font-semibold text-gray-900 dark:text-white">{t('editModal.title')}</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400">{loan.name}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700">
            <XMarkIcon className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {/* Loan name */}
          <div>
            <label htmlFor="edit-name" className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">{t('addModal.loanNameRequired')}</label>
            <input
              id="edit-name"
              required
              type="text"
              value={form.name ?? ''}
              onChange={e => set('name', e.target.value)}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-white px-3 py-2 focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:border-transparent outline-none"
            />
          </div>

          {/* Lender */}
          <div>
            <label htmlFor="edit-lender" className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">{t('addModal.lender')}</label>
            <input
              id="edit-lender"
              type="text"
              value={form.lender_name ?? ''}
              onChange={e => set('lender_name', e.target.value)}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-white px-3 py-2 focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:border-transparent outline-none"
            />
          </div>

          {/* Rate + min payment */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="edit-rate" className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">{t('addModal.interestRate')}</label>
              <input
                id="edit-rate"
                required
                type="number"
                inputMode="decimal"
                onWheel={(e) => e.currentTarget.blur()}
                min="0"
                step="0.01"
                value={form.interest_rate ?? ''}
                onChange={e => set('interest_rate', e.target.value)}
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-white px-3 py-2 focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:border-transparent outline-none"
              />
            </div>
            <div>
              <label htmlFor="edit-minpay" className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">{t('addModal.minPayment')}</label>
              <input
                id="edit-minpay"
                required
                type="number"
                inputMode="numeric"
                onWheel={(e) => e.currentTarget.blur()}
                min="1"
                step="1"
                value={form.minimum_payment ?? ''}
                onChange={e => set('minimum_payment', e.target.value)}
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-white px-3 py-2 focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:border-transparent outline-none"
              />
            </div>
          </div>

          {/* Due day + term + status */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label htmlFor="edit-dueday" className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">{t('addModal.dueDay')}</label>
              <input
                id="edit-dueday"
                required
                type="number"
                inputMode="numeric"
                onWheel={(e) => e.currentTarget.blur()}
                min="1"
                max="31"
                value={form.payment_due_day ?? ''}
                onChange={e => set('payment_due_day', e.target.value)}
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-white px-3 py-2 focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:border-transparent outline-none"
              />
            </div>
            <div>
              <label htmlFor="edit-term" className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">{t('addModal.termMonths')}</label>
              <input
                id="edit-term"
                type="number"
                inputMode="numeric"
                onWheel={(e) => e.currentTarget.blur()}
                min="1"
                value={form.term_months ?? ''}
                onChange={e => set('term_months', e.target.value ? Number(e.target.value) : undefined)}
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-white px-3 py-2 focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:border-transparent outline-none"
              />
            </div>
            <div>
              <label htmlFor="edit-status" className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">{t('editModal.status')}</label>
              <select
                id="edit-status"
                value={form.status ?? loan.status}
                onChange={e => set('status', e.target.value as LoanStatus)}
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-white px-3 py-2 focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:border-transparent outline-none"
              >
                <option value="active">{t('status.active')}</option>
                <option value="paused">{t('status.paused')}</option>
                <option value="paid_off">{t('status.paid_off')}</option>
              </select>
            </div>
          </div>

          {/* Notes */}
          <div>
            <label htmlFor="edit-notes" className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">{t('addModal.notes')}</label>
            <textarea
              id="edit-notes"
              rows={2}
              value={form.notes ?? ''}
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
              disabled={updateLoan.isPending}
              className="flex-1 py-2.5 rounded-xl bg-primary-600 hover:bg-primary-700 text-sm font-medium text-white transition-colors disabled:opacity-50"
            >
              {updateLoan.isPending ? t('editModal.saving') : t('editModal.save')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
