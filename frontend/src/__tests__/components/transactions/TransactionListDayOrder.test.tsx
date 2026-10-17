/**
 * TransactionList's side of dragging rows within a day (#478): what it saves, what it
 * shows meanwhile, and how it recovers. The drag itself is dnd-kit's and needs real
 * layout, which jsdom does not have, so SortableDayGrid is replaced by a stub that
 * fires onReorder the way a drop would.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import toast from 'react-hot-toast';
import { TransactionList } from '@/components/transactions/TransactionList';
import type { Transaction } from '@/shared/types';

const mockSaveDayOrder = jest.fn();

jest.mock('@/hooks/api-hooks', () => ({
  useDeleteTransaction: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useUpdateTransaction: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useSetDayOrder: () => ({ mutateAsync: mockSaveDayOrder, isPending: false }),
}));

// Renders the rows through renderRow and offers one "drop": the first row moved to
// the bottom of the day.
jest.mock('@/components/transactions/SortableDayGrid', () => ({
  SortableDayGrid: ({
    rows,
    enabled,
    renderRow,
    onReorder,
  }: {
    rows: { id: string }[];
    enabled: boolean;
    renderRow: (row: unknown, i: number) => React.ReactNode;
    onReorder: (ids: string[]) => void;
  }) => (
    <div data-testid="day" data-enabled={String(enabled)}>
      {rows.map((row, i) => <React.Fragment key={row.id}>{renderRow(row, i)}</React.Fragment>)}
      <button onClick={() => onReorder([...rows.slice(1), rows[0]].map((r) => r.id))}>drop</button>
    </div>
  ),
}));

jest.mock('@/components/transactions/TransactionRow', () => ({
  TransactionRow: ({ transaction }: { transaction: { description: string } }) => (
    <div data-testid="row">{transaction.description}</div>
  ),
}));

jest.mock('react-hot-toast', () => {
  const t = Object.assign(jest.fn(), { success: jest.fn(), error: jest.fn(), dismiss: jest.fn() });
  return { __esModule: true, default: t, toast: t };
});

jest.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('@/contexts/PrivacyContext', () => ({ usePrivacy: () => ({ isValueVisible: true }) }));
jest.mock('@/utils/logger', () => ({ log: { error: jest.fn() } }));

jest.mock('@headlessui/react', () => ({
  Dialog: ({ open, children }: { open?: boolean; children: React.ReactNode }) =>
    open === false ? null : <div role="dialog">{children}</div>,
  DialogPanel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}));

// Today, as the backend sends it: a plain YYYY-MM-DD string. Today is auto-expanded.
const d = new Date();
const TODAY = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function tx(id: string, description: string): Transaction {
  return {
    id, userId: 'u', type: 'expense', amount: 100, currency: 'TWD', category: 'Dining',
    description, date: TODAY, paymentMethod: 'cash', tags: [],
    createdAt: new Date(), updatedAt: new Date(),
  } as unknown as Transaction;
}

const DAY = [tx('a', 'brunch'), tx('b', 'shopping'), tx('c', 'dinner')];
const shown = () => screen.getAllByTestId('row').map((el) => el.textContent);

beforeEach(() => jest.clearAllMocks());

it('saves the day under its backend date with the dropped order, and shows it at once', async () => {
  let resolveSave: () => void = () => {};
  mockSaveDayOrder.mockReturnValue(new Promise<void>((r) => { resolveSave = r; }));
  render(<TransactionList transactions={DAY} canReorder />);

  fireEvent.click(screen.getByText('drop'));

  expect(mockSaveDayOrder).toHaveBeenCalledWith({ date: TODAY, ids: ['b', 'c', 'a'] });
  // Before the save (and its refetch) finishes, the new order is already on screen.
  expect(shown()).toEqual(['shopping', 'dinner', 'brunch']);
  resolveSave();
  await waitFor(() => expect(mockSaveDayOrder).toHaveBeenCalledTimes(1));
});

it('puts the old order back and says so when the save fails', async () => {
  mockSaveDayOrder.mockRejectedValue(new Error('500'));
  render(<TransactionList transactions={DAY} canReorder />);

  fireEvent.click(screen.getByText('drop'));

  await waitFor(() => expect(toast.error).toHaveBeenCalled());
  expect(shown()).toEqual(['brunch', 'shopping', 'dinner']);
});

it('in demo mode reorders on screen and saves nothing', () => {
  render(<TransactionList transactions={DAY} canReorder isDemo />);

  fireEvent.click(screen.getByText('drop'));

  expect(mockSaveDayOrder).not.toHaveBeenCalled();
  expect(shown()).toEqual(['shopping', 'dinner', 'brunch']);
});

it('passes canReorder through, off by default', () => {
  const { rerender } = render(<TransactionList transactions={DAY} />);
  expect(screen.getByTestId('day').dataset.enabled).toBe('false');
  rerender(<TransactionList transactions={DAY} canReorder />);
  expect(screen.getByTestId('day').dataset.enabled).toBe('true');
});

it('a first save finishing does not wipe a second drop that is still saving', async () => {
  let resolveFirst: () => void = () => {};
  mockSaveDayOrder
    .mockReturnValueOnce(new Promise<void>((r) => { resolveFirst = r; }))
    .mockReturnValueOnce(new Promise<void>(() => {})); // second save still pending
  render(<TransactionList transactions={DAY} canReorder />);

  fireEvent.click(screen.getByText('drop')); // brunch to the bottom
  fireEvent.click(screen.getByText('drop')); // then shopping to the bottom
  expect(shown()).toEqual(['dinner', 'brunch', 'shopping']);

  resolveFirst();
  await waitFor(() => expect(mockSaveDayOrder).toHaveBeenCalledTimes(2));
  // Still the second drop's order — not the server's (unchanged) props order.
  expect(shown()).toEqual(['dinner', 'brunch', 'shopping']);
});
