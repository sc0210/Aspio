import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { TwCapeCard } from '@/components/dashboard/TwCapeCard';
import { useTwCape } from '@/hooks/useTwCape';

jest.mock('@/hooks/useTwCape', () => ({ useTwCape: jest.fn() }));

// Interpolates the defaultValue so assertions read the copy a user sees.
jest.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown> | string) => {
      if (typeof opts === 'string') return opts;
      const template = (opts?.defaultValue as string | undefined) ?? key;
      return template.replace(/\{\{(\w+)\}\}/g, (_, k) => String(opts?.[k]));
    },
    i18n: { language: 'en' },
  }),
}));

// The sparkline is drawing, not data; jsdom has no layout for it.
jest.mock('recharts', () => {
  const Pass = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  const Nothing = () => null;
  const Chart = () => <div data-testid="tw-cape-sparkline" />;
  return { AreaChart: Chart, ResponsiveContainer: Pass, Area: Nothing, ReferenceLine: Nothing, Tooltip: Nothing, YAxis: Nothing };
});

const mockUseTwCape = useTwCape as jest.Mock;

const reading = {
  available: true as const,
  asOf: '2026-11-20',
  cape: 47.04,
  percentile: 92.4,
  band: 'expensive' as const,
  since: '2015-09-01',
  low: 15.21,
  high: 49.1,
  taiex: 27000,
  marketPe: 22.4,
  history: [
    { month: '2015-09', cape: 15.2 },
    { month: '2020-01', cape: 25.0 },
    { month: '2026-11', cape: 47.0 },
  ],
};

const state = (over: Record<string, unknown>) => ({ data: undefined, isLoading: false, isError: false, refetch: jest.fn(), ...over });

describe('TwCapeCard', () => {
  it('states the CAPE, its band, and where it sits in Taiwan’s own history', () => {
    mockUseTwCape.mockReturnValue(state({ data: reading }));
    render(<TwCapeCard />);
    expect(screen.getByText('47.0')).toBeInTheDocument();
    expect(screen.getByText('Expensive')).toBeInTheDocument();
    expect(screen.getByText('Higher than 92% of months since Sep 2015')).toBeInTheDocument();
    expect(screen.getByText('Range 15.2–49.1 · market P/E 22.4')).toBeInTheDocument();
    expect(screen.getByText('Shiller CAPE · TAIEX · as of 2026-11-20')).toBeInTheDocument();
    expect(screen.getByTestId('tw-cape-sparkline')).toBeInTheDocument();
  });

  it.each([
    ['cheap', 'Cheap', /prosperity/],
    ['fair', 'Fair', /gray/],
  ])('marks a %s reading', (band, label, cls) => {
    mockUseTwCape.mockReturnValue(state({ data: { ...reading, band } }));
    render(<TwCapeCard />);
    expect(screen.getByText(label).className).toMatch(cls);
  });

  it('says history is still being collected before the first backfill', () => {
    mockUseTwCape.mockReturnValue(state({ data: { available: false } }));
    render(<TwCapeCard />);
    expect(screen.getByText(/Collecting market history/)).toBeInTheDocument();
    expect(screen.queryByText('Expensive')).not.toBeInTheDocument();
  });

  it('shows a loading placeholder, not an empty state, while loading', () => {
    mockUseTwCape.mockReturnValue(state({ isLoading: true }));
    render(<TwCapeCard />);
    expect(screen.getByTestId('tw-cape-loading')).toBeInTheDocument();
    expect(screen.queryByText(/Collecting/)).not.toBeInTheDocument();
  });

  it('shows a retryable error when the request fails', () => {
    const refetch = jest.fn();
    mockUseTwCape.mockReturnValue(state({ isError: true, refetch }));
    render(<TwCapeCard />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button'));
    expect(refetch).toHaveBeenCalled();
  });
});

describe('TwCapeCard copy', () => {
  // The t() stub above renders the English fallbacks, so a missing key would
  // pass every test there. Check the locale files themselves.
  const keys = ['title', 'subtitle', 'asOf', 'hint', 'percentile', 'range', 'source', 'collecting',
    'band.cheap', 'band.fair', 'band.expensive'];
  it.each(['en', 'zh-TW'])('%s has every key the card reads', (lang) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const dashboard = require(`@/locales/${lang}/dashboard.json`);
    for (const key of keys) {
      const value = key.split('.').reduce((o: Record<string, unknown> | undefined, k) =>
        (o?.[k] as Record<string, unknown> | undefined), dashboard.twCape);
      expect({ key, value: typeof value }).toEqual({ key, value: 'string' });
    }
  });
});
