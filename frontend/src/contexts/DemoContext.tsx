'use client';

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { useSession } from 'next-auth/react';
import { User, Transaction, FinancialGoal, Portfolio } from '@/shared/types';
import { logger } from '@/utils/logger';
import { demoTransferPair } from '@/data/demoData';

// Demo data for realistic preview
const DEMO_USER: User = {
  id: 'demo-user',
  email: 'demo@aspiro.app',
  name: 'Alex Chen',
  avatar_url: '/avatars/demo-user.png',
  is_active: true,
  is_verified: true,
  role: 'USER',
  experience_points: 1250,
  level: 3,
  created_at: new Date('2024-01-01'),
  updated_at: new Date('2024-01-15'),
  preferences: {
    currency: 'TWD',
    language: 'en',
    locale: 'en-SG',
    timezone: 'Asia/Singapore',
    dateFormat: 'western',
    numberFormat: 'western',
    notifications: {
      email: true,
      push: true,
      goalReminders: true,
      transactionAlerts: true,
    }
  }
};

// Generate recent demo transactions
const generateRecentDemoTransactions = (): Transaction[] => {
  const now = new Date();
  const transactions: Transaction[] = [];

  // Add monthly salary (beginning of current month) - Based on cur_investment_plan.md
  const salaryDate = new Date(now.getFullYear(), now.getMonth(), 1);
  transactions.push({
    id: '2',
    userId: 'demo-user',
    type: 'income',
    amount: 63000.00, // 月薪（稅後、扣勞退）from investment plan
    currency: 'TWD',
    category: 'Salary',
    description: 'Monthly Salary - Tech Corp Taiwan',
    date: salaryDate,
    paymentMethod: 'Bank Transfer',
    tags: ['salary', 'monthly'],
    createdAt: salaryDate,
    updatedAt: salaryDate,
  });

  // The eleven complete months before this one carry the same salary and rent.
  // /housing averages the trailing 12 *complete* months, and with salary only in
  // the current month it read an income of 0 and a comfortable price of NT$0.
  for (let m = 1; m <= 11; m++) {
    const first = new Date(now.getFullYear(), now.getMonth() - m, 1);
    transactions.push({
      id: `salary-m${m}`,
      userId: 'demo-user',
      type: 'income',
      amount: 63000.00,
      currency: 'TWD',
      category: 'Salary',
      description: 'Monthly Salary - Tech Corp Taiwan',
      date: first,
      paymentMethod: 'Bank Transfer',
      tags: ['salary', 'monthly'],
      createdAt: first,
      updatedAt: first,
    });
    transactions.push({
      id: `rent-m${m}`,
      userId: 'demo-user',
      type: 'expense',
      amount: 10000.00,
      currency: 'TWD',
      category: 'Housing',
      description: 'Rent - Taipei Apartment (樓中樓含管理費與機車位)',
      date: first,
      paymentMethod: 'Bank Transfer',
      tags: ['rent', 'housing'],
      createdAt: first,
      updatedAt: first,
    });
  }

  // Add another recent income
  const bonusDate = new Date(now.getTime() - (5 * 24 * 60 * 60 * 1000)); // 5 days ago
  transactions.push({
    id: 'bonus-1',
    userId: 'demo-user',
    type: 'income',
    amount: 15000.00,
    currency: 'TWD',
    category: 'Bonus',
    description: 'Performance Bonus',
    date: bonusDate,
    paymentMethod: 'Bank Transfer',
    tags: ['bonus'],
    createdAt: bonusDate,
    updatedAt: bonusDate,
  });

  // Add rent (beginning of current month) - Based on cur_investment_plan.md
  transactions.push({
    id: '3',
    userId: 'demo-user',
    type: 'expense',
    amount: 10000.00, // 房租 from investment plan
    currency: 'TWD',
    category: 'Housing',
    description: 'Rent - Taipei Apartment (樓中樓含管理費與機車位)',
    date: salaryDate,
    paymentMethod: 'Bank Transfer',
    tags: ['rent', 'housing'],
    createdAt: salaryDate,
    updatedAt: salaryDate,
  });

  // Add recent transactions over the past few days with diverse categories
  const categories = [
    { name: 'Food & Dining', baseAmount: 200, variance: 300, method: 'Credit Card' },
    { name: 'Transportation', baseAmount: 80, variance: 120, method: 'EasyCard' },
    { name: 'Shopping', baseAmount: 600, variance: 800, method: 'Credit Card' },
    { name: 'Entertainment', baseAmount: 400, variance: 600, method: 'Credit Card' },
    { name: 'Healthcare', baseAmount: 1000, variance: 1500, method: 'Cash' },
    { name: 'Utilities', baseAmount: 1200, variance: 400, method: 'Bank Transfer' },
    { name: 'Education', baseAmount: 800, variance: 500, method: 'Bank Transfer' },
  ];

  for (let i = 1; i <= 25; i++) {
    const transactionDate = new Date(now.getTime() - (i * 24 * 60 * 60 * 1000));
    const category = categories[i % categories.length];
    const deterministicFraction = ((i * 37) % 100) / 100;
    transactions.push({
      id: `expense-${i}`,
      userId: 'demo-user',
      type: 'expense',
      amount: Math.round(category.baseAmount + deterministicFraction * category.variance),
      currency: 'TWD',
      category: category.name,
      description: `${category.name} expense ${i}`,
      date: transactionDate,
      paymentMethod: category.method,
      tags: [category.name.toLowerCase().replace(' & ', '-').replace(' ', '-')],
      createdAt: transactionDate,
      updatedAt: transactionDate,
    });
  }

  return transactions.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
};

