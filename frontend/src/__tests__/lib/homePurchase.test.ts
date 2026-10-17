import { homePurchaseImpact } from '@/lib/lifecycle/homePurchase';
import type { Position } from '@/lib/lifecycle/leverage';

const pos = (stock: number, cash: number, debt: number): Position => {
  const net = stock + cash - debt;
  return { stockExposure: stock, cashAssets: cash, investmentDebt: debt, netFinancialAssets: net, netWorth: net,
    leverage: net > 0 ? stock / net : Infinity, borrowedShare: 0, isUnderwater: net <= 0 };
};

it('paid from cash: no stock sold, but leverage still rises because net assets fall', () => {
  // 6M stock, 2M cash, 3M investment debt: net 5M, leverage 1.2.
  const r = homePurchaseImpact(pos(6e6, 2e6, 3e6), { upfrontCash: 1.5e6, monthlyHousingCost: 60_000, monthlyRent: 30_000 }, 2);
  expect(r).toMatchObject({ fromCash: 1.5e6, fromStock: 0, cashLeft: 0.5e6, netFinancialAssetsAfter: 3.5e6 });
  expect(r.leverageBefore).toBeCloseTo(1.2);
  expect(r.leverageAfter).toBeCloseTo(6e6 / 3.5e6);
  expect(r.monthlyCashFlowChange).toBe(30_000);
  expect(r.exceedsMaxLeverage).toBe(false);
});

it('beyond the cash on hand, investments are sold', () => {
  const r = homePurchaseImpact(pos(6e6, 1e6, 3e6), { upfrontCash: 2.5e6, monthlyHousingCost: 0, monthlyRent: 0 }, 2);
  expect(r).toMatchObject({ fromCash: 1e6, fromStock: 1.5e6, cashLeft: 0, netFinancialAssetsAfter: 1.5e6 });
  expect(r.leverageAfter).toBeCloseTo(4.5e6 / 1.5e6); // 3.0
  expect(r.exceedsMaxLeverage).toBe(true);
});

it('a purchase that wipes out net financial assets is unbounded leverage', () => {
  const r = homePurchaseImpact(pos(3e6, 1e6, 3e6), { upfrontCash: 1.2e6, monthlyHousingCost: 0, monthlyRent: 0 }, 2);
  expect(r.leverageAfter).toBe(Infinity);
  expect(r.exceedsMaxLeverage).toBe(true);
});

it('the Emergency fund is not house money: only spendable (Life) cash pays, the rest is sold', () => {
  // 2M cash in all, but only 0.3M of it is Life; 2.3M at closing.
  const r = homePurchaseImpact(pos(6e6, 2e6, 3e6), { upfrontCash: 2.3e6, monthlyHousingCost: 0, monthlyRent: 0 }, 2, 0.3e6);
  expect(r).toMatchObject({ fromCash: 0.3e6, fromStock: 2e6, cashLeft: 0, shortfall: 0 });
  expect(r.leverageAfter).toBeCloseTo(4e6 / 2.7e6);
});

it('a purchase beyond cash and investments together reports the shortfall', () => {
  const r = homePurchaseImpact(pos(6e6, 2e6, 3e6), { upfrontCash: 12e6, monthlyHousingCost: 0, monthlyRent: 0 }, 2);
  expect(r).toMatchObject({ fromCash: 2e6, fromStock: 6e6, shortfall: 4e6 });
  expect(r.fromCash + r.fromStock + r.shortfall).toBe(r.upfrontCash);
});
