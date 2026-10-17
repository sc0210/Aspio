/**
 * End-to-End Workflow Test Suite
 * Testing complete user journeys and complex multi-step operations
 */

import { test, expect } from '@playwright/test';
import { TestHelpers, DatabaseTestHelpers } from '../utils/test-helpers';
import { DatabaseSetup } from '../utils/database-setup';
import { mockData } from '../utils/mock-data';

test.describe('End-to-End User Workflows', () => {
  let testHelpers: TestHelpers;
  let dbHelpers: DatabaseTestHelpers;
  let dbSetup: DatabaseSetup;

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

  test.describe('New User Onboarding Journey', () => {
    test('should complete full onboarding flow from signup to first goal', async ({ page }) => {
      // Simulate new user registration (if available)
      const newUserData = mockData.generateUser({
        name: 'New User Journey Test',
        email: 'newuser@aspiro.test'
      });

      // Skip actual signup in test environment, assume authenticated
      await testHelpers.navigateAndWait('/');

      // Complete profile setup
      const profileSetupModal = page.locator('[data-testid="profile-setup-modal"]');
      if (await profileSetupModal.count() > 0) {
        await expect(profileSetupModal).toBeVisible();
        
        // Fill basic profile information
        await testHelpers.fillFormField('[data-testid="setup-name"]', newUserData.name);
        await testHelpers.fillFormField('[data-testid="setup-occupation"]', 'Software Engineer');
        await page.selectOption('[data-testid="setup-currency"]', 'SGD');
        await page.selectOption('[data-testid="setup-timezone"]', 'Asia/Singapore');
        
        await page.click('[data-testid="continue-profile"]');
      }

      // Set financial preferences
      const financialSetupModal = page.locator('[data-testid="financial-setup-modal"]');
      if (await financialSetupModal.count() > 0) {
        await testHelpers.fillFormField('[data-testid="monthly-income"]', '6000');
        await page.selectOption('[data-testid="risk-tolerance"]', 'moderate');
        
        // Select financial goals
        await page.check('[data-testid="goal-emergency-fund"]');
        await page.check('[data-testid="goal-retirement"]');
        
        await page.click('[data-testid="continue-financial"]');
      }

      // Complete onboarding
      const onboardingComplete = page.locator('[data-testid="onboarding-complete"]');
      if (await onboardingComplete.count() > 0) {
        await expect(onboardingComplete).toBeVisible();
        await page.click('[data-testid="start-using-aspiro"]');
      }

      // Verify landing on dashboard
      await expect(page).toHaveURL('/');
      await testHelpers.waitForElement('[data-testid="dashboard-layout"]');

      // Create first financial goal
      await testHelpers.navigateAndWait('/goals/create');
      
      const goalData = {
        title: 'Emergency Fund - First Goal',
        description: 'My first emergency fund goal',
        targetAmount: 10000,
        category: 'emergency_fund'
      };
      
      await testHelpers.fillFormField('[data-testid="goal-title"]', goalData.title);
      await testHelpers.fillFormField('[data-testid="goal-description"]', goalData.description);
      await page.selectOption('[data-testid="goal-category"]', goalData.category);
      await testHelpers.fillFormField('[data-testid="goal-target-amount"]', goalData.targetAmount.toString());
      
      // Set target date to 1 year from now
      const targetDate = new Date();
      targetDate.setFullYear(targetDate.getFullYear() + 1);
      await testHelpers.fillFormField('[data-testid="goal-target-date"]', targetDate.toISOString().split('T')[0]);
      
      await testHelpers.submitFormAndWait();
      await testHelpers.verifySuccessMessage('Goal created successfully');

      // Verify goal appears on dashboard
      await testHelpers.navigateAndWait('/');
      await expect(page.locator(`text=${goalData.title}`)).toBeVisible();
      
      // Add first transaction
      await testHelpers.navigateAndWait('/transactions/add');
      
      const transactionData = {
        amount: 500,
        description: 'First Emergency Fund Contribution',
        type: 'expense',
        category: 'Savings'
      };
      
      await testHelpers.fillFormField('[data-testid="transaction-amount"]', transactionData.amount.toString());
      await testHelpers.fillFormField('[data-testid="transaction-description"]', transactionData.description);
      await page.selectOption('[data-testid="transaction-type"]', transactionData.type);
      await page.selectOption('[data-testid="transaction-category"]', transactionData.category);
      
      await testHelpers.submitFormAndWait();
      await testHelpers.verifySuccessMessage('Transaction created successfully');

      // Verify onboarding completion
      await testHelpers.navigateAndWait('/');
      await expect(page.locator('[data-testid="dashboard-layout"]')).toBeVisible();
      await expect(page.locator(`text=${goalData.title}`)).toBeVisible();
      await expect(page.locator(`text=${transactionData.description}`)).toBeVisible();

      await testHelpers.takeScreenshot('onboarding-journey-complete');
    });
  });

  test.describe('Monthly Financial Planning Workflow', () => {
    test('should complete full monthly financial planning cycle', async ({ page }) => {
      await dbSetup.setupBasicTestData();

      // Step 1: Review previous month's performance
      await testHelpers.navigateAndWait('/dashboard');
      
      // Check financial overview
      await expect(page.locator('[data-testid="monthly-overview"]')).toBeVisible();
      
      // Review spending by category
      const spendingChart = page.locator('[data-testid="spending-chart"]');
      if (await spendingChart.count() > 0) {
        await expect(spendingChart).toBeVisible();
        
        // Analyze spending patterns
        const categoryBreakdown = page.locator('[data-testid="category-breakdown"]');
        if (await categoryBreakdown.count() > 0) {
          await expect(categoryBreakdown).toBeVisible();
        }
      }

      // Step 2: Create new monthly budget
      await testHelpers.navigateAndWait('/budgets/create');
      
      const currentDate = new Date();
      const budgetName = `Budget - ${currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`;
      
      await testHelpers.fillFormField('[data-testid="budget-name"]', budgetName);
      await page.selectOption('[data-testid="budget-period"]', 'monthly');
      await page.selectOption('[data-testid="budget-currency"]', 'SGD');
      
      // Set budget start to first of current month
      const startDate = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
      await testHelpers.fillFormField('[data-testid="budget-start-date"]', startDate.toISOString().split('T')[0]);
      
      // Add comprehensive budget categories for Singapore context
      const budgetCategories = [
        { name: 'Food & Dining', amount: 600 },
        { name: 'Transportation (MRT/Grab)', amount: 200 },
        { name: 'HDB/Rent', amount: 1200 },
        { name: 'Utilities & Phone', amount: 180 },
        { name: 'Shopping & Personal', amount: 300 },
        { name: 'Healthcare & Insurance', amount: 150 },
        { name: 'Entertainment', amount: 200 },
        { name: 'Emergency Fund Savings', amount: 800 }
      ];
      
      for (let i = 0; i < budgetCategories.length; i++) {
        const category = budgetCategories[i];
        
        if (i > 0) {
          await page.click('[data-testid="add-category"]');
        }
        
        await testHelpers.fillFormField(`[data-testid="category-name-${i}"]`, category.name);
        await testHelpers.fillFormField(`[data-testid="category-amount-${i}"]`, category.amount.toString());
      }
      
      await testHelpers.submitFormAndWait();
      await testHelpers.verifySuccessMessage('Budget created successfully');

      // Step 3: Set up automatic savings goals
      await testHelpers.navigateAndWait('/goals');
      
      // Check if automatic savings goal exists, if not create one
      const autoSavingsButton = page.locator('[data-testid="setup-auto-savings"]');
      if (await autoSavingsButton.count() > 0) {
        await autoSavingsButton.click();
        
        await testHelpers.fillFormField('[data-testid="auto-savings-amount"]', '800');
        await page.selectOption('[data-testid="auto-savings-frequency"]', 'monthly');
        await page.selectOption('[data-testid="auto-savings-goal"]', 'emergency_fund');
        
        await page.click('[data-testid="setup-auto-savings-confirm"]');
        await testHelpers.verifySuccessMessage('Automatic savings set up successfully');
      }

      // Step 4: Add sample transactions for the month
      const monthlyTransactions = [
        { amount: 45.50, description: 'Hawker Center Lunch', category: 'Food & Dining', type: 'expense' },
        { amount: 2.50, description: 'MRT to City', category: 'Transportation (MRT/Grab)', type: 'expense' },
        { amount: 85.20, description: 'NTUC Grocery Shopping', category: 'Food & Dining', type: 'expense' },
        { amount: 25.00, description: 'Grab to Meeting', category: 'Transportation (MRT/Grab)', type: 'expense' },
        { amount: 5000.00, description: 'Monthly Salary', category: 'Salary', type: 'income' }
      ];
      
      for (const transaction of monthlyTransactions) {
        await testHelpers.navigateAndWait('/transactions/add');
        
        await testHelpers.fillFormField('[data-testid="transaction-amount"]', transaction.amount.toString());
        await testHelpers.fillFormField('[data-testid="transaction-description"]', transaction.description);
        await page.selectOption('[data-testid="transaction-type"]', transaction.type);
        await page.selectOption('[data-testid="transaction-category"]', transaction.category);
        
        // Set transaction date to current month
        const transactionDate = new Date();
        transactionDate.setDate(Math.floor(Math.random() * 28) + 1);
        await testHelpers.fillFormField('[data-testid="transaction-date"]', transactionDate.toISOString().split('T')[0]);
        
        await testHelpers.submitFormAndWait();
        await testHelpers.verifySuccessMessage('Transaction created successfully');
      }

      // Step 5: Review budget performance
      await testHelpers.navigateAndWait('/budgets');
      
      // Click on the created budget to view details
      await page.click(`text=${budgetName}`);
      
      // Verify budget tracking is working
      await expect(page.locator('[data-testid="budget-overview"]')).toBeVisible();
      await expect(page.locator('[data-testid="category-spending"]')).toBeVisible();
      
      // Check for spending alerts if any categories are overspent
      const spendingAlerts = page.locator('[data-testid="spending-alert"]');
      if (await spendingAlerts.count() > 0) {
        for (let i = 0; i < await spendingAlerts.count(); i++) {
          await expect(spendingAlerts.nth(i)).toBeVisible();
        }
      }

      // Step 6: Review and adjust goals
      await testHelpers.navigateAndWait('/goals');
      
      // Check goal progress
      const goalProgressElements = page.locator('[data-testid="goal-progress"]');
      if (await goalProgressElements.count() > 0) {
        for (let i = 0; i < await goalProgressElements.count(); i++) {
          await expect(goalProgressElements.nth(i)).toBeVisible();
        }
      }
      
      // Add contribution to a goal
      const goalCards = page.locator('[data-testid="goal-card"]');
      if (await goalCards.count() > 0) {
        await goalCards.first().click();
        
        const addContributionButton = page.locator('[data-testid="add-contribution"]');
        if (await addContributionButton.count() > 0) {
          await addContributionButton.click();
          
          await testHelpers.fillFormField('[data-testid="contribution-amount"]', '500');
          await testHelpers.fillFormField('[data-testid="contribution-note"]', 'Monthly emergency fund contribution');
          
          await page.click('[data-testid="submit-contribution"]');
          await testHelpers.verifySuccessMessage('Contribution added successfully');
        }
      }

      await testHelpers.takeScreenshot('monthly-planning-workflow-complete');
    });
  });

  test.describe('Investment Portfolio Management Workflow', () => {
    test('should complete comprehensive portfolio management cycle', async ({ page }) => {
      await dbSetup.setupComplexScenario();

      // Step 1: Review current portfolio performance
      await testHelpers.navigateAndWait('/portfolio');
      
      await expect(page.locator('[data-testid="portfolio-overview"]')).toBeVisible();
      
      // Check portfolio metrics
      const totalValue = page.locator('[data-testid="total-portfolio-value"]');
      const gainLoss = page.locator('[data-testid="total-gain-loss"]');
      const gainLossPercentage = page.locator('[data-testid="gain-loss-percentage"]');
      
      await expect(totalValue).toBeVisible();
      await expect(gainLoss).toBeVisible();
      await expect(gainLossPercentage).toBeVisible();

      // Step 2: Add new Asian stock holdings
      await testHelpers.navigateAndWait('/portfolio/add');
      
      const asianStocks = [
        { symbol: 'DBS.SI', name: 'DBS Group Holdings', quantity: 50, cost: 32.50, exchange: 'SGX' },
        { symbol: 'GRAB', name: 'Grab Holdings Limited', quantity: 100, cost: 3.25, exchange: 'NASDAQ' },
        { symbol: 'SE', name: 'Sea Limited', quantity: 25, cost: 85.50, exchange: 'NYSE' }
      ];
      
      for (const stock of asianStocks) {
        await testHelpers.fillFormField('[data-testid="asset-search"]', stock.symbol);
        
        // Wait for search results or fill manually
        const searchResult = page.locator(`[data-testid="search-result-${stock.symbol}"]`);
        if (await searchResult.count() > 0) {
          await searchResult.click();
        } else {
          await testHelpers.fillFormField('[data-testid="holding-symbol"]', stock.symbol);
          await testHelpers.fillFormField('[data-testid="holding-name"]', stock.name);
          await page.selectOption('[data-testid="holding-type"]', 'stock');
          await testHelpers.fillFormField('[data-testid="holding-exchange"]', stock.exchange);
        }
        
        await testHelpers.fillFormField('[data-testid="holding-quantity"]', stock.quantity.toString());
        await testHelpers.fillFormField('[data-testid="holding-cost"]', stock.cost.toString());
        
        await testHelpers.submitFormAndWait();
        await testHelpers.verifySuccessMessage('Holding added to portfolio');
        
        // Navigate back to add next holding
        if (asianStocks.indexOf(stock) < asianStocks.length - 1) {
          await testHelpers.navigateAndWait('/portfolio/add');
        }
      }

      // Step 3: Set up dividend reinvestment
      await testHelpers.navigateAndWait('/portfolio');
      
      const dividendSettings = page.locator('[data-testid="dividend-settings"]');
      if (await dividendSettings.count() > 0) {
        await dividendSettings.click();
        
        // Enable automatic reinvestment
        await page.check('[data-testid="auto-reinvest-dividends"]');
        
        // Set reinvestment threshold
        await testHelpers.fillFormField('[data-testid="reinvestment-threshold"]', '100');
        
        await page.click('[data-testid="save-dividend-settings"]');
        await testHelpers.verifySuccessMessage('Dividend settings updated');
      }

      // Step 4: Rebalance portfolio
      const rebalanceButton = page.locator('[data-testid="rebalance-portfolio"]');
      if (await rebalanceButton.count() > 0) {
        await rebalanceButton.click();
        
        // Review rebalancing suggestions
        const rebalanceSuggestions = page.locator('[data-testid="rebalance-suggestions"]');
        await expect(rebalanceSuggestions).toBeVisible();
        
        // Accept suggested rebalancing
        const acceptRebalanceButton = page.locator('[data-testid="accept-rebalance"]');
        if (await acceptRebalanceButton.count() > 0) {
          await acceptRebalanceButton.click();
          
          // Confirm rebalancing actions
          const confirmRebalance = page.locator('[data-testid="confirm-rebalance"]');
          await expect(confirmRebalance).toBeVisible();
          await page.click('[data-testid="execute-rebalance"]');
          
          await testHelpers.verifySuccessMessage('Portfolio rebalanced successfully');
        }
      }

      // Step 5: Set up price alerts
      const holdingRows = page.locator('[data-testid="holding-row"]');
      const holdingCount = await holdingRows.count();
      
      if (holdingCount > 0) {
        // Set alert for first holding
        const firstHolding = holdingRows.first();
        const alertButton = firstHolding.locator('[data-testid="set-price-alert"]');
        
        if (await alertButton.count() > 0) {
          await alertButton.click();
          
          const alertModal = page.locator('[data-testid="price-alert-modal"]');
          await expect(alertModal).toBeVisible();
          
          // Set price alerts
          await testHelpers.fillFormField('[data-testid="alert-price-high"]', '40.00');
          await testHelpers.fillFormField('[data-testid="alert-price-low"]', '28.00');
          
          await page.check('[data-testid="enable-email-alerts"]');
          await page.check('[data-testid="enable-push-alerts"]');
          
          await page.click('[data-testid="save-price-alerts"]');
          await testHelpers.verifySuccessMessage('Price alerts set successfully');
        }
      }

      // Step 6: Analyze portfolio performance
      await testHelpers.navigateAndWait('/portfolio/analytics');
      
      // Check analytics dashboard
      await expect(page.locator('[data-testid="portfolio-analytics"]')).toBeVisible();
      
      // Review asset allocation
      await expect(page.locator('[data-testid="asset-allocation-chart"]')).toBeVisible();
      
      // Check sector diversification
      const sectorAllocation = page.locator('[data-testid="sector-allocation"]');
      if (await sectorAllocation.count() > 0) {
        await expect(sectorAllocation).toBeVisible();
      }
      
      // Review geographic allocation
      const geoAllocation = page.locator('[data-testid="geographic-allocation"]');
      if (await geoAllocation.count() > 0) {
        await expect(geoAllocation).toBeVisible();
      }
      
      // Check risk metrics
      const riskMetrics = page.locator('[data-testid="risk-metrics"]');
      if (await riskMetrics.count() > 0) {
        await expect(riskMetrics).toBeVisible();
        
        // Verify key metrics are displayed
        await expect(page.locator('[data-testid="sharpe-ratio"]')).toBeVisible();
        await expect(page.locator('[data-testid="max-drawdown"]')).toBeVisible();
        await expect(page.locator('[data-testid="volatility"]')).toBeVisible();
      }

      await testHelpers.takeScreenshot('portfolio-management-workflow-complete');
    });
  });

  test.describe('Goal Achievement Workflow', () => {
    test('should complete goal from creation to achievement celebration', async ({ page }) => {
      await dbSetup.setupBasicTestData();

      // Step 1: Create a short-term achievable goal
      await testHelpers.navigateAndWait('/goals/create');
      
      const goalData = {
        title: 'Weekend Getaway Fund',
        description: 'Save for a weekend trip to Bali',
        targetAmount: 1500,
        currentAmount: 0,
        category: 'vacation',
        priority: 'high'
      };
      
      await testHelpers.fillFormField('[data-testid="goal-title"]', goalData.title);
      await testHelpers.fillFormField('[data-testid="goal-description"]', goalData.description);
      await page.selectOption('[data-testid="goal-category"]', goalData.category);
      await testHelpers.fillFormField('[data-testid="goal-target-amount"]', goalData.targetAmount.toString());
      await testHelpers.fillFormField('[data-testid="goal-current-amount"]', goalData.currentAmount.toString());
      await page.selectOption('[data-testid="goal-priority"]', goalData.priority);
      
      // Set target date to 3 months from now
      const targetDate = new Date();
      targetDate.setMonth(targetDate.getMonth() + 3);
      await testHelpers.fillFormField('[data-testid="goal-target-date"]', targetDate.toISOString().split('T')[0]);
      
      // Add milestones
      const milestones = [
        { title: '25% - Initial Savings', amount: 375 },
        { title: '50% - Halfway There', amount: 750 },
        { title: '75% - Almost Ready', amount: 1125 },
        { title: '100% - Trip Booked!', amount: 1500 }
      ];
      
      for (let i = 0; i < milestones.length; i++) {
        if (i > 0) {
          await page.click('[data-testid="add-milestone"]');
        }
        
        const milestone = milestones[i];
        await testHelpers.fillFormField(`[data-testid="milestone-title-${i}"]`, milestone.title);
        await testHelpers.fillFormField(`[data-testid="milestone-amount-${i}"]`, milestone.amount.toString());
        
        const milestoneDate = new Date(targetDate);
        milestoneDate.setMonth(milestoneDate.getMonth() - (milestones.length - i - 1));
        await testHelpers.fillFormField(`[data-testid="milestone-date-${i}"]`, milestoneDate.toISOString().split('T')[0]);
      }
      
      await testHelpers.submitFormAndWait();
      await testHelpers.verifySuccessMessage('Goal created successfully');

      // Step 2: Make regular contributions to achieve milestones
      await testHelpers.navigateAndWait('/goals');
      
      // Click on the created goal
      await page.click(`text=${goalData.title}`);
      
      // Achieve milestones progressively
      const contributionAmounts = [300, 200, 250, 375, 375]; // Total = 1500
      const contributionNotes = [
        'Initial contribution from bonus',
        'Weekly savings contribution',
        'Side project earnings',
        'Monthly savings contribution',
        'Final push to reach goal!'
      ];
      
      let currentTotal = 0;
      
      for (let i = 0; i < contributionAmounts.length; i++) {
        const amount = contributionAmounts[i];
        const note = contributionNotes[i];
        currentTotal += amount;
        
        // Add contribution
        const addContributionButton = page.locator('[data-testid="add-contribution"]');
        await addContributionButton.click();
        
        await testHelpers.fillFormField('[data-testid="contribution-amount"]', amount.toString());
        await testHelpers.fillFormField('[data-testid="contribution-note"]', note);
        
        await page.click('[data-testid="submit-contribution"]');
        await testHelpers.verifySuccessMessage('Contribution added successfully');
        
        // Check if milestone is achieved
        const currentProgress = (currentTotal / goalData.targetAmount) * 100;
        
        // Look for milestone celebration if applicable
        const milestoneModal = page.locator('[data-testid="milestone-achieved-modal"]');
        if (await milestoneModal.count() > 0) {
          await expect(milestoneModal).toBeVisible();
          await page.click('[data-testid="close-milestone-celebration"]');
        }
        
        // Verify progress is updated
        const progressElement = page.locator('[data-testid="goal-progress-percentage"]');
        if (await progressElement.count() > 0) {
          const progressText = await progressElement.textContent();
          expect(progressText).toContain(currentProgress.toFixed(1));
        }
        
        // Wait a moment between contributions
        await testHelpers.waitForPageLoad();
      }

      // Step 3: Goal completion celebration
      // At this point, the goal should be 100% complete
      const goalCompleteModal = page.locator('[data-testid="goal-complete-modal"]');
      if (await goalCompleteModal.count() > 0) {
        await expect(goalCompleteModal).toBeVisible();
        await expect(goalCompleteModal).toContainText('Congratulations!');
        await expect(goalCompleteModal).toContainText(goalData.title);
        
        // Check for achievement unlock
        const achievementUnlock = page.locator('[data-testid="achievement-unlocked"]');
        if (await achievementUnlock.count() > 0) {
          await expect(achievementUnlock).toBeVisible();
        }
        
        // Share achievement option
        const shareButton = page.locator('[data-testid="share-achievement"]');
        if (await shareButton.count() > 0) {
          await shareButton.click();
          
          const shareModal = page.locator('[data-testid="share-modal"]');
          await expect(shareModal).toBeVisible();
          
          await page.click('[data-testid="close-share-modal"]');
        }
        
        await page.click('[data-testid="close-goal-complete"]');
      }

      // Step 4: Verify goal status and start planning next goal
      await testHelpers.navigateAndWait('/goals');
      
      // Verify goal shows as completed
      const completedGoal = page.locator(`[data-testid="goal-card"]:has-text("${goalData.title}")`);
      await expect(completedGoal).toBeVisible();
      
      const completedBadge = completedGoal.locator('[data-testid="status-completed"]');
      if (await completedBadge.count() > 0) {
        await expect(completedBadge).toBeVisible();
      }
      
      // Check experience points gained
      const xpGained = page.locator('[data-testid="xp-gained"]');
      if (await xpGained.count() > 0) {
        await expect(xpGained).toBeVisible();
      }
      
      // Suggest next goal
      const nextGoalSuggestion = page.locator('[data-testid="next-goal-suggestion"]');
      if (await nextGoalSuggestion.count() > 0) {
        await expect(nextGoalSuggestion).toBeVisible();
        
        const createNextGoalButton = page.locator('[data-testid="create-suggested-goal"]');
        if (await createNextGoalButton.count() > 0) {
          await createNextGoalButton.click();
          
          // Should navigate to goal creation with suggested parameters
          await expect(page).toHaveURL('/goals/create');
        }
      }

      await testHelpers.takeScreenshot('goal-achievement-workflow-complete');
    });
  });

  test.describe('Financial Crisis Management Workflow', () => {
    test('should handle emergency financial situation and recovery', async ({ page }) => {
      await dbSetup.setupComplexScenario();

      // Simulate emergency situation - large unexpected expense
      await testHelpers.navigateAndWait('/transactions/add');
      
      const emergencyExpense = {
        amount: 3500,
        description: 'Emergency Medical Bill',
        type: 'expense',
        category: 'Healthcare'
      };
      
      await testHelpers.fillFormField('[data-testid="transaction-amount"]', emergencyExpense.amount.toString());
      await testHelpers.fillFormField('[data-testid="transaction-description"]', emergencyExpense.description);
      await page.selectOption('[data-testid="transaction-type"]', emergencyExpense.type);
      await page.selectOption('[data-testid="transaction-category"]', emergencyExpense.category);
      
      // Mark as emergency expense
      const emergencyCheckbox = page.locator('[data-testid="mark-as-emergency"]');
      if (await emergencyCheckbox.count() > 0) {
        await emergencyCheckbox.check();
      }
      
      await testHelpers.submitFormAndWait();
      await testHelpers.verifySuccessMessage('Transaction created successfully');

      // Check for budget alerts triggered by large expense
      await testHelpers.navigateAndWait('/budgets');
      
      const budgetAlert = page.locator('[data-testid="budget-exceeded-alert"]');
      if (await budgetAlert.count() > 0) {
        await expect(budgetAlert).toBeVisible();
        await expect(budgetAlert).toContainText('exceeded');
      }

      // Activate emergency fund
      await testHelpers.navigateAndWait('/goals');
      
      // Find emergency fund goal
      const emergencyFundGoal = page.locator('[data-testid="goal-card"]:has-text("Emergency")');
      if (await emergencyFundGoal.count() > 0) {
        await emergencyFundGoal.click();
        
        // Use emergency fund
        const useEmergencyFundButton = page.locator('[data-testid="use-emergency-fund"]');
        if (await useEmergencyFundButton.count() > 0) {
          await useEmergencyFundButton.click();
          
          const useEmergencyModal = page.locator('[data-testid="use-emergency-fund-modal"]');
          await expect(useEmergencyModal).toBeVisible();
          
          await testHelpers.fillFormField('[data-testid="emergency-withdrawal-amount"]', '3500');
          await testHelpers.fillFormField('[data-testid="emergency-reason"]', 'Medical emergency expense');
          
          await page.click('[data-testid="confirm-emergency-withdrawal"]');
          await testHelpers.verifySuccessMessage('Emergency fund withdrawal processed');
        }
      }

      // Create recovery plan
      const recoveryPlanButton = page.locator('[data-testid="create-recovery-plan"]');
      if (await recoveryPlanButton.count() > 0) {
        await recoveryPlanButton.click();
        
        const recoveryModal = page.locator('[data-testid="recovery-plan-modal"]');
        await expect(recoveryModal).toBeVisible();
        
        // Set recovery timeline
        await page.selectOption('[data-testid="recovery-timeline"]', '6-months');
        
        // Adjust budget categories for recovery
        await testHelpers.fillFormField('[data-testid="reduce-entertainment"]', '50');
        await testHelpers.fillFormField('[data-testid="reduce-dining"]', '30');
        await testHelpers.fillFormField('[data-testid="increase-emergency-savings"]', '200');
        
        await page.click('[data-testid="create-recovery-plan"]');
        await testHelpers.verifySuccessMessage('Recovery plan created successfully');
      }

      // Adjust monthly budget to accommodate recovery
      await testHelpers.navigateAndWait('/budgets');
      
      const currentBudget = page.locator('[data-testid="budget-card"]').first();
      if (await currentBudget.count() > 0) {
        const editBudgetButton = currentBudget.locator('[data-testid="edit-budget"]');
        if (await editBudgetButton.count() > 0) {
          await editBudgetButton.click();
          
          // Reduce discretionary spending categories
          const entertainmentField = page.locator('[data-testid="category-amount-entertainment"]');
          if (await entertainmentField.count() > 0) {
            const currentValue = await entertainmentField.inputValue();
            const newValue = Math.floor(parseFloat(currentValue) * 0.5);
            await testHelpers.fillFormField('[data-testid="category-amount-entertainment"]', newValue.toString());
          }
          
          const diningField = page.locator('[data-testid="category-amount-dining"]');
          if (await diningField.count() > 0) {
            const currentValue = await diningField.inputValue();
            const newValue = Math.floor(parseFloat(currentValue) * 0.7);
            await testHelpers.fillFormField('[data-testid="category-amount-dining"]', newValue.toString());
          }
          
          // Increase emergency savings
          const savingsField = page.locator('[data-testid="category-amount-savings"]');
          if (await savingsField.count() > 0) {
            const currentValue = await savingsField.inputValue();
            const newValue = parseFloat(currentValue) + 200;
            await testHelpers.fillFormField('[data-testid="category-amount-savings"]', newValue.toString());
          }
          
          await testHelpers.submitFormAndWait();
          await testHelpers.verifySuccessMessage('Budget updated for recovery plan');
        }
      }

      // Set up recovery tracking
      await testHelpers.navigateAndWait('/goals');
      
      // Create new emergency fund replenishment goal
      await testHelpers.navigateAndWait('/goals/create');
      
      const replenishmentGoal = {
        title: 'Emergency Fund Recovery',
        description: 'Replenish emergency fund after medical expense',
        targetAmount: 3500,
        currentAmount: 0,
        category: 'emergency_fund',
        priority: 'high'
      };
      
      await testHelpers.fillFormField('[data-testid="goal-title"]', replenishmentGoal.title);
      await testHelpers.fillFormField('[data-testid="goal-description"]', replenishmentGoal.description);
      await page.selectOption('[data-testid="goal-category"]', replenishmentGoal.category);
      await testHelpers.fillFormField('[data-testid="goal-target-amount"]', replenishmentGoal.targetAmount.toString());
      await testHelpers.fillFormField('[data-testid="goal-current-amount"]', replenishmentGoal.currentAmount.toString());
      await page.selectOption('[data-testid="goal-priority"]', replenishmentGoal.priority);
      
      // Set target date to 6 months from now
      const recoveryTargetDate = new Date();
      recoveryTargetDate.setMonth(recoveryTargetDate.getMonth() + 6);
      await testHelpers.fillFormField('[data-testid="goal-target-date"]', recoveryTargetDate.toISOString().split('T')[0]);
      
      await testHelpers.submitFormAndWait();
      await testHelpers.verifySuccessMessage('Recovery goal created successfully');

      // Verify recovery plan is active
      await testHelpers.navigateAndWait('/dashboard');
      
      const recoveryPlanStatus = page.locator('[data-testid="recovery-plan-status"]');
      if (await recoveryPlanStatus.count() > 0) {
        await expect(recoveryPlanStatus).toBeVisible();
        await expect(recoveryPlanStatus).toContainText('Recovery Plan Active');
      }

      await testHelpers.takeScreenshot('emergency-management-workflow-complete');
    });
  });
});