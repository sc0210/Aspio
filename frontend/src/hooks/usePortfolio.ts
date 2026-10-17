'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { useTranslation } from 'react-i18next';
import { PortfolioHolding } from '@/shared/types';
import { portfolioService, HoldingInput } from '@/services/portfolioService';
import { QUERY_KEYS, invalidateDashboardData } from './useDataSynchronization';
import toast from 'react-hot-toast';
import { useDemo } from '@/contexts/DemoContext';
import { useAuthContext } from '@/contexts/AuthContext';

export function usePortfolio() {
  const { data: session } = useSession();
  const { isDemoMode, demoPortfolio } = useDemo();
  const { isAuthenticated } = useAuthContext();
  const queryClient = useQueryClient();
  const { t } = useTranslation(['portfolio']);

  const {
    data: portfolio,
    isLoading,
    error,
    refetch,
  } = useQuery({
    // Include mode + user in cache key so demo and auth data never share the same entry
    queryKey: [QUERY_KEYS.PORTFOLIO, isDemoMode ? 'demo' : (session?.user?.id || 'anon')],
    queryFn: async () => {
      if (isDemoMode) {
        return { data: demoPortfolio, success: true, message: 'Demo portfolio' };
      }
      return portfolioService.getPortfolio();
    },
    enabled: isAuthenticated || isDemoMode,
    staleTime: isDemoMode ? 1000 * 60 * 60 : 1000 * 60 * 5,
    refetchOnMount: 'always',
    refetchOnWindowFocus: !isDemoMode,
  });

  const addHoldingMutation = useMutation({
    mutationFn: (holdingData: Omit<PortfolioHolding, 'id' | 'totalValue' | 'gainLoss' | 'gainLossPercentage' | 'lastUpdated'>) =>
      portfolioService.addHolding(holdingData as HoldingInput),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.PORTFOLIO] });
      invalidateDashboardData(queryClient);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('portfolio-updated'));
      }
      toast.success(t('portfolio:toast.holdingAdded'));
    },
    onError: (error: Error) => {
      toast.error(error.message || t('portfolio:toast.holdingAddFailed'));
    },
  });

  const updateHoldingMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<PortfolioHolding> }) =>
      portfolioService.updateHolding({ id, ...data } as HoldingInput & { id: string }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.PORTFOLIO] });
      invalidateDashboardData(queryClient);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('portfolio-updated'));
      }
      toast.success(t('portfolio:toast.holdingUpdated'));
    },
    onError: (error: Error) => {
      toast.error(error.message || t('portfolio:toast.holdingUpdateFailed'));
    },
  });

  const removeHoldingMutation = useMutation({
    mutationFn: (id: string) => portfolioService.deleteHolding(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.PORTFOLIO] });
      invalidateDashboardData(queryClient);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('portfolio-updated'));
      }
      toast.success(t('portfolio:toast.holdingDeleted'));
    },
    onError: (error: Error) => {
      toast.error(error.message || t('portfolio:toast.holdingDeleteFailed'));
    },
  });

  return {
    portfolio,
    holdings: (portfolio as { data?: { holdings?: PortfolioHolding[] } } | undefined)?.data?.holdings ?? [],
    isLoading: isLoading || addHoldingMutation.isPending || updateHoldingMutation.isPending,
    error,
    refetch,
    addHolding: addHoldingMutation.mutateAsync,
    updateHolding: updateHoldingMutation.mutateAsync,
    removeHolding: removeHoldingMutation.mutateAsync,
  };
}