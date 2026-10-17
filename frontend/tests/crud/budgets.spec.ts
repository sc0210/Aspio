/**
 * Budget CRUD Test Suite
 * Testing budget creation, category management, tracking, and alerts
 */

import { test, expect } from '@playwright/test';
import { TestHelpers, DatabaseTestHelpers } from '../utils/test-helpers';
import { DatabaseSetup } from '../utils/database-setup';
import { mockData } from '../utils/mock-data';
import { Budget } from '@/shared/types';

test.describe('Budget CRUD Operations', () => {
  let testHelpers: TestHelpers;
  let dbHelpers: DatabaseTestHelpers;
  let dbSetup: DatabaseSetup;
  let testBudget: Budget;

  test.beforeEach(async ({ page }) => {
    testHelpers = new TestHelpers(page);
    dbHelpers = new DatabaseTestHelpers();
    dbSetup = new DatabaseSetup();

    await testHelpers.navigateAndWait('/');
    const authToken = 'mock-auth-token';
    await dbSetup.initialize(authToken);
    dbHelpers.setAuthToken(authToken);
    testHelpers.authenticateApi(authToken);
  });

  test.afterEach(async () => {
    await dbSetup.cleanup();
    await testHelpers.cleanup();
    dbHelpers.cleanup();
  });

  test.describe('Create Budget', () => {
    test('should create monthly budget with Asian spending categories', async ({ page }) => {
      await testHelpers.navigateAndWait('/budgets/create');

      const budgetData = {
        name: 'Singapore Monthly Budget 2024',
        period: 'monthly',
        totalBudget: 4500,
        currency: 'SGD',
        categories: [
          { name: 'Food & Dining', amount: 800 },
          { name: 'Transportation (MRT/Bus)', amount: 150 },
          { name: 'HDB/Rent', amount: 1500 },
          { name: 'Utilities', amount: 200 },
          { name: 'Shopping', amount: 300 },
          { name: 'Healthcare', amount: 200 },
          { name: 'Entertainment', amount: 250 },
          { name: 'Savings/Investment', amount: 1100 }
        ]
      };

      // Fill basic budget information
      await testHelpers.fillFormField('[data-testid="budget-name"]', budgetData.name);
      await page.selectOption('[data-testid="budget-period"]', budgetData.period);
      await page.selectOption('[data-testid="budget-currency"]', budgetData.currency);
      
      // Set budget start date (first of current month)
      const startDate = new Date();
      startDate.setDate(1);
      await testHelpers.fillFormField('[data-testid="budget-start-date"]', startDate.toISOString().split('T')[0]);

      // Add budget categories
      for (let i = 0; i < budgetData.categories.length; i++) {
        const category = budgetData.categories[i];
        
        // Add category if not first (first might be pre-added)
        if (i > 0) {
          const addCategoryButton = page.locator('[data-testid="add-category"]');
          await addCategoryButton.click();
        }
        
        await testHelpers.fillFormField(`[data-testid="category-name-${i}"]`, category.name);
        await testHelpers.fillFormField(`[data-testid="category-amount-${i}"]`, category.amount.toString());
      }

      await testHelpers.submitFormAndWait();
      await testHelpers.verifySuccessMessage('Budget created successfully');

      // Verify redirect to budgets page
      await expect(page).toHaveURL('/budgets');

      // Verify budget appears in list
      await testHelpers.waitForElement('[data-testid="budgets-list"]');
      await expect(page.locator(`text=${budgetData.name}`)).toBeVisible();
      await expect(page.locator(`text=${budgetData.currency}`)).toBeVisible();
      await expect(page.locator(`text=${testHelpers.formatCurrency(budgetData.totalBudget)}`)).toBeVisible();

      // Verify categories are created
      for (const category of budgetData.categories) {
        await expect(page.locator(`text=${category.name}`)).toBeVisible();
      }

      await testHelpers.takeScreenshot('budget-created-singapore');
    });

    test('should create quarterly business budget', async ({ page }) => {
      await testHelpers.navigateAndWait('/budgets/create');

      const budgetData = {
        name: 'Q1 2024 Business Budget',
        period: 'quarterly',
        currency: 'USD',
        categories: [
          { name: 'Office Rent', amount: 6000 },
          { name: 'Marketing & Advertising', amount: 3000 },
          { name: 'Software & Tools', amount: 1500 },
          { name: 'Travel & Entertainment', amount: 2000 },
          { name: 'Professional Services', amount: 1500 }
        ]
      };

      await testHelpers.fillFormField('[data-testid="budget-name"]', budgetData.name);
      await page.selectOption('[data-testid="budget-period"]', budgetData.period);
      await page.selectOption('[data-testid="budget-currency"]', budgetData.currency);

      // Set quarterly dates
      const startDate = new Date(2024, 0, 1); // January 1, 2024
      const endDate = new Date(2024, 2, 31);  // March 31, 2024
      await testHelpers.fillFormField('[data-testid="budget-start-date"]', startDate.toISOString().split('T')[0]);
      await testHelpers.fillFormField('[data-testid="budget-end-date"]', endDate.toISOString().split('T')[0]);

      // Add business categories
      for (let i = 0; i < budgetData.categories.length; i++) {
        const category = budgetData.categories[i];
        
        if (i > 0) {
          await page.click('[data-testid="add-category"]');
        }
        
        await testHelpers.fillFormField(`[data-testid="category-name-${i}"]`, category.name);
        await testHelpers.fillFormField(`[data-testid="category-amount-${i}"]`, category.amount.toString());
      }

      await testHelpers.submitFormAndWait();
      await testHelpers.verifySuccessMessage();

      await testHelpers.takeScreenshot('budget-created-quarterly-business');
    });

    test('should validate budget input fields', async ({ page }) => {
      await testHelpers.navigateAndWait('/budgets/create');

      // Test empty budget name
      await testHelpers.submitFormAndWait();
      await expect(page.locator('[data-testid="name-error"]')).toBeVisible();

      // Test invalid date range
      const today = new Date();
      const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
      
      await testHelpers.fillFormField('[data-testid="budget-name"]', 'Test Budget');
      await testHelpers.fillFormField('[data-testid="budget-start-date"]', today.toISOString().split('T')[0]);
      await testHelpers.fillFormField('[data-testid="budget-end-date"]', yesterday.toISOString().split('T')[0]);
      
      await testHelpers.submitFormAndWait();
      await expect(page.locator('[data-testid="date-range-error"]')).toBeVisible();

      // Test negative category amounts
      await testHelpers.fillFormField('[data-testid="budget-end-date"]', '');
      await testHelpers.fillFormField('[data-testid="category-amount-0"]', '-100');
      
      await testHelpers.submitFormAndWait();
      await expect(page.locator('[data-testid="category-amount-error"]')).toBeVisible();
    });

    test('should auto-calculate total budget from categories', async ({ page }) => {
      await testHelpers.navigateAndWait('/budgets/create');

      await testHelpers.fillFormField('[data-testid="budget-name"]', 'Auto-calculation Test');

      // Add categories with specific amounts
      const categories = [
        { name: 'Food', amount: 500 },
        { name: 'Transport', amount: 200 },
        { name: 'Housing', amount: 1000 }
      ];

      for (let i = 0; i < categories.length; i++) {
        if (i > 0) {
          await page.click('[data-testid="add-category"]');
        }
        
        await testHelpers.fillFormField(`[data-testid="category-name-${i}"]`, categories[i].name);
        await testHelpers.fillFormField(`[data-testid="category-amount-${i}"]`, categories[i].amount.toString());
        
        // Trigger calculation
        await page.locator(`[data-testid="category-amount-${i}"]`).blur();
      }

      // Verify total is auto-calculated
      const expectedTotal = categories.reduce((sum, cat) => sum + cat.amount, 0);
      const totalField = page.locator('[data-testid="total-budget-calculated"]');
      
      if (await totalField.count() > 0) {
        await expect(totalField).toContainText(expectedTotal.toString());
      }
    });
  });

  test.describe('View Budgets', () => {
    test.beforeEach(async () => {
      await dbSetup.setupBasicTestData();
    });

    test('should display budgets dashboard with spending overview', async ({ page }) => {
      await testHelpers.navigateAndWait('/budgets');

      // Verify budgets list
      await testHelpers.waitForElement('[data-testid="budgets-list"]');
      
      // Check budget cards
      const budgetCards = page.locator('[data-testid="budget-card"]');
      await expect(budgetCards.first()).toBeVisible();

      // Verify spending progress indicators
      await expect(page.locator('[data-testid="spending-progress"]')).toBeVisible();
      
      // Check for budget status indicators
      const statusIndicators = page.locator('[data-testid="budget-status"]');
      const statusCount = await statusIndicators.count();
      
      for (let i = 0; i < statusCount; i++) {
        const status = statusIndicators.nth(i);
        await expect(status).toBeVisible();
        
        const statusClass = await status.getAttribute('class');
        expect(statusClass).toMatch(/(on-track|warning|exceeded|underspent)/);
      }

      // Verify spending chart
      await expect(page.locator('[data-testid="spending-chart"]')).toBeVisible();

      await testHelpers.takeScreenshot('budgets-dashboard');
    });

    test('should show detailed budget breakdown by category', async ({ page }) => {
      const testData = await dbSetup.getTestData();
      if (testData.budgets.length > 0) {
        const budget = testData.budgets[0];
        
        await testHelpers.navigateAndWait(`/budgets/${budget.id}`);
        
        // Verify budget details header
        await expect(page.locator(`text=${budget.name}`)).toBeVisible();
        await expect(page.locator(`text=${budget.period}`)).toBeVisible();
        
        // Check category breakdown table
        await expect(page.locator('[data-testid="category-breakdown"]')).toBeVisible();
        
        // Verify each category with progress bars
        for (const category of budget.categories) {
          await expect(page.locator(`text=${category.categoryName}`)).toBeVisible();
          await expect(page.locator(`text=${testHelpers.formatCurrency(category.budgetAmount)}`)).toBeVisible();
          await expect(page.locator(`text=${testHelpers.formatCurrency(category.spentAmount)}`)).toBeVisible();
          
          // Check progress bar
          const progressBar = page.locator(`[data-testid="progress-${category.categoryId}"]`);
          await expect(progressBar).toBeVisible();
          
          // Verify progress percentage
          const expectedPercentage = (category.spentAmount / category.budgetAmount) * 100;
          await expect(page.locator(`text=${expectedPercentage.toFixed(1)}%`)).toBeVisible();
        }
        
        await testHelpers.takeScreenshot(`budget-details-${budget.id}`);
      }
    });

    test('should filter budgets by period and status', async ({ page }) => {
      await testHelpers.navigateAndWait('/budgets');

      // Filter by monthly budgets
      const periodFilter = page.locator('[data-testid="period-filter"]');
      if (await periodFilter.count() > 0) {
        await periodFilter.selectOption('monthly');
        await testHelpers.waitForPageLoad();
        
        const monthlyBudgets = page.locator('[data-testid="budget-card"]');
        const monthlyCount = await monthlyBudgets.count();
        
        for (let i = 0; i < monthlyCount; i++) {
          const budget = monthlyBudgets.nth(i);
          await expect(budget.locator('[data-testid="budget-period"]')).toContainText('monthly');
        }
      }

      // Filter by active status
      const statusFilter = page.locator('[data-testid="status-filter"]');
      if (await statusFilter.count() > 0) {
        await statusFilter.selectOption('active');
        await testHelpers.waitForPageLoad();
        
        const activeBudgets = page.locator('[data-testid="budget-card"]');
        const activeCount = await activeBudgets.count();
        
        for (let i = 0; i < activeCount; i++) {
          const budget = activeBudgets.nth(i);
          await expect(budget.locator('[data-testid="budget-status"]')).toContainText('active');
        }
      }
    });

    test('should display spending alerts and notifications', async ({ page }) => {
      await testHelpers.navigateAndWait('/budgets');
      
      // Check for spending alerts
      const alerts = page.locator('[data-testid="spending-alert"]');
      const alertCount = await alerts.count();
      
      if (alertCount > 0) {
        for (let i = 0; i < alertCount; i++) {
          const alert = alerts.nth(i);
          await expect(alert).toBeVisible();
          
          // Verify alert type
          const alertType = await alert.getAttribute('data-alert-type');
          expect(['warning', 'danger', 'info']).toContain(alertType);
          
          // Check alert message
          const alertMessage = await alert.textContent();
          expect(alertMessage).toMatch(/(exceeded|approaching|under)/);
        }
      }
      
      // Check budget recommendations
      const recommendations = page.locator('[data-testid="budget-recommendations"]');
      if (await recommendations.count() > 0) {
        await expect(recommendations).toBeVisible();
        
        const recommendationItems = page.locator('[data-testid="recommendation-item"]');
        const recCount = await recommendationItems.count();
        
        for (let i = 0; i < recCount; i++) {
          await expect(recommendationItems.nth(i)).toBeVisible();
        }
      }
    });
  });

  test.describe('Update Budget', () => {
    test.beforeEach(async () => {
      const testData = await dbSetup.setupBasicTestData();
      if (testData.budgets.length > 0) {
        testBudget = testData.budgets[0];
      }
    });

    test('should update budget categories and amounts', async ({ page }) => {
      expect(testBudget).toBeDefined();
      
      await testHelpers.navigateAndWait(`/budgets/edit/${testBudget.id}`);

      // Verify form is pre-populated
      await expect(page.locator('[data-testid="budget-name"]')).toHaveValue(testBudget.name);
      
      // Update budget name
      const updatedName = 'Updated: ' + testBudget.name;
      await testHelpers.fillFormField('[data-testid="budget-name"]', updatedName);
      
      // Update first category amount
      if (testBudget.categories.length > 0) {
        const category = testBudget.categories[0];
        const newAmount = category.budgetAmount + 200;
        
        await testHelpers.fillFormField(`[data-testid="category-amount-0"]`, newAmount.toString());
      }
      
      // Add new category
      await page.click('[data-testid="add-category"]');
      const newCategoryIndex = testBudget.categories.length;
      
      await testHelpers.fillFormField(`[data-testid="category-name-${newCategoryIndex}"]`, 'New Category');
      await testHelpers.fillFormField(`[data-testid="category-amount-${newCategoryIndex}"]`, '300');

      await testHelpers.submitFormAndWait();
      await testHelpers.verifySuccessMessage('Budget updated successfully');

      // Verify changes in database
      const isUpdated = await dbHelpers.verifyBudgetInDb(testBudget.id, {
        name: updatedName
      });
      expect(isUpdated).toBe(true);

      // Verify changes in UI
      await testHelpers.navigateAndWait('/budgets');
      await expect(page.locator(`text=${updatedName}`)).toBeVisible();
      await expect(page.locator('text=New Category')).toBeVisible();
    });

    test('should adjust budget period and recalculate spending', async ({ page }) => {
      expect(testBudget).toBeDefined();
      
      if (testBudget.period === 'monthly') {
        await testHelpers.navigateAndWait(`/budgets/edit/${testBudget.id}`);
        
        // Change to quarterly
        await page.selectOption('[data-testid="budget-period"]', 'quarterly');
        
        // Adjust end date for quarterly period
        const startDate = new Date(testBudget.startDate);
        const endDate = new Date(startDate);
        endDate.setMonth(endDate.getMonth() + 3);
        
        await testHelpers.fillFormField('[data-testid="budget-end-date"]', endDate.toISOString().split('T')[0]);
        
        await testHelpers.submitFormAndWait();
        await testHelpers.verifySuccessMessage();
        
        // Verify period change
        await testHelpers.navigateAndWait('/budgets');
        await expect(page.locator('text=quarterly')).toBeVisible();
      }
    });

    test('should remove budget category', async ({ page }) => {
      expect(testBudget).toBeDefined();
      
      if (testBudget.categories.length > 1) {
        await testHelpers.navigateAndWait(`/budgets/edit/${testBudget.id}`);
        
        const categoryToRemove = testBudget.categories[0];
        
        // Click remove button for first category
        const removeButton = page.locator('[data-testid="remove-category-0"]');
        await removeButton.click();
        
        // Confirm removal
        const confirmDialog = page.locator('[data-testid="confirm-remove-category"]');
        if (await confirmDialog.count() > 0) {
          await expect(confirmDialog).toContainText(categoryToRemove.categoryName);
          await page.click('[data-testid="confirm-remove"]');
        }
        
        await testHelpers.submitFormAndWait();
        await testHelpers.verifySuccessMessage();
        
        // Verify category is removed
        await testHelpers.navigateAndWait(`/budgets/${testBudget.id}`);
        await expect(page.locator(`text=${categoryToRemove.categoryName}`)).not.toBeVisible();
      }
    });
  });

  test.describe('Delete Budget', () => {
    test.beforeEach(async () => {
      const testData = await dbSetup.setupBasicTestData();
      if (testData.budgets.length > 0) {
        testBudget = testData.budgets[0];
      }
    });

    test('should delete budget with confirmation', async ({ page }) => {
      expect(testBudget).toBeDefined();
      
      await testHelpers.navigateAndWait('/budgets');
      
      // Click delete button
      const deleteButton = page.locator(`[data-testid="delete-budget-${testBudget.id}"]`);
      await deleteButton.click();
      
      // Handle confirmation dialog
      const confirmDialog = page.locator('[data-testid="confirm-delete-budget"]');
      await expect(confirmDialog).toBeVisible();
      await expect(confirmDialog).toContainText(testBudget.name);
      await expect(confirmDialog).toContainText('all spending data');
      
      await page.click('[data-testid="confirm-delete"]');
      await testHelpers.verifySuccessMessage('Budget deleted successfully');
      
      // Verify budget is removed from UI
      await expect(page.locator(`text=${testBudget.name}`)).not.toBeVisible();
      
      // Verify deletion in database
      const isDeleted = await dbHelpers.verifyDeletion('budget', testBudget.id);
      expect(isDeleted).toBe(true);
      
      dbSetup.removeBudget(testBudget.id);
    });

    test('should prevent deletion of active budget with recent spending', async ({ page }) => {
      expect(testBudget).toBeDefined();
      
      await testHelpers.navigateAndWait('/budgets');
      
      const deleteButton = page.locator(`[data-testid="delete-budget-${testBudget.id}"]`);
      await deleteButton.click();
      
      // Should show warning about recent spending
      const warningDialog = page.locator('[data-testid="deletion-warning"]');
      if (await warningDialog.count() > 0) {
        await expect(warningDialog).toBeVisible();
        await expect(warningDialog).toContainText('recent transactions');
        
        // Should provide option to archive instead
        const archiveButton = page.locator('[data-testid="archive-instead"]');
        if (await archiveButton.count() > 0) {
          await expect(archiveButton).toBeVisible();
          await archiveButton.click();
          
          await testHelpers.verifySuccessMessage('Budget archived');
        }
      }
    });
  });

  test.describe('Budget Analytics and Tracking', () => {
    test.beforeEach(async () => {
      await dbSetup.setupComplexScenario();
    });

    test('should display spending trends and forecasts', async ({ page }) => {
      await testHelpers.navigateAndWait('/budgets/analytics');
      
      // Check spending trend chart
      await expect(page.locator('[data-testid="spending-trends"]')).toBeVisible();
      
      // Verify forecast section
      const forecastSection = page.locator('[data-testid="spending-forecast"]');
      if (await forecastSection.count() > 0) {
        await expect(forecastSection).toBeVisible();
        
        // Should show projected end-of-period spending
        await expect(page.locator('[data-testid="projected-spending"]')).toBeVisible();
      }
      
      // Check category comparison
      await expect(page.locator('[data-testid="category-comparison"]')).toBeVisible();
      
      await testHelpers.takeScreenshot('budget-analytics');
    });

    test('should show budget vs actual spending comparison', async ({ page }) => {
      const testData = await dbSetup.getTestData();
      if (testData.budgets.length > 0) {
        const budget = testData.budgets[0];
        
        await testHelpers.navigateAndWait(`/budgets/${budget.id}/analytics`);
        
        // Verify comparison chart
        await expect(page.locator('[data-testid="budget-vs-actual"]')).toBeVisible();
        
        // Check variance analysis
        await expect(page.locator('[data-testid="variance-analysis"]')).toBeVisible();
        
        // Verify categories with highest variances are highlighted
        const varianceItems = page.locator('[data-testid="high-variance"]');
        const varianceCount = await varianceItems.count();
        
        for (let i = 0; i < varianceCount; i++) {
          const item = varianceItems.nth(i);
          await expect(item).toBeVisible();
          
          const varianceText = await item.textContent();
          expect(varianceText).toMatch(/[+-]\d+%/);
        }
      }
    });

    test('should provide spending recommendations', async ({ page }) => {
      await testHelpers.navigateAndWait('/budgets/recommendations');
      
      const recommendationsSection = page.locator('[data-testid="budget-recommendations"]');
      await expect(recommendationsSection).toBeVisible();
      
      // Check different types of recommendations
      const recommendationTypes = ['optimization', 'alert', 'savings-opportunity'];
      
      for (const type of recommendationTypes) {
        const typeRecommendations = page.locator(`[data-testid="recommendation-${type}"]`);
        if (await typeRecommendations.count() > 0) {
          await expect(typeRecommendations.first()).toBeVisible();
        }
      }
      
      // Verify actionable recommendations
      const actionableItems = page.locator('[data-testid="actionable-recommendation"]');
      const actionCount = await actionableItems.count();
      
      for (let i = 0; i < actionCount; i++) {
        const item = actionableItems.nth(i);
        await expect(item).toBeVisible();
        
        // Should have action button
        const actionButton = item.locator('[data-testid="take-action"]');
        if (await actionButton.count() > 0) {
          await expect(actionButton).toBeVisible();
        }
      }
    });
  });

  test.describe('Error Handling and Edge Cases', () => {
    test('should handle overlapping budget periods', async ({ page }) => {
      await testHelpers.navigateAndWait('/budgets/create');
      
      // Create budget with dates that might overlap existing ones
      const budgetData = {
        name: 'Overlapping Budget Test',
        startDate: new Date(),
        endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days from now
      };
      
      await testHelpers.fillFormField('[data-testid="budget-name"]', budgetData.name);
      await testHelpers.fillFormField('[data-testid="budget-start-date"]', budgetData.startDate.toISOString().split('T')[0]);
      await testHelpers.fillFormField('[data-testid="budget-end-date"]', budgetData.endDate.toISOString().split('T')[0]);
      
      await testHelpers.submitFormAndWait();
      
      // Should either show warning about overlap or allow multiple budgets
      const hasWarning = await testHelpers.elementExists('[data-testid="overlap-warning"]');
      const hasSuccess = await testHelpers.elementExists('[data-testid="success-message"]');
      
      expect(hasWarning || hasSuccess).toBe(true);
    });

    test('should handle zero and negative spending scenarios', async ({ page }) => {
      const testData = await dbSetup.setupBasicTestData();
      if (testData.budgets.length > 0) {
        const budget = testData.budgets[0];
        
        await testHelpers.navigateAndWait(`/budgets/${budget.id}`);
        
        // Check how zero spending categories are displayed
        const zeroSpendingCategories = page.locator('[data-testid="zero-spending"]');
        if (await zeroSpendingCategories.count() > 0) {
          for (let i = 0; i < await zeroSpendingCategories.count(); i++) {
            const category = zeroSpendingCategories.nth(i);
            await expect(category).toBeVisible();
            await expect(category).toContainText('$0.00');
          }
        }
        
        // Verify progress bars handle zero values
        const progressBars = page.locator('[data-testid="category-progress"]');
        const progressCount = await progressBars.count();
        
        for (let i = 0; i < progressCount; i++) {
          const progress = progressBars.nth(i);
          await expect(progress).toBeVisible();
          
          const progressValue = await progress.getAttribute('data-progress');
          expect(parseFloat(progressValue || '0')).toBeGreaterThanOrEqual(0);
        }
      }
    });

    test('should handle currency conversion in multi-currency budgets', async ({ page }) => {
      await testHelpers.navigateAndWait('/budgets');
      
      // Check for currency indicators
      const currencyElements = page.locator('[data-testid="budget-currency"]');
      const currencyCount = await currencyElements.count();
      
      if (currencyCount > 0) {
        const currencies = new Set();
        
        for (let i = 0; i < currencyCount; i++) {
          const currencyText = await currencyElements.nth(i).textContent();
          currencies.add(currencyText);
        }
        
        // If multiple currencies, should show conversion rates or total
        if (currencies.size > 1) {
          const conversionIndicator = page.locator('[data-testid="currency-conversion"]');
          if (await conversionIndicator.count() > 0) {
            await expect(conversionIndicator).toBeVisible();
          }
        }
      }
    });
  });

  test.describe('Performance and Accessibility', () => {
    test('should load budgets page efficiently with large datasets', async ({ page }) => {
      const startTime = Date.now();
      await testHelpers.navigateAndWait('/budgets');
      const endTime = Date.now();
      
      const loadTime = endTime - startTime;
      expect(loadTime).toBeLessThan(3000);
      
      console.log(`Budgets page loaded in ${loadTime}ms`);
    });

    test('should be keyboard accessible', async ({ page }) => {
      await testHelpers.navigateAndWait('/budgets/create');
      
      // Test keyboard navigation through form
      await page.keyboard.press('Tab');
      await expect(page.locator('[data-testid="budget-name"]')).toBeFocused();
      
      await page.keyboard.press('Tab');
      await expect(page.locator('[data-testid="budget-period"]')).toBeFocused();
      
      await page.keyboard.press('Tab');
      await expect(page.locator('[data-testid="budget-currency"]')).toBeFocused();
    });

    test('should work on mobile devices', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      await testHelpers.navigateAndWait('/budgets');
      
      // Verify mobile layout
      const budgetsContainer = page.locator('[data-testid="budgets-container"]');
      await expect(budgetsContainer).toBeVisible();
      
      // Test mobile interactions
      const budgetCard = page.locator('[data-testid="budget-card"]').first();
      if (await budgetCard.count() > 0) {
        await budgetCard.tap();
        await testHelpers.waitForPageLoad();
      }
      
      await testHelpers.takeScreenshot('budgets-mobile');
    });
  });
});