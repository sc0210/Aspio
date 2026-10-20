/**
 * Bill-splitter group detail page — component / behaviour tests.
 *
 * Covers:
 *  1. Demo mode renders from fixtures and NEVER calls apiClient.
 *  2. Demo writes (add equal/custom, edit, delete, settle full/partial) mutate
 *     local React state only — apiClient is still never called — and the custom
 *     split that doesn't sum to the total is blocked client-side.
 *  3. Live mode wires each write to the correct method + URL + body shape and
 *     re-runs the reload() loader (subsequent GETs) after success.
 *  4. Live error surfacing — a rejected write renders its message inline.
 *
 * Boundaries mocked: @/lib/api-client, react-i18next (resolved against the REAL
 * en/groups.json so the asserted copy matches production), @/hooks/useAppMode
 * (toggles isDemo) and next/navigation useParams.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

// ── i18n mock — resolves real keys from the en groups namespace + interpolates ──
// (jest.mock factory may not close over outer vars, so it require()s the JSON
// itself; `import ... from '*.json'` is unreliable under next/jest, require() is
// not.)
// The LINE bot is configured: these suites exercise the pages it unlocks.
jest.mock('@/hooks/useFeatures', () => ({ useFeatures: () => ({ lineBot: true, isLoading: false }) }));
jest.mock('react-i18next', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const en = require('@/locales/en/groups.json') as Record<string, unknown>;
  const lookup = (key: string): unknown =>
    key.split('.').reduce<unknown>(
      (acc, part) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[part] : undefined),
      en,
    );
  const translate = (key: string, opts?: Record<string, unknown>): string => {
    let val = lookup(key);
    // i18next v4 plurals: `_one` / `_other`, falling back to the bare key.
    if (opts && typeof opts.count === 'number') {
      const plural = lookup(`${key}_${opts.count === 1 ? 'one' : 'other'}`);
      if (typeof plural === 'string') val = plural;
    }
    if (typeof val !== 'string') return key;
    return val.replace(/\{\{(\w+)\}\}/g, (_m: string, name: string) =>
      opts && opts[name] != null ? String(opts[name]) : '',
    );
  };
  return {
    // i18next calls .use(initReactI18next) at import time; a mock without it
    // makes lib/i18n throw and the whole suite dies before any test runs.
    initReactI18next: { type: '3rdParty', init: () => {} },
    // Return the module-level `translate` directly so `t` keeps a STABLE
    // identity across renders. Wrapping it in a fresh arrow each call made `t`
    // change every render, which (via the reload useCallback that depends on it)
    // re-fired GroupDetailPage's load effect endlessly → "Maximum update depth
    // exceeded". Real react-i18next returns a stable `t`, so this matches prod.
    useTranslation: () => ({ t: translate }),
  };
});

jest.mock('@/components/layout/DashboardLayout', () => ({
  DashboardLayout: ({ children }: { children: React.ReactNode }) => <div data-testid="layout">{children}</div>,
}));

// useParams → the seeded demo group with outstanding balances.
jest.mock('next/navigation', () => ({
  useParams: () => ({ id: 'demo-group-1' }),
}));

// api-client mock — the spy we assert "never called" / "called with X" against.
const mockGet = jest.fn();
const mockPost = jest.fn();
const mockPatch = jest.fn();
const mockDelete = jest.fn();
jest.mock('@/lib/api-client', () => ({
  apiClient: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
    patch: (...args: unknown[]) => mockPatch(...args),
    delete: (...args: unknown[]) => mockDelete(...args),
  },
}));

// useAppMode — toggled per-test via mockIsDemo.
let mockIsDemo = true;
jest.mock('@/hooks/useAppMode', () => ({
  useAppMode: () => ({ isDemo: mockIsDemo }),
}));

import GroupDetailPage from '@/app/groups/[id]/page';

// Live-mode GET payloads mirroring the demo fixtures so the page renders the
// same way whether demo or live (lets us reuse the same UI assertions).
const liveBalances = {
  group_id: 'demo-group-1',
  currency: 'TWD',
  member_names: {
    'demo-gm-alex': 'Alex Chen',
    'demo-gm-ming': '小明',
    'demo-gm-mei': '小美',
  },
  balances: [
    { owed_by: 'demo-gm-ming', owed_to: 'demo-gm-alex', amount: '1200', currency: 'TWD' },
    { owed_by: 'demo-gm-mei', owed_to: 'demo-gm-alex', amount: '450', currency: 'TWD' },
  ],
};
const liveMembers = [
  { user_id: 'demo-gm-alex', display_name: 'Alex Chen', line_user_id: 'Udemo01' },
  { user_id: 'demo-gm-ming', display_name: '小明', line_user_id: 'Udemo02' },
  { user_id: 'demo-gm-mei', display_name: '小美', line_user_id: 'Udemo03' },
];
const liveExpenses = [
  {
    id: 'gx-1',
    payer_id: 'demo-gm-alex',
    amount: '900',
    currency: 'TWD',
    description: 'Hot pot',
    created_at: new Date().toISOString(),
    splits: [
      { user_id: 'demo-gm-alex', amount: '300' },
      { user_id: 'demo-gm-ming', amount: '300' },
      { user_id: 'demo-gm-mei', amount: '300' },
    ],
  },
];
const liveGroups = [{ id: 'demo-group-1', name: 'Taipei Flat', currency: 'TWD' }];

function primeLiveGet() {
  mockGet.mockImplementation((url: string) => {
    if (url.endsWith('/balances')) return Promise.resolve({ data: liveBalances });
    if (url.endsWith('/members')) return Promise.resolve({ data: liveMembers });
    if (url.endsWith('/expenses')) return Promise.resolve({ data: liveExpenses });
    if (url === '/line-bot/groups') return Promise.resolve({ data: liveGroups });
    return Promise.resolve({ data: null });
  });
}

beforeEach(() => {
  mockIsDemo = true;
  mockGet.mockReset();
  mockPost.mockReset();
  mockPatch.mockReset();
  mockDelete.mockReset();
  mockPost.mockResolvedValue({ data: {} });
  mockPatch.mockResolvedValue({ data: {} });
  mockDelete.mockResolvedValue({ data: {} });
});

// ── Helpers to drive the modals ─────────────────────────────────────────────────
async function openAddModal() {
  fireEvent.click(await screen.findByText('Add expense'));
  return screen.getByRole('dialog');
}
function getDialog() {
  return screen.getByRole('dialog');
}
function setInput(dialog: HTMLElement, labelText: string | RegExp, value: string) {
  const label = within(dialog).getByText(labelText);
  const wrapper = label.parentElement as HTMLElement;
  const input = wrapper.querySelector('input, select') as HTMLInputElement;
  fireEvent.change(input, { target: { value } });
  return input;
}
function customSplitInputs(dialog: HTMLElement) {
  return dialog
    .querySelector<HTMLElement>('.space-y-2.rounded-xl')!
    .querySelectorAll<HTMLInputElement>('input[type="number"]');
}

// ════════════════════════════════════════════════════════════════════════════
describe('GroupDetailPage — demo mode (no network)', () => {
  it('renders demo fixtures and never touches apiClient', async () => {
    render(<GroupDetailPage />);

    // Group header (name from fixtures) + member count line.
    expect(await screen.findByText('台北室友')).toBeInTheDocument();
    expect(screen.getByText(/3 members/)).toBeInTheDocument();

    // Outstanding balances from fixtures (formatAmount → "TWD 1,200").
    expect(screen.getByText('TWD 1,200')).toBeInTheDocument();
    expect(screen.getByText('TWD 450')).toBeInTheDocument();

    // Demo session-only notice.
    expect(screen.getByText(/Demo mode/)).toBeInTheDocument();

    // Expense history from fixtures.
    expect(screen.getByText('水電瓦斯費')).toBeInTheDocument();
    expect(screen.getByText('週末火鍋')).toBeInTheDocument();

    expect(mockGet).not.toHaveBeenCalled();
    expect(mockPost).not.toHaveBeenCalled();
    expect(mockPatch).not.toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('adds an equal-split expense, updates balances, and makes no network call', async () => {
    render(<GroupDetailPage />);
    await screen.findByText('台北室友');

    const dialog = await openAddModal();
    setInput(dialog, /Amount/, '3000');
    setInput(dialog, 'Description', 'Groceries');
    // splitMode defaults to "equal"; payer defaults to demo current user (Alex).
    fireEvent.click(within(dialog).getByText('Save'));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await screen.findByText('Groceries')).toBeInTheDocument();

    // Alex paid 3000; equal split 1000 each → Ming 1200→2200, Mei 450→1450.
    expect(screen.getByText('TWD 2,200')).toBeInTheDocument();
    expect(screen.getByText('TWD 1,450')).toBeInTheDocument();

    expect(mockPost).not.toHaveBeenCalled();
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('blocks a custom split that does not sum to the total, then allows a valid one', async () => {
    render(<GroupDetailPage />);
    await screen.findByText('台北室友');

    const dialog = await openAddModal();
    setInput(dialog, /Amount/, '900');
    setInput(dialog, 'Description', 'Dinner');
    fireEvent.click(within(dialog).getByText('Custom split'));

    const inputs = customSplitInputs(dialog);
    fireEvent.change(inputs[0], { target: { value: '300' } });
    fireEvent.change(inputs[1], { target: { value: '300' } });
    fireEvent.change(inputs[2], { target: { value: '200' } }); // sums to 800 ≠ 900

    fireEvent.click(within(dialog).getByText('Save'));

    // Error surfaced, modal stays open, no expense added.
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/must add up to the total/);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.queryByText('Dinner')).not.toBeInTheDocument();

    // Fix the last split to 300 → sums to 900 → saves.
    fireEvent.change(inputs[2], { target: { value: '300' } });
    fireEvent.click(within(dialog).getByText('Save'));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await screen.findByText('Dinner')).toBeInTheDocument();
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('edits an existing expense in place (demo)', async () => {
    render(<GroupDetailPage />);
    await screen.findByText('台北室友');

    fireEvent.click(screen.getByText('週末火鍋')); // open for edit
    const dialog = getDialog();
    expect(within(dialog).getByText('Edit expense')).toBeInTheDocument();

    setInput(dialog, 'Description', 'Updated hotpot');
    fireEvent.click(within(dialog).getByText('Save'));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await screen.findByText('Updated hotpot')).toBeInTheDocument();
    expect(screen.queryByText('週末火鍋')).not.toBeInTheDocument();
    expect(mockPatch).not.toHaveBeenCalled();
  });

  it('deletes an expense and recomputes balances (demo)', async () => {
    render(<GroupDetailPage />);
    await screen.findByText('台北室友');

    fireEvent.click(screen.getByText('水電瓦斯費')); // 3600 utilities
    let dialog = getDialog();
    fireEvent.click(within(dialog).getByText('Delete expense'));
    dialog = getDialog();
    fireEvent.click(within(dialog).getByText('Delete'));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.queryByText('水電瓦斯費')).not.toBeInTheDocument();

    // Removing Alex's 3600 (1200 each) clears Ming's 1200 debt entirely.
    expect(screen.queryByText('TWD 1,200')).not.toBeInTheDocument();
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('settles a balance in full and removes it from the list (demo)', async () => {
    render(<GroupDetailPage />);
    await screen.findByText('台北室友');

    fireEvent.click(screen.getAllByText('Settle')[0]); // Ming → Alex (1200)
    const dialog = getDialog();
    fireEvent.click(within(dialog).getByText('Settle', { selector: 'button' })); // full

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.queryByText('TWD 1,200')).not.toBeInTheDocument();
    expect(screen.getByText('TWD 450')).toBeInTheDocument();
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('settles a balance partially, leaving the remainder (demo)', async () => {
    render(<GroupDetailPage />);
    await screen.findByText('台北室友');

    fireEvent.click(screen.getAllByText('Settle')[0]); // Ming → Alex (1200)
    const dialog = getDialog();
    fireEvent.click(within(dialog).getByText('Settle a partial amount'));
    setInput(dialog, /Amount to settle/, '500');
    fireEvent.click(within(dialog).getByText('Settle', { selector: 'button' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByText('TWD 700')).toBeInTheDocument(); // 1200 - 500
    expect(screen.queryByText('TWD 1,200')).not.toBeInTheDocument();
    expect(mockPost).not.toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('GroupDetailPage — live mode (wires the API)', () => {
  beforeEach(() => {
    mockIsDemo = false;
    primeLiveGet();
  });

  it('loads via GET balances/members/expenses/groups on mount', async () => {
    render(<GroupDetailPage />);
    expect(await screen.findByText('Taipei Flat')).toBeInTheDocument();

    const urls = mockGet.mock.calls.map((c) => c[0]);
    expect(urls).toContain('/line-bot/groups/demo-group-1/balances');
    expect(urls).toContain('/line-bot/groups/demo-group-1/members');
    expect(urls).toContain('/line-bot/groups/demo-group-1/expenses');
    expect(urls).toContain('/line-bot/groups');
  });

  it('POSTs a new expense then reloads', async () => {
    render(<GroupDetailPage />);
    await screen.findByText('Taipei Flat');
    const initialGetCount = mockGet.mock.calls.length;

    fireEvent.click(screen.getByText('Add expense'));
    const dialog = getDialog();
    setInput(dialog, /Amount/, '1200');
    setInput(dialog, 'Description', 'Taxi');
    fireEvent.click(within(dialog).getByText('Save'));

    await waitFor(() => expect(mockPost).toHaveBeenCalledTimes(1));
    const [url, body] = mockPost.mock.calls[0];
    expect(url).toBe('/line-bot/groups/demo-group-1/expenses');
    expect(body).toMatchObject({
      amount: '1200.00',
      description: 'Taxi',
      payer_id: 'demo-gm-alex', // first member is the default payer in live mode
    });
    expect(body).not.toHaveProperty('splits'); // equal split → no splits key

    await waitFor(() => expect(mockGet.mock.calls.length).toBeGreaterThan(initialGetCount));
  });

  it('POSTs custom splits in the body shape the API expects', async () => {
    render(<GroupDetailPage />);
    await screen.findByText('Taipei Flat');

    fireEvent.click(screen.getByText('Add expense'));
    const dialog = getDialog();
    setInput(dialog, /Amount/, '900');
    setInput(dialog, 'Description', 'Dinner');
    fireEvent.click(within(dialog).getByText('Custom split'));
    const inputs = customSplitInputs(dialog);
    fireEvent.change(inputs[0], { target: { value: '500' } });
    fireEvent.change(inputs[1], { target: { value: '250' } });
    fireEvent.change(inputs[2], { target: { value: '150' } });
    fireEvent.click(within(dialog).getByText('Save'));

    await waitFor(() => expect(mockPost).toHaveBeenCalledTimes(1));
    const [, body] = mockPost.mock.calls[0];
    expect(body.splits).toEqual([
      { user_id: 'demo-gm-alex', amount: '500.00' },
      { user_id: 'demo-gm-ming', amount: '250.00' },
      { user_id: 'demo-gm-mei', amount: '150.00' },
    ]);
  });

  it('PATCHes when editing an existing expense then reloads', async () => {
    render(<GroupDetailPage />);
    await screen.findByText('Hot pot');
    const initialGetCount = mockGet.mock.calls.length;

    fireEvent.click(screen.getByText('Hot pot'));
    const dialog = getDialog();
    setInput(dialog, 'Description', 'Hot pot deluxe');
    fireEvent.click(within(dialog).getByText('Save'));

    await waitFor(() => expect(mockPatch).toHaveBeenCalledTimes(1));
    const [url, body] = mockPatch.mock.calls[0];
    expect(url).toBe('/line-bot/groups/demo-group-1/expenses/gx-1');
    expect(body).toMatchObject({ description: 'Hot pot deluxe' });
    await waitFor(() => expect(mockGet.mock.calls.length).toBeGreaterThan(initialGetCount));
  });

  it('DELETEs an expense then reloads', async () => {
    render(<GroupDetailPage />);
    await screen.findByText('Hot pot');
    const initialGetCount = mockGet.mock.calls.length;

    fireEvent.click(screen.getByText('Hot pot'));
    let dialog = getDialog();
    fireEvent.click(within(dialog).getByText('Delete expense'));
    dialog = getDialog();
    fireEvent.click(within(dialog).getByText('Delete'));

    await waitFor(() => expect(mockDelete).toHaveBeenCalledTimes(1));
    expect(mockDelete.mock.calls[0][0]).toBe('/line-bot/groups/demo-group-1/expenses/gx-1');
    await waitFor(() => expect(mockGet.mock.calls.length).toBeGreaterThan(initialGetCount));
  });

  it('POSTs to /settle with owed_by/owed_to (full) then reloads', async () => {
    render(<GroupDetailPage />);
    await screen.findByText('Taipei Flat');
    const initialGetCount = mockGet.mock.calls.length;

    fireEvent.click(screen.getAllByText('Settle')[0]); // Ming → Alex
    const dialog = getDialog();
    fireEvent.click(within(dialog).getByText('Settle', { selector: 'button' }));

    await waitFor(() => expect(mockPost).toHaveBeenCalledTimes(1));
    const [url, body] = mockPost.mock.calls[0];
    expect(url).toBe('/line-bot/groups/demo-group-1/settle');
    expect(body).toEqual({ owed_by: 'demo-gm-ming', owed_to: 'demo-gm-alex' });
    expect(body).not.toHaveProperty('amount');
    await waitFor(() => expect(mockGet.mock.calls.length).toBeGreaterThan(initialGetCount));
  });

  it('POSTs to /settle with an amount when settling partially', async () => {
    render(<GroupDetailPage />);
    await screen.findByText('Taipei Flat');

    fireEvent.click(screen.getAllByText('Settle')[0]);
    const dialog = getDialog();
    fireEvent.click(within(dialog).getByText('Settle a partial amount'));
    setInput(dialog, /Amount to settle/, '500');
    fireEvent.click(within(dialog).getByText('Settle', { selector: 'button' }));

    await waitFor(() => expect(mockPost).toHaveBeenCalledTimes(1));
    const [, body] = mockPost.mock.calls[0];
    expect(body).toEqual({ owed_by: 'demo-gm-ming', owed_to: 'demo-gm-alex', amount: '500.00' });
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('GroupDetailPage — live error surfacing', () => {
  beforeEach(() => {
    mockIsDemo = false;
    primeLiveGet();
  });

  it('renders a rejected write message inline in the expense modal', async () => {
    mockPost.mockRejectedValueOnce(new Error('Amount must be greater than zero'));
    render(<GroupDetailPage />);
    await screen.findByText('Taipei Flat');

    fireEvent.click(screen.getByText('Add expense'));
    const dialog = getDialog();
    setInput(dialog, /Amount/, '50');
    setInput(dialog, 'Description', 'Snack');
    fireEvent.click(within(dialog).getByText('Save'));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Amount must be greater than zero',
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument(); // stays open on failure
  });

  it('renders a rejected settle message inline in the settle modal', async () => {
    mockPost.mockRejectedValueOnce(new Error("You're not a member of this group."));
    render(<GroupDetailPage />);
    await screen.findByText('Taipei Flat');

    fireEvent.click(screen.getAllByText('Settle')[0]);
    const dialog = getDialog();
    fireEvent.click(within(dialog).getByText('Settle', { selector: 'button' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      "You're not a member of this group.",
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
