import { apiClient } from '@/lib/api-client';
import { getPublicApiUrl } from '@/lib/api-url';
import { getSession } from 'next-auth/react';
import { marketDataService } from './marketDataService';
import { priceService } from './priceService';
import { Portfolio, PortfolioHolding, MarketType, ApiResponse, StockQuote } from '@/shared/types';
import { log } from '@/utils/logger';
import { toTWD } from '@/utils/formatters';

interface ExchangeRatesResponse {
  base_currency: string;
  /** Only currencies that actually resolved. A code absent here is priced by
   *  nothing — do not treat a missing entry as 1. */
  rates: Record<string, number>;
  /** Codes the server could not price on this request. Present so a caller can
   *  tell "unpriceable" from "never asked", instead of the endpoint reporting
   *  parity and a USD position converting at 1:1. */
  unavailable?: string[];
  timestamp: string;
}

interface CreateHoldingRequest {
  symbol: string;
  name: string;
  type: 'stock' | 'etf' | 'crypto' | 'cryptocurrency' | 'bond' | 'mutual_fund' | 'cash' | 'reit' | 'commodity' | 'lending';
  quantity: number;
  averageCost: number;
  market: MarketType;
  exchange: string;
  currency: string;
  sector?: string;
  region?: string;
  walletType?: 'portfolio' | 'emergency' | string;
}

export interface HoldingInput {
  symbol: string;
  name: string;
  type: 'stock' | 'etf' | 'crypto' | 'cryptocurrency' | 'bond' | 'mutual_fund' | 'cash' | 'reit' | 'commodity' | 'lending';
  quantity: number;
  averageCost: number;
  currency: string;
  exchange: string;
  sector?: string;
  walletType?: 'portfolio' | 'emergency' | string;
  purchaseDate?: string; // ISO date string (YYYY-MM-DD) for transaction tracking
  notes?: string;
}

interface UpdateHoldingRequest extends Partial<CreateHoldingRequest> {
  id: string;
  purchaseDate?: string; // ISO date string for purchase date
  /** Only for a holding with `manuallyPriced`; the backend refuses it otherwise. */
  currentPrice?: number;
}

interface PortfolioFilters {
  market?: MarketType | 'all';
  type?: string | 'all';
  sortBy?: 'symbol' | 'name' | 'value' | 'gainLoss' | 'gainLossPercentage';
  sortOrder?: 'asc' | 'desc';
}

export interface TimeWeightedReturn {
  /** Since inception, per year, in percent; null under a year of history. */
  annualizedReturnPct: number | null;
  totalReturnPct: number | null;
  startDate: string | null;
  /** 0–1: how much of the valuation rested on real stored closes. */
  realPriceShare: number | null;
}

class PortfolioService {
  private readonly DEMO_PORTFOLIO_KEY = 'aspiro_demo_portfolio';
  private readonly DEMO_HOLDINGS_KEY = 'aspiro_demo_holdings';

  private getDemoPortfolioFromStorage(): Portfolio | null {
    if (typeof window === 'undefined') return null;

    try {
      const stored = localStorage.getItem(this.DEMO_PORTFOLIO_KEY);
      return stored ? JSON.parse(stored) : null;
    } catch (error) {
      log.warn('Error reading demo portfolio from storage', error, 'PortfolioService');
      return null;
    }
  }

  private saveDemoPortfolioToStorage(portfolio: Portfolio): void {
    if (typeof window === 'undefined') return;

    try {
      localStorage.setItem(this.DEMO_PORTFOLIO_KEY, JSON.stringify(portfolio));
    } catch (error) {
      log.warn('Error saving demo portfolio to storage', error, 'PortfolioService');
    }
  }

