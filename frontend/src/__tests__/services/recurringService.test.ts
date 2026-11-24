import { recurringService } from '@/services/recurringService';
import { apiClient } from '@/lib/api-client';
import { nextAfter } from '@/lib/transactions/billDates';
import { isPassThrough } from '@/utils/expenseGroups';

jest.mock('@/lib/api-client', () => ({
  apiClient: { get: jest.fn(), post: jest.fn(), put: jest.fn() },
}));

const rule = (over: Record<string, unknown> = {}) => ({
  id: 'r1', description: 'AI工具-Claude', amount: '526.00', currency: 'TWD',
  category_id: 'c1', category: { name: 'Shopping' }, subcategory: 'Subscriptions',
  frequency: 'monthly', interval: 1, next_occurrence: '2026-12-03', start_date: '2026-11-03',
  is_active: true, is_paused: false, auto_create: false, split_connection_id: null, ...over,
});

describe('recurringService.listBills', () => {
  it('keeps only active reminders: not split bills, not self-posting rules', async () => {
    (apiClient.get as jest.Mock).mockResolvedValue({ data: [
      rule(),
      rule({ id: 'split', split_connection_id: 'conn', auto_create: true }),
      rule({ id: 'auto', auto_create: true }),
      rule({ id: 'stopped', is_active: false }),
    ] });
    const bills = await recurringService.listBills();
    expect(bills.map((b) => b.id)).toEqual(['r1']);
    // Decimal arrives as a string; the bill carries a number.
    expect(bills[0]).toMatchObject({ amount: 526, category: 'Shopping', subcategory: 'Subscriptions', nextOccurrence: '2026-12-03' });
  });

  it('records the occurrence the user saw, with the amount they typed', async () => {
    await recurringService.recordBill('r1', '2026-12-03', 540);
    expect(apiClient.post).toHaveBeenCalledWith('/transactions/recurring/r1/confirm', { occurrence: '2026-12-03', amount: 540 });
  });
});

describe('nextAfter', () => {
  it('is the bill day in the following month', () => {
    expect(nextAfter('2026-10-03', 3)).toBe('2026-11-03');
  });
  it('clamps to a short month and crosses the year', () => {
    expect(nextAfter('2027-01-31', 31)).toBe('2027-02-28');
    expect(nextAfter('2026-12-15', 15)).toBe('2027-01-15');
  });
});

describe('isPassThrough', () => {
  it('reads either spelling and nothing else', () => {
    expect(isPassThrough({ passThrough: true })).toBe(true);
    expect(isPassThrough({ pass_through: true })).toBe(true);
    expect(isPassThrough({ passThrough: false })).toBe(false);
    expect(isPassThrough({})).toBe(false);
  });
});
