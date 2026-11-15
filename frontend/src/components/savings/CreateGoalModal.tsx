'use client';

import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { apiClient } from '@/lib/api-client';
import type { PeerConnectionOut, SharedGoalOut } from '@/shared/types';
import type { Goal } from '@/hooks/useGoals';
import { useDialog } from '@/hooks/useDialog';
import { formatCurrency as formatCurrencyUtil } from '@/utils/formatters';

interface CreateGoalModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  connections: PeerConnectionOut[];
  /** Edit this goal's title and date instead of creating one (either partner may edit). */
  goal?: SharedGoalOut | null;
  /** Add your part to this goal instead of creating one. */
  joinGoal?: SharedGoalOut | null;
  /** After a join: your goal for the part, to set money aside at once. */
  onJoined?: (part: Goal) => void;
}

type PartSource = 'new' | 'existing';

const inputClass =
  'w-full px-3 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500';
const labelClass = 'block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1';
const money = (v: number) => formatCurrencyUtil(v, 'TWD', { precision: 0 });

/**
 * A shared goal's form. Creating one also makes your part: each partner's
 * part is a personal goal of their own (a new one of the amount given, or one
 * they already have), and the shared target is the sum of the two parts.
 * Joining adds your part to a goal your partner made. Editing changes only
 * the title and date: each part's target is edited on that partner's goal.
 */
