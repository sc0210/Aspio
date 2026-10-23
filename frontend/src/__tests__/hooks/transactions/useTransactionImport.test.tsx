import { act, renderHook } from '@testing-library/react';
import toast from 'react-hot-toast';
import { transactionService } from '@/services/transactionService';
import { useTransactionImport } from '@/hooks/transactions/useTransactionImport';
import { createQueryClient, createQueryWrapper } from '../../utils/queryWrapper';

jest.mock('react-hot-toast', () => {
  const t = Object.assign(jest.fn(), { success: jest.fn(), error: jest.fn(), loading: jest.fn(), dismiss: jest.fn() });
  return { __esModule: true, default: t, toast: t };
});
jest.mock('@/services/transactionService', () => ({
  transactionService: { createTransaction: jest.fn(), deleteTransaction: jest.fn() },
}));

const svc = transactionService as jest.Mocked<typeof transactionService>;
const toastMock = toast as unknown as Record<'success' | 'error' | 'loading' | 'dismiss', jest.Mock>;

const row = (i: number) => ({ date: `2026-10-${String(i + 1).padStart(2, '0')}`, type: 'expense', amount: i, currency: 'TWD', category: 'Food', description: `r${i}` });

function setup(existing: () => Promise<Array<{ id: string }>> = async () => []) {
  const client = createQueryClient();
  const refetch = jest.spyOn(client, 'refetchQueries').mockResolvedValue();
  const { result } = renderHook(() => useTransactionImport(existing), { wrapper: createQueryWrapper(client) });
  return { result, refetch };
}

beforeEach(() => jest.clearAllMocks());

it('appends every row in batches of ten and refreshes the list', async () => {
  svc.createTransaction.mockResolvedValue({} as never);
  const { result, refetch } = setup();

  await act(() => result.current.handleBulkImport(Array.from({ length: 23 }, (_, i) => row(i)), 'append'));

  expect(svc.createTransaction).toHaveBeenCalledTimes(23);
  expect(svc.createTransaction).toHaveBeenCalledWith(expect.objectContaining({ description: 'r0', amount: 0 }));
  expect(toastMock.loading.mock.calls.map((c) => c[0])).toEqual([
    'Importing... 10/23', 'Importing... 20/23', 'Importing... 23/23',
  ]);
  expect(svc.deleteTransaction).not.toHaveBeenCalled();
  expect(refetch).toHaveBeenCalledWith({ queryKey: ['transactions'] });
  expect(toastMock.success).toHaveBeenCalledWith('Successfully imported 23 transactions!');
});

it('replace mode deletes the existing rows first, carrying on past a failed delete', async () => {
  svc.deleteTransaction.mockRejectedValueOnce(new Error('gone')).mockResolvedValue({} as never);
  svc.createTransaction.mockResolvedValue({} as never);
  const { result } = setup(async () => [{ id: 'a' }, { id: 'b' }]);

  await act(() => result.current.handleBulkImport([row(0)], 'replace'));

  expect(svc.deleteTransaction.mock.calls).toEqual([['a'], ['b']]);
  expect(toastMock.loading).toHaveBeenCalledWith('Deleting 2 existing transactions...', { id: 'bulk-import' });
  expect(svc.createTransaction).toHaveBeenCalledTimes(1);
});

it('replace mode still imports when the existing rows cannot be loaded', async () => {
  svc.createTransaction.mockResolvedValue({} as never);
  const { result } = setup(() => Promise.reject(new Error('offline')));

  await act(() => result.current.handleBulkImport([row(0)], 'replace'));

  expect(svc.deleteTransaction).not.toHaveBeenCalled();
  expect(toastMock.success).toHaveBeenCalled();
});

it('counts failed rows and reports them together', async () => {
  svc.createTransaction
    .mockResolvedValueOnce({} as never)
    .mockRejectedValueOnce(new Error('bad category'))
    .mockRejectedValueOnce({});
  const { result } = setup();

  await act(() => result.current.handleBulkImport([row(0), row(1), row(2)], 'append'));

  expect(toastMock.error).toHaveBeenCalledWith(
    'Imported 1 transactions with 2 errors. Check console for details.',
    { duration: 5000 },
  );
  expect(toastMock.dismiss).toHaveBeenCalledWith('bulk-import');
});

it('owns the import/export modal flag', () => {
  const { result } = setup();
  expect(result.current.showImportExport).toBe(false);
  act(() => result.current.setShowImportExport(true));
  expect(result.current.showImportExport).toBe(true);
});
