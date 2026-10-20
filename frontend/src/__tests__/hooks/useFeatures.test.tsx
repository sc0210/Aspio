import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const mockGet = jest.fn();
jest.mock('@/lib/api-client', () => ({ apiClient: { get: (...args: unknown[]) => mockGet(...args) } }));
const mockMode = { isDemo: false };
jest.mock('@/hooks/useAppMode', () => ({ useAppMode: () => mockMode }));

import { useFeatures } from '@/hooks/useFeatures';

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('useFeatures', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockMode.isDemo = false;
  });

  it('reports the bot off when the instance says so', async () => {
    mockGet.mockResolvedValue({ success: true, data: { line_bot: false } });
    const { result } = renderHook(() => useFeatures(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.lineBot).toBe(false);
  });

  it('reports the bot on when the instance says so', async () => {
    mockGet.mockResolvedValue({ success: true, data: { line_bot: true } });
    const { result } = renderHook(() => useFeatures(), { wrapper });
    await waitFor(() => expect(result.current.lineBot).toBe(true));
  });

  it('reports a failed request as off, and flags it', async () => {
    // Off, so the nav and Settings never offer what may not exist; the flag
    // lets LineBotGate still render a page someone already opened.
    mockGet.mockRejectedValue(new Error('HTTP error! status: 502'));
    const { result } = renderHook(() => useFeatures(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.lineBot).toBe(false);
  });

  it('turns everything on in demo mode without asking the backend', () => {
    mockMode.isDemo = true;
    const { result } = renderHook(() => useFeatures(), { wrapper });
    expect(result.current).toEqual({ lineBot: true, isLoading: false, isError: false });
    expect(mockGet).not.toHaveBeenCalled();
  });
});
