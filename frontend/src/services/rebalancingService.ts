import { apiClient } from '@/lib/api-client';
import { log } from '@/utils/logger';

interface BackendAllocation {
  asset_symbol: string;
  asset_name: string;
  asset_type: string;
  current_value: string;
  current_percentage: string;
  target_percentage: string;
  delta_amount: string;
  action: string;
  color_code?: string;
}

interface BackendTransaction {
  asset_symbol: string;
  asset_name: string;
  action: string;
  amount: string;
  estimated_fees?: string;
  priority: number;
  notes?: string;
}

interface BackendFXAccumulation {
  currency: string;
  accumulated_amount: string;
  accumulated_twd: string;
  conversion_threshold: string;
  current_fx_rate: string;
  ready_to_convert: boolean;
  estimated_conversion_fee?: string;
  last_conversion_date?: string;
  next_conversion_target: string;
}

interface BackendDashboardResponse {
  allocation_summary?: {
    total_portfolio_value: string;
    allocations?: BackendAllocation[];
    requires_rebalancing?: boolean;
    largest_deviation?: string;
    last_rebalance_date?: string;
  };
  rebalancing_plan?: {
    transactions?: BackendTransaction[];
    available_funds: string;
    total_buy_amount: string;
    total_sell_amount: string;
    total_fees: string;
  };
  fx_accumulation?: BackendFXAccumulation[];
}

export interface AssetAllocation {
  asset: string;
  assetName: string;
  assetType: string;
  currency: string;
  currentValue: number;
  currentPct: number;
  targetPct: number;
  targetValue: number;
  delta: number;
  action: 'BUY' | 'SELL' | 'HOLD';
  suggestedAmount: number;
  colorCode?: string;
}

export interface RebalancingAction {
  asset: string;
  assetName: string;
  action: 'BUY' | 'SELL';
  amount: number;
  shares?: number;
  currentPrice?: number;
  estimatedFee?: number;
  priority: 'high' | 'medium' | 'low';
  reason: string;
}

export interface FXAccumulation {
  currency: string;
  accumulatedAmount: number;
  accumulatedTwd: number;
  conversionThreshold: number;
  currentFxRate: number;
  readyToConvert: boolean;
  estimatedConversionFee: number;
  lastConversionDate?: Date;
  nextConversionTarget: number;
}

export interface RebalancingDashboardData {
  allocations: AssetAllocation[];
  actions: RebalancingAction[];
  totalAssets: number;
  availableFunds: number;
  totalDeficit: number;
  fxAccumulation: FXAccumulation[];
  requiresRebalancing: boolean;
  largestDeviation: number;
  lastRebalanceDate?: Date;
}

class RebalancingService {
  /**
   * Get comprehensive rebalancing dashboard data
   * Includes allocations, rebalancing plan, FX accumulation, and alerts
   */
  async getDashboardData(): Promise<RebalancingDashboardData> {
    try {
      const response = await apiClient.get('/portfolio/rebalancing/dashboard');

      if (response.success && response.data) {
        return this.transformBackendResponse(response.data);
      }

      throw new Error('Failed to fetch rebalancing dashboard data');
    } catch (error) {
      log.error('Rebalancing dashboard fetch error', error, 'RebalancingService');
      throw error;
    }
  }

  /**
   * Alias for getDashboardData for backwards compatibility
   */
  async getRebalancingDashboard(): Promise<RebalancingDashboardData> {
    return this.getDashboardData();
  }

  /**
   * Update target allocation percentages
   */
  async updateTargetAllocations(
    targets: { asset: string; targetPct: number; assetName?: string; assetType?: string }[]
  ): Promise<void> {
    try {
      // Convert percentages from whole numbers (45) to decimals (0.45) for backend
      const formattedTargets = targets.map(t => ({
        asset: t.asset,
        targetPct: t.targetPct / 100,
        assetName: t.assetName || t.asset,
        assetType: t.assetType || 'unknown'
      }));

      const response = await apiClient.put('/portfolio/rebalancing/target-allocations', {
        targets: formattedTargets
      });

      if (!response.success) {
        throw new Error('Failed to update target allocations');
      }

      log.info('Target allocations updated successfully', { targets: formattedTargets }, 'RebalancingService');
    } catch (error) {
      log.error('Target allocation update error', error, 'RebalancingService');
      throw error;
    }
  }

