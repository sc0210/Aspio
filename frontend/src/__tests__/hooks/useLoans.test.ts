import { renderHook } from '@testing-library/react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { useLoans, useCreateLoan, useUpdateLoan, useDeleteLoan, useRecordPayment, deriveSummary } from '@/hooks/useLoans';
import { loanService } from '@/services/loanService';
import type { DebtAccount } from '@/services/loanService';

// This suite drives useQuery/useMutation directly to check the hook's derive
// logic and its service wiring; it has no interest in the cache. react-query is
// no longer stubbed globally (see jest.setup.js), so it opts in explicitly.
jest.mock('@tanstack/react-query', () =>
  jest.requireActual<typeof import('../utils/reactQueryStub')>(
      '../utils/reactQueryStub',
  ).createReactQueryStub());

jest.mock('@/services/loanService', () => ({
  loanService: {
    getLoans: jest.fn(),
    getSummary: jest.fn(),
    createLoan: jest.fn(),
    updateLoan: jest.fn(),
    deleteLoan: jest.fn(),
    recordPayment: jest.fn(),
  },
}));

jest.mock('react-hot-toast', () => ({
  __esModule: true,
  default: { success: jest.fn(), error: jest.fn() },
}));

// useQuery/useMutation/useQueryClient come from the stub opted into above.
const mockUseQuery = useQuery as jest.Mock;
const mockUseMutation = useMutation as jest.Mock;
const mockUseQueryClient = useQueryClient as jest.Mock;

const mockLoan: DebtAccount = {
  id: 'loan-1',
  user_id: 'user-1',
  name: 'Home Mortgage',
  lender_name: 'CTBC Bank',
  account_type: 'mortgage',
  principal_amount: 5_000_000,
  current_balance: 4_500_000,
  interest_rate: 2.5,
  minimum_payment: 30_000,
  payment_due_day: 15,
  start_date: '2024-01-01',
  term_months: 360,
  currency: 'TWD',
  status: 'active',
  notes: null,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
  progress_pct: 10,
  months_remaining: 280,
  payoff_months_estimate: 280,
  total_interest_remaining: 1_200_000,
  next_payment_date: '2026-06-15',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockUseQueryClient.mockReturnValue({ invalidateQueries: jest.fn() });
});

// Helper to create a mock mutation that invokes mutationFn + onSuccess when mutateAsync is called
function makeMutationMock() {
  type MutationOptions = { mutationFn: (...args: unknown[]) => Promise<unknown>; onSuccess?: (result: unknown) => Promise<void> };
  let capturedOptions: MutationOptions = { mutationFn: async () => undefined };
  mockUseMutation.mockImplementation((options: MutationOptions) => {
    capturedOptions = options;
    return {
      mutateAsync: async (...args: unknown[]) => {
        const result = await options.mutationFn(...args);
        await options.onSuccess?.(result);
        return result;
      },
      isPending: false,
    };
  });
  return capturedOptions;
}

// ── useLoans ─────────────────────────────────────────────────────────────────

// useLoans issues ONE query — the loans list — and derives the summary from it
// locally (deriveSummary), rather than calling a second /summary endpoint.
//
// These tests used to chain two `mockReturnValueOnce`s, one per query, from
// when the hook worked that way. With a single call site the second value is
// left over, and React's re-render consumes it: the hook then reads a summary
// OBJECT where it expects the loans ARRAY and dies on `loans.filter is not a
// function`. Use mockReturnValue so every render sees the same loans payload.
const loansQuery = (data: unknown, overrides: Record<string, unknown> = {}) => ({
  data,
  isLoading: false,
  error: null,
  refetch: jest.fn(),
  ...overrides,
});

describe('useLoans', () => {
  it('returns empty loans array when API returns empty list', () => {
    mockUseQuery.mockReturnValue(loansQuery({ data: [] }));

    const { result } = renderHook(() => useLoans());
    expect(result.current.loans).toEqual([]);
    expect(result.current.isLoading).toBe(false);
  });

  it('returns loans when API returns data', () => {
    mockUseQuery.mockReturnValue(loansQuery({ data: [mockLoan] }));

    const { result } = renderHook(() => useLoans());
    expect(result.current.loans).toHaveLength(1);
    expect(result.current.loans[0].name).toBe('Home Mortgage');
  });

  it('derives the summary from the loans list without a second query', () => {
    mockUseQuery.mockReturnValue(loansQuery({ data: [mockLoan] }));

    const { result } = renderHook(() => useLoans());
    expect(result.current.summary?.loan_count).toBe(1);
    expect(result.current.summary?.total_debt).toBe(4_500_000);
    expect(result.current.summary?.next_payment_date).toBe(mockLoan.next_payment_date);
    expect(result.current.summary?.next_payment_amount).toBe(mockLoan.minimum_payment);
  });

  it('counts only active loans in the derived summary', () => {
    mockUseQuery.mockReturnValue(
      loansQuery({ data: [mockLoan, { ...mockLoan, id: 'loan-2', status: 'paid_off' }] }),
    );

    const { result } = renderHook(() => useLoans());
    expect(result.current.loans).toHaveLength(2);
    expect(result.current.summary?.loan_count).toBe(1);
    expect(result.current.summary?.total_debt).toBe(4_500_000);
  });

  it('returns isLoading true while the query is loading', () => {
    mockUseQuery.mockReturnValue(loansQuery(undefined, { isLoading: true }));

    const { result } = renderHook(() => useLoans());
    expect(result.current.isLoading).toBe(true);
  });
});

