/**
 * The demo balances are derived from the demo bills by the backend's rule
 * (accepted splits less confirmed repayments), so the two can't drift apart.
 */
import { demoSplitBalances, demoSplits } from '@/data/demoData';

it('derives each partner balance from the accepted bills and repayments', () => {
  const byName = Object.fromEntries(demoSplitBalances.map((b) => [b.partner_name, b.balances]));
  // 小明: you paid 2400 (they owe 1200), they paid 3600 (you owe 1800), you repaid 1000.
  expect(byName['小明']).toEqual([{ currency: 'TWD', net: 400 }]);
  // 小美: they paid a 480 taxi, split evenly.
  expect(byName['小美']).toEqual([{ currency: 'TWD', net: -240 }]);
});

it('leaves proposals out of the balance until they are accepted', () => {
  expect(demoSplits.some((s) => s.status === 'proposed')).toBe(true);
  for (const s of demoSplits) expect(s.my_share + s.partner_share).toBe(s.total_amount);
});
