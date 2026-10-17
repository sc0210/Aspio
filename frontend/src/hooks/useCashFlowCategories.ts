'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAppMode } from './useAppMode';
import { dashboardService } from '@/services/dashboardService';

/**
 * Top income and expense categories for the Cash Flow card.
 *
 * Pulls /dashboard/income-by-category and /dashboard/spending-by-category for the
 * dashboard's selected period and returns the largest N of each. Both endpoints
 * nest the list under data.categories for authenticated users and return a plain
 * list in demo mode, so we read defensively (same pattern as useExpenseBreakdown).
 *
 * The dashboard's dateRange value is passed straight through — the backend
 * resolves it via the same shared date-range function /dashboard/stats uses,
 * so the total shown at the top of the Cash Flow card and this breakdown
 * always cover the identical window. (Previously this coerced 'month' → '30d'
 * — a calendar-month-to-date total with a rolling-30-day breakdown below it —
 * so the ranking could show income the total said didn't exist.)
 */

interface CashFlowCategory {
  name: string;
  amount: number;
}

interface CashFlowCategories {
  topIncome: CashFlowCategory[];
  topExpense: CashFlowCategory[];
  hasData: boolean;
  isLoading: boolean;
}

type SupportedPeriod = '7d' | '14d' | 'month' | '30d' | '90d' | '6m' | '1y' | 'ytd';

interface RawCategory { name?: string; amount?: number }

function readCategories(resp: { data?: unknown } | undefined): RawCategory[] {
  const data = resp?.data;
  if (Array.isArray(data)) return data as RawCategory[];
  return (data as { categories?: RawCategory[] } | undefined)?.categories ?? [];
}

const SUPPORTED_PERIODS: readonly SupportedPeriod[] = ['7d', '14d', 'month', '30d', '90d', '6m', '1y', 'ytd'];

export function useCashFlowCategories(dateRange?: string, topN = 3): CashFlowCategories {
  const { isDemo, session } = useAppMode();
  const enabled = !!session?.user || isDemo;
  const userKey = session?.user?.email || (isDemo ? 'demo' : 'anon');
  // 'month' matches the dashboard's own default (useOptimizedDashboard, /stats).
  const period = (SUPPORTED_PERIODS as readonly string[]).includes(dateRange ?? '')
    ? (dateRange as SupportedPeriod)
    : 'month';

  const incomeQuery = useQuery({
    queryKey: ['income-by-category', period, userKey],
    queryFn: () => dashboardService.getIncomeByCategory(period),
    enabled,
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const expenseQuery = useQuery({
    queryKey: ['cashflow-spending-by-category', period, userKey],
    queryFn: () => dashboardService.getSpendingByCategory(period),
    enabled,
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
    retry: false,
    refetchOnWindowFocus: false,
  });

  return useMemo(() => {
    const top = (raw: RawCategory[]): CashFlowCategory[] =>
      raw
        .filter(c => (c?.amount ?? 0) > 0 && !!c?.name)
        .map(c => ({ name: c.name as string, amount: c.amount as number }))
        .sort((a, b) => b.amount - a.amount)
        .slice(0, topN);

    const topIncome = top(readCategories(incomeQuery.data));
    const topExpense = top(readCategories(expenseQuery.data));

    return {
      topIncome,
      topExpense,
      hasData: topIncome.length > 0 || topExpense.length > 0,
      isLoading: incomeQuery.isLoading || expenseQuery.isLoading,
    };
  }, [incomeQuery.data, expenseQuery.data, incomeQuery.isLoading, expenseQuery.isLoading, topN]);
}