  /**
   * Get current asset allocation with deviations
   */
  async getAssetAllocation(): Promise<{
    allocations: AssetAllocation[];
    totalValue: number;
    requiresRebalancing: boolean;
  }> {
    try {
      const response = await apiClient.get('/portfolio/rebalancing/allocation');

      if (response.success && response.data) {
        const data = response.data as { allocations: BackendAllocation[]; total_portfolio_value: string; requires_rebalancing: boolean };
        const allocations = data.allocations.map((alloc: BackendAllocation) => ({
          asset: alloc.asset_symbol,
          assetName: alloc.asset_name,
          assetType: alloc.asset_type,
          currency: 'TWD',
          currentValue: parseFloat(alloc.current_value),
          currentPct: parseFloat(alloc.current_percentage),
          targetPct: parseFloat(alloc.target_percentage),
          targetValue: parseFloat(alloc.current_value) / parseFloat(alloc.current_percentage) * parseFloat(alloc.target_percentage),
          delta: parseFloat(alloc.delta_amount),
          action: alloc.action.toUpperCase() as 'BUY' | 'SELL' | 'HOLD',
          suggestedAmount: Math.abs(parseFloat(alloc.delta_amount)),
          colorCode: alloc.color_code
        }));

        return {
          allocations,
          totalValue: parseFloat(data.total_portfolio_value),
          requiresRebalancing: data.requires_rebalancing
        };
      }

      throw new Error('Failed to fetch asset allocation');
    } catch (error) {
      log.error('Asset allocation fetch error', error, 'RebalancingService');
      throw error;
    }
  }

  /**
   * Get rebalancing plan with buy/sell recommendations
   */
  async getRebalancingPlan(): Promise<{
    actions: RebalancingAction[];
    availableFunds: number;
    totalBuy: number;
    totalSell: number;
    totalFees: number;
  }> {
    try {
      const response = await apiClient.get('/portfolio/rebalancing/plan');

      if (response.success && response.data) {
        const planData = response.data as { transactions: BackendTransaction[]; available_funds: string; total_buy_amount: string; total_sell_amount: string; total_fees: string };
        const actions = planData.transactions.map((txn: BackendTransaction) => ({
          asset: txn.asset_symbol,
          assetName: txn.asset_name,
          action: txn.action.toUpperCase() as 'BUY' | 'SELL',
          amount: parseFloat(txn.amount),
          estimatedFee: parseFloat(txn.estimated_fees || '0'),
          priority: (txn.priority === 1 ? 'high' : txn.priority === 2 ? 'medium' : 'low') as 'high' | 'medium' | 'low',
          reason: txn.notes || ''
        }));

        return {
          actions,
          availableFunds: parseFloat(planData.available_funds),
          totalBuy: parseFloat(planData.total_buy_amount),
          totalSell: parseFloat(planData.total_sell_amount),
          totalFees: parseFloat(planData.total_fees)
        };
      }

      throw new Error('Failed to fetch rebalancing plan');
    } catch (error) {
      log.error('Rebalancing plan fetch error', error, 'RebalancingService');
      throw error;
    }
  }

  /**
   * Get FX accumulation status
   */
  async getFXAccumulation(): Promise<FXAccumulation[]> {
    try {
      const response = await apiClient.get('/portfolio/rebalancing/fx-accumulation');

      if (response.success && response.data) {
        return (response.data as BackendFXAccumulation[]).map((fx: BackendFXAccumulation) => ({
          currency: fx.currency,
          accumulatedAmount: parseFloat(fx.accumulated_amount),
          accumulatedTwd: parseFloat(fx.accumulated_twd),
          conversionThreshold: parseFloat(fx.conversion_threshold),
          currentFxRate: parseFloat(fx.current_fx_rate),
          readyToConvert: fx.ready_to_convert,
          estimatedConversionFee: parseFloat(fx.estimated_conversion_fee || '0'),
          lastConversionDate: fx.last_conversion_date ? new Date(fx.last_conversion_date) : undefined,
          nextConversionTarget: parseFloat(fx.next_conversion_target)
        }));
      }

      throw new Error('Failed to fetch FX accumulation');
    } catch (error) {
      log.error('FX accumulation fetch error', error, 'RebalancingService');
      throw error;
    }
  }

