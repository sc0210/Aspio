/**
 * The phone list's "Load more" past the backend's page cap.
 *
 * Each tap grew `limit` by 40 and sent it as is, but GET /transactions takes
 * `limit` up to 200: the sixth tap asked for 240, got a 422, and the whole list
 * turned into an error card. Past 200 it must page through instead.
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MobileTransactions } from '@/components/transactions/MobileTransactions';

const TOTAL = 300;
const rows = Array.from({ length: TOTAL }, (_, i) => ({
  id: `t${i}`,
  description: `row ${i}`,
  amount: 100,
  currency: 'TWD',
  type: 'expense',
  category: 'Food',
  walletType: 'life',
  date: new Date(Date.UTC(2026, 10, 20) - i * 86_400_000).toISOString().slice(0, 10),
}));

type Options = { limit?: number; fetchAll?: boolean; dateRange?: unknown };
const mockUseTransactions = jest.fn((options: Options = {}) => {
  // The hero's month query is not what this is about.
  if (options.dateRange) return { transactions: [], isLoading: false, isFetching: false };
  if (options.limit !== undefined && options.limit > 200) throw new Error(`limit ${options.limit} is a 422`);
  const transactions = options.fetchAll ? rows : rows.slice(0, options.limit ?? 20);
  return { transactions, isLoading: false, isFetching: false };
});
jest.mock('@/hooks/useTransactions', () => ({
  useTransactions: (o: Options) => mockUseTransactions(o),
}));
jest.mock('@/hooks/useAdmin', () => ({ useIsAdmin: () => ({ isAdmin: false }) }));
jest.mock('@/contexts/DemoContext', () => ({ useDemo: () => ({ isDemoMode: false }) }));
jest.mock('@/contexts/PrivacyContext', () => ({ usePrivacy: () => ({ isValueVisible: true }) }));
jest.mock('@/components/dashboard/BiggerScreenHint', () => ({ BiggerScreenHint: () => null }));
jest.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({
    t: (k: string, d?: unknown) => (typeof d === 'string' ? d : k),
    i18n: { language: 'en' },
  }),
}));

const renderList = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } })}>
      <MobileTransactions />
    </QueryClientProvider>,
  );

const shown = () => screen.getAllByText(/^row \d+$/).length;

describe('MobileTransactions Load more', () => {
  it('pages past the 200 the backend allows instead of asking for more', () => {
    renderList();
    expect(shown()).toBe(40);

    for (let i = 0; i < 6; i++) fireEvent.click(screen.getByRole('button', { name: 'Load more' }));

    expect(shown()).toBe(280);
    const listCalls = mockUseTransactions.mock.calls.map(([o]) => o).filter((o) => !o?.dateRange);
    expect(listCalls.some((o) => o?.fetchAll)).toBe(true);
    expect(listCalls.every((o) => o?.limit === undefined || o.limit <= 200)).toBe(true);

    // Two more taps reach the end; then there is nothing left to offer.
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(shown()).toBe(TOTAL);
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('asks for this whole month for the hero, not the default first page', () => {
    renderList();
    const hero = mockUseTransactions.mock.calls.map(([o]) => o).find((o) => o?.dateRange);
    expect(hero).toMatchObject({ fetchAll: true });
  });
});
