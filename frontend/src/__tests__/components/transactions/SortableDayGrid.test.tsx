/**
 * The grid's own contract (#478): when it offers drag handles, and what they say.
 * The drag is dnd-kit's; TransactionListDayOrder.test.tsx covers what a drop does.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { SortableDayGrid } from '@/components/transactions/SortableDayGrid';
import type { Transaction } from '@/shared/types';

jest.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({
    t: (_key: string, opts: { description: string }) => `Drag to reorder ${opts.description}`,
  }),
}));

const row = (id: string, description: string) => ({ id, description }) as unknown as Transaction;
const rows = [row('a', 'brunch'), row('b', 'dinner')];
const renderRow = (t: Transaction) => <div key={t.id} data-testid="row">{t.description}</div>;

it('gives every row a labelled handle when enabled', () => {
  render(<SortableDayGrid rows={rows} enabled renderRow={renderRow} onReorder={jest.fn()} />);
  expect(screen.getByRole('button', { name: 'Drag to reorder brunch' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Drag to reorder dinner' })).toBeInTheDocument();
  expect(screen.getAllByTestId('row')).toHaveLength(2);
});

it('renders the plain grid, with no handles, when disabled', () => {
  render(<SortableDayGrid rows={rows} enabled={false} renderRow={renderRow} onReorder={jest.fn()} />);
  expect(screen.queryAllByRole('button')).toHaveLength(0);
  expect(screen.getAllByTestId('row')).toHaveLength(2);
});

it('offers no handle for a day with a single row', () => {
  render(<SortableDayGrid rows={[rows[0]]} enabled renderRow={renderRow} onReorder={jest.fn()} />);
  expect(screen.queryAllByRole('button')).toHaveLength(0);
});
