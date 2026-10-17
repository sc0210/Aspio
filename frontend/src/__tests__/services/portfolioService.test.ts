import { portfolioService } from '@/services/portfolioService';
import { apiClient } from '@/lib/api-client';
import { priceService } from '@/services/priceService';
import { setExchangeRates, __resetExchangeRates } from '@/utils/formatters';

jest.mock('@/lib/api-client', () => ({
  apiClient: {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
  },
}));

jest.mock('@/services/priceService', () => ({
  priceService: {
    getLatestPricesBulk: jest.fn(),
  },
}));

// Only the backend-cache branch is exercised below; stub the external provider
// so a miss can never reach the network.
jest.mock('@/services/marketDataService', () => ({
  marketDataService: {
    getMultipleMarketData: jest.fn().mockResolvedValue({ success: false, data: [] }),
  },
}));

jest.mock('next-auth/react', () => ({
  getSession: jest.fn().mockResolvedValue(null),
}));

const mockApiClient = apiClient as jest.Mocked<typeof apiClient>;
const mockPriceService = priceService as jest.Mocked<typeof priceService>;

describe('PortfolioService — day change on price refresh', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  /**
   * Backend shape: previous close 100, price 110 → +10% at load time.
   * The refresh then reports 121, so the day change has to become +21%.
   */
  const backendPortfolio = {
    id: 'p1',
    name: 'My Portfolio',
    total_value: 1100,
    total_cost: 1000,
    currency: 'TWD',
    holdings: [
      {
        id: 'h1',
        symbol: 'VT',
        name: 'Vanguard Total World',
        type: 'stock',
        quantity: 10,
        average_cost: 100,
        current_price: 110,
        total_value: 1100,
        total_cost: 1000,
        previousClose: 100,
        currency: 'TWD',
        market: 'US',
      },
    ],
  };

  it('derives day change from previous close on initial load', async () => {
    mockApiClient.get.mockResolvedValue({ success: true, data: backendPortfolio });

    const result = await portfolioService.getPortfolio();
    const holding = result.data!.holdings[0];

    expect(holding.currentPrice).toBe(110);
    expect(holding.dayChange).toBeCloseTo(100);
    expect(holding.dayChangePercentage).toBeCloseTo(10);
  });

  it('recomputes day change when a refresh moves the price', async () => {
    // Regression: updateHoldingsPrices wrote currentPrice/gainLoss but left
    // dayChange untouched, so the "% today" line kept the value derived from
    // the price the backend had returned — a fresh price beside a stale
    // percentage.
    mockApiClient.get.mockResolvedValue({ success: true, data: backendPortfolio });
    mockPriceService.getLatestPricesBulk.mockResolvedValue({
      VT: { close: 121, lastUpdated: '2026-08-14T12:00:00Z' },
    } as never);

    const result = await portfolioService.getPortfolio({}, { updatePrices: true });
    const holding = result.data!.holdings[0];

    expect(holding.currentPrice).toBe(121);
    // (121 - 100) * 10 shares
    expect(holding.dayChange).toBeCloseTo(210);
    expect(holding.dayChangePercentage).toBeCloseTo(21);
  });

  it('rolls the refreshed day change up into the portfolio total', async () => {
    mockApiClient.get.mockResolvedValue({ success: true, data: backendPortfolio });
    mockPriceService.getLatestPricesBulk.mockResolvedValue({
      VT: { close: 121, lastUpdated: '2026-08-14T12:00:00Z' },
    } as never);

    const result = await portfolioService.getPortfolio({}, { updatePrices: true });

    expect(result.data!.todayGainLoss).toBeCloseTo(210);
    // 210 / 1210 total value
    expect(result.data!.todayGainLossPercentage).toBeCloseTo(17.3554, 3);
  });

  it('leaves day change undefined when the backend sends no previous close', async () => {
    // The backend suppresses previous_close when the stored close is too old to
    // be "yesterday" — the row must then show no % rather than a stale one.
    mockApiClient.get.mockResolvedValue({
      success: true,
      data: {
        ...backendPortfolio,
        holdings: [{ ...backendPortfolio.holdings[0], previousClose: undefined }],
      },
    });
    mockPriceService.getLatestPricesBulk.mockResolvedValue({
      VT: { close: 121, lastUpdated: '2026-08-14T12:00:00Z' },
    } as never);

    const result = await portfolioService.getPortfolio({}, { updatePrices: true });
    const holding = result.data!.holdings[0];

    expect(holding.currentPrice).toBe(121);
    expect(holding.dayChange).toBeUndefined();
    expect(holding.dayChangePercentage).toBeUndefined();
  });
});


