import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
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
    amendSplit: jest.fn(),
    respondToAmendment: jest.fn(),
    withdrawAmendment: jest.fn(),
    requestCancelSplit: jest.fn(),
    listRecurringSplits: jest.fn(),
    stopRecurringSplit: jest.fn(),
  },
}));

jest.mock('@/hooks/useDataSynchronization', () => ({
  invalidateAllFinancialData: jest.fn(),
  QUERY_KEYS: { SPLIT_BALANCES: 'split-balances' },
}));
jest.mock('@/components/savings/NewSplitModal', () => () => null);
// The insights open on the current month: pin it so the fixtures' dates stay in it.
jest.mock('@/lib/portfolio/businessDate', () => ({ businessToday: () => '2026-11-09' }));

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
  api.listRecurringSplits.mockResolvedValue({ data: [] });
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
    // With the figures shown, so an edit since then is refused rather than accepted unseen.
    await waitFor(() => expect(api.respondToSplit).toHaveBeenCalledWith('s1', {
      action: 'accept', seen_total: 1000, seen_my_share: 500,
    }));
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
    expect(await screen.findByText('All square with Bob')).toBeInTheDocument();
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

describe('SharedSpendingTab changes to an accepted split', () => {
  const change = (proposedByMe: boolean) => ({
    id: 'a1', proposed_by_me: proposedByMe, total_amount: 1200, my_share: 800, partner_share: 400,
    method: 'fixed' as const, description: 'Dinner + drinks',
  });

  it('puts a change Bob proposed in Waiting for you, and accepting refreshes the ledger', async () => {
    api.listSplits.mockResolvedValue({ data: [split({ pending_amendment: change(false) })] });
    api.respondToAmendment.mockResolvedValue({ data: {} });
    renderTab();
    expect(await screen.findByText(/Bob wants to change “Dinner”/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
    await waitFor(() => expect(api.respondToAmendment).toHaveBeenCalledWith('s1', 'accept'));
    await waitFor(() => expect(invalidateAllFinancialData).toHaveBeenCalled());
  });

  it('shows my own change as sent, with Withdraw instead of Change', async () => {
    api.listSplits.mockResolvedValue({ data: [split({ pending_amendment: change(true) })] });
    api.withdrawAmendment.mockResolvedValue({ data: {} });
    renderTab();
    expect(await screen.findByText(/Change sent/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Change' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw change' }));
    await waitFor(() => expect(api.withdrawAmendment).toHaveBeenCalledWith('s1'));
  });

  it('offers Change on an accepted split and sends it', async () => {
    api.listSplits.mockResolvedValue({ data: [split({})] });
    api.amendSplit.mockResolvedValue({ data: {} });
    renderTab();
    fireEvent.click(await screen.findByRole('button', { name: 'Change' }));
    fireEvent.change(screen.getByLabelText('Total (TWD)'), { target: { value: '1200' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send the change' }));
    await waitFor(() => expect(api.amendSplit).toHaveBeenCalledWith('s1', {
      total_amount: 1200, method: 'equal', my_percent: null, my_amount: null, description: 'Dinner',
    }));
  });

  it('lets the creator update an unanswered split, which changes the ledger now', async () => {
    api.listSplits.mockResolvedValue({ data: [split({ status: 'proposed' })] });
    api.amendSplit.mockResolvedValue({ data: {} });
    renderTab();
    fireEvent.click(await screen.findByRole('button', { name: 'Change' }));
    expect(screen.getByText(/hasn’t answered yet, so this changes now/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Total (TWD)'), { target: { value: '1200' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update the bill' }));
    await waitFor(() => expect(api.amendSplit).toHaveBeenCalledWith('s1', expect.objectContaining({ total_amount: 1200 })));
    await waitFor(() => expect(invalidateAllFinancialData).toHaveBeenCalled());
  });

  it('keeps the total of an unanswered split made from a recorded expense', async () => {
    api.listSplits.mockResolvedValue({ data: [split({ status: 'proposed', from_recorded_expense: true })] });
    renderTab();
    fireEvent.click(await screen.findByRole('button', { name: 'Change' }));
    expect(screen.getByLabelText('Total (TWD)')).toHaveAttribute('readonly');
    expect(screen.getByText(/its total stays/)).toBeInTheDocument();
    // Nor can the payer's share go to 0: accepted, that would delete the expense.
    fireEvent.click(screen.getByRole('button', { name: 'Amount' }));
    fireEvent.change(screen.getByLabelText('My share'), { target: { value: '0' } });
    expect(screen.getByRole('button', { name: 'Update the bill' })).toBeDisabled();
  });

  it('shows the bill as it is now when an action is refused', async () => {
    api.listSplits.mockResolvedValue({ data: [split({ status: 'proposed', created_by_me: false, payer_is_me: false })] });
    api.respondToSplit.mockRejectedValue(new Error('This bill was changed; check the new figures'));
    renderTab();
    fireEvent.click(await screen.findByRole('button', { name: 'Accept' }));
    expect(await screen.findByText('This bill was changed; check the new figures')).toBeInTheDocument();
    await waitFor(() => expect(api.listSplits).toHaveBeenCalledTimes(2));
  });

  it('offers no Change to the partner answering an unanswered split', async () => {
    api.listSplits.mockResolvedValue({ data: [split({ status: 'proposed', created_by_me: false, payer_is_me: false })] });
    renderTab();
    await screen.findByRole('button', { name: 'Accept' });
    expect(screen.queryByRole('button', { name: 'Change' })).not.toBeInTheDocument();
  });
});

describe('SharedSpendingTab cancel requests', () => {
  const cancelAsk = (byMe: boolean) => ({
    id: 'a1', proposed_by_me: byMe, total_amount: 1000, my_share: byMe ? 0 : 1000, partner_share: byMe ? 1000 : 0,
    method: 'fixed' as const, description: 'Dinner', kind: 'cancel' as const,
  });

  it('lets the partner who did not pay ask to cancel', async () => {
    api.listSplits.mockResolvedValue({ data: [split({ payer_is_me: false, created_by_me: false })] });
    api.requestCancelSplit.mockResolvedValue({ data: {} });
    renderTab();
    fireEvent.click(await screen.findByRole('button', { name: 'Ask to cancel' }));
    await waitFor(() => expect(api.requestCancelSplit).toHaveBeenCalledWith('s1'));
  });

  it('offers the payer no Ask to cancel: they cancel directly', async () => {
    api.listSplits.mockResolvedValue({ data: [split({})] });
    renderTab();
    await screen.findByRole('button', { name: 'Cancel split' });
    expect(screen.queryByRole('button', { name: 'Ask to cancel' })).not.toBeInTheDocument();
  });

  it('shows the payer the request, asks before accepting, and refreshes the ledger', async () => {
    api.listSplits.mockResolvedValue({ data: [split({ pending_amendment: cancelAsk(false) })] });
    api.respondToAmendment.mockResolvedValue({ data: {} });
    renderTab();
    expect(await screen.findByText('Bob asks to cancel “Dinner”')).toBeInTheDocument();
    expect(screen.getByText(/you carry the whole/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
    expect(await screen.findByText('Cancel this split?')).toBeInTheDocument();
    expect(api.respondToAmendment).not.toHaveBeenCalled();
    const confirm = screen.getAllByRole('button', { name: 'Cancel split' });
    fireEvent.click(confirm[confirm.length - 1]);
    await waitFor(() => expect(api.respondToAmendment).toHaveBeenCalledWith('s1', 'accept'));
    await waitFor(() => expect(invalidateAllFinancialData).toHaveBeenCalled());
  });

  it('shows my own request as sent, with Withdraw request', async () => {
    api.listSplits.mockResolvedValue({ data: [split({ payer_is_me: false, created_by_me: false, pending_amendment: cancelAsk(true) })] });
    api.withdrawAmendment.mockResolvedValue({ data: {} });
    renderTab();
    expect(await screen.findByText('You asked Bob to cancel this split')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ask to cancel' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw request' }));
    await waitFor(() => expect(api.withdrawAmendment).toHaveBeenCalledWith('s1'));
  });
});

describe('SharedSpendingTab repeating bills', () => {
  it('lists a repeating bill and stops it', async () => {
    api.listSplits.mockResolvedValue({ data: [] });
    api.listRecurringSplits.mockResolvedValue({ data: [{
      id: 'r1', connection_id: 'conn-1', partner_name: 'Bob', description: 'Rent', total_amount: 30000,
      currency: 'TWD', frequency: 'monthly', next_occurrence: '2026-12-07', method: 'equal',
      my_share: 15000, partner_share: 15000,
    }] });
    api.stopRecurringSplit.mockResolvedValue({ data: null });
    renderTab();
    expect(await screen.findByText('Rent')).toBeInTheDocument();
    expect(screen.getByText(/monthly with Bob .* next 2026-12-07/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    await waitFor(() => expect(api.stopRecurringSplit).toHaveBeenCalledWith('r1'));
  });
});

describe('SharedSpendingTab insights', () => {
  const bills = [
    split({ id: 'a', category_name: 'Dining' }),
    split({ id: 'b', description: 'Costco', total_amount: 3000, my_share: 1000, partner_share: 2000, category_name: 'Groceries', payer_is_me: false }),
    split({ id: 'c', description: 'Taxi', split_date: '2026-10-02', total_amount: 600, my_share: 300, partner_share: 300, category_name: 'Transport' }),
    split({ id: 'd', description: 'Movie', status: 'proposed', total_amount: 640, my_share: 320, partner_share: 320 }),
  ];

  it('sums the accepted bills of the month, and steps to the one before', async () => {
    api.listSplits.mockResolvedValue({ data: bills });
    renderTab();
    const insights = await screen.findByRole('region', { name: 'Insights' });
    const tile = (label: string) => within(insights).getByText(label).parentElement!;
    // November: Dinner 1000 (you paid) + Costco 3000 (Bob paid); the proposal isn't counted.
    expect(within(insights).getByText('November 2026', { selector: 'span' })).toBeInTheDocument();
    expect(tile('Shared spending')).toHaveTextContent('4,000');
    expect(tile('Your share')).toHaveTextContent('1,500');
    expect(tile('You paid up front')).toHaveTextContent('1,000');
    expect(tile('Bob paid up front')).toHaveTextContent('3,000');
    expect(within(insights).getByText('Groceries')).toBeInTheDocument();
    expect(within(insights).queryByText('Transport')).not.toBeInTheDocument();
    expect(within(insights).getByRole('button', { name: 'Next month' })).toBeDisabled();

    fireEvent.click(within(insights).getByRole('button', { name: 'Previous month' }));
    expect(within(insights).getByText('October 2026', { selector: 'span' })).toBeInTheDocument();
    expect(tile('Shared spending')).toHaveTextContent('600');
    expect(within(insights).getByText('Transport')).toBeInTheDocument();

    fireEvent.click(within(insights).getByRole('button', { name: 'All time' }));
    expect(tile('Shared spending')).toHaveTextContent('4,600');
  });

  it('names only the partners behind the figures', async () => {
    // A declined bill with Carol is on the list but in none of the numbers.
    api.listSplits.mockResolvedValue({ data: [...bills, split({ id: 'e', status: 'declined', partner_name: 'Carol' })] });
    renderTab();
    const insights = await screen.findByRole('region', { name: 'Insights' });
    expect(within(insights).getByText('Bob paid up front')).toBeInTheDocument();
  });

  it('shows no insights without an accepted bill', async () => {
    api.listSplits.mockResolvedValue({ data: [bills[3]] });
    renderTab();
    await screen.findByText(/Movie/);
    expect(screen.queryByRole('region', { name: 'Insights' })).not.toBeInTheDocument();
  });

  it('filters the bill list and clears the filters', async () => {
    api.listSplits.mockResolvedValue({ data: bills });
    renderTab();
    const list = await screen.findByRole('region', { name: 'Shared bills' });
    await within(list).findByText(/Costco/); // the region renders before the bills load
    fireEvent.change(within(list).getByRole('combobox', { name: 'Category' }), { target: { value: 'Groceries' } });
    expect(within(list).getByText(/Costco/)).toBeInTheDocument();
    expect(within(list).queryByText(/Taxi/)).not.toBeInTheDocument();
    expect(within(list).getByText(/Showing 1 of 4/)).toBeInTheDocument();

    fireEvent.change(within(list).getByRole('searchbox', { name: 'Search shared bills' }), { target: { value: 'nothing like it' } });
    expect(within(list).getByText('No bills match these filters.')).toBeInTheDocument();
    fireEvent.click(within(list).getByRole('button', { name: 'Clear filters' }));
    expect(within(list).getByText(/Taxi/)).toBeInTheDocument();
  });

  it('exports the bills the list shows as CSV', async () => {
    api.listSplits.mockResolvedValue({ data: bills });
    const created: Blob[] = [];
    URL.createObjectURL = jest.fn((b: Blob) => { created.push(b); return 'blob:x'; });
    URL.revokeObjectURL = jest.fn();
    const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    renderTab();
    const list = await screen.findByRole('region', { name: 'Shared bills' });
    await within(list).findByText(/Costco/); // the region renders before the bills load
    fireEvent.change(within(list).getByRole('combobox', { name: 'Paid by' }), { target: { value: 'partner' } });
    fireEvent.click(within(list).getByRole('button', { name: 'Export CSV' }));

    expect(click).toHaveBeenCalled();
    // jsdom's Blob has no text(); read it the way a browser without it would.
    const text = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.readAsText(created[0]);
    });
    const rows = text.replace(/^\uFEFF/, '').split('\n');
    expect(rows[0]).toBe('Date,Description,Category,Partner,Paid by,Status,Currency,Total,My share,Partner share');
    expect(rows.slice(1)).toEqual(['2026-11-06,Costco,Groceries,Bob,Partner,active,TWD,3000,1000,2000']);
    click.mockRestore();
  });
});

describe('SharedSpendingTab with more than one partner', () => {
  const twoPartners = [
    split({ id: 'b1', description: 'Costco', total_amount: 1000, payer_is_me: false }),
    split({ id: 'a1', connection_id: 'conn-2', partner_name: 'Amy', description: 'Taxi', total_amount: 400, payer_is_me: false }),
  ];

  it('offers no partner menu with one partner', async () => {
    api.listSplits.mockResolvedValue({ data: [split({})] });
    renderTab();
    const list = await screen.findByRole('region', { name: 'Shared bills' });
    await within(list).findByText(/Dinner/);
    expect(within(list).queryByRole('combobox', { name: 'Partner' })).toBeNull();
  });

  it('breaks down what partners paid, then narrows the list and the insights to one partner', async () => {
    api.listSplits.mockResolvedValue({ data: twoPartners });
    renderTab();
    const list = await screen.findByRole('region', { name: 'Shared bills' });
    await within(list).findByText(/Taxi/);
    const insights = screen.getByRole('region', { name: /Insights/ });
    // Everyone: one total, with who is behind it.
    expect(within(insights).getByText('Partners paid up front')).toBeInTheDocument();
    expect(within(insights).getByText(/Bob NT\$1,000 · Amy NT\$400/)).toBeInTheDocument();

    fireEvent.change(within(list).getByRole('combobox', { name: 'Partner' }), { target: { value: 'conn-2' } });

    expect(within(list).queryByText(/Costco/)).toBeNull();
    expect(within(list).getByText(/Taxi/)).toBeInTheDocument();
    expect(within(insights).getByText('with Amy')).toBeInTheDocument();
    expect(within(insights).getByText('Amy paid up front')).toBeInTheDocument();
    expect(within(insights).queryByText(/Bob NT\$/)).toBeNull();
  });
});

describe('SharedSpendingTab bills list layout', () => {
  const across = [
    split({ id: 'n1', description: 'Costco', split_date: '2026-11-04' }),
    split({ id: 'n2', description: 'Dinner', split_date: '2026-11-02' }),
    split({ id: 'o1', description: 'Taxi', split_date: '2026-10-31' }),
  ];

  it('heads each month once', async () => {
    api.listSplits.mockResolvedValue({ data: across });
    renderTab();
    const list = await screen.findByRole('region', { name: 'Shared bills' });
    await within(list).findByText(/Taxi/);
    expect(within(list).getAllByRole('heading', { level: 4 }).map((h) => h.textContent)).toEqual(['November 2026', 'October 2026']);
  });

  it('folds the filter menus behind one button that counts what is set', async () => {
    api.listSplits.mockResolvedValue({ data: across });
    renderTab();
    const list = await screen.findByRole('region', { name: 'Shared bills' });
    await within(list).findByText(/Taxi/);
    const toggle = within(list).getByRole('button', { name: /Filters/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    fireEvent.change(within(list).getByRole('combobox', { name: 'Paid by' }), { target: { value: 'me' } });
    expect(toggle).toHaveTextContent('Filters1');
  });
});
