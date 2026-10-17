/**
 * Test Utilities and Helpers for Aspiro QA Framework
 * Provides reusable utilities for testing CRUD operations, API validation, and database verification
 */

import { Page, expect } from '@playwright/test';
import { ApiClient } from '@/lib/api-client';
import {
  Transaction,
  FinancialGoal,
  Portfolio,
  Budget,
  User,
  ApiResponse,
  PortfolioHolding
} from '@/shared/types';

export class TestHelpers {
  private page: Page;
  private apiClient: ApiClient;

  constructor(page: Page) {
    this.page = page;
    this.apiClient = new ApiClient();
  }

  /**
   * Set up authentication for API requests
   */
  async authenticateApi(token: string) {
    this.apiClient.setAccessToken(token);
  }

  /**
   * Wait for network idle and ensure page is fully loaded
   */
  async waitForPageLoad() {
    await this.page.waitForLoadState('networkidle');
    await this.page.waitForTimeout(500); // Additional buffer for dynamic content
  }

  /**
   * Navigate to a page and wait for it to load
   */
  async navigateAndWait(url: string) {
    await this.page.goto(url);
    await this.waitForPageLoad();
  }

  /**
   * Fill form field and trigger validation
   */
  async fillFormField(selector: string, value: string, shouldValidate = true) {
    const field = this.page.locator(selector);
    await field.fill(value);
    if (shouldValidate) {
      await field.blur(); // Trigger validation
      await this.page.waitForTimeout(100);
    }
  }

  /**
   * Submit form and wait for response
   */
  async submitFormAndWait(formSelector?: string) {
    const form = formSelector ? this.page.locator(formSelector) : this.page.locator('form');
    
    const submitButton = form.locator('button[type="submit"], input[type="submit"]');
    await submitButton.click();
    
    // Wait for either success or error state
    await this.page.waitForTimeout(1000);
  }

  /**
   * Verify success message appears
   */
  async verifySuccessMessage(message?: string) {
    const successElement = this.page.locator('[data-testid="success-message"], .success, .alert-success, [role="alert"]');
    await expect(successElement).toBeVisible();
    
    if (message) {
      await expect(successElement).toContainText(message);
    }
  }

  /**
   * Verify error message appears
   */
  async verifyErrorMessage(message?: string) {
    const errorElement = this.page.locator('[data-testid="error-message"], .error, .alert-error, [role="alert"]');
    await expect(errorElement).toBeVisible();
    
    if (message) {
      await expect(errorElement).toContainText(message);
    }
  }

  /**
   * Take screenshot for visual regression testing
   */
  async takeScreenshot(name: string) {
    await this.page.screenshot({ path: `test-results/screenshots/${name}.png`, fullPage: true });
  }

  /**
   * Compare screenshot with baseline
   */
  async compareScreenshot(name: string) {
    await expect(this.page).toHaveScreenshot(`${name}.png`, {
      fullPage: true,
      animations: 'disabled'
    });
  }

  /**
   * Verify loading state appears and disappears
   */
  async verifyLoadingState() {
    const loadingSpinner = this.page.locator('[data-testid="loading-spinner"], .loading, .spinner');
    
    if (await loadingSpinner.count() > 0) {
      await expect(loadingSpinner).toBeVisible();
      await expect(loadingSpinner).toBeHidden({ timeout: 10000 });
    }
  }

  /**
   * Wait for element to be visible with timeout
   */
  async waitForElement(selector: string, timeout = 5000) {
    await this.page.locator(selector).waitFor({ state: 'visible', timeout });
  }

  /**
   * Check if element exists without waiting
   */
  async elementExists(selector: string): Promise<boolean> {
    return (await this.page.locator(selector).count()) > 0;
  }

  /**
   * Verify table data integrity
   */
  async verifyTableData(tableSelector: string, expectedData: any[]) {
    const table = this.page.locator(tableSelector);
    await expect(table).toBeVisible();
    
    const rows = table.locator('tbody tr');
    const rowCount = await rows.count();
    
    expect(rowCount).toBe(expectedData.length);
    
    // Verify each row's data
    for (let i = 0; i < expectedData.length; i++) {
      const row = rows.nth(i);
      await expect(row).toBeVisible();
    }
  }

  /**
   * Verify API response matches expected schema
   */
  async verifyApiResponse<T>(response: ApiResponse<T>, expectedData?: Partial<T>) {
    expect(response.success).toBe(true);
    expect(response.data).toBeDefined();
    
    if (expectedData && response.data) {
      for (const [key, value] of Object.entries(expectedData)) {
        expect(response.data[key]).toEqual(value);
      }
    }
  }

  /**
   * Generate unique test ID
   */
  generateTestId(prefix = 'test'): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Format currency for comparison
   */
  formatCurrency(amount: number, currency = 'USD'): string {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency
    }).format(amount);
  }

  /**
   * Generate random date within range
   */
  randomDate(start: Date = new Date(2023, 0, 1), end: Date = new Date()): Date {
    return new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
  }

  /**
   * Clean up test data (for teardown)
   */
  async cleanup() {
    this.apiClient.clearAccessToken();
  }

  /**
   * Assert element contains specific text
   */
  async assertElementText(selector: string, expectedText: string) {
    await expect(this.page.locator(selector)).toContainText(expectedText);
  }

  /**
   * Assert element has specific attribute value
   */
  async assertElementAttribute(selector: string, attribute: string, expectedValue: string) {
    await expect(this.page.locator(selector)).toHaveAttribute(attribute, expectedValue);
  }

  /**
   * Click element and wait for navigation
   */
  async clickAndWaitForNavigation(selector: string) {
    await Promise.all([
      this.page.waitForNavigation(),
      this.page.locator(selector).click()
    ]);
  }

  /**
   * Verify responsive layout at different screen sizes
   */
  async verifyResponsiveLayout(breakpoints = ['mobile', 'tablet', 'desktop']) {
    const viewports = {
      mobile: { width: 375, height: 667 },
      tablet: { width: 768, height: 1024 },
      desktop: { width: 1920, height: 1080 }
    };

    for (const breakpoint of breakpoints) {
      await this.page.setViewportSize(viewports[breakpoint]);
      await this.page.waitForTimeout(500);
      
      // Take screenshot for visual regression
      await this.takeScreenshot(`responsive-${breakpoint}`);
      
      // Verify layout doesn't break
      await expect(this.page.locator('body')).toBeVisible();
    }
  }
}

