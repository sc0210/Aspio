
// User types
export interface User {
  id: string;
  email: string;
  name: string;
  username?: string;
  avatar_url?: string;
  is_active: boolean;
  is_verified: boolean;
  google_id?: string;
  experience_points: number;
  level: number;
  role: UserRole;
  created_at: Date;
  updated_at: Date;
  preferences?: UserPreferences;
  profile?: UserProfile;
  preferred_currency?: string; // e.g. 'TWD' — apiClient.getCurrentUser() does no key transform, so this stays snake_case
}

export type UserRole = 'USER' | 'PREMIUM' | 'ADMIN' | 'SUPER_ADMIN';
// API Response Types
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  holdings?: T;
  transactions?: T;
  categories?: T;
  message?: string;
  errors?: string[];
  meta?: PaginationMeta;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  total_pages: number;
  has_next: boolean;
  has_previous: boolean;
  hasNext?: boolean; // Legacy support
  hasPrevious?: boolean; // Legacy support
}

// Auth API Types
export interface LoginRequest {
  email: string;
  password: string;
  remember_me?: boolean;
}
export interface RegisterRequest {
  name: string;
  email: string;
  password: string;
  confirm_password: string;
  terms_accepted: boolean;
  referral_code?: string;
  preferences?: UserPreferences;
}
export interface UserProfile {
  date_of_birth?: Date;
  occupation?: string;
  monthly_income?: number;
  risk_tolerance?: 'conservative' | 'moderate' | 'aggressive';
}

export type Goal = FinancialGoal;

export interface UserPreferences {
  currency: string;
  language: string;
  locale: string;
  timezone: string;
  dateFormat: 'western' | 'roc' | 'iso'; // western, ROC (Republic of China), ISO
  numberFormat: 'western' | 'asian'; // western (1,000.00) vs asian (10,000 based)
  notifications: NotificationSettings;
}

export interface NotificationSettings {
  email: boolean;
  push: boolean;
  sms?: boolean;
  goalReminders: boolean;
  transactionAlerts: boolean;
}

// Transaction types
export interface Transaction {
  id: string;
  userId: string;
  type: 'income' | 'expense' | 'transfer';
  amount: number;
  currency: string;
  category: string;
  subcategory?: string;
  description: string;
  date: string | Date; // Allow both string (ISO) and Date for flexibility
  paymentMethod?: string;
  walletType?: 'life' | 'emergency'; // Wallet classification
  tags?: string[];
  location?: string;
  isRecurring?: boolean;
  recurringRule?: RecurringRule;
  transferGroupId?: string; // Links both legs of a wallet transfer; unset for regular income/expense rows
  loanId?: string; // The loan this expense pays down; unset for ordinary spending
  createdAt: Date;
  updatedAt: Date;
}

export interface RecurringRule {
  frequency: 'daily' | 'weekly' | 'monthly' | 'yearly';
  interval: number;
  endDate?: Date;
  occurrences?: number;
}

export interface TransactionCategory {
  id: string;
  name: string;
  type: 'income' | 'expense';
  color: string;
  icon: string;
  parentId?: string;
  isDefault: boolean;
}

// Investment Portfolio types
export interface Portfolio {
  id: string;
  userId: string;
  name: string;
  description?: string;
  holdings: PortfolioHolding[];
  totalValue: number;
  totalCost: number;
  totalGainLoss: number;
  totalGainLossPercentage: number;
  todayGainLoss: number;
  todayGainLossPercentage: number;
  currency: string;
  isDefault: boolean;
  isActive: boolean;
  autoUpdate: boolean;
  lastPriceUpdateAt?: Date;
  metadata: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
  cashWallet?: Array<{ currency: string; balance: number; symbol: string; walletType: string; name: string }>;
}

