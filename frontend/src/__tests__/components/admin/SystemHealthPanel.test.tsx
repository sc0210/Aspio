/**
 * The Scheduled jobs section of the admin health panel. i18next runs for real
 * on the shipped admin bundle, so a wrong key shows up as a failed assertion
 * instead of a readable fallback.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import admin from '@/locales/en/admin.json';
import type { JobRun, SystemHealth } from '@/types/admin';

const mockGet = jest.fn();
jest.mock('@/lib/api-client', () => ({ apiClient: { get: (...args: unknown[]) => mockGet(...args) } }));

import { SystemHealthPanel } from '@/components/admin/SystemHealthPanel';

const i18n = i18next.createInstance();
i18n.use(initReactI18next).init({
  lng: 'en',
  fallbackLng: 'en',
  ns: ['admin'],
  defaultNS: 'admin',
  resources: { en: { admin } },
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

const HOUR = 3_600_000;

function run(overrides: Partial<JobRun>): JobRun {
  return {
    id: 'daily_historical_sync',
    name: 'Daily Historical Data Sync',
    status: 'ok',
    last_run_at: new Date(Date.now() - 2 * HOUR).toISOString(),
    duration_ms: 1200,
    summary: {},
    error: null,
    overdue: false,
    ...overrides,
  };
}

function health(jobRuns: JobRun[], schedulerEnabled = true): SystemHealth {
  return {
    status: 'healthy',
    app: { version: '1.0.0', commit: 'unknown', environment: 'test', uptime_seconds: 1, line_bot_enabled: false },
    database: { status: 'healthy', latency_ms: 1 },
    scheduler: { status: 'healthy', enabled: schedulerEnabled, running: true, jobs: [] },
    job_runs: jobRuns,
    data_freshness: {
      historical_prices: { status: 'empty', latest: null, age_days: null },
      fx_rates: { status: 'empty', latest: null, age_days: null },
    },
    timestamp: new Date().toISOString(),
  };
}

function renderPanel(data: SystemHealth) {
  mockGet.mockResolvedValue({ success: true, data });
  return render(
    <I18nextProvider i18n={i18n}>
      <SystemHealthPanel />
    </I18nextProvider>,
  );
}

describe('SystemHealthPanel scheduled jobs', () => {
  beforeEach(() => mockGet.mockReset());

  it('lists each job with its counts and status', async () => {
    renderPanel(health([run({ summary: { successful: 12, failed: 0, cached: 30 } })]));

    expect(await screen.findByText('Historical price sync')).toBeInTheDocument();
    expect(screen.getByText('12 synced')).toBeInTheDocument();
    expect(screen.getByText('OK')).toBeInTheDocument();
    expect(screen.getByText('2h ago')).toBeInTheDocument();
  });

  it('shows a failed run with its error type, and an overdue one', async () => {
    renderPanel(
      health([
        run({ status: 'failed', error: 'ConnectionError' }),
        run({ id: 'us_market_price_update', name: 'US Market Price Update', overdue: true }),
      ]),
    );

    expect(await screen.findByText('Failed')).toBeInTheDocument();
    expect(screen.getByText('ConnectionError (details in the backend log)')).toBeInTheDocument();
    expect(screen.getByText('US prices')).toBeInTheDocument();
    expect(screen.getByText('Overdue')).toBeInTheDocument();
  });

  it('says so when nothing has run yet', async () => {
    renderPanel(health([]));
    expect(await screen.findByText(/No runs recorded yet/)).toBeInTheDocument();
  });

  it('hides the section when the scheduler is off', async () => {
    renderPanel(health([], false));
    expect(await screen.findByText('Database')).toBeInTheDocument();
    expect(screen.queryByText('Scheduled jobs')).not.toBeInTheDocument();
  });
});
