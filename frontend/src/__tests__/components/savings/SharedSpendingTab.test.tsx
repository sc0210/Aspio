import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import SharedSpendingTab from '@/components/savings/SharedSpendingTab';
import { apiClient } from '@/lib/api-client';
import type { PeerConnectionOut, SplitOut } from '@/shared/types';

jest.mock('react-i18next', () => {
  // One t for every render, as react-i18next gives: a new one each render
  // re-ran effects keyed on it.
  const t = (_key: string, fallback?: string | Record<string, string>, vars?: Record<string, string>) => {
    const text = typeof fallback === 'string' ? fallback : _key;
    const values = (typeof fallback === 'object' ? fallback : vars) ?? {};
    return text.replace(/\{\{(\w+)\}\}/g, (_: string, k: string) => values[k] ?? '');
  };
  return {
    initReactI18next: { type: '3rdParty', init: () => {} },
    useTranslation: () => ({ t }),
  };
});

jest.mock('@/lib/api-client', () => ({
  apiClient: {
    listSplits: jest.fn(),
    getSplitBalances: jest.fn(),
    getPeerPrefs: jest.fn(),
    setPeerPrefs: jest.fn(),
    respondToSplit: jest.fn(),
    voidSplit: jest.fn(),
    cancelSplit: jest.fn(),
    createSplit: jest.fn(),
  },
}));

jest.mock('@/hooks/useDataSynchronization', () => ({ invalidateAllFinancialData: jest.fn() }));
jest.mock('@/components/savings/NewSplitModal', () => () => null);

const api = apiClient as unknown as Record<string, jest.Mock>;
const { invalidateAllFinancialData } = jest.requireMock('@/hooks/useDataSynchronization');

const conn: PeerConnectionOut = {
  id: 'conn-1', other_user: { id: 'u2', name: 'Bob', username: 'bob', avatar_url: null },
  status: 'accepted', direction: 'sent', created_at: '2026-05-01T00:00:00Z',
};

const split = (over: Partial<SplitOut>): SplitOut => ({
  id: 's1', connection_id: 'conn-1', description: 'Dinner', total_amount: 1000, currency: 'TWD',
  split_date: '2026-11-06', category_id: 'c1', method: 'equal', status: 'active', payer_is_me: true,
  created_by_me: true, partner_name: 'Bob', my_share: 500, partner_share: 500,
  my_share_status: 'accepted', partner_share_status: 'accepted', my_transaction_id: 't1', ...over,
});

function renderTab() {
  const client = new QueryClient();
  return render(<QueryClientProvider client={client}><SharedSpendingTab connections={[conn]} /></QueryClientProvider>);
}

beforeEach(() => {
  jest.clearAllMocks();
  api.getPeerPrefs.mockResolvedValue({ data: { connection_id: 'conn-1', split_policy: 'approve_each' } });
  api.getSplitBalances.mockResolvedValue({ data: [
    { connection_id: 'conn-1', partner_name: 'Bob', balances: [{ currency: 'TWD', net: 500 }] },
  ] });
});

describe('SharedSpendingTab', () => {
  it('shows what the partner owes', async () => {
    api.listSplits.mockResolvedValue({ data: [split({})] });
    renderTab();
    expect(await screen.findByText(/Bob owes you/)).toBeInTheDocument();
  });

  it('accepts a proposal and refreshes the financial data', async () => {
    api.listSplits.mockResolvedValue({ data: [split({ status: 'proposed', created_by_me: false, payer_is_me: false })] });
    api.respondToSplit.mockResolvedValue({ data: {} });
    renderTab();

    fireEvent.click(await screen.findByRole('button', { name: 'Accept' }));
    await waitFor(() => expect(api.respondToSplit).toHaveBeenCalledWith('s1', { action: 'accept' }));
    await waitFor(() => expect(invalidateAllFinancialData).toHaveBeenCalled());
  });

  it('lets the creator withdraw an unanswered split', async () => {
    api.listSplits.mockResolvedValue({ data: [split({ status: 'proposed' })] });
    api.voidSplit.mockResolvedValue({ data: {} });
    renderTab();
    fireEvent.click(await screen.findByRole('button', { name: 'Withdraw' }));
    await waitFor(() => expect(api.voidSplit).toHaveBeenCalledWith('s1'));
  });

  it('asks before the payer cancels an accepted split', async () => {
    api.listSplits.mockResolvedValue({ data: [split({})] });
    api.cancelSplit.mockResolvedValue({ data: {} });
    renderTab();

    fireEvent.click(await screen.findByRole('button', { name: 'Cancel split' }));
    expect(await screen.findByText('Cancel this split?')).toBeInTheDocument();
    expect(api.cancelSplit).not.toHaveBeenCalled();
    const buttons = screen.getAllByRole('button', { name: 'Cancel split' });
    fireEvent.click(buttons[buttons.length - 1]);
    await waitFor(() => expect(api.cancelSplit).toHaveBeenCalledWith('s1'));
  });

  it('offers no cancel to the partner who did not pay', async () => {
    api.listSplits.mockResolvedValue({ data: [split({ payer_is_me: false, created_by_me: false })] });
    renderTab();
    await screen.findByText(/Dinner/);
    expect(screen.queryByRole('button', { name: 'Cancel split' })).not.toBeInTheDocument();
  });

  it('saves the split policy for a partner', async () => {
    api.listSplits.mockResolvedValue({ data: [] });
    api.setPeerPrefs.mockResolvedValue({ data: {} });
    renderTab();
    const select = await screen.findByRole('combobox');
    fireEvent.change(select, { target: { value: 'auto_accept' } });
    await waitFor(() => expect(api.setPeerPrefs).toHaveBeenCalledWith('conn-1', 'auto_accept'));
  });
});

describe('SharedSpendingTab policy', () => {
  it('rolls the setting back when saving it fails', async () => {
    api.listSplits.mockResolvedValue({ data: [] });
    api.setPeerPrefs.mockRejectedValue(new Error('nope'));
    renderTab();
    const select = await screen.findByRole('combobox');
    await waitFor(() => expect(select).toHaveValue('approve_each'));
    fireEvent.change(select, { target: { value: 'off' } });
    await waitFor(() => expect(select).toHaveValue('approve_each'));
    expect(await screen.findByRole('alert')).toHaveTextContent('nope');
  });

  it('disables the setting when it could not be loaded', async () => {
    api.listSplits.mockResolvedValue({ data: [] });
    api.getPeerPrefs.mockRejectedValue(new Error('down'));
    renderTab();
    const select = await screen.findByRole('combobox');
    await waitFor(() => expect(select).toBeDisabled());
  });

  it('shows all square for zero balances', async () => {
    api.listSplits.mockResolvedValue({ data: [] });
    api.getSplitBalances.mockResolvedValue({ data: [
      { connection_id: 'conn-1', partner_name: 'Bob', balances: [{ currency: 'TWD', net: 0 }] },
    ] });
    renderTab();
    expect(await screen.findByText('All square')).toBeInTheDocument();
    expect(screen.queryByText(/You owe/)).not.toBeInTheDocument();
  });
});
