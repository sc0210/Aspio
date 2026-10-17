import { useState, useCallback } from 'react';
import type { PortfolioHolding, Goal } from '@/shared/types';

/**
 * Modal names for the portfolio page
 */
type PortfolioModalName =
  | 'importExport'
  | 'sell'
  | 'buy'
  | 'walletManagement'
  | 'debug'
  | 'editGoal'
  | 'contributeGoal'
  | 'holdingDetail';

/**
 * Modal state type
 */
interface ModalState {
  importExport: boolean;
  sell: boolean;
  buy: boolean;
  walletManagement: boolean;
  debug: boolean;
  editGoal: boolean;
  contributeGoal: boolean;
  holdingDetail: boolean;
}

/**
 * Modal data type - stores associated data for each modal
 */
interface ModalData {
  sellingHolding: PortfolioHolding | null;
  buyingSymbol: string | null;
  editingGoal: Goal | null;
  contributeGoal: Goal | null;
  holdingDetailData: PortfolioHolding | null;
}

/**
 * Default modal state - all closed
 */
const DEFAULT_MODAL_STATE: ModalState = {
  importExport: false,
  sell: false,
  buy: false,
  walletManagement: false,
  debug: false,
  editGoal: false,
  contributeGoal: false,
  holdingDetail: false,
};

/**
 * Default modal data - all null
 */
const DEFAULT_MODAL_DATA: ModalData = {
  sellingHolding: null,
  buyingSymbol: null,
  editingGoal: null,
  contributeGoal: null,
  holdingDetailData: null,
};

/**
 * Portfolio modals hook
 *
 * Manages all modal open/close state for the portfolio page.
 * Consolidates 8 useState declarations into a single centralized hook.
 *
 * Features:
 * - Centralized modal state management
 * - Associated data storage (e.g., which holding is being sold)
 * - Convenience methods for common modal operations
 * - Close all modals functionality
 *
 * Supported modals:
 * - Import/Export modal
 * - Sell holding modal
 * - Buy holding modal
 * - Wallet management modal
 * - Debug panel
 * - Edit goal modal
 * - Contribute to goal modal
 * - Holding detail modal
 *
 * @example
 * ```tsx
 * function PortfolioPage() {
 *   const modals = usePortfolioModals();
 *
 *   return (
 *     <div>
 *       <button onClick={() => modals.openSellModal(holding)}>
 *         Sell
 *       </button>
 *
 *       {modals.modals.sell && (
 *         <SellModal
 *           holding={modals.modalData.sellingHolding}
 *           onClose={() => modals.closeModal('sell')}
 *         />
 *       )}
 *     </div>
 *   );
 * }
 * ```
 */
export function usePortfolioModals() {
  const [modals, setModals] = useState<ModalState>(DEFAULT_MODAL_STATE);
  const [modalData, setModalData] = useState<ModalData>(DEFAULT_MODAL_DATA);

  /**
   * Open a modal by name
   */
  const openModal = useCallback((name: PortfolioModalName) => {
    setModals(prev => ({ ...prev, [name]: true }));
  }, []);

  /**
   * Close a modal by name and clear its associated data
   */
  const closeModal = useCallback((name: PortfolioModalName) => {
    setModals(prev => ({ ...prev, [name]: false }));

    // Clear associated modal data
    switch (name) {
      case 'sell':
        setModalData(prev => ({ ...prev, sellingHolding: null }));
        break;
      case 'buy':
        setModalData(prev => ({ ...prev, buyingSymbol: null }));
        break;
      case 'editGoal':
        setModalData(prev => ({ ...prev, editingGoal: null }));
        break;
      case 'contributeGoal':
        setModalData(prev => ({ ...prev, contributeGoal: null }));
        break;
      case 'holdingDetail':
        setModalData(prev => ({ ...prev, holdingDetailData: null }));
        break;
    }
  }, []);

  /**
   * Close all modals and clear all data
   */
  const closeAllModals = useCallback(() => {
    setModals(DEFAULT_MODAL_STATE);
    setModalData(DEFAULT_MODAL_DATA);
  }, []);

  /**
   * Toggle a modal (open if closed, close if open)
   */
  const toggleModal = useCallback((name: PortfolioModalName) => {
    setModals(prev => ({
      ...prev,
      [name]: !prev[name],
    }));
  }, []);

  // ============================================================
  // Convenience methods for specific modals
  // ============================================================

  /**
   * Open the sell modal with a specific holding
   */
  const openSellModal = useCallback((holding: PortfolioHolding) => {
    setModalData(prev => ({ ...prev, sellingHolding: holding }));
    openModal('sell');
  }, [openModal]);

  /**
   * Open the buy modal (optionally with a pre-selected symbol)
   */
  const openBuyModal = useCallback((symbol?: string) => {
    if (symbol) {
      setModalData(prev => ({ ...prev, buyingSymbol: symbol }));
    }
    openModal('buy');
  }, [openModal]);

  /**
   * Open the import/export modal
   */
  const openImportExportModal = useCallback(() => {
    openModal('importExport');
  }, [openModal]);

  /**
   * Open the wallet management modal
   */
  const openWalletManagementModal = useCallback(() => {
    openModal('walletManagement');
  }, [openModal]);

  /**
   * Open the debug panel
   */
  const openDebugPanel = useCallback(() => {
    openModal('debug');
  }, [openModal]);

  /**
   * Open the edit goal modal with a specific goal
   */
  const openEditGoalModal = useCallback((goal: Goal) => {
    setModalData(prev => ({ ...prev, editingGoal: goal }));
    openModal('editGoal');
  }, [openModal]);

  /**
   * Open the contribute to goal modal
   */
  const openContributeModal = useCallback((goal: Goal) => {
    setModalData(prev => ({ ...prev, contributeGoal: goal }));
    openModal('contributeGoal');
  }, [openModal]);

  /**
   * Open the holding detail modal
   */
  const openHoldingDetailModal = useCallback((holding: PortfolioHolding) => {
    setModalData(prev => ({ ...prev, holdingDetailData: holding }));
    openModal('holdingDetail');
  }, [openModal]);

  /**
   * Check if any modal is open
   */
  const isAnyModalOpen = Object.values(modals).some(isOpen => isOpen);

  return {
    // Modal state
    modals,
    modalData,

    // Generic methods
    openModal,
    closeModal,
    closeAllModals,
    toggleModal,

    // Convenience methods for specific modals
    openSellModal,
    openBuyModal,
    openImportExportModal,
    openWalletManagementModal,
    openDebugPanel,
    openEditGoalModal,
    openContributeModal,
    openHoldingDetailModal,

    // Utility
    isAnyModalOpen,
  };
}

/**
 * Return type of usePortfolioModals hook
 * Useful for prop typing in child components
 */
export type PortfolioModalsState = ReturnType<typeof usePortfolioModals>;
