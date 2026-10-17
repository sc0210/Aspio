import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

interface MutationError extends Error {
  response?: {
    data?: {
      message?: string;
      detail?: string;
    };
  };
}
import { useSession } from 'next-auth/react';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api-client';
import { toast } from 'react-hot-toast';
import { QUERY_KEYS, invalidateDashboardData } from './useDataSynchronization';
import { useDemo } from '@/contexts/DemoContext';
import { useAppMode } from '@/hooks/useAppMode';
import type { FinancialGoal } from '@/shared/types';

export interface Goal {
    id: string;
    userId: string;
    title: string;
    description?: string;
    category: string;
    priority: 'high' | 'medium' | 'low';
    status: 'active' | 'completed' | 'paused' | 'cancelled';
    targetAmount: number;
    currentAmount: number;
    progressPercentage: number;
    remainingAmount: number;
    currency: string;
    targetDate?: string;
    startedAt: string;
    completedAt?: string;
    createdAt: string;
    updatedAt: string;
    milestones?: GoalMilestone[];
    contributions?: GoalContribution[];
}

export interface GoalMilestone {
    id: string;
    goalId: string;
    title: string;
    description?: string;
    amount: number;
    targetDate?: string;
    isCompleted: boolean;
    completedAt?: string;
    createdAt: string;
    updatedAt: string;
}

export interface GoalContribution {
    id: string;
    goalId: string;
    amount: number;
    contributionDate: string;
    notes?: string;
    transactionId?: string;
    createdAt: string;
}

interface GoalSummary {
    totalGoals: number;
    activeGoals: number;
    completedGoals: number;
    totalTargetAmount: number;
    totalCurrentAmount: number;
    overallProgress: number;
}

export interface CreateGoalData {
    title: string;
    description?: string;
    category: string;
    priority?: 'high' | 'medium' | 'low';
    target_amount: number;
    current_amount?: number;
    currency?: string;
    target_date?: string;
    milestones?: Array<{
        title: string;
        description?: string;
        amount: number;
        target_date?: string;
    }>;
}

export interface UpdateGoalData {
    title?: string;
    description?: string;
    category?: string;
    priority?: 'high' | 'medium' | 'low';
    status?: 'active' | 'completed' | 'paused' | 'cancelled';
    target_amount?: number;
    current_amount?: number;
    currency?: string;
    target_date?: string;
}

export interface ContributeData {
    amount: number;
    contribution_date?: string;
    notes?: string;
    transaction_id?: string;
}

/**
 * A goal's progress in percent (0–100).
 *
 * Uses the server's progressPercentage when it is a real number, and otherwise
 * derives it from current/target. Never let a missing value read as "fine":
 * `undefined < 70` is false, which is how three overdue demo goals all counted
 * as on track (At-Risk 0).
 */
export function goalProgressPercent(goal: Pick<Goal, 'currentAmount' | 'targetAmount'> & { progressPercentage?: number | null }): number {
    const stored = goal.progressPercentage;
    if (typeof stored === 'number' && Number.isFinite(stored)) return stored;
    const target = Number(goal.targetAmount) || 0;
    const current = Number(goal.currentAmount) || 0;
    return target > 0 ? (current / target) * 100 : 0;
}

/**
 * Demo fixtures are `FinancialGoal`s (Date fields, no derived amounts). Shape
 * them as the API's `Goal` rather than force-casting, so the derived fields
 * every consumer reads actually exist.
 */
export function demoGoalToGoal(g: FinancialGoal): Goal {
    const iso = (d: Date | string | undefined) =>
        d === undefined ? undefined : (d instanceof Date ? d.toISOString() : String(d));
    const targetAmount = Number(g.targetAmount) || 0;
    const currentAmount = Number(g.currentAmount) || 0;
    return {
        id: g.id,
        userId: g.userId,
        title: g.title,
        description: g.description,
        category: g.category,
        priority: g.priority,
        status: g.status,
        targetAmount,
        currentAmount,
        progressPercentage: goalProgressPercent({ targetAmount, currentAmount }),
        remainingAmount: Math.max(0, targetAmount - currentAmount),
        currency: g.currency,
        targetDate: iso(g.targetDate),
        startedAt: iso(g.createdAt) ?? new Date().toISOString(),
        createdAt: iso(g.createdAt) ?? new Date().toISOString(),
        updatedAt: iso(g.updatedAt) ?? new Date().toISOString(),
        milestones: (g.milestones ?? []).map((m) => ({
            id: m.id,
            goalId: g.id,
            title: m.title,
            description: m.description,
            amount: m.amount,
            targetDate: iso(m.targetDate),
            isCompleted: m.isCompleted,
            completedAt: iso(m.completedAt),
            createdAt: iso(g.createdAt) ?? new Date().toISOString(),
            updatedAt: iso(g.updatedAt) ?? new Date().toISOString(),
        })),
        contributions: [],
    };
}

