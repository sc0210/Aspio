/**
 * Cost Basis Calculation Utilities
 *
 * Supports different cost basis methods:
 * - FIFO (First In, First Out)
 * - LIFO (Last In, First Out)
 * - Average Cost
 * - Specific Lot Identification
 */

export interface Lot {
  id: string;
  purchaseDate: Date;
  quantity: number;
  costPerShare: number;
  totalCost: number;
}

interface SaleLot {
  lotId: string;
  quantitySold: number;
  costBasis: number;
  purchaseDate: Date;
}

export type CostBasisMethod = 'FIFO' | 'LIFO' | 'AVERAGE' | 'SPECIFIC';

/**
 * Calculate cost basis for a sale using specified method
 */
export function calculateCostBasis(
  lots: Lot[],
  quantityToSell: number,
  method: CostBasisMethod,
  specificLotIds?: string[]
): {
  saleLots: SaleLot[];
  totalCostBasis: number;
  remainingLots: Lot[];
} {
  if (quantityToSell <= 0) {
    throw new Error('Quantity to sell must be greater than 0');
  }

  const totalAvailable = lots.reduce((sum, lot) => sum + lot.quantity, 0);
  if (quantityToSell > totalAvailable) {
    throw new Error(`Insufficient quantity. Available: ${totalAvailable}, Requested: ${quantityToSell}`);
  }

  switch (method) {
    case 'FIFO':
      return calculateFIFO(lots, quantityToSell);
    case 'LIFO':
      return calculateLIFO(lots, quantityToSell);
    case 'AVERAGE':
      return calculateAverage(lots, quantityToSell);
    case 'SPECIFIC':
      return calculateSpecific(lots, quantityToSell, specificLotIds || []);
    default:
      throw new Error(`Unknown cost basis method: ${method}`);
  }
}

/**
 * FIFO - First In, First Out
 * Sells oldest lots first
 */
function calculateFIFO(lots: Lot[], quantityToSell: number) {
  // Sort by purchase date (oldest first)
  const sortedLots = [...lots].sort((a, b) =>
    a.purchaseDate.getTime() - b.purchaseDate.getTime()
  );

  return allocateSale(sortedLots, quantityToSell);
}

/**
 * LIFO - Last In, First Out
 * Sells newest lots first
 */
function calculateLIFO(lots: Lot[], quantityToSell: number) {
  // Sort by purchase date (newest first)
  const sortedLots = [...lots].sort((a, b) =>
    b.purchaseDate.getTime() - a.purchaseDate.getTime()
  );

  return allocateSale(sortedLots, quantityToSell);
}

/**
 * Average Cost Method
 * Uses average cost per share across all lots
 */
function calculateAverage(lots: Lot[], quantityToSell: number) {
  const totalQuantity = lots.reduce((sum, lot) => sum + lot.quantity, 0);
  const totalCost = lots.reduce((sum, lot) => sum + lot.totalCost, 0);
  const averageCostPerShare = totalCost / totalQuantity;

  // For average cost, we still need to track which lots were used
  // But the cost basis is calculated using average cost
  const sortedLots = [...lots].sort((a, b) =>
    a.purchaseDate.getTime() - b.purchaseDate.getTime()
  );

  const saleLots: SaleLot[] = [];
  const remainingLots: Lot[] = [];
  let remainingToSell = quantityToSell;

  for (const lot of sortedLots) {
    if (remainingToSell <= 0) {
      remainingLots.push({ ...lot });
      continue;
    }

    if (lot.quantity <= remainingToSell) {
      // Use entire lot
      saleLots.push({
        lotId: lot.id,
        quantitySold: lot.quantity,
        costBasis: lot.quantity * averageCostPerShare,
        purchaseDate: lot.purchaseDate
      });
      remainingToSell -= lot.quantity;
    } else {
      // Use partial lot
      saleLots.push({
        lotId: lot.id,
        quantitySold: remainingToSell,
        costBasis: remainingToSell * averageCostPerShare,
        purchaseDate: lot.purchaseDate
      });

      remainingLots.push({
        ...lot,
        quantity: lot.quantity - remainingToSell,
        totalCost: (lot.quantity - remainingToSell) * averageCostPerShare
      });
      remainingToSell = 0;
    }
  }

  const totalCostBasis = saleLots.reduce((sum, sale) => sum + sale.costBasis, 0);

  return { saleLots, totalCostBasis, remainingLots };
}

/**
 * Specific Lot Identification
 * User specifies exactly which lots to sell
 */
function calculateSpecific(lots: Lot[], quantityToSell: number, specificLotIds: string[]) {
  if (specificLotIds.length === 0) {
    throw new Error('Specific lot IDs must be provided for SPECIFIC cost basis method');
  }

  const selectedLots = lots.filter(lot => specificLotIds.includes(lot.id));
  const unselectedLots = lots.filter(lot => !specificLotIds.includes(lot.id));

  if (selectedLots.length === 0) {
    throw new Error('No valid lots found with specified IDs');
  }

  const totalSelected = selectedLots.reduce((sum, lot) => sum + lot.quantity, 0);
  if (totalSelected < quantityToSell) {
    throw new Error(`Selected lots have insufficient quantity. Available: ${totalSelected}, Requested: ${quantityToSell}`);
  }

  // Sort selected lots by purchase date
  const sortedSelected = selectedLots.sort((a, b) =>
    a.purchaseDate.getTime() - b.purchaseDate.getTime()
  );

  const result = allocateSale(sortedSelected, quantityToSell);

  // Add unselected lots to remaining
  result.remainingLots.push(...unselectedLots);

  return result;
}

/**
 * Helper function to allocate a sale across lots
 */
function allocateSale(sortedLots: Lot[], quantityToSell: number) {
  const saleLots: SaleLot[] = [];
  const remainingLots: Lot[] = [];
  let remainingToSell = quantityToSell;

  for (const lot of sortedLots) {
    if (remainingToSell <= 0) {
      // No more to sell, keep entire lot
      remainingLots.push({ ...lot });
      continue;
    }

    if (lot.quantity <= remainingToSell) {
      // Sell entire lot
      saleLots.push({
        lotId: lot.id,
        quantitySold: lot.quantity,
        costBasis: lot.totalCost,
        purchaseDate: lot.purchaseDate
      });
      remainingToSell -= lot.quantity;
    } else {
      // Sell partial lot
      const quantitySold = remainingToSell;
      const costPerShare = lot.totalCost / lot.quantity;

      saleLots.push({
        lotId: lot.id,
        quantitySold,
        costBasis: quantitySold * costPerShare,
        purchaseDate: lot.purchaseDate
      });

      // Keep remaining portion
      remainingLots.push({
        ...lot,
        quantity: lot.quantity - quantitySold,
        totalCost: (lot.quantity - quantitySold) * costPerShare
      });

      remainingToSell = 0;
    }
  }

  const totalCostBasis = saleLots.reduce((sum, sale) => sum + sale.costBasis, 0);

  return { saleLots, totalCostBasis, remainingLots };
}
/**
 * Format cost basis method for display
 */
export function formatCostBasisMethod(method: CostBasisMethod): string {
  const names = {
    FIFO: 'First In, First Out (FIFO)',
    LIFO: 'Last In, First Out (LIFO)',
    AVERAGE: 'Average Cost',
    SPECIFIC: 'Specific Lot'
  };
  return names[method];
}