// The generated set is all ordinary income and spending, so every figure that
// excludes wallet transfers looked identical to one that ignored them. The pair
// makes the difference visible in the one mode used to preview authed pages.
const DEMO_TRANSACTIONS: Transaction[] = [
  ...generateRecentDemoTransactions(),
  ...demoTransferPair,
];

/**
 * A date `months` from today (negative = in the past). Demo goals were pinned to
 * 2024–2025, so every one of them read Overdue; relative dates keep them live.
 */
const monthsFromNow = (months: number): Date => {
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  return d;
};

const DEMO_GOALS: FinancialGoal[] = [
  {
    id: '1',
    userId: 'demo-user',
    title: 'Emergency Fund',
    description: 'Build 6 months of living expenses as emergency fund',
    targetAmount: 25000,
    currentAmount: 15000,
    currency: 'TWD',
    targetDate: monthsFromNow(8),
    category: 'emergency_fund',
    status: 'active',
    priority: 'high',
    milestones: [
      {
        id: '1-1',
        title: '25% Complete',
        amount: 6250,
        targetDate: monthsFromNow(-6),
        isCompleted: true,
        completedAt: monthsFromNow(-7),
        reward: 'Treat yourself to a nice dinner',
      },
      {
        id: '1-2',
        title: '50% Complete',
        amount: 12500,
        targetDate: monthsFromNow(-2),
        isCompleted: true,
        completedAt: monthsFromNow(-3),
        reward: 'Weekend staycation',
      },
      {
        id: '1-3',
        title: '75% Complete',
        amount: 18750,
        targetDate: monthsFromNow(3),
        isCompleted: false,
      }
    ],
    contributions: [],
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-15'),
  },
  {
    id: '2',
    userId: 'demo-user',
    title: 'House Down Payment',
    description: 'Save for BTO flat down payment',
    targetAmount: 100000,
    currentAmount: 45000,
    currency: 'TWD',
    targetDate: monthsFromNow(26),
    category: 'house_down_payment',
    status: 'active',
    priority: 'high',
    milestones: [],
    contributions: [],
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-15'),
  },
  {
    id: '3',
    userId: 'demo-user',
    title: 'Japan Vacation',
    description: 'Two-week cherry blossom trip to Japan',
    targetAmount: 8000,
    currentAmount: 3200,
    currency: 'TWD',
    // Inside the default 90-day alert window at 40% funded, so the /goals
    // At-Risk card has one honest entry in demo.
    targetDate: monthsFromNow(2),
    category: 'vacation',
    status: 'active',
    priority: 'medium',
    milestones: [],
    contributions: [],
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-15'),
  },
  {
    // Retirement goal — currentAmount is deliberately 0.
    //
    // That is what a real one looks like: nothing is ever deposited into it, so
    // its progress comes from the portfolio via the isRetirementGoal override
    // rather than from stored contributions.
    //
    // Until this existed, no demo goal was a retirement goal, so that override
    // was unreachable in demo mode — which is how the compact and mobile
    // dashboards shipped rendering it as "NT$0 · 0%" beside a multi-million
    // portfolio. Demo now exercises the path.
    //
    // Keep currentAmount at 0: a non-zero value masks the override and puts the
    // blind spot straight back.
    id: '4',
    userId: 'demo-user',
    title: 'Retirement Fund',
    description: 'FIRE target — funded by the portfolio, not by deposits',
    targetAmount: 6000000,
    currentAmount: 0,
    currency: 'TWD',
    targetDate: new Date('2045-01-01'),
    category: 'retirement',
    status: 'active',
    priority: 'high',
    milestones: [],
    contributions: [],
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-15'),
  }
];

