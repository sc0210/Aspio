/**
 * Database Setup and Teardown Utilities for QA Testing
 * Handles test data lifecycle and database state management
 */

import { ApiClient } from '@/lib/api-client';
import { mockData, MockDataGenerator } from './mock-data';
import {
  Transaction,
  FinancialGoal,
  Budget,
  User,
  Portfolio
} from '@/shared/types';

interface TestDataStore {
  transactions: Transaction[];
  goals: FinancialGoal[];
  budgets: Budget[];
  user?: User;
  portfolio?: Portfolio;
}

export class DatabaseSetup {
  private apiClient: ApiClient;
  private testData: TestDataStore = {
    transactions: [],
    goals: [],
    budgets: []
  };
  private authToken?: string;

  constructor() {
    this.apiClient = new ApiClient();
  }

  /**
   * Initialize test database with authentication
   */
  async initialize(authToken: string): Promise<void> {
    this.authToken = authToken;
    this.apiClient.setAccessToken(authToken);
    await this.clearTestData();
  }

  /**
   * Setup basic test data for CRUD operations
   */
  async setupBasicTestData(): Promise<TestDataStore> {
    console.log('Setting up basic test data...');
    
    // Create test transactions
    const transactionTemplates = mockData.generateTransactions(5);
    for (const template of transactionTemplates) {
      try {
        const created = await this.apiClient.createTransaction(template);
        this.testData.transactions.push(created);
        console.log(`Created test transaction: ${created.id}`);
      } catch (error) {
        console.warn('Failed to create test transaction:', error);
      }
    }

    // Create test goals
    const goalTemplates = mockData.generateFinancialGoals(3);
    for (const template of goalTemplates) {
      try {
        const created = await this.apiClient.createGoal(template);
        this.testData.goals.push(created);
        console.log(`Created test goal: ${created.id}`);
      } catch (error) {
        console.warn('Failed to create test goal:', error);
      }
    }

    // Create test budgets
    const budgetTemplates = mockData.generateBudgets(2);
    for (const template of budgetTemplates) {
      try {
        const created = await this.apiClient.createBudget(template);
        this.testData.budgets.push(created);
        console.log(`Created test budget: ${created.id}`);
      } catch (error) {
        console.warn('Failed to create test budget:', error);
      }
    }

    // Get user data
    try {
      this.testData.user = await this.apiClient.getCurrentUser();
      console.log(`Retrieved user data: ${this.testData.user.id}`);
    } catch (error) {
      console.warn('Failed to get user data:', error);
    }

    // Get portfolio data
    try {
      this.testData.portfolio = await this.apiClient.getPortfolio();
      console.log('Retrieved portfolio data');
    } catch (error) {
      console.warn('Failed to get portfolio data:', error);
    }

    console.log(`Test data setup complete: ${this.testData.transactions.length} transactions, ${this.testData.goals.length} goals, ${this.testData.budgets.length} budgets`);
    return this.testData;
  }

  /**
   * Setup complex test scenario with interrelated data
   */
  async setupComplexScenario(): Promise<TestDataStore> {
    console.log('Setting up complex test scenario...');
    
    // Create a comprehensive financial scenario
    const scenarios = [
      {
        name: 'High Earner Scenario',
        transactions: mockData.generateTransactions(15).map(t => ({
          ...t,
          amount: t.type === 'income' ? t.amount * 2 : t.amount
        })),
        goals: mockData.generateFinancialGoals(5).map(g => ({
          ...g,
          targetAmount: g.targetAmount * 1.5
        })),
        budgets: mockData.generateBudgets(3)
      },
      {
        name: 'Conservative Saver Scenario',
        transactions: mockData.generateTransactions(10).map(t => ({
          ...t,
          amount: t.type === 'expense' ? t.amount * 0.7 : t.amount
        })),
        goals: mockData.generateFinancialGoals(3).map(g => ({
          ...g,
          priority: 'high' as const,
          status: 'active' as const
        })),
        budgets: mockData.generateBudgets(2)
      }
    ];

    const selectedScenario = scenarios[Math.floor(Math.random() * scenarios.length)];
    console.log(`Using scenario: ${selectedScenario.name}`);

    // Create all data for the scenario
    for (const template of selectedScenario.transactions) {
      try {
        const created = await this.apiClient.createTransaction(template);
        this.testData.transactions.push(created);
      } catch (error) {
        console.warn('Failed to create scenario transaction:', error);
      }
    }

    for (const template of selectedScenario.goals) {
      try {
        const created = await this.apiClient.createGoal(template);
        this.testData.goals.push(created);
      } catch (error) {
        console.warn('Failed to create scenario goal:', error);
      }
    }

    for (const template of selectedScenario.budgets) {
      try {
        const created = await this.apiClient.createBudget(template);
        this.testData.budgets.push(created);
      } catch (error) {
        console.warn('Failed to create scenario budget:', error);
      }
    }

    // Get current user and portfolio data
    try {
      this.testData.user = await this.apiClient.getCurrentUser();
      this.testData.portfolio = await this.apiClient.getPortfolio();
    } catch (error) {
      console.warn('Failed to get user/portfolio data:', error);
    }

    console.log(`Complex scenario setup complete: ${this.testData.transactions.length} transactions, ${this.testData.goals.length} goals, ${this.testData.budgets.length} budgets`);
    return this.testData;
  }

