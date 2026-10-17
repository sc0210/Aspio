'use client';

import dynamic from 'next/dynamic';
import toast from 'react-hot-toast';
import type { PortfolioModalsState } from '@/hooks/portfolio/usePortfolioModals';
import type { PortfolioHolding } from '@/shared/types';
import { portfolioService } from '@/services/portfolioService';

// All modals are heavy (400-800 lines each, pull in form libraries + Recharts).
// Lazy-loading them means their JS is only fetched when the user first opens a modal,
// saving ~120 KB from the portfolio page's initial bundle.
const SellHoldingModal = dynamic(
  () => import('@/components/portfolio/SellHoldingModal').then(m => ({ default: m.SellHoldingModal })),
  { ssr: false }
);
const BuyHoldingModal = dynamic(
  () => import('@/components/portfolio/BuyHoldingModal').then(m => ({ default: m.BuyHoldingModal })),
  { ssr: false }
);
const ImportExportModal = dynamic(
  () => import('@/components/portfolio/ImportExportModal').then(m => ({ default: m.ImportExportModal })),
  { ssr: false }
);
const WalletManagementModal = dynamic(
  () => import('@/components/portfolio/WalletManagementModal').then(m => ({ default: m.WalletManagementModal })),
  { ssr: false }
);
const EditGoalModal = dynamic(
  () => import('@/components/goals/EditGoalModal').then(m => ({ default: m.EditGoalModal })),
  { ssr: false }
);
const ContributeModal = dynamic(
  () => import('@/components/goals/ContributeModal').then(m => ({ default: m.ContributeModal })),
  { ssr: false }
);

interface PortfolioModalsContainerProps {
  /** Modals state from usePortfolioModals */
  modals: PortfolioModalsState;
  /** Callback when portfolio data needs to be refreshed */
  onRefreshPortfolio: () => void;
  /** Raw holdings list passed to ImportExportModal for export */
  rawHoldings?: unknown[];
  /** Aggregated, non-cash holdings the user can sell (for the sell modal's picker) */
  sellableHoldings?: PortfolioHolding[];
}

/**
 * Portfolio modals container component
 *
 * Centralized container for all portfolio-related modals.
 * This component conditionally renders modals based on the modal state
 * from usePortfolioModals hook.
 */
export function PortfolioModalsContainer({
  modals,
  onRefreshPortfolio,
  rawHoldings = [],
  sellableHoldings = [],
}: PortfolioModalsContainerProps) {
  // Non-cash positions the user can pick from when selling without a pre-selected holding.
  const sellPickList = sellableHoldings.filter(
    (h) => !h.symbol?.toUpperCase().startsWith('CASH-'),
  );

  return (
    <>
      {/* Sell Holding Modal */}
      {modals.modals.sell && (
        <SellHoldingModal
          isOpen={modals.modals.sell}
          onClose={() => modals.closeModal('sell')}
          onSell={async (params) => {
            // Persist the sale. Errors propagate to the modal, which keeps it open
            // and shows the message inline; we only close/refresh on success.
            const result = await portfolioService.sellHolding({
              holdingId: params.holdingId,
              quantity: params.quantity,
              price: params.price,
              fees: params.fees,
              taxes: params.taxes,
              notes: params.notes,
            });
            const sold = result.data;
            toast.success(
              sold
                ? `Sold ${sold.quantitySold} ${sold.symbol} · realized ${sold.realizedGainLoss >= 0 ? '+' : ''}${sold.realizedGainLoss.toFixed(2)}`
                : 'Holding sold',
            );
            modals.closeModal('sell');
            onRefreshPortfolio();
          }}
          existingHoldings={
            (modals.modalData.sellingHolding
              ? [modals.modalData.sellingHolding]
              : sellPickList) as never
          }
          preSelectedHolding={modals.modalData.sellingHolding || undefined}
        />
      )}

      {/* Buy Holding Modal */}
      {modals.modals.buy && (
        <BuyHoldingModal
          isOpen={modals.modals.buy}
          onClose={() => modals.closeModal('buy')}
          onBuy={async () => {
            modals.closeModal('buy');
            onRefreshPortfolio();
          }}
        />
      )}

      {/* Import/Export Modal */}
      {modals.modals.importExport && (
        <ImportExportModal
          holdings={rawHoldings as never[]}
          onClose={() => modals.closeModal('importExport')}
          onImportSuccess={() => {
            modals.closeModal('importExport');
            onRefreshPortfolio();
          }}
        />
      )}

      {/* Wallet Management Modal */}
      {modals.modals.walletManagement && (
        <WalletManagementModal
          isOpen={modals.modals.walletManagement}
          onClose={() => modals.closeModal('walletManagement')}
          onDeposit={async () => {
            modals.closeModal('walletManagement');
            onRefreshPortfolio();
          }}
          onWithdraw={async () => {
            modals.closeModal('walletManagement');
            onRefreshPortfolio();
          }}
        />
      )}

      {/* Edit Goal Modal */}
      {modals.modalData.editingGoal && (
        <EditGoalModal
          goal={modals.modalData.editingGoal as never}
          isOpen={!!modals.modalData.editingGoal}
          onClose={() => {
            modals.closeModal('editGoal');
            onRefreshPortfolio();
          }}
        />
      )}

      {/* Contribute to Goal Modal */}
      {modals.modalData.contributeGoal && (
        <ContributeModal
          isOpen={!!modals.modalData.contributeGoal}
          onClose={() => {
            modals.closeModal('contributeGoal');
            onRefreshPortfolio();
          }}
          goalId={modals.modalData.contributeGoal?.id || ''}
          goalTitle={modals.modalData.contributeGoal?.title || ''}
          currentAmount={modals.modalData.contributeGoal?.currentAmount || 0}
          targetAmount={modals.modalData.contributeGoal?.targetAmount || 0}
          currency={modals.modalData.contributeGoal?.currency || 'TWD'}
        />
      )}
    </>
  );
}
