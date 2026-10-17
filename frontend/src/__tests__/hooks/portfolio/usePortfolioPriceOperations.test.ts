import { renderHook, act, waitFor } from '@testing-library/react';
import toast from 'react-hot-toast';
import { usePortfolioPriceOperations } from '@/hooks/portfolio/usePortfolioPriceOperations';
import { portfolioService } from '@/services/portfolioService';

jest.mock('react-i18next', () => ({
  // i18next calls .use(initReactI18next) at import time; a mock without it
  // makes lib/i18n throw and the whole suite dies before any test runs.
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({ t: (k: string) => k }),
}));

// The real default export is a callable used for neutral messages, with
// .success/.error attached. Mocking it as a plain object made `toast(...)`
// throw — which the outer try/catch swallowed into an error toast, so the
// suite stayed green while the behaviour under test was broken.
jest.mock('react-hot-toast', () => {
  const fn = jest.fn();
  return {
    __esModule: true,
    default: Object.assign(fn, { success: jest.fn(), error: jest.fn() }),
  };
});

jest.mock('@/services/portfolioService', () => ({
  portfolioService: {
    refreshPortfolioPrices: jest.fn(),
    syncHistoricalPrices: jest.fn(),
  },
}));

const mockPortfolioService = portfolioService as jest.Mocked<typeof portfolioService>;
const mockToast = toast as jest.Mocked<typeof toast>;

describe('usePortfolioPriceOperations — Fix 6: uses i18n, not hardcoded strings', () => {
  const refetchAll = jest.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    jest.clearAllMocks();
    refetchAll.mockResolvedValue(undefined);
  });

  // ── handleRefresh ─────────────────────────────────────────────────────────────

  const okHistorical = () =>
    mockPortfolioService.syncHistoricalPrices.mockResolvedValue({
      success: true,
      data: { successful: 3, totalRecords: 90 },
    } as never);

  it('calls toast.success after successful refresh', async () => {
    okHistorical();
    mockPortfolioService.refreshPortfolioPrices.mockResolvedValue({
      success: true,
      data: { updated: 5, cached: 2, errors: 0, timestamp: '' },
    } as never);

    const { result } = renderHook(() => usePortfolioPriceOperations(refetchAll));
    await act(async () => { await result.current.handleRefresh(); });

    expect(mockToast.success).toHaveBeenCalledTimes(1);
  });

  it('calls toast.error when refresh throws', async () => {
    mockPortfolioService.refreshPortfolioPrices.mockRejectedValue(new Error('network'));

    const { result } = renderHook(() => usePortfolioPriceOperations(refetchAll));
    await act(async () => { await result.current.handleRefresh(); });

    expect(mockToast.error).toHaveBeenCalledTimes(1);
  });

  it('sets isRefreshing to false after refresh completes', async () => {
    mockPortfolioService.refreshPortfolioPrices.mockResolvedValue({
      success: true,
      data: { updated: 1, cached: 0, errors: 0, timestamp: '' },
    } as never);

    const { result } = renderHook(() => usePortfolioPriceOperations(refetchAll));
    await act(async () => { await result.current.handleRefresh(); });

    expect(result.current.isRefreshing).toBe(false);
  });

  // ── handleSyncHistorical ──────────────────────────────────────────────────────

  it('calls toast.success after successful historical sync', async () => {
    mockPortfolioService.syncHistoricalPrices.mockResolvedValue({
      success: true,
      data: { successful: 10, failed: 0, totalRecords: 300, symbols: [] },
    } as never);

    const { result } = renderHook(() => usePortfolioPriceOperations(refetchAll));
    await act(async () => { await result.current.handleSyncHistorical(); });

    expect(mockToast.success).toHaveBeenCalledTimes(1);
  });

  it('calls toast.error when sync throws', async () => {
    mockPortfolioService.syncHistoricalPrices.mockRejectedValue(new Error('timeout'));

    const { result } = renderHook(() => usePortfolioPriceOperations(refetchAll));
    await act(async () => { await result.current.handleSyncHistorical(); });

    expect(mockToast.error).toHaveBeenCalledTimes(1);
  });
});

