/**
 * Red-up (Taiwan) market colours are one preference. Before it, the dashboard
 * heatmap and the portfolio calendar each kept their own toggle under their own
 * key, so one could say red-up while the other said green-up.
 */
import React from 'react';
import { act, render, screen } from '@testing-library/react';
import {
  __resetMarketColorsForTests,
  useMarketColors,
  useMarketColorsAttribute,
} from '@/hooks/useMarketColors';

function Probe({ name }: { name: string }) {
  const { redUp, setRedUp } = useMarketColors();
  return (
    <button data-testid={name} onClick={() => setRedUp(!redUp)}>
      {redUp ? 'red-up' : 'green-up'}
    </button>
  );
}

function Root() {
  useMarketColorsAttribute();
  return null;
}

describe('useMarketColors', () => {
  beforeEach(() => {
    localStorage.clear();
    __resetMarketColorsForTests();
    delete document.documentElement.dataset.market;
  });

  it('defaults to Western green-up', () => {
    render(<><Root /><Probe name="a" /></>);
    expect(screen.getByTestId('a')).toHaveTextContent('green-up');
    expect(document.documentElement.dataset.market).toBeUndefined();
  });

  it.each([
    ['aspiro-heatmap-tw-colors', '1'],
    ['cal-tw-mode', 'true'],
  ])('keeps a choice made with the old %s toggle', (key, value) => {
    localStorage.setItem(key, value);
    render(<Probe name="a" />);
    expect(screen.getByTestId('a')).toHaveTextContent('red-up');
  });

  it('one switch flips every surface, the <html> attribute, and is remembered', () => {
    render(<><Root /><Probe name="a" /><Probe name="b" /></>);
    act(() => screen.getByTestId('a').click());

    expect(screen.getByTestId('a')).toHaveTextContent('red-up');
    expect(screen.getByTestId('b')).toHaveTextContent('red-up');
    expect(document.documentElement.dataset.market).toBe('red-up');
    expect(localStorage.getItem('aspiro-market-colors')).toBe('red-up');
  });

  it('an explicit green-up beats an old red-up toggle', () => {
    localStorage.setItem('cal-tw-mode', 'true');
    localStorage.setItem('aspiro-market-colors', 'green-up');
    render(<Probe name="a" />);
    expect(screen.getByTestId('a')).toHaveTextContent('green-up');
  });
});