  /**
   * Create specific test data for edge case testing
   */
  async setupEdgeCaseData(): Promise<TestDataStore> {
    console.log('Setting up edge case test data...');
    
    // Create edge case transactions
    const edgeCases = [
      // Very large transaction
      mockData.generateTransaction({
        amount: 999999.99,
        description: 'Edge Case: Maximum Amount Transaction',
        type: 'income'
      }),
      // Very small transaction
      mockData.generateTransaction({
        amount: 0.01,
        description: 'Edge Case: Minimum Amount Transaction',
        type: 'expense'
      }),
      // Transaction with special characters
      mockData.generateTransaction({
        description: 'Edge Case: Special Ch@rs & Émojis 🏦💰',
        tags: ['test-case', 'special-chars', 'émoji-test']
      }),
      // Recurring transaction
      mockData.generateTransaction({
        isRecurring: true,
        recurringRule: {
          frequency: 'monthly',
          interval: 1,
          endDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
        },
        description: 'Edge Case: Recurring Monthly Transaction'
      })
    ];

    for (const template of edgeCases) {
      try {
        const created = await this.apiClient.createTransaction(template);
        this.testData.transactions.push(created);
        console.log(`Created edge case transaction: ${created.description}`);
      } catch (error) {
        console.warn('Failed to create edge case transaction:', error);
      }
    }

    // Create edge case goals
    const edgeGoals = [
      // Very large goal
      mockData.generateFinancialGoal({
        targetAmount: 1000000,
        title: 'Edge Case: Million Dollar Goal',
        description: 'Testing very large goal amounts'
      }),
      // Short-term goal (due soon)
      mockData.generateFinancialGoal({
        targetDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        title: 'Edge Case: Urgent Goal',
        description: 'Goal due in 7 days'
      })
    ];

    for (const template of edgeGoals) {
      try {
        const created = await this.apiClient.createGoal(template);
        this.testData.goals.push(created);
        console.log(`Created edge case goal: ${created.title}`);
      } catch (error) {
        console.warn('Failed to create edge case goal:', error);
      }
    }

    console.log(`Edge case data setup complete: ${this.testData.transactions.length} transactions, ${this.testData.goals.length} goals`);
    return this.testData;
  }

  /**
   * Get current test data
   */
  getTestData(): TestDataStore {
    return this.testData;
  }

  /**
   * Add a transaction to test data store
   */
  addTransaction(transaction: Transaction): void {
    this.testData.transactions.push(transaction);
  }

  /**
   * Add a goal to test data store
   */
  addGoal(goal: FinancialGoal): void {
    this.testData.goals.push(goal);
  }

  /**
   * Add a budget to test data store
   */
  addBudget(budget: Budget): void {
    this.testData.budgets.push(budget);
  }

  /**
   * Remove transaction from test data store
   */
  removeTransaction(transactionId: string): void {
    this.testData.transactions = this.testData.transactions.filter(t => t.id !== transactionId);
  }

  /**
   * Remove goal from test data store
   */
  removeGoal(goalId: string): void {
    this.testData.goals = this.testData.goals.filter(g => g.id !== goalId);
  }

  /**
   * Remove budget from test data store
   */
  removeBudget(budgetId: string): void {
    this.testData.budgets = this.testData.budgets.filter(b => b.id !== budgetId);
  }

