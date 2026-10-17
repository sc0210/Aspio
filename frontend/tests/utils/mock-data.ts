/**
 * Mock Data Generators for Aspiro QA Testing
 * Generates realistic test data for Asian finance scenarios
 */

import {
  Transaction,
  FinancialGoal,
  Portfolio,
  Budget,
  User,
  PortfolioHolding,
  BudgetCategory,
  GoalMilestone,
  UserPreferences,
  UserProfile
} from '@/shared/types';

export class MockDataGenerator {
  private static instance: MockDataGenerator;
  private testCounter = 0;

  static getInstance(): MockDataGenerator {
    if (!MockDataGenerator.instance) {
      MockDataGenerator.instance = new MockDataGenerator();
    }
    return MockDataGenerator.instance;
  }

  private generateId(): string {
    return `test-${Date.now()}-${++this.testCounter}-${Math.random().toString(36).substr(2, 9)}`;
  }

  private randomAmount(min = 10, max = 5000): number {
    return Math.round((Math.random() * (max - min) + min) * 100) / 100;
  }

  private randomDate(daysAgo = 30): Date {
    const date = new Date();
    date.setDate(date.getDate() - Math.floor(Math.random() * daysAgo));
    return date;
  }

  private randomFutureDate(daysAhead = 365): Date {
    const date = new Date();
    date.setDate(date.getDate() + Math.floor(Math.random() * daysAhead + 30));
    return date;
  }

  private randomElement<T>(array: T[]): T {
    return array[Math.floor(Math.random() * array.length)];
  }

  /**
   * Generate mock user data
   */
  generateUser(overrides: Partial<User> = {}): User {
    const baseUser: User = {
      id: this.generateId(),
      email: `testuser${this.testCounter}@aspiro.test`,
      name: this.randomElement(['Wang Wei', 'Li Ming', 'Chen Mei', 'Zhang Lin', 'Liu Jun']),
      avatar_url: `https://api.dicebear.com/7.x/avataaars/svg?seed=${this.testCounter}`,
      is_active: true,
      is_verified: true,
      google_id: `google_${this.generateId()}`,
      experience_points: Math.floor(Math.random() * 10000),
      level: Math.floor(Math.random() * 20) + 1,
      created_at: this.randomDate(90),
      updated_at: this.randomDate(7),
      preferences: this.generateUserPreferences(),
      profile: this.generateUserProfile()
    };

    return { ...baseUser, ...overrides };
  }

  /**
   * Generate user preferences with Asian locales
   */
  generateUserPreferences(overrides: Partial<UserPreferences> = {}): UserPreferences {
    const basePreferences: UserPreferences = {
      currency: this.randomElement(['USD', 'SGD', 'MYR', 'THB', 'VND', 'IDR']),
      language: this.randomElement(['en', 'zh-CN', 'zh-TW', 'ms', 'th', 'vi']),
      locale: this.randomElement(['en-US', 'zh-SG', 'ms-MY', 'th-TH', 'vi-VN']),
      timezone: this.randomElement([
        'Asia/Singapore', 'Asia/Kuala_Lumpur', 'Asia/Bangkok', 
        'Asia/Ho_Chi_Minh', 'Asia/Jakarta', 'Asia/Manila'
      ]),
      dateFormat: this.randomElement(['western', 'roc', 'iso']),
      numberFormat: this.randomElement(['western', 'asian']),
      notifications: {
        email: true,
        push: Math.random() > 0.3,
        sms: Math.random() > 0.7,
        goalReminders: true,
        transactionAlerts: Math.random() > 0.4
      }
    };

    return { ...basePreferences, ...overrides };
  }

  /**
   * Generate user profile with Asian context
   */
  generateUserProfile(overrides: Partial<UserProfile> = {}): UserProfile {
    const baseProfile: UserProfile = {
      date_of_birth: new Date(1990 + Math.floor(Math.random() * 25), Math.floor(Math.random() * 12), Math.floor(Math.random() * 28) + 1),
      occupation: this.randomElement([
        'Software Engineer', 'Product Manager', 'Marketing Specialist',
        'Financial Analyst', 'Teacher', 'Doctor', 'Consultant',
        'Sales Manager', 'Operations Manager', 'Entrepreneur'
      ]),
      monthly_income: this.randomAmount(3000, 15000),
      risk_tolerance: this.randomElement(['conservative', 'moderate', 'aggressive'])
    };

    return { ...baseProfile, ...overrides };
  }