export function useGoals(status?: string, category?: string) {
    const { data: session } = useSession();
    const { isDemoMode, demoGoals, demoRevision } = useDemo();

    return useQuery<Goal[]>({
        // Include mode + user so demo and auth caches never collide; demo also
        // carries the revision so a demo write refetches the updated fixtures.
        queryKey: [QUERY_KEYS.GOALS, status, category, isDemoMode ? `demo-${demoRevision ?? 0}` : (session?.user?.id || 'anon')],
        queryFn: async () => {
            if (isDemoMode) {
                let filtered = (demoGoals ?? []).map(demoGoalToGoal);
                if (status) filtered = filtered.filter(g => g.status === status);
                if (category) filtered = filtered.filter(g => g.category === category);
                return filtered;
            }

            const params = new URLSearchParams();
            if (status) params.append('status', status);
            if (category) params.append('category', category);

            const response = await apiClient.get<Goal[]>(
                `/goals/${params.toString() ? `?${params.toString()}` : ''}`
            );
            return response.data || [];
        },
        enabled: !!session || isDemoMode,
        placeholderData: [] as Goal[],
        staleTime: isDemoMode ? 1000 * 60 * 60 : 60_000,
        refetchOnMount: true,
        refetchOnWindowFocus: !isDemoMode,
    });
}

export function useGoal(goalId: string) {
    const { data: session } = useSession();
    const { isDemoMode, demoGoals, demoRevision } = useDemo();

    return useQuery<Goal>({
        queryKey: [QUERY_KEYS.GOALS, goalId, isDemoMode ? `demo-${demoRevision ?? 0}` : (session?.user?.id || 'anon')],
        queryFn: async () => {
            if (isDemoMode) {
                const goal = (demoGoals ?? []).find(g => g.id === goalId);
                if (!goal) throw new Error('Demo goal not found');
                return demoGoalToGoal(goal);
            }
            const response = await apiClient.get<Goal>(`/goals/${goalId}`);
            return response.data!;
        },
        enabled: (!!session || isDemoMode) && !!goalId,
    });
}

export function useGoalsSummary() {
    const { data: session } = useSession();
    const { isDemoMode, demoGoals, demoRevision } = useDemo();

    return useQuery<GoalSummary>({
        queryKey: [QUERY_KEYS.GOALS_SUMMARY, isDemoMode ? `demo-${demoRevision ?? 0}` : (session?.user?.id || 'anon')],
        queryFn: async () => {
            if (isDemoMode) {
                const goals = (demoGoals ?? []).map(demoGoalToGoal);
                const active = goals.filter(g => g.status === 'active');
                const completed = goals.filter(g => g.status === 'completed');
                const totalTarget = goals.reduce((sum, g) => sum + Number(g.targetAmount), 0);
                const totalCurrent = goals.reduce((sum, g) => sum + Number(g.currentAmount), 0);
                return {
                    totalGoals: goals.length,
                    activeGoals: active.length,
                    completedGoals: completed.length,
                    totalTargetAmount: totalTarget,
                    totalCurrentAmount: totalCurrent,
                    overallProgress: totalTarget > 0 ? (totalCurrent / totalTarget) * 100 : 0,
                };
            }
            const response = await apiClient.get<GoalSummary>('/goals/summary');
            return response.data!;
        },
        enabled: !!session || isDemoMode,
    });
}

/** Demo writes resolve to this instead of calling the backend (it 401s there). */
const DEMO_WRITE = { demo: true } as const;
const isDemoWrite = (r: unknown): boolean =>
    !!r && typeof r === 'object' && (r as { demo?: unknown }).demo === true;

/** Demo-mode plumbing shared by the goal mutations. */
function useGoalDemoWrites() {
    const { isDemo } = useAppMode();
    const demo = useDemo();
    const queryClient = useQueryClient();
    const { t } = useTranslation(['common']);
    return {
        isDemo,
        demo,
        /** The demo fixtures changed: show the simulated toast and refresh. */
        done: () => {
            queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.GOALS] });
            queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.GOALS_SUMMARY] });
            toast.success(t('common:demoAlert.changesSimulated'));
        },
    };
}

export function useCreateGoal() {
    const queryClient = useQueryClient();
    const { t } = useTranslation(['goals']);
    const { isDemo, demo, done } = useGoalDemoWrites();

    return useMutation({
        mutationFn: async (data: CreateGoalData): Promise<Goal | typeof DEMO_WRITE> => {
            if (isDemo) {
                demo.addDemoGoal?.({
                    title: data.title,
                    description: data.description,
                    category: data.category as FinancialGoal['category'],
                    priority: data.priority ?? 'medium',
                    status: 'active',
                    targetAmount: Number(data.target_amount) || 0,
                    currentAmount: Number(data.current_amount) || 0,
                    currency: data.currency ?? 'TWD',
                    targetDate: data.target_date ? new Date(data.target_date) : new Date(),
                });
                return DEMO_WRITE;
            }
            // Trailing slash: the router mounts create at "/goals/", and the
            // slash-less path costs a 307 redirect on every create.
            const response = await apiClient.post<Goal>(
                '/goals/',
                data
            );
            return response.data!;
        },
        onSuccess: (result) => {
            if (isDemoWrite(result)) return done();
            queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.GOALS] });
            queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.GOALS_SUMMARY] });
            // Refetch ALL instances (active + inactive) so dashboard & portfolio stay in sync
            queryClient.refetchQueries({ queryKey: [QUERY_KEYS.GOALS], type: 'all' });
            invalidateDashboardData(queryClient);
            toast.success(t('goals:toast.created'));
        },
        onError: (error: MutationError) => {
            console.error('[useCreateGoal] Mutation failed:', error);
            console.error('[useCreateGoal] Error response:', error.response?.data);
            const errorMessage = error.response?.data?.message ||
                error.response?.data?.detail ||
                t('goals:toast.createFailed');
            toast.error(errorMessage);
        },
    });
}

