/**
 * "If the market falls X%": any depth, with the table's own arithmetic, the
 * real-crash presets, and nothing to show for an empty or underwater position.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { DrawdownSlider } from '@/components/lifecycle/DrawdownSlider';
import { evaluateStress, scenarioAt } from '@/lib/lifecycle';

const mockVisible = { value: true };
jest.mock('@/contexts/PrivacyContext', () => ({ usePrivacy: () => ({ isValueVisible: mockVisible.value }) }));
jest.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({
    t: (_k: string, fallback: string, o?: Record<string, unknown>) =>
      (typeof fallback === 'string' ? fallback : _k).replace(/\{\{(\w+)\}\}/g, (_m, n) => String(o?.[n] ?? '')),
  }),
}));

// 2× leverage: 2M of stock on 1M of your own money (1M cash... none; 1M debt).
const levered = evaluateStress({
  stockExposure: 2_000_000, cashAssets: 0, investmentDebt: 1_000_000,
  monthlyPayment: 20_000, monthlySavings: 30_000, liquidReserve: 300_000,
});

beforeEach(() => { mockVisible.value = true; });

it('scenarioAt matches the fixed table row for the same drop', () => {
  const row = levered.scenarios.find((s) => s.dropPct === 30)!;
  expect(scenarioAt(levered.exposure, levered.net, 30)).toEqual(row);
});

it('starts at −30% and shows the amplified loss at 2×', () => {
  render(<DrawdownSlider stress={levered} />);
  expect(screen.getByText('−30%')).toBeInTheDocument();
  expect(screen.getByText('−60%')).toBeInTheDocument(); // 30% × 2 leverage
  expect(screen.getByText(/At 2.00× a 30% fall costs you 60%/)).toBeInTheDocument();
});

it('a preset jumps to a real crash; past 1 ÷ leverage the position is wiped out', () => {
  render(<DrawdownSlider stress={levered} />);
  fireEvent.click(screen.getByRole('button', { name: /2008 crisis −57%/ }));
  expect(screen.getByRole('button', { name: /2008 crisis/ })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByText('wiped out')).toBeInTheDocument();

  fireEvent.change(screen.getByLabelText('If the market falls'), { target: { value: '10' } });
  expect(screen.queryByText('wiped out')).not.toBeInTheDocument();
});

it('masks money in privacy mode', () => {
  mockVisible.value = false;
  render(<DrawdownSlider stress={levered} />);
  expect(screen.getByText('•••')).toBeInTheDocument();
});

it('renders nothing with no stock or an underwater position', () => {
  const none = evaluateStress({ stockExposure: 0, cashAssets: 100, investmentDebt: 0, monthlyPayment: 0, monthlySavings: 0, liquidReserve: 0 });
  const under = evaluateStress({ stockExposure: 100, cashAssets: 0, investmentDebt: 500, monthlyPayment: 0, monthlySavings: 0, liquidReserve: 0 });
  expect(render(<DrawdownSlider stress={none} />).container).toBeEmptyDOMElement();
  expect(render(<DrawdownSlider stress={under} />).container).toBeEmptyDOMElement();
});
