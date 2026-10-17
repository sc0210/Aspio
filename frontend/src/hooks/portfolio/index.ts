/**
 * Portfolio Hooks
 *
 * Centralized exports for all portfolio-related custom hooks.
 * These hooks encapsulate state management and data fetching logic
 * for the portfolio page, replacing 23+ individual useState declarations.
 *
 * @module hooks/portfolio
 */

// View state management
export { usePortfolioViewState } from './usePortfolioViewState';

// Filter and sort management
export { usePortfolioFilters } from './usePortfolioFilters';

// Modal state management
export { usePortfolioModals } from './usePortfolioModals';

// Edit state management
export { usePortfolioEdit } from './usePortfolioEdit';

// Data fetching
export { usePortfolioData } from './usePortfolioData';

// Price operations
export { usePortfolioPriceOperations } from './usePortfolioPriceOperations';

// User actions
export { usePortfolioActions } from './usePortfolioActions';

// Holding CRUD operations (delete, update lot, update symbol, sell/buy from list)
export { usePortfolioHoldingOperations } from './usePortfolioHoldingOperations';
