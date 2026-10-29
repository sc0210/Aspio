/**
 * The choices the add-holding and edit-holding pages offer, in one place.
 *
 * Each page used to keep its own copy, and they drifted: edit lost REIT,
 * commodity and cash, and the two sector lists disagreed. Saving still kept a
 * holding's stored value, but the edit page showed no type or sector picked for
 * anything outside its own list.
 */

/** Every type the backend accepts. 'cryptocurrency' is a legacy alias of 'crypto' with no picker entry. */
export const INVESTMENT_TYPES = ['stock', 'etf', 'crypto', 'cryptocurrency', 'bond', 'mutual_fund', 'reit', 'commodity', 'cash', 'lending'] as const;

export const investmentTypes = [
  { value: 'stock', label: 'Stock', description: 'Individual company shares' },
  { value: 'etf', label: 'ETF', description: 'Exchange-traded funds' },
  { value: 'crypto', label: 'Cryptocurrency', description: 'Digital assets' },
  { value: 'bond', label: 'Bond', description: 'Government or corporate bonds' },
  { value: 'mutual_fund', label: 'Mutual Fund', description: 'Managed investment funds' },
  { value: 'reit', label: 'REIT', description: 'Real Estate Investment Trust' },
  { value: 'commodity', label: 'Commodity', description: 'Raw materials and commodities' },
  { value: 'cash', label: 'Cash/Savings', description: 'Cash holdings and savings accounts' },
  { value: 'lending', label: 'Lending', description: 'Interest-earning lending positions' },
];

export const currencies = [
  { value: 'TWD', label: 'TWD - Taiwan Dollar' },
  { value: 'SGD', label: 'SGD - Singapore Dollar' },
  { value: 'USD', label: 'USD - US Dollar' },
  { value: 'EUR', label: 'EUR - Euro' },
  { value: 'GBP', label: 'GBP - British Pound' },
  { value: 'JPY', label: 'JPY - Japanese Yen' },
  { value: 'HKD', label: 'HKD - Hong Kong Dollar' },
  { value: 'MYR', label: 'MYR - Malaysian Ringgit' },
  { value: 'THB', label: 'THB - Thai Baht' },
  { value: 'CNY', label: 'CNY - Chinese Yuan' },
];

export const exchanges = [
  { value: 'TWSE', label: 'Taiwan Stock Exchange (TWSE)' },
  { value: 'SGX', label: 'Singapore Exchange (SGX)' },
  { value: 'NYSE', label: 'New York Stock Exchange (NYSE)' },
  { value: 'NASDAQ', label: 'NASDAQ' },
  { value: 'LSE', label: 'London Stock Exchange (LSE)' },
  { value: 'HKEX', label: 'Hong Kong Exchange (HKEX)' },
  { value: 'TSE', label: 'Tokyo Stock Exchange (TSE)' },
  { value: 'KLSE', label: 'Bursa Malaysia (KLSE)' },
  { value: 'SET', label: 'Stock Exchange of Thailand (SET)' },
];

// The union of both old lists: holdings saved from either page carry these values.
export const sectors = [
  'Technology',
  'Financial Services',
  'Financials',
  'Healthcare',
  'Consumer Discretionary',
  'Consumer Staples',
  'Energy',
  'Industrials',
  'Materials',
  'Real Estate',
  'Utilities',
  'Communication Services',
  'Telecommunications',
  'Cryptocurrency',
];
