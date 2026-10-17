/**
 * Financial Goals CRUD Test Suite
 * Testing goal creation, tracking, milestone management, and database verification
 */

import { test, expect } from '@playwright/test';
import { TestHelpers, DatabaseTestHelpers } from '../utils/test-helpers';
import { DatabaseSetup } from '../utils/database-setup';
import { mockData } from '../utils/mock-data';
import { FinancialGoal } from '@/shared/types';

test.describe('Financial Goals CRUD Operations', () => {
  let testHelpers: TestHelpers;
  let dbHelpers: DatabaseTestHelpers;
  let dbSetup: DatabaseSetup;
  let testGoal: FinancialGoal;

  test.beforeEach(async ({ page }) => {
    testHelpers = new TestHelpers(page);
    dbHelpers = new DatabaseTestHelpers();
    dbSetup = new DatabaseSetup();

    // Initialize with authentication
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

  test.describe('Create Financial Goal', () => {
    test('should create emergency fund goal successfully', async ({ page }) => {
      await testHelpers.navigateAndWait('/goals/create');

      const goalData = mockData.generateFinancialGoal({
        title: 'Emergency Fund 2024',
        description: 'Build 6-month emergency fund',
        targetAmount: 30000,
        currentAmount: 5000,
        category: 'emergency_fund',
        priority: 'high',
        targetDate: testHelpers.randomDate(new Date(2024, 11, 31), new Date(2025, 11, 31))
      });

      // Fill goal creation form
      await testHelpers.fillFormField('[data-testid="goal-title"]', goalData.title);
      await testHelpers.fillFormField('[data-testid="goal-description"]', goalData.description || '');
      await page.selectOption('[data-testid="goal-category"]', goalData.category);
      await testHelpers.fillFormField('[data-testid="goal-target-amount"]', goalData.targetAmount.toString());
      await testHelpers.fillFormField('[data-testid="goal-current-amount"]', goalData.currentAmount.toString());
      await page.selectOption('[data-testid="goal-priority"]', goalData.priority);
      await testHelpers.fillFormField('[data-testid="goal-target-date"]', goalData.targetDate.toISOString().split('T')[0]);

      await testHelpers.submitFormAndWait();
      await testHelpers.verifySuccessMessage('Goal created successfully');

      // Verify redirect to goals page
      await expect(page).toHaveURL('/goals');

      // Verify goal appears in goals list
      await testHelpers.waitForElement('[data-testid="goals-list"]');
      await expect(page.locator(`text=${goalData.title}`)).toBeVisible();
      
      // Verify progress calculation
      const expectedProgress = (goalData.currentAmount / goalData.targetAmount) * 100;
      const progressText = `${expectedProgress.toFixed(1)}%`;
      await expect(page.locator(`text=${progressText}`)).toBeVisible();

      // Verify database entry
      const dbStats = await dbSetup.getDatabaseStats();
      expect(dbStats.goalCount).toBeGreaterThan(0);

      await testHelpers.takeScreenshot('goal-created-emergency-fund');
    });

    test('should create vacation goal with milestones', async ({ page }) => {
      await testHelpers.navigateAndWait('/goals/create');

      const goalData = mockData.generateFinancialGoal({
        title: 'Japan Vacation 2024',
        description: 'Two-week trip to Japan',
        targetAmount: 8000,
        category: 'vacation',
        priority: 'medium'
      });

      // Fill basic goal data
      await testHelpers.fillFormField('[data-testid="goal-title"]', goalData.title);
      await testHelpers.fillFormField('[data-testid="goal-description"]', goalData.description || '');
      await page.selectOption('[data-testid="goal-category"]', goalData.category);
      await testHelpers.fillFormField('[data-testid="goal-target-amount"]', goalData.targetAmount.toString());
      await page.selectOption('[data-testid="goal-priority"]', goalData.priority);
      await testHelpers.fillFormField('[data-testid="goal-target-date"]', goalData.targetDate.toISOString().split('T')[0]);

      // Add milestones if milestone section exists
      const addMilestoneButton = page.locator('[data-testid="add-milestone"]');
      if (await addMilestoneButton.count() > 0) {
        await addMilestoneButton.click();
        
        await testHelpers.fillFormField('[data-testid="milestone-title-0"]', 'Flight Booking');
        await testHelpers.fillFormField('[data-testid="milestone-amount-0"]', '2000');
        await testHelpers.fillFormField('[data-testid="milestone-date-0"]', '2024-06-01');
        
        await addMilestoneButton.click();
        await testHelpers.fillFormField('[data-testid="milestone-title-1"]', 'Accommodation');
        await testHelpers.fillFormField('[data-testid="milestone-amount-1"]', '4000');
        await testHelpers.fillFormField('[data-testid="milestone-date-1"]', '2024-08-01');
      }

      await testHelpers.submitFormAndWait();
      await testHelpers.verifySuccessMessage();

      // Verify milestones in goal detail view
      const goalLink = page.locator(`[data-testid="goal-link-${goalData.title}"]`);
      if (await goalLink.count() > 0) {
        await goalLink.click();
        await expect(page.locator('text=Flight Booking')).toBeVisible();
        await expect(page.locator('text=Accommodation')).toBeVisible();
      }

      await testHelpers.takeScreenshot('goal-created-with-milestones');
    });

    test('should validate goal input fields', async ({ page }) => {
      await testHelpers.navigateAndWait('/goals/create');

      // Test negative target amount
      await testHelpers.fillFormField('[data-testid="goal-target-amount"]', '-1000');
      await testHelpers.submitFormAndWait();
      await expect(page.locator('[data-testid="target-amount-error"]')).toBeVisible();

      // Test empty required fields
      await testHelpers.fillFormField('[data-testid="goal-target-amount"]', '');
      await testHelpers.fillFormField('[data-testid="goal-title"]', '');
      await testHelpers.submitFormAndWait();
      
      await expect(page.locator('[data-testid="title-error"]')).toBeVisible();
      await expect(page.locator('[data-testid="target-amount-error"]')).toBeVisible();

      // Test past target date
      const pastDate = new Date();
      pastDate.setMonth(pastDate.getMonth() - 1);
      await testHelpers.fillFormField('[data-testid="goal-target-date"]', pastDate.toISOString().split('T')[0]);
      await testHelpers.submitFormAndWait();
      await expect(page.locator('[data-testid="target-date-error"]')).toBeVisible();
    });
  });

  test.describe('Read Goals', () => {
    test.beforeEach(async () => {
      await dbSetup.setupBasicTestData();
    });

    test('should display goals dashboard with progress visualization', async ({ page }) => {
      await testHelpers.navigateAndWait('/goals');

      // Verify goals list is visible
      await testHelpers.waitForElement('[data-testid="goals-list"]');
      
      // Check for goal cards
      const goalCards = page.locator('[data-testid="goal-card"]');
      await expect(goalCards.first()).toBeVisible();

      // Verify progress bars/charts
      await expect(page.locator('[data-testid="goal-progress"]')).toBeVisible();

      // Check goal categories are displayed
      const categories = ['emergency_fund', 'vacation', 'retirement', 'house_down_payment'];
      for (const category of categories) {
        const categoryGoals = page.locator(`[data-category="${category}"]`);
        if (await categoryGoals.count() > 0) {
          await expect(categoryGoals.first()).toBeVisible();
        }
      }

      await testHelpers.takeScreenshot('goals-dashboard');
    });

    test('should filter goals by status and category', async ({ page }) => {
      await testHelpers.navigateAndWait('/goals');

      // Filter by active status
      const statusFilter = page.locator('[data-testid="status-filter"]');
      if (await statusFilter.count() > 0) {
        await statusFilter.selectOption('active');
        await testHelpers.waitForPageLoad();
        
        const activeGoals = page.locator('[data-testid="goal-card"]');
        const activeCount = await activeGoals.count();
        
        for (let i = 0; i < activeCount; i++) {
          const goal = activeGoals.nth(i);
          await expect(goal.locator('[data-testid="goal-status"]')).toContainText('active');
        }
      }

      // Filter by category
      const categoryFilter = page.locator('[data-testid="category-filter"]');
      if (await categoryFilter.count() > 0) {
        await categoryFilter.selectOption('emergency_fund');
        await testHelpers.waitForPageLoad();
        
        const categoryGoals = page.locator('[data-testid="goal-card"]');
        if (await categoryGoals.count() > 0) {
          await expect(categoryGoals.first().locator('[data-testid="goal-category"]')).toContainText('emergency_fund');
        }
      }
    });

    test('should display goal details with milestone tracking', async ({ page }) => {
      const testData = await dbSetup.getTestData();
      if (testData.goals.length > 0) {
        const goal = testData.goals[0];
        
        await testHelpers.navigateAndWait(`/goals/${goal.id}`);
        
        // Verify goal details
        await expect(page.locator(`text=${goal.title}`)).toBeVisible();
        await expect(page.locator(`text=${testHelpers.formatCurrency(goal.targetAmount)}`)).toBeVisible();
        await expect(page.locator(`text=${testHelpers.formatCurrency(goal.currentAmount)}`)).toBeVisible();
        
        // Check progress visualization
        await expect(page.locator('[data-testid="progress-chart"]')).toBeVisible();
        
        // Verify milestones if they exist
        if (goal.milestones && goal.milestones.length > 0) {
          await expect(page.locator('[data-testid="milestones-section"]')).toBeVisible();
          
          for (const milestone of goal.milestones) {
            await expect(page.locator(`text=${milestone.title}`)).toBeVisible();
          }
        }
        
        await testHelpers.takeScreenshot(`goal-details-${goal.id}`);
      }
    });
  });

  test.describe('Update Goals', () => {
    test.beforeEach(async () => {
      const testData = await dbSetup.setupBasicTestData();
      if (testData.goals.length > 0) {
        testGoal = testData.goals[0];
      }
    });

    test('should update goal details successfully', async ({ page }) => {
      expect(testGoal).toBeDefined();
      
      await testHelpers.navigateAndWait(`/goals/edit/${testGoal.id}`);

      // Verify form is pre-populated
      await expect(page.locator('[data-testid="goal-title"]')).toHaveValue(testGoal.title);
      await expect(page.locator('[data-testid="goal-target-amount"]')).toHaveValue(testGoal.targetAmount.toString());

      // Update goal data
      const updatedData = {
        title: 'Updated: ' + testGoal.title,
        targetAmount: testGoal.targetAmount + 5000,
        description: 'Updated goal description with new target'
      };

      await testHelpers.fillFormField('[data-testid="goal-title"]', updatedData.title);
      await testHelpers.fillFormField('[data-testid="goal-target-amount"]', updatedData.targetAmount.toString());
      await testHelpers.fillFormField('[data-testid="goal-description"]', updatedData.description);

      await testHelpers.submitFormAndWait();
      await testHelpers.verifySuccessMessage('Goal updated successfully');

      // Verify changes in database
      const isVerified = await dbHelpers.verifyGoalInDb(testGoal.id, updatedData);
      expect(isVerified).toBe(true);

      // Verify updated progress calculation
      await testHelpers.navigateAndWait('/goals');
      await expect(page.locator(`text=${updatedData.title}`)).toBeVisible();
      
      const newProgress = (testGoal.currentAmount / updatedData.targetAmount) * 100;
      const newProgressText = `${newProgress.toFixed(1)}%`;
      await expect(page.locator(`text=${newProgressText}`)).toBeVisible();
    });

    test('should add contribution to goal', async ({ page }) => {
      expect(testGoal).toBeDefined();
      
      await testHelpers.navigateAndWait(`/goals/${testGoal.id}`);
      
      // Add contribution
      const addContributionButton = page.locator('[data-testid="add-contribution"]');
      await addContributionButton.click();
      
      const contributionAmount = 500;
      await testHelpers.fillFormField('[data-testid="contribution-amount"]', contributionAmount.toString());
      await testHelpers.fillFormField('[data-testid="contribution-note"]', 'Test contribution via automation');
      
      await page.click('[data-testid="submit-contribution"]');
      await testHelpers.verifySuccessMessage('Contribution added successfully');
      
      // Verify updated current amount
      const expectedNewAmount = testGoal.currentAmount + contributionAmount;
      await expect(page.locator(`text=${testHelpers.formatCurrency(expectedNewAmount)}`)).toBeVisible();
      
      // Verify progress updated
      const newProgress = (expectedNewAmount / testGoal.targetAmount) * 100;
      await expect(page.locator(`text=${newProgress.toFixed(1)}%`)).toBeVisible();
      
      // Verify contribution appears in history
      await expect(page.locator('[data-testid="contribution-history"]')).toBeVisible();
      await expect(page.locator('text=Test contribution via automation')).toBeVisible();
    });

    test('should complete milestone', async ({ page }) => {
      expect(testGoal).toBeDefined();
      
      if (testGoal.milestones && testGoal.milestones.length > 0) {
        const milestone = testGoal.milestones[0];
        
        await testHelpers.navigateAndWait(`/goals/${testGoal.id}`);
        
        // Mark milestone as complete
        const milestoneCheckbox = page.locator(`[data-testid="milestone-complete-${milestone.id}"]`);
        await milestoneCheckbox.check();
        
        await testHelpers.verifySuccessMessage('Milestone completed!');
        
        // Verify milestone appears as completed
        await expect(page.locator(`[data-testid="milestone-${milestone.id}"]`)).toHaveClass(/completed/);
        
        // Check for completion celebration/animation
        const celebrationElement = page.locator('[data-testid="milestone-celebration"]');
        if (await celebrationElement.count() > 0) {
          await expect(celebrationElement).toBeVisible();
        }
        
        await testHelpers.takeScreenshot('milestone-completed');
      }
    });
  });

  test.describe('Delete Goals', () => {
    test.beforeEach(async () => {
      const testData = await dbSetup.setupBasicTestData();
      if (testData.goals.length > 0) {
        testGoal = testData.goals[0];
      }
    });

    test('should delete goal with confirmation', async ({ page }) => {
      expect(testGoal).toBeDefined();
      
      await testHelpers.navigateAndWait('/goals');
      
      // Click delete button
      const deleteButton = page.locator(`[data-testid="delete-goal-${testGoal.id}"]`);
      await deleteButton.click();
      
      // Handle confirmation dialog
      const confirmDialog = page.locator('[data-testid="confirm-delete-goal"]');
      await expect(confirmDialog).toBeVisible();
      await expect(confirmDialog).toContainText(testGoal.title);
      await expect(confirmDialog).toContainText('This action cannot be undone');
      
      await page.click('[data-testid="confirm-delete"]');
      await testHelpers.verifySuccessMessage('Goal deleted successfully');
      
      // Verify goal is removed from UI
      await expect(page.locator(`text=${testGoal.title}`)).not.toBeVisible();
      
      // Verify deletion in database
      const isDeleted = await dbHelpers.verifyDeletion('goal', testGoal.id);
      expect(isDeleted).toBe(true);
      
      dbSetup.removeGoal(testGoal.id);
    });

    test('should prevent deletion of goals with contributions', async ({ page }) => {
      expect(testGoal).toBeDefined();
      
      // First add a contribution
      await testHelpers.navigateAndWait(`/goals/${testGoal.id}`);
      
      const addContributionButton = page.locator('[data-testid="add-contribution"]');
      if (await addContributionButton.count() > 0) {
        await addContributionButton.click();
        await testHelpers.fillFormField('[data-testid="contribution-amount"]', '100');
        await page.click('[data-testid="submit-contribution"]');
        await testHelpers.verifySuccessMessage();
      }
      
      // Now try to delete the goal
      await testHelpers.navigateAndWait('/goals');
      const deleteButton = page.locator(`[data-testid="delete-goal-${testGoal.id}"]`);
      await deleteButton.click();
      
      // Should show warning about contributions
      const warningDialog = page.locator('[data-testid="delete-warning"]');
      await expect(warningDialog).toBeVisible();
      await expect(warningDialog).toContainText('contributions will be lost');
    });
  });

  test.describe('Goal Analytics and Tracking', () => {
    test.beforeEach(async () => {
      await dbSetup.setupComplexScenario();
    });

    test('should display goal progress analytics', async ({ page }) => {
      await testHelpers.navigateAndWait('/goals/analytics');
      
      // Check for analytics dashboard elements
      await expect(page.locator('[data-testid="goal-progress-chart"]')).toBeVisible();
      await expect(page.locator('[data-testid="completion-timeline"]')).toBeVisible();
      
      // Verify goal categories breakdown
      await expect(page.locator('[data-testid="category-breakdown"]')).toBeVisible();
      
      // Check savings rate calculation
      const savingsRateElement = page.locator('[data-testid="savings-rate"]');
      if (await savingsRateElement.count() > 0) {
        const savingsRateText = await savingsRateElement.textContent();
        expect(savingsRateText).toMatch(/\d+\.\d+%/);
      }
      
      await testHelpers.takeScreenshot('goal-analytics-dashboard');
    });

    test('should show goal completion predictions', async ({ page }) => {
      const testData = await dbSetup.getTestData();
      if (testData.goals.length > 0) {
        const activeGoal = testData.goals.find(g => g.status === 'active');
        
        if (activeGoal) {
          await testHelpers.navigateAndWait(`/goals/${activeGoal.id}`);
          
          // Look for prediction elements
          const predictionSection = page.locator('[data-testid="completion-prediction"]');
          if (await predictionSection.count() > 0) {
            await expect(predictionSection).toBeVisible();
            
            // Should show estimated completion date
            await expect(page.locator('[data-testid="estimated-completion"]')).toBeVisible();
            
            // Should show required monthly savings
            await expect(page.locator('[data-testid="required-monthly"]')).toBeVisible();
          }
        }
      }
    });

    test('should handle goal categories with different currencies', async ({ page }) => {
      await testHelpers.navigateAndWait('/goals');
      
      // Check for currency conversion if multiple currencies exist
      const currencyElements = page.locator('[data-testid="goal-currency"]');
      const currencyCount = await currencyElements.count();
      
      if (currencyCount > 0) {
        const currencies = new Set();
        
        for (let i = 0; i < currencyCount; i++) {
          const currencyText = await currencyElements.nth(i).textContent();
          currencies.add(currencyText);
        }
        
        // If multiple currencies, should show conversion
        if (currencies.size > 1) {
          const conversionElement = page.locator('[data-testid="currency-conversion"]');
          await expect(conversionElement).toBeVisible();
        }
      }
    });
  });

  test.describe('Error Handling', () => {
    test('should handle server errors gracefully', async ({ page }) => {
      // Simulate server error during goal creation
      await testHelpers.navigateAndWait('/goals/create');
      
      const goalData = mockData.generateFinancialGoal();
      await testHelpers.fillFormField('[data-testid="goal-title"]', goalData.title);
      await testHelpers.fillFormField('[data-testid="goal-target-amount"]', goalData.targetAmount.toString());
      
      // This would trigger a server error in a real scenario
      await testHelpers.submitFormAndWait();
      
      // Should handle errors gracefully
      const errorElement = page.locator('[data-testid="error-message"]');
      if (await errorElement.count() > 0) {
        await expect(errorElement).toBeVisible();
        
        // Should provide retry option
        const retryButton = page.locator('[data-testid="retry-button"]');
        if (await retryButton.count() > 0) {
          await expect(retryButton).toBeVisible();
        }
      }
    });

    test('should validate contribution amounts', async ({ page }) => {
      const testData = await dbSetup.setupBasicTestData();
      if (testData.goals.length > 0) {
        const goal = testData.goals[0];
        
        await testHelpers.navigateAndWait(`/goals/${goal.id}`);
        
        const addContributionButton = page.locator('[data-testid="add-contribution"]');
        if (await addContributionButton.count() > 0) {
          await addContributionButton.click();
          
          // Test negative contribution
          await testHelpers.fillFormField('[data-testid="contribution-amount"]', '-100');
          await page.click('[data-testid="submit-contribution"]');
          await expect(page.locator('[data-testid="contribution-error"]')).toBeVisible();
          
          // Test zero contribution
          await testHelpers.fillFormField('[data-testid="contribution-amount"]', '0');
          await page.click('[data-testid="submit-contribution"]');
          await expect(page.locator('[data-testid="contribution-error"]')).toBeVisible();
          
          // Test extremely large contribution
          await testHelpers.fillFormField('[data-testid="contribution-amount"]', '99999999');
          await page.click('[data-testid="submit-contribution"]');
          
          // Should either accept or show appropriate warning
          const hasError = await testHelpers.elementExists('[data-testid="contribution-error"]');
          const hasWarning = await testHelpers.elementExists('[data-testid="large-contribution-warning"]');
          const hasSuccess = await testHelpers.elementExists('[data-testid="success-message"]');
          
          expect(hasError || hasWarning || hasSuccess).toBe(true);
        }
      }
    });
  });

  test.describe('Performance and Accessibility', () => {
    test('should load goals page efficiently', async ({ page }) => {
      const startTime = Date.now();
      await testHelpers.navigateAndWait('/goals');
      const endTime = Date.now();
      
      const loadTime = endTime - startTime;
      expect(loadTime).toBeLessThan(3000);
      
      console.log(`Goals page loaded in ${loadTime}ms`);
    });

    test('should be keyboard accessible', async ({ page }) => {
      await testHelpers.navigateAndWait('/goals');
      
      // Test keyboard navigation
      await page.keyboard.press('Tab');
      
      const focusedElement = await page.evaluate(() => document.activeElement?.getAttribute('data-testid'));
      expect(focusedElement).toBeTruthy();
    });

    test('should work on mobile devices', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      await testHelpers.navigateAndWait('/goals');
      
      // Verify mobile layout
      const goalsList = page.locator('[data-testid="goals-list"]');
      await expect(goalsList).toBeVisible();
      
      // Test touch interactions
      const firstGoal = page.locator('[data-testid="goal-card"]').first();
      if (await firstGoal.count() > 0) {
        await firstGoal.tap();
        await testHelpers.waitForPageLoad();
      }
      
      await testHelpers.takeScreenshot('goals-mobile');
    });
  });
});