export default function CreateGoalModal({
  isOpen,
  onClose,
  onSuccess,
  connections,
  goal = null,
  joinGoal = null,
  onJoined,
}: CreateGoalModalProps) {
  const { t } = useTranslation('common');
  const mode: 'create' | 'edit' | 'join' = goal ? 'edit' : joinGoal ? 'join' : 'create';
  const [connectionId, setConnectionId] = useState(connections[0]?.id ?? '');

  // Sync connectionId when connections load after mount
  useEffect(() => {
    if (connections.length > 0 && !connectionId) {
      setConnectionId(connections[0].id);
    }
  }, [connections, connectionId]);
  const [title, setTitle] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [partSource, setPartSource] = useState<PartSource>('new');
  const [myTarget, setMyTarget] = useState('');
  const [existingGoalId, setExistingGoalId] = useState('');
  // Your goals that can become a part: open, and not already part of a shared goal.
  const [ownGoals, setOwnGoals] = useState<Goal[] | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Prefill when opened (or switched to another goal), and drop a stale error
  // from an earlier attempt. Keyed on the goal's id, not the object: a refetch
  // handing over an equal goal must not wipe an edit in progress.
  const goalId = goal?.id ?? joinGoal?.id;
  useEffect(() => {
    if (!isOpen) return;
    setError('');
    if (goal) {
      setTitle(goal.title);
      setTargetDate(goal.target_date ?? '');
    }
    if (joinGoal) {
      // A part the size of your partner's is the usual start.
      setMyTarget(joinGoal.peer_target > 0 ? String(joinGoal.peer_target) : '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberately not on `goal`
  }, [isOpen, goalId]);

  // The goals you could use as your part, fetched when the form opens.
  useEffect(() => {
    if (!isOpen || mode === 'edit') return;
    let stale = false;
    apiClient.get<Goal[]>('/goals/')
      .then((res) => {
        if (stale) return;
        setOwnGoals((res.data ?? []).filter((g) => g.status !== 'cancelled' && !g.sharedGoalId));
      })
      .catch(() => { if (!stale) setOwnGoals([]); });
    return () => { stale = true; };
  }, [isOpen, mode]);

  const partReady = partSource === 'new' ? Number(myTarget) > 0 : existingGoalId !== '';
  const ready = mode === 'edit'
    ? title.trim() !== ''
    : mode === 'join'
      ? partReady
      : title.trim() !== '' && connectionId !== '' && partReady;

  const reset = () => {
    setTitle('');
    setTargetDate('');
    setMyTarget('');
    setExistingGoalId('');
    setPartSource('new');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready) return;

    setSubmitting(true);
    setError('');
    const part = partSource === 'new'
      ? { my_target: parseFloat(myTarget) }
      : { goal_id: existingGoalId };
    try {
      if (goal) {
        await apiClient.updateSharedGoal(goal.id, { title: title.trim(), target_date: targetDate || null });
      } else if (joinGoal) {
        const res = await apiClient.linkSharedGoal(joinGoal.id, partSource === 'new'
          ? { target_amount: parseFloat(myTarget) }
          : { goal_id: existingGoalId });
        if (res.data) onJoined?.(res.data);
      } else {
        await apiClient.createSharedGoal({
          connection_id: connectionId,
          title: title.trim(),
          target_date: targetDate || null,
          ...part,
        });
      }
      onSuccess();
      onClose();
      reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : mode === 'edit'
        ? t('savings.errors.updateFailed', 'Failed to update goal')
        : t('savings.errors.createFailed', 'Failed to create goal'));
    } finally {
      setSubmitting(false);
    }
  };

  const { panelRef, dialogProps } = useDialog({ isOpen: isOpen, onClose: onClose });

  if (!isOpen) return null;

  const heading = mode === 'edit'
    ? t('savings.editGoalTitle', 'Edit Savings Goal')
    : mode === 'join'
      ? t('savings.joinGoalTitle', 'Your part of {{title}}', { title: joinGoal?.title })
      : t('savings.createGoalTitle', 'New Savings Goal');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-gray-900/60" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        {...dialogProps}
        aria-labelledby="create-savings-goal-title"
        className="relative bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-sm p-6 max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between mb-5">
          <h2 id="create-savings-goal-title" className="text-base font-semibold text-gray-900 dark:text-white">
            {heading}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('savings.history.close', 'Close')}
            className="text-gray-500 dark:text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
          >
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === 'create' && connections.length > 1 && (
            <div>
              <label htmlFor="creategoal-savings-selectpeer" className={labelClass}>
                {t('savings.selectPeer', 'Saving with')}
              </label>
              <select
                id="creategoal-savings-selectpeer"
                value={connectionId}
                onChange={(e) => setConnectionId(e.target.value)}
                className={inputClass}
              >
                {connections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.other_user.name}
                    {c.other_user.username ? ` (@${c.other_user.username})` : ''}
                  </option>
                ))}
              </select>
            </div>
          )}

          {mode !== 'join' && (
            <div>
              <label htmlFor="creategoal-savings-goaltitlelabel" className={labelClass}>
                {t('savings.goalTitleLabel', 'Goal Name')}
              </label>
              <input
                id="creategoal-savings-goaltitlelabel"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t('savings.goalTitlePlaceholder', 'e.g. Japan Trip Fund')}
                maxLength={100}
                required
                className={inputClass}
              />
            </div>
          )}

          {mode === 'join' && joinGoal && (
            <p className="text-xs text-gray-600 dark:text-gray-400">
              {joinGoal.peer_joined
                ? t('savings.joinHint', '{{name}}’s part is {{amount}}. The goal’s target is both parts together.', {
                    name: joinGoal.peer_name, amount: money(joinGoal.peer_target),
                  })
                : t('savings.partHint', 'The goal’s target is your part plus your partner’s. Each of you sets and edits your own.')}
            </p>
          )}

          {mode !== 'edit' && (
            <fieldset className="space-y-2">
              <legend className={labelClass}>{t('savings.myPartLabel', 'Your part')}</legend>
              <div className="flex gap-4 text-sm text-gray-700 dark:text-gray-300">
                <label className="flex items-center gap-1.5">
                  <input type="radio" name="part-source" value="new" checked={partSource === 'new'}
                    onChange={() => setPartSource('new')} />
                  {t('savings.partNew', 'A new goal')}
                </label>
                <label className="flex items-center gap-1.5">
                  <input type="radio" name="part-source" value="existing" checked={partSource === 'existing'}
                    onChange={() => setPartSource('existing')} disabled={ownGoals !== null && ownGoals.length === 0} />
                  {t('savings.partExisting', 'A goal I already have')}
                </label>
              </div>
              {partSource === 'new' ? (
                <div>
                  <label htmlFor="creategoal-savings-mytarget" className="sr-only">
                    {t('savings.myTargetLabel', 'Your part (TWD)')}
                  </label>
                  <input
                    id="creategoal-savings-mytarget"
                    type="number"
                    inputMode="numeric"
                    onWheel={(e) => e.currentTarget.blur()}
                    value={myTarget}
                    onChange={(e) => setMyTarget(e.target.value)}
                    placeholder="25000"
                    min="1"
                    step="1"
                    required
                    className={inputClass}
                  />
                </div>
              ) : (
                <div>
                  <label htmlFor="creategoal-savings-existing" className="sr-only">
                    {t('savings.existingGoalLabel', 'Your goal')}
                  </label>
                  <select
                    id="creategoal-savings-existing"
                    value={existingGoalId}
                    onChange={(e) => setExistingGoalId(e.target.value)}
                    required
                    className={inputClass}
                  >
                    <option value="">{t('savings.pickGoal', 'Choose a goal…')}</option>
                    {(ownGoals ?? []).map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.title} · {money(Number(g.targetAmount))}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {mode === 'create' && (
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {t('savings.partHint', 'The goal’s target is your part plus your partner’s. Each of you sets and edits your own.')}
                </p>
              )}
            </fieldset>
          )}

          {mode !== 'join' && (
            <div>
              <label htmlFor="creategoal-savings-targetdatelabel" className={labelClass}>
                {t('savings.targetDateLabel', 'Target Date (optional)')}
              </label>
              <input
                id="creategoal-savings-targetdatelabel"
                type="date"
                value={targetDate}
                onChange={(e) => setTargetDate(e.target.value)}
                min={new Date().toISOString().split('T')[0]}
                className={inputClass}
              />
            </div>
          )}

          {error && (
            <p role="alert" className="text-xs text-red-700 dark:text-red-400">{error}</p>
          )}

          <button
            type="submit"
            disabled={submitting || !ready}
            className="w-full py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {submitting
              ? t('savings.sending', 'Sending…')
              : mode === 'edit'
                ? t('savings.saveGoal', 'Save')
                : mode === 'join'
                  ? t('savings.addPart', 'Add my part')
                  : t('savings.createGoal', 'New Goal')}
          </button>
        </form>
      </div>
    </div>
  );
}
