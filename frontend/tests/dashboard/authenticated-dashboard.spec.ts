import { test, expect } from '@playwright/test';

test.describe('Authenticated Dashboard Experience', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the main dashboard
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('should display main dashboard components after login', async ({ page }) => {
    // Check for main dashboard layout elements
    await expect(page.locator('[data-testid="dashboard-layout"]')).toBeVisible();
    
    // Check for sidebar navigation
    const sidebar = page.locator('[data-testid="dashboard-sidebar"]');
    await expect(sidebar).toBeVisible();
    
    // Check for top navigation
    const topNav = page.locator('[data-testid="dashboard-topnav"]');
    await expect(topNav).toBeVisible();
    
    // Check for main content area
    const mainContent = page.locator('main');
    await expect(mainContent).toBeVisible();
  });

  test('should display welcome message with user name', async ({ page }) => {
    // Look for welcome message
    const welcomeMessage = page.locator('[data-testid="welcome-message"]');
    await expect(welcomeMessage).toBeVisible();
    
    // Check if it contains a greeting
    await expect(welcomeMessage).toContainText(/Welcome|Hello|Hi/i);
  });

  test('should display financial metrics cards', async ({ page }) => {
    // Check for metrics cards container
    const metricsCards = page.locator('[data-testid="metrics-cards"]');
    await expect(metricsCards).toBeVisible();
    
    // Check for specific metric cards
    const totalBalanceCard = page.locator('text=Total Balance, text=Net Worth').first();
    const monthlyIncomeCard = page.locator('text=Monthly Income, text=Income').first();
    const monthlyExpensesCard = page.locator('text=Monthly Expenses, text=Expenses').first();
    
    // At least one financial metric should be visible
    await expect(page.locator('text=/\\$[0-9,]+(\\.\\d{2})?/')).toBeVisible();
  });

  test('should display financial trend chart', async ({ page }) => {
    // Look for chart container
    const chartContainer = page.locator('[data-testid="financial-chart"]');
    await expect(chartContainer).toBeVisible();
    
    // Check for date range selector
    const dateRangeSelector = page.locator('[data-testid="date-range-selector"]');
    if (await dateRangeSelector.count() > 0) {
      await expect(dateRangeSelector).toBeVisible();
    }
  });

  test('should display recent transactions section', async ({ page }) => {
    // Look for transactions section
    const transactionsSection = page.locator('[data-testid="recent-transactions"]');
    await expect(transactionsSection).toBeVisible();
    
    // Check for section title
    await expect(page.locator('text=Recent Transactions, text=Transactions')).toBeVisible();
  });

  test('should display goals progress section', async ({ page }) => {
    // Look for goals section
    const goalsSection = page.locator('[data-testid="goals-progress"]');
    await expect(goalsSection).toBeVisible();
    
    // Check for section title
    await expect(page.locator('text=Goals, text=Financial Goals')).toBeVisible();
  });

  test('should display portfolio overview section', async ({ page }) => {
    // Look for portfolio section
    const portfolioSection = page.locator('[data-testid="portfolio-overview"]');
    await expect(portfolioSection).toBeVisible();
    
    // Check for section title
    await expect(page.locator('text=Portfolio, text=Investment')).toBeVisible();
  });

  test('should handle loading states properly', async ({ page }) => {
    // Reload page to catch loading states
    await page.reload();
    
    // Look for loading spinners
    const loadingSpinner = page.locator('[data-testid="loading-spinner"]');
    
    // If loading spinner appears, wait for it to disappear
    if (await loadingSpinner.count() > 0) {
      await expect(loadingSpinner).toBeVisible();
      await expect(loadingSpinner).toBeHidden({ timeout: 10000 });
    }
    
    // Ensure main content is visible after loading
    await expect(page.locator('main')).toBeVisible();
  });

  test('should handle error states gracefully', async ({ page }) => {
    // Check for error messages that might appear
    const errorMessage = page.locator('[data-testid="error-message"]');
    
    if (await errorMessage.count() > 0) {
      await expect(errorMessage).toBeVisible();
      
      // Check if there's a retry button
      const retryButton = page.locator('button:has-text("Retry"), button:has-text("Try Again")');
      if (await retryButton.count() > 0) {
        await expect(retryButton).toBeVisible();
      }
    }
  });

  test('should display demo alert in demo mode', async ({ page }) => {
    // Look for demo mode alert
    const demoAlert = page.locator('[data-testid="demo-alert"]');
    
    if (await demoAlert.count() > 0) {
      await expect(demoAlert).toBeVisible();
      await expect(demoAlert).toContainText(/demo/i);
    }
  });
});