// Based on cur_investment_plan.md: 60% 0050 (NT$1.5M), 20% VT (NT$500k)
export const DEMO_PORTFOLIO: Portfolio = {
  id: 'demo-portfolio',
  userId: 'demo-user',
  name: 'Investment Portfolio',
  holdings: [
    {
      id: '1',
      symbol: '0050',
      name: '元大台灣50 ETF',
      type: 'etf',
      quantity: 10000,
      averageCost: 145.00,
      currentPrice: 150.00,
      totalValue: 1500000,
      totalCost: 1450000,
      gainLoss: 50000,
      gainLossPercentage: 3.4,
      currency: 'TWD',
      exchange: 'TWSE',
      market: 'TW',
      sector: 'Taiwan Market ETF',
      lastUpdated: new Date(),
    },
    {
      id: '2',
      symbol: 'VT',
      name: 'Vanguard Total World Stock ETF',
      type: 'etf',
      // 481 x 100 is 48,100, not 500,000, and the row declared USD while
      // carrying plainly TWD figures — so the holdings table showed a price
      // that did not produce the value beside it. Matches DEMO_HOLDINGS in
      // backend/app/modules/portfolio/routers/_shared.py.
      quantity: 125,
      averageCost: 3800.00,
      currentPrice: 4000.00,
      totalValue: 500000,
      totalCost: 475000,
      gainLoss: 25000,
      gainLossPercentage: 5.3,
      currency: 'TWD',
      exchange: 'NYSE',
      market: 'US',
      sector: 'Global Market ETF',
      lastUpdated: new Date(),
    }
  ],
  totalValue: 2000000,           // Total: NT$2M
  totalCost: 1925000,            // Total cost basis
  totalGainLoss: 75000,          // Total gains: NT$75k
  totalGainLossPercentage: 3.9,  // ~3.9% overall gain
  todayGainLoss: 0,
  todayGainLossPercentage: 0,
  currency: 'TWD',
  isDefault: true,
  isActive: true,
  autoUpdate: true,
  lastPriceUpdateAt: new Date(),
  metadata: {},
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date(),
};

interface AssetAllocation {
  asset: string;
  currency: string;
  currentValue: number;
  currentPct: number;
  targetPct: number;
  targetValue: number;
  delta: number;
  action: 'BUY' | 'SELL' | 'HOLD';
  suggestedAmount: number;
}

interface RebalancingAction {
  asset: string;
  action: 'BUY' | 'SELL';
  amount: number;
  shares?: number;
  currentPrice?: number;
  estimatedFee?: number;
  priority: 'high' | 'medium' | 'low';
  reason: string;
}

interface DemoRebalancingData {
  allocations: AssetAllocation[];
  actions: RebalancingAction[];
  totalAssets: number;
  availableFunds: number;
  totalDeficit: number;
  fxAccumulationTwd: number;
  fxThreshold: number;
  lastFxRate: number;
  readyToConvert: boolean;
  fxAccumulation?: Array<{
    accumulatedTwd: number;
    conversionThreshold: number;
    currentFxRate: number;
    readyToConvert: boolean;
  }>;
}

// Cash the demo account holds outside the portfolio wallet. /rebalancing's
// percentages are of TOTAL assets — portfolio + this cash — while /portfolio's
// are of the portfolio wallet alone: the same NT$1.5M holding is 60% here and
// 75% there. Two denominators, not two datasets.
const DEMO_REBALANCING_CASH = [
  { asset: 'Savings (Life / short-term)', value: 250000, targetPct: 10 },
  { asset: 'Emergency Fund', value: 250000, targetPct: 10 },
];

// Target weights of total assets, per held symbol. These plus the cash targets
// above come to 100.
const DEMO_REBALANCING_TARGETS: Record<string, { label: string; targetPct: number }> = {
  '0050': { label: '0050 (Yuanta Taiwan 50)', targetPct: 50 },
  'VT': { label: 'VT (Global stocks)', targetPct: 30 },
};