  private getDemoHoldingsFromStorage(): PortfolioHolding[] {
    if (typeof window === 'undefined') return [];

    try {
      const stored = localStorage.getItem(this.DEMO_HOLDINGS_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch (error) {
      log.warn('Error reading demo holdings from storage', error, 'PortfolioService');
      return [];
    }
  }

  private saveDemoHoldingsToStorage(holdings: PortfolioHolding[]): void {
    if (typeof window === 'undefined') return;

    try {
      localStorage.setItem(this.DEMO_HOLDINGS_KEY, JSON.stringify(holdings));
    } catch (error) {
      log.warn('Error saving demo holdings to storage', error, 'PortfolioService');
    }
  }

  async getPortfolio(filters: PortfolioFilters = {}, options: { updatePrices?: boolean } = {}): Promise<ApiResponse<Portfolio>> {
    try {
      const params = new URLSearchParams();

      Object.entries(filters).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== 'all') {
          params.append(key, value.toString());
        }
      });

      const response = await apiClient.get(`/portfolio/?${params.toString()}`);

      // Handle different response formats:
      // 1. {portfolio: {...}} or {data: {...}} - wrapped response
      // 2. {id: '...', name: '...', holdings: [...]} - direct portfolio object
      const responseAny = response as unknown as Record<string, unknown>;
      const portfolioData = (responseAny.portfolio || response.data || (responseAny.id ? response : null)) as {
        id?: string; userId?: string; user_id?: string; name?: string; description?: string;
        holdings?: Record<string, unknown>[];
        totalValue?: number; total_value?: number;
        totalCost?: number; total_cost?: number;
        totalGainLoss?: number; total_gain_loss?: number;
        totalGainLossPercentage?: number; total_gain_loss_percentage?: number;
        currency?: string;
        isDefault?: boolean; is_default?: boolean;
        isActive?: boolean; is_active?: boolean;
        autoUpdate?: boolean; auto_update?: boolean;
        lastPriceUpdateAt?: string; last_price_update_at?: string;
        metadata?: Record<string, unknown>;
        createdAt?: string; created_at?: string;
        updatedAt?: string; updated_at?: string;
      } | null;

      if (portfolioData) {
        // Normalize backend response to match frontend types
        const normalizedHoldings = (portfolioData.holdings || []).map((holding: Record<string, unknown>) => this.normalizeHolding(holding));

        // Compute portfolio-level today's gain/loss from individual holdings.
        // Uses previous_close returned by the backend (from historical prices).
        //
        // Each holding's dayChange is in ITS OWN currency, so it has to be converted
        // before being added up: a US$823 day on the US holdings was going into the
        // total as NT$823, understating a NT$82.7k day as NT$57.3k and leaving this
        // card disagreeing with the dashboard's P&L calendar, which converts.
        const holdingsWithDayChange = normalizedHoldings.filter((h: PortfolioHolding) => h.dayChange != null);
        const todayGainLoss = holdingsWithDayChange.length > 0
          ? holdingsWithDayChange.reduce(
              (sum: number, h: PortfolioHolding) => sum + toTWD(h.dayChange ?? 0, h.currency || 'TWD'),
              0,
            )
          : 0;
        const totalValue = portfolioData.totalValue || portfolioData.total_value || 0;
        const todayGainLossPercentage = totalValue > 0 && holdingsWithDayChange.length > 0
          ? (todayGainLoss / totalValue) * 100
          : 0;

        // Derive cashWallet from cash-type holdings for the Available Cash stat card
        const cashWallet = normalizedHoldings
          .filter((h: PortfolioHolding) => h.type === 'cash')
          .map((h: PortfolioHolding) => ({
            currency: h.currency,
            balance: h.totalValue,
            symbol: h.symbol,
            walletType: h.walletType || 'portfolio',
            name: h.name,
          }));

        const normalizedPortfolio: Portfolio = {
          id: portfolioData.id || 'demo-portfolio',
          userId: portfolioData.userId || portfolioData.user_id || 'demo-user',
          name: portfolioData.name || 'My Portfolio',
          description: portfolioData.description,
          holdings: normalizedHoldings,
          totalValue,
          totalCost: portfolioData.totalCost || portfolioData.total_cost || 0,
          totalGainLoss: portfolioData.totalGainLoss || portfolioData.total_gain_loss || 0,
          totalGainLossPercentage: portfolioData.totalGainLossPercentage || portfolioData.total_gain_loss_percentage || 0,
          todayGainLoss,
          todayGainLossPercentage,
          currency: portfolioData.currency || 'USD',
          isDefault: portfolioData.isDefault || portfolioData.is_default || true,
          isActive: portfolioData.isActive || portfolioData.is_active || true,
          autoUpdate: portfolioData.autoUpdate || portfolioData.auto_update || true,
          lastPriceUpdateAt: portfolioData.lastPriceUpdateAt
            ? new Date(portfolioData.lastPriceUpdateAt)
            : portfolioData.last_price_update_at
              ? new Date(portfolioData.last_price_update_at)
              : undefined,
          metadata: portfolioData.metadata || {},
          createdAt: new Date(portfolioData.createdAt || portfolioData.created_at || Date.now()),
          updatedAt: new Date(portfolioData.updatedAt || portfolioData.updated_at || Date.now()),
          cashWallet: cashWallet.length > 0 ? cashWallet : undefined,
        };

        // ⚡ PERFORMANCE: Only update market prices when explicitly requested
        // This prevents slow external API calls on every page load
        if (options.updatePrices) {
          await this.updateHoldingsPrices(normalizedPortfolio.holdings);
          // Recalculate portfolio totals after price updates
          this.recalculatePortfolioTotals(normalizedPortfolio);
        }

        // Note: authenticated portfolio is NOT written to localStorage.
        // TanStack Query handles in-memory caching for real users.
        // localStorage is reserved for demo mode only (see saveDemoPortfolioToStorage).

        return {
          data: normalizedPortfolio,
          message: 'Portfolio retrieved successfully',
          success: true
        };
      }

      return response as ApiResponse<Portfolio>;
    } catch (error) {
      log.apiError('GET', '/portfolio/', error);
      // Re-throw so callers can handle the error properly.
      // Demo mode data is now handled at the hook level (usePortfolio),
      // not here, to prevent demo data from leaking into authenticated sessions.
      throw error;
    }
  }

  async addHolding(holdingData: CreateHoldingRequest | HoldingInput, options?: { aggregate?: boolean }): Promise<ApiResponse<PortfolioHolding>> {
    // Determine market from exchange if not provided
    const market = ('market' in holdingData) ? holdingData.market : this.getMarketFromExchange(holdingData.exchange);

    // Transform frontend camelCase to backend schema format with data sanitization
    const walletTypeValue = ('walletType' in holdingData && holdingData.walletType) ? holdingData.walletType : 'portfolio';

    const backendHolding = {
      symbol: String(holdingData.symbol || '').toUpperCase().trim(),
      name: String(holdingData.name || '').trim(),
      type: String(holdingData.type || 'stock'),
      quantity: Number(holdingData.quantity) || 0,
      average_cost: Number(holdingData.averageCost) || 0,  // Use snake_case for backend
      exchange: String(holdingData.exchange || '').toUpperCase().trim(),
      currency: String(holdingData.currency || 'USD').toUpperCase().trim(),
      market: String(market || 'US').toUpperCase(),
      sector: holdingData.sector ? String(holdingData.sector).trim() : undefined,
      region: ('region' in holdingData && holdingData.region) ? String(holdingData.region).trim() : this.getRegionFromMarket(market),
      wallet_type: walletTypeValue,
      purchase_date: ('purchaseDate' in holdingData && holdingData.purchaseDate) ? holdingData.purchaseDate : undefined,
      notes: ('notes' in holdingData && holdingData.notes) ? String(holdingData.notes).trim() : undefined,
    };

    try {
      // Backend will fetch current market price automatically
      // Remove undefined values to avoid sending them to backend
      (Object.keys(backendHolding) as Array<keyof typeof backendHolding>).forEach(key => {
        if (backendHolding[key] === undefined) {
          delete backendHolding[key];
        }
      });

      log.debug('Sending holding data to backend', backendHolding, 'PortfolioService');

      // Add aggregate query parameter (default false for CSV imports to create separate lots)
      const aggregate = options?.aggregate ?? false;
      const url = `/portfolio/holdings?aggregate=${aggregate}`;
      const response = await apiClient.post(url, backendHolding);
      log.debug('Backend response received', response, 'PortfolioService');

      // Backend returns the holding directly, not nested in holding/data
      if (response) {
        const responseData = response as unknown as Record<string, unknown>;
        const holdingResponse = (responseData.holding || response.data || response) as Record<string, unknown>;
        log.debug('Processing holding response', holdingResponse, 'PortfolioService');

        const normalizedHolding = this.normalizeHolding(holdingResponse);
        log.debug('Normalized holding', normalizedHolding, 'PortfolioService');

        // ⚡ PERFORMANCE: Keep localStorage for offline support, React Query will refetch anyway
        // Clearing would cause unnecessary localStorage operations

        return {
          data: normalizedHolding,
          message: 'Holding added successfully',
          success: true
        };
      }

      log.warn('No valid response received from backend', undefined, 'PortfolioService');
      return response;
    } catch (error) {
      log.error('Add holding error', error, 'PortfolioService');
      log.debug('Original holding data', holdingData, 'PortfolioService');
      log.debug('Transformed backend data', backendHolding, 'PortfolioService');

      // If the user is authenticated, surface the real error rather than silently
      // falling back to demo mode (which saves to localStorage and shows a false success).
      const session = await getSession().catch(() => null);
      if ((session as unknown as Record<string, unknown>)?.accessToken) {
        const message = (error as Error).message || 'Failed to add holding';
        log.error('Authenticated add_holding failed', { message }, 'PortfolioService');
        return { success: false, message, data: null as unknown as PortfolioHolding };
      }

      // Demo mode fallback - create mock holding
      const currentPrice = holdingData.averageCost * (1 + (Math.random() - 0.5) * 0.2); // ±10% variation
      const totalValue = holdingData.quantity * currentPrice;
      const totalCost = holdingData.quantity * holdingData.averageCost;
      const gainLoss = totalValue - totalCost;
      const gainLossPercentage = totalCost > 0 ? (gainLoss / totalCost) * 100 : 0;

      const mockHolding: PortfolioHolding = {
        id: `demo-holding-${Date.now()}`,
        userId: 'demo-user',
        symbol: holdingData.symbol.toUpperCase(),
        name: holdingData.name,
        type: holdingData.type as PortfolioHolding['type'],
        quantity: holdingData.quantity,
        averageCost: holdingData.averageCost,
        currentPrice,
        totalValue,
        totalCost,
        gainLoss,
        gainLossPercentage,
        currency: holdingData.currency,
        exchange: holdingData.exchange,
        market: market,
        sector: holdingData.sector,
        region: ('region' in holdingData) ? holdingData.region : this.getRegionFromMarket(market),
        walletType: (('walletType' in holdingData && holdingData.walletType) ? holdingData.walletType : 'portfolio') as 'portfolio' | 'emergency',
        lastUpdated: new Date(),
      };

      // Save to localStorage for demo mode persistence
      const existingHoldings = this.getDemoHoldingsFromStorage();
      const updatedHoldings = [...existingHoldings, mockHolding];
      this.saveDemoHoldingsToStorage(updatedHoldings);

      // Update the demo portfolio totals and save immediately
      let demoPortfolio = this.getDemoPortfolioFromStorage();
      if (!demoPortfolio) {
        demoPortfolio = await this.getDemoPortfolio();
      }
      demoPortfolio.holdings = updatedHoldings;
      this.recalculatePortfolioTotals(demoPortfolio);
      this.saveDemoPortfolioToStorage(demoPortfolio);

      log.debug('Demo holding saved to localStorage', { symbol: mockHolding.symbol }, 'PortfolioService');
      log.debug('Updated portfolio holdings count', { count: updatedHoldings.length }, 'PortfolioService');

      return {
        data: mockHolding,
        message: 'Demo holding created and saved to localStorage',
        success: true
      };
    }
  }

  async updateHolding(holdingData: UpdateHoldingRequest): Promise<ApiResponse<PortfolioHolding>> {
    const { id, ...updateData } = holdingData;

    try {
      // Transform frontend camelCase to backend snake_case
      const backendUpdate: Record<string, unknown> = {};
      Object.entries(updateData).forEach(([key, value]) => {
        if (value !== undefined) {
          let backendKey = key;
          if (key === 'averageCost') backendKey = 'average_cost';
          if (key === 'purchaseDate') backendKey = 'purchase_date';
          if (key === 'currentPrice') backendKey = 'current_price';
          // wallet_type is already in snake_case, keep it as is
          backendUpdate[backendKey] = value;
        }
      });

      const response = await apiClient.put(`/portfolio/holdings/${id}`, backendUpdate);

      const updateResp = response as unknown as Record<string, unknown>;
      if (updateResp.holding || response.data) {
        const holdingResponse = updateResp.holding || response.data;
        const normalizedHolding = this.normalizeHolding(holdingResponse as Record<string, unknown>);

        return {
          data: normalizedHolding,
          message: 'Holding updated successfully',
          success: true
        };
      }

      return response as ApiResponse<PortfolioHolding>;
    } catch (error) {
      log.apiError('PUT', `/portfolio/holdings/${id}`, error);

      // Demo mode fallback - update localStorage
      if (id.startsWith('demo-holding-')) {
        const existingHoldings = this.getDemoHoldingsFromStorage();
        const updatedHoldings = existingHoldings.map(holding => {
          if (holding.id === id) {
            // Update the holding with new values
            const updatedHolding = { ...holding };
            if (updateData.quantity !== undefined) updatedHolding.quantity = updateData.quantity;
            if (updateData.averageCost !== undefined) updatedHolding.averageCost = updateData.averageCost;
            if (updateData.currentPrice !== undefined) updatedHolding.currentPrice = updateData.currentPrice;

            // Recalculate derived values
            updatedHolding.totalValue = updatedHolding.quantity * updatedHolding.currentPrice;
            updatedHolding.gainLoss = updatedHolding.totalValue - (updatedHolding.quantity * updatedHolding.averageCost);
            updatedHolding.gainLossPercentage = updatedHolding.quantity * updatedHolding.averageCost > 0
              ? (updatedHolding.gainLoss / (updatedHolding.quantity * updatedHolding.averageCost)) * 100
              : 0;

            return updatedHolding;
          }
          return holding;
        });

        this.saveDemoHoldingsToStorage(updatedHoldings);

        // Update the demo portfolio totals
        const demoPortfolio = this.getDemoPortfolioFromStorage();
        if (demoPortfolio) {
          demoPortfolio.holdings = updatedHoldings;
          this.recalculatePortfolioTotals(demoPortfolio);
          this.saveDemoPortfolioToStorage(demoPortfolio);
        }

        // Find and return the updated holding
        const updatedHolding = updatedHoldings.find(h => h.id === id);
        if (updatedHolding) {
          return {
            data: updatedHolding,
            message: 'Demo holding updated in localStorage',
            success: true
          };
        }
      }

      throw error;
    }
  }

  async updateHoldingsBySymbol(symbol: string, updates: { name?: string; sector?: string }): Promise<ApiResponse<void>> {
    try {
      await apiClient.patch(`/portfolio/holdings/symbol/${symbol}`, updates);

      return {
        success: true,
        message: `Updated all ${symbol} holdings successfully`
      };
    } catch (error) {
      log.apiError('PATCH', `/portfolio/holdings/symbol/${symbol}`, error);
      throw error;
    }
  }

  /**
   * Time-weighted return of the default portfolio, in TWD, deposits taken out
   * (backend `twr.py`). Null when the endpoint has nothing to say.
   * `annualizedReturnPct` is null under a year of history — the backend will
   * not annualise a few months.
   */
  async getTimeWeightedReturn(): Promise<TimeWeightedReturn | null> {
    try {
      const response = await apiClient.get('/portfolio/performance/time-weighted-return');
      const raw = ((response as { data?: unknown })?.data ?? response) as Record<string, unknown> | null;
      if (!raw || typeof raw !== 'object') return null;
      const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
      const quality = (raw.data_quality ?? raw.dataQuality) as Record<string, unknown> | undefined;
      return {
        annualizedReturnPct: num(raw.annualized_return_percentage ?? raw.annualizedReturnPercentage),
        totalReturnPct: num(raw.total_return_percentage ?? raw.totalReturnPercentage),
        startDate: (raw.start_date ?? raw.startDate ?? null) as string | null,
        realPriceShare: num(quality?.real_price_share ?? quality?.realPriceShare),
      };
    } catch (error) {
      log.apiError('GET', '/portfolio/performance/time-weighted-return', error);
      return null;
    }
  }

  async recalculateIRR(): Promise<ApiResponse<Record<string, unknown>>> {
    try {
      const response = await apiClient.post('/portfolio/calculate-irr');

      return {
        data: response as unknown as Record<string, unknown>,
        success: true,
        message: 'IRR recalculated successfully'
      };
    } catch (error) {
      log.apiError('POST', '/portfolio/calculate-irr', error);
      // Don't throw - IRR calculation is non-critical
      return {
        success: false,
        message: 'Failed to recalculate IRR'
      };
    }
  }

  async deleteHolding(holdingId: string): Promise<ApiResponse<void>> {
    try {
      await apiClient.delete(`/portfolio/holdings/${holdingId}`);

      // ⚡ PERFORMANCE: Keep localStorage for offline support, React Query will refetch anyway

      return {
        success: true,
        message: 'Holding deleted successfully'
      };
    } catch (error) {
      log.apiError('DELETE', `/portfolio/holdings/${holdingId}`, error);

      // Demo mode fallback - remove from localStorage
      if (holdingId.startsWith('demo-holding-')) {
        const existingHoldings = this.getDemoHoldingsFromStorage();
        const updatedHoldings = existingHoldings.filter(holding => holding.id !== holdingId);
        this.saveDemoHoldingsToStorage(updatedHoldings);

        // Update the demo portfolio totals
        const demoPortfolio = this.getDemoPortfolioFromStorage();
        if (demoPortfolio) {
          demoPortfolio.holdings = updatedHoldings;
          this.recalculatePortfolioTotals(demoPortfolio);
          this.saveDemoPortfolioToStorage(demoPortfolio);
        }

        log.debug('Demo holding deleted from localStorage', { holdingId }, 'PortfolioService');

        return {
          success: true,
          message: 'Demo holding deleted from localStorage'
        };
      }

      throw error;
    }
  }

  async sellHolding(params: {
    holdingId: string;
    quantity: number;
    price?: number;
    fees?: number;
    taxes?: number;
    notes?: string;
    transactionDate?: string;
  }): Promise<ApiResponse<{
    transactionId: string;
    holdingId: string;
    symbol: string;
    quantitySold: number;
    salePrice: number;
    totalProceeds: number;
    fees: number;
    taxes: number;
    netProceeds: number;
    realizedGainLoss: number;
    realizedGainLossPercentage: number;
    remainingQuantity: number;
    cashWalletBalance: number;
    transactionDate: string;
  }>> {
    try {
      const response = await apiClient.post(`/portfolio/holdings/${params.holdingId}/sell`, {
        quantity: params.quantity,
        price: params.price,
        fees: params.fees || 0,
        taxes: params.taxes || 0,
        notes: params.notes,
        transaction_date: params.transactionDate,
      });

      if (response.success && response.data) {
        return {
          success: true,
          message: response.message || 'Holding sold successfully',
          data: {
            transactionId: (response.data as Record<string, unknown>).transaction_id as string,
            holdingId: (response.data as Record<string, unknown>).holding_id as string,
            symbol: (response.data as Record<string, unknown>).symbol as string,
            quantitySold: (response.data as Record<string, unknown>).quantity_sold as number,
            salePrice: (response.data as Record<string, unknown>).sale_price as number,
            totalProceeds: (response.data as Record<string, unknown>).total_proceeds as number,
            fees: (response.data as Record<string, unknown>).fees as number,
            taxes: (response.data as Record<string, unknown>).taxes as number,
            netProceeds: (response.data as Record<string, unknown>).net_proceeds as number,
            realizedGainLoss: (response.data as Record<string, unknown>).realized_gain_loss as number,
            realizedGainLossPercentage: (response.data as Record<string, unknown>).realized_gain_loss_percentage as number,
            remainingQuantity: (response.data as Record<string, unknown>).remaining_quantity as number,
            cashWalletBalance: (response.data as Record<string, unknown>).cash_wallet_balance as number,
            transactionDate: (response.data as Record<string, unknown>).transaction_date as string,
          }
        };
      }

      throw new Error('Invalid response from server');
    } catch (error) {
      log.apiError('POST', `/portfolio/holdings/${params.holdingId}/sell`, error);
      throw error;
    }
  }

  async getCashWallet(): Promise<ApiResponse<{
    wallets: Array<{
      portfolioId: string;
      currency: string;
      balance: number;
      symbol: string;
      walletType?: string;
      name?: string;
      lastUpdated: string;
    }>;
    totalWallets: number;
  }>> {
    try {
      // In demo mode, return mock data
      if (apiClient.mode === 'demo') {
        return {
          success: true,
          message: 'Demo cash wallet',
          data: {
            wallets: [
              {
                portfolioId: 'demo-portfolio',
                currency: 'TWD',
                balance: 50000,
                symbol: 'CASH-TWD',
                walletType: 'portfolio',
                name: 'Savings Cash',
                lastUpdated: new Date().toISOString(),
              }
            ],
            totalWallets: 1,
          }
        };
      }

      const response = await apiClient.get('/portfolio/cash-wallet');

      if (response.success && response.data) {
        return {
          success: true,
          message: response.message || 'Cash wallet retrieved successfully',
          data: {
            wallets: ((response.data as Record<string, unknown>).wallets as Record<string, unknown>[] | undefined)?.map((w) => ({
              portfolioId: w.portfolio_id as string,
              currency: w.currency as string,
              balance: w.balance as number,
              symbol: w.symbol as string,
              walletType: w.wallet_type as string | undefined,
              name: w.name as string | undefined,
              lastUpdated: w.last_updated as string,
            })) || [],
            totalWallets: ((response.data as Record<string, unknown>).total_wallets as number) || 0,
          }
        };
      }

      return {
        success: true,
        message: 'No cash wallet found',
        data: { wallets: [], totalWallets: 0 }
      };
    } catch (error) {
      log.apiError('GET', '/portfolio/cash-wallet', error);
      return {
        success: false,
        message: 'Failed to retrieve cash wallet',
        data: { wallets: [], totalWallets: 0 }
      };
    }
  }

  async searchStocks(query: string, market: MarketType = 'US'): Promise<ApiResponse<StockQuote[]>> {
    try {
      // Use market data service for stock search
      return await marketDataService.searchStocks(query, market);
    } catch (error) {
      log.apiError('GET', '/market-data/search', error);
      return {
        success: false,
        message: 'Failed to search stocks',
        data: []
      };
    }
  }

  async refreshPortfolioPrices(force: boolean = false): Promise<ApiResponse<{
    total: number;
    updated: number;
    cached: number;
    failed: number;
    by_market?: Record<string, Record<string, number>>;
  }>> {
    try {
      // Call backend smart price refresh endpoint
      // Use 2-minute timeout for price refresh (fetches from external APIs)
      const endpoint = `/portfolio/refresh-prices?force=${force}`;
      const response = await apiClient.post(endpoint, null, { timeout: 120000 });

      if (response.success && response.data) {
        log.info('Portfolio prices refreshed', response.data, 'PortfolioService');

        // Clear localStorage cache to force fresh fetch
        if (typeof window !== 'undefined') {
          localStorage.removeItem(this.DEMO_PORTFOLIO_KEY);
          localStorage.removeItem(this.DEMO_HOLDINGS_KEY);
        }

        return {
          data: response.data as {
            total: number; updated: number; cached: number; failed: number;
            by_market?: Record<string, Record<string, number>>;
          },
          message: response.message || 'Prices refreshed successfully',
          success: true
        };
      }

      return {
        success: false,
        message: 'Failed to refresh prices',
        data: { total: 0, updated: 0, cached: 0, failed: 0 }
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);

      // Re-throw rate-limit and real network errors so callers can handle them.
      // Only fall back to demo mode for 401 (unauthenticated) which is expected in demo.
      const isDemoMode = msg.includes('401') || msg.toLowerCase().includes('authentication required');
      if (!isDemoMode) {
        log.error('Refresh portfolio prices error', error, 'PortfolioService');
        throw error;
      }

      log.warn('Demo mode: refresh prices unavailable', error, 'PortfolioService');
      const demoHoldings = this.getDemoHoldingsFromStorage();
      return {
        success: true,
        message: 'Demo mode: Using cached prices',
        data: {
          total: demoHoldings.length,
          updated: 0,
          cached: demoHoldings.length,
          failed: 0
        }
      };
    }
  }

  async getPortfolioHistoricalData(days: number = 365): Promise<ApiResponse<Array<{
    date: string;
    value: number;
    holdings?: Array<{
      symbol: string;
      price: number;
      value: number;
    }>;
  }>>> {
    try {
      // Determine interval based on days for optimal data density
      let interval = 'monthly';
      if (days <= 30) {
        interval = 'daily';
      } else if (days <= 90) {
        interval = 'weekly';
      } else if (days <= 365) {
        interval = 'monthly';
      } else {
        interval = 'yearly';
      }

      log.debug('🔍 Fetching historical data', { days, interval }, 'PortfolioService');

      // Use new performance/historical endpoint
      const response = await apiClient.get(`/portfolio/performance/historical?interval=${interval}`);

      // Handle various response formats
      if (response && (response.success === true || response.data)) {
        const histData = response.data || response;

        if (Array.isArray(histData) && histData.length > 0) {
          log.debug('✅ Historical data fetched successfully', { dataPoints: histData.length }, 'PortfolioService');
          return {
            success: true,
            data: histData,
            message: 'Historical data retrieved successfully'
          };
        }
      }

      console.warn('⚠️ [Historical Data] No data available:', response);
      log.warn('No historical data available from API', undefined, 'PortfolioService');
      return {
        success: false,
        message: 'No historical data available',
        data: []
      };
    } catch (error) {
      console.error('❌ [Historical Data] Fetch error:', error);
      log.error('Portfolio historical data error', error, 'PortfolioService');
      return {
        success: false,
        message: 'Failed to fetch portfolio historical data',
        data: []
      };
    }
  }

  private async updateHoldingsPrices(holdings: PortfolioHolding[], forceRefresh: boolean = false): Promise<void> {
    // Try to fetch latest prices from our backend cache/db in a single bulk call.
    // Fallback to external marketDataService only for missing symbols or when forceRefresh is true.
    try {
      const uniqueSymbols = Array.from(new Set(holdings.map(h => h.symbol)));

      // If no symbols, nothing to do
      if (uniqueSymbols.length === 0) return;

      // If forceRefresh is requested, skip backend cache and go directly to marketDataService
      let backendPrices: Record<string, { close?: number; price?: number; lastUpdated?: string } | null> = {};
      if (!forceRefresh) {
        try {
          backendPrices = await priceService.getLatestPricesBulk(uniqueSymbols) as unknown as Record<string, { close?: number; price?: number; lastUpdated?: string } | null>;
        } catch (err) {
          log.warn('Backend bulk price fetch failed, falling back to external market data', err, 'PortfolioService');
          backendPrices = {};
        }
      }

      // Apply backend prices where available
      const missingSymbols: string[] = [];
      for (const holding of holdings) {
        const quote = backendPrices[holding.symbol];
        const latestPrice = quote?.close ?? quote?.price;
        if (quote && latestPrice !== undefined && latestPrice !== null) {
          this.applyLivePrice(holding, latestPrice, quote.lastUpdated ? new Date(quote.lastUpdated) : undefined);
        } else {
          // mark for external fetch
          if (!missingSymbols.includes(holding.symbol)) missingSymbols.push(holding.symbol);
        }
      }

      // If there are missing symbols (or forceRefresh), fetch them from external market provider grouped by market
      if (missingSymbols.length > 0) {
        // Group holdings that match the missing symbols by market to reuse marketDataService calls
        const holdingsByMarket = holdings
          .filter(h => missingSymbols.includes(h.symbol))
          .reduce((acc, holding) => {
            const market = (holding.market ?? 'US') as MarketType;
            if (!acc[market]) acc[market] = [];
            acc[market].push(holding);
            return acc;
          }, {} as Record<MarketType, PortfolioHolding[]>);

        for (const [market, marketHoldings] of Object.entries(holdingsByMarket)) {
          try {
            const marketDataRequests = marketHoldings.map(holding => ({ symbol: holding.symbol, market: market as MarketType }));
            const marketDataResponse = await marketDataService.getMultipleMarketData(marketDataRequests);

            if (marketDataResponse.success && marketDataResponse.data) {
              marketDataResponse.data.forEach(marketData => {
                const holding = marketHoldings.find(h => h.symbol === marketData.symbol);
                if (holding) {
                  this.applyLivePrice(holding, marketData.price, marketData.lastUpdated);
                }
              });
            }
          } catch (error) {
            log.warn(`Failed to update prices for ${market} market (external)`, error, 'PortfolioService');
          }
        }
      }
    } catch (err) {
      log.warn('Unexpected error updating holding prices', err, 'PortfolioService');
    }
  }

  /**
   * Apply a freshly fetched price to a holding and recompute every derived field.
   *
   * Day change has to be recomputed here against the retained previousClose —
   * normalizeHolding() derived it from the price the backend returned, so leaving
   * it alone makes the "% today" line disagree with the price shown right above it.
   */
  private applyLivePrice(holding: PortfolioHolding, price: number, lastUpdated?: Date): void {
    const costBasis = holding.quantity * holding.averageCost;

    holding.currentPrice = price;
    holding.totalValue = holding.quantity * price;
    holding.gainLoss = holding.totalValue - costBasis;
    holding.gainLossPercentage = costBasis > 0 ? (holding.gainLoss / costBasis) * 100 : 0;
    holding.lastUpdated = lastUpdated ?? new Date();

    const previousClose = holding.previousClose;
    if (previousClose != null && previousClose > 0) {
      holding.dayChange = (price - previousClose) * holding.quantity;
      holding.dayChangePercentage = ((price - previousClose) / previousClose) * 100;
    }
  }

  private recalculatePortfolioTotals(portfolio: Portfolio): void {
    // Every figure below is TWD, like the ones the backend sends for the same
    // fields. `holdings[]` carries native amounts, so each one converts before it
    // is added: summing them raw counted a US$1,000 position as NT$1,000, which
    // understated the portfolio and then flattered every percentage measured
    // against it — today's gain included, once that became a converted figure.
    const portfolioHoldings = portfolio.holdings.filter(h => !h.walletType || h.walletType === 'portfolio');
    portfolio.totalValue = portfolioHoldings.reduce(
      (sum, holding) => sum + toTWD(holding.totalValue, holding.currency || 'TWD'),
      0,
    );
    portfolio.totalCost = portfolioHoldings.reduce(
      (sum, holding) => sum + toTWD(holding.quantity * holding.averageCost, holding.currency || 'TWD'),
      0,
    );
    portfolio.totalGainLoss = portfolio.totalValue - portfolio.totalCost;
    portfolio.totalGainLossPercentage = portfolio.totalCost > 0 ? (portfolio.totalGainLoss / portfolio.totalCost) * 100 : 0;
    portfolio.lastPriceUpdateAt = new Date();

    // Today's gain, converted the same way.
    const holdingsWithDayChange = portfolio.holdings.filter(h => h.dayChange != null);
    portfolio.todayGainLoss = holdingsWithDayChange.reduce(
      (sum, h) => sum + toTWD(h.dayChange ?? 0, h.currency || 'TWD'),
      0,
    );
    portfolio.todayGainLossPercentage = portfolio.totalValue > 0 && holdingsWithDayChange.length > 0
      ? (portfolio.todayGainLoss / portfolio.totalValue) * 100
      : 0;

    // Rebuild cashWallet so the Available Cash stat card stays in sync
    const cashEntries = portfolio.holdings
      .filter(h => h.type === 'cash')
      .map(h => ({
        currency: h.currency,
        balance: h.totalValue,
        symbol: h.symbol,
        walletType: h.walletType || 'portfolio',
        name: h.name,
      }));
    portfolio.cashWallet = cashEntries.length > 0 ? cashEntries : undefined;
  }

  private normalizeHolding(holding: Record<string, unknown>): PortfolioHolding {
    const pf = (v: unknown): number => parseFloat(String(v ?? 0));
    const quantity = pf(holding.quantity);
    const averageCost = pf(holding.average_cost ?? holding.averageCost);
    const currentPrice = pf(holding.current_price ?? holding.currentPrice ?? averageCost);
    const totalValue = pf(holding.total_value ?? holding.totalValue ?? (quantity * currentPrice));
    const totalCost = pf(holding.total_cost ?? holding.totalCost ?? (quantity * averageCost));
    const gainLoss = pf(holding.gain_loss ?? holding.gainLoss ?? (totalValue - totalCost));
    const gainLossPercentage = pf(holding.gain_loss_percentage ?? holding.gainLossPercentage ?? (totalCost > 0 ? (gainLoss / totalCost) * 100 : 0));
    const irr = holding.irr !== null && holding.irr !== undefined ? pf(holding.irr) : undefined;

    // Daily change from previous close (backend sends camelCase alias "previousClose")
    const rawPrevClose = holding.previousClose ?? holding.previous_close;
    const previousClose = rawPrevClose != null ? pf(rawPrevClose) : undefined;
    const dayChange = previousClose != null && previousClose > 0
      ? (currentPrice - previousClose) * quantity
      : undefined;
    const dayChangePercentage = previousClose != null && previousClose > 0
      ? ((currentPrice - previousClose) / previousClose) * 100
      : undefined;

    // Debug sparkline data
    const sparklineData = holding.sparkline_data ?? holding.sparklineData;

    return {
      id: (holding.id as string) || `holding-${Date.now()}`,
      userId: (holding.userId ?? holding.user_id) as string | undefined,
      symbol: (holding.symbol as string) || '',
      name: (holding.name as string) || '',
      type: (holding.type as PortfolioHolding['type']) || 'stock',
      quantity,
      averageCost,
      currentPrice,
      totalValue,
      totalCost,
      gainLoss,
      gainLossPercentage,
      irr,
      currency: (holding.currency as string) || 'USD',
      exchange: (holding.exchange as string) || '',
      market: ((holding.market as string) || 'US') as MarketType,
      sector: holding.sector as string | undefined,
      region: holding.region as string | undefined,
      walletType: (((holding.wallet_type ?? holding.walletType) as string) || 'portfolio') as 'portfolio' | 'emergency',
      previousClose,
      dayChange,
      dayChangePercentage,
      purchaseDate: (holding.purchaseDate ?? holding.purchase_date) as string | undefined,
      manuallyPriced: Boolean(holding.manuallyPriced ?? holding.manually_priced),
      lastUpdated: new Date((holding.lastUpdated ?? holding.last_updated ?? holding.last_price_update_at ?? Date.now()) as string | number),
      priceHistory: (holding.priceHistory ?? holding.price_history) as PortfolioHolding['priceHistory'],
      sparklineData: sparklineData as PortfolioHolding['sparklineData'],
    };
  }

  private async getDemoPortfolio(): Promise<Portfolio> {
    // Create demo portfolio with sample holdings from different markets
    const demoHoldings: PortfolioHolding[] = [
      // US Stocks
      {
        id: 'demo-holding-aapl',
        userId: 'demo-user',
        symbol: 'AAPL',
        name: 'Apple Inc.',
        type: 'stock',
        quantity: 10,
        averageCost: 150.00,
        currentPrice: 175.50,
        totalValue: 1755.00,
        totalCost: 1500.00,
        gainLoss: 255.00,
        gainLossPercentage: 17.00,
        currency: 'USD',
        exchange: 'NASDAQ',
        market: 'US',
        sector: 'Technology',
        region: 'North America',
        walletType: 'portfolio',
        lastUpdated: new Date(),
      },
      {
        id: 'demo-holding-googl',
        userId: 'demo-user',
        symbol: 'GOOGL',
        name: 'Alphabet Inc.',
        type: 'stock',
        quantity: 5,
        averageCost: 135.00,
        currentPrice: 142.80,
        totalValue: 714.00,
        totalCost: 675.00,
        gainLoss: 39.00,
        gainLossPercentage: 5.78,
        currency: 'USD',
        exchange: 'NASDAQ',
        market: 'US',
        sector: 'Technology',
        region: 'North America',
        walletType: 'portfolio',
        lastUpdated: new Date(),
      },
      // Taiwan Stocks
      {
        id: 'demo-holding-2330',
        userId: 'demo-user',
        symbol: '2330',
        name: '台積電',
        type: 'stock',
        quantity: 100,
        averageCost: 500.00,
        currentPrice: 580.00,
        totalValue: 58000.00,
        totalCost: 50000.00,
        gainLoss: 8000.00,
        gainLossPercentage: 16.00,
        currency: 'TWD',
        exchange: 'TWSE',
        market: 'TW',
        sector: 'Technology',
        region: 'Asia Pacific',
        walletType: 'portfolio',
        lastUpdated: new Date(),
      },
      {
        id: 'demo-holding-2317',
        userId: 'demo-user',
        symbol: '2317',
        name: '鴻海',
        type: 'stock',
        quantity: 200,
        averageCost: 100.00,
        currentPrice: 108.50,
        totalValue: 21700.00,
        totalCost: 20000.00,
        gainLoss: 1700.00,
        gainLossPercentage: 8.50,
        currency: 'TWD',
        exchange: 'TWSE',
        market: 'TW',
        sector: 'Technology',
        region: 'Asia Pacific',
        walletType: 'portfolio',
        lastUpdated: new Date(),
      },
      // Crypto
      {
        id: 'demo-holding-btc',
        userId: 'demo-user',
        symbol: 'BTC',
        name: 'Bitcoin',
        type: 'crypto',
        quantity: 0.5,
        averageCost: 35000.00,
        currentPrice: 43500.00,
        totalValue: 21750.00,
        totalCost: 17500.00,
        gainLoss: 4250.00,
        gainLossPercentage: 24.29,
        currency: 'USDT',
        exchange: 'Binance',
        market: 'CRYPTO',
        region: 'Global',
        walletType: 'portfolio',
        lastUpdated: new Date(),
      },
      {
        id: 'demo-holding-eth',
        userId: 'demo-user',
        symbol: 'ETH',
        name: 'Ethereum',
        type: 'crypto',
        quantity: 2,
        averageCost: 2200.00,
        currentPrice: 2650.00,
        totalValue: 5300.00,
        totalCost: 4400.00,
        gainLoss: 900.00,
        gainLossPercentage: 20.45,
        currency: 'USDT',
        exchange: 'Binance',
        market: 'CRYPTO',
        region: 'Global',
        walletType: 'portfolio',
        lastUpdated: new Date(),
      },
    ];

    const totalValue = demoHoldings.reduce((sum, holding) => sum + holding.totalValue, 0);
    const totalCost = demoHoldings.reduce((sum, holding) => sum + (holding.quantity * holding.averageCost), 0);
    const totalGainLoss = totalValue - totalCost;
    const totalGainLossPercentage = totalCost > 0 ? (totalGainLoss / totalCost) * 100 : 0;

    return {
      id: 'demo-portfolio',
      userId: 'demo-user',
      name: 'My Investment Portfolio',
      description: 'Diversified portfolio across US, Taiwan, and Crypto markets',
      holdings: demoHoldings,
      totalValue,
      totalCost,
      totalGainLoss,
      totalGainLossPercentage,
      todayGainLoss: 0,
      todayGainLossPercentage: 0,
      currency: 'USD',
      isDefault: true,
      isActive: true,
      autoUpdate: true,
      lastPriceUpdateAt: new Date(),
      metadata: {
        demoMode: true,
        createdBy: 'system'
      },
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date(),
    };
  }

  getMarketAllocation(portfolio: Portfolio): Record<MarketType, { value: number; percentage: number; count: number }> {
    const allocation: Record<string, { value: number; percentage: number; count: number }> = {};

    // Calculate total in base currency (TWD) for accurate percentages
    let totalInBaseCurrency = 0;

    portfolio.holdings.forEach(holding => {
      const mkt = holding.market ?? 'US';
      if (!allocation[mkt]) {
        allocation[mkt] = { value: 0, percentage: 0, count: 0 };
      }
      // Convert to base currency using exchange rate
      const valueInBaseCurrency = holding.totalValue;
      allocation[mkt].value += valueInBaseCurrency;
      allocation[mkt].count += 1;
      totalInBaseCurrency += valueInBaseCurrency;
    });

    // Calculate percentages based on base currency total
    Object.keys(allocation).forEach(market => {
      allocation[market].percentage = totalInBaseCurrency > 0
        ? (allocation[market].value / totalInBaseCurrency) * 100
        : 0;
    });

    return allocation as Record<MarketType, { value: number; percentage: number; count: number }>;
  }

  getTopPerformers(portfolio: Portfolio, limit: number = 5): PortfolioHolding[] {
    return [...portfolio.holdings]
      .sort((a, b) => b.gainLossPercentage - a.gainLossPercentage)
      .slice(0, limit);
  }

  getWorstPerformers(portfolio: Portfolio, limit: number = 5): PortfolioHolding[] {
    return [...portfolio.holdings]
      .sort((a, b) => a.gainLossPercentage - b.gainLossPercentage)
      .slice(0, limit);
  }

  calculatePerformanceMetrics(portfolio: Portfolio): {
    oneDay: number;
    oneWeek: number;
    oneMonth: number;
    threeMonths: number;
    sixMonths: number;
    oneYear: number;
  } {
    // Calculate estimated performance based on current total gain/loss
    // This distributes the total gain/loss across time periods
    // More accurate than random data, but still an estimation without historical prices
    const basePerformance = portfolio.totalGainLossPercentage;

    return {
      oneDay: basePerformance * 0.003,     // ~0.3% of yearly performance
      oneWeek: basePerformance * 0.02,     // ~2% of yearly performance
      oneMonth: basePerformance * 0.08,    // ~8% of yearly performance
      threeMonths: basePerformance * 0.25, // 25% of yearly performance
      sixMonths: basePerformance * 0.50,   // 50% of yearly performance
      oneYear: basePerformance,            // Total current performance
    };
  }

  async getPortfolioAnalytics(): Promise<ApiResponse<{
    performance: {
      oneDay: number;
      oneWeek: number;
      oneMonth: number;
      threeMonths: number;
      sixMonths: number;
      oneYear: number;
    };
    allocation: {
      byType: Array<{ type: string; value: number; percentage: number; color: string }>;
      bySector: Array<{ sector: string; value: number; percentage: number; color: string }>;
      byRegion: Array<{ region: string; value: number; percentage: number; color: string }>;
      baseCurrency?: string;
      exchangeRate?: number;
    };
    topPerformers: PortfolioHolding[];
    worstPerformers: PortfolioHolding[];
    diversificationScore: number;
    riskScore: number;
    sharpeRatio?: number | null;
    beta?: number | null;
  }>> {
    try {
      // Try to fetch analytics from backend API
      const response = await apiClient.get('/portfolio/analytics');

      if (response && response.success !== false) {
        log.debug('Portfolio analytics fetched from backend', response, 'PortfolioService');
        type AnalyticsData = NonNullable<Awaited<ReturnType<typeof this.getPortfolioAnalytics>>['data']>;
        return {
          success: true,
          data: (response.data || response) as AnalyticsData,
          message: 'Analytics retrieved successfully'
        };
      }

      // Fallback: calculate locally if backend fails
      log.debug('Backend analytics failed, calculating locally', undefined, 'PortfolioService');
      const portfolioResponse = await this.getPortfolio();
      if (!portfolioResponse.success || !portfolioResponse.data) {
        throw new Error('Failed to get portfolio data');
      }

      const portfolio = portfolioResponse.data;
      const performance = this.calculatePerformanceMetrics(portfolio);
      const allocation = this.getMarketAllocation(portfolio);
      const topPerformers = this.getTopPerformers(portfolio);
      const worstPerformers = this.getWorstPerformers(portfolio);

      // Calculate diversification score (0-100)
      const uniqueTypes = new Set(portfolio.holdings.map(h => h.type)).size;
      const uniqueSectors = new Set(portfolio.holdings.map(h => h.sector)).size;
      const uniqueMarkets = new Set(portfolio.holdings.map(h => h.market)).size;
      const diversificationScore = Math.min(100, (uniqueTypes * 20 + uniqueSectors * 15 + uniqueMarkets * 25));

      // Calculate risk score based on volatility and concentration (0-100)
      const marketConcentration = Math.max(...Object.values(allocation).map(a => a.percentage));
      const riskScore = Math.min(100, marketConcentration + 20);

      return {
        success: true,
        data: {
          performance,
          allocation: {
            byType: Object.entries(allocation).map(([market, data], index) => ({
              type: market,
              value: data.value,
              percentage: data.percentage,
              color: ['#3B82F6', '#EF4444', '#F59E0B', '#10B981', '#8B5CF6', '#F97316'][index % 6]
            })),
            bySector: Object.entries(portfolio.holdings.reduce((acc, holding) => {
              const sector = holding.sector || 'Unknown';
              if (!acc[sector]) acc[sector] = { value: 0, count: 0 };
              // Convert to base currency (TWD) using exchange rate
              const valueInBaseCurrency = holding.totalValue;
              acc[sector].value += valueInBaseCurrency;
              acc[sector].count += 1;
              return acc;
            }, {} as Record<string, { value: number; count: number }>)).map(([sector, data], index) => {
              // Calculate total in base currency for accurate percentages
              const totalInBaseCurrency = portfolio.holdings.reduce((sum, h) =>
                sum + h.totalValue, 0);
              return {
                sector,
                value: data.value,
                percentage: totalInBaseCurrency > 0 ? (data.value / totalInBaseCurrency) * 100 : 0,
                color: ['#3B82F6', '#EF4444', '#F59E0B', '#10B981', '#8B5CF6', '#F97316'][index % 6]
              };
            }),
            byRegion: Object.entries(portfolio.holdings.reduce((acc, holding) => {
              const region = holding.region || 'Unknown';
              if (!acc[region]) acc[region] = { value: 0, count: 0 };
              // Convert to base currency (TWD) using exchange rate
              const valueInBaseCurrency = holding.totalValue;
              acc[region].value += valueInBaseCurrency;
              acc[region].count += 1;
              return acc;
            }, {} as Record<string, { value: number; count: number }>)).map(([region, data], index) => {
              // Calculate total in base currency for accurate percentages
              const totalInBaseCurrency = portfolio.holdings.reduce((sum, h) =>
                sum + h.totalValue, 0);
              return {
                region,
                value: data.value,
                percentage: totalInBaseCurrency > 0 ? (data.value / totalInBaseCurrency) * 100 : 0,
                color: ['#3B82F6', '#EF4444', '#F59E0B', '#10B981', '#8B5CF6', '#F97316'][index % 6]
              };
            })
          },
          topPerformers,
          worstPerformers,
          diversificationScore,
          riskScore
        }
      };
    } catch (error) {
      log.error('Portfolio analytics error', error, 'PortfolioService');

      // Last resort: return empty analytics
      return {
        success: false,
        message: 'Failed to calculate portfolio analytics'
      };
    }
  }

  async getHolding(holdingId: string): Promise<ApiResponse<PortfolioHolding>> {
    try {
      // For demo holdings, get from localStorage
      if (holdingId.startsWith('demo-holding-')) {
        const demoHoldings = this.getDemoHoldingsFromStorage();
        const holding = demoHoldings.find(h => h.id === holdingId);

        if (holding) {
          return {
            data: holding,
            message: 'Demo holding retrieved successfully',
            success: true
          };
        } else {
          return {
            success: false,
            message: 'Demo holding not found'
          };
        }
      }

      // For authenticated mode, fetch from API
      const response = await apiClient.get(`/portfolio/holdings/${holdingId}`);

      const getResp = response as unknown as Record<string, unknown>;
      if (getResp.holding || response.data) {
        const holdingResponse = (getResp.holding || response.data) as Record<string, unknown>;
        const normalizedHolding = this.normalizeHolding(holdingResponse);

        return {
          data: normalizedHolding,
          message: 'Holding retrieved successfully',
          success: true
        };
      }

      return {
        success: false,
        message: 'Holding not found'
      };
    } catch (error) {
      log.error('Get holding error', error, 'PortfolioService');
      return {
        success: false,
        message: 'Failed to fetch holding'
      };
    }
  }

  private getMarketFromExchange(exchange: string): MarketType {
    const exchangeToMarket: Record<string, MarketType> = {
      'TWSE': 'TW',
      'TPEx': 'TW',
      'SGX': 'SG',
      'NYSE': 'US',
      'NASDAQ': 'US',
      'LSE': 'US',
      'HKEX': 'HK',
      'TSE': 'JP',
      'KLSE': 'SG',
      'SET': 'SG',
      'Binance': 'CRYPTO',
      'Crypto': 'CRYPTO',
      'Multiple': 'CRYPTO'
    };
    return exchangeToMarket[exchange] || 'US';
  }

  private getRegionFromMarket(market: MarketType): string {
    const marketToRegion: Record<MarketType, string> = {
      'US': 'North America',
      'TW': 'Asia Pacific',
      'HK': 'Asia Pacific',
      'SG': 'Asia Pacific',
      'JP': 'Asia Pacific',
      'CRYPTO': 'Global'
    };
    return marketToRegion[market] || 'Global';
  }

  async getDailyPerformance(days: number = 30): Promise<ApiResponse<Array<{
    date: string;
    value: number;
    change: number;
    changePercent: number;
    topHoldings?: Array<{
      symbol: string;
      change: number;
      value: number;
    }>;
  }>>> {
    try {
      log.debug('🔍 Fetching daily performance', { days }, 'PortfolioService');

      const response = await apiClient.get(`/portfolio/daily-performance?days=${days}`);

      // Handle various response formats
      if (response) {
        const dailyData = response.data || (Array.isArray(response) ? response : []);

        if (Array.isArray(dailyData) && dailyData.length > 0) {
          log.debug('✅ Daily performance fetched from backend', { days, dataPoints: dailyData.length }, 'PortfolioService');

          // Normalize data to ensure correct numeric types
          const normalizedData = dailyData.map((item: Record<string, unknown>) => ({
            date: item.date as string,
            value: Number(item.value) || 0,
            costBasis: item.costBasis != null ? Number(item.costBasis) : undefined,
            change: Number(item.change) || 0,
            changePercent: Number(item.changePercent ?? item.change_percent) || 0,
            capitalAdded: Number(item.capitalAdded ?? item.capital_added) || 0,
            purchases: (item.purchases as unknown[]) || [],
            topHoldings: (item.topHoldings as unknown[]) || [] // Preserve topHoldings data
          }));

          return {
            success: true,
            data: normalizedData as { date: string; value: number; change: number; changePercent: number; topHoldings?: { symbol: string; change: number; value: number }[] }[],
            message: response.message || 'Daily performance retrieved successfully'
          };
        }
      }

      console.warn('⚠️ [Daily Performance] No data available:', response);
      log.warn('No daily performance data available', undefined, 'PortfolioService');
      return {
        success: false,
        data: [],
        message: 'No daily performance data available'
      };
    } catch (error: unknown) {
      console.error('❌ [Daily Performance] Fetch error:', error);
      log.error('Error fetching daily performance', error, 'PortfolioService');
      return {
        success: false,
        data: [],
        message: error instanceof Error ? error.message : 'Failed to fetch daily performance'
      };
    }
  }

  /**
   * Get sparkline data for a symbol (lightweight historical prices)
   */
  async getSparklineData(symbol: string, days: number = 30): Promise<number[]> {
    try {
      const response = await apiClient.get<ApiResponse<{
        symbol: string;
        days: number;
        prices: number[];
        start_date: string;
        end_date: string;
      }>>(`/portfolio/historical-prices/${symbol}/sparkline?days=${days}`);

      if (response.data?.success && response.data?.data) {
        return (response.data.data as { prices?: number[] }).prices || [];
      }

      return [];
    } catch (error) {
      console.warn(`Failed to fetch sparkline data for ${symbol}:`, error);
      return []; // Return empty array on error for graceful fallback
    }
  }

  /**
   * Get full historical OHLCV price data for a single symbol (for detail/trend page)
   */
  async getHistoricalPrices(symbol: string, days: number = 90): Promise<Array<{
    date: string;
    open: number | null;
    high: number | null;
    low: number | null;
    close: number;
    volume: number | null;
    currency: string;
  }>> {
    try {
      const response = await apiClient.get<{
        symbol: string;
        start_date: string;
        end_date: string;
        count: number;
        prices: Array<{
          date: string;
          open: number | null;
          high: number | null;
          low: number | null;
          close: number;
          volume: number | null;
          currency: string;
          source: string;
        }>;
      }>(`/portfolio/historical-prices/${symbol}?days=${days}`);

      // apiClient returns { success, data, message } — data is the payload
      const payload = (response as unknown as Record<string, unknown>).data as { prices?: Array<{ date: string; open: number | null; high: number | null; low: number | null; close: number; volume: number | null; currency: string }> } | undefined;
      if (payload?.prices) {
        return payload.prices;
      }
      return [];
    } catch (error) {
      console.warn(`Failed to fetch historical prices for ${symbol}:`, error);
      return [];
    }
  }

  /**
   * Get benchmark historical data normalized to % return from period start.
   * Used for portfolio vs benchmark comparison chart.
   */
  async getBenchmarkData(symbol: string, days: number = 365): Promise<{
    symbol: string;
    name: string;
    color: string;
    points: Array<{ date: string; close: number; returnPct: number }>;
  } | null> {
    try {
      const response = await apiClient.get(`/portfolio/benchmark?symbol=${encodeURIComponent(symbol)}&days=${days}`);
      const payload = response as unknown as Record<string, unknown>;
      if (payload?.success && payload?.data) {
        return payload.data as { symbol: string; name: string; color: string; points: Array<{ date: string; close: number; returnPct: number }> };
      }
      // Surface the backend message (e.g. "invalid ticker") to the caller
      if (payload?.message) {
        throw new Error(payload.message as string);
      }
      return null;
    } catch (error) {
      console.warn(`Failed to fetch benchmark data for ${symbol}:`, error);
      throw error; // re-throw so React Query's onError / isError can handle it
    }
  }

  async getRiskMetrics(): Promise<{
    cagr: number | null;
    cagrPercentage: number | null;
    maxDrawdown: number | null;
    maxDrawdownPercentage: number | null;
    annualizedVolatility: number | null;
    annualizedVolatilityPercentage: number | null;
    sharpeRatio: number | null;
    hhi: number | null;
    hhiLabel: string;
    beta: number | null;
    alpha: number | null;
    alphaPercentage: number | null;
    benchmarkSymbol: string;
    riskFreeRate: number;
    dataDays: number;
    hasHistoricalData: boolean;
  } | null> {
    try {
      const response = await apiClient.get('/portfolio/risk-metrics') as unknown as Record<string, unknown>;
      if (response?.success && response?.data) {
        const d = response.data as Record<string, unknown>;
        return {
          cagr: (d.cagr as number | null) ?? null,
          cagrPercentage: (d.cagr_percentage as number | null) ?? null,
          maxDrawdown: (d.max_drawdown as number | null) ?? null,
          maxDrawdownPercentage: (d.max_drawdown_percentage as number | null) ?? null,
          annualizedVolatility: (d.annualized_volatility as number | null) ?? null,
          annualizedVolatilityPercentage: (d.annualized_volatility_percentage as number | null) ?? null,
          sharpeRatio: (d.sharpe_ratio as number | null) ?? null,
          hhi: (d.hhi as number | null) ?? null,
          hhiLabel: (d.hhi_label as string) || 'Unknown',
          beta: (d.beta as number | null) ?? null,
          alpha: (d.alpha as number | null) ?? null,
          alphaPercentage: (d.alpha_percentage as number | null) ?? null,
          benchmarkSymbol: (d.benchmark_symbol as string) || 'SPY',
          riskFreeRate: (d.risk_free_rate as number) ?? 0.04,
          dataDays: (d.data_days as number) ?? 0,
          hasHistoricalData: (d.has_historical_data as boolean) ?? false,
        };
      }
      return null;
    } catch {
      return null;
    }
  }

  async getDividendIncome(period: string = '1y'): Promise<{
    totalDividends: number | null;
    dividendYield: number | null;
    projectedAnnual: number | null;
    yieldOnCost: number | null;
    yieldOnValue: number | null;
    payments: Array<{
      date: string;
      symbol: string;
      amount: number;
      currency: string;
      shares: number;
      perShare: number;
    }>;
  } | null> {
    try {
      const response = await apiClient.get(`/portfolio/dividends?period=${period}`) as unknown as Record<string, unknown>;
      if (response?.success && response?.data) {
        const d = response.data as Record<string, unknown>;
        const rawPayments = (d.payments as Record<string, unknown>[]) ?? [];
        return {
          totalDividends: (d.total_dividends as number | null) ?? null,
          dividendYield: (d.dividend_yield as number | null) ?? null,
          projectedAnnual: (d.projected_annual as number | null) ?? null,
          yieldOnCost: (d.yield_on_cost as number | null) ?? null,
          yieldOnValue: (d.yield_on_value as number | null) ?? null,
          payments: rawPayments.map(p => ({
            date: p.date as string,
            symbol: p.symbol as string,
            amount: p.amount as number,
            currency: p.currency as string,
            shares: (p.shares as number) ?? 0,
            perShare: (p.per_share as number) ?? 0,
          })),
        };
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Total realized profit/loss from completed sells (FIFO capital gains).
   * Returns null on error so callers can simply hide the figure.
   */
  async getRealizedPnl(): Promise<{ realizedGainLoss: number; realizedCount: number } | null> {
    try {
      const response = (await apiClient.get('/portfolio/realized-pnl')) as unknown as Record<string, unknown>;
      if (response?.success && response?.data) {
        const d = response.data as Record<string, unknown>;
        return {
          realizedGainLoss: (d.realized_gain_loss as number) ?? 0,
          realizedCount: (d.realized_count as number) ?? 0,
        };
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Sync historical price data for all holdings
   * This populates the database with historical prices needed for daily performance charts
   */
  async syncHistoricalPrices(days: number = 90): Promise<ApiResponse<{
    totalSymbols: number;
    successful: number;
    failed: number;
    cached: number;
    totalRecords: number;
  }>> {
    try {
      log.info('Syncing historical prices', { days }, 'PortfolioService');

      // Use 3-minute timeout for historical sync (fetches from external APIs)
      const response = await apiClient.post<{
        total_symbols: number;
        successful: number;
        failed: number;
        cached: number;
        total_records: number;
        details?: Record<string, unknown>[];
      }>(`/portfolio/sync-historical-prices?days=${days}`, {}, { timeout: 180000 });

      // Backend returns data directly (not wrapped in ApiResponse for this endpoint)
      const data = response.data;

      if (data && typeof data.total_symbols === 'number') {
        log.info('Historical prices synced successfully', {
          successful: data.successful,
          cached: data.cached,
          failed: data.failed
        }, 'PortfolioService');

        return {
          success: true,
          data: {
            totalSymbols: data.total_symbols,
            successful: data.successful,
            failed: data.failed,
            cached: data.cached,
            totalRecords: data.total_records
          },
          message: `Historical data synced for ${data.successful + data.cached} symbols`
        };
      }

      // Unexpected response format
      console.error('[PortfolioService] Unexpected response format:', data);
      return {
        success: false,
        data: {
          totalSymbols: 0,
          successful: 0,
          failed: 0,
          cached: 0,
          totalRecords: 0
        },
        message: 'Unexpected response format from server'
      };
    } catch (error: unknown) {
      log.error('Error syncing historical prices', error, 'PortfolioService');

      // Extract detailed error message
      let errorMessage = 'Failed to sync historical data';
      const errObj = error as { response?: { data?: { detail?: string; message?: string }; status?: number; statusText?: string }; message?: string };
      if (errObj.response?.data?.detail) {
        errorMessage = errObj.response.data.detail;
      } else if (errObj.response?.data?.message) {
        errorMessage = errObj.response.data.message;
      } else if (errObj.message) {
        errorMessage = errObj.message;
      }

      console.error('[PortfolioService] Sync error details:', {
        status: errObj.response?.status,
        statusText: errObj.response?.statusText,
        detail: errObj.response?.data?.detail,
        message: errObj.response?.data?.message,
        fullError: error
      });

      return {
        success: false,
        data: {
          totalSymbols: 0,
          successful: 0,
          failed: 0,
          cached: 0,
          totalRecords: 0
        },
        message: errorMessage
      };
    }
  }

  /**
   * Fetch current exchange rates from backend API
   * @param baseCurrency - Base currency for rates (default: TWD)
   * @returns Exchange rates object with timestamp
   */
  async getExchangeRates(baseCurrency: string = 'TWD'): Promise<ExchangeRatesResponse> {
    try {
      // `apiClient.get<T>` already returns the ApiResponse envelope — it is not
      // axios, so there is no outer `.data` holding the body. This read
      // `response.data.success` and typed the call as ApiResponse<ApiResponse<T>>,
      // so the check never passed and the method always threw. Nothing called
      // it, so nothing noticed.
      const response = await apiClient.get<ExchangeRatesResponse>(
        `/portfolio/exchange-rates?base_currency=${baseCurrency}`
      );

      if (response.success && response.data) {
        return response.data;
      }

      throw new Error(response.message || 'Failed to fetch exchange rates');
    } catch (error: unknown) {
      log.error('Error fetching exchange rates', error, 'PortfolioService');
      // Rethrow. This used to swallow the error and return a hardcoded table —
      // a third copy of the same stale numbers, in the shape of a successful
      // response, so a caller could not tell a real rate from a guess made in a
      // catch block. Resolving on failure also made the caller's `retry`
      // unreachable: a transient blip became an hour of no conversion, because
      // nothing ever rejected for React Query to retry.
      //
      // Callers treat an absent rate as "not priced" and show the native
      // currency alone, which is the honest rendering of a failed fetch.
      throw error instanceof Error ? error : new Error('Failed to fetch exchange rates');
    }
  }
  async downloadCSV(dateFrom?: string, dateTo?: string): Promise<void> {
    const { getSession } = await import('next-auth/react');
    // Request XLSX so spreadsheet apps receive proper cell formatting:
    // StockID forced as text (preserves leading zeros like 0050, 006208),
    // numeric columns right-aligned as numbers.
    const params = new URLSearchParams({ format: 'xlsx' });
    if (dateFrom) params.append('date_from', dateFrom);
    if (dateTo) params.append('date_to', dateTo);

    const baseUrl = getPublicApiUrl();
    const url = `${baseUrl}/portfolio/export?${params.toString()}`;

    const headers: Record<string, string> = { 'ngrok-skip-browser-warning': 'true' };
    try {
      const session = await getSession();
      const token = (session as unknown as Record<string, unknown>)?.accessToken;
      if (token) headers['Authorization'] = `Bearer ${token}`;
    } catch { /* no session */ }

    const response = await fetch(url, { headers });
    if (!response.ok) throw new Error(`Export failed: ${response.status}`);

    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = `portfolio_${dateFrom ?? 'all'}_${dateTo ?? 'time'}.xlsx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(objectUrl);
  }

  /**
   * Download the blank import template as XLSX from the backend.
   * Served as XLSX (not a client-side CSV) so the StockID column is text-formatted —
   * Excel keeps leading-zero Taiwan tickers (e.g. 0050) instead of coercing them to 50.
   */
  async downloadTemplate(): Promise<void> {
    const { getSession } = await import('next-auth/react');
    const baseUrl = getPublicApiUrl();
    const url = `${baseUrl}/portfolio/template`;

    const headers: Record<string, string> = { 'ngrok-skip-browser-warning': 'true' };
    try {
      const session = await getSession();
      const token = (session as unknown as Record<string, unknown>)?.accessToken;
      if (token) headers['Authorization'] = `Bearer ${token}`;
    } catch { /* no session */ }

    const response = await fetch(url, { headers });
    if (!response.ok) throw new Error(`Template download failed: ${response.status}`);

    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = 'portfolio_template.xlsx';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(objectUrl);
  }
}

export const portfolioService = new PortfolioService();