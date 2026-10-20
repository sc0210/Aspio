/**
 * Bill-splitter groups *list* page tests.
 *
 *  - Demo mode: renders the seeded groups from fixtures, links to detail, expands
 *    balances from fixtures, and never calls apiClient.
 *  - Live mode (linked): GET /line-bot/link-status then /line-bot/groups; renders
 *    the returned groups.
 *  - Live mode (not linked): shows the "connect your LINE account" prompt and does
 *    NOT fetch groups.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import enGroups from '@/locales/en/groups.json';

function lookup(ns: Record<string, unknown>, key: string): unknown {
  return key.split('.').reduce<unknown>(
    (acc, part) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[part] : undefined),
    ns,
  );
}
function translate(key: string, opts?: Record<string, unknown>): string {
  // List page uses combined namespaces; strip "groups:" and ignore others.
  let k = key;
  if (k.startsWith('groups:')) k = k.slice('groups:'.length);
  else if (k.includes(':')) return key; // common: keys → return raw key
  let val = lookup(enGroups as Record<string, unknown>, k);
  // i18next v4 plurals: `_one` / `_other`, falling back to the bare key.
  if (opts && typeof opts.count === 'number') {
    const plural = lookup(enGroups as Record<string, unknown>, `${k}_${opts.count === 1 ? 'one' : 'other'}`);
    if (typeof plural === 'string') val = plural;
  }
  if (typeof val !== 'string') return key;
  return val.replace(/\{\{(\w+)\}\}/g, (_m, name) => (opts && opts[name] != null ? String(opts[name]) : ''));
}

// The LINE bot is configured: these suites exercise the pages it unlocks.
jest.mock('@/hooks/useFeatures', () => ({ useFeatures: () => ({ lineBot: true, isLoading: false, isError: false }) }));
jest.mock('react-i18next', () => ({
  // i18next calls .use(initReactI18next) at import time; a mock without it
  // makes lib/i18n throw and the whole suite dies before any test runs.
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({ t: (key: string, opts?: Record<string, unknown>) => translate(key, opts) }),
}));
jest.mock('@/components/layout/DashboardLayout', () => ({
  DashboardLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const mockGet = jest.fn();
jest.mock('@/lib/api-client', () => ({
  apiClient: { get: (...a: unknown[]) => mockGet(...a) },
}));

let mockIsDemo = true;
jest.mock('@/hooks/useAppMode', () => ({
  useAppMode: () => ({ isDemo: mockIsDemo }),
}));

import GroupsPage from '@/app/groups/page';

beforeEach(() => {
  mockIsDemo = true;
  mockGet.mockReset();
});

describe('GroupsPage — demo mode', () => {
  it('renders seeded groups from fixtures without any network call', async () => {
    render(<GroupsPage />);

    expect(await screen.findByText('台北室友')).toBeInTheDocument();
    expect(screen.getByText('日本旅遊團')).toBeInTheDocument();
    // member count + currency line.
    expect(screen.getByText(/3 members · TWD/)).toBeInTheDocument();

    expect(mockGet).not.toHaveBeenCalled();
  });

  it('links each group to its detail route', async () => {
    render(<GroupsPage />);
    const link = (await screen.findByText('台北室友')).closest('a');
    expect(link).toHaveAttribute('href', '/groups/demo-group-1');
  });

  it('expands balances from fixtures (still no network)', async () => {
    render(<GroupsPage />);
    await screen.findByText('台北室友');

    // The first group has outstanding balances; the Balances toggle is the
    // button inside that card.
    const balanceToggles = screen.getAllByText('Balances');
    fireEvent.click(balanceToggles[0]);

    // Owed amount from demoGroupBalances → formatCurrency precision 0.
    expect(await screen.findByText(/1,200/)).toBeInTheDocument();
    expect(mockGet).not.toHaveBeenCalled();
    // Demo "you" is Alex, so Alex's own edges read from Alex's side.
    expect(screen.getByText('小明 owes you')).toBeInTheDocument();
    expect(screen.queryByText('Alex Chen')).not.toBeInTheDocument();
  });
});

describe('GroupsPage — live mode', () => {
  it('fetches link-status then groups when linked, and renders them', async () => {
    mockIsDemo = false;
    mockGet.mockImplementation((url: string) => {
      if (url === '/line-bot/link-status')
        return Promise.resolve({ data: { linked: true, display_name: 'Alex Chen' } });
      if (url === '/line-bot/groups')
        return Promise.resolve({
          data: [
            {
              id: 'g-live-1',
              line_group_id: 'C1',
              name: 'Live Roommates',
              currency: 'TWD',
              member_count: 2,
              created_at: '2026-01-01T00:00:00Z',
            },
          ],
        });
      return Promise.resolve({ data: null });
    });

    render(<GroupsPage />);

    expect(await screen.findByText('Live Roommates')).toBeInTheDocument();
    const urls = mockGet.mock.calls.map((c) => c[0]);
    expect(urls).toContain('/line-bot/link-status');
    expect(urls).toContain('/line-bot/groups');
  });

  it('shows the connect prompt and skips the groups fetch when not linked', async () => {
    mockIsDemo = false;
    mockGet.mockImplementation((url: string) => {
      if (url === '/line-bot/link-status') return Promise.resolve({ data: { linked: false } });
      return Promise.resolve({ data: null });
    });

    render(<GroupsPage />);

    expect(await screen.findByText(enGroups.notLinked.title)).toBeInTheDocument();
    const urls = mockGet.mock.calls.map((c) => c[0]);
    expect(urls).toContain('/line-bot/link-status');
    expect(urls).not.toContain('/line-bot/groups');
  });
});
