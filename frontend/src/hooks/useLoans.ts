'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import {
  loanService,
  DebtAccount,
  DebtAccountCreate,
  DebtAccountUpdate,
  DebtAccountSummary,
  LoanPaymentCreate,
  LoanPaymentUpdate,
} from '@/services/loanService';
import { QUERY_KEYS, invalidateDashboardData } from '@/hooks/useDataSynchronization';
import { useSession } from 'next-auth/react';
import { useAppMode } from '@/hooks/useAppMode';
import { demoLoans } from '@/data/demoData';

// From the shared map, so the invalidation group and this query cannot
// disagree about what the key is.
const LOANS_KEY = [QUERY_KEYS.LOANS];

/**
 * Who the cached loans belong to.
 *
 * Unlike GOALS, this key carried no identity, so two accounts in one tab shared
 * one cache entry — and credentials sign-in does not reload the page. The
 * auth-transition invalidation closes that, but only as long as nobody forgets
 * to keep LOANS in the group; scoping the key means the collision cannot happen
 * in the first place.
 *
 * The scope goes LAST on purpose. Every invalidation in this file and in the
 * shared groups matches by prefix — `['loans']`, `['loans', id, 'payments']` —
 * and a scope inserted in the middle would silently stop matching them.
 */
function useLoansScope(): string {
  const { isDemo } = useAppMode();
  const { data: session } = useSession();
  return isDemo ? 'demo' : (session?.user?.id ?? 'anon');
}

/** Derive the summary from the already-fetched loans list — no extra API call. */
export function deriveSummary(loans: DebtAccount[]): DebtAccountSummary {
  const active = loans.filter(l => l.status === 'active');
  // The money fields are typed `number` but arrive as STRINGS: they are
  // Decimal on the backend, and Pydantic serialises Decimal to a JSON string
  // ("2760000.00"). Adding those to a numeric seed concatenates instead of
  // summing, and formatCurrency() turns the resulting non-numeric string into
  // NT$0 — so the 總負債 card silently read zero while every loan card beside
  // it was correct. Coerce explicitly; do not trust the declared type here.
  const totalDebt = active.reduce((sum, l) => sum + Number(l.current_balance), 0);

  let nextDate: string | null = null;
  let nextAmount: number | null = null;
  const upcoming = active
    .filter(l => l.next_payment_date)
    .sort((a, b) => a.next_payment_date!.localeCompare(b.next_payment_date!));
  if (upcoming.length > 0) {
    nextDate = upcoming[0].next_payment_date;
    nextAmount = Number(upcoming[0].minimum_payment);
  }

  return {
    total_debt: totalDebt,
    loan_count: active.length,
    next_payment_date: nextDate,
    next_payment_amount: nextAmount,
    loans,
  };
}

export function useLoans() {
  const { isDemo } = useAppMode();
  const scope = useLoansScope();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: [...LOANS_KEY, scope],
    queryFn: async () => {
      try {
        return await loanService.getLoans();
      } catch {
        return { success: true, data: [] as DebtAccount[], message: '' };
      }
    },
    staleTime: 5 * 60 * 1000,
    retry: false,
    // Demo mode uses fixtures — never hit the real API (avoids 401s).
    enabled: !isDemo,
  });

  const loans = isDemo ? demoLoans : (data?.data ?? []);
  const summary = deriveSummary(loans);

  return { loans, summary, isLoading, error, refetch };
}

/**
 * Demo writes never reach the backend (they 401'd there). Resolve with a
 * sentinel instead; onSuccess shows the simulated toast and skips the cache work.
 */
const DEMO_SIMULATED = { success: true, demo: true } as const;
type DemoSimulated = typeof DEMO_SIMULATED;
function demoOr<T>(isDemo: boolean, write: () => Promise<T>): Promise<T | DemoSimulated> {
  return isDemo ? Promise.resolve(DEMO_SIMULATED) : write();
}
const isDemoResult = (r: unknown): r is DemoSimulated =>
  !!r && typeof r === 'object' && (r as { demo?: unknown }).demo === true;

function useDemoWriteGuard() {
  const { isDemo } = useAppMode();
  const { t } = useTranslation('common');
  return {
    isDemo,
    simulated: () => toast.success(t('demoAlert.changesSimulated')),
  };
}

