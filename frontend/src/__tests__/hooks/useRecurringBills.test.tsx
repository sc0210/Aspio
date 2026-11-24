/**
 * useRecurringBills: bills are a signed-in feature, "due" means due by the end
 * of this month, and every bill write refreshes the ledger and the bill lists.
 */
import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAppMode } from '@/hooks/useAppMode';
import { recurringService } from '@/services/recurringService';
import { invalidateDashboardData } from '@/hooks/useDataSynchronization';
import {
  endOfThisMonth, useBillActions, useBillSuggestions, useBills, useDueBills,
} from '@/hooks/useRecurringBills';

jest.mock('@/hooks/useAppMode', () => ({ useAppMode: jest.fn() }));
jest.mock('@/services/recurringService', () => ({
  recurringService: {
    listBills: jest.fn(), dueBills: jest.fn(), suggestions: jest.fn(), createBill: jest.fn(),
    updateBill: jest.fn(), recordBill: jest.fn(), skipBill: jest.fn(),
  },
}));
jest.mock('@/hooks/useDataSynchronization', () => ({
  ...jest.requireActual('@/hooks/useDataSynchronization'),
  invalidateDashboardData: jest.fn(),
}));

const mode = useAppMode as jest.Mock;
const svc = recurringService as jest.Mocked<typeof recurringService>;

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, Wrapper };
}

beforeEach(() => {
  jest.clearAllMocks();
  mode.mockReturnValue({ isAuthenticated: true, isDemo: false, user: { id: 'u1' } });
  svc.dueBills.mockResolvedValue([]);
  svc.listBills.mockResolvedValue([]);
  svc.suggestions.mockResolvedValue([]);
});

it('ends the month on its last day, short months and leap years included', () => {
  expect(endOfThisMonth(new Date(2026, 10, 24))).toBe('2026-11-30');
  expect(endOfThisMonth(new Date(2028, 1, 3))).toBe('2028-02-29');
});

it('asks for bills due by the end of this month', async () => {
  const { Wrapper } = wrapper();
  const { result } = renderHook(() => useDueBills(), { wrapper: Wrapper });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(svc.dueBills).toHaveBeenCalledWith(endOfThisMonth());
});

it('loads the bills and the suggestions when signed in', async () => {
  const { Wrapper } = wrapper();
  const bills = renderHook(() => useBills(), { wrapper: Wrapper }).result;
  const suggestions = renderHook(() => useBillSuggestions(), { wrapper: Wrapper }).result;
  await waitFor(() => expect(bills.current.isSuccess && suggestions.current.isSuccess).toBe(true));
  expect(svc.listBills).toHaveBeenCalled();
  expect(svc.suggestions).toHaveBeenCalled();
});

it('asks for nothing in demo mode', () => {
  mode.mockReturnValue({ isAuthenticated: false, isDemo: true, user: null });
  const { Wrapper } = wrapper();
  renderHook(() => { useDueBills(); useBills(); useBillSuggestions(); }, { wrapper: Wrapper });
  expect(svc.dueBills).not.toHaveBeenCalled();
  expect(svc.listBills).not.toHaveBeenCalled();
  expect(svc.suggestions).not.toHaveBeenCalled();
});

it('passes each write through and refreshes the ledger after it', async () => {
  const { client, Wrapper } = wrapper();
  const invalidate = jest.spyOn(client, 'invalidateQueries');
  const { result } = renderHook(() => useBillActions(), { wrapper: Wrapper });

  await act(async () => {
    await result.current.record.mutateAsync({ id: 'r1', occurrence: '2026-12-03', amount: 526, date: '2026-11-24' });
    await result.current.skip.mutateAsync({ id: 'r1', occurrence: '2027-01-03' });
    await result.current.update.mutateAsync({ id: 'r1', changes: { isPaused: true } });
    await result.current.create.mutateAsync({
      description: 'x', amount: 1, currency: 'TWD', categoryId: 'c1', frequency: 'monthly', startDate: '2026-12-01',
    });
  });

  expect(svc.recordBill).toHaveBeenCalledWith('r1', '2026-12-03', 526, '2026-11-24');
  expect(svc.skipBill).toHaveBeenCalledWith('r1', '2027-01-03');
  expect(svc.updateBill).toHaveBeenCalledWith('r1', { isPaused: true });
  expect(svc.createBill).toHaveBeenCalled();
  expect(invalidateDashboardData).toHaveBeenCalledTimes(4);
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['recurring-bills'] });
});
