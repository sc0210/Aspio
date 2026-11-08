/**
 * The page tour: started by the ? button (an event), it walks the page's
 * visible markers, skips the ones this layout doesn't show, and remembers
 * being finished. The one-time invitation appears on the first dashboard visit.
 */
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { ProductTour } from '@/components/tour/ProductTour';
import { TourButton } from '@/components/tour/TourButton';
import { readTourMemory, startTour } from '@/lib/tour/tours';

jest.mock('react-i18next', () => {
  const t = (_key: string, fallback?: string, vars?: Record<string, unknown>) =>
    (fallback ?? _key).replace(/\{\{(\w+)\}\}/g, (_: string, k: string) => String(vars?.[k] ?? ''));
  return { initReactI18next: { type: '3rdParty', init: () => {} }, useTranslation: () => ({ t }) };
});

let mockPath = '/transactions';
jest.mock('next/navigation', () => ({ usePathname: () => mockPath }));

/** A marker that measures like it's on screen (jsdom measures everything 0×0). */
function Marker({ name }: { name: string }) {
  const ref = React.useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    el.getBoundingClientRect = () => ({ top: 100, left: 100, bottom: 140, right: 300, width: 200, height: 40, x: 100, y: 100, toJSON: () => ({}) });
    el.scrollIntoView = jest.fn();
  }, []);
  return <div ref={ref} data-tour={name}>{name}</div>;
}

function Page({ markers }: { markers: string[] }) {
  return (
    <>
      {markers.map((m) => <Marker key={m} name={m} />)}
      {/* A marker this layout hides: measures 0×0, so its step is skipped. */}
      <div data-tour="tx-filters" />
      <ProductTour />
    </>
  );
}

beforeEach(() => {
  localStorage.clear();
  mockPath = '/transactions';
});

it('walks the visible steps and skips hidden ones', () => {
  render(<Page markers={['page-actions', 'tx-stats', 'tx-list']} />);
  act(() => startTour());
  // intro + actions + stats + list (filters hidden; no tour-button rendered here)
  expect(screen.getByText('1 of 4')).toBeInTheDocument();
  expect(screen.getByRole('dialog', { name: 'Transactions' })).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  expect(screen.getByRole('heading', { name: 'Add, search, import' })).toBeInTheDocument();
  fireEvent.keyDown(document, { key: 'ArrowRight' });
  fireEvent.keyDown(document, { key: 'ArrowRight' });
  expect(screen.getByRole('heading', { name: 'Your transactions' })).toBeInTheDocument();
  expect(screen.queryByText('Filter and analyse')).not.toBeInTheDocument();
  fireEvent.keyDown(document, { key: 'ArrowLeft' });
  expect(screen.getByRole('heading', { name: 'At a glance' })).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  fireEvent.click(screen.getByRole('button', { name: 'Done' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(readTourMemory().done).toContain('transactions');
});

it('ends on Escape', () => {
  render(<Page markers={['tx-list']} />);
  act(() => startTour());
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('offers the tour once on the first dashboard visit', () => {
  jest.useFakeTimers();
  mockPath = '/dashboard';
  const view = render(<Page markers={['dash-wallets']} />);
  act(() => { jest.advanceTimersByTime(1600); });
  expect(screen.getByRole('region', { name: 'Take a tour' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
  expect(screen.queryByRole('region', { name: 'Take a tour' })).not.toBeInTheDocument();
  expect(readTourMemory().prompted).toBe(true);

  view.unmount();
  render(<Page markers={['dash-wallets']} />);
  act(() => { jest.advanceTimersByTime(5000); });
  expect(screen.queryByRole('region', { name: 'Take a tour' })).not.toBeInTheDocument();
  jest.useRealTimers();
});

it('waits for another dialog (What’s New) to close before inviting', () => {
  jest.useFakeTimers();
  mockPath = '/dashboard';
  const other = document.createElement('div');
  other.setAttribute('role', 'dialog');
  other.setAttribute('aria-modal', 'true');
  document.body.appendChild(other);
  render(<Page markers={['dash-wallets']} />);
  act(() => { jest.advanceTimersByTime(3200); });
  expect(screen.queryByRole('region', { name: 'Take a tour' })).not.toBeInTheDocument();
  other.remove();
  act(() => { jest.advanceTimersByTime(1600); });
  expect(screen.getByRole('region', { name: 'Take a tour' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Show me around' }));
  expect(screen.getByRole('dialog', { name: 'Welcome to Aspiro' })).toBeInTheDocument();
  jest.useRealTimers();
});

it('the ? button exists only on pages with a tour', () => {
  mockPath = '/settings';
  const { container, rerender } = render(<TourButton />);
  expect(container).toBeEmptyDOMElement();
  mockPath = '/loans';
  rerender(<TourButton />);
  expect(screen.getByRole('button', { name: 'Tour this page' })).toBeInTheDocument();
});

it('picks up a part of the page that finished loading after the tour started', () => {
  const view = render(<Page markers={['tx-list']} />);
  act(() => startTour());
  expect(screen.getByText('1 of 2')).toBeInTheDocument();
  view.rerender(<Page markers={['tx-stats', 'tx-list']} />);  // stats arrive late
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  expect(screen.getByRole('heading', { name: 'At a glance' })).toBeInTheDocument();
  expect(screen.getByText('2 of 3')).toBeInTheDocument();
});
