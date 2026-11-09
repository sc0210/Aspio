import type { SplitOut } from '@/shared/types';
import {
  EMPTY_FILTER, NO_CATEGORY, byCategory, byMonth, currenciesByUse, filterOptions, filterSplits, shiftMonth,
  monthLabel, splitsCsv, summarize,
} from '@/components/savings/sharedSpendingStats';

let n = 0;
const split = (over: Partial<SplitOut>): SplitOut => ({
  id: `s${++n}`, connection_id: 'c1', description: 'Dinner', total_amount: 1000, currency: 'TWD',
  split_date: '2026-11-06', category_id: 'cat', category_name: 'Dining', method: 'equal', status: 'active',
  payer_is_me: true, created_by_me: true, partner_name: 'Bob', my_share: 500, partner_share: 500,
  my_share_status: 'accepted', partner_share_status: 'accepted', my_transaction_id: null, ...over,
});

const SPLITS = [
  split({}),
  split({ total_amount: 3000, my_share: 1000, partner_share: 2000, category_name: 'Groceries', payer_is_me: false }),
  split({ split_date: '2026-10-20', total_amount: 600, my_share: 300, partner_share: 300 }),
  split({ status: 'proposed', total_amount: 9999, my_share: 5000, partner_share: 4999 }), // not counted yet
  split({ status: 'voided', total_amount: 7777, my_share: 3888, partner_share: 3889 }),   // cancelled
  split({ currency: 'USD', total_amount: 40, my_share: 20, partner_share: 20 }),
];

describe('sharedSpendingStats', () => {
  it('steps months across a year boundary', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
  });

  it('counts only accepted bills, in one currency, for the month', () => {
    expect(summarize(SPLITS, 'TWD', '2026-11')).toEqual({
      count: 2, total: 4000, mine: 1500, partner: 2500, iFronted: 1000, partnerFronted: 3000,
    });
    expect(summarize(SPLITS, 'TWD', null).total).toBe(4600);
    expect(summarize(SPLITS, 'USD', null).total).toBe(40);
  });

  it('orders currencies by use', () => {
    expect(currenciesByUse(SPLITS)).toEqual(['TWD', 'USD']);
  });

  it('totals categories largest first, with your part', () => {
    expect(byCategory(SPLITS, 'TWD', null)).toEqual([
      { name: 'Groceries', total: 3000, mine: 1000 },
      { name: 'Dining', total: 1600, mine: 800 },
    ]);
    expect(byCategory([split({ category_name: null })], 'TWD', null)[0].name).toBeNull();
  });

  it('gives every month in the window, empty ones as 0', () => {
    expect(byMonth(SPLITS, 'TWD', '2026-11', 3)).toEqual([
      { month: '2026-09', mine: 0, partner: 0 },
      { month: '2026-10', mine: 300, partner: 300 },
      { month: '2026-11', mine: 1500, partner: 2500 },
    ]);
  });

  it('sums cents without float drift', () => {
    const tiny = [split({ total_amount: 0.1, my_share: 0.1, partner_share: 0 }), split({ total_amount: 0.2, my_share: 0.2, partner_share: 0 })];
    expect(summarize(tiny, 'TWD', null).total).toBe(0.3);
  });

  it('filters by month, category, status, payer and text', () => {
    const ids = (f: Partial<typeof EMPTY_FILTER>) => filterSplits(SPLITS, { ...EMPTY_FILTER, ...f }).map((s) => s.total_amount);
    expect(ids({})).toHaveLength(SPLITS.length);
    expect(ids({ month: '2026-10' })).toEqual([600]);
    expect(ids({ category: 'Groceries' })).toEqual([3000]);
    expect(ids({ status: 'voided' })).toEqual([7777]);
    expect(ids({ payer: 'partner' })).toEqual([3000]);
    expect(ids({ query: 'BOB', month: '2026-10' })).toEqual([600]);
    expect(filterSplits([split({ category_name: null }), split({})], { ...EMPTY_FILTER, category: NO_CATEGORY })).toHaveLength(1);
  });

  it('offers the months newest first and the categories in order', () => {
    expect(filterOptions(SPLITS)).toEqual({ months: ['2026-11', '2026-10'], categories: ['Dining', 'Groceries'], uncategorised: false });
  });

  it('writes CSV that quotes and defuses what a spreadsheet would misread', () => {
    const csv = splitsCsv([split({ description: '=HYPERLINK("x"), dinner', partner_name: '小明' })]);
    const [header, row] = csv.split('\n');
    expect(header).toBe('Date,Description,Category,Partner,Paid by,Status,Currency,Total,My share,Partner share');
    expect(row).toBe(`2026-11-06,"'=HYPERLINK(""x""), dinner",Dining,小明,Me,active,TWD,1000,500,500`);
  });

  it('defuses formulas hidden behind spaces, tabs or a carriage return', () => {
    for (const description of ['  =1+1', '\t=1+1', '\rcmd', '@SUM(A1)', '-2+3']) {
      const cell = splitsCsv([split({ description })]).split('\n')[1].split(',')[1];
      expect(cell.replace(/^"/, '').startsWith("'")).toBe(true);
    }
    expect(splitsCsv([split({ description: 'Dinner - Tokyo' })]).split('\n')[1]).toContain(',Dinner - Tokyo,');
  });

  it('writes the status and category through the labels it is given', () => {
    const row = splitsCsv([split({ status: 'voided' })], undefined, {
      me: '我', partner: '夥伴', status: (s) => (s === 'voided' ? '已取消' : s), category: (n) => (n === 'Dining' ? '餐飲' : n),
    }).split('\n')[1];
    expect(row).toBe('2026-11-06,Dinner,餐飲,Bob,我,已取消,TWD,1000,500,500');
  });

  it('keeps a chosen month and category in the menus after their bills are gone', () => {
    const opts = filterOptions([split({})], { month: '2025-01', category: 'Utilities' });
    expect(opts.months).toEqual(['2026-11', '2025-01']);
    expect(opts.categories).toEqual(['Dining', 'Utilities']);
    expect(filterOptions([split({})], { month: '', category: NO_CATEGORY }).uncategorised).toBe(true);
  });

  it('names a month in the reader\'s language', () => {
    expect(monthLabel('2026-11', 'en')).toBe('November 2026');
    expect(monthLabel('2026-11', 'en', 'short')).toBe('Nov');
  });
});

