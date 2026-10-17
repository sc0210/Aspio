'use client';

import { useState, useEffect, useRef } from 'react';
import { XMarkIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api-client';
import type { PeerUserPreview } from '@/shared/types';
import { useDialog } from '@/hooks/useDialog';

interface AddPeerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export default function AddPeerModal({ isOpen, onClose, onSuccess }: AddPeerModalProps) {
  const { t } = useTranslation('common');
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<PeerUserPreview | null | undefined>(undefined);
  const [searching, setSearching] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setResult(undefined);
      setError('');
      // focus is useDialog's job now (initialFocus), so it happens once
    }
  }, [isOpen]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.length < 2) {
      setResult(undefined);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await apiClient.searchPeer(query.trim());
        setResult(res.data);
      } catch {
        setResult(null);
      } finally {
        setSearching(false);
      }
    }, 400);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  const handleInvite = async () => {
    if (!result) return;
    setSubmitting(true);
    setError('');
    try {
      // Use the searched query as the username since search guarantees a match
      await apiClient.sendPeerInvite(result.username ?? query.trim());
      onSuccess();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('savings.errors.inviteFailed', 'Failed to send invite'));
    } finally {
      setSubmitting(false);
    }
  };

  const { panelRef, dialogProps } = useDialog({ isOpen, onClose, initialFocus: inputRef });

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-gray-900/60" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        {...dialogProps}
        aria-labelledby="add-peer-modal-title"
        className="relative bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-sm p-6"
      >
        <div className="flex items-center justify-between mb-4">
          <h2 id="add-peer-modal-title" className="text-base font-semibold text-gray-900 dark:text-white">{t('savings.addPeer', 'Add Member')}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close', 'Close')}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
          >
            <XMarkIcon className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        <div className="relative">
          <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('savings.searchPlaceholder', 'Search by username…')}
            aria-label={t('savings.searchPlaceholder', 'Search by username…')}
            className="w-full pl-9 pr-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
          />
        </div>

        <div className="mt-4 min-h-[72px]">
          {searching && (
            <div className="flex items-center justify-center h-16">
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary-600" />
            </div>
          )}

          {!searching && query.length >= 2 && result === null && (
            <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-4">
              {t(
                'savings.userNotFound',
                'No user found with that username. Ask them to set a username in Settings → Profile.'
              )}
            </p>
          )}

          {!searching && result && (
            <div className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-xl">
              <div className="w-10 h-10 rounded-full bg-primary-600 flex items-center justify-center text-white font-semibold text-sm shrink-0">
                {result.name.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{result.name}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">@{result.username}</p>
              </div>
            </div>
          )}
        </div>

        {error && (
          <p className="text-xs text-error-600 dark:text-error-400 mt-2">{error}</p>
        )}

        <button
          onClick={handleInvite}
          disabled={!result || submitting}
          className="mt-4 w-full py-2.5 bg-primary-600 text-white text-sm font-medium rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {submitting ? t('savings.sending', 'Sending…') : t('savings.sendInvite', 'Send Invite')}
        </button>
      </div>
    </div>
  );
}
