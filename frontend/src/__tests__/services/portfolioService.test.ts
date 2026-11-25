import { portfolioService } from '@/services/portfolioService';
import { apiClient } from '@/lib/api-client';
import { setExchangeRates, __resetExchangeRates } from '@/utils/formatters';

jest.mock('@/lib/api-client', () => ({
  apiClient: {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
  },
}));

jest.mock('next-auth/react', () => ({
  getSession: jest.fn().mockResolvedValue(null),
}));

const mockApiClient = apiClient as jest.Mocked<typeof apiClient>;

describe('PortfolioService — day change', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  /**
   * Backend shape: previous close 100, price 110 → +10% at load time.
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
    const result = await portfolioService.getPortfolio();
    const holding = result.data!.holdings[0];

    expect(holding.currentPrice).toBe(110);
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

    it('states the percentage against the same currency as the total', async () => {
        mockApiClient.get.mockResolvedValue({ success: true, data: mixedPortfolio });

        const result = await portfolioService.getPortfolio();

        // 31,000 on the TWD value of the same holdings at the previous close
        // (NT$410,000): the stored total is not the base of a day's move.
        expect(result.data!.todayGainLossPercentage).toBeCloseTo((31_000 / 410_000) * 100, 4);
    });
});