export function useUpdateGoal() {
    const queryClient = useQueryClient();
    const { t } = useTranslation(['goals']);

    const { isDemo, demo, done } = useGoalDemoWrites();

    return useMutation({
        mutationFn: async ({ id, data }: { id: string; data: UpdateGoalData }): Promise<Goal | typeof DEMO_WRITE> => {
            if (isDemo) {
                const updates: Partial<FinancialGoal> = {};
                if (data.title !== undefined) updates.title = data.title;
                if (data.description !== undefined) updates.description = data.description;
                if (data.category !== undefined) updates.category = data.category as FinancialGoal['category'];
                if (data.priority !== undefined) updates.priority = data.priority;
                if (data.status !== undefined && data.status !== 'cancelled') updates.status = data.status;
                if (data.target_amount !== undefined) updates.targetAmount = Number(data.target_amount);
                if (data.current_amount !== undefined) updates.currentAmount = Number(data.current_amount);
                if (data.currency !== undefined) updates.currency = data.currency;
                if (data.target_date !== undefined) updates.targetDate = new Date(data.target_date);
                demo.updateDemoGoal?.(id, updates);
                return DEMO_WRITE;
            }
            const response = await apiClient.put<Goal>(
                `/goals/${id}`,
                data
            );
            return response.data!;
        },
        onSuccess: (result, variables) => {
            if (isDemoWrite(result)) return done();
            queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.GOALS] });
            queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.GOALS, variables.id] });
            queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.GOALS_SUMMARY] });
            // Refetch ALL instances (active + inactive) so dashboard & portfolio stay in sync
            queryClient.refetchQueries({ queryKey: [QUERY_KEYS.GOALS], type: 'all' });
            invalidateDashboardData(queryClient);
            toast.success(t('goals:toast.updated'));
        },
        onError: (error: MutationError) => {
            console.error('[useUpdateGoal] onError called:', error);
            toast.error(error.response?.data?.message || t('goals:toast.updateFailed'));
        },
    });
}

export function useDeleteGoal() {
    const queryClient = useQueryClient();
    const { t } = useTranslation(['goals']);

    const { isDemo, demo, done } = useGoalDemoWrites();

    return useMutation({
        mutationFn: async (id: string): Promise<typeof DEMO_WRITE | void> => {
            if (isDemo) {
                demo.removeDemoGoal?.(id);
                return DEMO_WRITE;
            }
            await apiClient.delete(`/goals/${id}`);
        },
        onSuccess: (result) => {
            if (isDemoWrite(result)) return done();
            queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.GOALS] });
            queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.GOALS_SUMMARY] });
            // Refetch ALL instances (active + inactive) so dashboard & portfolio stay in sync
            queryClient.refetchQueries({ queryKey: [QUERY_KEYS.GOALS], type: 'all' });
            invalidateDashboardData(queryClient);
            toast.success(t('goals:toast.deleted'));
        },
        onError: (error: MutationError) => {
            toast.error(error.response?.data?.message || t('goals:toast.deleteFailed'));
        },
    });
}

export function useAddContribution() {
    const queryClient = useQueryClient();
    const { t } = useTranslation(['goals']);

    const { isDemo, demo, done } = useGoalDemoWrites();

    return useMutation({
        mutationFn: async ({ goalId, data }: { goalId: string; data: ContributeData }): Promise<GoalContribution | typeof DEMO_WRITE> => {
            if (isDemo) {
                const goal = demo.demoGoals?.find((g) => g.id === goalId);
                if (goal) {
                    demo.updateDemoGoal?.(goalId, {
                        currentAmount: (Number(goal.currentAmount) || 0) + (Number(data.amount) || 0),
                    });
                }
                return DEMO_WRITE;
            }
            const response = await apiClient.post<GoalContribution>(
                `/goals/${goalId}/contributions`,
                data
            );
            return response.data!;
        },
        onSuccess: (result, variables) => {
            if (isDemoWrite(result)) return done();
            queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.GOALS] });
            queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.GOALS, variables.goalId] });
            queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.GOALS_SUMMARY] });
            // Refetch ALL instances (active + inactive) so dashboard & portfolio stay in sync
            queryClient.refetchQueries({ queryKey: [QUERY_KEYS.GOALS], type: 'all' });
            invalidateDashboardData(queryClient);
            toast.success(t('goals:toast.contributionAdded'));
        },
        onError: (error: MutationError) => {
            toast.error(error.response?.data?.message || t('goals:toast.contributionFailed'));
        },
    });
}
