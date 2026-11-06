'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { apiClient } from '@/lib/api-client';
import { transactionService } from '@/services/transactionService';
import { useDialog } from '@/hooks/useDialog';
import { businessToday } from '@/lib/portfolio/businessDate';
import type { PeerConnectionOut, SplitMethod, TransactionCategory } from '@/shared/types';

interface NewSplitModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  connections: PeerConnectionOut[];
}

const INPUT =
  'w-full px-3 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500';
const LABEL = 'block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1';

/**
 * Split a bill with a partner. Your share goes into your ledger now (the whole
 * bill if you paid, until they accept); theirs only once they accept.
 */
export default function NewSplitModal({ isOpen, onClose, onSuccess, connections }: NewSplitModalProps) {
  const { t } = useTranslation('common');
  const [connectionId, setConnectionId] = useState(connections[0]?.id ?? '');
  const [description, setDescription] = useState('');
  const [total, setTotal] = useState('');
  const [currency, setCurrency] = useState('TWD');
  const [date, setDate] = useState(businessToday());
  const [categoryId, setCategoryId] = useState('');
  const [payer, setPayer] = useState<'me' | 'partner'>('me');
  const [method, setMethod] = useState<SplitMethod>('equal');
  const [myValue, setMyValue] = useState('');
  const [categories, setCategories] = useState<TransactionCategory[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setError('');
    if (!connectionId && connections[0]) setConnectionId(connections[0].id);
    transactionService.getCategories().then((res) => {
      const expense = (res.data ?? []).filter((c) => c.type === 'expense');
      setCategories(expense);
      setCategoryId((current) => current || expense[0]?.id || '');
    }).catch(() => setCategories([]));
  }, [isOpen, connectionId, connections]);

  const partnerName = connections.find((c) => c.id === connectionId)?.other_user.name ?? '';
  const totalNum = parseFloat(total) || 0;
  const myShare = useMemo(() => {
    if (method === 'equal') return totalNum / 2;
    const v = parseFloat(myValue) || 0;
    return method === 'percent' ? (totalNum * v) / 100 : v;
  }, [method, totalNum, myValue]);
  const invalidShare = method !== 'equal' && (myShare < 0 || myShare > totalNum);

  const { panelRef, dialogProps } = useDialog({ isOpen, onClose });
  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!connectionId || !description.trim() || totalNum <= 0 || !categoryId || invalidShare) return;
    setSubmitting(true);
    setError('');
    try {
      await apiClient.createSplit({
        connection_id: connectionId,
        description: description.trim(),
        total_amount: totalNum,
        currency,
        split_date: date,
        category_id: categoryId,
        payer,
        method,
        my_percent: method === 'percent' ? parseFloat(myValue) : null,
        my_amount: method === 'fixed' ? parseFloat(myValue) : null,
      });
      onSuccess();
      onClose();
      setDescription('');
      setTotal('');
      setMyValue('');
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
        aria-labelledby="new-split-title"
        className="relative bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-sm p-6 max-h-[90dvh] overflow-y-auto"
      >
        <div className="flex items-center justify-between mb-5">
          <h2 id="new-split-title" className="text-base font-semibold text-gray-900 dark:text-white">
            {t('savings.splits.newTitle', 'Split a bill')}
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
          {connections.length > 1 && (
            <div>
              <label htmlFor="split-partner" className={LABEL}>{t('savings.splits.with', 'Split with')}</label>
              <select id="split-partner" value={connectionId} onChange={(e) => setConnectionId(e.target.value)} className={INPUT}>
                {connections.map((c) => (
                  <option key={c.id} value={c.id}>{c.other_user.name}</option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label htmlFor="split-description" className={LABEL}>{t('savings.splits.description', 'What was it?')}</label>
            <input id="split-description" type="text" value={description} maxLength={200} required
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('savings.splits.descriptionPlaceholder', 'e.g. Dinner, groceries, rent')}
              className={INPUT} />
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-2">
              <label htmlFor="split-total" className={LABEL}>{t('savings.splits.total', 'Total')}</label>
              <input id="split-total" type="number" inputMode="decimal" min="0.01" step="0.01" required value={total}
                onWheel={(e) => e.currentTarget.blur()} onChange={(e) => setTotal(e.target.value)} className={INPUT} />
            </div>
            <div>
              <label htmlFor="split-currency" className={LABEL}>{t('savings.splits.currency', 'Currency')}</label>
              <select id="split-currency" value={currency} onChange={(e) => setCurrency(e.target.value)} className={INPUT}>
                <option value="TWD">TWD</option>
                <option value="USD">USD</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label htmlFor="split-date" className={LABEL}>{t('savings.splits.date', 'Date')}</label>
              <input id="split-date" type="date" required value={date} onChange={(e) => setDate(e.target.value)} className={INPUT} />
            </div>
            <div>
              <label htmlFor="split-category" className={LABEL}>{t('savings.splits.category', 'Category')}</label>
              <select id="split-category" required value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={INPUT}>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          </div>

          <fieldset>
            <legend className={LABEL}>{t('savings.splits.whoPaid', 'Who paid?')}</legend>
            <div className="grid grid-cols-2 gap-2" role="group">
              {(['me', 'partner'] as const).map((who) => (
                <button key={who} type="button" aria-pressed={payer === who} onClick={() => setPayer(who)}
                  className={`min-h-[44px] rounded-lg border text-sm font-medium ${payer === who
                    ? 'border-primary-600 bg-primary-50 text-primary-800 dark:bg-primary-900/30 dark:text-primary-200'
                    : 'border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300'}`}>
                  {who === 'me' ? t('savings.splits.paidByMe', 'I paid') : t('savings.splits.paidByPartner', '{{name}} paid', { name: partnerName })}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className={LABEL}>{t('savings.splits.how', 'How to split')}</legend>
            <div className="grid grid-cols-3 gap-2" role="group">
              {(['equal', 'percent', 'fixed'] as const).map((m) => (
                <button key={m} type="button" aria-pressed={method === m} onClick={() => setMethod(m)}
                  className={`min-h-[44px] rounded-lg border text-sm font-medium ${method === m
                    ? 'border-primary-600 bg-primary-50 text-primary-800 dark:bg-primary-900/30 dark:text-primary-200'
                    : 'border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300'}`}>
                  {t(`savings.splits.method.${m}`, { equal: '50 / 50', percent: '%', fixed: t('savings.splits.method.fixedLabel', 'Amount') }[m])}
                </button>
              ))}
            </div>
            {method !== 'equal' && (
              <div className="mt-2">
                <label htmlFor="split-mine" className={LABEL}>
                  {method === 'percent' ? t('savings.splits.myPercent', 'My share (%)') : t('savings.splits.myAmount', 'My share')}
                </label>
                <input id="split-mine" type="number" inputMode="decimal" min="0" step="0.01" required value={myValue}
                  onWheel={(e) => e.currentTarget.blur()} onChange={(e) => setMyValue(e.target.value)} className={INPUT} />
              </div>
            )}
            {totalNum > 0 && !invalidShare && (
              <p className="mt-2 text-xs text-gray-600 dark:text-gray-400">
                {t('savings.splits.preview', 'You: {{mine}} · {{name}}: {{theirs}}', {
                  mine: myShare.toFixed(2), theirs: (totalNum - myShare).toFixed(2), name: partnerName,
                })}
              </p>
            )}
            {invalidShare && (
              <p className="mt-2 text-xs text-error-700 dark:text-error-400">
                {t('savings.splits.errors.shareTooBig', 'Your share has to be between 0 and the total.')}
              </p>
            )}
          </fieldset>

          <p className="text-xs text-gray-600 dark:text-gray-400">
            {t('savings.splits.consentNote', '{{name}} accepts before anything is added to their account.', { name: partnerName })}
          </p>

          {error && <p className="text-xs text-error-700 dark:text-error-400">{error}</p>}

          <button type="submit"
            disabled={submitting || !description.trim() || totalNum <= 0 || !categoryId || invalidShare}
            className="w-full min-h-[44px] rounded-lg bg-primary-700 hover:bg-primary-800 text-white text-sm font-semibold disabled:opacity-50">
            {submitting ? t('savings.sending', 'Sending…') : t('savings.splits.submit', 'Split the bill')}
          </button>
        </form>
      </div>
    </div>
  );
}
