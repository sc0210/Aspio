/**
 * transactionService methods outside the list/create/update paths that
 * transactionService.test.ts covers: page stats, single-row and transfer reads,
 * transfer writes, day ordering and the CSV download.
 */
import { transactionService } from '@/services/transactionService';
import { apiClient } from '@/lib/api-client';
import { getSession } from 'next-auth/react';

jest.mock('@/lib/api-client', () => ({
  apiClient: {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
  },
}));

jest.mock('next-auth/react', () => ({
  getSession: jest.fn().mockResolvedValue(null),
}));

jest.mock('@/lib/api-url', () => ({
  getPublicApiUrl: () => 'https://api.test/api/v1',
}));

const api = apiClient as jest.Mocked<typeof apiClient>;
const mockGetSession = getSession as jest.Mock;

const backendRow = (over: Record<string, unknown> = {}) => ({
  id: 't1', user_id: 'u1', type: 'expense', amount: 120, currency: 'TWD', category: 'Food',
  description: 'Lunch', transaction_date: '2026-10-20', wallet_type: 'life', tags: [],
  created_at: '2026-10-20T04:00:00Z', updated_at: '2026-10-20T04:00:00Z', ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
  mockGetSession.mockResolvedValue(null);
});

describe('getPageStats', () => {
  it('builds the query from every filter, using the local calendar day for the range', async () => {
    api.get.mockResolvedValue({ success: true, data: {} });

    await transactionService.getPageStats({
      type: 'expense',
      category: 'Food',
      walletType: 'life',
      search: 'lunch',
      excludeTransfers: true,
      // 00:30 in Taipei is still the previous day in UTC; the query must say the 1st.
      dateRange: { start: new Date(2026, 9, 1, 0, 30), end: new Date(2026, 9, 31, 23, 59) },
    });

    const url = api.get.mock.calls[0][0] as string;
    const params = new URLSearchParams(url.split('?')[1]);
    expect(url.startsWith('/transactions/stats?')).toBe(true);
    expect(Object.fromEntries(params)).toEqual({
      type: 'expense', category: 'Food', wallet_type: 'life', search: 'lunch',
      exclude_transfers: 'true', date_from: '2026-10-01', date_to: '2026-10-31',
    });
  });

  it('omits exclude_transfers unless asked', async () => {
    api.get.mockResolvedValue({ success: true, data: {} });

    await transactionService.getPageStats();

    expect(api.get).toHaveBeenCalledWith('/transactions/stats?');
  });

  it('maps totals, breakdown colours and top rows', async () => {
    api.get.mockResolvedValue({
      success: true,
      data: {
        stats: {
          total_income: 5000, total_expenses: 1200, net_income: 3800,
          transaction_count: 7, avg_transaction_amount: 885.7,
        },
        category_breakdown: [
          { category: 'Salary', amount: 5000, type: 'income' },
          { category: 'Food', amount: 1200, type: 'expense' },
        ],
        expense_category_breakdown: [{ category: 'Food', type: 'expense' }],
        top_expenses: [backendRow()],
        top_income: 'not-a-list',
      },
    });

    const result = await transactionService.getPageStats();

    expect(result.data!.stats).toEqual({
      totalIncome: 5000, totalExpenses: 1200, netIncome: 3800, transactionCount: 7, avgTransactionAmount: 885.7,
    });
    expect(result.data!.categoryBreakdown.map((c) => [c.category, c.color])).toEqual([
      ['Salary', '#22c55e'],
      ['Food', '#ef4444'],
    ]);
    expect(result.data!.expenseCategoryBreakdown[0].amount).toBe(0);
    expect(result.data!.topExpenses[0]).toMatchObject({ id: 't1', amount: 120, walletType: 'life' });
    expect(result.data!.topIncome).toEqual([]);
  });

  it('zeroes the stats for an empty body and reports failure without throwing', async () => {
    api.get.mockResolvedValueOnce({ success: true });
    const empty = await transactionService.getPageStats();
    expect(empty.data!.stats).toEqual({
      totalIncome: 0, totalExpenses: 0, netIncome: 0, transactionCount: 0, avgTransactionAmount: 0,
    });

    api.get.mockRejectedValueOnce(new Error('down'));
    await expect(transactionService.getPageStats()).resolves.toEqual({
      success: false, message: 'Failed to load transaction stats',
    });
  });
});

describe('getTransactionById', () => {
  it('maps the row, preferring the category object and surfacing loan and transfer links', async () => {
    api.get.mockResolvedValue({
      success: true,
      data: backendRow({
        category_obj: { name: 'Dining' }, transfer_group_id: 'g1', loan_id: 'L1', holding_id: 'h1', payment_method: 'card',
      }),
    });

    const result = await transactionService.getTransactionById('t1');

    expect(api.get).toHaveBeenCalledWith('/transactions/t1');
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      id: 't1', userId: 'u1', category: 'Dining', walletType: 'life', paymentMethod: 'card',
      transferGroupId: 'g1', loan_id: 'L1', holdingId: 'h1',
    });
    // The day as sent: a Date would be UTC midnight, the previous day west of UTC.
    expect(result.data!.date).toBe('2026-10-20');
  });

  it('falls back to Other and the life wallet when the row omits them', async () => {
    api.get.mockResolvedValue({
      success: true,
      data: backendRow({ category: undefined, wallet_type: undefined, tags: undefined }),
    });

    const result = await transactionService.getTransactionById('t1');

    expect(result.data).toMatchObject({ category: 'Other', walletType: 'life', tags: [] });
  });

  it('reads demo rows from localStorage without calling the API', async () => {
    localStorage.setItem('aspiro_demo_transactions', JSON.stringify([{ id: 'demo-1', amount: 9 }]));

    await expect(transactionService.getTransactionById('demo-1')).resolves.toMatchObject({
      success: true, data: { amount: 9 },
    });
    await expect(transactionService.getTransactionById('demo-2')).resolves.toMatchObject({ success: false });
    expect(api.get).not.toHaveBeenCalled();
  });

  it('reports not-found and errors as unsuccessful', async () => {
    api.get.mockResolvedValueOnce({ success: true });
    await expect(transactionService.getTransactionById('t1')).resolves.toMatchObject({
      success: false, message: 'Transaction not found',
    });

    api.get.mockRejectedValueOnce(new Error('down'));
    await expect(transactionService.getTransactionById('t1')).resolves.toMatchObject({ success: false });
  });
});

