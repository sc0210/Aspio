'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { useTranslation } from 'react-i18next';
import { portfolioService } from '@/services/portfolioService';
import { invalidateDashboardData, QUERY_KEYS } from '@/hooks/useDataSynchronization';
import { toTWD } from '@/utils/formatters';
import toast from 'react-hot-toast';
import type { PortfolioFilters } from './usePortfolioFilters';
import type { PortfolioModalsState } from './usePortfolioModals';

/**
 * Manages CRUD operations on individual holdings and lots:
 * - Delete a holding (with life-wallet guard)
 * - Update an individual lot (date / quantity / cost)
 * - Update symbol-level metadata (name, sector)
 * - Open the sell modal from the wallet quick-action button
 * - Open the buy modal from the holdings list empty action
 */
interface CachedPortfolio {
  holdings?: Array<{
    id: string;
    totalValue?: number;
    quantity?: number;
    averageCost?: number;
    totalCost?: number;
    currentPrice?: number;
    gainLoss?: number;
    gainLossPercentage?: number;
    sector?: string;
    purchaseDate?: string;
    walletType?: string;
    symbol?: string;
    name?: string;
    currency?: string;
  }>;
  totalValue?: number;
  totalCost?: number;
  totalGainLoss?: number;
  totalGainLossPercentage?: number;
}

