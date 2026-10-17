/**
 * portfolioService's offline / demo-mode fallbacks.
 *
 * This suite used to drive a flow that no longer exists: it called
 * getPortfolio() after a failed request and expected demo holdings back. That
 * fallback was deliberately removed — getPortfolio() now re-throws so demo data
 * can never be served into an authenticated session — and the tests only ever
 * "reached" the demo path because the global fetch stub returned undefined and
 * crashed inside the service. Both of those are asserted directly below.
 *
 * What still has a demo fallback is the write path: addHolding and
 * deleteHolding persist to localStorage when the request fails and no session
 * is present.
 */

import { portfolioService } from '../services/portfolioService';

const DEMO_HOLDINGS_KEY = 'aspiro_demo_holdings';

const newHolding = {
  symbol: 'TEST',
  name: 'Test Company',
  type: 'stock' as const,
  quantity: 100,
  averageCost: 50.0,
  currency: 'USD',
  exchange: 'NASDAQ',
  sector: 'Technology',
};

function storedDemoHoldings() {
  return JSON.parse(localStorage.getItem(DEMO_HOLDINGS_KEY) ?? '[]');
}

describe('portfolioService — offline demo fallbacks', () => {
  beforeEach(() => {
    localStorage.clear();
    // The demo path is only reachable when the backend call fails. Reject
    // explicitly so it is the thing under test, not a side effect of a crash.
    (global.fetch as jest.Mock).mockRejectedValue(new Error('offline: demo mode'));
  });

  describe('getPortfolio', () => {
    it('re-throws instead of serving demo data when the request fails', async () => {
      // The guard that keeps demo holdings out of an authenticated session:
      // a read failure must surface, never silently resolve to fixtures.
      await expect(portfolioService.getPortfolio()).rejects.toThrow();
    });
  });

  describe('addHolding', () => {
    it('returns a demo holding built from the submitted values', async () => {
      const response = await portfolioService.addHolding(newHolding);

      expect(response.success).toBe(true);
      expect(response.data!.symbol).toBe('TEST');
      expect(response.data!.quantity).toBe(100);
      expect(response.data!.averageCost).toBe(50.0);
      expect(response.data!.id).toMatch(/^demo-holding-/);
    });

    it('derives totalCost from quantity × averageCost', async () => {
      const { data } = await portfolioService.addHolding(newHolding);
      expect(data!.totalCost).toBe(5000);
      expect(data!.totalValue).toBeCloseTo(data!.quantity * data!.currentPrice, 6);
    });

    it('persists each holding to localStorage, accumulating across calls', async () => {
      await portfolioService.addHolding({ ...newHolding, symbol: 'PERSIST1' });
      await portfolioService.addHolding({ ...newHolding, symbol: 'PERSIST2' });

      const symbols = storedDemoHoldings().map((h: { symbol: string }) => h.symbol);
      expect(symbols).toEqual(['PERSIST1', 'PERSIST2']);
    });

    it('upper-cases the symbol', async () => {
      const { data } = await portfolioService.addHolding({ ...newHolding, symbol: 'tsla' });
      expect(data!.symbol).toBe('TSLA');
    });
  });

  describe('deleteHolding', () => {
    it('removes a demo holding from localStorage', async () => {
      const { data: added } = await portfolioService.addHolding(newHolding);
      expect(storedDemoHoldings()).toHaveLength(1);

      const response = await portfolioService.deleteHolding(added!.id);

      expect(response.success).toBe(true);
      expect(storedDemoHoldings()).toHaveLength(0);
    });

    it('leaves other demo holdings in place', async () => {
      const { data: first } = await portfolioService.addHolding({ ...newHolding, symbol: 'KEEP' });
      // Timestamped ids collide when two adds land in the same millisecond.
      await new Promise((resolve) => setTimeout(resolve, 2));
      const { data: second } = await portfolioService.addHolding({ ...newHolding, symbol: 'DROP' });

      await portfolioService.deleteHolding(second!.id);

      const remaining = storedDemoHoldings();
      expect(remaining).toHaveLength(1);
      expect(remaining[0].id).toBe(first!.id);
      expect(remaining[0].symbol).toBe('KEEP');
    });
  });
});
