'use client';

import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { apiClient } from '@/lib/api-client';
import type { PeerConnectionOut } from '@/shared/types';
import { useDialog } from '@/hooks/useDialog';

interface CreateGoalModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  connections: PeerConnectionOut[];
}

export default function CreateGoalModal({
  isOpen,
  onClose,
  onSuccess,
  connections,
}: CreateGoalModalProps) {
  const { t } = useTranslation('common');
  const [connectionId, setConnectionId] = useState(connections[0]?.id ?? '');

  // Sync connectionId when connections load after mount
  useEffect(() => {
    if (connections.length > 0 && !connectionId) {
      setConnectionId(connections[0].id);
    }
  }, [connections, connectionId]);
  const [title, setTitle] = useState('');
  const [targetAmount, setTargetAmount] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!connectionId || !title.trim() || !targetAmount) return;

    setSubmitting(true);
    setError('');
    try {
      await apiClient.createSharedGoal({
        connection_id: connectionId,
        title: title.trim(),
        target_amount: parseFloat(targetAmount),
        target_date: targetDate || null,
      });
      onSuccess();
      onClose();
      setTitle('');
      setTargetAmount('');
      setTargetDate('');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('savings.errors.createFailed', 'Failed to create goal'));
    } finally {
      setSubmitting(false);
    }
  };

  const { panelRef, dialogProps } = useDialog({ isOpen: isOpen, onClose: onClose });

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-gray-900/60" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        {...dialogProps}
        className="relative bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-sm p-6"
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-gray-900 dark:text-white">
            {t('savings.createGoalTitle', 'New Savings Goal')}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-500 dark:text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
          >
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {connections.length > 1 && (
            <div>
              <label htmlFor="creategoal-savings-selectpeer" className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                {t('savings.selectPeer', 'Saving with')}
              </label>
              <select
                id="creategoal-savings-selectpeer"
                value={connectionId}
                onChange={(e) => setConnectionId(e.target.value)}
                className="w-full px-3 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
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

          <div>
            <label htmlFor="creategoal-savings-goaltitlelabel" className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
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
              className="w-full px-3 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            />
          </div>

          <div>
            <label htmlFor="creategoal-savings-targetamountlabel" className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
              {t('savings.targetAmountLabel', 'Target Amount')}
            </label>
            <input
              id="creategoal-savings-targetamountlabel"
              type="number"
              inputMode="numeric"
              onWheel={(e) => e.currentTarget.blur()}
              value={targetAmount}
              onChange={(e) => setTargetAmount(e.target.value)}
              placeholder="50000"
              min="1"
              step="1"
              required
              className="w-full px-3 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            />
          </div>

          <div>
            <label htmlFor="creategoal-savings-targetdatelabel" className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
              {t('savings.targetDateLabel', 'Target Date (optional)')}
            </label>
            <input
              id="creategoal-savings-targetdatelabel"
              type="date"
              value={targetDate}
              onChange={(e) => setTargetDate(e.target.value)}
              min={new Date().toISOString().split('T')[0]}
              className="w-full px-3 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            />
          </div>

          {error && (
            <p className="text-xs text-red-700 dark:text-red-400">{error}</p>
          )}

          <button
            type="submit"
            disabled={submitting || !title.trim() || !targetAmount || !connectionId}
            className="w-full py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {submitting ? t('savings.sending', 'Sending…') : t('savings.createGoal', 'New Goal')}
          </button>
        </form>
      </div>
    </div>
  );
}