  /**
   * Generate mock transaction with Asian payment methods and categories
   */
  generateTransaction(overrides: Partial<Transaction> = {}): Omit<Transaction, 'id' | 'userId' | 'createdAt' | 'updatedAt'> {
    const isIncome = Math.random() > 0.7;
    const categories = {
      income: ['Salary', 'Freelance', 'Investment Returns', 'Side Business', 'Bonus'],
      expense: ['Food & Dining', 'Transportation', 'Shopping', 'Utilities', 'Healthcare', 
                'Entertainment', 'Education', 'Insurance', 'Housing', 'Travel']
    };

    const paymentMethods = [
      'Credit Card', 'Debit Card', 'Cash', 'Bank Transfer',
      'GrabPay', 'ShopeePay', 'WeChat Pay', 'Alipay', 'LINE Pay',
      'MoMo Wallet', 'TrueMoney', 'GCash', 'PayNow'
    ];

    const baseTransaction = {
      type: (isIncome ? 'income' : 'expense') as 'income' | 'expense',
      amount: this.randomAmount(isIncome ? 1000 : 20, isIncome ? 8000 : 500),
      currency: this.randomElement(['USD', 'SGD', 'MYR', 'THB', 'VND']),
      category: this.randomElement(categories[isIncome ? 'income' : 'expense']),
      description: this.generateTransactionDescription(isIncome),
      date: this.randomDate(30),
      paymentMethod: this.randomElement(paymentMethods),
      tags: this.generateTransactionTags(),
      location: this.randomElement([
        'Singapore', 'Kuala Lumpur', 'Bangkok', 'Ho Chi Minh City',
        'Jakarta', 'Manila', 'Online Purchase', 'ATM'
      ]),
      isRecurring: Math.random() > 0.8,
      recurringRule: Math.random() > 0.8 ? {
        frequency: this.randomElement(['monthly', 'weekly', 'yearly']) as 'monthly' | 'weekly' | 'yearly',
        interval: 1,
        endDate: this.randomFutureDate(365)
      } : undefined
    };

    return { ...baseTransaction, ...overrides };
  }

  private generateTransactionDescription(isIncome: boolean): string {
    const incomeDescriptions = [
      'Monthly Salary', 'Freelance Project Payment', 'Dividend Payment',
      'Bonus Payment', 'Rental Income', 'Stock Sale Profit'
    ];

    const expenseDescriptions = [
      'Lunch at Food Court', 'Grab Ride to Office', 'Online Shopping',
      'Electricity Bill', 'Phone Bill', 'Grocery Shopping',
      'Coffee with Friends', 'Movie Tickets', 'Insurance Premium'
    ];

    return this.randomElement(isIncome ? incomeDescriptions : expenseDescriptions);
  }

  private generateTransactionTags(): string[] {
    const allTags = [
      'business', 'personal', 'recurring', 'essential', 'leisure',
      'investment', 'tax-deductible', 'work-related', 'family'
    ];
    
    const numTags = Math.floor(Math.random() * 3);
    const selectedTags: string[] = [];
    
    for (let i = 0; i < numTags; i++) {
      const tag = this.randomElement(allTags);
      if (!selectedTags.includes(tag)) {
        selectedTags.push(tag);
      }
    }
    
    return selectedTags;
  }

  /**
   * Generate mock financial goal
   */
  generateFinancialGoal(overrides: Partial<FinancialGoal> = {}): Omit<FinancialGoal, 'id' | 'userId' | 'createdAt' | 'updatedAt'> {
    const goalTypes = [
      'emergency_fund', 'retirement', 'house_down_payment',
      'vacation', 'car_purchase', 'education', 'investment'
    ];

    const goalTitles = {
      emergency_fund: 'Emergency Fund',
      retirement: 'Retirement Savings',
      house_down_payment: 'House Down Payment',
      vacation: this.randomElement(['Japan Trip', 'Europe Vacation', 'Bali Holiday']),
      car_purchase: 'New Car Fund',
      education: 'MBA Fund',
      investment: 'Investment Portfolio'
    };

    const category = this.randomElement(goalTypes) as keyof typeof goalTitles;
    const targetAmount = this.randomAmount(5000, 100000);
    const currentAmount = this.randomAmount(0, targetAmount * 0.7);

    const baseGoal = {
      title: goalTitles[category],
      description: `Saving for ${goalTitles[category].toLowerCase()}`,
      targetAmount,
      currentAmount,
      currency: this.randomElement(['USD', 'SGD', 'MYR']),
      targetDate: this.randomFutureDate(730),
      category,
      status: this.randomElement(['active', 'completed', 'paused']) as 'active' | 'completed' | 'paused',
      priority: this.randomElement(['low', 'medium', 'high']) as 'low' | 'medium' | 'high',
      milestones: this.generateGoalMilestones(targetAmount),
      contributions: []
    };

    return { ...baseGoal, ...overrides };
  }

