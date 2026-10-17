/** The phone rebalancing view: the hero's three states and the size of the trades. */
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { MobileRebalancing } from '@/components/portfolio/MobileRebalancing';

const mockVisible = { value: true };
jest.mock('@/contexts/PrivacyContext', () => ({ usePrivacy: () => ({ isValueVisible: mockVisible.value }) }));
jest.mock('@/components/layout/DashboardLayout', () => ({ DashboardLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
jest.mock('@/components/dashboard/BiggerScreenHint', () => ({ BiggerScreenHint: () => null }));
jest.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({
    // Fallback text with {{vars}} filled in, else the key itself.
    t: (key: string, opt?: string | Record<string, unknown>) => {
      const text = typeof opt === 'string' ? opt : (opt?.defaultValue as string | undefined) ?? key;
      const vars = typeof opt === 'object' ? opt : {};
      return text.replace(/\{\{(\w+)\}\}/g, (_, v) => String(vars[v] ?? ''));
    },
  }),
}));

afterEach(() => { mockVisible.value = true; });

const alloc = (asset: string, currentPct: number, targetPct: number, currentValue = 100_000) =>
  ({ asset, currentPct, targetPct, currentValue });

const show = (props: Partial<React.ComponentProps<typeof MobileRebalancing>> = {}) =>
  render(<MobileRebalancing allocations={[]} actions={[]} onBack={() => {}} {...props} />);

it('counts assets more than 5 points off target and sizes the move from the trades', () => {
  show({
    allocations: [alloc('0050 (Yuanta Taiwan 50)', 60, 50), alloc('VT (Global stocks)', 20, 30), alloc('Cash', 20, 20)],
    // Buys larger than sells: idle cash funds the rest, and the move is the larger side.
    actions: [
      { asset: '0050 (Yuanta Taiwan 50)', action: 'SELL', amount: 100_000 },
      { asset: 'VT (Global stocks)', action: 'BUY', amount: 150_000 },
    ],
  });
  expect(screen.getByText('2 off target')).toBeInTheDocument();
  expect(screen.getByText('To move').nextSibling).toHaveTextContent('NT$15.0萬'); // the larger side (buys), compact like the rest of the page
  // Sells come first: they fund the buys.
  const badges = screen.getAllByText(/allocation\.action\.(sell|buy)/).map((el) => el.textContent);
  expect(badges).toEqual(['allocation.action.sell', 'allocation.action.buy']);
  // The label is split into code and name.
  expect(screen.getByText('Yuanta Taiwan 50')).toBeInTheDocument();
});

it('reads as balanced when every asset is within 5 points, with no trade list', () => {
  show({ allocations: [alloc('0050', 52, 50), alloc('VT', 48, 50)] });
  expect(screen.getByText(/rebalancing\.balanced\.title/)).toBeInTheDocument();
  expect(screen.queryByText('To move')).not.toBeInTheDocument();
  expect(screen.queryByText('Suggested trades')).not.toBeInTheDocument();
});

it('does not call an empty allocation "balanced"', () => {
  show();
  expect(screen.queryByText(/rebalancing\.balanced\.title/)).not.toBeInTheDocument();
  expect(screen.getByText(/No target allocation yet/)).toBeInTheDocument();
});

it('masks amounts when values are hidden', () => {
  mockVisible.value = false;
  show({
    allocations: [alloc('0050', 60, 50)],
    actions: [{ asset: '0050', action: 'SELL', amount: 100_000 }],
  });
  expect(screen.queryByText(/NT\$/)).not.toBeInTheDocument();
  expect(screen.getAllByText(/••••/).length).toBeGreaterThan(0);
});

it('survives a row with no percentages', () => {
  show({ allocations: [{ asset: 'X', currentPct: undefined as unknown as number, targetPct: 10, currentValue: 0 }] });
  expect(screen.getByText('Target 10.0%')).toBeInTheDocument();
});

it('is not off target at exactly 5 points, where the backend plans no trade', () => {
  show({ allocations: [alloc('0050', 55, 50), alloc('VT', 45, 50)] });
  expect(screen.queryByText(/off target/)).not.toBeInTheDocument();
  expect(screen.getByText(/rebalancing\.balanced\.title/)).toBeInTheDocument();
});

it('hides the share estimate with the amount: shares x price gives it back', () => {
  const trade = { asset: '0050', action: 'SELL' as const, amount: 150_000, shares: 1000, currentPrice: 150 };
  show({ allocations: [alloc('0050', 60, 50)], actions: [trade] });
  expect(screen.getByText(/rebalancing\.plan\.shareEstimate/)).toBeInTheDocument();
  cleanup();
  mockVisible.value = false;
  show({ allocations: [alloc('0050', 60, 50)], actions: [trade] });
  expect(screen.queryByText(/rebalancing\.plan\.shareEstimate/)).not.toBeInTheDocument();
});
