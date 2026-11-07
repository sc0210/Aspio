/**
 * "Split this" on an expense already recorded: which rows offer it, and what the
 * modal sends. The API makes the same eligibility check; this keeps the menu
 * from offering what it would refuse.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import SplitExpenseModal, { canSplit } from '@/components/transactions/SplitExpenseModal';
import { TransactionList } from '@/components/transactions/TransactionList';
import { apiClient } from '@/lib/api-client';
import type { Transaction } from '@/shared/types';

jest.mock('react-i18next', () => {
  const t = (key: string, fallback?: string | Record<string, unknown>, vars?: Record<string, string>) => {
    const text = typeof fallback === 'string' ? fallback
      : typeof fallback?.defaultValue === 'string' ? (fallback.defaultValue as string) : key;
    const values = (typeof fallback === 'object' ? fallback : vars) ?? {};
    return text.replace(/\{\{(\w+)\}\}/g, (_: string, k: string) => String(values[k] ?? ''));
  };
  return { initReactI18next: { type: '3rdParty', init: () => {} }, useTranslation: () => ({ t }) };
});

jest.mock('react-hot-toast', () => {
  const t = Object.assign(jest.fn(), { success: jest.fn(), error: jest.fn(), dismiss: jest.fn(), custom: jest.fn() });
  return { __esModule: true, default: t, toast: t };
});

jest.mock('@/hooks/api-hooks', () => ({
  useDeleteTransaction: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useUpdateTransaction: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useSetDayOrder: () => ({ mutateAsync: jest.fn(), isPending: false }),
}));

jest.mock('@/lib/api-client', () => ({
  apiClient: { getPeerConnections: jest.fn(), splitTransaction: jest.fn() },
}));

jest.mock('@/hooks/useDataSynchronization', () => ({ invalidateAllFinancialData: jest.fn() }));

const api = apiClient as unknown as Record<string, jest.Mock>;
const { invalidateAllFinancialData } = jest.requireMock('@/hooks/useDataSynchronization');

const expense = (over: Partial<Transaction> = {}): Transaction => ({
  id: 't1', userId: 'u1', type: 'expense', amount: 1000, currency: 'TWD', category: 'Food',
  description: 'Groceries', date: '2026-11-05', walletType: 'life', tags: [],
  createdAt: new Date('2026-11-05T00:00:00Z'), updatedAt: new Date('2026-11-05T00:00:00Z'), ...over,
});

const partner = { id: 'conn-1', other_user: { id: 'u2', name: 'Bob', username: 'bob', avatar_url: null },
  status: 'accepted', direction: 'sent', created_at: '2026-05-01T00:00:00Z' };

function withClient(ui: React.ReactElement) {
  return render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  jest.clearAllMocks();
  api.getPeerConnections.mockResolvedValue({ data: [partner, { ...partner, id: 'conn-p', status: 'pending' }] });
  api.splitTransaction.mockResolvedValue({ data: {} });
});

describe('canSplit', () => {
  it.each([
    ['an ordinary expense', {}, true],
    ['income', { type: 'income' as const }, false],
    ['a split share', { peerSplitShareId: 's1' }, false],
    ['a holding purchase', { holdingId: 'h1' }, false],
    ['a transfer leg', { transferGroupId: 'g1' }, false],
    ['a loan payment', { loanId: 'l1' }, false],
  ])('%s', (_label, over, expected) => {
    expect(canSplit(expense(over))).toBe(expected);
  });
});

describe('SplitExpenseModal', () => {
  it('splits the expense 50/50 with the accepted partner', async () => {
    const onSuccess = jest.fn();
    withClient(<SplitExpenseModal transaction={expense()} onClose={jest.fn()} onSuccess={onSuccess} />);
    // Only the accepted partner: no choice to make, so no partner select.
    expect(await screen.findByText(/you: 500.00 · Bob: 500.00/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Split with')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Split the bill' }));
    await waitFor(() => expect(api.splitTransaction).toHaveBeenCalledWith({
      transaction_id: 't1', connection_id: 'conn-1', method: 'equal', my_percent: null, my_amount: null,
    }));
    expect(invalidateAllFinancialData).toHaveBeenCalled();
    expect(onSuccess).toHaveBeenCalled();
  });

  it('refuses a share larger than the expense', async () => {
    withClient(<SplitExpenseModal transaction={expense()} onClose={jest.fn()} onSuccess={jest.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Amount' }));
    fireEvent.change(screen.getByLabelText('My share'), { target: { value: '1000.01' } });
    expect(screen.getByRole('button', { name: 'Split the bill' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('My share'), { target: { value: '700' } });
    fireEvent.click(screen.getByRole('button', { name: 'Split the bill' }));
    await waitFor(() => expect(api.splitTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'fixed', my_amount: 700 })));
  });

  it('points to Savings when there is no partner yet', async () => {
    api.getPeerConnections.mockResolvedValue({ data: [] });
    withClient(<SplitExpenseModal transaction={expense()} onClose={jest.fn()} onSuccess={jest.fn()} />);
    expect(await screen.findByRole('link', { name: 'Go to Savings' })).toHaveAttribute('href', '/savings');
    expect(screen.queryByRole('button', { name: 'Split the bill' })).not.toBeInTheDocument();
  });

  it('shows why the API refused', async () => {
    api.splitTransaction.mockRejectedValue(new Error('This expense is already part of a split'));
    withClient(<SplitExpenseModal transaction={expense()} onClose={jest.fn()} onSuccess={jest.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Split the bill' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('already part of a split');
  });
});

describe('Split from the transaction list', () => {
  async function openMenu(isDemo: boolean, tx = expense()) {
    withClient(<TransactionList transactions={[tx]} isDemo={isDemo} />);
    fireEvent.click(screen.getAllByRole('button', { name: /Expand|Collapse/ })[0]);
    fireEvent.click(await screen.findByRole('button', { name: `Actions for ${tx.description}` }));
  }

  it('opens the split modal for an eligible expense', async () => {
    await openMenu(false);
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Split with partner' }));
    expect(await screen.findByRole('heading', { name: 'Split this expense' })).toBeInTheDocument();
  });

  it('is not offered in demo mode', async () => {
    await openMenu(true);
    expect(screen.queryByRole('menuitem', { name: 'Split with partner' })).not.toBeInTheDocument();
  });

  it('is not offered on a loan payment', async () => {
    await openMenu(false, expense({ loanId: 'l1' }));
    expect(screen.queryByRole('menuitem', { name: 'Split with partner' })).not.toBeInTheDocument();
  });
});
