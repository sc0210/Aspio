'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowPathIcon,
  CircleStackIcon,
  ClockIcon,
  HeartIcon,
  SignalIcon,
  XCircleIcon,
} from '@heroicons/react/24/outline';
import { Card } from '@/components/ui/Card';
import { apiClient } from '@/lib/api-client';
import { cn } from '@/utils/cn';
import type { FeedFreshness, SystemHealth } from '@/types/admin';

type Tone = 'good' | 'warn' | 'bad' | 'muted';

const TONE_CLASSES: Record<Tone, string> = {
  good: 'bg-success-100 dark:bg-success-900/30 text-success-700 dark:text-success-300',
  warn: 'bg-warning-100 dark:bg-warning-900/30 text-warning-700 dark:text-warning-300',
  bad: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300',
  muted: 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400',
};

const OVERALL_TONE: Record<SystemHealth['status'], Tone> = {
  healthy: 'good',
  degraded: 'warn',
  unhealthy: 'bad',
};

const SCHEDULER_TONE: Record<SystemHealth['scheduler']['status'], Tone> = {
  healthy: 'good',
  unhealthy: 'bad',
  disabled: 'muted',
  unknown: 'muted',
};

const FEED_TONE: Record<FeedFreshness['status'], Tone> = {
  fresh: 'good',
  stale: 'warn',
  empty: 'muted',
  unknown: 'muted',
};

const FEEDS = ['historical_prices', 'fx_rates'] as const;

function Badge({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return (
    <span className={cn('inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold', TONE_CLASSES[tone])}>
      {children}
    </span>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2.5">
      <span className="text-sm text-gray-700 dark:text-gray-300">{label}</span>
      <span className="text-sm font-semibold text-gray-900 dark:text-white tabular-nums text-right">{children}</span>
    </div>
  );
}

function Section({ icon: Icon, title, children }: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50">
      <div className="flex items-center gap-2 px-4 pt-3 pb-1">
        <Icon className="w-4 h-4 text-gray-500 dark:text-gray-400" />
        <h4 className="text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">{title}</h4>
      </div>
      <div className="divide-y divide-gray-200 dark:divide-gray-700">{children}</div>
    </div>
  );
}

/**
 * Live health of a self-hosted instance: the database round trip, whether the
 * scheduler is running in any worker, and how old the daily data feeds are.
 */
export function SystemHealthPanel() {
  const { t } = useTranslation(['admin']);
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [state, setState] = useState<'loading' | 'loaded' | 'error'>('loading');
  const [error, setError] = useState('');

  // State is only set after the request settles, so the mount effect can call it
  // (the lint rule cannot see past the await).
  const fetchHealth = useCallback(async () => {
    try {
      const res = await apiClient.get<SystemHealth>('/admin/health/detailed');
      setHealth(res.data ?? null);
      setState('loaded');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('admin:health.loadFailed'));
      setState('error');
    }
  }, [t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchHealth();
  }, [fetchHealth]);

  const load = () => {
    setState('loading');
    setError('');
    fetchHealth();
  };

  const feedValue = (feed: FeedFreshness) => {
    if (feed.status === 'empty') return <Badge tone="muted">{t('admin:health.feed.empty')}</Badge>;
    if (feed.status === 'unknown' || !feed.latest) return <Badge tone="muted">{t('admin:health.unknown')}</Badge>;
    return (
      <span className="inline-flex items-center gap-2">
        <span className="text-gray-600 dark:text-gray-400 font-normal">
          {feed.latest} · {t('admin:health.daysAgo', { count: feed.age_days ?? 0 })}
        </span>
        <Badge tone={FEED_TONE[feed.status]}>{t(`admin:health.feed.${feed.status}`)}</Badge>
      </span>
    );
  };

  return (
    <Card padding="none" clip>
      <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-success-100 dark:bg-success-900/30 flex items-center justify-center">
            <HeartIcon className="w-4 h-4 text-success-700 dark:text-success-400" />
          </div>
          <div>
            <h3 className="text-base font-bold text-gray-900 dark:text-white">{t('admin:health.title')}</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{t('admin:health.subtitle')}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {health && state === 'loaded' && (
            <Badge tone={OVERALL_TONE[health.status]}>{t(`admin:health.overall.${health.status}`)}</Badge>
          )}
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

      <div className="px-6 py-5">
        {state === 'error' && (
          <div className="rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-4 py-3 flex items-start gap-2">
            <XCircleIcon className="w-4 h-4 text-red-700 dark:text-red-400 mt-0.5 shrink-0" />
            <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
          </div>
        )}

        {state === 'loading' && !health && (
          <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
            <ArrowPathIcon className="w-4 h-4 animate-spin" />
            {t('admin:health.checking')}
          </div>
        )}

        {health && state !== 'error' && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <Section icon={CircleStackIcon} title={t('admin:health.database')}>
                <Row label={t('admin:health.status')}>
                  <Badge tone={health.database.status === 'healthy' ? 'good' : 'bad'}>
                    {t(`admin:health.overall.${health.database.status}`)}
                  </Badge>
                </Row>
                {health.database.latency_ms !== undefined && (
                  <Row label={t('admin:health.latency')}>{health.database.latency_ms} ms</Row>
                )}
                {health.database.version && (
                  <Row label={t('admin:health.postgres')}>{health.database.version}</Row>
                )}
              </Section>

              <Section icon={ClockIcon} title={t('admin:health.scheduler')}>
                <Row label={t('admin:health.status')}>
                  <Badge tone={SCHEDULER_TONE[health.scheduler.status]}>
                    {t(`admin:health.schedulerStatus.${health.scheduler.status}`)}
                  </Badge>
                </Row>
                {health.scheduler.jobs.length > 0 && (
                  <Row label={t('admin:health.jobs')}>{health.scheduler.jobs.length}</Row>
                )}
              </Section>

              <Section icon={SignalIcon} title={t('admin:health.dataFreshness')}>
                {FEEDS.map((name) => (
                  <Row key={name} label={t(`admin:health.feeds.${name}`)}>
                    {feedValue(health.data_freshness[name])}
                  </Row>
                ))}
              </Section>
            </div>

            <p className="text-xs text-gray-500 dark:text-gray-400">
              v{health.app.version}
              {health.app.commit !== 'unknown' && <> · {health.app.commit.slice(0, 7)}</>}
              {' · '}{health.app.environment}
              {' · '}{t(health.app.line_bot_enabled ? 'admin:health.lineBotOn' : 'admin:health.lineBotOff')}
            </p>
          </div>
        )}
      </div>
    </Card>
  );
}
