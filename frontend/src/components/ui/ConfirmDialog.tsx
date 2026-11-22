'use client';
import { useTranslation } from 'react-i18next';
import { useDialog } from '@/hooks/useDialog';

interface ConfirmDialogProps {
  isOpen: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  title: string;
  message: string;
  /** Defaults to "Delete": every caller so far confirms something destructive. */
  confirmLabel?: string;
  cancelLabel?: string;
  /** While the action runs: the confirm button is disabled and shows this label instead. */
  busyLabel?: string;
  busy?: boolean;
}

/** A destructive-action confirm; the confirm button is styled as a danger action. */
export function ConfirmDialog({ isOpen, onConfirm, onCancel, title, message, confirmLabel, cancelLabel, busy = false, busyLabel }: ConfirmDialogProps) {
  const { t } = useTranslation('common');
  const { panelRef, dialogProps } = useDialog({ isOpen: isOpen, onClose: onCancel });

  if (!isOpen) return null;

  return (
    <div
      ref={panelRef}
      {...dialogProps}
      aria-labelledby="confirm-delete-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      // A tap on the backdrop cancels, as it does on every other dialog.
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-xl max-w-sm w-full mx-4">
        <h3
          id="confirm-delete-title"
          className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2"
        >
          {title}
        </h3>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-6 whitespace-pre-line">
          {message}
        </p>
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400"
          >
            {cancelLabel ?? t('common.cancel', 'Cancel')}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="px-4 py-2 text-sm font-medium text-white bg-error-600 rounded-lg hover:bg-error-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-error-500 focus-visible:ring-offset-1 dark:focus-visible:ring-offset-gray-800"
          >
            {busy && busyLabel ? busyLabel : (confirmLabel ?? t('common.delete', 'Delete'))}
          </button>
        </div>
      </div>
    </div>
  );
}