const demoAllocation = (
  asset: string,
  currentValue: number,
  targetPct: number,
  totalAssets: number,
): AssetAllocation => {
  const targetValue = (totalAssets * targetPct) / 100;
  const delta = targetValue - currentValue;
  return {
    asset,
    // TWD, like the holding it describes — labelling VT USD put a dollar sign
    // on a plainly six-figure NT amount.
    currency: 'TWD',
    currentValue,
    // Percentages are 0–100, matching the backend contract
    // (current_value * 100 / total_value). Fractions here once made the
    // allocation legend read "0.6%" instead of "60%".
    currentPct: (currentValue / totalAssets) * 100,
    targetPct,
    targetValue,
    delta,
    action: delta > 0 ? 'BUY' : delta < 0 ? 'SELL' : 'HOLD',
    suggestedAmount: Math.abs(delta),
  };
};

/**
 * The /rebalancing fixture — derived from DEMO_PORTFOLIO, not restated beside it.
 *
 * This was the fifth transcription of the demo portfolio: four line items, two
 * of which the portfolio does not hold, every one of them at delta 0 / HOLD. A
 * demo of a rebalancing tool showed a portfolio needing no rebalancing, so the
 * one thing the page exists to demonstrate was the one thing it could not show.
 * Deriving it makes a fixture change a one-line edit, and
 * `demoFixtureConsistency.test.ts` fails if a sixth copy ever appears.
 */
export function buildDemoRebalancingData(): DemoRebalancingData {
  const totalAssets =
    DEMO_PORTFOLIO.totalValue +
    DEMO_REBALANCING_CASH.reduce((sum, cash) => sum + cash.value, 0);

  const allocations: AssetAllocation[] = [
    ...DEMO_PORTFOLIO.holdings.map((holding) => {
      const target = DEMO_REBALANCING_TARGETS[holding.symbol];
      return demoAllocation(
        target?.label ?? holding.symbol,
        holding.totalValue,
        // A holding with no plan of its own is left where it already sits.
        target?.targetPct ?? (holding.totalValue / totalAssets) * 100,
        totalAssets,
      );
    }),
    ...DEMO_REBALANCING_CASH.map((cash) =>
      demoAllocation(cash.asset, cash.value, cash.targetPct, totalAssets),
    ),
  ];

  // Funds freed by the overweight assets, and what the underweight ones need.
  const availableFunds = allocations
    .filter((a) => a.delta < 0)
    .reduce((sum, a) => sum + Math.abs(a.delta), 0);
  const totalDeficit = allocations
    .filter((a) => a.delta > 0)
    .reduce((sum, a) => sum + a.delta, 0);

  const actions: RebalancingAction[] = allocations
    .filter((a): a is AssetAllocation & { action: 'BUY' | 'SELL' } => a.action !== 'HOLD')
    .map((a) => ({
      asset: a.asset,
      action: a.action,
      amount: a.suggestedAmount,
      // 0.1425% brokerage + 0.1% securities transaction tax, on sells only.
      estimatedFee: a.action === 'SELL' ? Math.round(a.suggestedAmount * 0.002425) : 0,
      priority: 'high' as const,
      // English, like the reasons the live rebalancing endpoint sends; this
      // fixture builder has no `t`, and /rebalancing renders the string as is.
      reason: a.delta < 0 ? 'Above target allocation' : 'Below target allocation',
    }));

  // FX tracker: accumulate TWD until it is worth converting to USD.
  const fxAccumulationTwd = 45000;
  const fxThreshold = 80000;
  return {
    allocations,
    actions,
    totalAssets,
    availableFunds,
    totalDeficit,
    fxAccumulationTwd,
    fxThreshold,
    lastFxRate: 32.5,
    readyToConvert: fxAccumulationTwd >= fxThreshold,
  };
}

