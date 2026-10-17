import { apiClient } from '@/lib/api-client';
import { ApiResponse } from '@/shared/types';

interface DashboardStats {
  // Three-wallet system
  life_wallet: number;
  portfolio_wallet: number;
  emergency_wallet: number;

  // Aggregated totals
  total_asset: number;
  total_debt: number;
  net_worth: number;
  investment_total: number;

  // Legacy/additional metrics
  totalIncome: number;
  totalExpenses: number;
  monthlyChange: number;
  savingsRate: number;
  upcomingBills: number;
  portfolioChange: number;
}

interface RecentActivity {
  id: string;
  type: 'transaction' | 'investment' | 'milestone';
  title: string;
  description: string;
  amount?: number;
  currency?: string;
  date: Date;
  icon?: string;
  color?: string;
}

interface DashboardData {
  stats: DashboardStats;
  recentActivities: RecentActivity[];
  upcomingEvents: {
    id: string;
    title: string;
    date: Date;
    type: 'bill_due' | 'investment_maturity';
    amount?: number;
  }[];
  monthlyTrend: {
    month: string;
    income: number;
    expenses: number;
    savings: number;
  }[];
}

class DashboardService {
  async getDashboardStats(period: '7d' | '14d' | 'month' | '30d' | '90d' | '6m' | '1y' | 'ytd' = 'month'): Promise<ApiResponse<DashboardStats>> {
    return apiClient.get(`/dashboard/stats?period=${period}`);
  }

  async getRecentActivity(limit: number = 10): Promise<ApiResponse<RecentActivity[]>> {
    return apiClient.get(`/dashboard/recent-activity?limit=${limit}`);
  }

  async getDashboardData(): Promise<ApiResponse<DashboardData>> {
    return apiClient.get('/dashboard/overview');
  }

  async getUpcomingEvents(): Promise<ApiResponse<{
    id: string;
    title: string;
    date: Date;
    type: 'bill_due' | 'investment_maturity';
    amount?: number;
  }[]>> {
    return apiClient.get('/dashboard/upcoming-events');
  }

  async getMonthlyTrend(months: number = 12): Promise<ApiResponse<{
    month: string;
    income: number;
    expenses: number;
    savings: number;
  }[]>> {
    return apiClient.get(`/dashboard/monthly-trend?months=${months}`);
  }

  // Period vocabulary matches getDashboardStats/getWalletTrends exactly — the
  // backend resolves all three through the same shared date-range function,
  // so a given period string always means the same window across the
  // dashboard's Cash Flow card totals and its category breakdowns.
  async getSpendingByCategory(period: '7d' | '14d' | 'month' | '30d' | '90d' | '6m' | '1y' | 'ytd' = '30d'): Promise<ApiResponse<{
    category: string;
    amount: number;
    percentage: number;
    change: number;
  }[]>> {
    return apiClient.get(`/dashboard/spending-by-category?period=${period}`);
  }

  // Income counterpart of getSpendingByCategory. Same response shape: the backend
  // nests the list under data.categories for authenticated users and returns a
  // plain list in demo mode, so callers should read defensively.
  async getIncomeByCategory(period: '7d' | '14d' | 'month' | '30d' | '90d' | '6m' | '1y' | 'ytd' = '30d'): Promise<ApiResponse<{
    category: string;
    amount: number;
    percentage: number;
    change: number;
  }[]>> {
    return apiClient.get(`/dashboard/income-by-category?period=${period}`);
  }



  // Utility method for refreshing dashboard data
  async refreshDashboard(): Promise<ApiResponse<boolean>> {
    return apiClient.post('/dashboard/refresh');
  }

  async getHistoricalTrends(period: '7d' | '14d' | 'month' | '30d' | '90d' | '6m' | '1y' | 'ytd' = '30d'): Promise<ApiResponse<{
    dataPoints: {
      date: string;
      income: number;
      expenses: number;
      balance: number;
      netWorth: number;
      portfolioValue?: number;
    }[];
    period: string;
    startDate: string;
    endDate: string;
    currency: string;
    lastUpdated: string;
  }>> {
    return apiClient.get(`/dashboard/historical-trends?period=${period}`);
  }

  async getWalletTrends(period: '7d' | '14d' | 'month' | '30d' | '90d' | '6m' | '1y' | 'ytd' = '30d'): Promise<ApiResponse<{
    /** Balances at the close of the day before startDate — where the period
     *  opened. N daily points span N-1 days, so a caller taking last - first
     *  without this measures a day less than the period it asked for. */
    baseline?: {
      date: string;
      lifeWallet: number;
      portfolioWallet: number;
      emergencyWallet: number;
      totalAsset: number;
      investmentTotal: number;
      debtBalance?: number;
    } | null;
    dataPoints: {
      date: string;
      lifeWallet: number;
      portfolioWallet: number;
      emergencyWallet: number;
      totalAsset: number;
      investmentTotal: number;
      debtBalance: number;
      debtByLoan?: Record<string, number>;
    }[];
    period: string;
    startDate: string;
    endDate: string;
    currency: string;
    lastUpdated: string;
  }>> {
    return apiClient.get(`/dashboard/wallet-trends?period=${period}`);
  }
}

export const dashboardService = new DashboardService();