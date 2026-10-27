'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowPathIcon, ClipboardDocumentListIcon, XCircleIcon } from '@heroicons/react/24/outline';
import { Card } from '@/components/ui/Card';
import { apiClient } from '@/lib/api-client';
import { cn } from '@/utils/cn';
import type { AuditLogEntry, AuditLogPage } from '@/types/admin';
import { formatTimeAgo } from './formatTimeAgo';

const PAGE_SIZE = 50;

// The actions the admin router writes (log_admin_action / run_vacuum / run_cleanup).
const ACTIONS = ['approve_user', 'reject_user', 'delete_user', 'toggle_active', 'vacuum', 'cleanup'] as const;

const ACTION_CLASSES: Record<string, string> = {
  approve_user: 'bg-success-100 dark:bg-success-900/30 text-success-700 dark:text-success-300',
  reject_user: 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300',
  delete_user: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300',
  toggle_active: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300',
};
const DEFAULT_ACTION_CLASS = 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300';

/** What the action was done to: the user's email, or the table for vacuum. */
function targetOf(entry: AuditLogEntry): string {
  const { metadata } = entry;
  const named = metadata.user_email ?? metadata.email ?? metadata.table;
  if (typeof named === 'string') return named;
  return entry.resource_id ?? entry.resource_type;
}

export function AuditLogPanel() {
  const { t } = useTranslation(['admin']);
  const [action, setAction] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<AuditLogPage | null>(null);
  const [state, setState] = useState<'loading' | 'loaded' | 'error'>('loading');
  const [error, setError] = useState('');

  // State is only set after the request settles, so the effect can call it (the
  // lint rule cannot see past the await); handlers that change the query set
  // 'loading' themselves.
  const fetchPage = useCallback(async () => {
    const params = new URLSearchParams({ skip: String((page - 1) * PAGE_SIZE), limit: String(PAGE_SIZE) });
    if (action) params.set('action', action);
    try {
      const res = await apiClient.get<AuditLogPage>(`/admin/audit-logs?${params}`);
      setData(res.data ?? null);
      setState('loaded');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('admin:audit.loadFailed'));
      setState('error');
    }
  }, [action, page, t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchPage();
  }, [fetchPage]);

  const startLoading = () => {
    setState('loading');
    setError('');
  };
  const load = () => {
    startLoading();
    fetchPage();
  };
  const changeAction = (next: string) => {
    startLoading();
    setAction(next);
    setPage(1);
  };
  const goTo = (next: number) => {
    startLoading();
    setPage(next);
  };

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <Card padding="none" clip>
      <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
            <ClipboardDocumentListIcon className="w-4 h-4 text-blue-700 dark:text-blue-400" />
          </div>
          <div>
            <h3 className="text-base font-bold text-gray-900 dark:text-white">{t('admin:audit.title')}</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              {data ? t('admin:audit.count', { count: data.total }) : t('admin:audit.subtitle')}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="audit-action" className="sr-only">{t('admin:audit.filterLabel')}</label>
          <select
            id="audit-action"
            value={action}
            onChange={(e) => changeAction(e.target.value)}
            className="text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 px-3 py-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
          >
            <option value="">{t('admin:audit.allActions')}</option>
            {ACTIONS.map((a) => (
              <option key={a} value={a}>{t(`admin:audit.actions.${a}`)}</option>
            ))}
          </select>
          <button
            onClick={load}
            disabled={state === 'loading'}
            aria-label={t('admin:refresh')}
            className="p-1.5 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 transition-colors"
          >
            <ArrowPathIcon className={cn('w-4 h-4', state === 'loading' && 'animate-spin')} />
          </button>
        </div>
      </div>

      {state === 'error' && (
        <div className="m-6 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-4 py-3 flex items-start gap-2">
          <XCircleIcon className="w-4 h-4 text-red-700 dark:text-red-400 mt-0.5 shrink-0" />
          <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
        </div>
      )}

      {state !== 'error' && data && data.logs.length === 0 && (
        <p className="px-6 py-10 text-center text-sm text-gray-500 dark:text-gray-400">{t('admin:audit.empty')}</p>
      )}

      {state !== 'error' && data && data.logs.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                <th className="px-6 py-3">{t('admin:audit.when')}</th>
                <th className="px-6 py-3">{t('admin:audit.action')}</th>
                <th className="px-6 py-3">{t('admin:audit.target')}</th>
                <th className="px-6 py-3">{t('admin:audit.admin')}</th>
                <th className="px-6 py-3">{t('admin:audit.result')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700/60">
              {data.logs.map((entry) => (
                <tr key={entry.id} className="hover:bg-gray-50 dark:hover:bg-gray-900/40">
                  <td className="px-6 py-3 whitespace-nowrap text-gray-600 dark:text-gray-400">
                    {entry.created_at ? (
                      <span title={new Date(entry.created_at).toLocaleString()}>{formatTimeAgo(entry.created_at)}</span>
                    ) : '—'}
                  </td>
                  <td className="px-6 py-3 whitespace-nowrap">
                    <span className={cn('inline-flex px-2 py-0.5 rounded-md text-xs font-semibold', ACTION_CLASSES[entry.action] ?? DEFAULT_ACTION_CLASS)}>
                      {t(`admin:audit.actions.${entry.action}`, { defaultValue: entry.action })}
                    </span>
                  </td>
                  <td className="px-6 py-3 text-gray-900 dark:text-white max-w-[16rem] truncate" title={targetOf(entry)}>
                    {targetOf(entry)}
                  </td>
                  <td className="px-6 py-3 text-gray-600 dark:text-gray-400 max-w-[14rem] truncate">
                    {entry.admin_email ?? '—'}
                  </td>
                  <td className="px-6 py-3 whitespace-nowrap">
                    {entry.status === 'success' ? (
                      <span className="text-success-700 dark:text-success-400">{t('admin:audit.success')}</span>
                    ) : (
                      <span className="text-red-700 dark:text-red-400" title={entry.error_message ?? undefined}>{entry.status}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data && totalPages > 1 && (
        <div className="px-6 py-3 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between text-sm">
          <span className="text-gray-500 dark:text-gray-400">{t('admin:audit.page', { page, total: totalPages })}</span>
          <div className="flex gap-2">
            <button
              onClick={() => goTo(page - 1)}
              disabled={page <= 1 || state === 'loading'}
              className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
            >
              {t('admin:audit.previous')}
            </button>
            <button
              onClick={() => goTo(page + 1)}
              disabled={page >= totalPages || state === 'loading'}
              className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
            >
              {t('admin:next')}
            </button>
          </div>
        </div>
      )}
    </Card>
  );
}