// ── useCreateLoan ─────────────────────────────────────────────────────────────

describe('useCreateLoan', () => {
  it('calls loanService.createLoan with the provided data', async () => {
    (loanService.createLoan as jest.Mock).mockResolvedValue({ data: mockLoan, success: true });
    makeMutationMock();

    const { result } = renderHook(() => useCreateLoan());

    const payload = {
      name: 'My Loan',
      account_type: 'personal_loan' as const,
      principal_amount: 100_000,
      interest_rate: 3,
      minimum_payment: 5_000,
      payment_due_day: 10,
      start_date: '2026-01-01',
    };

    await result.current.mutateAsync(payload);
    expect(loanService.createLoan).toHaveBeenCalledWith(payload);
  });
});

// ── useUpdateLoan ─────────────────────────────────────────────────────────────

describe('useUpdateLoan', () => {
  it('calls loanService.updateLoan with id and data', async () => {
    (loanService.updateLoan as jest.Mock).mockResolvedValue({ data: mockLoan, success: true });
    makeMutationMock();

    const { result } = renderHook(() => useUpdateLoan());
    await result.current.mutateAsync({ id: 'loan-1', data: { name: 'Updated' } });
    expect(loanService.updateLoan).toHaveBeenCalledWith('loan-1', { name: 'Updated' });
  });
});

// ── useDeleteLoan ─────────────────────────────────────────────────────────────

describe('useDeleteLoan', () => {
  it('calls loanService.deleteLoan with the loan id', async () => {
    (loanService.deleteLoan as jest.Mock).mockResolvedValue({ data: undefined, success: true });
    makeMutationMock();

    const { result } = renderHook(() => useDeleteLoan());
    await result.current.mutateAsync('loan-1');
    expect(loanService.deleteLoan).toHaveBeenCalledWith('loan-1');
  });
});

// ── useRecordPayment ──────────────────────────────────────────────────────────

describe('useRecordPayment', () => {
  it('calls loanService.recordPayment with id and payment data', async () => {
    const paymentResponse = {
      transaction_id: 'txn-1',
      loan_id: 'loan-1',
      payment_date: '2026-06-15',
      total_amount: 30_000,
      principal_portion: 29_000,
      interest_portion: 1_000,
      new_balance: 4_471_000,
      is_paid_off: false,
    };
    (loanService.recordPayment as jest.Mock).mockResolvedValue({ data: paymentResponse, success: true });
    makeMutationMock();

    const { result } = renderHook(() => useRecordPayment());

    const paymentData = {
      payment_date: '2026-06-15',
      total_amount: 30_000,
      principal_portion: 29_000,
      interest_portion: 1_000,
    };

    await result.current.mutateAsync({ id: 'loan-1', data: paymentData });
    expect(loanService.recordPayment).toHaveBeenCalledWith('loan-1', paymentData);
  });

  it('shows paid-off toast when is_paid_off is true', async () => {
    const paymentResponse = {
      transaction_id: 'txn-1',
      loan_id: 'loan-1',
      payment_date: '2026-06-15',
      total_amount: 100_000,
      principal_portion: 100_000,
      interest_portion: 0,
      new_balance: 0,
      is_paid_off: true,
    };
    (loanService.recordPayment as jest.Mock).mockResolvedValue({ data: paymentResponse, success: true });
    makeMutationMock();

    const { result } = renderHook(() => useRecordPayment());
    await result.current.mutateAsync({
      id: 'loan-1',
      data: { payment_date: '2026-06-15', total_amount: 100_000, principal_portion: 100_000, interest_portion: 0 },
    });

    expect(toast.success).toHaveBeenCalledWith(
      expect.stringContaining('paid off'),
      expect.objectContaining({ duration: 5000 })
    );
  });
});

describe('deriveSummary — money fields arrive as strings', () => {
  // The backend types these as Decimal and Pydantic serialises Decimal to a
  // JSON string, so the wire format is "2760000.00", not 2760000. The
  // DebtAccount interface declares `number`, which made the original bug
  // invisible to both TypeScript and to fixtures built from numeric literals.
  const asWireFormat = (over: Partial<Record<string, unknown>>) =>
    ({ ...mockLoan, ...over } as unknown as DebtAccount);

  it('sums string balances instead of concatenating them', () => {
    const summary = deriveSummary([
      asWireFormat({ id: 'a', current_balance: '1134742.00', status: 'active' }),
      asWireFormat({ id: 'b', current_balance: '2760000.00', status: 'active' }),
    ]);

    expect(summary.total_debt).toBe(3_894_742);
    expect(summary.loan_count).toBe(2);
  });

  it('excludes non-active loans from the total', () => {
    const summary = deriveSummary([
      asWireFormat({ id: 'a', current_balance: '1000.00', status: 'active' }),
      asWireFormat({ id: 'b', current_balance: '9999.00', status: 'paid_off' }),
    ]);

    expect(summary.total_debt).toBe(1000);
    expect(summary.loan_count).toBe(1);
  });

  it('returns a numeric next payment amount', () => {
    const summary = deriveSummary([
      asWireFormat({
        id: 'a',
        current_balance: '1000.00',
        minimum_payment: '16634.00',
        next_payment_date: '2026-08-19',
        status: 'active',
      }),
    ]);

    expect(summary.next_payment_amount).toBe(16_634);
  });
});
