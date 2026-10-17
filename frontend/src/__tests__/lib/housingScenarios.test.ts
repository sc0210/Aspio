import { DEFAULT_BUY_VS_RENT } from '@/lib/housing/buyVsRent';
import { addScenario, loadScenarios, storeScenarios, MAX_SCENARIOS, SCENARIOS_KEY } from '@/lib/housing/scenarios';

beforeEach(() => window.localStorage.clear());

it('round-trips through storage', () => {
  const list = addScenario([], '  Banqiao  ', { ...DEFAULT_BUY_VS_RENT, downPaymentPct: 20 }, 'a');
  expect(storeScenarios(list)).toBe(true);
  expect(loadScenarios()).toEqual([{ id: 'a', name: 'Banqiao', inputs: { ...DEFAULT_BUY_VS_RENT, downPaymentPct: 20 } }]);
});

it('refuses a blank name and a fourth scenario', () => {
  expect(addScenario([], '   ', DEFAULT_BUY_VS_RENT, 'a')).toEqual([]);
  let list = [] as ReturnType<typeof loadScenarios>;
  for (let i = 0; i < MAX_SCENARIOS + 1; i++) list = addScenario(list, `s${i}`, DEFAULT_BUY_VS_RENT, `id${i}`);
  expect(list).toHaveLength(MAX_SCENARIOS);
});

it('survives junk, old saves missing new fields, and non-numeric values', () => {
  window.localStorage.setItem(SCENARIOS_KEY, 'not json');
  expect(loadScenarios()).toEqual([]);
  window.localStorage.setItem(SCENARIOS_KEY, JSON.stringify([
    { id: 'old', name: 'Old save', inputs: { housePrice: 12_000_000, mortgageRatePct: 'high' } },
    { name: 'no id' },
    null,
  ]));
  const [s, ...rest] = loadScenarios();
  expect(rest).toEqual([]);
  expect(s.inputs.housePrice).toBe(12_000_000);
  expect(s.inputs.mortgageRatePct).toBe(DEFAULT_BUY_VS_RENT.mortgageRatePct);
  expect(s.inputs.holdingYears).toBe(DEFAULT_BUY_VS_RENT.holdingYears);
});

it('out-of-range values fall back to defaults — a huge holdingYears must not freeze the projection', () => {
  window.localStorage.setItem(SCENARIOS_KEY, JSON.stringify([
    { id: 'x', name: 'Edited', inputs: { holdingYears: 1e9, housePrice: -5, downPaymentPct: 20 } },
  ]));
  const [s] = loadScenarios();
  expect(s.inputs.holdingYears).toBe(DEFAULT_BUY_VS_RENT.holdingYears);
  expect(s.inputs.housePrice).toBe(DEFAULT_BUY_VS_RENT.housePrice);
  expect(s.inputs.downPaymentPct).toBe(20);
});

it('reports a refused write', () => {
  const spy = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('QuotaExceeded'); });
  expect(storeScenarios([])).toBe(false);
  spy.mockRestore();
});
