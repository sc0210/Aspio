import { apiClient } from '@/lib/api-client';

export interface SymbolQuote {
  symbol: string;
  name: string | null;
  market: 'TW' | 'US' | 'CRYPTO';
  exchange: string;
  currency: string;
  current_price: number | null;
  market_open: boolean;
  last_updated: string;
  status: 'success' | 'no_data';
}

export interface PopularSymbol {
  symbol: string;
  name: string;
  type: 'stock' | 'etf' | 'crypto';
  market: 'TW' | 'US' | 'CRYPTO';
}

class SymbolService {
  /**
   * Get current quote for a symbol
   */
  async getQuote(symbol: string, market?: string): Promise<SymbolQuote> {
    try {
      const url = market ? `/portfolio/symbol/quote/${symbol}?market=${market}` : `/portfolio/symbol/quote/${symbol}`;
      const response = await apiClient.get<SymbolQuote>(url);
      return response.data as SymbolQuote;
    } catch (error) {
      console.error(`Failed to fetch quote for ${symbol}:`, error);
      throw error;
    }
  }

  /**
   * Get popular symbols for quick selection
   */
  async getPopularSymbols(market?: 'TW' | 'US' | 'CRYPTO' | 'ALL'): Promise<PopularSymbol[]> {
    try {
      const url = market ? `/portfolio/symbol/popular?market=${market}` : '/portfolio/symbol/popular';
      const response = await apiClient.get<PopularSymbol[]>(url);
      return (response.data ?? []) as PopularSymbol[];
    } catch (error) {
      console.error('Failed to fetch popular symbols:', error);
      throw error;
    }
  }

  /**
   * Validate if a symbol exists and get its metadata
   */
  async validateSymbol(symbol: string): Promise<{ valid: boolean; quote?: SymbolQuote }> {
    try {
      const quote = await this.getQuote(symbol);
      return {
        valid: quote.status === 'success' && quote.current_price !== null,
        quote,
      };
    } catch {
      return { valid: false };
    }
  }

  /**
   * Search for symbols by query string
   */
  async searchSymbol(query: string): Promise<{ success: boolean; data: PopularSymbol[] }> {
    try {
      const popular = await this.getPopularSymbols('ALL');
      const q = query.toLowerCase();
      const filtered = popular.filter(
        s => s.symbol.toLowerCase().includes(q) || (s.name || '').toLowerCase().includes(q)
      );
      return { success: true, data: filtered };
    } catch (error) {
      console.error('Failed to search symbols:', error);
      return { success: false, data: [] };
    }
  }

  /**
   * Get quotes for multiple symbols at once
   */
  async getQuotes(symbols: string[]): Promise<Map<string, SymbolQuote>> {
    const quoteMap = new Map<string, SymbolQuote>();

    // Fetch quotes in parallel
    const promises = symbols.map(symbol =>
      this.getQuote(symbol)
        .then(quote => quoteMap.set(symbol, quote))
        .catch(err => console.error(`Failed to fetch quote for ${symbol}:`, err))
    );

    await Promise.all(promises);
    return quoteMap;
  }
}

const symbolService = new SymbolService();
export default symbolService;
