
// Goal Categories
export const GOAL_CATEGORIES = [
  { id: 'emergency_fund', name: 'Emergency Fund', icon: '🆘', color: '#ef4444' },
  { id: 'retirement', name: 'Retirement', icon: '🏖️', color: '#10b981' },
  { id: 'house_down_payment', name: 'House Down Payment', icon: '🏠', color: '#3b82f6' },
  { id: 'vacation', name: 'Vacation', icon: '✈️', color: '#f59e0b' },
  { id: 'car_purchase', name: 'Car Purchase', icon: '🚗', color: '#8b5cf6' },
  { id: 'education', name: 'Education', icon: '📚', color: '#06b6d4' },
  { id: 'debt_payoff', name: 'Debt Payoff', icon: '💳', color: '#ef4444' },
  { id: 'investment', name: 'Investment', icon: '📈', color: '#10b981' },
  { id: 'savings', name: 'Savings', icon: '🐷', color: '#14b8a6' },
  { id: 'other', name: 'Other', icon: '🎯', color: '#6b7280' },
];

// Currency Configuration - TWD first as default for Taiwan market
export const CURRENCIES = [
  { code: 'TWD', name: 'Taiwan Dollar', symbol: 'NT$', flag: '🇹🇼', isDefault: true },
  { code: 'USD', name: 'US Dollar', symbol: '$', flag: '🇺🇸' },
  { code: 'HKD', name: 'Hong Kong Dollar', symbol: 'HK$', flag: '🇭🇰' },
  { code: 'JPY', name: 'Japanese Yen', symbol: '¥', flag: '🇯🇵' },
  { code: 'CNY', name: 'Chinese Yuan', symbol: '¥', flag: '🇨🇳' },
  { code: 'KRW', name: 'South Korean Won', symbol: '₩', flag: '🇰🇷' },
  { code: 'SGD', name: 'Singapore Dollar', symbol: 'S$', flag: '🇸🇬' },
  { code: 'MYR', name: 'Malaysian Ringgit', symbol: 'RM', flag: '🇲🇾' },
  { code: 'THB', name: 'Thai Baht', symbol: '฿', flag: '🇹🇭' },
  { code: 'VND', name: 'Vietnamese Dong', symbol: '₫', flag: '🇻🇳' },
  { code: 'IDR', name: 'Indonesian Rupiah', symbol: 'Rp', flag: '🇮🇩' },
  { code: 'PHP', name: 'Philippine Peso', symbol: '₱', flag: '🇵🇭' },
  // Cryptocurrency
  { code: 'BTC', name: 'Bitcoin', symbol: '₿', flag: '₿', isCrypto: true },
  { code: 'ETH', name: 'Ethereum', symbol: 'Ξ', flag: 'Ξ', isCrypto: true },
  { code: 'USDT', name: 'Tether', symbol: 'USDT', flag: '₮', isCrypto: true },
  { code: 'USDC', name: 'USD Coin', symbol: 'USDC', flag: 'USDC', isCrypto: true },
  { code: 'BNB', name: 'Binance Coin', symbol: 'BNB', flag: 'BNB', isCrypto: true },
  { code: 'ADA', name: 'Cardano', symbol: 'ADA', flag: 'ADA', isCrypto: true },
  { code: 'DOT', name: 'Polkadot', symbol: 'DOT', flag: 'DOT', isCrypto: true },
  { code: 'SOL', name: 'Solana', symbol: 'SOL', flag: 'SOL', isCrypto: true },
];

// Default currency for the Taiwan market
export const DEFAULT_CURRENCY = 'TWD';