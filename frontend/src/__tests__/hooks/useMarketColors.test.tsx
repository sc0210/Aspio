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
import { MARKET_COLORS_BOOT_SCRIPT } from '@/lib/marketColors';

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

  it("saves a carried-over choice, and the dashboard heatmap's old toggle outranks the calendar's", () => {
    localStorage.setItem('cal-tw-mode', 'true');
    localStorage.setItem('aspiro-heatmap-tw-colors', '0');
    render(<Probe name="a" />);
    expect(screen.getByTestId('a')).toHaveTextContent('green-up');
    expect(localStorage.getItem('aspiro-market-colors')).toBe('green-up');
  });

  it('another tab clearing storage resets this one', () => {
    localStorage.setItem('aspiro-market-colors', 'red-up');
    render(<Probe name="a" />);
    expect(screen.getByTestId('a')).toHaveTextContent('red-up');
    localStorage.clear();
    act(() => { window.dispatchEvent(new StorageEvent('storage', { key: null })); });
    expect(screen.getByTestId('a')).toHaveTextContent('green-up');
  });

  it.each([
    [{ 'aspiro-market-colors': 'red-up' }, 'red-up'],
    [{ 'aspiro-market-colors': 'green-up', 'cal-tw-mode': 'true' }, undefined],
    [{ 'aspiro-heatmap-tw-colors': '1' }, 'red-up'],
    [{}, undefined],
  ])('the boot script sets <html data-market> before React does (%j)', (stored, expected) => {
    Object.entries(stored).forEach(([k, v]) => localStorage.setItem(k, v as string));
    // eslint-disable-next-line no-new-func
    new Function(MARKET_COLORS_BOOT_SCRIPT)();
    expect(document.documentElement.dataset.market).toBe(expected);
  });

  it('an explicit green-up beats an old red-up toggle', () => {
    localStorage.setItem('cal-tw-mode', 'true');
    localStorage.setItem('aspiro-market-colors', 'green-up');
    render(<Probe name="a" />);
    expect(screen.getByTestId('a')).toHaveTextContent('green-up');
  });
});
