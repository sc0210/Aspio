/**
 * Reports Service
 * The spending, monthly-trend and goals reads behind /review.
 */

import { apiClient } from '@/lib/api-client';
import { ApiResponse } from '@/shared/types';
import { log } from '@/utils/logger';

interface ReportFilters {
    dateFrom?: string; // ISO date string
    dateTo?: string;
}

/** One month of totals, as `/reports/monthly-trends` and `SpendingReport` both carry it. */
export interface MonthlyTrend {
    month: string; // YYYY-MM
    income: number;
    expenses: number;
    net: number;
    amount: number;
}

export interface SpendingReport {
    totalExpenses: number;
    totalIncome: number;
    netSavings: number;  // Changed from netIncome to match backend
    savingsRate: number;
    categoryBreakdown: {
        category: string;
        amount: number;
        percentage: number;
        transactionCount: number;
        color?: string;
    }[];
    /** Income by category, in the same shape as `categoryBreakdown`. */
    incomeBreakdown?: {
        category: string;
        amount: number;
        percentage: number;
        transactionCount: number;
        color?: string;
    }[];
    monthlyTrends: MonthlyTrend[];
    topMerchants: {  // Changed from topExpenseCategories to match backend
        name: string;
        amount: number;
    }[];
    averageDailySpending: number;  // Changed from averageDailyExpense to match backend
    insights: {
        type: string;
        title: string;
        description: string;
        impact?: string;
    }[];
    comparisonPeriod?: {
        income: number;
        expenses: number;
        netSavings: number;
    };
}

export interface GoalsReport {
    totalGoals: number;
    activeGoals: number;
    completedGoals: number;
    totalTargetAmount: number;
    totalCurrentAmount: number;
    overallProgress: number;
    goalsOnTrack: number;
    goalsBehind: number;
    goalProgress: {
        id: string;
        title: string;
        category: string;
        targetAmount: number;
        currentAmount: number;
        progressPercentage: number;
        status: string;
        targetDate?: string;
        daysRemaining?: number;
        onTrack: boolean;
        monthlyRequired: number;
    }[];
    categorySummary: {
        category: string;
        count: number;
        totalTarget: number;
        totalCurrent: number;
        averageProgress: number;
    }[];
    insights: {
        type: string;
        title: string;
        description: string;
        impact?: string;
    }[];
}

class ReportsService {
    /**
     * Get spending analysis report
     */
    async getSpendingReport(filters: ReportFilters): Promise<ApiResponse<SpendingReport>> {
        const params = new URLSearchParams();
        if (filters.dateFrom) params.append('date_from', filters.dateFrom);
        if (filters.dateTo) params.append('date_to', filters.dateTo);

        const response = await apiClient.get<SpendingReport>(`/reports/spending?${params.toString()}`);

        log.debug('Spending report fetched from backend', response, 'ReportsService');
        return response as ApiResponse<SpendingReport>;
    }

    /**
     * Month-by-month totals over a range.
     *
     * The same figures `/spending` embeds, without the category breakdown, top
     * merchants and previous-period comparison it computes beside them — worth
     * asking for on their own when a caller wants a year of months and nothing
     * else, as the month review does.
     */
    async getMonthlyTrends(filters: ReportFilters): Promise<ApiResponse<MonthlyTrend[]>> {
        const params = new URLSearchParams();
        if (filters.dateFrom) params.append('date_from', filters.dateFrom);
        if (filters.dateTo) params.append('date_to', filters.dateTo);

        const response = await apiClient.get<MonthlyTrend[]>(`/reports/monthly-trends?${params.toString()}`);

        log.debug('Monthly trends fetched from backend', response, 'ReportsService');
        return response as ApiResponse<MonthlyTrend[]>;
    }

    /**
     * Get goals progress report
     */
    async getGoalsReport(filters: ReportFilters): Promise<ApiResponse<GoalsReport>> {
        const params = new URLSearchParams();
        if (filters.dateFrom) params.append('date_from', filters.dateFrom);
        if (filters.dateTo) params.append('date_to', filters.dateTo);

        const response = await apiClient.get<GoalsReport>(`/reports/goals?${params.toString()}`);

        log.debug('Goals report fetched from backend', response, 'ReportsService');
        return response as ApiResponse<GoalsReport>;
    }
}

export const reportsService = new ReportsService();
