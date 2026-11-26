import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAppMode } from '@/hooks/useAppMode';
import { QUERY_KEYS, invalidateDashboardData } from '@/hooks/useDataSynchronization';
import { recurringService, type NewBill } from '@/services/recurringService';
import { localDateString } from '@/utils/formatters';

/** The last day of this month, YYYY-MM-DD: "due" means due by then. */
export function endOfThisMonth(today = new Date()): string {
  return localDateString(new Date(today.getFullYear(), today.getMonth() + 1, 0));
}

/** Bills are a signed-in feature: demo mode has no rules and asks for none. */
function useBillsEnabled() {
  const { isAuthenticated, isDemo, user } = useAppMode();
  return { enabled: isAuthenticated && !isDemo, userId: user?.id };
}

/** Reminders due by the end of this month (the Transactions banner and the Bills page). */
export function useDueBills() {
  const { enabled, userId } = useBillsEnabled();
  const until = endOfThisMonth();
  return useQuery({
    queryKey: [QUERY_KEYS.RECURRING_BILLS, 'due', until, userId],
    queryFn: () => recurringService.dueBills(until),
    enabled,
  });
}

export function useBills() {
  const { enabled, userId } = useBillsEnabled();
  return useQuery({
    queryKey: [QUERY_KEYS.RECURRING_BILLS, 'all', userId],
    queryFn: () => recurringService.listBills(),
    enabled,
  });
}

export function useBillSuggestions() {
  const { enabled, userId } = useBillsEnabled();
  return useQuery({
    queryKey: [QUERY_KEYS.RECURRING_BILLS, 'suggestions', userId],
    queryFn: () => recurringService.suggestions(),
    enabled,
  });
}

/**
 * Every bill write. Recording one writes a transaction, so the whole ledger is
 * stale; the bills lists (a prefix of RECURRING_BILLS) refetch with it.
 */
export function useBillActions() {
  const queryClient = useQueryClient();
  const settle = () => {
    invalidateDashboardData(queryClient);
    return queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.RECURRING_BILLS] });
  };
  const opts = { onSettled: settle };
  return {
    record: useMutation({
      mutationFn: (v: { id: string; occurrence: string; amount: number; date?: string }) =>
        recurringService.recordBill(v.id, v.occurrence, v.amount, v.date),
      ...opts,
    }),
    skip: useMutation({
      mutationFn: (v: { id: string; occurrence: string }) => recurringService.skipBill(v.id, v.occurrence),
      ...opts,
    }),
    create: useMutation({ mutationFn: (bill: NewBill) => recurringService.createBill(bill), ...opts }),
    update: useMutation({
      mutationFn: (v: { id: string; changes: Parameters<typeof recurringService.updateBill>[1] }) =>
        recurringService.updateBill(v.id, v.changes),
      ...opts,
    }),
  };
}
