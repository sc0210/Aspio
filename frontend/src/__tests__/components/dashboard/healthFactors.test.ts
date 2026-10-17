/**
 * Pure logic tests for the healthFactors / healthScore calculation
 * from ComprehensiveDashboard's useMemo block.
 *
 * The formulas are replicated here so the logic can be tested independently
 * of the React component and all its dependencies.
 */

interface HealthStats {
  monthlyIncome: number;
  monthlyExpenses: number;
  savingsRate: number;
  investment_total: number;
  total_asset: number;
  emergency_wallet: number;
}

function computeHealthFactors(stats: HealthStats) {
  const investRatio = stats.total_asset > 0 ? stats.investment_total / stats.total_asset : 0;
  const emergencyMonths = stats.monthlyExpenses > 0 ? stats.emergency_wallet / stats.monthlyExpenses : 0;
  return [
    { label: 'Cash flow', ok: stats.monthlyIncome > stats.monthlyExpenses },
    { label: 'Savings', ok: (stats.savingsRate ?? 0) >= 10 },
    { label: 'Investing', ok: investRatio >= 0.2 },
    { label: 'Emergency', ok: emergencyMonths >= 3 },
  ];
}

function computeHealthScore(factors: { ok: boolean }[]) {
  return Math.round(50 + factors.filter(f => f.ok).length * 12.5);
}

