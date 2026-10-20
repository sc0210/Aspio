/**
 * usePortfolioHoldingOperations against a real QueryClient: the optimistic
 * delete, its rollback, and the lot/symbol update handlers. The sibling
 * usePortfolioHoldingOperations.test.ts mocks React Query away, so it cannot see
 * what the delete does to the cached portfolio.
 *
 * The cached totals are TWD over portfolio-wallet holdings only, while each
 * holding's totalValue is in its own currency — the delete must convert before it
 * subtracts (memory: holding-totalvalue-native-currency).
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import toast from 'react-hot-toast';
import { portfolioService } from '@/services/portfolioService';
import { usePortfolioHoldingOperations } from '@/hooks/portfolio/usePortfolioHoldingOperations';
import { setExchangeRates, __resetExchangeRates } from '@/utils/formatters';
import { createQueryClient, createQueryWrapper } from '../../utils/queryWrapper';

jest.mock('react-hot-toast', () => {
  const t = Object.assign(jest.fn(), { success: jest.fn(), error: jest.fn(), dismiss: jest.fn() });
  return { __esModule: true, default: t, toast: t };
});

jest.mock('@/services/portfolioService', () => ({
  portfolioService: {
    deleteHolding: jest.fn(),
    updateHolding: jest.fn(),
    updateHoldingsBySymbol: jest.fn(),
  },
}));

const svc = portfolioService as jest.Mocked<typeof portfolioService>;
const toastMock = toast as unknown as { success: jest.Mock; error: jest.Mock };

const filters = { type: 'all', walletType: 'all', sortBy: 'value' as const, sortOrder: 'desc' as const };
// The global next-auth mock signs in test@example.com; the hook keys on it.
const KEY = ['portfolio', filters, 'test@example.com'];
const modals = { openSellModal: jest.fn(), openBuyModal: jest.fn() } as unknown as Parameters<typeof usePortfolioHoldingOperations>[1];

// TWD totals: 0050 NT$10,000 (cost 8,000) + VT US$1,000 at 30 = NT$30,000 (cost 24,000).
// The emergency-wallet lot is not in the totals.
const portfolio = () => ({
  totalValue: 40_000,
  totalCost: 32_000,
  totalGainLoss: 8_000,
  totalGainLossPercentage: 25,
  holdings: [
    { id: 'tw', symbol: '0050', currency: 'TWD', walletType: 'portfolio', totalValue: 10_000, totalCost: 8_000, quantity: 50, averageCost: 160 },
    { id: 'us', symbol: 'VT', currency: 'USD', walletType: 'portfolio', totalValue: 1_000, totalCost: 800, quantity: 10, averageCost: 80 },
    { id: 'em', symbol: '00878', currency: 'TWD', walletType: 'emergency', totalValue: 5_000, totalCost: 5_000, quantity: 250, averageCost: 20 },
    { id: 'cash', symbol: 'CASH-TWD', name: 'Life Wallet Cash', currency: 'TWD', walletType: 'life', totalValue: 1 },
  ],
});

function setup(aggregated: Array<{ symbol: string }> = [{ symbol: 'VT' }]) {
  const client = createQueryClient();
  client.setQueryData(KEY, portfolio());
  const hook = renderHook(() => usePortfolioHoldingOperations(filters, modals, aggregated), {
    wrapper: createQueryWrapper(client),
  });
  return { client, hook };
}

beforeEach(() => {
  jest.clearAllMocks();
  setExchangeRates({ USD: 30 });
});

afterEach(() => __resetExchangeRates());

describe('optimistic delete', () => {
  async function deleteNow(id: string, reply: Promise<unknown>) {
    const { client, hook } = setup();
    svc.deleteHolding.mockReturnValue(reply as never);
    act(() => hook.result.current.handleDeleteHolding(id));
    expect(hook.result.current.pendingDeleteId).toBe(id);
    act(() => hook.result.current.handleConfirmDelete());
    expect(hook.result.current.pendingDeleteId).toBeNull();
    return client;
  }

  it('takes a foreign lot off the TWD totals at its converted value', async () => {
    const client = await deleteNow('us', new Promise(() => {}));

    await waitFor(() => {
      const cached = client.getQueryData(KEY) as ReturnType<typeof portfolio>;
      expect(cached.holdings.map((h) => h.id)).toEqual(['tw', 'em', 'cash']);
    });
    const cached = client.getQueryData(KEY) as ReturnType<typeof portfolio>;
    // 40,000 − 1,000×30, not the sum of the remaining native values.
    expect(cached.totalValue).toBe(10_000);
    expect(cached.totalCost).toBe(8_000);
    expect(cached.totalGainLoss).toBe(2_000);
    expect(cached.totalGainLossPercentage).toBe(25);
  });

  it('leaves the totals alone when the lot was never in them', async () => {
    const client = await deleteNow('em', new Promise(() => {}));

    await waitFor(() => {
      const cached = client.getQueryData(KEY) as ReturnType<typeof portfolio>;
      expect(cached.holdings).toHaveLength(3);
    });
    expect((client.getQueryData(KEY) as ReturnType<typeof portfolio>).totalValue).toBe(40_000);
  });

  it('restores the portfolio and shows the error when the delete fails', async () => {
    const client = await deleteNow('tw', Promise.resolve({ success: false, message: 'Has sales' }));

    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('Has sales'));
    expect(client.getQueryData(KEY)).toEqual(portfolio());
  });

  it('confirms and refreshes on success', async () => {
    const client = await deleteNow('tw', Promise.resolve({ success: true }));
    const invalidate = jest.spyOn(client, 'invalidateQueries');

    await waitFor(() => expect(toastMock.success).toHaveBeenCalled());
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['cash-wallet'] }));
    expect(svc.deleteHolding).toHaveBeenCalledWith('tw');
  });
});

describe('delete guards', () => {
  it('refuses the Life Wallet cash row', () => {
    const { hook } = setup();
    act(() => hook.result.current.handleDeleteHolding('cash'));

    expect(hook.result.current.pendingDeleteId).toBeNull();
    expect(toastMock.error).toHaveBeenCalled();
  });

  it('refuses a holding it cannot find rather than skip the guard', () => {
    const { hook } = setup();
    act(() => hook.result.current.handleDeleteHolding('missing'));

    expect(hook.result.current.pendingDeleteId).toBeNull();
    expect(toastMock.error).toHaveBeenCalled();
  });

  it('cancel clears the pending delete without calling the API', () => {
    const { hook } = setup();
    act(() => hook.result.current.handleDeleteHolding('tw'));
    act(() => hook.result.current.handleCancelDelete());
    act(() => hook.result.current.handleConfirmDelete());

    expect(svc.deleteHolding).not.toHaveBeenCalled();
  });
});

describe('lot and symbol updates', () => {
  it('handleUpdateLot sends an ISO date and refetches the open portfolio', async () => {
    const { client, hook } = setup();
    const refetch = jest.spyOn(client, 'refetchQueries');
    svc.updateHolding.mockResolvedValue({ success: true } as never);

    await act(async () => {
      await hook.result.current.handleUpdateLot('tw', { purchaseDate: '2026-03-01', quantity: 60 });
    });

    expect(svc.updateHolding).toHaveBeenCalledWith({
      id: 'tw', quantity: 60, purchaseDate: new Date('2026-03-01').toISOString(),
    });
    expect(refetch).toHaveBeenCalledWith({ queryKey: KEY, exact: true, type: 'active' });
  });

  it('handleUpdateLot reports and rethrows a failure', async () => {
    const { hook } = setup();
    svc.updateHolding.mockRejectedValue(new Error('Bad date'));

    await act(async () => {
      await expect(hook.result.current.handleUpdateLot('tw', {})).rejects.toThrow('Bad date');
    });
    expect(toastMock.error).toHaveBeenCalledWith('Bad date');
  });

  it('handleUpdateSymbol updates every lot and confirms', async () => {
    const { hook } = setup();
    svc.updateHoldingsBySymbol.mockResolvedValue({ success: true } as never);

    await act(async () => {
      await hook.result.current.handleUpdateSymbol('0050', { sector: 'ETF' });
    });

    expect(svc.updateHoldingsBySymbol).toHaveBeenCalledWith('0050', { sector: 'ETF' });
    expect(toastMock.success).toHaveBeenCalled();
  });

  it('handleUpdateSymbol reports and rethrows a failure', async () => {
    const { hook } = setup();
    svc.updateHoldingsBySymbol.mockRejectedValue(new Error('nope'));

    await act(async () => {
      await expect(hook.result.current.handleUpdateSymbol('0050', {})).rejects.toThrow('nope');
    });
    expect(toastMock.error).toHaveBeenCalledWith('nope');
  });
});

describe('quick actions', () => {
  it('opens the sell modal only when there is something besides cash to sell', () => {
    setup([{ symbol: 'CASH-TWD' }]).hook.result.current.handleSellFromWallet();
    expect(modals.openSellModal).not.toHaveBeenCalled();
    expect(toastMock.error).toHaveBeenCalled();

    setup([{ symbol: 'CASH-TWD' }, { symbol: 'VT' }]).hook.result.current.handleSellFromWallet();
    expect(modals.openSellModal).toHaveBeenCalled();
  });

  it('handleAddInvestment opens the buy modal', () => {
    setup().hook.result.current.handleAddInvestment();
    expect(modals.openBuyModal).toHaveBeenCalled();
  });
});
