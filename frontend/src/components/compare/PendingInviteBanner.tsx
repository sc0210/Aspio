'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api-client';
import type { PeerConnectionOut } from '@/shared/types';

interface PendingInviteBannerProps {
  invites: PeerConnectionOut[];
  onRespond: () => void;
}

export default function PendingInviteBanner({ invites, onRespond }: PendingInviteBannerProps) {
  const { t } = useTranslation('common');
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const respond = async (id: string, action: 'accept' | 'decline') => {
    setLoadingId(id);
    setErrors((prev) => ({ ...prev, [id]: '' }));
    try {
      await apiClient.respondToPeerInvite(id, action);
      onRespond();
    } catch (err) {
      setErrors((prev) => ({
        ...prev,
        [id]: err instanceof Error ? err.message : 'Failed to respond',
      }));
    } finally {
      setLoadingId(null);
    }
  };

  if (invites.length === 0) return null;

  return (
    <div className="space-y-2">
      {invites.map((invite) => (
        <div
          key={invite.id}
          className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center gap-3"
        >
          <div className="flex-1">
            <p className="text-sm text-amber-900 dark:text-amber-200">
              <span className="font-semibold">{invite.other_user.name}</span>
              {invite.other_user.username && (
                <span className="text-amber-700 dark:text-amber-400 ml-1">
                  (@{invite.other_user.username})
                </span>
              )}{' '}
              {t('savings.inviteRequestSuffix', 'wants to save together with you.')}
            </p>
            {errors[invite.id] && (
              <p className="text-xs text-error-600 dark:text-error-400 mt-1">{errors[invite.id]}</p>
            )}
          </div>
          <div className="flex gap-2 shrink-0">
            <button
              onClick={() => respond(invite.id, 'accept')}
              disabled={loadingId === invite.id}
              className="px-3 py-1.5 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors"
            >
              {t('savings.accept', 'Accept')}
            </button>
            <button
              onClick={() => respond(invite.id, 'decline')}
              disabled={loadingId === invite.id}
              className="px-3 py-1.5 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 text-sm font-medium rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 transition-colors"
            >
              {t('savings.decline', 'Decline')}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