describe('healthFactors logic', () => {
  describe('Cash flow factor', () => {
    it('is ok when income > expenses', () => {
      const factors = computeHealthFactors({
        monthlyIncome: 80000, monthlyExpenses: 50000,
        savingsRate: 37.5, investment_total: 0, total_asset: 0, emergency_wallet: 0,
      });
      expect(factors.find(f => f.label === 'Cash flow')!.ok).toBe(true);
    });

    it('is not ok when income === expenses', () => {
      const factors = computeHealthFactors({
        monthlyIncome: 50000, monthlyExpenses: 50000,
        savingsRate: 0, investment_total: 0, total_asset: 0, emergency_wallet: 0,
      });
      expect(factors.find(f => f.label === 'Cash flow')!.ok).toBe(false);
    });

    it('is not ok when income < expenses', () => {
      const factors = computeHealthFactors({
        monthlyIncome: 40000, monthlyExpenses: 50000,
        savingsRate: -25, investment_total: 0, total_asset: 0, emergency_wallet: 0,
      });
      expect(factors.find(f => f.label === 'Cash flow')!.ok).toBe(false);
    });
  });

  describe('Savings factor (threshold: 10%)', () => {
    it('is ok when savingsRate >= 10', () => {
      const factors = computeHealthFactors({
        monthlyIncome: 0, monthlyExpenses: 0, savingsRate: 10,
        investment_total: 0, total_asset: 0, emergency_wallet: 0,
      });
      expect(factors.find(f => f.label === 'Savings')!.ok).toBe(true);
    });

    it('is ok at exactly 10%', () => {
      const factors = computeHealthFactors({
        monthlyIncome: 0, monthlyExpenses: 0, savingsRate: 10,
        investment_total: 0, total_asset: 0, emergency_wallet: 0,
      });
      expect(factors.find(f => f.label === 'Savings')!.ok).toBe(true);
    });

    it('is not ok when savingsRate < 10', () => {
      const factors = computeHealthFactors({
        monthlyIncome: 0, monthlyExpenses: 0, savingsRate: 9.9,
        investment_total: 0, total_asset: 0, emergency_wallet: 0,
      });
      expect(factors.find(f => f.label === 'Savings')!.ok).toBe(false);
    });

    it('treats undefined/null savingsRate as 0', () => {
      const factors = computeHealthFactors({
        monthlyIncome: 0, monthlyExpenses: 0, savingsRate: undefined as never,
        investment_total: 0, total_asset: 0, emergency_wallet: 0,
      });
      expect(factors.find(f => f.label === 'Savings')!.ok).toBe(false);
    });
  });

  describe('Investing factor (threshold: 20% of total assets)', () => {
    it('is ok when investment_total / total_asset >= 0.2', () => {
      const factors = computeHealthFactors({
        monthlyIncome: 0, monthlyExpenses: 0, savingsRate: 0,
        investment_total: 20000, total_asset: 100000, emergency_wallet: 0,
      });
      expect(factors.find(f => f.label === 'Investing')!.ok).toBe(true);
    });

    it('is ok at exactly 20%', () => {
      const factors = computeHealthFactors({
        monthlyIncome: 0, monthlyExpenses: 0, savingsRate: 0,
        investment_total: 20000, total_asset: 100000, emergency_wallet: 0,
      });
      expect(factors.find(f => f.label === 'Investing')!.ok).toBe(true);
    });

    it('is not ok when investRatio < 0.2', () => {
      const factors = computeHealthFactors({
        monthlyIncome: 0, monthlyExpenses: 0, savingsRate: 0,
        investment_total: 10000, total_asset: 100000, emergency_wallet: 0,
      });
      expect(factors.find(f => f.label === 'Investing')!.ok).toBe(false);
    });

    it('is not ok when total_asset is 0 (avoids divide-by-zero)', () => {
      const factors = computeHealthFactors({
        monthlyIncome: 0, monthlyExpenses: 0, savingsRate: 0,
        investment_total: 50000, total_asset: 0, emergency_wallet: 0,
      });
      expect(factors.find(f => f.label === 'Investing')!.ok).toBe(false);
    });
  });

  describe('Emergency factor (threshold: 3 months of expenses)', () => {
    it('is ok when emergency_wallet covers >= 3 months of expenses', () => {
      const factors = computeHealthFactors({
        monthlyIncome: 0, monthlyExpenses: 30000, savingsRate: 0,
        investment_total: 0, total_asset: 0, emergency_wallet: 90000,
      });
      expect(factors.find(f => f.label === 'Emergency')!.ok).toBe(true);
    });

    it('is ok at exactly 3 months', () => {
      const factors = computeHealthFactors({
        monthlyIncome: 0, monthlyExpenses: 30000, savingsRate: 0,
        investment_total: 0, total_asset: 0, emergency_wallet: 90000,
      });
      expect(factors.find(f => f.label === 'Emergency')!.ok).toBe(true);
    });

    it('is not ok when emergency_wallet covers < 3 months', () => {
      const factors = computeHealthFactors({
        monthlyIncome: 0, monthlyExpenses: 30000, savingsRate: 0,
        investment_total: 0, total_asset: 0, emergency_wallet: 89999,
      });
      expect(factors.find(f => f.label === 'Emergency')!.ok).toBe(false);
    });

    it('is not ok when monthlyExpenses is 0 (avoids divide-by-zero)', () => {
      const factors = computeHealthFactors({
        monthlyIncome: 0, monthlyExpenses: 0, savingsRate: 0,
        investment_total: 0, total_asset: 0, emergency_wallet: 100000,
      });
      expect(factors.find(f => f.label === 'Emergency')!.ok).toBe(false);
    });
  });

  describe('healthScore derivation', () => {
    it('returns 50 when all 4 factors fail', () => {
      const factors = [
        { ok: false }, { ok: false }, { ok: false }, { ok: false },
      ];
      expect(computeHealthScore(factors)).toBe(50);
    });

    it('returns 62.5 → rounds to 63 when 1 factor passes', () => {
      const factors = [{ ok: true }, { ok: false }, { ok: false }, { ok: false }];
      expect(computeHealthScore(factors)).toBe(63);
    });

    it('returns 75 when 2 factors pass', () => {
      const factors = [{ ok: true }, { ok: true }, { ok: false }, { ok: false }];
      expect(computeHealthScore(factors)).toBe(75);
    });

    it('returns 87.5 → rounds to 88 when 3 factors pass', () => {
      const factors = [{ ok: true }, { ok: true }, { ok: true }, { ok: false }];
      expect(computeHealthScore(factors)).toBe(88);
    });

    it('returns 100 when all 4 factors pass', () => {
      const factors = [{ ok: true }, { ok: true }, { ok: true }, { ok: true }];
      expect(computeHealthScore(factors)).toBe(100);
    });
  });

  describe('combined scenarios', () => {
    it('ideal financial state: all 4 factors pass, score is 100', () => {
      const stats: HealthStats = {
        monthlyIncome: 100000,
        monthlyExpenses: 50000,   // cash flow ok
        savingsRate: 50,           // savings ok
        investment_total: 400000, // 40% of total → investing ok
        total_asset: 1000000,
        emergency_wallet: 300000, // 6 months → emergency ok
      };
      const factors = computeHealthFactors(stats);
      expect(factors.every(f => f.ok)).toBe(true);
      expect(computeHealthScore(factors)).toBe(100);
    });

    it('struggling finances: no factors pass, score is 50', () => {
      const stats: HealthStats = {
        monthlyIncome: 30000,
        monthlyExpenses: 50000,   // cash flow fail
        savingsRate: -66,          // savings fail
        investment_total: 5000,   // 5% → investing fail
        total_asset: 100000,
        emergency_wallet: 50000,  // ~1 month → emergency fail
      };
      const factors = computeHealthFactors(stats);
      expect(factors.every(f => !f.ok)).toBe(true);
      expect(computeHealthScore(factors)).toBe(50);
    });
  });
});