describe("PortfolioService — today's gain across currencies", () => {
    /**
     * Each holding's day change is in its own currency. Adding them raw put a
     * US$823 day into an NT$ total as NT$823, so this card read NT$57.3k where the
     * dashboard's P&L calendar — which converts — read NT$82.7k, and the two
     * disagreed about the same day.
     */
    const mixedPortfolio = {
        id: 'p1',
        name: 'My Portfolio',
        // TWD total, as the backend reports it.
        total_value: 1_000_000,
        total_cost: 900_000,
        currency: 'TWD',
        holdings: [
            {
                id: 'tw', symbol: '0050', name: 'Yuanta 50', type: 'stock',
                quantity: 1000, average_cost: 100, current_price: 111,
                previousClose: 110, currency: 'TWD', market: 'TW',
            },
            {
                id: 'us', symbol: 'VT', name: 'Vanguard Total World', type: 'stock',
                quantity: 100, average_cost: 100, current_price: 110,
                previousClose: 100, currency: 'USD', market: 'US',
            },
        ],
    };

    beforeEach(() => {
        jest.clearAllMocks();
        setExchangeRates({ USD: 30 });
    });
    afterEach(() => __resetExchangeRates());

    it('converts each holding’s day change before adding it up', async () => {
        mockApiClient.get.mockResolvedValue({ success: true, data: mixedPortfolio });

        const result = await portfolioService.getPortfolio();

        // TWD: (111 - 110) × 1,000 = 1,000. USD: (110 - 100) × 100 = US$1,000 → NT$30,000.
        expect(result.data!.todayGainLoss).toBeCloseTo(31_000);
    });

    it('keeps both halves of the percentage in one currency after a price refresh', async () => {
        // The refresh path recomputes the portfolio totals itself. Converting the
        // numerator while the denominator stayed a raw mixed-currency sum would put
        // a TWD gain over a near-USD total and flatter the percentage wildly.
        mockApiClient.get.mockResolvedValue({ success: true, data: mixedPortfolio });
        mockPriceService.getLatestPricesBulk.mockResolvedValue({
            '0050': { close: 111, lastUpdated: '2026-09-21T12:00:00Z' },
            VT: { close: 110, lastUpdated: '2026-09-21T12:00:00Z' },
        } as never);

        const result = await portfolioService.getPortfolio({}, { updatePrices: true });

        // 1,000 × 111 = NT$111,000, plus 100 × US$110 = US$11,000 → NT$330,000.
        expect(result.data!.totalValue).toBeCloseTo(441_000);
        expect(result.data!.todayGainLoss).toBeCloseTo(31_000);
        expect(result.data!.todayGainLossPercentage).toBeCloseTo((31_000 / 441_000) * 100, 4);

        // The cost basis converts with it, or the gain measured against it is fiction:
        // 1,000 × 100 = NT$100,000, plus 100 × US$100 = US$10,000 → NT$300,000.
        expect(result.data!.totalCost).toBeCloseTo(400_000);
        expect(result.data!.totalGainLoss).toBeCloseTo(41_000);
        expect(result.data!.totalGainLossPercentage).toBeCloseTo(10.25, 4);
    });

    it('states the percentage against the same currency as the total', async () => {
        mockApiClient.get.mockResolvedValue({ success: true, data: mixedPortfolio });

        const result = await portfolioService.getPortfolio();

        // 31,000 of a 1,000,000 TWD portfolio.
        expect(result.data!.todayGainLossPercentage).toBeCloseTo(3.1, 4);
    });
});