/**
 * Database verification utilities
 */
export class DatabaseTestHelpers {
  private apiClient: ApiClient;

  constructor() {
    this.apiClient = new ApiClient();
  }

  /**
   * Set authentication token for API requests
   */
  setAuthToken(token: string) {
    this.apiClient.setAccessToken(token);
  }

  /**
   * Verify transaction exists in database
   */
  async verifyTransactionInDb(transactionId: string, expectedData: Partial<Transaction>): Promise<boolean> {
    try {
      const transactions = await this.apiClient.getTransactions();
      const transaction = transactions.find(t => t.id === transactionId);
      
      if (!transaction) return false;

      // Verify expected data matches
      for (const [key, value] of Object.entries(expectedData)) {
        if (transaction[key] !== value) {
          console.error(`Transaction ${key} mismatch: expected ${value}, got ${transaction[key]}`);
          return false;
        }
      }

      return true;
    } catch (error) {
      console.error('Error verifying transaction in DB:', error);
      return false;
    }
  }

  /**
   * Verify goal exists in database
   */
  async verifyGoalInDb(goalId: string, expectedData: Partial<FinancialGoal>): Promise<boolean> {
    try {
      const goals = await this.apiClient.getGoals();
      const goal = goals.find(g => g.id === goalId);
      
      if (!goal) return false;

      for (const [key, value] of Object.entries(expectedData)) {
        if (goal[key] !== value) {
          console.error(`Goal ${key} mismatch: expected ${value}, got ${goal[key]}`);
          return false;
        }
      }

      return true;
    } catch (error) {
      console.error('Error verifying goal in DB:', error);
      return false;
    }
  }

  /**
   * Verify budget exists in database
   */
  async verifyBudgetInDb(budgetId: string, expectedData: Partial<Budget>): Promise<boolean> {
    try {
      const budgets = await this.apiClient.getBudgets();
      const budget = budgets.find(b => b.id === budgetId);
      
      if (!budget) return false;

      for (const [key, value] of Object.entries(expectedData)) {
        if (budget[key] !== value) {
          console.error(`Budget ${key} mismatch: expected ${value}, got ${budget[key]}`);
          return false;
        }
      }

      return true;
    } catch (error) {
      console.error('Error verifying budget in DB:', error);
      return false;
    }
  }

  /**
   * Verify portfolio holding exists
   */
  async verifyPortfolioHoldingInDb(holdingId: string, expectedData: Partial<PortfolioHolding>): Promise<boolean> {
    try {
      const portfolio = await this.apiClient.getPortfolio();
      const holding = portfolio.holdings?.find(h => h.id === holdingId);
      
      if (!holding) return false;

      for (const [key, value] of Object.entries(expectedData)) {
        if (holding[key] !== value) {
          console.error(`Holding ${key} mismatch: expected ${value}, got ${holding[key]}`);
          return false;
        }
      }

      return true;
    } catch (error) {
      console.error('Error verifying portfolio holding in DB:', error);
      return false;
    }
  }

  /**
   * Verify user data in database
   */
  async verifyUserInDb(expectedData: Partial<User>): Promise<boolean> {
    try {
      const user = await this.apiClient.getCurrentUser();
      
      for (const [key, value] of Object.entries(expectedData)) {
        if (user[key] !== value) {
          console.error(`User ${key} mismatch: expected ${value}, got ${user[key]}`);
          return false;
        }
      }

      return true;
    } catch (error) {
      console.error('Error verifying user in DB:', error);
      return false;
    }
  }

  /**
   * Verify data was deleted from database
   */
  async verifyDeletion(type: 'transaction' | 'goal' | 'budget', id: string): Promise<boolean> {
    try {
      switch (type) {
        case 'transaction':
          const transactions = await this.apiClient.getTransactions();
          return !transactions.find(t => t.id === id);
        
        case 'goal':
          const goals = await this.apiClient.getGoals();
          return !goals.find(g => g.id === id);
        
        case 'budget':
          const budgets = await this.apiClient.getBudgets();
          return !budgets.find(b => b.id === id);
        
        default:
          return false;
      }
    } catch (error) {
      console.error(`Error verifying ${type} deletion:`, error);
      return false;
    }
  }

  /**
   * Get total count of entities
   */
  async getEntityCount(type: 'transaction' | 'goal' | 'budget'): Promise<number> {
    try {
      switch (type) {
        case 'transaction':
          return (await this.apiClient.getTransactions()).length;
        case 'goal':
          return (await this.apiClient.getGoals()).length;
        case 'budget':
          return (await this.apiClient.getBudgets()).length;
        default:
          return 0;
      }
    } catch (error) {
      console.error(`Error getting ${type} count:`, error);
      return 0;
    }
  }

  /**
   * Cleanup - clear authentication
   */
  cleanup() {
    this.apiClient.clearAccessToken();
  }
}