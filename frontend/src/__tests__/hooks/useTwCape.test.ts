import { renderHook } from '@testing-library/react';
import { useQuery as useQueryFn } from '@tanstack/react-query';
import { useTwCape } from '@/hooks/useTwCape';

jest.mock('@tanstack/react-query', () => ({ useQuery: jest.fn().mockReturnValue({}) }));
let mockIsDemo = false;
jest.mock('@/hooks/useAppMode', () => ({ useAppMode: () => ({ isDemo: mockIsDemo }) }));
jest.mock('@/lib/api-client', () => ({ apiClient: { get: jest.fn() } }));

const useQuery = useQueryFn as jest.Mock;

describe('useTwCape', () => {
  beforeEach(() => useQuery.mockClear());

  it.each([
    [false, true],
    [true, false],
  ])('demo=%s fetches=%s', (demo, fetches) => {
    mockIsDemo = demo;
    renderHook(() => useTwCape());
    expect(useQuery.mock.calls[0][0].enabled).toBe(fetches);
  });
});