export function useCreateLoan() {
  const queryClient = useQueryClient();
  const { isDemo, simulated } = useDemoWriteGuard();
  return useMutation({
    mutationFn: (data: DebtAccountCreate) =>
      demoOr(isDemo, () => loanService.createLoan(data)),
    onSuccess: (result: unknown) => {
      if (isDemoResult(result)) return simulated();
      queryClient.invalidateQueries({ queryKey: LOANS_KEY });
      invalidateDashboardData(queryClient);
      toast.success('Loan created successfully');
    },
    onError: (err: Error) => {
      toast.error(err?.message || 'Failed to create loan');
    },
  });
}

export function useUpdateLoan() {
  const queryClient = useQueryClient();
  const { isDemo, simulated } = useDemoWriteGuard();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: DebtAccountUpdate }) =>
      demoOr(isDemo, () => loanService.updateLoan(id, data)),
    onSuccess: (result: unknown) => {
      if (isDemoResult(result)) return simulated();
      queryClient.invalidateQueries({ queryKey: LOANS_KEY });
      invalidateDashboardData(queryClient);
      toast.success('Loan updated');
    },
    onError: (err: Error) => {
      toast.error(err?.message || 'Failed to update loan');
    },
  });
}

export function useDeleteLoan() {
  const queryClient = useQueryClient();
  const { isDemo, simulated } = useDemoWriteGuard();
  return useMutation({
    mutationFn: (id: string) =>
      demoOr(isDemo, () => loanService.deleteLoan(id)),
    onSuccess: (result: unknown) => {
      if (isDemoResult(result)) return simulated();
      queryClient.invalidateQueries({ queryKey: LOANS_KEY });
      invalidateDashboardData(queryClient);
      toast.success('Loan removed');
    },
    onError: (err: Error) => {
      toast.error(err?.message || 'Failed to delete loan');
    },
  });
}

export function usePaymentHistory(loanId: string | null) {
  const scope = useLoansScope();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: [...LOANS_KEY, loanId, 'payments', scope],
    queryFn: () => loanService.getPayments(loanId!),
    enabled: !!loanId,
    staleTime: 5 * 60 * 1000,
  });
  return { payments: data?.data ?? [], isLoading, error, refetch };
}

export function useUpdatePayment() {
  const queryClient = useQueryClient();
  const { isDemo, simulated } = useDemoWriteGuard();
  return useMutation({
    mutationFn: ({ loanId, transactionId, data }: { loanId: string; transactionId: string; data: LoanPaymentUpdate }) =>
      demoOr(isDemo, () => loanService.updatePayment(loanId, transactionId, data)),
    onSuccess: (result: unknown, variables) => {
      if (isDemoResult(result)) return simulated();
      queryClient.invalidateQueries({ queryKey: [...LOANS_KEY, variables.loanId, 'payments'] });
      queryClient.invalidateQueries({ queryKey: LOANS_KEY });
      invalidateDashboardData(queryClient);
      toast.success('Payment updated');
    },
    onError: (err: Error) => {
      toast.error(err?.message || 'Failed to update payment');
    },
  });
}

export function useDeletePayment() {
  const queryClient = useQueryClient();
  const { isDemo, simulated } = useDemoWriteGuard();
  return useMutation({
    mutationFn: ({ loanId, transactionId }: { loanId: string; transactionId: string }) =>
      demoOr(isDemo, () => loanService.deletePayment(loanId, transactionId)),
    onSuccess: (result: unknown, variables) => {
      if (isDemoResult(result)) return simulated();
      queryClient.invalidateQueries({ queryKey: [...LOANS_KEY, variables.loanId, 'payments'] });
      queryClient.invalidateQueries({ queryKey: LOANS_KEY });
      invalidateDashboardData(queryClient);
      toast.success('Payment deleted');
    },
    onError: (err: Error) => {
      toast.error(err?.message || 'Failed to delete payment');
    },
  });
}

export function useRecordPayment() {
  const queryClient = useQueryClient();
  const { isDemo, simulated } = useDemoWriteGuard();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: LoanPaymentCreate }) =>
      demoOr(isDemo, () => loanService.recordPayment(id, data)),
    onSuccess: (response) => {
      if (isDemoResult(response)) return simulated();
      queryClient.invalidateQueries({ queryKey: LOANS_KEY });
      invalidateDashboardData(queryClient);
      if (response.data?.is_paid_off) {
        toast.success('Loan fully paid off!', { icon: '🎉', duration: 5000 });
      } else {
        toast.success('Payment recorded successfully');
      }
    },
    onError: (err: Error) => {
      toast.error(err?.message || 'Failed to record payment');
    },
  });
}