interface DemoContextType {
  isDemoMode: boolean;
  enableDemo: () => void;
  disableDemo: () => void;
  toggleDemo: () => void;
  demoUser: User;
  demoTransactions: Transaction[];
  demoGoals: FinancialGoal[];
  demoPortfolio: Portfolio;
  getDemoStats: () => Record<string, unknown>;
  getDemoRebalancingData: () => DemoRebalancingData;
  addDemoTransaction: (transaction: Omit<Transaction, 'id' | 'userId' | 'createdAt' | 'updatedAt'>) => void;
  removeDemoTransaction: (id: string) => void;
  addDemoGoal: (goal: Omit<FinancialGoal, 'id' | 'userId' | 'createdAt' | 'updatedAt' | 'milestones' | 'contributions'>) => void;
  updateDemoGoal: (id: string, updates: Partial<Omit<FinancialGoal, 'id' | 'userId'>>) => void;
  removeDemoGoal: (id: string) => void;
  /**
   * Bumped on every demo write. Demo query keys include it, so a write refetches
   * through a fresh queryFn instead of one that closed over the old fixtures.
   */
  demoRevision: number;
}

const DemoContext = createContext<DemoContextType | undefined>(undefined);

function readDemoCookie(): boolean {
  return typeof document !== 'undefined' && document.cookie.split('; ').includes('demo-mode=true');
}

