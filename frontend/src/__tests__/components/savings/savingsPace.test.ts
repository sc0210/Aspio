import type { SavingRecord, SharedGoalOut } from '@/shared/types';
import { paceForecast } from '@/components/savings/savingsPace';
import { goalHistory } from '@/components/savings/GoalHistoryChart';

const goal = (over: Partial<SharedGoalOut>): SharedGoalOut => ({
  id: 'g1', connection_id: 'c1', title: 'Trip', target_amount: 50000, target_date: null, status: 'active',
  your_amount: 0, peer_amount: 0, your_name: 'Me', peer_name: 'Bob', your_user_id: 'me', peer_user_id: 'bob',
  total_amount: 20000, progress_pct: 40, is_creator: true, created_at: '2026-01-01T00:00:00Z', ...over,
} as SharedGoalOut);
let n = 0;
const rec = (record_date: string, amount: number, over: Partial<SavingRecord> = {}): SavingRecord => ({
  id: `r${++n}`, goal_id: 'g1', user_id: 'me', user_name: 'Me', amount, record_date, note: null,
  created_at: `${record_date}T00:00:00Z`, ...over,
});
const TODAY = '2026-11-11';

describe('paceForecast', () => {
  it('projects from the last 90 days: 9,000 saved is ~3,044 a month, 30,000 left lands 10 months on', () => {
    const f = paceForecast([goal({})], [rec('2026-10-01', 4000), rec('2026-11-01', 5000), rec('2026-01-01', 99999)], TODAY);
    expect(f.kind).toBe('pace');
    if (f.kind !== 'pace') return;
    expect(Math.round(f.perMonth)).toBe(3044);
    expect(f.remaining).toBe(30000);
    expect(f.finish).toBe('2027-09'); // Nov 2026 + ceil(30000 / 3044) = 10 months
    expect(f.monthsLate).toBe(0); // no deadline
  });

  it('says how many months after the latest active deadline it lands', () => {
    const f = paceForecast(
      [goal({ target_date: '2027-03-01' }), goal({ id: 'g2', target_date: '2027-06-30', target_amount: 1000, total_amount: 0 })],
      [rec('2026-11-01', 9000)], TODAY,
    );
    expect(f.kind === 'pace' && [f.finish, f.monthsLate]).toEqual(['2027-10', 4]); // 31,000 at ~3,044 → 11 months; Jun → Oct
  });

  it('counts a record exactly 90 days back as outside the window', () => {
    expect(paceForecast([goal({})], [rec('2026-08-13', 5000)], TODAY).kind).toBe('stalled');
    expect(paceForecast([goal({})], [rec('2026-08-14', 5000)], TODAY).kind).toBe('pace');
  });

  it('leaves out completed goals, their gap and their records', () => {
    const done = goal({ id: 'g9', status: 'completed', target_amount: 10000, total_amount: 10000 });
    const f = paceForecast([goal({}), done], [rec('2026-11-01', 9000, { goal_id: 'g9' })], TODAY);
    expect(f).toEqual({ kind: 'stalled', remaining: 30000 });
  });

  it('says "more than 10 years" instead of a date when the pace is tiny', () => {
    const f = paceForecast([goal({})], [rec('2026-11-01', 1)], TODAY);
    expect(f.kind).toBe('far');
  });

  it('has nothing to project when every active goal is reached', () => {
    expect(paceForecast([goal({ total_amount: 50000 })], [rec('2026-11-01', 1)], TODAY)).toEqual({ kind: 'done' });
  });
});

describe('goalHistory', () => {
  it('runs a total per person, one point per day, oldest first', () => {
    const isMine = (r: SavingRecord) => r.user_id === 'me';
    expect(goalHistory([
      rec('2026-03-01', 500, { user_id: 'bob' }), rec('2026-01-01', 1000), rec('2026-03-01', 200),
    ], isMine)).toEqual([
      { date: '2026-01-01', mine: 1000, theirs: 0 },
      { date: '2026-03-01', mine: 1200, theirs: 500 },
    ]);
  });
});