describe('setDayOrder', () => {
  it('returns the day in its new order', async () => {
    api.put.mockResolvedValue({ success: true, data: { date: '2026-10-20', ids: ['b', 'a', 'c'] } });

    await expect(transactionService.setDayOrder('2026-10-20', ['b', 'a'])).resolves.toEqual(['b', 'a', 'c']);
    expect(api.put).toHaveBeenCalledWith('/transactions/day-order', { date: '2026-10-20', ids: ['b', 'a'] });
  });

  it("throws with the backend's message so the drag can be rolled back", async () => {
    api.put.mockResolvedValueOnce({ success: false, message: 'Rows span two days' });
    await expect(transactionService.setDayOrder('2026-10-20', [])).rejects.toThrow('Rows span two days');

    api.put.mockResolvedValueOnce({ success: false });
    await expect(transactionService.setDayOrder('2026-10-20', [])).rejects.toThrow('Reordering the day failed');
  });
});

describe('transfers', () => {
  const form = {
    fromWallet: 'life' as const, toWallet: 'emergency' as const, amount: 1000, currency: '',
    date: '2026-10-20',
  };
  const expectedPayload = {
    from_wallet: 'life', to_wallet: 'emergency', amount: 1000, currency: 'TWD',
    transaction_date: '2026-10-20', notes: null,
  };

  it('createTransfer sends snake_case, defaults currency to TWD and keeps the form date', async () => {
    api.post.mockResolvedValue({ success: true, data: { transfer_group_id: 'g1' } });

    const result = await transactionService.createTransfer(form);

    expect(api.post).toHaveBeenCalledWith('/transactions/transfer', expectedPayload);
    expect(result).toMatchObject({ success: true, data: { transfer_group_id: 'g1' } });
  });

  it('updateTransfer rewrites both legs through one call', async () => {
    api.put.mockResolvedValue({ success: true, data: {} });

    await transactionService.updateTransfer('g1', { ...form, notes: 'top up' });

    expect(api.put).toHaveBeenCalledWith('/transactions/transfer/g1', { ...expectedPayload, notes: 'top up' });
  });

  it('both writes rethrow, so the form can show the error', async () => {
    api.post.mockRejectedValue(new Error('Insufficient balance'));
    api.put.mockRejectedValue(new Error('Not found'));

    await expect(transactionService.createTransfer(form)).rejects.toThrow('Insufficient balance');
    await expect(transactionService.updateTransfer('g1', form)).rejects.toThrow('Not found');
  });

  it('getTransfer maps the transfer dict', async () => {
    api.get.mockResolvedValue({
      success: true,
      data: {
        transfer_group_id: 'g1', from_wallet: 'emergency', to_wallet: 'life', amount: 500,
        currency: 'TWD', transaction_date: '2026-10-19', notes: 'refill',
      },
    });

    await expect(transactionService.getTransfer('g1')).resolves.toMatchObject({
      success: true,
      data: {
        transferGroupId: 'g1', fromWallet: 'emergency', toWallet: 'life', amount: 500,
        currency: 'TWD', date: '2026-10-19', notes: 'refill',
      },
    });
    expect(api.get).toHaveBeenCalledWith('/transactions/transfer/g1');
  });

  it('getTransfer reports not-found and errors without throwing', async () => {
    api.get.mockResolvedValueOnce({ success: true });
    await expect(transactionService.getTransfer('g1')).resolves.toMatchObject({
      success: false, message: 'Transfer not found',
    });

    api.get.mockRejectedValueOnce(new Error('down'));
    await expect(transactionService.getTransfer('g1')).resolves.toMatchObject({ success: false });
  });
});

describe('downloadCSV', () => {
  const realFetch = global.fetch;
  let clicked: HTMLAnchorElement[];

  beforeEach(() => {
    clicked = [];
    global.fetch = jest.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(['a,b']) });
    URL.createObjectURL = jest.fn(() => 'blob:csv');
    URL.revokeObjectURL = jest.fn();
    jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this);
    });
  });

  afterEach(() => {
    global.fetch = realFetch;
    jest.restoreAllMocks();
  });

  it('requests the range with a bearer token and saves a named file', async () => {
    mockGetSession.mockResolvedValue({ accessToken: 'tok' });

    await transactionService.downloadCSV('2026-10-01', '2026-10-31');

    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.test/api/v1/transactions/export/csv?date_from=2026-10-01&date_to=2026-10-31',
      { headers: { 'ngrok-skip-browser-warning': 'true', Authorization: 'Bearer tok' } }
    );
    expect(clicked[0].download).toBe('transactions_2026-10-01_2026-10-31.csv');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:csv');
  });

  it('still downloads without a session, and throws on a failed export', async () => {
    mockGetSession.mockRejectedValueOnce(new Error('no session'));
    await transactionService.downloadCSV();
    expect(clicked[0].download).toBe('transactions_all_time.csv');

    (global.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 401 });
    await expect(transactionService.downloadCSV()).rejects.toThrow('Export failed: 401');
  });
});
