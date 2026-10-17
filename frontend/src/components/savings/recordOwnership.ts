import type { SavingRecord, SharedGoalOut } from '@/shared/types';

/**
 * Whether a saving record counts as yours on this goal.
 *
 * One rule for both places that ask — the goal card's split of the totals and
 * the records list's edit/delete buttons — because two copies drifted once: the
 * card matched only the session id while every demo fixture row belongs to the
 * goal's your_user_id ('demo-user-1', where DemoContext's user is 'demo-user').
 * Signed in, your_user_id is the caller, so the session clause adds nothing.
 */
export function isOwnRecord(
  record: Pick<SavingRecord, 'user_id'>,
  goal: Pick<SharedGoalOut, 'your_user_id'>,
  currentUserId: string,
): boolean {
  return record.user_id === goal.your_user_id || (currentUserId !== '' && record.user_id === currentUserId);
}

/**
 * The goal with its totals, split and progress recomputed from its saving
 * records — what the backend does on every record change, done locally where
 * there is no backend (demo mode).
 */
export function withRecordTotals(
  goal: SharedGoalOut,
  records: SavingRecord[],
  currentUserId: string,
): SharedGoalOut {
  const total = records.reduce((s, r) => s + r.amount, 0);
  const yours = records
    .filter((r) => isOwnRecord(r, goal, currentUserId))
    .reduce((s, r) => s + r.amount, 0);
  const pct = goal.target_amount > 0 ? Math.min((total / goal.target_amount) * 100, 100) : 0;

  return {
    ...goal,
    your_amount: yours,
    peer_amount: total - yours,
    total_amount: total,
    progress_pct: Math.round(pct * 10) / 10,
    // Cancelling is a decision about the goal, not something its records imply;
    // only active/completed follow from the total.
    status: goal.status === 'cancelled'
      ? goal.status
      : ((total >= goal.target_amount ? 'completed' : 'active') as SharedGoalOut['status']),
  };
}
