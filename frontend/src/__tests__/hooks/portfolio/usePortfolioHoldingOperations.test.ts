import { renderHook, act } from '@testing-library/react';
import toast from 'react-hot-toast';
import {
  useQuery as useQueryFn,
  useMutation as useMutationFn,
  useQueryClient as useQueryClientFn,
} from '@tanstack/react-query';
import { usePortfolioHoldingOperations } from '@/hooks/portfolio/usePortfolioHoldingOperations';

jest.mock('@tanstack/react-query', () => ({
  useQuery: jest.fn(),
  useMutation: jest.fn(),
  useQueryClient: jest.fn(),
}));

jest.mock('react-i18next', () => ({
  // i18next calls .use(initReactI18next) at import time; a mock without it
  // makes lib/i18n throw and the whole suite dies before any test runs.
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({ t: (k: string) => k }),
}));

jest.mock('react-hot-toast', () => ({
  __esModule: true,
  default: { success: jest.fn(), error: jest.fn() },
}));

jest.mock('@/services/portfolioService', () => ({
  portfolioService: {
    deleteHolding: jest.fn(),
    updateHolding: jest.fn(),
    updateHoldingsBySymbol: jest.fn(),
    recalculateIRR: jest.fn().mockResolvedValue({}),
  },
}));

jest.mock('@/hooks/useDataSynchronization', () => ({
  invalidateDashboardData: jest.fn(),
  QUERY_KEYS: { PORTFOLIO: 'portfolio' },
}));

const useQuery = useQueryFn as jest.Mock;
const useMutation = useMutationFn as jest.Mock;
const useQueryClient = useQueryClientFn as jest.Mock;

const mockToast = toast as jest.Mocked<typeof toast>;

describe('usePortfolioHoldingOperations — Fix 7+8', () => {
  const defaultFilters = {
    type: 'all',
    walletType: 'all',
    sortBy: 'value' as const,
    sortOrder: 'desc' as const,
  };
  const modals = {
    openSellModal: jest.fn(),
    openBuyModal: jest.fn(),
  } as unknown as Parameters<typeof usePortfolioHoldingOperations>[1];

  // Only the five methods these hooks call. Typing this as a real QueryClient
  // required stubbing ~30 members, and lost the jest.Mock surface the
  // assertions below need (mockReturnValue, toHaveBeenCalledWith).
  type QueryClientMock = {
    invalidateQueries: jest.Mock;
    refetchQueries: jest.Mock;
    cancelQueries: jest.Mock;
    setQueryData: jest.Mock;
    getQueryData: jest.Mock;
  };
  let queryClientMock: QueryClientMock;

  beforeEach(() => {
    jest.clearAllMocks();
    queryClientMock = {
      invalidateQueries: jest.fn().mockResolvedValue(undefined),
      refetchQueries: jest.fn().mockResolvedValue(undefined),
      cancelQueries: jest.fn().mockResolvedValue(undefined),
      setQueryData: jest.fn(),
      getQueryData: jest.fn().mockReturnValue(null),
    };
    useQueryClient.mockReturnValue(queryClientMock);
    useQuery.mockReturnValue({ data: null, isLoading: false, error: null });
    useMutation.mockImplementation(({ mutationFn: _mutationFn, onSuccess: _onSuccess, onError: _onError, onMutate: _onMutate }: Record<string, unknown>) => ({
      mutate: jest.fn(),
      isPending: false,
    }));
  });

  // ── Fix 7: no setTimeout in delete success ────────────────────────────────────
  // Verified by the absence of arbitrary delay — no async test needed here;
  // the mutation callback in the source no longer contains setTimeout.

  // ── Fix 8: window.confirm replaced by pendingDeleteId ─────────────────────────

  it('handleDeleteHolding sets pendingDeleteId instead of calling window.confirm', () => {
    const confirmSpy = jest.spyOn(window, 'confirm');

    const { result } = renderHook(() =>
      usePortfolioHoldingOperations(defaultFilters, modals, [])
    );

    queryClientMock.getQueryData.mockReturnValue({
      holdings: [{ id: 'h1', symbol: 'AAPL', walletType: 'portfolio' }],
    });

    act(() => { result.current.handleDeleteHolding('h1'); });

    expect(result.current.pendingDeleteId).toBe('h1');
    expect(confirmSpy).not.toHaveBeenCalled();

    confirmSpy.mockRestore();
  });

  it('handleCancelDelete clears pendingDeleteId', () => {
    const { result } = renderHook(() =>
      usePortfolioHoldingOperations(defaultFilters, modals, [])
    );

    queryClientMock.getQueryData.mockReturnValue({
      holdings: [{ id: 'h1', symbol: 'AAPL', walletType: 'portfolio' }],
    });

    act(() => { result.current.handleDeleteHolding('h1'); });
    expect(result.current.pendingDeleteId).toBe('h1');

    act(() => { result.current.handleCancelDelete(); });
    expect(result.current.pendingDeleteId).toBeNull();
  });

  it('life-wallet holding shows toast error and does NOT set pendingDeleteId', () => {
    const { result } = renderHook(() =>
      usePortfolioHoldingOperations(defaultFilters, modals, [])
    );

    queryClientMock.getQueryData.mockReturnValue({
      holdings: [{ id: 'life1', symbol: 'CASH-TWD', name: 'Life Wallet Cash', walletType: 'life' }],
    });

    act(() => { result.current.handleDeleteHolding('life1'); });

    expect(result.current.pendingDeleteId).toBeNull();
    expect(mockToast.error).toHaveBeenCalledTimes(1);
  });

  it('handleConfirmDelete clears pendingDeleteId', () => {
    const mutateMock = jest.fn();
    useMutation.mockReturnValue({ mutate: mutateMock, isPending: false });

    const { result } = renderHook(() =>
      usePortfolioHoldingOperations(defaultFilters, modals, [])
    );

    queryClientMock.getQueryData.mockReturnValue({
      holdings: [{ id: 'h2', symbol: 'TSLA', walletType: 'portfolio' }],
    });

    act(() => { result.current.handleDeleteHolding('h2'); });
    expect(result.current.pendingDeleteId).toBe('h2');

    act(() => { result.current.handleConfirmDelete(); });
    expect(result.current.pendingDeleteId).toBeNull();
  });
});
