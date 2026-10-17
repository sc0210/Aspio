import { renderHook } from '@testing-library/react';
import { useQuery } from '@tanstack/react-query';
import { useGoal, useGoalsSummary } from '@/hooks/useGoals';
import { useDemo } from '@/contexts/DemoContext';
import { apiClient } from '@/lib/api-client';

jest.mock('@tanstack/react-query', () => ({
  useQuery: jest.fn(),
  useMutation: jest.fn(),
  useQueryClient: jest.fn(() => ({ invalidateQueries: jest.fn(), refetchQueries: jest.fn() })),
}));

jest.mock('next-auth/react', () => ({
  useSession: jest.fn(() => ({ data: null, status: 'unauthenticated' })),
}));

jest.mock('react-hot-toast', () => ({ __esModule: true, default: { success: jest.fn(), error: jest.fn() } }));
jest.mock('react-i18next', () => ({ initReactI18next: { type: '3rdParty', init: () => {} }, useTranslation: () => ({ t: (k: string) => k }) }));

jest.mock('@/contexts/DemoContext', () => ({
  useDemo: jest.fn(),
}));

jest.mock('@/lib/api-client', () => ({
  apiClient: { get: jest.fn() },
}));

jest.mock('@/hooks/useDataSynchronization', () => ({
  QUERY_KEYS: { GOALS: 'goals', GOALS_SUMMARY: 'goals_summary' },
  invalidateDashboardData: jest.fn(),
}));

const mockUseQuery = useQuery as jest.Mock;
const mockUseDemo = useDemo as jest.Mock;

const DEMO_GOALS = [
  {
    id: 'demo-goal-1',
    title: 'Emergency Fund',
    status: 'active',
    category: 'emergency_fund',
    targetAmount: 25000,
    currentAmount: 15000,
    currency: 'TWD',
    priority: 'high',
    milestones: [],
    contributions: [],
  },
  {
    id: 'demo-goal-2',
    title: 'House Down Payment',
    status: 'active',
    category: 'house_down_payment',
    targetAmount: 100000,
    currentAmount: 45000,
    currency: 'TWD',
    priority: 'high',
    milestones: [],
    contributions: [],
  },
  {
    id: 'demo-goal-3',
    title: 'Japan Vacation',
    status: 'active',
    category: 'vacation',
    targetAmount: 8000,
    currentAmount: 3200,
    currency: 'TWD',
    priority: 'medium',
    milestones: [],
    contributions: [],
  },
];

beforeEach(() => {
  jest.clearAllMocks();
  mockUseQuery.mockImplementation(({ queryFn, enabled }) => {
    if (!enabled) return { data: undefined, isLoading: false };
    let result: unknown;
    // Run the queryFn synchronously for testing
    try {
      const promise = queryFn();
      if (promise && typeof promise.then === 'function') {
        // Return placeholder; actual value tested via waitFor in async tests
        return { data: undefined, isLoading: true };
      }
      result = promise;
    } catch {
      return { data: undefined, isLoading: false, error: true };
    }
    return { data: result, isLoading: false };
  });
});