export interface PortfolioHolding {
  id: string;
  userId?: string;
  symbol: string;
  name: string;
  type: 'stock' | 'etf' | 'crypto' | 'cryptocurrency' | 'bond' | 'mutual_fund' | 'cash' | 'reit' | 'commodity';
  walletType?: 'portfolio' | 'emergency'; // Wallet classification
  quantity: number;
  averageCost: number;
  currentPrice: number;
  totalValue: number;
  totalCost: number;
  gainLoss: number;
  gainLossPercentage: number;
  irr?: number; // Annualized Internal Rate of Return (as decimal, e.g., 0.15 = 15%)
  currency: string;
  exchange: string;
  market?: MarketType;
  sector?: string;
  region?: string;
  previousClose?: number;      // Previous trading day's closing price
  dayChange?: number;          // Absolute P&L vs previous close (quantity × price diff)
  dayChangePercentage?: number; // % change vs previous close
  purchaseDate?: string;
  /** No feed prices this holding (cash, crypto, lending), so the user sets its value. */
  manuallyPriced?: boolean;
  priceHistory?: PricePoint[];
  sparklineData?: number[]; // Historical price data for sparkline (last 30 days)
  lastUpdated: Date;
  metadata?: {
    isAggregated?: boolean;
    lotCount?: number;
    purchaseDates?: (string | null | undefined)[];
    [key: string]: any;
  };
}

export type MarketType = 'US' | 'TW' | 'CRYPTO' | 'HK' | 'SG' | 'JP';

export interface MarketData {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  marketCap?: number;
  market: MarketType;
  currency: string;
  exchange: string;
  lastUpdated: Date;
  priceHistory?: PricePoint[];
}

export interface PricePoint {
  timestamp: Date;
  price: number;
  volume?: number;
}

export interface MarketDataCache {
  symbol: string;
  market: MarketType;
  data: MarketData;
  cachedAt: Date;
  expiresAt: Date;
}

export interface MarketDataProvider {
  name: string;
  type: 'tradingview' | 'finlab' | 'binance' | 'custom';
  markets: MarketType[];
  rateLimit: {
    requestsPerMinute: number;
    requestsPerHour: number;
    requestsPerDay: number;
  };
  lastRequestAt?: Date;
  requestCount: {
    minute: number;
    hour: number;
    day: number;
  };
}

export interface StockQuote {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  open: number;
  high: number;
  low: number;
  close: number;
  previousClose: number;
  marketCap?: number;
  pe?: number;
  dividendYield?: number;
  market: MarketType;
  currency: string;
  exchange: string;
  lastUpdated: Date;
}

// Financial Goals types
export interface FinancialGoal {
  id: string;
  userId: string;
  title: string;
  description?: string;
  targetAmount: number;
  currentAmount: number;
  currency: string;
  targetDate: Date;
  category: GoalCategory;
  status: 'active' | 'completed' | 'paused';
  priority: 'low' | 'medium' | 'high';
  milestones: GoalMilestone[];
  contributions: GoalContribution[];
  createdAt: Date;
  updatedAt: Date;
}

export type GoalCategory =
  | 'emergency_fund'
  | 'retirement'
  | 'house_down_payment'
  | 'vacation'
  | 'car_purchase'
  | 'education'
  | 'debt_payoff'
  | 'investment'
  | 'other'
  // Asian market specific categories
  | 'hdb_flat_purchase'
  | 'cpf_savings'
  | 'epf_savings'
  | 'children_education'
  | 'elderly_care'
  | 'wedding_expenses'
  | 'lunar_new_year'
  | 'gold_investment'
  | 'property_investment'
  | 'business_capital'
  | 'overseas_study'
  | 'medical_fund';

export interface GoalMilestone {
  id: string;
  title: string;
  description?: string;
  amount: number;
  targetDate: Date;
  isCompleted: boolean;
  completedAt?: Date;
  reward?: string;
}

export interface GoalContribution {
  id: string;
  amount: number;
  date: Date;
  note?: string;
}
// Budget types
export interface Budget {
  id: string;
  userId: string;
  name: string;
  period: 'monthly' | 'quarterly' | 'yearly';
  startDate: Date;
  endDate: Date;
  categories: BudgetCategory[];
  totalBudget: number;
  totalSpent: number;
  currency: string;
  status: 'active' | 'completed' | 'draft';
  createdAt: Date;
  updatedAt: Date;
}

