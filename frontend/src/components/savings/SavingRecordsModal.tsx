'use client';

import { useState, useEffect, useCallback } from 'react';
import { XMarkIcon, PlusIcon, PencilIcon, TrashIcon, CheckIcon } from '@heroicons/react/24/outline';
import type { SharedGoalOut, SavingRecord } from '@/shared/types';
import { apiClient } from '@/lib/api-client';
import { demoSavingRecords } from '@/data/demoData';
import { isOwnRecord } from '@/components/savings/recordOwnership';
import { formatCurrency as formatCurrencyUtil } from '@/utils/formatters';
import { useDialog } from '@/hooks/useDialog';
import { useTranslation } from 'react-i18next';

const fmt = (v: number) => formatCurrencyUtil(v, 'TWD', { precision: 0 });

interface SavingRecordsModalProps {
  goal: SharedGoalOut | null;
  isDemo: boolean;
  currentUserId: string;
  onClose: () => void;
  onRecordChanged: (goalId: string) => void;
}

interface AddForm {
  amount: string;
  record_date: string;
  note: string;
}

interface EditState {
  recordId: string;
  amount: string;
  record_date: string;
  note: string;
}

const today = () => new Date().toISOString().slice(0, 10);

export default function SavingRecordsModal({
  goal,
  isDemo,
  currentUserId,
  onClose,
  onRecordChanged,
}: SavingRecordsModalProps) {
  const { t } = useTranslation('common');
  const { panelRef, dialogProps } = useDialog({ isOpen: true, onClose: onClose });
  const [records, setRecords] = useState<SavingRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState<AddForm>({ amount: '', record_date: today(), note: '' });
  const [addSaving, setAddSaving] = useState(false);

  const [editState, setEditState] = useState<EditState | null>(null);
  const [editSaving, setEditSaving] = useState(false);

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadRecords = useCallback(async () => {
    if (!goal) return;
    if (isDemo) {
      const sorted = [...(demoSavingRecords[goal.id] ?? [])].sort(
        (a, b) => b.record_date.localeCompare(a.record_date),
      );
      setRecords(sorted);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.listSavingRecords(goal.id);
      setRecords(res.data ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('savings.records.errors.loadFailed', 'Failed to load records'));
    } finally {
      setLoading(false);
    }
  }, [goal, isDemo, t]);

  useEffect(() => {
    if (goal) {
      setShowAddForm(false);
      setEditState(null);
      setConfirmDeleteId(null);
      setError(null);
      loadRecords();
    }
  }, [goal, loadRecords]);

  if (!goal) return null;

  const amountError = t('savings.records.errors.amountPositive', 'Amount must be greater than 0');

  const handleAdd = async () => {
    const amount = parseFloat(addForm.amount);
    if (!amount || amount <= 0) { setError(amountError); return; }
    setAddSaving(true);
    setError(null);
    try {
      if (isDemo) {
        const newRec: SavingRecord = {
          id: `demo-${Date.now()}`,
          goal_id: goal.id,
          // Filed under the goal's owner, the id the seeded records use — not
          // DemoContext's session id, which no fixture knows.
          user_id: goal.your_user_id,
          user_name: goal.your_name,
          amount,
          record_date: addForm.record_date,
          note: addForm.note || null,
          created_at: new Date().toISOString(),
        };
        const updated = [newRec, ...records].sort((a, b) => b.record_date.localeCompare(a.record_date));
        setRecords(updated);
        demoSavingRecords[goal.id] = updated;
      } else {
        await apiClient.addSavingRecord(goal.id, {
          amount,
          record_date: addForm.record_date,
          note: addForm.note || undefined,
        });
        await loadRecords();
      }
      setAddForm({ amount: '', record_date: today(), note: '' });
      setShowAddForm(false);
      onRecordChanged(goal.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('savings.records.errors.addFailed', 'Failed to add record'));
    } finally {
      setAddSaving(false);
    }
  };

  const startEdit = (rec: SavingRecord) => {
    setEditState({ recordId: rec.id, amount: String(rec.amount), record_date: rec.record_date, note: rec.note ?? '' });
    setConfirmDeleteId(null);
  };

  const handleEdit = async () => {
    if (!editState) return;
    const amount = parseFloat(editState.amount);
    if (!amount || amount <= 0) { setError(amountError); return; }
    setEditSaving(true);
    setError(null);
    try {
      if (isDemo) {
        const updated = records.map((r) =>
          r.id === editState.recordId
            ? { ...r, amount, record_date: editState.record_date, note: editState.note || null }
            : r,
        );
        setRecords(updated);
        demoSavingRecords[goal.id] = updated;
      } else {
        await apiClient.updateSavingRecord(goal.id, editState.recordId, {
          amount,
          record_date: editState.record_date,
          note: editState.note || null,
        });
        await loadRecords();
      }
      setEditState(null);
      onRecordChanged(goal.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('savings.records.errors.updateFailed', 'Failed to update record'));
    } finally {
      setEditSaving(false);
    }
  };

  const handleDelete = async (recordId: string) => {
    setDeleting(true);
    setError(null);
    try {
      if (isDemo) {
        const updated = records.filter((r) => r.id !== recordId);
        setRecords(updated);
        // Demo-only: persist the change into the in-memory fixture so it survives
        // reopening the modal. Intentional mutation of shared demo state.
        // eslint-disable-next-line react-hooks/immutability
        demoSavingRecords[goal.id] = updated;
      } else {
        await apiClient.deleteSavingRecord(goal.id, recordId);
        await loadRecords();
      }
      setConfirmDeleteId(null);
      onRecordChanged(goal.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('savings.records.errors.deleteFailed', 'Failed to delete record'));
    } finally {
      setDeleting(false);
    }
  };

  const totalAmount = records.reduce((s, r) => s + r.amount, 0);
  const cancelLabel = t('savings.records.cancel', 'Cancel');
  const saveLabel = t('savings.records.save', 'Save');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      {/* Modal */}
      <div
        ref={panelRef}
        {...dialogProps}
        aria-label={t('savings.records.dialogAria', 'Saving records for {{title}}', { title: goal.title })}
        className="relative bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700 shrink-0">
          <div>
            <h2 className="text-base font-semibold text-gray-900 dark:text-white">
              {t('savings.records.title', 'Saving records')}
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{goal.title}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => { setShowAddForm(true); setEditState(null); setConfirmDeleteId(null); }}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 transition-colors"
            >
              <PlusIcon className="w-4 h-4" />
              {t('savings.records.add', 'Add')}
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label={t('savings.records.close', 'Close')}
              className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            >
              <XMarkIcon className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Scrollable body */}
        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-3">
          {error && (
            <p role="alert" className="text-sm text-error-600 dark:text-error-400 bg-error-50 dark:bg-error-900/20 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          {/* Add record form */}
          {showAddForm && (
            <div className="bg-primary-50 dark:bg-primary-900/20 rounded-xl p-4 border border-primary-100 dark:border-primary-800">
              <p className="text-xs font-semibold text-primary-700 dark:text-primary-400 mb-3 uppercase tracking-wide">
                {t('savings.records.newRecord', 'New record')}
              </p>
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div>
                  <label htmlFor="savingreco-date" className="block text-xs text-gray-600 dark:text-gray-400 mb-1">
                    {t('savings.records.date', 'Date')}
                  </label>
                  <input
                    id="savingreco-date"
                    type="date"
                    value={addForm.record_date}
                    onChange={(e) => setAddForm((f) => ({ ...f, record_date: e.target.value }))}
                    className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                  />
                </div>
                <div>
                  <label htmlFor="savingreco-amount-twd" className="block text-xs text-gray-600 dark:text-gray-400 mb-1">
                    {t('savings.records.amountTwd', 'Amount (TWD)')}
                  </label>
                  <input
                    id="savingreco-amount-twd"
                    type="number"
                    inputMode="decimal"
                    onWheel={(e) => e.currentTarget.blur()}
                    min="1"
                    placeholder="0"
                    value={addForm.amount}
                    onChange={(e) => setAddForm((f) => ({ ...f, amount: e.target.value }))}
                    className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                  />
                </div>
              </div>
              <div className="mb-3">
                <label htmlFor="savingreco-note-optional" className="block text-xs text-gray-600 dark:text-gray-400 mb-1">
                  {t('savings.records.noteOptional', 'Note (optional)')}
                </label>
                <input
                  id="savingreco-note-optional"
                  type="text"
                  placeholder={t('savings.records.noteExample', 'e.g. Monthly savings')}
                  value={addForm.note}
                  onChange={(e) => setAddForm((f) => ({ ...f, note: e.target.value }))}
                  className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                />
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleAdd}
                  disabled={addSaving}
                  className="flex items-center gap-1.5 px-4 py-1.5 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-50 transition-colors"
                >
                  <CheckIcon className="w-4 h-4" />
                  {addSaving ? t('savings.records.saving', 'Saving…') : saveLabel}
                </button>
                <button
                  type="button"
                  onClick={() => { setShowAddForm(false); setError(null); }}
                  className="px-4 py-1.5 text-gray-600 dark:text-gray-400 rounded-lg text-sm hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                >
                  {cancelLabel}
                </button>
              </div>
            </div>
          )}

          {/* Records table */}
          {loading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-12 bg-gray-100 dark:bg-gray-800 rounded-lg animate-pulse" />
              ))}
            </div>
          ) : records.length === 0 ? (
            <div className="flex flex-col items-center py-12 text-center">
              <p className="text-2xl mb-2" aria-hidden="true">💰</p>
              <p className="text-gray-600 dark:text-gray-400 font-medium">
                {t('savings.records.emptyTitle', 'No records yet')}
              </p>
              <p className="text-gray-400 dark:text-gray-500 text-sm mt-1">
                {t('savings.records.emptyHint', 'Use “Add” to record your first saving deposit.')}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-500 dark:text-gray-400 border-b border-gray-100 dark:border-gray-700">
                    <th className="pb-2 font-medium">{t('savings.records.date', 'Date')}</th>
                    <th className="pb-2 font-medium">{t('savings.records.savedBy', 'Saved by')}</th>
                    <th className="pb-2 font-medium text-right">{t('savings.recordAmount', 'Amount')}</th>
                    <th className="pb-2 font-medium hidden sm:table-cell">{t('savings.notePlaceholder', 'Note')}</th>
                    <th className="pb-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
                  {records.map((rec) => {
                    // The rule the page's totals use too — one helper, so they cannot drift.
                    const isOwn = isOwnRecord(rec, goal, currentUserId);
                    const isEditing = editState?.recordId === rec.id;
                    const isConfirmDelete = confirmDeleteId === rec.id;

                    if (isEditing && editState) {
                      const es = editState;
                      return (
                        <tr key={rec.id} className="bg-primary-50 dark:bg-primary-900/20">
                          <td className="py-2 pr-2">
                            <input
                              aria-label={t('savings.recordDate', 'Record date')}
                              type="date"
                              value={es.record_date}
                              onChange={(e) => setEditState((s) => s && { ...s, record_date: e.target.value })}
                              className="w-full text-xs border border-gray-300 dark:border-gray-600 rounded px-2 py-1 bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                            />
                          </td>
                          <td className="py-2 pr-2 text-xs text-gray-500">{rec.user_name}</td>
                          <td className="py-2 pr-2">
                            <input
                              aria-label={t('savings.recordAmount', 'Amount')}
                              type="number"
                              inputMode="decimal"
                              onWheel={(e) => e.currentTarget.blur()}
                              min="1"
                              value={es.amount}
                              onChange={(e) => setEditState((s) => s && { ...s, amount: e.target.value })}
                              className="w-24 text-xs text-right border border-gray-300 dark:border-gray-600 rounded px-2 py-1 bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                            />
                          </td>
                          <td className="py-2 pr-2 hidden sm:table-cell">
                            <input
                              type="text"
                              value={es.note}
                              onChange={(e) => setEditState((s) => s && { ...s, note: e.target.value })}
                              placeholder={t('savings.notePlaceholder', 'Note')}
                              aria-label={t('savings.notePlaceholder', 'Note')}
                              className="w-full text-xs border border-gray-300 dark:border-gray-600 rounded px-2 py-1 bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                            />
                          </td>
                          <td className="py-2 text-right whitespace-nowrap">
                            <button
                              type="button"
                              onClick={handleEdit}
                              disabled={editSaving}
                              className="inline-flex items-center gap-1 px-2 py-1 text-xs text-white bg-primary-600 rounded hover:bg-primary-700 disabled:opacity-50 mr-1"
                            >
                              <CheckIcon className="w-3 h-3" />
                              {editSaving ? '…' : saveLabel}
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditState(null)}
                              className="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 px-2 py-1"
                            >
                              {cancelLabel}
                            </button>
                          </td>
                        </tr>
                      );
                    }

                    if (isConfirmDelete) {
                      return (
                        <tr key={rec.id} className="bg-error-50 dark:bg-error-900/20">
                          <td colSpan={5} className="py-2 px-1">
                            <span className="text-xs text-error-600 dark:text-error-400 mr-3">
                              {t('savings.records.confirmDelete', 'Delete this record?')}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleDelete(rec.id)}
                              disabled={deleting}
                              className="text-xs text-white bg-error-600 rounded px-2 py-1 hover:bg-error-700 disabled:opacity-50 mr-1"
                            >
                              {deleting ? '…' : t('savings.records.delete', 'Delete')}
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(null)}
                              className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1"
                            >
                              {cancelLabel}
                            </button>
                          </td>
                        </tr>
                      );
                    }

                    return (
                      <tr key={rec.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                        <td className="py-2.5 pr-3 text-gray-600 dark:text-gray-400 whitespace-nowrap">{rec.record_date}</td>
                        <td className="py-2.5 pr-3">
                          <span className={`text-xs font-medium px-1.5 py-0.5 rounded-full ${
                            isOwn
                              ? 'bg-primary-100 dark:bg-primary-900/40 text-primary-700 dark:text-primary-300'
                              : 'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300'
                          }`}>
                            {rec.user_name}
                          </span>
                        </td>
                        <td className="py-2.5 pr-3 text-right font-semibold text-gray-900 dark:text-white whitespace-nowrap">
                          {fmt(rec.amount)}
                        </td>
                        <td className="py-2.5 pr-3 text-gray-400 dark:text-gray-500 text-xs hidden sm:table-cell">
                          {rec.note ?? '—'}
                        </td>
                        <td className="py-2.5 text-right whitespace-nowrap">
                          {isOwn && (
                            <div className="flex items-center justify-end gap-1">
                              <button
                                type="button"
                                onClick={() => startEdit(rec)}
                                aria-label={t('savings.records.editAria', 'Edit record')}
                                className="p-1.5 text-gray-400 hover:text-primary-600 dark:hover:text-primary-400 rounded hover:bg-primary-50 dark:hover:bg-primary-900/20 transition-colors"
                              >
                                <PencilIcon className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => { setConfirmDeleteId(rec.id); setEditState(null); }}
                                aria-label={t('savings.records.deleteAria', 'Delete record')}
                                className="p-1.5 text-gray-400 hover:text-error-600 dark:hover:text-error-400 rounded hover:bg-error-50 dark:hover:bg-error-900/20 transition-colors"
                              >
                                <TrashIcon className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Footer */}
        {records.length > 0 && (
          <div className="px-5 py-3 border-t border-gray-100 dark:border-gray-700 flex items-center justify-between shrink-0 bg-gray-50 dark:bg-gray-800/50">
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {records.length === 1
                ? t('savings.records.countOne', '1 record')
                : t('savings.records.countOther', '{{n}} records', { n: records.length })}
            </span>
            <span className="text-sm font-semibold text-gray-900 dark:text-white">
              {t('savings.records.total', 'Total: {{amount}}', { amount: fmt(totalAmount) })}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
