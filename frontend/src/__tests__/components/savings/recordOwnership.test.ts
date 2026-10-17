/**
 * The one rule for attributing saving records, and the totals built on it.
 *
 * The goal card's split and the records list's edit buttons both read this;
 * two private copies of it disagreed once, in demo, where the session's id
 * ('demo-user') is not the fixtures' ('demo-user-1').
 */

import { isOwnRecord, withRecordTotals } from '@/components/savings/recordOwnership';
import { demoSharedGoals } from '@/data/demoData';
import type { SavingRecord, SharedGoalOut } from '@/shared/types';

const goal: SharedGoalOut = { ...demoSharedGoals[0], your_user_id: 'owner', target_amount: 1000, status: 'active' };

const rec = (userId: string, amount: number): SavingRecord => ({
  id: `${userId}-${amount}`,
  goal_id: goal.id,
  user_id: userId,
  user_name: userId,
  amount,
  record_date: '2026-09-13',
  note: null,
  created_at: '2026-09-13T00:00:00Z',
});

describe('isOwnRecord', () => {
  it("counts the goal owner's records and the session's, and nobody else's", () => {
    expect(isOwnRecord(rec('owner', 1), goal, 'session')).toBe(true);
    expect(isOwnRecord(rec('session', 1), goal, 'session')).toBe(true);
    expect(isOwnRecord(rec('peer', 1), goal, 'session')).toBe(false);
  });

  it('does not match records with no user against an empty session id', () => {
    expect(isOwnRecord(rec('', 1), goal, '')).toBe(false);
  });
});

describe('withRecordTotals', () => {
  it('splits the total between you and the peer and derives progress', () => {
    const result = withRecordTotals(goal, [rec('owner', 300), rec('peer', 200)], 'session');

    expect(result).toMatchObject({ your_amount: 300, peer_amount: 200, total_amount: 500, progress_pct: 50, status: 'active' });
  });

  it('marks a goal completed once the records reach the target', () => {
    expect(withRecordTotals(goal, [rec('owner', 600), rec('peer', 400)], 'session').status).toBe('completed');
  });

  it('leaves a cancelled goal cancelled, whatever its records add up to', () => {
    const cancelled: SharedGoalOut = { ...goal, status: 'cancelled' };

    expect(withRecordTotals(cancelled, [rec('owner', 5000)], 'session').status).toBe('cancelled');
  });
});
