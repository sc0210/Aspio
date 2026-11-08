/**
 * The "Shared bills only" filter: kept in the URL like the others, shown as a
 * chip, and checked against whatever was typed into the address bar.
 */
import { act, renderHook } from '@testing-library/react';

import { useTransactionFilters } from '@/hooks/transactions/useTransactionFilters';

const replace = jest.fn();
let search = new URLSearchParams();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  usePathname: () => '/transactions',
  useSearchParams: () => search,
}));

const lastUrl = () => replace.mock.calls[replace.mock.calls.length - 1]?.[0] as string | undefined;

beforeEach(() => {
  replace.mockClear();
  search = new URLSearchParams();
});

it('reads ?shared=shared and shows a chip', () => {
  search = new URLSearchParams('shared=shared');
  const { result } = renderHook(() => useTransactionFilters());
  expect(result.current.filters.shared).toBe('shared');
  expect(result.current.activeFilters).toContainEqual(
    expect.objectContaining({ key: 'shared', value: 'shared' }));
});

it('ignores a value it does not know', () => {
  search = new URLSearchParams('shared=banana');
  const { result } = renderHook(() => useTransactionFilters());
  expect(result.current.filters.shared).toBe('all');
});

it('writes the filter to the URL and takes it out again when the chip is removed', () => {
  const { result } = renderHook(() => useTransactionFilters());
  act(() => result.current.setFilters((f) => ({ ...f, shared: 'shared' })));
  expect(lastUrl()).toBe('/transactions?shared=shared');

  search = new URLSearchParams('shared=shared');
  act(() => result.current.removeFilter('shared'));
  expect(result.current.filters.shared).toBe('all');
});
