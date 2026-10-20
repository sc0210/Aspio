'use client';

import { useState, FormEvent } from 'react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { useUpdatePayment } from '@/hooks/useLoans';
import type { LoanPaymentRecord } from '@/services/loanService';
import { useDialog } from '@/hooks/useDialog';

interface Props {
  loanId: string;
  payment: LoanPaymentRecord;
  onClose: () => void;
}

export function EditPaymentModal({ loanId, payment, onClose }: Props) {
  const { panelRef, dialogProps } = useDialog({ isOpen: true, onClose: onClose });

  const updatePayment = useUpdatePayment();

  const [paymentDate, setPaymentDate] = useState(payment.payment_date);
  const [totalAmount, setTotalAmount] = useState(Number(payment.total_amount));
  const [principalPortion, setPrincipalPortion] = useState(Number(payment.principal_portion));
  const [notes, setNotes] = useState(payment.notes ?? '');

  const interestPortion = Math.max(0, totalAmount - principalPortion);

  const splitError =
    principalPortion > 0 && Math.abs(principalPortion + interestPortion - totalAmount) > 0.01
      ? 'Principal + interest must equal total'
      : null;

  const isValid = totalAmount > 0 && principalPortion >= 0 && !splitError;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!isValid) return;
    await updatePayment.mutateAsync({
      loanId,
      transactionId: payment.transaction_id,
      data: {
        payment_date: paymentDate,
        total_amount: totalAmount,
        principal_portion: principalPortion,
        interest_portion: interestPortion,
        notes: notes || undefined,
      },
    });
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div
        ref={panelRef}
        {...dialogProps}
        aria-labelledby="edit-payment-modal-title"
        className="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-md shadow-xl"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <div>
            <h2 id="edit-payment-modal-title" className="text-base font-semibold text-gray-900 dark:text-white">Edit Payment</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400">{payment.payment_date}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700">
            <XMarkIcon className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          <div>
            <label htmlFor="ep-date" className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Payment Date</label>
            <input
              id="ep-date"
              type="date"
              required
              value={paymentDate}
              onChange={e => setPaymentDate(e.target.value)}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-white px-3 py-2 focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:border-transparent outline-none"
            />
          </div>

          <div>
            <label htmlFor="ep-total" className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Total Amount</label>
            <input
              id="ep-total"
              type="number"
              inputMode="numeric"
              onWheel={(e) => e.currentTarget.blur()}
              required
              min="1"
              step="1"
              value={totalAmount || ''}
              onChange={e => setTotalAmount(Number(e.target.value))}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-white px-3 py-2 focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:border-transparent outline-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="ep-principal" className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Principal</label>
              <input
                id="ep-principal"
                type="number"
                inputMode="numeric"
                onWheel={(e) => e.currentTarget.blur()}
                required
                min="0"
                step="1"
                value={principalPortion || ''}
                onChange={e => setPrincipalPortion(Number(e.target.value))}
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-white px-3 py-2 focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:border-transparent outline-none"
              />
            </div>
            <div>
              <label htmlFor="ep-interest" className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Interest (auto)</label>
              <input
                id="ep-interest"
                type="number"
                inputMode="decimal"
                onWheel={(e) => e.currentTarget.blur()}
                readOnly
                value={interestPortion}
                className="w-full rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700/50 text-sm text-gray-600 dark:text-gray-400 px-3 py-2 outline-none cursor-not-allowed"
              />
            </div>
          </div>

          {splitError && (
            <p className="text-xs text-red-700 dark:text-red-400">{splitError}</p>
          )}

          <div>
            <label htmlFor="ep-notes" className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Notes</label>
            <textarea
              id="ep-notes"
              rows={2}
              value={notes}
              onChange={e => setNotes(e.target.value)}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-white px-3 py-2 focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:border-transparent outline-none resize-none"
            />
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 rounded-xl border border-gray-300 dark:border-gray-600 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!isValid || updatePayment.isPending}
              className="flex-1 py-2.5 rounded-xl bg-primary-700 hover:bg-primary-800 text-sm font-medium text-white transition-colors disabled:opacity-50"
            >
              {updatePayment.isPending ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