  private generateGoalMilestones(targetAmount: number): GoalMilestone[] {
    const numMilestones = Math.floor(Math.random() * 4) + 2;
    const milestones: GoalMilestone[] = [];
    
    for (let i = 1; i <= numMilestones; i++) {
      milestones.push({
        id: this.generateId(),
        title: `Milestone ${i}`,
        description: `Reach ${(i / numMilestones * 100).toFixed(0)}% of goal`,
        amount: Math.round(targetAmount * i / numMilestones),
        targetDate: this.randomFutureDate(365),
        isCompleted: Math.random() > 0.6,
        completedAt: Math.random() > 0.6 ? this.randomDate(30) : undefined,
        reward: this.randomElement(['Treat yourself to dinner', 'Buy something nice', 'Weekend getaway'])
      });
    }
    
    return milestones;
  }

  /**
   * Generate mock portfolio
   */
  generatePortfolio(overrides: Partial<Portfolio> = {}): Portfolio {
    const holdings = this.generatePortfolioHoldings(Math.floor(Math.random() * 8) + 3);
    const totalValue = holdings.reduce((sum, holding) => sum + holding.totalValue, 0);
    const totalCost = holdings.reduce((sum, holding) => sum + (holding.quantity * holding.averageCost), 0);
    const totalGainLoss = totalValue - totalCost;

    const basePortfolio: Portfolio = {
      id: this.generateId(),
      userId: this.generateId(),
      name: 'My Investment Portfolio',
      description: 'Diversified portfolio for long-term growth',
      holdings,
      totalValue,
      totalCost,
      totalGainLoss,
      totalGainLossPercentage: totalCost > 0 ? (totalGainLoss / totalCost) * 100 : 0,
      currency: 'USD',
      isDefault: true,
      isActive: true,
      autoUpdate: true,
      lastPriceUpdateAt: this.randomDate(1),
      metadata: {},
      createdAt: this.randomDate(365),
      updatedAt: this.randomDate(7)
    };

    return { ...basePortfolio, ...overrides };
  }

  /**
   * Generate portfolio holdings with Asian stocks and regional ETFs
   */
  generatePortfolioHoldings(count = 5): PortfolioHolding[] {
    const asianStocks = [
      { symbol: 'DBS.SI', name: 'DBS Group Holdings', exchange: 'SGX', sector: 'Banking' },
      { symbol: 'OCBC.SI', name: 'OCBC Bank', exchange: 'SGX', sector: 'Banking' },
      { symbol: 'GRAB', name: 'Grab Holdings Limited', exchange: 'NASDAQ', sector: 'Technology' },
      { symbol: 'SE', name: 'Sea Limited', exchange: 'NYSE', sector: 'Technology' },
      { symbol: '1398.HK', name: 'ICBC', exchange: 'HKEX', sector: 'Banking' },
      { symbol: 'BABA', name: 'Alibaba Group', exchange: 'NYSE', sector: 'E-commerce' },
      { symbol: 'TSM', name: 'Taiwan Semiconductor', exchange: 'NYSE', sector: 'Technology' }
    ];

    const etfs = [
      { symbol: 'VTI', name: 'Vanguard Total Stock Market ETF', exchange: 'NYSE', sector: 'ETF' },
      { symbol: 'VEA', name: 'Vanguard FTSE Developed Markets ETF', exchange: 'NYSE', sector: 'ETF' },
      { symbol: 'VWO', name: 'Vanguard Emerging Markets ETF', exchange: 'NYSE', sector: 'ETF' },
      { symbol: 'EWS', name: 'iShares Singapore ETF', exchange: 'NYSE', sector: 'ETF' }
    ];

    const cryptos = [
      { symbol: 'BTC', name: 'Bitcoin', exchange: 'Crypto', sector: 'Cryptocurrency' },
      { symbol: 'ETH', name: 'Ethereum', exchange: 'Crypto', sector: 'Cryptocurrency' }
    ];

    const allAssets = [...asianStocks, ...etfs, ...cryptos];
    const selectedAssets = [];
    
    for (let i = 0; i < count; i++) {
      const asset = this.randomElement(allAssets);
      const quantity = Math.floor(Math.random() * 100) + 1;
      const averageCost = this.randomAmount(10, 300);
      const currentPrice = averageCost * (0.8 + Math.random() * 0.4); // ±20% from cost
      const totalValue = quantity * currentPrice;
      const gainLoss = totalValue - (quantity * averageCost);
      
      selectedAssets.push({
        id: this.generateId(),
        symbol: asset.symbol,
        name: asset.name,
        type: asset.sector === 'Cryptocurrency' ? 'crypto' : 
              asset.sector === 'ETF' ? 'etf' : 'stock',
        quantity,
        averageCost,
        currentPrice,
        totalValue,
        gainLoss,
        gainLossPercentage: (gainLoss / (quantity * averageCost)) * 100,
        currency: 'USD',
        exchange: asset.exchange,
        sector: asset.sector,
        lastUpdated: this.randomDate(1)
      });
    }
    
    return selectedAssets;
  }

