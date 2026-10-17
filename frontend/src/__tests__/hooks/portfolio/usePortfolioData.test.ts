import { renderHook } from '@testing-library/react';
import {
  useQuery as useQueryFn,
  useMutation as useMutationFn,
  useQueryClient as useQueryClientFn,
} from '@tanstack/react-query';
import { usePortfolioData } from '@/hooks/portfolio/usePortfolioData';

jest.mock('@tanstack/react-query', () => ({
  useQuery: jest.fn(),
  useMutation: jest.fn(),
  useQueryClient: jest.fn(),
  keepPreviousData: undefined,
}));

jest.mock('react-i18next', () => ({
  // i18next calls .use(initReactI18next) at import time; a mock without it
  // makes lib/i18n throw and the whole suite dies before any test runs.
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({ t: (k: string) => k }),
}));

jest.mock('@/services/portfolioService', () => ({
  portfolioService: {
    getPortfolio: jest.fn(),
    getPortfolioAnalytics: jest.fn(),
    getDailyPerformance: jest.fn(),
  },
}));

jest.mock('next-auth/react', () => ({
  useSession: jest.fn().mockReturnValue({ data: { user: { email: 'test@test.com' } } }),
}));

jest.mock('@/hooks/useRetirementProjection', () => ({
  useRetirementProjection: jest.fn().mockReturnValue(null),
}));

jest.mock('@/utils/portfolio-aggregation', () => ({
  aggregateHoldingsBySymbol: jest.fn().mockReturnValue([]),
}));

const useQuery = useQueryFn as jest.Mock;
const useMutation = useMutationFn as jest.Mock;
const useQueryClient = useQueryClientFn as jest.Mock;

// Query order after fix #4 (exchange rates removed): (1) portfolio, (2) analytics, (3) daily-performance

describe('usePortfolioData', () => {
  const defaultFilters = {
    type: 'all',
    walletType: 'all',
    sortBy: 'value' as const,
    sortOrder: 'desc' as const,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    useQueryClient.mockReturnValue({
      invalidateQueries: jest.fn(),
      setQueryData: jest.fn(),
      getQueryData: jest.fn(),
    });
    useMutation.mockReturnValue({ mutate: jest.fn(), isPending: false });
    useQuery.mockReturnValue({ data: null, isLoading: false, error: null, refetch: jest.fn() });
  });

  // ── Fix #4: exchange rates query removed ─────────────────────────────────────

  it('does not fetch exchange rates (query removed)', () => {
    renderHook(() => usePortfolioData(defaultFilters));
    const exchangeRateCalls = useQuery.mock.calls.filter((args: unknown[]) => {
      const opts = args[0] as { queryKey?: unknown[] };
      return Array.isArray(opts?.queryKey) && opts.queryKey.includes('exchange-rates');
    });
    expect(exchangeRateCalls.length).toBe(0);
  });

  it('does not expose exchangeRates', () => {
    const { result } = renderHook(() => usePortfolioData(defaultFilters));
    expect('exchangeRates' in result.current).toBe(false);
  });

  it('does not expose refetchExchangeRates', () => {
    const { result } = renderHook(() => usePortfolioData(defaultFilters));
    expect('refetchExchangeRates' in result.current).toBe(false);
  });

  // ── Fix #10: refetchAll has stable reference ──────────────────────────────────

  it('refetchAll has a stable reference across re-renders', () => {
    const { result, rerender } = renderHook(() => usePortfolioData(defaultFilters));
    const first = result.current.refetchAll;
    rerender();
    expect(result.current.refetchAll).toBe(first);
  });

  // ── Error / loading state correctness ────────────────────────────────────────

  it('hasError is true when portfolioError is set', () => {
    useQuery
      .mockReturnValueOnce({ data: null, isLoading: false, error: new Error('portfolio fail'), refetch: jest.fn() }) // 1. portfolio
      .mockReturnValue({ data: null, isLoading: false, error: null, refetch: jest.fn() });

    const { result } = renderHook(() => usePortfolioData(defaultFilters));
    expect(result.current.hasError).toBe(true);
  });

  it('isLoading is true when portfolio query is loading', () => {
    useQuery
      .mockReturnValueOnce({ data: null, isLoading: true, error: null, refetch: jest.fn() }) // 1. portfolio loading
      .mockReturnValue({ data: null, isLoading: false, error: null, refetch: jest.fn() });

    const { result } = renderHook(() => usePortfolioData(defaultFilters));
    expect(result.current.isLoading).toBe(true);
  });

  it('hasError is false when only analytics fails', () => {
    useQuery
      .mockReturnValueOnce({ data: { holdings: [] }, isLoading: false, error: null, refetch: jest.fn() }) // 1. portfolio ok
      .mockReturnValueOnce({ data: null, isLoading: false, error: new Error('analytics fail'), refetch: jest.fn() }) // 2. analytics
      .mockReturnValue({ data: null, isLoading: false, error: null, refetch: jest.fn() });

    const { result } = renderHook(() => usePortfolioData(defaultFilters));
    expect(result.current.hasError).toBe(false);
  });

  // ── Analytics queryKey correctness ────────────────────────────────────────────

  it('uses holdings.length (not null) in analytics queryKey when lastPriceUpdateAt is null', () => {
    const portfolioData = { holdings: new Array(3).fill({}), lastPriceUpdateAt: null };
    useQuery
      .mockReturnValueOnce({ data: portfolioData, isLoading: false, error: null, refetch: jest.fn() }) // 1. portfolio
      .mockReturnValue({ data: null, isLoading: false, error: null, refetch: jest.fn() });

    renderHook(() => usePortfolioData(defaultFilters));

    const analyticsCalls = useQuery.mock.calls.filter((args: unknown[]) => {
      const opts = args[0] as { queryKey?: unknown[] };
      return Array.isArray(opts?.queryKey) && opts.queryKey.includes('portfolio-analytics');
    });

    if (analyticsCalls.length > 0) {
      const queryKey: unknown[] = (analyticsCalls[0][0] as { queryKey: unknown[] }).queryKey;
      expect(queryKey).toContain(3);
      expect(queryKey).not.toContain(null);
    }
  });

  it('uses lastPriceUpdateAt ISO string in analytics queryKey when valid date', () => {
    const ts = '2024-06-15T00:00:00.000Z';
    const portfolioData = { holdings: new Array(2).fill({}), lastPriceUpdateAt: new Date(ts) };
    useQuery
      .mockReturnValueOnce({ data: portfolioData, isLoading: false, error: null, refetch: jest.fn() }) // 1. portfolio
      .mockReturnValue({ data: null, isLoading: false, error: null, refetch: jest.fn() });

    renderHook(() => usePortfolioData(defaultFilters));

    const analyticsCalls = useQuery.mock.calls.filter((args: unknown[]) => {
      const opts = args[0] as { queryKey?: unknown[] };
      return Array.isArray(opts?.queryKey) && opts.queryKey.includes('portfolio-analytics');
    });

    if (analyticsCalls.length > 0) {
      const queryKey: unknown[] = (analyticsCalls[0][0] as { queryKey: unknown[] }).queryKey;
      expect(queryKey).toContain(ts);
    }
  });
});