  /**
   * Clear all test data from database and local store
   */
  async clearTestData(): Promise<void> {
    console.log('Clearing test data...');
    
    // Clear transactions
    try {
      const transactions = await this.apiClient.getTransactions();
      for (const transaction of transactions) {
        if (transaction.id.includes('test-') || transaction.description?.includes('Edge Case:')) {
          await this.apiClient.deleteTransaction(transaction.id);
          console.log(`Deleted test transaction: ${transaction.id}`);
        }
      }
    } catch (error) {
      console.warn('Error clearing test transactions:', error);
    }

    // Clear goals
    try {
      const goals = await this.apiClient.getGoals();
      for (const goal of goals) {
        if (goal.id.includes('test-') || goal.title.includes('Edge Case:')) {
          await this.apiClient.deleteGoal(goal.id);
          console.log(`Deleted test goal: ${goal.id}`);
        }
      }
    } catch (error) {
      console.warn('Error clearing test goals:', error);
    }

    // Clear budgets
    try {
      const budgets = await this.apiClient.getBudgets();
      for (const budget of budgets) {
        if (budget.id.includes('test-') || budget.name.includes('Test')) {
          // Note: Budget deletion might not be implemented
          console.log(`Would delete test budget: ${budget.id}`);
        }
      }
    } catch (error) {
      console.warn('Error clearing test budgets:', error);
    }

    // Clear local test data store
    this.testData = {
      transactions: [],
      goals: [],
      budgets: []
    };

    console.log('Test data clearing complete');
  }

  /**
   * Verify data integrity after operations
   */
  async verifyDataIntegrity(): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];
    
    try {
      // Verify transactions exist and match local store
      const dbTransactions = await this.apiClient.getTransactions();
      const localTransactionIds = this.testData.transactions.map(t => t.id);
      
      for (const localId of localTransactionIds) {
        if (!dbTransactions.find(t => t.id === localId)) {
          errors.push(`Transaction ${localId} missing from database`);
        }
      }

      // Verify goals exist and match local store
      const dbGoals = await this.apiClient.getGoals();
      const localGoalIds = this.testData.goals.map(g => g.id);
      
      for (const localId of localGoalIds) {
        if (!dbGoals.find(g => g.id === localId)) {
          errors.push(`Goal ${localId} missing from database`);
        }
      }

      // Verify budgets exist and match local store
      const dbBudgets = await this.apiClient.getBudgets();
      const localBudgetIds = this.testData.budgets.map(b => b.id);
      
      for (const localId of localBudgetIds) {
        if (!dbBudgets.find(b => b.id === localId)) {
          errors.push(`Budget ${localId} missing from database`);
        }
      }
    } catch (error) {
      errors.push(`Data integrity check failed: ${error}`);
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Get database statistics for testing
   */
  async getDatabaseStats(): Promise<{
    transactionCount: number;
    goalCount: number;
    budgetCount: number;
    portfolioHoldings: number;
  }> {
    try {
      const [transactions, goals, budgets, portfolio] = await Promise.all([
        this.apiClient.getTransactions().catch(() => []),
        this.apiClient.getGoals().catch(() => []),
        this.apiClient.getBudgets().catch(() => []),
        this.apiClient.getPortfolio().catch(() => ({ holdings: [] }))
      ]);

      return {
        transactionCount: transactions.length,
        goalCount: goals.length,
        budgetCount: budgets.length,
        portfolioHoldings: portfolio.holdings?.length || 0
      };
    } catch (error) {
      console.error('Error getting database stats:', error);
      return {
        transactionCount: 0,
        goalCount: 0,
        budgetCount: 0,
        portfolioHoldings: 0
      };
    }
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    await this.clearTestData();
    this.apiClient.clearAccessToken();
    mockData.reset();
  }

  /**
   * Create test data snapshot for comparison
   */
  createSnapshot(): TestDataStore {
    return JSON.parse(JSON.stringify(this.testData));
  }

  /**
   * Compare current state with snapshot
   */
  compareWithSnapshot(snapshot: TestDataStore): {
    transactionsDiff: number;
    goalsDiff: number;
    budgetsDiff: number;
  } {
    return {
      transactionsDiff: this.testData.transactions.length - snapshot.transactions.length,
      goalsDiff: this.testData.goals.length - snapshot.goals.length,
      budgetsDiff: this.testData.budgets.length - snapshot.budgets.length
    };
  }
}