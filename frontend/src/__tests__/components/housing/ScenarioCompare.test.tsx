/** Save the simulator's setup by name, compare it with what's on screen, load it back, remove it. */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ScenarioCompare } from '@/components/housing/ScenarioCompare';
import { DEFAULT_BUY_VS_RENT } from '@/lib/housing/buyVsRent';

jest.mock('@/contexts/PrivacyContext', () => ({ usePrivacy: () => ({ isValueVisible: true }) }));
jest.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({
    t: (_k: string, f: string, o?: Record<string, unknown>) =>
      (typeof f === 'string' ? f : _k).replace(/\{\{(\w+)\}\}/g, (_m, n) => String(o?.[n] ?? '')),
  }),
}));

beforeEach(() => window.localStorage.clear());

it('saves, compares, loads and removes a scenario', () => {
  const onLoad = jest.fn();
  const current = { ...DEFAULT_BUY_VS_RENT, downPaymentPct: 25 };
  const { rerender } = render(<ScenarioCompare current={current} onLoad={onLoad} />);
  expect(screen.getByText(/Kept in this browser only/)).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Save this setup' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Scenario name' }), { target: { value: 'Banqiao' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));

  // The saved row and the on-screen row, side by side.
  expect(screen.getByText('On screen')).toBeInTheDocument();
  expect(screen.getAllByText('25%')).toHaveLength(2);

  // Change the simulator, then load the saved one back.
  rerender(<ScenarioCompare current={{ ...current, downPaymentPct: 40 }} onLoad={onLoad} />);
  fireEvent.click(screen.getByRole('button', { name: 'Banqiao' }));
  expect(onLoad).toHaveBeenCalledWith(expect.objectContaining({ downPaymentPct: 25 }));

  fireEvent.click(screen.getByRole('button', { name: 'Remove Banqiao' }));
  expect(screen.queryByText('Banqiao')).not.toBeInTheDocument();
  expect(JSON.parse(window.localStorage.getItem('aspiro-housing-scenarios') ?? '[]')).toEqual([]);
});
