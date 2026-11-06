'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { PlusIcon } from '@heroicons/react/24/outline';
import { apiClient } from '@/lib/api-client';
import { invalidateAllFinancialData } from '@/hooks/useDataSynchronization';
import { formatCurrency } from '@/utils/formatters';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import NewSplitModal from './NewSplitModal';
import type { PeerBalanceOut, PeerConnectionOut, SplitOut, SplitPolicy } from '@/shared/types';

const money = (value: number, currency: string) =>
  formatCurrency(Math.abs(value), currency, currency === 'TWD' ? { precision: 0 } : {});

const STATUS_STYLE: Record<SplitOut['status'], string> = {
  proposed: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200',
  active: 'bg-prosperity-100 text-prosperity-800 dark:bg-prosperity-900/30 dark:text-prosperity-200',
  declined: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
  voided: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
};

/**
 * Bills split with a partner. Each person's account holds only their share once
 * the partner accepts; nothing reaches a partner's account before that. The
 * balance is what the accepted splits leave one owing the other.
 */
export default function SharedSpendingTab({ connections }: { connections: PeerConnectionOut[] }) {
  const { t } = useTranslation('common');
  const queryClient = useQueryClient();
  const [splits, setSplits] = useState<SplitOut[]>([]);
  const [balances, setBalances] = useState<PeerBalanceOut[]>([]);
  const [policies, setPolicies] = useState<Record<string, SplitPolicy>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [isNewOpen, setIsNewOpen] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState<SplitOut | null>(null);

  const load = useCallback(async () => {
    try {
      const [s, b] = await Promise.all([apiClient.listSplits(), apiClient.getSplitBalances()]);
      setSplits(s.data ?? []);
      setBalances(b.data ?? []);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('savings.splits.errors.loadFailed', 'Failed to load shared bills'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    void Promise.all(connections.map(async (c) => {
      try {
        const res = await apiClient.getPeerPrefs(c.id);
        return [c.id, res.data?.split_policy ?? 'approve_each'] as const;
      } catch {
        return [c.id, 'approve_each'] as const;
      }
    })).then((pairs) => setPolicies(Object.fromEntries(pairs)));
  }, [connections]);

  // Every split change writes ledger rows: refresh transactions, wallets, review.
  const changed = useCallback(async () => {
    await load();
    invalidateAllFinancialData(queryClient);
  }, [load, queryClient]);

  const act = async (split: SplitOut, run: () => Promise<unknown>) => {
    setBusyId(split.id);
    try {
      await run();
      await changed();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('savings.splits.errors.actionFailed', 'That didn’t work'));
    } finally {
      setBusyId(null);
    }
  };

  const setPolicy = async (connectionId: string, policy: SplitPolicy) => {
    setPolicies((p) => ({ ...p, [connectionId]: policy }));
    try {
      await apiClient.setPeerPrefs(connectionId, policy);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('savings.splits.errors.actionFailed', 'That didn’t work'));
    }
  };

  const inbox = splits.filter((s) => s.status === 'proposed' && !s.created_by_me);
  const others = splits.filter((s) => !(s.status === 'proposed' && !s.created_by_me));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-gray-600 dark:text-gray-400">
          {t('savings.splits.intro', 'Split a bill and each of you records only your own share.')}
        </p>
        <button
          type="button"
          onClick={() => setIsNewOpen(true)}
          className="shrink-0 inline-flex items-center gap-1.5 min-h-[44px] px-4 rounded-lg bg-primary-700 hover:bg-primary-800 text-white text-sm font-semibold"
        >
          <PlusIcon className="w-4 h-4" aria-hidden="true" />
          {t('savings.splits.new', 'Split a bill')}
        </button>
      </div>

      {error && <p role="alert" className="text-sm text-error-700 dark:text-error-400">{error}</p>}

      {/* Balances */}
      <section aria-label={t('savings.splits.balances', 'Balances')} className="grid gap-3 sm:grid-cols-2">
        {balances.map((b) => (
          <div key={b.connection_id} className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm">
            <p className="text-xs font-medium text-gray-600 dark:text-gray-400">{b.partner_name}</p>
            {b.balances.length === 0 ? (
              <p className="mt-1 text-sm font-semibold text-gray-900 dark:text-white">
                {t('savings.splits.settled', 'All square')}
              </p>
            ) : b.balances.map((x) => (
              <p key={x.currency} className={`mt-1 text-sm font-semibold ${x.net > 0
                ? 'text-prosperity-700 dark:text-prosperity-400' : 'text-error-700 dark:text-error-400'}`}>
                {x.net > 0
                  ? t('savings.splits.owesYou', '{{name}} owes you {{amount}}', { name: b.partner_name, amount: money(x.net, x.currency) })
                  : t('savings.splits.youOwe', 'You owe {{name}} {{amount}}', { name: b.partner_name, amount: money(x.net, x.currency) })}
              </p>
            ))}
            <label className="mt-3 block text-xs text-gray-600 dark:text-gray-400">
              {t('savings.splits.policyLabel', 'Bills from {{name}}', { name: b.partner_name })}
              <select
                value={policies[b.connection_id] ?? 'approve_each'}
                onChange={(e) => void setPolicy(b.connection_id, e.target.value as SplitPolicy)}
                className="mt-1 w-full px-2 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              >
                <option value="approve_each">{t('savings.splits.policy.approve_each', 'Ask me each time')}</option>
                <option value="auto_accept">{t('savings.splits.policy.auto_accept', 'Add to my account automatically')}</option>
                <option value="off">{t('savings.splits.policy.off', 'Don’t allow')}</option>
              </select>
            </label>
          </div>
        ))}
      </section>

      {/* Waiting for my answer */}
      {inbox.length > 0 && (
        <section aria-label={t('savings.splits.inbox', 'Waiting for you')} className="space-y-2">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{t('savings.splits.inbox', 'Waiting for you')}</h3>
          {inbox.map((s) => (
            <div key={s.id} className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="flex-1 text-sm text-amber-900 dark:text-amber-100">
                <p className="font-semibold">{s.description} · {money(s.total_amount, s.currency)}</p>
                <p>{t('savings.splits.yourShare', 'Your share: {{amount}}', { amount: money(s.my_share, s.currency) })}
                  {' · '}{s.payer_is_me ? t('savings.splits.youPaid', 'you paid') : t('savings.splits.theyPaid', '{{name}} paid', { name: s.partner_name })}
                </p>
              </div>
              <div className="flex gap-2">
                <button type="button" disabled={busyId === s.id}
                  onClick={() => act(s, () => apiClient.respondToSplit(s.id, { action: 'accept' }))}
                  className="min-h-[44px] px-4 rounded-lg bg-green-700 hover:bg-green-800 text-white text-sm font-medium disabled:opacity-50">
                  {t('savings.accept', 'Accept')}
                </button>
                <button type="button" disabled={busyId === s.id}
                  onClick={() => act(s, () => apiClient.respondToSplit(s.id, { action: 'decline' }))}
                  className="min-h-[44px] px-4 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 text-sm font-medium disabled:opacity-50">
                  {t('savings.decline', 'Decline')}
                </button>
              </div>
            </div>
          ))}
        </section>
      )}

      {/* History */}
      <section aria-label={t('savings.splits.history', 'Shared bills')} className="space-y-2">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{t('savings.splits.history', 'Shared bills')}</h3>
        {!loading && others.length === 0 && (
          <p className="text-sm text-gray-600 dark:text-gray-400">{t('savings.splits.empty', 'No shared bills yet.')}</p>
        )}
        {others.map((s) => (
          <div key={s.id} className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm flex flex-col sm:flex-row sm:items-center gap-2">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">
                {s.description}
                <span className={`ml-2 text-xs font-medium px-1.5 py-0.5 rounded-full ${STATUS_STYLE[s.status]}`}>
                  {t(`savings.splits.status.${s.status}`, s.status)}
                </span>
              </p>
              <p className="text-xs text-gray-600 dark:text-gray-400">
                {s.split_date} · {money(s.total_amount, s.currency)} · {t('savings.splits.shares', 'you {{mine}} / {{name}} {{theirs}}', {
                  mine: money(s.my_share, s.currency), theirs: money(s.partner_share, s.currency), name: s.partner_name,
                })}
              </p>
            </div>
            {s.status === 'proposed' && s.created_by_me && (
              <button type="button" disabled={busyId === s.id} onClick={() => act(s, () => apiClient.voidSplit(s.id))}
                className="min-h-[44px] px-3 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50">
                {t('savings.splits.withdraw', 'Withdraw')}
              </button>
            )}
            {s.status === 'active' && s.payer_is_me && (
              <button type="button" disabled={busyId === s.id} onClick={() => setConfirmCancel(s)}
                className="min-h-[44px] px-3 rounded-lg text-sm font-medium text-error-700 dark:text-error-400 hover:bg-error-50 dark:hover:bg-error-900/20 disabled:opacity-50">
                {t('savings.splits.cancel', 'Cancel split')}
              </button>
            )}
          </div>
        ))}
      </section>

      <NewSplitModal isOpen={isNewOpen} onClose={() => setIsNewOpen(false)} onSuccess={() => void changed()} connections={connections} />
      <ConfirmDialog
        isOpen={confirmCancel !== null}
        title={t('savings.splits.confirmCancelTitle', 'Cancel this split?')}
        message={t('savings.splits.confirmCancelMessage', 'You’ll carry the whole bill again and {{name}}’s share is removed from their account.', { name: confirmCancel?.partner_name ?? '' })}
        confirmLabel={t('savings.splits.cancel', 'Cancel split')}
        onCancel={() => setConfirmCancel(null)}
        onConfirm={() => {
          const s = confirmCancel;
          setConfirmCancel(null);
          if (s) void act(s, () => apiClient.cancelSplit(s.id));
        }}
      />
    </div>
  );
}
