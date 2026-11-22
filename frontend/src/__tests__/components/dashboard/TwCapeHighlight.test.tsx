import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { TwCapeHighlight } from '@/components/dashboard/TwCapeHighlight';
import { useTwCape } from '@/hooks/useTwCape';

jest.mock('@/hooks/useTwCape', () => ({ useTwCape: jest.fn() }));

let mockIsDemo = false;
jest.mock('@/hooks/useAppMode', () => ({ useAppMode: () => ({ isDemo: mockIsDemo }) }));

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

const mockUseTwCape = useTwCape as jest.Mock;
const state = (over: Record<string, unknown>) => ({ data: undefined, isLoading: false, isError: false, isFetching: false, refetch: jest.fn(), ...over });

const reading = {
  available: true as const,
  asOf: '2026-11-20',
  cape: 32.41,
  percentile: 94.3,
  band: 'expensive' as const,
  since: '2015-03-01',
  low: 14.3,
  high: 44.0,
  cheapAtOrBelow: 16.7,
  expensiveAbove: 24.5,
  taiex: 36033,
  marketPe: 17.1,
  history: [],
};

beforeEach(() => {
  mockIsDemo = false;
});

describe('TwCapeHighlight (phone dashboard)', () => {
  it('states the CAPE, its band and its percentile, with no chart', () => {
    mockUseTwCape.mockReturnValue(state({ data: reading }));
    const { container } = render(<TwCapeHighlight />);
    expect(screen.getByText('Taiwan market · CAPE')).toBeInTheDocument();
    expect(screen.getByText('32.4')).toBeInTheDocument();
    expect(screen.getByText('Expensive')).toBeInTheDocument();
    expect(screen.getByText('Higher than 94% of months since Mar 2015')).toBeInTheDocument();
    expect(screen.getByText('Range 14.3–44.0 · market P/E 17.1')).toBeInTheDocument();
    expect(container.querySelector('svg')).toBeNull();
  });

  it('takes no slot while loading, so the swipe row never shows a card that then goes', () => {
    mockUseTwCape.mockReturnValue(state({ isLoading: true }));
    const { container } = render(<TwCapeHighlight />);
    expect(container).toBeEmptyDOMElement();
  });

  it('disables Try again while the retry is in flight', () => {
    mockUseTwCape.mockReturnValue(state({ isError: true, isFetching: true }));
    render(<TwCapeHighlight />);
    expect(screen.getByRole('button', { name: 'Try again' })).toBeDisabled();
  });

  it('says a failed load failed, with a retry', () => {
    const refetch = jest.fn();
    mockUseTwCape.mockReturnValue(state({ isError: true, refetch }));
    render(<TwCapeHighlight />);
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load this");
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(refetch).toHaveBeenCalled();
  });

  it.each([
    ['before the first backfill', { data: { available: false } }],
    ['in demo mode', { data: reading }],
  ])('leaves the slot out %s', (label, over) => {
    mockIsDemo = label === 'in demo mode';
    mockUseTwCape.mockReturnValue(state(over));
    const { container } = render(<TwCapeHighlight />);
    expect(container).toBeEmptyDOMElement();
  });
});
