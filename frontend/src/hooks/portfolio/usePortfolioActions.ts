import { useCallback } from 'react';
import type { PortfolioHolding, Goal } from '@/shared/types';
import type { PortfolioModalsState } from './usePortfolioModals';

/**
 * Portfolio actions hook
 *
 * Centralizes all user action handlers for the portfolio page.
 * Provides memoized callbacks for better performance.
 *
 * Features:
 * - Holding detail view
 * - Goal editing
 * - Goal contributions
 * - Chart interactions
 *
 * @example
 * ```tsx
 * function PortfolioPage() {
 *   const modals = usePortfolioModals();
 *   const viewState = usePortfolioViewState();
 *   const actions = usePortfolioActions(modals, viewState);
 *
 *   return (
 *     <HoldingCard
 *       holding={holding}
 *       onClick={actions.handleHoldingClick}
 *     />
 *   );
 * }
 * ```
 */
export function usePortfolioActions(
  modals: PortfolioModalsState,
  viewState: { setChartType: (type: 'daily' | 'trend' | 'analytics' | null) => void }
) {
  /**
   * Handle holding click - opens detail modal
   */
  const handleHoldingClick = useCallback(
    (holding: PortfolioHolding) => {
      modals.openHoldingDetailModal(holding);
    },
    [modals]
  );

  /**
   * Handle edit goal - opens goal edit modal
   */
  const handleEditGoal = useCallback(
    (goal: Goal) => {
      modals.openEditGoalModal(goal);
    },
    [modals]
  );

  /**
   * Handle contribute to goal - opens contribution modal
   */
  const handleContributeToGoal = useCallback(
    (goal: Goal) => {
      modals.openContributeModal(goal);
    },
    [modals]
  );

  /**
   * Handle today change stat card click - shows daily chart
   */
  const handleTodayChangeClick = useCallback(() => {
    viewState.setChartType('daily');
  }, [viewState]);

  /**
   * Handle view trend click - shows trend chart
   */
  const handleViewTrendClick = useCallback(() => {
    viewState.setChartType('trend');
  }, [viewState]);

  return {
    // Holding actions
    handleHoldingClick,

    // Goal actions
    handleEditGoal,
    handleContributeToGoal,

    // Chart actions
    handleTodayChangeClick,
    handleViewTrendClick,
  };
}
