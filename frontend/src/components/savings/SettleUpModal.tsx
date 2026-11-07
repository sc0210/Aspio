'use client';

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { apiClient } from '@/lib/api-client';
import { useDialog } from '@/hooks/useDialog';

export interface SettleTarget {
  connectionId: string;
  partnerName: string;
  currency: string;
  /** > 0: the partner owes you; < 0: you owe them. */
  net: number;
}

interface SettleUpModalProps {
  target: SettleTarget | null;
  onClose: () => void;
  onSuccess: () => void;
}

const INPUT =
  'w-full px-3 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500';
const LABEL = 'block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1';

/**
 * Record a repayment against the balance. Nothing is added to either account:
 * each already holds only its owner's share. If they paid you it counts at
 * once; if you paid them, they confirm it arrived.
 */
export default function SettleUpModal({ target, onClose, onSuccess }: SettleUpModalProps) {
  const { t } = useTranslation('common');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const isOpen = target !== null;

  // Each open starts from the full balance.
  useEffect(() => {
    if (!target) return;
    setAmount(Math.abs(target.net).toFixed(2));
    setNote('');
    setError('');
  }, [target]);

  const { panelRef, dialogProps } = useDialog({ isOpen, onClose });
  if (!target) return null;

  const theyOwe = target.net > 0;
  const outstanding = Math.abs(target.net);
  const value = parseFloat(amount) || 0;
  const tooMuch = value > outstanding + 1e-9;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (value <= 0 || tooMuch) return;
    setSubmitting(true);
    setError('');
    try {
      await apiClient.createSettlement({
        connection_id: target.connectionId,
        direction: theyOwe ? 'they_paid_me' : 'i_paid_them',
        amount: value,
        currency: target.currency,
        note: note.trim() || null,
      });
      onSuccess();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('savings.splits.errors.actionFailed', 'That didn’t work'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-gray-900/60" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        {...dialogProps}
        aria-labelledby="settle-title"
        className="relative bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-sm p-6"
      >
        <div className="flex items-center justify-between mb-4">
          <h2 id="settle-title" className="text-base font-semibold text-gray-900 dark:text-white">
            {theyOwe
              ? t('savings.splits.settle.receivedTitle', '{{name}} paid you back', { name: target.partnerName })
              : t('savings.splits.settle.paidTitle', 'You paid {{name}} back', { name: target.partnerName })}
          </h2>
          <button
            onClick={onClose}
            aria-label={t('common.close', 'Close')}
            className="min-w-[44px] min-h-[44px] flex items-center justify-center text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
          >
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="settle-amount" className={LABEL}>
              {t('savings.splits.settle.amount', 'Amount ({{currency}})', { currency: target.currency })}
            </label>
            <input id="settle-amount" type="number" inputMode="decimal" min="0.01" step="0.01" required
              value={amount} onWheel={(e) => e.currentTarget.blur()} onChange={(e) => setAmount(e.target.value)}
              className={INPUT} />
            {tooMuch && (
              <p className="mt-1 text-xs text-error-700 dark:text-error-400">
                {t('savings.splits.settle.tooMuch', 'Only {{amount}} is outstanding.', { amount: outstanding.toFixed(2) })}
              </p>
            )}
          </div>
          <div>
            <label htmlFor="settle-note" className={LABEL}>{t('savings.splits.settle.note', 'Note (optional)')}</label>
            <input id="settle-note" type="text" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)}
              placeholder={t('savings.splits.settle.notePlaceholder', 'e.g. bank transfer, cash')} className={INPUT} />
          </div>
          <p className="text-xs text-gray-600 dark:text-gray-400">
            {theyOwe
              ? t('savings.splits.settle.receivedNote', 'This lowers what {{name}} owes you. Neither account changes: each already holds only its own share.', { name: target.partnerName })
              : t('savings.splits.settle.paidNote', '{{name}} confirms it arrived before it counts. Neither account changes: each already holds only its own share.', { name: target.partnerName })}
          </p>
          {error && <p className="text-xs text-error-700 dark:text-error-400">{error}</p>}
          <button type="submit" disabled={submitting || value <= 0 || tooMuch}
            className="w-full min-h-[44px] rounded-lg bg-primary-700 hover:bg-primary-800 text-white text-sm font-semibold disabled:opacity-50">
            {submitting
              ? t('savings.sending', 'Sending…')
              : theyOwe ? t('savings.splits.settle.submitReceived', 'Record repayment') : t('savings.splits.settle.submitPaid', 'Send for confirmation')}
          </button>
        </form>
      </div>
    </div>
  );
}
