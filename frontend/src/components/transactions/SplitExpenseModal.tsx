'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { invalidateAllFinancialData } from '@/hooks/useDataSynchronization';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { apiClient } from '@/lib/api-client';
import { useDialog } from '@/hooks/useDialog';
import { formatCurrency } from '@/utils/formatters';
import type { PeerConnectionOut, SplitMethod, Transaction } from '@/shared/types';

interface SplitExpenseModalProps {
  /** The expense to split; null when closed. */
  transaction: Transaction | null;
  onClose: () => void;
  onSuccess: () => void;
}

const INPUT =
  'w-full px-3 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500';
const LABEL = 'block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1';
const CHOICE = 'min-h-[44px] rounded-lg border text-sm font-medium';
const ON = 'border-primary-600 bg-primary-50 text-primary-800 dark:bg-primary-900/30 dark:text-primary-200';
const OFF = 'border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300';

/** Whether a ledger row can be split; mirrors the API's own check. */
export function canSplit(t: Transaction): boolean {
  return t.type === 'expense' && !t.peerSplitShareId && !t.holdingId && !t.transferGroupId && !t.loanId && t.amount > 0;
}

/**
 * Split an expense you already recorded. You paid it: it stays whole in your
 * account until your partner accepts, then holds only your share.
 */
export default function SplitExpenseModal({ transaction, onClose, onSuccess }: SplitExpenseModalProps) {
  const { t } = useTranslation('common');
  const queryClient = useQueryClient();
  const isOpen = transaction !== null;
  const [partners, setPartners] = useState<PeerConnectionOut[] | null>(null);
  const [connectionId, setConnectionId] = useState('');
  const [method, setMethod] = useState<SplitMethod>('equal');
  const [myValue, setMyValue] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Each open: fresh form, and the partners as they are now.
  useEffect(() => {
    if (!isOpen) return;
    setMethod('equal');
    setMyValue('');
    setError('');
    setPartners(null);
    apiClient.getPeerConnections().then((res) => {
      const accepted = (res.data ?? []).filter((c) => c.status === 'accepted');
      setPartners(accepted);
      setConnectionId(accepted[0]?.id ?? '');
    }).catch(() => setPartners([]));
  }, [isOpen]);

  const total = transaction ? Math.abs(transaction.amount) : 0;
  const myShare = useMemo(() => {
    if (method === 'equal') return total / 2;
    const v = parseFloat(myValue) || 0;
    return method === 'percent' ? (total * v) / 100 : v;
  }, [method, total, myValue]);
  const invalidShare = method !== 'equal' && (myValue === '' || myShare < 0 || myShare > total);

  const { panelRef, dialogProps } = useDialog({ isOpen, onClose });
  if (!transaction) return null;

  const currency = transaction.currency || 'TWD';
  const money = (n: number) => formatCurrency(n, currency);
  const partnerName = partners?.find((c) => c.id === connectionId)?.other_user.name ?? '';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!connectionId || invalidShare) return;
    setSubmitting(true);
    setError('');
    try {
      await apiClient.splitTransaction({
        transaction_id: transaction.id,
        connection_id: connectionId,
        method,
        my_percent: method === 'percent' ? parseFloat(myValue) : null,
        my_amount: method === 'fixed' ? parseFloat(myValue) : null,
      });
      // The expense now carries a split (and maybe a new amount).
      invalidateAllFinancialData(queryClient);
      onSuccess();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('savings.splits.errors.createFailed', 'Failed to split the bill'));
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
        aria-labelledby="split-expense-title"
        className="relative bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-sm p-6 max-h-[90dvh] overflow-y-auto"
      >
        <div className="flex items-center justify-between mb-4">
          <h2 id="split-expense-title" className="text-base font-semibold text-gray-900 dark:text-white">
            {t('savings.splits.existing.title', 'Split this expense')}
          </h2>
          <button
            onClick={onClose}
            aria-label={t('common.close', 'Close')}
            className="min-w-[44px] min-h-[44px] flex items-center justify-center text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
          >
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        <p className="text-sm text-gray-900 dark:text-white font-medium">
          {transaction.description} · {money(total)}
        </p>

        {partners === null ? (
          <p className="mt-4 text-sm text-gray-600 dark:text-gray-400">{t('common.loading', 'Loading…')}</p>
        ) : partners.length === 0 ? (
          <p className="mt-4 text-sm text-gray-600 dark:text-gray-400">
            {t('savings.splits.existing.noPartner', 'Add a partner on Savings first, then you can split bills with them.')}{' '}
            <Link href="/savings" className="text-primary-700 dark:text-primary-400 underline">
              {t('savings.splits.existing.goToSavings', 'Go to Savings')}
            </Link>
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="mt-4 space-y-4">
            {partners.length > 1 && (
              <div>
                <label htmlFor="split-expense-partner" className={LABEL}>{t('savings.splits.with', 'Split with')}</label>
                <select id="split-expense-partner" value={connectionId} onChange={(e) => setConnectionId(e.target.value)} className={INPUT}>
                  {partners.map((c) => <option key={c.id} value={c.id}>{c.other_user.name}</option>)}
                </select>
              </div>
            )}

            <fieldset>
              <legend className={LABEL}>{t('savings.splits.how', 'How to split')}</legend>
              <div className="grid grid-cols-3 gap-2" role="group">
                {(['equal', 'percent', 'fixed'] as const).map((m) => (
                  <button key={m} type="button" aria-pressed={method === m}
                    onClick={() => { setMethod(m); setMyValue(''); }}
                    className={`${CHOICE} ${method === m ? ON : OFF}`}>
                    {t(`savings.splits.method.${m}`, { equal: '50 / 50', percent: '%', fixed: t('savings.splits.method.fixedLabel', 'Amount') }[m])}
                  </button>
                ))}
              </div>
              {method !== 'equal' && (
                <div className="mt-2">
                  <label htmlFor="split-expense-mine" className={LABEL}>
                    {method === 'percent' ? t('savings.splits.myPercent', 'My share (%)') : t('savings.splits.myAmount', 'My share')}
                  </label>
                  <input id="split-expense-mine" type="number" inputMode="decimal" min="0" step="0.01" required value={myValue}
                    onWheel={(e) => e.currentTarget.blur()} onChange={(e) => setMyValue(e.target.value)} className={INPUT} />
                </div>
              )}
              {!invalidShare && (
                <p className="mt-2 text-xs text-gray-600 dark:text-gray-400">
                  {t('savings.splits.preview', 'About — you: {{mine}} · {{name}}: {{theirs}}', {
                    mine: myShare.toFixed(2), theirs: (total - myShare).toFixed(2), name: partnerName,
                  })}
                </p>
              )}
              {method !== 'equal' && myValue !== '' && invalidShare && (
                <p className="mt-2 text-xs text-error-700 dark:text-error-400">
                  {t('savings.splits.errors.shareTooBig', 'Your share has to be between 0 and the total.')}
                </p>
              )}
            </fieldset>

            <p className="text-xs text-gray-600 dark:text-gray-400">
              {t('savings.splits.existing.note', 'This expense stays whole until {{name}} accepts, then holds only your share. Withdraw it and it’s yours again, unchanged.', { name: partnerName })}
            </p>

            {error && <p role="alert" className="text-xs text-error-700 dark:text-error-400">{error}</p>}

            <button type="submit" disabled={submitting || !connectionId || invalidShare}
              className="w-full min-h-[44px] rounded-lg bg-primary-700 hover:bg-primary-800 text-white text-sm font-semibold disabled:opacity-50">
              {submitting ? t('savings.sending', 'Sending…') : t('savings.splits.submit', 'Split the bill')}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