describe('handleRefresh also refreshes the chart history', () => {
  const refetchAll = jest.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    jest.clearAllMocks();
    refetchAll.mockResolvedValue(undefined);
    mockPortfolioService.refreshPortfolioPrices.mockResolvedValue({
      success: true,
      data: { updated: 5, cached: 2, errors: 0, timestamp: '' },
    } as never);
  });

  it('syncs historical prices as part of a refresh', async () => {
    // Historical used to live only in the overflow menu, so the obvious button
    // left every chart stale beside a freshly updated price.
    mockPortfolioService.syncHistoricalPrices.mockResolvedValue({
      success: true, data: { successful: 3, totalRecords: 90 },
    } as never);

    const { result } = renderHook(() => usePortfolioPriceOperations(refetchAll));
    await act(async () => { await result.current.handleRefresh(); });

    expect(mockPortfolioService.syncHistoricalPrices).toHaveBeenCalledWith(90);
  });

  it('keeps the price refresh when the historical half fails', async () => {
    // Historical walks every held symbol against the providers — the slow half
    // and the one that partially fails. Letting it throw would discard a price
    // refresh that had already succeeded.
    mockPortfolioService.syncHistoricalPrices.mockRejectedValue(new Error('provider down'));

    const { result } = renderHook(() => usePortfolioPriceOperations(refetchAll));
    await act(async () => { await result.current.handleRefresh(); });

    expect(mockToast.success).toHaveBeenCalledTimes(1);   // prices still reported
    expect(mockToast.error).not.toHaveBeenCalled();       // not an error overall
    expect(mockToast).toHaveBeenCalledWith(              // but the caveat is said
      'portfolio:toast.refreshedPricesOnly',
    );
    expect(refetchAll).toHaveBeenCalled();
  });

  it('says nothing extra when both halves succeed', async () => {
    mockPortfolioService.syncHistoricalPrices.mockResolvedValue({
      success: true, data: { successful: 3, totalRecords: 90 },
    } as never);

    const { result } = renderHook(() => usePortfolioPriceOperations(refetchAll));
    await act(async () => { await result.current.handleRefresh(); });

    expect(mockToast).not.toHaveBeenCalled();
    expect(mockToast.success).toHaveBeenCalledTimes(1);
  });

  it('holds the historical flag for the WHOLE refresh, not just its own await', async () => {
    // The flag used to go up only after the price call returned, leaving a
    // window the length of a full price refresh in which "Sync Charts" was
    // still enabled — one click there started a second, independent sync of
    // every held symbol.
    let releasePrices: (v: unknown) => void = () => {};
    const pricesInFlight = new Promise((resolve) => { releasePrices = resolve; });

    mockPortfolioService.refreshPortfolioPrices.mockImplementation(async () => {
      await pricesInFlight;
      return { success: true, data: { updated: 1, cached: 0, errors: 0, timestamp: '' } } as never;
    });
    mockPortfolioService.syncHistoricalPrices.mockResolvedValue({
      success: true, data: { successful: 3, totalRecords: 90 },
    } as never);

    const { result } = renderHook(() => usePortfolioPriceOperations(refetchAll));

    let refreshing!: Promise<void>;
    act(() => { refreshing = result.current.handleRefresh(); });

    // Still inside the price call — the flag has to already be up here.
    await waitFor(() => expect(result.current.isSyncingHistorical).toBe(true));
    expect(mockPortfolioService.syncHistoricalPrices).not.toHaveBeenCalled();

    await act(async () => { releasePrices(undefined); await refreshing; });
    expect(result.current.isSyncingHistorical).toBe(false);
  });

  it('clears the historical flag when the refresh is done', async () => {
    mockPortfolioService.syncHistoricalPrices.mockResolvedValue({
      success: true, data: { successful: 3, totalRecords: 90 },
    } as never);

    const { result } = renderHook(() => usePortfolioPriceOperations(refetchAll));
    await act(async () => { await result.current.handleRefresh(); });

    // Set during the refresh so the menu item cannot fire the same work
    // concurrently — and released afterwards.
    expect(result.current.isSyncingHistorical).toBe(false);
    expect(result.current.isRefreshing).toBe(false);
  });
});