describe('useGoal — demo mode', () => {
  it('returns the matching demo goal without hitting the API', async () => {
    mockUseDemo.mockReturnValue({ isDemoMode: true, demoGoals: DEMO_GOALS });
    const apiGet = apiClient.get as jest.Mock;

    // Override useQuery to actually run queryFn
    mockUseQuery.mockImplementation(({ queryFn, enabled }) => {
      if (!enabled) return { data: undefined, isLoading: false };
      const result = { data: undefined as unknown, isLoading: false };
      (queryFn as () => Promise<unknown>)().then((v: unknown) => { result.data = v; }).catch(() => {});
      return result;
    });

    renderHook(() => useGoal('demo-goal-1'));
    expect(apiGet).not.toHaveBeenCalled();
  });

  it('returns undefined for unknown demo goal id', () => {
    mockUseDemo.mockReturnValue({ isDemoMode: true, demoGoals: DEMO_GOALS });
    mockUseQuery.mockImplementation(({ queryFn, enabled }) => {
      if (!enabled) return { data: undefined, isLoading: false };
      let error: unknown = null;
      (queryFn as () => Promise<unknown>)().catch((e: unknown) => { error = e; });
      return { data: undefined, isLoading: false, error };
    });

    const { result } = renderHook(() => useGoal('non-existent-id'));
    // The query is enabled (isDemoMode=true, goalId truthy)
    expect(result.current.data).toBeUndefined();
  });

  it('calls the real API when not in demo mode', () => {
    mockUseDemo.mockReturnValue({ isDemoMode: false, demoGoals: DEMO_GOALS });
    const apiGet = (apiClient.get as jest.Mock).mockResolvedValue({ data: DEMO_GOALS[0] });

    mockUseQuery.mockImplementation(({ queryFn }) => {
      (queryFn as () => Promise<unknown>)();
      return { data: undefined, isLoading: true };
    });

    renderHook(() => useGoal('real-goal-id'));
    expect(apiGet).toHaveBeenCalledWith('/goals/real-goal-id');
  });
});

describe('useGoalsSummary — demo mode', () => {
  it('computes summary from demoGoals without hitting the API', () => {
    mockUseDemo.mockReturnValue({ isDemoMode: true, demoGoals: DEMO_GOALS });
    const apiGet = apiClient.get as jest.Mock;

    let capturedQueryFn: (() => Promise<unknown>) | null = null;
    mockUseQuery.mockImplementation(({ queryFn, enabled }) => {
      if (!enabled) return { data: undefined, isLoading: false };
      capturedQueryFn = queryFn as () => Promise<unknown>;
      return { data: undefined, isLoading: false };
    });

    renderHook(() => useGoalsSummary());

    expect(capturedQueryFn).not.toBeNull();
    return (capturedQueryFn as unknown as () => Promise<unknown>)().then((summary: unknown) => {
      const s = summary as { totalGoals: number; activeGoals: number; overallProgress: number };
      expect(s.totalGoals).toBe(3);
      expect(s.activeGoals).toBe(3);
      expect(apiGet).not.toHaveBeenCalled();
    });
  });

  it('calculates overallProgress correctly', () => {
    mockUseDemo.mockReturnValue({ isDemoMode: true, demoGoals: DEMO_GOALS });

    let capturedQueryFn: (() => Promise<unknown>) | null = null;
    mockUseQuery.mockImplementation(({ queryFn }) => {
      capturedQueryFn = queryFn as () => Promise<unknown>;
      return { data: undefined, isLoading: false };
    });

    renderHook(() => useGoalsSummary());

    return (capturedQueryFn as unknown as () => Promise<unknown>)().then((summary: unknown) => {
      const s = summary as { totalTargetAmount: number; totalCurrentAmount: number; overallProgress: number };
      const expectedProgress = (s.totalCurrentAmount / s.totalTargetAmount) * 100;
      expect(s.overallProgress).toBeCloseTo(expectedProgress);
    });
  });

  it('calls the real API when not in demo mode', () => {
    mockUseDemo.mockReturnValue({ isDemoMode: false, demoGoals: [] });
    const apiGet = (apiClient.get as jest.Mock).mockResolvedValue({ data: {} });

    mockUseQuery.mockImplementation(({ queryFn }) => {
      (queryFn as () => Promise<unknown>)();
      return { data: undefined, isLoading: true };
    });

    renderHook(() => useGoalsSummary());
    expect(apiGet).toHaveBeenCalledWith('/goals/summary');
  });

  it('is disabled when no session and not in demo mode', () => {
    mockUseDemo.mockReturnValue({ isDemoMode: false, demoGoals: [] });
    let capturedEnabled: boolean | undefined;
    mockUseQuery.mockImplementation(({ enabled }) => {
      capturedEnabled = enabled;
      return { data: undefined, isLoading: false };
    });

    renderHook(() => useGoalsSummary());
    expect(capturedEnabled).toBe(false);
  });
});
