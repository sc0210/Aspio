'use client';

import { useTranslation } from 'react-i18next';
import { XMarkIcon, ClockIcon } from '@heroicons/react/24/outline';
import type { PeerConnectionOut } from '@/shared/types';

interface PeerRosterProps {
  accepted: PeerConnectionOut[];
  sentPending: PeerConnectionOut[];
  /** Connection whose removal is in flight; its button is disabled meanwhile. */
  removingId: string | null;
  /** Removes an accepted peer or withdraws a pending invite — one API call for both. */
  onRemove: (connectionId: string) => void;
}

/**
 * The people you save with and compare against, shown once.
 *
 * /savings and /compare each rendered their own copy of this row over the same
 * connections: one could remove a peer but not withdraw an invite, the other
 * could do both, and nothing told you they were the same list.
 */
export function PeerRoster({ accepted, sentPending, removingId, onRemove }: PeerRosterProps) {
  const { t } = useTranslation('common');

  if (accepted.length === 0 && sentPending.length === 0) return null;

  const removeButton = (connectionId: string, label: string) => (
    <button
      type="button"
      onClick={() => onRemove(connectionId)}
      disabled={removingId === connectionId}
      aria-label={label}
      className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-gray-200 dark:bg-gray-600 text-gray-600 dark:text-gray-300 hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-900/40 dark:hover:text-red-400 flex items-center justify-center transition-colors disabled:opacity-50 touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
    >
      <XMarkIcon className="w-3.5 h-3.5" />
    </button>
  );

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm">
      <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-3">
        {t('savings.peersLabel', 'Members')}
      </p>
      <ul className="flex flex-wrap gap-5">
        {accepted.map((conn) => (
          <li key={conn.id} className="flex flex-col items-center gap-1">
            <div className="relative">
              <div
                aria-hidden="true"
                className="w-12 h-12 rounded-full bg-primary-600 flex items-center justify-center text-white font-semibold"
              >
                {conn.other_user.name.charAt(0).toUpperCase()}
              </div>
              {removeButton(
                conn.id,
                t('savings.removePeer', 'Remove {{name}}', { name: conn.other_user.name }),
              )}
            </div>
            <span className="text-xs text-gray-600 dark:text-gray-400 max-w-[64px] truncate text-center">
              {conn.other_user.name}
            </span>
          </li>
        ))}

        {sentPending.map((conn) => (
          <li key={conn.id} className="flex flex-col items-center gap-1">
            <div className="relative">
              <div
                aria-hidden="true"
                className="w-12 h-12 rounded-full bg-gray-300 dark:bg-gray-600 flex items-center justify-center text-gray-500 dark:text-gray-400 font-semibold"
              >
                {conn.other_user.name.charAt(0).toUpperCase()}
              </div>
              <div
                aria-hidden="true"
                className="absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full bg-amber-400 flex items-center justify-center"
              >
                <ClockIcon className="w-3 h-3 text-white" />
              </div>
              {removeButton(
                conn.id,
                t('savings.cancelInvite', 'Cancel invite to {{name}}', { name: conn.other_user.name }),
              )}
            </div>
            <span className="text-xs text-gray-400 dark:text-gray-500 max-w-[64px] truncate text-center">
              {conn.other_user.name}
            </span>
            <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">
              {t('savings.pendingLabel', 'pending')}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
