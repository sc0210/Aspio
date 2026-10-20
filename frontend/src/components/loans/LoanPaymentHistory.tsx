'use client';

import { useState } from 'react';
import { ChevronDownIcon, ChevronUpIcon, PencilSquareIcon, TrashIcon } from '@heroicons/react/24/outline';
import { usePaymentHistory, useDeletePayment } from '@/hooks/useLoans';
import { EditPaymentModal } from './EditPaymentModal';
import type { LoanPaymentRecord } from '@/services/loanService';
import { formatCurrency } from '@/utils/formatters';

interface Props {
  loanId: string;
  currency: string;
}

const fmt = (value: number, currency = 'TWD') => formatCurrency(value, currency, { precision: 0 });

function fmtDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function LoanPaymentHistory({ loanId, currency }: Props) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<LoanPaymentRecord | null>(null);
  const { payments, isLoading } = usePaymentHistory(open ? loanId : null);
  const deletePayment = useDeletePayment();

  return (
    <>
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between text-xs font-medium text-gray-600 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 py-1 transition-colors"
      >
        <span>Payment History {payments.length > 0 && !isLoading ? `(${payments.length})` : ''}</span>
        {open ? <ChevronUpIcon className="w-3.5 h-3.5" /> : <ChevronDownIcon className="w-3.5 h-3.5" />}
      </button>

      {open && (
        <div className="mt-1">
          {isLoading ? (
            <p className="text-xs text-gray-500 dark:text-gray-500 text-center py-3">Loading…</p>
          ) : payments.length === 0 ? (
            <p className="text-xs text-gray-500 dark:text-gray-500 text-center py-3">No payments recorded yet.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-gray-100 dark:border-gray-700">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-gray-50 dark:bg-gray-700/50 text-gray-500 dark:text-gray-400">
                    <th className="text-left px-3 py-2 font-medium">Date</th>
                    <th className="text-right px-3 py-2 font-medium">Total</th>
                    <th className="text-right px-3 py-2 font-medium">Principal</th>
                    <th className="text-right px-3 py-2 font-medium">Interest</th>
                    <th className="px-2 py-2"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {payments.map(p => (
                    <tr key={p.transaction_id} className="bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                      <td className="px-3 py-2 text-gray-700 dark:text-gray-300 whitespace-nowrap">
                        {fmtDate(p.payment_date)}
                      </td>
                      <td className="px-3 py-2 text-right text-gray-900 dark:text-white font-medium whitespace-nowrap">
                        {fmt(Number(p.total_amount), currency)}
                      </td>
                      <td className="px-3 py-2 text-right text-primary-700 dark:text-primary-400 whitespace-nowrap">
                        {fmt(Number(p.principal_portion), currency)}
                      </td>
                      <td className="px-3 py-2 text-right text-amber-700 dark:text-amber-400 whitespace-nowrap">
                        {fmt(Number(p.interest_portion), currency)}
                      </td>
                      <td className="px-2 py-2">
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => setEditing(p)}
                            className="p-1 text-gray-500 dark:text-gray-400 hover:text-primary-600 dark:hover:text-primary-400 rounded transition-colors"
                            title="Edit payment"
                          >
                            <PencilSquareIcon className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => {
                              if (confirm('Delete this payment? The loan balance will be restored.')) {
                                deletePayment.mutate({ loanId, transactionId: p.transaction_id });
                              }
                            }}
                            disabled={deletePayment.isPending}
                            className="p-1 text-gray-500 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400 rounded transition-colors disabled:opacity-40"
                            title="Delete payment"
                          >
                            <TrashIcon className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {editing && (
        <EditPaymentModal
          loanId={loanId}
          payment={editing}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}