export interface BudgetCategory {
  categoryId: string;
  categoryName: string;
  budgetAmount: number;
  spentAmount: number;
  remainingAmount: number;
  percentageUsed: number;
}

// Notification types
export interface Notification {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  data?: Record<string, any>;
  isRead: boolean;
  priority: 'low' | 'medium' | 'high';
  createdAt: Date;
  readAt?: Date;
}

export type NotificationType =
  | 'goal_milestone'
  | 'budget_alert'
  | 'transaction_reminder'
  | 'achievement_unlocked'
  | 'investment_alert'
  | 'security_alert'
  | 'system_update';

// Authentication types
export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  user: User;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  email: string;
  name: string;
  password: string;
  confirm_password: string;
  terms_accepted: boolean;
  preferences?: UserPreferences;
}
export interface PaginationParams {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

// Chart data types
export interface ChartDataPoint {
  date: string;
  value: number;
  label?: string;
  color?: string;
}
interface FamilyGoalGroup {
  id: string;
  groupName: string;
  groupType: string;
  description?: string;
  createdByUserId: string;
  primaryAdminUserId: string;
  maxMembers: number;
  invitationCode?: string;
  isPrivate: boolean;
  requiresApproval: boolean;
  culturalBackground?: string;
  primaryLanguage: string;
  regionalFocus?: string;
  sharedGoals?: string[];
  groupSavingsTarget?: number;
  groupCurrency: string;
  enableGroupChat: boolean;
  notificationPreferences?: Record<string, any>;
  celebrationPreferences?: Record<string, any>;
  isActive: boolean;
  memberCount: number;
  groupMetadata?: Record<string, any>;
  members?: FamilyGoalMember[];
  createdAt: Date;
  updatedAt: Date;
}

interface FamilyGoalMember {
  id: string;
  groupId: string;
  userId: string;
  role: 'admin' | 'co_admin' | 'member' | 'viewer';
  contributionPercentage?: number;
  relationshipToAdmin?: string;
  displayName?: string;
  joinStatus: 'pending' | 'active' | 'inactive';
  joinedAt?: Date;
  invitedAt: Date;
  lastActive?: Date;
  notificationEnabled: boolean;
  showInLeaderboard: boolean;
  memberMetadata?: Record<string, any>;
  group?: FamilyGoalGroup;
  createdAt: Date;
  updatedAt: Date;
}
// Peer comparison types
export interface PeerUserPreview {
  id: string;
  /** Nullable: users can exist without one (peers/schemas.py, users.models). */
  username: string | null;
  name: string;
  avatar_url: string | null;
}

export interface PeerConnectionOut {
  id: string;
  other_user: PeerUserPreview;
  status: 'pending' | 'accepted' | 'declined' | 'removed';
  direction: 'sent' | 'received';
  created_at: string;
}

export interface WalletTotals {
  portfolio_total: number;
  emergency_total: number;
  cash_total: number;
  life_total: number;
  /** Outstanding balance of active loans; net_worth is net of it. */
  debt_total: number;
  net_worth: number;
}

export interface PeerStatCard {
  user_id: string;
  /** Nullable: see PeerUserPreview. */
  username: string | null;
  name: string;
  avatar_url: string | null;
  is_self: boolean;
  wallet_totals: WalletTotals;
}

export interface CompareDataResponse {
  users: PeerStatCard[];
  chart: Array<{ date: string; [userId: string]: number | string }>;
}

// Shared savings goal types
export interface SharedGoalOut {
  id: string;
  connection_id: string;
  title: string;
  target_amount: number;
  target_date: string | null;
  status: 'active' | 'completed' | 'cancelled';
  your_amount: number;
  peer_amount: number;
  your_name: string;
  peer_name: string;
  your_user_id: string;
  peer_user_id: string;
  total_amount: number;
  progress_pct: number;
  is_creator: boolean;
  created_at: string;
}

export interface SharedGoalCreate {
  connection_id: string;
  title: string;
  target_amount: number;
  target_date?: string | null;
}

export interface SavingRecord {
  id: string;
  goal_id: string;
  user_id: string;
  user_name: string;
  amount: number;
  record_date: string;
  note: string | null;
  created_at: string;
}