  /**
   * Generate mock budget with Asian spending categories
   */
  generateBudget(overrides: Partial<Budget> = {}): Omit<Budget, 'id' | 'userId' | 'createdAt' | 'updatedAt'> {
    const categories = this.generateBudgetCategories();
    const totalBudget = categories.reduce((sum, cat) => sum + cat.budgetAmount, 0);
    const totalSpent = categories.reduce((sum, cat) => sum + cat.spentAmount, 0);

    const baseBudget = {
      name: `${new Date().getFullYear()} Budget`,
      period: this.randomElement(['monthly', 'quarterly', 'yearly']) as 'monthly' | 'quarterly' | 'yearly',
      startDate: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
      endDate: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0),
      categories,
      totalBudget,
      totalSpent,
      currency: this.randomElement(['USD', 'SGD', 'MYR']),
      status: this.randomElement(['active', 'completed', 'draft']) as 'active' | 'completed' | 'draft'
    };

    return { ...baseBudget, ...overrides };
  }

  private generateBudgetCategories(): BudgetCategory[] {
    const categoryData = [
      { name: 'Food & Dining', budget: [800, 1500] },
      { name: 'Transportation', budget: [200, 500] },
      { name: 'Shopping', budget: [300, 800] },
      { name: 'Utilities', budget: [150, 300] },
      { name: 'Healthcare', budget: [100, 400] },
      { name: 'Entertainment', budget: [200, 600] },
      { name: 'Housing', budget: [1000, 2500] },
      { name: 'Insurance', budget: [200, 500] }
    ];

    return categoryData.map(cat => {
      const budgetAmount = this.randomAmount(cat.budget[0], cat.budget[1]);
      const spentAmount = this.randomAmount(0, budgetAmount * 1.2); // Can overspend
      
      return {
        categoryId: this.generateId(),
        categoryName: cat.name,
        budgetAmount,
        spentAmount,
        remainingAmount: Math.max(0, budgetAmount - spentAmount),
        percentageUsed: (spentAmount / budgetAmount) * 100
      };
    });
  }

  /**
   * Generate batch of test transactions
   */
  generateTransactions(count = 10): Omit<Transaction, 'id' | 'userId' | 'createdAt' | 'updatedAt'>[] {
    const transactions = [];
    for (let i = 0; i < count; i++) {
      transactions.push(this.generateTransaction());
    }
    return transactions;
  }

  /**
   * Generate batch of test goals
   */
  generateFinancialGoals(count = 3): Omit<FinancialGoal, 'id' | 'userId' | 'createdAt' | 'updatedAt'>[] {
    const goals = [];
    for (let i = 0; i < count; i++) {
      goals.push(this.generateFinancialGoal());
    }
    return goals;
  }

  /**
   * Generate batch of test budgets
   */
  generateBudgets(count = 2): Omit<Budget, 'id' | 'userId' | 'createdAt' | 'updatedAt'>[] {
    const budgets = [];
    for (let i = 0; i < count; i++) {
      budgets.push(this.generateBudget());
    }
    return budgets;
  }

  /**
   * Reset counter for consistent test data
   */
  reset() {
    this.testCounter = 0;
  }
}

// Export singleton instance
export const mockData = MockDataGenerator.getInstance();