export function DemoProvider({ children }: { children: ReactNode }) {
  const [demoModeState, setIsDemoMode] = useState(false);
  const [demoTransactions, setDemoTransactions] = useState(DEMO_TRANSACTIONS);
  const [demoGoals, setDemoGoals] = useState(DEMO_GOALS);
  const [demoRevision, setDemoRevision] = useState(0);
  const bumpRevision = useCallback(() => setDemoRevision(r => r + 1), []);

  // Sync with NextAuth session to disable demo mode when authenticated
  const { data: session, status } = useSession();

  // Sync demo mode with authentication state
  useEffect(() => {
    // Disable demo mode as soon as NextAuth confirms the user has logged in,
    // regardless of whether the backend access token is available yet.
    // This prevents the "logged in but seeing demo data" bug caused by a stale
    // demo-mode=true cookie surviving across logout/relogin cycles.
    if (status === 'authenticated' && session?.user) {
      setIsDemoMode(false);
      if (typeof document !== 'undefined') {
        document.cookie = 'demo-mode=false; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
      }
      logger.debug('User authenticated, demo mode disabled', undefined, 'Demo');
    } else if (status === 'unauthenticated') {
      // User is not authenticated, check cookie for demo mode preference
      if (typeof document !== 'undefined') {
        const demoModeCookie = document.cookie
          .split('; ')
          .find(row => row.startsWith('demo-mode='))
          ?.split('=')[1];

        // Only enable demo mode if explicitly set to true via cookie
        // This prevents automatic demo mode on session expiration
        if (demoModeCookie === 'true') {
          setIsDemoMode(true);
          document.cookie = 'demo-mode=true; path=/; max-age=86400; SameSite=Strict';
          logger.debug('Demo mode enabled from cookie', undefined, 'Demo');
        } else {
          // Ensure demo mode is disabled when session expires
          setIsDemoMode(false);
          logger.debug('Session expired, demo mode disabled', undefined, 'Demo');
        }
      }
    }
  }, [session, status]);

  // A signed-out visitor's demo cookie is read during render too, not only in the
  // effect above. Child effects run before a parent's, so with the effect alone the
  // first render after NextAuth resolved showed a demo visitor as plain signed-out,
  // and any page fetching on `!isDemo` in that render raced the cookie and 401'd.
  // Safe for hydration: status is 'loading' until after it, and SessionInitProvider
  // renders only an overlay until then.
  const isDemoMode = demoModeState || (status === 'unauthenticated' && readDemoCookie());

  const enableDemo = useCallback(() => {
    setIsDemoMode(true);
    if (typeof document !== 'undefined') {
      document.cookie = 'demo-mode=true; path=/; max-age=86400; SameSite=Strict'; // 24 hours
    }
  }, []);

  const disableDemo = useCallback(() => {
    setIsDemoMode(false);
    if (typeof document !== 'undefined') {
      document.cookie = 'demo-mode=false; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
    }
  }, []);

  const toggleDemo = useCallback(() => {
    if (isDemoMode) {
      disableDemo();
    } else {
      enableDemo();
    }
  }, [isDemoMode, disableDemo, enableDemo]);

  const getDemoStats = useCallback(() => {
    // Calculate stats dynamically from current demo transactions
    const now = new Date();
    // This calendar month, not a rolling 30 days: salary and rent are dated the 1st
    // of every month, so a 30-day window on e.g. March 1 caught Feb 1's pair too
    // and read NT$126,000 of income.
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const recentTransactions = demoTransactions.filter(t => {
      const transactionDate = new Date(t.date);
      return transactionDate >= monthStart && transactionDate <= now;
    });

    const totalIncome = recentTransactions
      .filter(t => t.type === 'income')
      .reduce((sum, t) => sum + t.amount, 0);

    const totalExpenses = recentTransactions
      .filter(t => t.type === 'expense')
      .reduce((sum, t) => sum + t.amount, 0);

    const netIncome = totalIncome - totalExpenses;
    const savingsRate = totalIncome > 0 ? ((netIncome / totalIncome) * 100) : 0;

    // Calculate total balance - Based on cur_investment_plan.md
    // Total assets: NT$2,500,000
    // Portfolio: NT$2,000,000 (60% 0050 + 20% VT)
    // Cash/Savings: NT$250,000 (10% savings)
    // Emergency Fund: NT$250,000 (10% emergency)
    const portfolioValue = 2000000; // 60% 0050 + 20% VT = NT$2M
    const savingsValue = 250000;    // 10% 儲蓄（生活/短期）
    const emergencyValue = 250000;  // 10% 緊急備用金
    const _totalBalance = savingsValue + emergencyValue; // NT$500,000 liquid assets

    return {
      // Three-wallet system
      life_wallet: savingsValue, // NT$250,000 daily income/expenses
      portfolio_wallet: portfolioValue, // NT$2,000,000 invested assets
      emergency_wallet: emergencyValue, // NT$250,000 emergency fund
      total_asset: savingsValue + portfolioValue + emergencyValue,
      investment_total: portfolioValue,

      // Legacy fields
      monthlyIncome: totalIncome,
      monthlyExpenses: totalExpenses,
      savingsRate: Math.round(savingsRate * 10) / 10,
      portfolioChange: 8.2, // Approximate growth %
    };
  }, [demoTransactions]);

  const addDemoTransaction = useCallback((transaction: Omit<Transaction, 'id' | 'userId' | 'createdAt' | 'updatedAt'>) => {
    const newTransaction: Transaction = {
      ...transaction,
      id: `demo-${crypto.randomUUID()}`,
      userId: 'demo-user',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    setDemoTransactions(prev => [newTransaction, ...prev]);
    bumpRevision();
  }, [bumpRevision]);

  const removeDemoTransaction = useCallback((id: string) => {
    setDemoTransactions(prev => prev.filter(t => t.id !== id));
    bumpRevision();
  }, [bumpRevision]);

  const addDemoGoal = useCallback((goal: Omit<FinancialGoal, 'id' | 'userId' | 'createdAt' | 'updatedAt' | 'milestones' | 'contributions'>) => {
    const now = new Date();
    setDemoGoals(prev => [
      ...prev,
      {
        ...goal,
        id: `demo-goal-${crypto.randomUUID()}`,
        userId: 'demo-user',
        milestones: [],
        contributions: [],
        createdAt: now,
        updatedAt: now,
      },
    ]);
    bumpRevision();
  }, [bumpRevision]);

  const updateDemoGoal = useCallback((id: string, updates: Partial<Omit<FinancialGoal, 'id' | 'userId'>>) => {
    setDemoGoals(prev => prev.map(g => (g.id === id ? { ...g, ...updates, updatedAt: new Date() } : g)));
    bumpRevision();
  }, [bumpRevision]);

  const removeDemoGoal = useCallback((id: string) => {
    setDemoGoals(prev => prev.filter(g => g.id !== id));
    bumpRevision();
  }, [bumpRevision]);

  const getDemoRebalancingData = useCallback(() => buildDemoRebalancingData(), []);

  return (
    <DemoContext.Provider value={{
      isDemoMode,
      enableDemo,
      disableDemo,
      toggleDemo,
      demoUser: DEMO_USER,
      demoTransactions,
      demoGoals,
      demoPortfolio: DEMO_PORTFOLIO,
      getDemoStats,
      getDemoRebalancingData,
      addDemoTransaction,
      removeDemoTransaction,
      addDemoGoal,
      updateDemoGoal,
      removeDemoGoal,
      demoRevision,
    }}>
      {children}
    </DemoContext.Provider>
  );
}

export function useDemo() {
  const context = useContext(DemoContext);
  if (context === undefined) {
    throw new Error('useDemo must be used within a DemoProvider');
  }
  return context;
}