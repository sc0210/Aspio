import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import SharedSpendingTab from '@/components/savings/SharedSpendingTab';
import { apiClient } from '@/lib/api-client';
import type { PeerConnectionOut, SettlementOut, SplitOut } from '@/shared/types';

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
    listSettlements: jest.fn(),
    respondToSettlement: jest.fn(),
    voidSettlement: jest.fn(),
    createSettlement: jest.fn(),
  },
}));

jest.mock('@/hooks/useDataSynchronization', () => ({
  invalidateAllFinancialData: jest.fn(),
  QUERY_KEYS: { SPLIT_BALANCES: 'split-balances' },
}));
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

let client: QueryClient;
function renderTab() {
  client = new QueryClient();
  return render(<QueryClientProvider client={client}><SharedSpendingTab connections={[conn]} /></QueryClientProvider>);
}

beforeEach(() => {
  jest.clearAllMocks();
  api.listSettlements.mockResolvedValue({ data: [] });
  api.getPeerPrefs.mockResolvedValue({ data: { connection_id: 'conn-1', split_policy: 'approve_each', notify: true } });
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
    await waitFor(() => expect(api.setPeerPrefs).toHaveBeenCalledWith('conn-1', { split_policy: 'auto_accept' }));
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

it('shows a former partner’s balance without a setting', async () => {
  api.listSplits.mockResolvedValue({ data: [] });
  api.getSplitBalances.mockResolvedValue({ data: [
    { connection_id: 'old-conn', partner_name: 'Carol', balances: [{ currency: 'TWD', net: -200 }] },
  ] });
  renderTab();
  expect(await screen.findByText(/You owe Carol/)).toBeInTheDocument();
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
});

const repayment = (over: Partial<SettlementOut>): SettlementOut => ({
  id: 'p1', connection_id: 'conn-1', partner_name: 'Bob', i_paid: false, created_by_me: false,
  amount: 200, currency: 'TWD', settled_on: '2026-11-07', note: null, status: 'proposed', ...over,
});

describe('SharedSpendingTab settling up', () => {
  it('records that the partner paid back, without touching the ledgers', async () => {
    api.listSplits.mockResolvedValue({ data: [] });
    api.createSettlement.mockResolvedValue({ data: {} });
    renderTab();
    const invalidate = jest.spyOn(client, 'invalidateQueries');
    fireEvent.click(await screen.findByRole('button', { name: 'Settle up' }));
    expect(screen.getByLabelText('Amount (TWD)')).toHaveValue(500);
    fireEvent.change(screen.getByLabelText('Amount (TWD)'), { target: { value: '200' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record repayment' }));
    await waitFor(() => expect(api.createSettlement).toHaveBeenCalledWith({
      connection_id: 'conn-1', direction: 'they_paid_me', amount: 200, currency: 'TWD', note: null,
    }));
    await waitFor(() => expect(api.listSettlements).toHaveBeenCalledTimes(2));
    // Only the balance the dashboard shows: a repayment writes no ledger rows.
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['split-balances'] }));
    expect(invalidateAllFinancialData).not.toHaveBeenCalled();
  });

  it('sends my repayment for confirmation and caps it at what I owe', async () => {
    api.listSplits.mockResolvedValue({ data: [] });
    api.getSplitBalances.mockResolvedValue({ data: [
      { connection_id: 'conn-1', partner_name: 'Bob', balances: [{ currency: 'TWD', net: -300 }] },
    ] });
    api.createSettlement.mockResolvedValue({ data: {} });
    renderTab();
    fireEvent.click(await screen.findByRole('button', { name: 'Settle up' }));
    const submit = screen.getByRole('button', { name: 'Send for confirmation' });
    fireEvent.change(screen.getByLabelText('Amount (TWD)'), { target: { value: '301' } });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Amount (TWD)'), { target: { value: '300' } });
    fireEvent.click(submit);
    await waitFor(() => expect(api.createSettlement).toHaveBeenCalledWith(
      expect.objectContaining({ direction: 'i_paid_them', amount: 300 })));
  });

  it('lets me confirm a repayment my partner sent', async () => {
    api.listSplits.mockResolvedValue({ data: [] });
    api.listSettlements.mockResolvedValue({ data: [repayment({})] });
    api.respondToSettlement.mockResolvedValue({ data: {} });
    renderTab();
    expect(await screen.findByText(/Bob says they paid you back/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'It arrived' }));
    await waitFor(() => expect(api.respondToSettlement).toHaveBeenCalledWith('p1', 'confirm'));
  });

  it('offers undo only to the person who was paid', async () => {
    api.listSplits.mockResolvedValue({ data: [] });
    api.listSettlements.mockResolvedValue({ data: [
      repayment({ id: 'mine-received', status: 'confirmed', created_by_me: true }),
      repayment({ id: 'mine-sent', status: 'confirmed', i_paid: true, created_by_me: true }),
    ] });
    api.voidSettlement.mockResolvedValue({ data: {} });
    renderTab();
    const undo = await screen.findAllByRole('button', { name: 'Undo' });
    expect(undo).toHaveLength(1);
    fireEvent.click(undo[0]);
    await waitFor(() => expect(api.voidSettlement).toHaveBeenCalledWith('mine-received'));
  });
});

describe('SharedSpendingTab notifications', () => {
  it('mutes a partner, and rolls back if saving fails', async () => {
    api.listSplits.mockResolvedValue({ data: [] });
    api.setPeerPrefs.mockResolvedValueOnce({ data: {} }).mockRejectedValueOnce(new Error('down'));
    renderTab();
    const box = await screen.findByRole('checkbox', { name: /Notify me about Bob/ });
    await waitFor(() => expect(box).toBeEnabled());
    expect(box).toBeChecked();

    fireEvent.click(box);
    await waitFor(() => expect(api.setPeerPrefs).toHaveBeenCalledWith('conn-1', { notify: false }));
    expect(box).not.toBeChecked();

    fireEvent.click(box);  // turning it back on fails: keep what the server holds
    await waitFor(() => expect(api.setPeerPrefs).toHaveBeenLastCalledWith('conn-1', { notify: true }));
    await waitFor(() => expect(box).not.toBeChecked());
    expect(await screen.findByRole('alert')).toHaveTextContent('down');
  });
});
