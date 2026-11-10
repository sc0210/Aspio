'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { apiClient } from '@/lib/api-client';
import { useDialog } from '@/hooks/useDialog';
import type { SplitMethod, SplitOut } from '@/shared/types';

interface AmendSplitModalProps {
  /** The accepted split to change; null when closed. */
  split: SplitOut | null;
  onClose: () => void;
  onSuccess: () => void;
}

const INPUT =
  'w-full px-3 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500';
const LABEL = 'block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1';

/**
 * Change a split: a new total, how it divides, or the description; the payer
 * stays. An accepted split changes only when the partner accepts. One they
 * haven't answered yet is the creator's to edit, and changes now.
 */
export default function AmendSplitModal({ split, onClose, onSuccess }: AmendSplitModalProps) {
  const { t } = useTranslation('common');
  const isOpen = split !== null;
  const [total, setTotal] = useState('');
  const [description, setDescription] = useState('');
  const [method, setMethod] = useState<SplitMethod>('equal');
  const [myValue, setMyValue] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Each open starts from the split as it stands.
  useEffect(() => {
    if (!split) return;
    setTotal(String(split.total_amount));
    setDescription(split.description);
    setMethod(split.method === 'equal' ? 'equal' : 'fixed');
    setMyValue(split.method === 'equal' ? '' : String(split.my_share));
    setError('');
  }, [split]);

  const totalNum = parseFloat(total) || 0;
  const myShare = useMemo(() => {
    if (method === 'equal') return totalNum / 2;
    const v = parseFloat(myValue) || 0;
    return method === 'percent' ? (totalNum * v) / 100 : v;
  }, [method, totalNum, myValue]);
  // A split of an expense the payer recorded keeps a payer share above 0: 0 would delete that expense.
  const payerShare = split?.payer_is_me ? myShare : totalNum - myShare;
  const invalidShare = (method !== 'equal' && (myValue === '' || myShare < 0 || myShare > totalNum))
    || (split?.from_recorded_expense === true && payerShare <= 0);

  const { panelRef, dialogProps } = useDialog({ isOpen, onClose });
  if (!split) return null;
  const unanswered = split.status === 'proposed';
  // That total is an expense the payer recorded; withdrawing hands it back as it was.
  const totalLocked = unanswered && split.from_recorded_expense === true;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (totalNum <= 0 || invalidShare || !description.trim()) return;
    setSubmitting(true);
    setError('');
    try {
      await apiClient.amendSplit(split.id, {
        total_amount: totalNum,
        method,
        my_percent: method === 'percent' ? parseFloat(myValue) : null,
        my_amount: method === 'fixed' ? parseFloat(myValue) : null,
        description: description.trim(),
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
        aria-labelledby="amend-split-title"
        className="relative bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-sm p-6 max-h-[90dvh] overflow-y-auto"
      >
        <div className="flex items-center justify-between mb-4">
          <h2 id="amend-split-title" className="text-base font-semibold text-gray-900 dark:text-white">
            {t('savings.splits.amend.title', 'Change this split')}
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
            <label htmlFor="amend-description" className={LABEL}>{t('savings.splits.description', 'What was it?')}</label>
            <input id="amend-description" type="text" maxLength={200} required value={description}
              onChange={(e) => setDescription(e.target.value)} className={INPUT} />
          </div>
          <div>
            <label htmlFor="amend-total" className={LABEL}>
              {t('savings.splits.amend.total', 'Total ({{currency}})', { currency: split.currency })}
            </label>
            <input id="amend-total" type="number" inputMode="decimal" min="0.01" step="0.01" required value={total}
              readOnly={totalLocked} aria-describedby={totalLocked ? 'amend-total-locked' : undefined}
              onWheel={(e) => e.currentTarget.blur()} onChange={(e) => setTotal(e.target.value)}
              className={`${INPUT} ${totalLocked ? 'opacity-60 cursor-not-allowed' : ''}`} />
            {totalLocked && (
              <p id="amend-total-locked" className="mt-1 text-xs text-gray-600 dark:text-gray-400">
                {t('savings.splits.amend.totalLocked', 'This is the expense you recorded, so its total stays.')}
              </p>
            )}
          </div>
          <fieldset>
            <legend className={LABEL}>{t('savings.splits.how', 'How to split')}</legend>
            <div className="grid grid-cols-3 gap-2" role="group">
              {(['equal', 'percent', 'fixed'] as const).map((m) => (
                <button key={m} type="button" aria-pressed={method === m}
                  onClick={() => { setMethod(m); setMyValue(''); }}
                  className={`min-h-[44px] rounded-lg border text-sm font-medium ${method === m
                    ? 'border-primary-600 bg-primary-50 text-primary-800 dark:bg-primary-900/30 dark:text-primary-200'
                    : 'border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300'}`}>
                  {t(`savings.splits.method.${m}`, { equal: '50 / 50', percent: '%', fixed: t('savings.splits.method.fixedLabel', 'Amount') }[m])}
                </button>
              ))}
            </div>
            {method !== 'equal' && (
              <div className="mt-2">
                <label htmlFor="amend-mine" className={LABEL}>
                  {method === 'percent' ? t('savings.splits.myPercent', 'My share (%)') : t('savings.splits.myAmount', 'My share')}
                </label>
                <input id="amend-mine" type="number" inputMode="decimal" min="0" step="0.01" required value={myValue}
                  onWheel={(e) => e.currentTarget.blur()} onChange={(e) => setMyValue(e.target.value)} className={INPUT} />
              </div>
            )}
            {totalNum > 0 && !invalidShare && (
              <p className="mt-2 text-xs text-gray-600 dark:text-gray-400">
                {t('savings.splits.preview', 'About — you: {{mine}} · {{name}}: {{theirs}}', {
                  mine: myShare.toFixed(2), theirs: (totalNum - myShare).toFixed(2), name: split.partner_name,
                })}
              </p>
            )}
          </fieldset>
          <p className="text-xs text-gray-600 dark:text-gray-400">
            {unanswered
              ? t('savings.splits.amend.noteUnanswered', '{{name}} hasn’t answered yet, so this changes now. They’ll see the updated bill.', { name: split.partner_name })
              : t('savings.splits.amend.note', 'Nothing changes until {{name}} accepts. Then both of your accounts take the new shares.', { name: split.partner_name })}
          </p>
          {error && <p role="alert" className="text-xs text-error-700 dark:text-error-400">{error}</p>}
          <button type="submit" disabled={submitting || totalNum <= 0 || invalidShare || !description.trim()}
            className="w-full min-h-[44px] rounded-lg bg-primary-700 hover:bg-primary-800 text-white text-sm font-semibold disabled:opacity-50">
            {submitting
              ? t('savings.sending', 'Sending…')
              : unanswered
                ? t('savings.splits.amend.submitUnanswered', 'Update the bill')
                : t('savings.splits.amend.submit', 'Send the change')}
          </button>
        </form>
      </div>
    </div>
  );
}