export function usePortfolioHoldingOperations(
  memoizedFilters: PortfolioFilters,
  modals: PortfolioModalsState,
  aggregatedHoldings: Array<{ symbol: string }>,
) {
  const { t } = useTranslation(['portfolio']);
  const { data: session } = useSession();
  const queryClient = useQueryClient();

  const userKey = session?.user?.email || 'demo';

  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  // ──────────────────────────────────────────────
  // Delete holding mutation (with optimistic update)
  // ──────────────────────────────────────────────
  const deleteHoldingMutation = useMutation({
    mutationFn: async (holdingId: string) => {
      const response = await portfolioService.deleteHolding(holdingId);
      if (!response.success) {
        throw new Error(response.message || 'Failed to delete holding');
      }
      return response;
    },
    onMutate: async (holdingId) => {
      await queryClient.cancelQueries({ queryKey: ['portfolio'] });

      const previousPortfolio = queryClient.getQueryData([
        'portfolio', memoizedFilters, userKey,
      ]);

      queryClient.setQueryData(['portfolio', memoizedFilters, userKey], (old: CachedPortfolio | undefined) => {
        if (!old) return old;
        const removed = old.holdings?.find((h) => h.id === holdingId);
        if (!removed) return old;
        const updatedHoldings = old.holdings!.filter((h) => h.id !== holdingId);
        // The portfolio totals are TWD and count portfolio-wallet holdings only
        // (portfolioService.recalculatePortfolioTotals); holdings[] are native
        // currency. Take the removed lot's converted share off the totals —
        // re-summing the native values counted a US$ lot as NT$ until refetch.
        const inTotals = !removed.walletType || removed.walletType === 'portfolio';
        const currency = removed.currency || 'TWD';
        const removedValue = inTotals ? toTWD(removed.totalValue ?? 0, currency) : 0;
        const removedCost = inTotals
          ? toTWD(removed.totalCost ?? (removed.quantity ?? 0) * (removed.averageCost ?? 0), currency)
          : 0;
        const totalValue = (old.totalValue ?? 0) - removedValue;
        const totalCost = (old.totalCost ?? 0) - removedCost;
        const totalGainLoss = totalValue - totalCost;
        const totalGainLossPercentage = totalCost > 0 ? (totalGainLoss / totalCost) * 100 : 0;
        return { ...old, holdings: updatedHoldings, totalValue, totalCost, totalGainLoss, totalGainLossPercentage };
      });

      return { previousPortfolio };
    },
    onSuccess: async () => {
      toast.success(t('portfolio:toast.holdingDeleted'));
      await queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.PORTFOLIO] });
      await queryClient.invalidateQueries({ queryKey: ['portfolio-analytics'] });
      await queryClient.invalidateQueries({ queryKey: ['portfolio-daily-performance'] });
      invalidateDashboardData(queryClient);
      await queryClient.invalidateQueries({ queryKey: ['cash-wallet'] });
    },
    onError: (error: Error, _variables, context: { previousPortfolio: unknown } | undefined) => {
      if (context?.previousPortfolio) {
        queryClient.setQueryData(['portfolio', memoizedFilters, userKey], context.previousPortfolio);
      }
      toast.error(error.message || t('portfolio:toast.holdingDeleteFailed'));
    },
  });

  // ──────────────────────────────────────────────
  // Public handlers
  // ──────────────────────────────────────────────

  /** Request deletion — opens ConfirmDeleteDialog (blocks life-wallet cash) */
  const handleDeleteHolding = (holdingId: string) => {
    const cachedPortfolio = queryClient.getQueryData<CachedPortfolio>(['portfolio', memoizedFilters, userKey]);
    const holding = cachedPortfolio?.holdings?.find((h) => h.id === holdingId);

    if (!holding) {
      // Cache miss — block deletion rather than silently bypass the life-wallet guard
      toast.error(t('portfolio:toast.holdingDeleteFailed'));
      return;
    }

    const isLifeWallet =
      holding.walletType === 'life' ||
      (holding.symbol === 'CASH-TWD' && holding.name === 'Life Wallet Cash');
    if (isLifeWallet) {
      toast.error(t('portfolio:toast.cannotDeleteLifeWallet'));
      return;
    }

    setPendingDeleteId(holdingId);
  };

  /** Confirm the pending delete — fires the mutation */
  const handleConfirmDelete = () => {
    if (pendingDeleteId) {
      deleteHoldingMutation.mutate(pendingDeleteId);
      setPendingDeleteId(null);
    }
  };

  /** Cancel the pending delete */
  const handleCancelDelete = () => {
    setPendingDeleteId(null);
  };

  /** Update an individual lot's purchase date, quantity, or average cost */
  const handleUpdateLot = async (
    lotId: string,
    updates: { purchaseDate?: string; quantity?: number; averageCost?: number; currentPrice?: number },
  ) => {
    try {
      await portfolioService.updateHolding({
        id: lotId,
        ...updates,
        purchaseDate: updates.purchaseDate
          ? new Date(updates.purchaseDate).toISOString()
          : undefined,
      });

      await queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.PORTFOLIO] });
      await queryClient.invalidateQueries({ queryKey: ['portfolio-analytics'] });
      invalidateDashboardData(queryClient);
      await queryClient.refetchQueries({
        queryKey: [QUERY_KEYS.PORTFOLIO, memoizedFilters, userKey],
        exact: true,
        type: 'active',
      });
      // Note: success toast is fired by HoldingDetailModal after this resolves
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'Failed to update lot');
      throw error;
    }
  };

  /** Update symbol-level metadata (name, sector) across all lots */
  const handleUpdateSymbol = async (
    symbol: string,
    updates: { name?: string; sector?: string },
  ) => {
    try {
      await portfolioService.updateHoldingsBySymbol(symbol, updates);
      await queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.PORTFOLIO] });
      await queryClient.invalidateQueries({ queryKey: ['portfolio-analytics'] });
      await queryClient.refetchQueries({
        queryKey: [QUERY_KEYS.PORTFOLIO, memoizedFilters, userKey],
        exact: true,
        type: 'active',
      });
      toast.success(t('portfolio:toast.lotsBulkUpdated', { symbol }));
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'Failed to update holding details');
      throw error;
    }
  };

  /** Open sell modal without pre-selecting a holding (wallet quick-action) */
  const handleSellFromWallet = () => {
    const hasInvestments = aggregatedHoldings.some(
      h => !h.symbol.toUpperCase().startsWith('CASH-'),
    );
    if (hasInvestments) {
      modals.openSellModal(null as never); // Let user choose inside the modal
    } else {
      toast.error(t('portfolio:toast.noHoldingsToSell'));
    }
  };

  /** Open buy modal from holdings list */
  const handleAddInvestment = () => {
    modals.openBuyModal();
  };

  return {
    handleDeleteHolding,
    handleConfirmDelete,
    handleCancelDelete,
    pendingDeleteId,
    handleUpdateLot,
    handleUpdateSymbol,
    handleSellFromWallet,
    handleAddInvestment,
    isDeleting: deleteHoldingMutation.isPending,
  };
}