  /**
   * Transform backend dashboard response to frontend format
   */
  private transformBackendResponse(data: BackendDashboardResponse): RebalancingDashboardData {
    const totalPortfolioValue = parseFloat(data.allocation_summary?.total_portfolio_value || '0');

    const allocations: AssetAllocation[] = data.allocation_summary?.allocations?.map((alloc: BackendAllocation) => {
      const currentValue = parseFloat(alloc.current_value || '0');
      const currentPct = parseFloat(alloc.current_percentage || '0');
      const targetPct = parseFloat(alloc.target_percentage || '0');

      // Calculate target value based on total portfolio value and target percentage
      const targetValue = totalPortfolioValue * (targetPct / 100);

      return {
        asset: alloc.asset_symbol,
        assetName: alloc.asset_name,
        assetType: alloc.asset_type,
        currency: 'TWD',
        currentValue,
        currentPct,
        targetPct,
        targetValue,
        delta: parseFloat(alloc.delta_amount || '0'),
        action: alloc.action?.toUpperCase() as 'BUY' | 'SELL' | 'HOLD',
        suggestedAmount: Math.abs(parseFloat(alloc.delta_amount || '0')),
        colorCode: alloc.color_code || '#6B7280'
      };
    }) || [];

    const actions: RebalancingAction[] = data.rebalancing_plan?.transactions?.map((txn: BackendTransaction) => {
      // Map priority: 1 = high, 2 = medium, 3+ = low
      let priority: 'high' | 'medium' | 'low' = 'low';
      if (txn.priority === 1) priority = 'high';
      else if (txn.priority === 2) priority = 'medium';

      return {
        asset: txn.asset_symbol,
        assetName: txn.asset_name,
        action: txn.action?.toUpperCase() as 'BUY' | 'SELL',
        amount: parseFloat(txn.amount || '0'),
        estimatedFee: parseFloat(txn.estimated_fees || '0'),
        priority,
        reason: txn.notes || ''
      };
    }) || [];

    const fxAccumulation: FXAccumulation[] = data.fx_accumulation?.map((fx: BackendFXAccumulation) => ({
      currency: fx.currency,
      accumulatedAmount: parseFloat(fx.accumulated_amount),
      accumulatedTwd: parseFloat(fx.accumulated_twd),
      conversionThreshold: parseFloat(fx.conversion_threshold),
      currentFxRate: parseFloat(fx.current_fx_rate),
      readyToConvert: fx.ready_to_convert,
      estimatedConversionFee: parseFloat(fx.estimated_conversion_fee || '0'),
      lastConversionDate: fx.last_conversion_date ? new Date(fx.last_conversion_date) : undefined,
      nextConversionTarget: parseFloat(fx.next_conversion_target)
    })) || [];

    const totalAssets = parseFloat(data.allocation_summary?.total_portfolio_value || '0');
    const availableFunds = parseFloat(data.rebalancing_plan?.available_funds || '0');
    const totalBuy = parseFloat(data.rebalancing_plan?.total_buy_amount || '0');
    return {
      allocations,
      actions,
      totalAssets,
      availableFunds,
      // What the purchases need, which is the question RebalancingPlanCard
      // asks of it: `availableFunds >= totalDeficit` decides between 資金充足
      // and 資金不足. Subtracting the proceeds first asked whether the sales
      // covered the purchases MINUS the sales, which is true whenever they
      // cover half — so "資金不足" was close to unreachable. The client-side
      // demo fixture has always used this definition.
      totalDeficit: totalBuy,
      fxAccumulation,
      requiresRebalancing: data.allocation_summary?.requires_rebalancing || false,
      largestDeviation: parseFloat(data.allocation_summary?.largest_deviation || '0'),
      lastRebalanceDate: data.allocation_summary?.last_rebalance_date
        ? new Date(data.allocation_summary.last_rebalance_date)
        : undefined
    };
  }
}

export const rebalancingService = new RebalancingService();
