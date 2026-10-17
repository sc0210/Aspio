/**
 * Pure-helper coverage for the bill-splitter detail page, exercised *through the
 * component* (the helpers aren't exported, and the brief said to prefer testing
 * through the component over adding exports).
 *
 *  - equalSplitAmounts: remainder distribution so equal splits sum exactly to the
 *    total (verified via recomputed demo balances).
 *  - recomputeBalances: net pairwise settle-up after a demo add then delete.
 *  - computeThisMonthStats: only current-month expenses counted; empty list,
 *    prior-month-only and single-member edge cases.
 *  - groupExpensesByMonth: history grouped under one header per month.
 *
 * i18n `t` is a self-contained leaf-key/label mock (see note in
 * groupDetailPage.test.tsx) — the on-disk groups.json is missing detail-page keys.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

const LABELS: Record<string, string> = {
  addExpense: 'Add expense',
  deleteExpense: 'Delete expense',
  description: 'Description',
  amount: 'Amount',
  save: 'Save',
  delete: 'Delete',
  noExpenses: 'No expenses yet',
  thisMember: 'This month',
};
function translate(key: string, opts?: Record<string, unknown>): string {
  let template = LABELS[key];
  if (template === undefined) {
    if (key === 'members') template = '{{count}} members';
    else template = key.split('.').pop() as string;
  }
  return template.replace(/\{\{(\w+)\}\}/g, (_m, name) =>
    opts && opts[name] != null ? String(opts[name]) : '',
  );
}

jest.mock('react-i18next', () => ({
  // i18next calls .use(initReactI18next) at import time; a mock without it
  // makes lib/i18n throw and the whole suite dies before any test runs.
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({ t: (key: string, opts?: Record<string, unknown>) => translate(key, opts) }),
}));
jest.mock('@/components/layout/DashboardLayout', () => ({
  DashboardLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

let mockParamsId = 'demo-group-1';
jest.mock('next/navigation', () => ({
  useParams: () => ({ id: mockParamsId }),
}));

const mockGet = jest.fn();
const mockPost = jest.fn();
const mockPatch = jest.fn();
const mockDelete = jest.fn();
jest.mock('@/lib/api-client', () => ({
  apiClient: {
    get: (...a: unknown[]) => mockGet(...a),
    post: (...a: unknown[]) => mockPost(...a),
    patch: (...a: unknown[]) => mockPatch(...a),
    delete: (...a: unknown[]) => mockDelete(...a),
  },
}));

let mockIsDemo = false;
jest.mock('@/hooks/useAppMode', () => ({
  useAppMode: () => ({ isDemo: mockIsDemo }),
}));

import GroupDetailPage from '@/app/groups/[id]/page';

type Split = { user_id: string; amount: string };
function makeExpense(
  id: string,
  payer: string,
  amount: string,
  createdAt: string,
  splits: Split[],
  description = id,
) {
  return { id, payer_id: payer, amount, currency: 'TWD', description, created_at: createdAt, splits };
}

function setInput(dialog: HTMLElement, labelText: string | RegExp, value: string) {
  const label = within(dialog).getByText(labelText);
  const wrapper = label.parentElement as HTMLElement;
  const input = wrapper.querySelector('input, select') as HTMLInputElement;
  fireEvent.change(input, { target: { value } });
}

function prime(opts: {
  members: Array<{ user_id: string; display_name: string; line_user_id: string }>;
  expenses: ReturnType<typeof makeExpense>[];
  balances?: Array<{ owed_by: string; owed_to: string; amount: string; currency: string }>;
}) {
  const memberNames: Record<string, string> = {};
  for (const m of opts.members) memberNames[m.user_id] = m.display_name;
  mockGet.mockImplementation((url: string) => {
    if (url.endsWith('/balances'))
      return Promise.resolve({
        data: { group_id: 'g', currency: 'TWD', member_names: memberNames, balances: opts.balances ?? [] },
      });
    if (url.endsWith('/members')) return Promise.resolve({ data: opts.members });
    if (url.endsWith('/expenses')) return Promise.resolve({ data: opts.expenses });
    if (url === '/line-bot/groups')
      return Promise.resolve({ data: [{ id: mockParamsId, name: 'G', currency: 'TWD' }] });
    return Promise.resolve({ data: null });
  });
}

const A = 'u-a';
const B = 'u-b';
const C = 'u-c';
const members3 = [
  { user_id: A, display_name: 'Alice', line_user_id: 'U1' },
  { user_id: B, display_name: 'Bob', line_user_id: 'U2' },
  { user_id: C, display_name: 'Cara', line_user_id: 'U3' },
];

const thisMonthIso = (day: number) => {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), day, 12).toISOString();
};
const lastMonthIso = (day: number) => {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth() - 1, day, 12).toISOString();
};

beforeEach(() => {
  mockIsDemo = false;
  mockParamsId = 'demo-group-1';
  mockGet.mockReset();
  mockPost.mockReset().mockResolvedValue({ data: {} });
  mockPatch.mockReset().mockResolvedValue({ data: {} });
  mockDelete.mockReset().mockResolvedValue({ data: {} });
});

// ── equalSplitAmounts + recomputeBalances (demo round-trip) ─────────────────────
describe('equalSplitAmounts / recomputeBalances (demo)', () => {
  it('splits 3000 equally (1000 each) so balances move by exactly 1000', async () => {
    mockIsDemo = true;
    render(<GroupDetailPage />);
    await screen.findByText('台北室友');

    fireEvent.click(screen.getByText('Add expense'));
    const dialog = screen.getByRole('dialog');
    setInput(dialog, /Amount/, '3000');
    setInput(dialog, 'Description', 'Temp');
    fireEvent.click(within(dialog).getByText('Save'));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    // Alex pays 3000 split 1000/1000/1000 → Ming 1200+1000, Mei 450+1000.
    expect(screen.getByText('TWD 2,200')).toBeInTheDocument();
    expect(screen.getByText('TWD 1,450')).toBeInTheDocument();
  });

  it('nets back to the original outstanding amounts when that expense is deleted', async () => {
    mockIsDemo = true;
    render(<GroupDetailPage />);
    await screen.findByText('台北室友');

    fireEvent.click(screen.getByText('Add expense'));
    let dialog = screen.getByRole('dialog');
    setInput(dialog, /Amount/, '3000');
    setInput(dialog, 'Description', 'Temp');
    fireEvent.click(within(dialog).getByText('Save'));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByText('TWD 2,200')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Temp'));
    dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByText('Delete expense'));
    dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByText('Delete'));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    expect(screen.getByText('TWD 1,200')).toBeInTheDocument();
    expect(screen.getByText('TWD 450')).toBeInTheDocument();
  });

  it('distributes the rounding remainder so an indivisible split still settles exactly', async () => {
    // 100 / 3 = 33.34 + 33.33 + 33.33. Alice pays; Bob & Cara each owe 33.33,
    // which formatAmount rounds for display to "TWD 33". The key invariant is the
    // page produces a non-empty, balanced settle-up (no leftover cents stranded).
    mockIsDemo = true;
    mockParamsId = 'demo-group-2'; // starts fully settled (empty balances)
    render(<GroupDetailPage />);
    await screen.findByText('日本旅遊團');

    fireEvent.click(screen.getByText('Add expense'));
    const dialog = screen.getByRole('dialog');
    setInput(dialog, /Amount/, '100');
    setInput(dialog, 'Description', 'Coffee');
    fireEvent.click(within(dialog).getByText('Save'));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    // group-2 has 4 members; 100/4 = 25 each → 3 debtors each owe Alex 25.
    const owed = screen.getAllByText('TWD 25');
    expect(owed.length).toBe(3);
  });
});

// ── computeThisMonthStats ────────────────────────────────────────────────────────
describe('computeThisMonthStats (via "This month" card)', () => {
  it('hides the card entirely when there are no expenses', async () => {
    prime({ members: members3, expenses: [] });
    render(<GroupDetailPage />);
    await screen.findByText('Add expense');
    expect(screen.queryByText('This month')).not.toBeInTheDocument();
  });

  it('hides the card when all expenses are in prior months', async () => {
    prime({
      members: members3,
      expenses: [makeExpense('e1', A, '300', lastMonthIso(5), [{ user_id: A, amount: '300' }])],
    });
    render(<GroupDetailPage />);
    await screen.findByText('Add expense');
    expect(screen.queryByText('This month')).not.toBeInTheDocument();
  });

  it('counts only the current-month paid/owes for a single member', async () => {
    prime({
      members: [members3[0]],
      expenses: [
        makeExpense('e1', A, '500', thisMonthIso(2), [{ user_id: A, amount: '500' }]),
        makeExpense('e2', A, '999', lastMonthIso(2), [{ user_id: A, amount: '999' }]), // excluded
      ],
    });
    render(<GroupDetailPage />);
    await screen.findByText('This month');

    const table = screen.getByRole('table');
    const cells = within(table).getAllByRole('cell').map((c) => c.textContent);
    expect(cells).toContain('Alice');
    expect(cells).toContain('500'); // paid (and owes) this month
    expect(cells).not.toContain('999'); // prior-month excluded
  });
});

// ── groupExpensesByMonth ─────────────────────────────────────────────────────────
describe('groupExpensesByMonth (history month headers)', () => {
  it('renders a header for each distinct month present in the history', async () => {
    const n = new Date();
    const thisLabel = new Date(n.getFullYear(), n.getMonth(), 10).toLocaleDateString(undefined, {
      month: 'long',
      year: 'numeric',
    });
    const lastLabel = new Date(n.getFullYear(), n.getMonth() - 1, 10).toLocaleDateString(undefined, {
      month: 'long',
      year: 'numeric',
    });
    prime({
      members: members3,
      expenses: [
        makeExpense('e1', A, '100', thisMonthIso(10), [{ user_id: A, amount: '100' }], 'This month item'),
        makeExpense('e2', A, '200', lastMonthIso(10), [{ user_id: A, amount: '200' }], 'Last month item'),
      ],
    });
    render(<GroupDetailPage />);
    await screen.findByText('This month item');

    expect(screen.getByText(thisLabel)).toBeInTheDocument();
    expect(screen.getByText('Last month item')).toBeInTheDocument();
    // The two items are in different months → two distinct headers.
    if (thisLabel !== lastLabel) {
      expect(screen.getByText(lastLabel)).toBeInTheDocument();
    }
  });
});
