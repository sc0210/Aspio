// Filter shape for the holdings table.
//
// This was the only part of the old AdvancedFiltering component that anything
// imported — the component itself was never mounted. HoldingsList takes these
// as props, though PortfolioHoldingsSection currently passes its own filter
// object through `as never`, so the two shapes have already drifted apart.
// Reconciling them is a separate job from deleting the dead component.

export interface AdvancedFilters {
  assetClasses?: string[];
  markets?: string[];
  dateRange?: {
    start: Date;
    end: Date;
  };
  performanceRange?: {
    min: number;
    max: number;
  };
  sortBy?: 'value' | 'gainLoss' | 'gainLossPercent' | 'symbol' | 'name';
  sortOrder?: 'asc' | 'desc';
}
