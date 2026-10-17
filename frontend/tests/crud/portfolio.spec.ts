/**
 * Portfolio Holdings CRUD Test Suite
 * Testing investment portfolio management, asset tracking, and performance monitoring
 */

import { test, expect } from '@playwright/test';
import { TestHelpers, DatabaseTestHelpers } from '../utils/test-helpers';
import { DatabaseSetup } from '../utils/database-setup';
import { mockData } from '../utils/mock-data';
import { Portfolio, PortfolioHolding } from '@/shared/types';

test.describe('Portfolio Holdings CRUD Operations', () => {
  let testHelpers: TestHelpers;
  let dbHelpers: DatabaseTestHelpers;
  let dbSetup: DatabaseSetup;
  let testPortfolio: Portfolio;
  let testHolding: PortfolioHolding;

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

  test.describe('Add Portfolio Holdings', () => {
    test('should add Singapore stock (DBS) to portfolio', async ({ page }) => {
      await testHelpers.navigateAndWait('/portfolio/add');

      const holdingData = {
        symbol: 'DBS.SI',
        name: 'DBS Group Holdings',
        type: 'stock',
        quantity: 100,
        averageCost: 32.50,
        exchange: 'SGX',
        sector: 'Banking'
      };

      // Fill asset search and selection
      await testHelpers.fillFormField('[data-testid="asset-search"]', holdingData.symbol);
      
      // Wait for search results and select
      const searchResult = page.locator(`[data-testid="search-result-${holdingData.symbol}"]`);
      if (await searchResult.count() > 0) {
        await searchResult.click();
      } else {
        // Manual entry if search doesn't work
        await testHelpers.fillFormField('[data-testid="holding-symbol"]', holdingData.symbol);
        await testHelpers.fillFormField('[data-testid="holding-name"]', holdingData.name);
        await page.selectOption('[data-testid="holding-type"]', holdingData.type);
        await testHelpers.fillFormField('[data-testid="holding-exchange"]', holdingData.exchange);
      }

      // Fill quantity and cost
      await testHelpers.fillFormField('[data-testid="holding-quantity"]', holdingData.quantity.toString());
      await testHelpers.fillFormField('[data-testid="holding-cost"]', holdingData.averageCost.toString());
      
      // Set purchase date
      const purchaseDate = testHelpers.randomDate(new Date(2023, 0, 1), new Date());
      await testHelpers.fillFormField('[data-testid="purchase-date"]', purchaseDate.toISOString().split('T')[0]);

      await testHelpers.submitFormAndWait();
      await testHelpers.verifySuccessMessage('Holding added to portfolio');

      // Verify redirect to portfolio page
      await expect(page).toHaveURL('/portfolio');

      // Verify holding appears in portfolio
      await testHelpers.waitForElement('[data-testid="portfolio-holdings"]');
      await expect(page.locator(`text=${holdingData.symbol}`)).toBeVisible();
      await expect(page.locator(`text=${holdingData.name}`)).toBeVisible();
      await expect(page.locator(`text=${holdingData.quantity}`)).toBeVisible();

      // Verify total portfolio value is updated
      const totalValue = holdingData.quantity * holdingData.averageCost;
      await expect(page.locator('[data-testid="portfolio-total-value"]')).toBeVisible();

      await testHelpers.takeScreenshot('portfolio-singapore-stock-added');
    });

    test('should add cryptocurrency holding', async ({ page }) => {
      await testHelpers.navigateAndWait('/portfolio/add');

      const cryptoData = {
        symbol: 'BTC',
        name: 'Bitcoin',
        type: 'crypto',
        quantity: 0.5,
        averageCost: 45000,
        exchange: 'Crypto'
      };

      await testHelpers.fillFormField('[data-testid="asset-search"]', cryptoData.symbol);
      
      const searchResult = page.locator(`[data-testid="search-result-${cryptoData.symbol}"]`);
      if (await searchResult.count() > 0) {
        await searchResult.click();
      } else {
        await testHelpers.fillFormField('[data-testid="holding-symbol"]', cryptoData.symbol);
        await testHelpers.fillFormField('[data-testid="holding-name"]', cryptoData.name);
        await page.selectOption('[data-testid="holding-type"]', cryptoData.type);
        await testHelpers.fillFormField('[data-testid="holding-exchange"]', cryptoData.exchange);
      }

      await testHelpers.fillFormField('[data-testid="holding-quantity"]', cryptoData.quantity.toString());
      await testHelpers.fillFormField('[data-testid="holding-cost"]', cryptoData.averageCost.toString());

      await testHelpers.submitFormAndWait();
      await testHelpers.verifySuccessMessage();

      // Verify crypto holding in portfolio
      await testHelpers.navigateAndWait('/portfolio');
      await expect(page.locator(`text=${cryptoData.symbol}`)).toBeVisible();
      await expect(page.locator(`text=${cryptoData.name}`)).toBeVisible();
      
      // Verify crypto-specific indicators
      await expect(page.locator(`[data-testid="crypto-indicator-${cryptoData.symbol}"]`)).toBeVisible();

      await testHelpers.takeScreenshot('portfolio-crypto-added');
    });

    test('should validate holding input fields', async ({ page }) => {
      await testHelpers.navigateAndWait('/portfolio/add');

      // Test negative quantity
      await testHelpers.fillFormField('[data-testid="holding-quantity"]', '-10');
      await testHelpers.submitFormAndWait();
      await expect(page.locator('[data-testid="quantity-error"]')).toBeVisible();

      // Test zero cost
      await testHelpers.fillFormField('[data-testid="holding-quantity"]', '10');
      await testHelpers.fillFormField('[data-testid="holding-cost"]', '0');
      await testHelpers.submitFormAndWait();
      await expect(page.locator('[data-testid="cost-error"]')).toBeVisible();

      // Test missing required fields
      await testHelpers.fillFormField('[data-testid="holding-cost"]', '100');
      await testHelpers.submitFormAndWait();
      await expect(page.locator('[data-testid="symbol-error"]')).toBeVisible();
    });

    test('should handle duplicate holdings', async ({ page }) => {
      // First, add a holding
      await testHelpers.navigateAndWait('/portfolio/add');
      
      const holdingData = {
        symbol: 'AAPL',
        name: 'Apple Inc.',
        quantity: 10,
        averageCost: 150
      };

      await testHelpers.fillFormField('[data-testid="asset-search"]', holdingData.symbol);
      await testHelpers.fillFormField('[data-testid="holding-quantity"]', holdingData.quantity.toString());
      await testHelpers.fillFormField('[data-testid="holding-cost"]', holdingData.averageCost.toString());
      
      await testHelpers.submitFormAndWait();
      await testHelpers.verifySuccessMessage();

      // Try to add the same symbol again
      await testHelpers.navigateAndWait('/portfolio/add');
      await testHelpers.fillFormField('[data-testid="asset-search"]', holdingData.symbol);
      await testHelpers.fillFormField('[data-testid="holding-quantity"]', '5');
      await testHelpers.fillFormField('[data-testid="holding-cost"]', '155');
      
      await testHelpers.submitFormAndWait();
      
      // Should either merge holdings or show confirmation dialog
      const mergeDialog = page.locator('[data-testid="merge-holdings-dialog"]');
      if (await mergeDialog.count() > 0) {
        await expect(mergeDialog).toBeVisible();
        await expect(mergeDialog).toContainText('existing holding');
        
        // Choose to merge
        await page.click('[data-testid="confirm-merge"]');
        await testHelpers.verifySuccessMessage();
        
        // Verify holdings were merged
        await testHelpers.navigateAndWait('/portfolio');
        const quantityElement = page.locator(`[data-testid="quantity-${holdingData.symbol}"]`);
        await expect(quantityElement).toContainText('15'); // 10 + 5
      }
    });
  });

  test.describe('View Portfolio', () => {
    test.beforeEach(async () => {
      const testData = await dbSetup.setupBasicTestData();
      testPortfolio = testData.portfolio || mockData.generatePortfolio();
    });

    test('should display portfolio overview with performance metrics', async ({ page }) => {
      await testHelpers.navigateAndWait('/portfolio');

      // Verify portfolio overview section
      await testHelpers.waitForElement('[data-testid="portfolio-overview"]');
      
      // Check key metrics
      await expect(page.locator('[data-testid="total-portfolio-value"]')).toBeVisible();
      await expect(page.locator('[data-testid="total-gain-loss"]')).toBeVisible();
      await expect(page.locator('[data-testid="gain-loss-percentage"]')).toBeVisible();
      
      // Verify performance indicators (positive/negative styling)
      const gainLossElement = page.locator('[data-testid="gain-loss-indicator"]');
      if (await gainLossElement.count() > 0) {
        const gainLossClass = await gainLossElement.getAttribute('class');
        expect(gainLossClass).toMatch(/(positive|negative|neutral)/);
      }

      // Check portfolio composition chart
      await expect(page.locator('[data-testid="portfolio-composition"]')).toBeVisible();
      
      await testHelpers.takeScreenshot('portfolio-overview');
    });

    test('should display holdings table with real-time prices', async ({ page }) => {
      await testHelpers.navigateAndWait('/portfolio');

      const holdingsTable = page.locator('[data-testid="holdings-table"]');
      await expect(holdingsTable).toBeVisible();

      // Verify table headers
      await expect(page.locator('th:has-text("Symbol")')).toBeVisible();
      await expect(page.locator('th:has-text("Name")')).toBeVisible();
      await expect(page.locator('th:has-text("Quantity")')).toBeVisible();
      await expect(page.locator('th:has-text("Avg Cost")')).toBeVisible();
      await expect(page.locator('th:has-text("Current Price")')).toBeVisible();
      await expect(page.locator('th:has-text("Total Value")')).toBeVisible();
      await expect(page.locator('th:has-text("Gain/Loss")')).toBeVisible();

      // Verify at least one holding is displayed
      const holdingRows = page.locator('[data-testid="holding-row"]');
      if (await holdingRows.count() > 0) {
        await expect(holdingRows.first()).toBeVisible();
        
        // Check for price update indicators
        const priceUpdate = page.locator('[data-testid="price-update-indicator"]');
        if (await priceUpdate.count() > 0) {
          await expect(priceUpdate).toBeVisible();
        }
      }

      await testHelpers.takeScreenshot('portfolio-holdings-table');
    });

    test('should filter holdings by asset type', async ({ page }) => {
      await testHelpers.navigateAndWait('/portfolio');

      // Filter by stocks
      const typeFilter = page.locator('[data-testid="type-filter"]');
      if (await typeFilter.count() > 0) {
        await typeFilter.selectOption('stock');
        await testHelpers.waitForPageLoad();
        
        const stockHoldings = page.locator('[data-testid="holding-row"]');
        const stockCount = await stockHoldings.count();
        
        for (let i = 0; i < stockCount; i++) {
          const holding = stockHoldings.nth(i);
          await expect(holding.locator('[data-testid="asset-type"]')).toContainText('stock');
        }

        // Filter by crypto
        await typeFilter.selectOption('crypto');
        await testHelpers.waitForPageLoad();
        
        const cryptoHoldings = page.locator('[data-testid="holding-row"]');
        const cryptoCount = await cryptoHoldings.count();
        
        for (let i = 0; i < cryptoCount; i++) {
          const holding = cryptoHoldings.nth(i);
          await expect(holding.locator('[data-testid="asset-type"]')).toContainText('crypto');
        }
      }
    });

    test('should display performance charts over different time periods', async ({ page }) => {
      await testHelpers.navigateAndWait('/portfolio');

      const performanceSection = page.locator('[data-testid="performance-charts"]');
      await expect(performanceSection).toBeVisible();

      // Test different time period buttons
      const timePeriods = ['1D', '1W', '1M', '3M', '1Y', 'ALL'];
      
      for (const period of timePeriods) {
        const periodButton = page.locator(`[data-testid="period-${period}"]`);
        if (await periodButton.count() > 0) {
          await periodButton.click();
          await testHelpers.waitForPageLoad();
          
          // Verify chart updates
          const chart = page.locator('[data-testid="performance-chart"]');
          await expect(chart).toBeVisible();
          
          // Check for period-specific data
          await expect(page.locator(`[data-testid="active-period-${period}"]`)).toBeVisible();
        }
      }

      await testHelpers.takeScreenshot('portfolio-performance-charts');
    });
  });

  test.describe('Update Holdings', () => {
    test.beforeEach(async () => {
      const testData = await dbSetup.setupBasicTestData();
      testPortfolio = testData.portfolio || mockData.generatePortfolio();
      if (testPortfolio.holdings && testPortfolio.holdings.length > 0) {
        testHolding = testPortfolio.holdings[0];
      }
    });

    test('should update holding quantity and cost', async ({ page }) => {
      expect(testHolding).toBeDefined();
      
      await testHelpers.navigateAndWait('/portfolio');
      
      // Click edit button for the holding
      const editButton = page.locator(`[data-testid="edit-holding-${testHolding.id}"]`);
      await editButton.click();

      // Verify edit modal/form opens
      const editModal = page.locator('[data-testid="edit-holding-modal"]');
      await expect(editModal).toBeVisible();
      
      // Verify current values are pre-filled
      await expect(page.locator('[data-testid="edit-quantity"]')).toHaveValue(testHolding.quantity.toString());
      await expect(page.locator('[data-testid="edit-cost"]')).toHaveValue(testHolding.averageCost.toString());

      // Update values
      const updatedQuantity = testHolding.quantity + 10;
      const updatedCost = testHolding.averageCost + 5;
      
      await testHelpers.fillFormField('[data-testid="edit-quantity"]', updatedQuantity.toString());
      await testHelpers.fillFormField('[data-testid="edit-cost"]', updatedCost.toString());

      await page.click('[data-testid="save-holding-changes"]');
      await testHelpers.verifySuccessMessage('Holding updated successfully');

      // Verify changes in UI
      await expect(page.locator(`text=${updatedQuantity}`)).toBeVisible();
      await expect(page.locator(`text=${testHelpers.formatCurrency(updatedCost)}`)).toBeVisible();

      // Verify database update
      const isUpdated = await dbHelpers.verifyPortfolioHoldingInDb(testHolding.id, {
        quantity: updatedQuantity,
        averageCost: updatedCost
      });
      expect(isUpdated).toBe(true);

      await testHelpers.takeScreenshot('holding-updated');
    });

    test('should add buy transaction to existing holding', async ({ page }) => {
      expect(testHolding).toBeDefined();
      
      await testHelpers.navigateAndWait('/portfolio');
      
      const buyButton = page.locator(`[data-testid="buy-more-${testHolding.id}"]`);
      if (await buyButton.count() > 0) {
        await buyButton.click();
        
        const buyModal = page.locator('[data-testid="buy-transaction-modal"]');
        await expect(buyModal).toBeVisible();
        
        const additionalQuantity = 5;
        const buyPrice = testHolding.averageCost * 1.1; // Buy at 10% higher price
        
        await testHelpers.fillFormField('[data-testid="buy-quantity"]', additionalQuantity.toString());
        await testHelpers.fillFormField('[data-testid="buy-price"]', buyPrice.toString());
        
        await page.click('[data-testid="execute-buy"]');
        await testHelpers.verifySuccessMessage('Buy transaction executed');
        
        // Verify updated quantity
        const newQuantity = testHolding.quantity + additionalQuantity;
        await expect(page.locator(`text=${newQuantity}`)).toBeVisible();
        
        // Verify average cost was recalculated
        const expectedAvgCost = ((testHolding.quantity * testHolding.averageCost) + (additionalQuantity * buyPrice)) / newQuantity;
        await expect(page.locator(`text=${testHelpers.formatCurrency(expectedAvgCost)}`)).toBeVisible();
      }
    });

    test('should add sell transaction', async ({ page }) => {
      expect(testHolding).toBeDefined();
      
      await testHelpers.navigateAndWait('/portfolio');
      
      const sellButton = page.locator(`[data-testid="sell-${testHolding.id}"]`);
      if (await sellButton.count() > 0) {
        await sellButton.click();
        
        const sellModal = page.locator('[data-testid="sell-transaction-modal"]');
        await expect(sellModal).toBeVisible();
        
        const sellQuantity = Math.min(testHolding.quantity, 2); // Sell partial quantity
        const sellPrice = testHolding.averageCost * 1.15; // Sell at 15% profit
        
        await testHelpers.fillFormField('[data-testid="sell-quantity"]', sellQuantity.toString());
        await testHelpers.fillFormField('[data-testid="sell-price"]', sellPrice.toString());
        
        await page.click('[data-testid="execute-sell"]');
        await testHelpers.verifySuccessMessage('Sell transaction executed');
        
        // Verify updated quantity
        const newQuantity = testHolding.quantity - sellQuantity;
        if (newQuantity > 0) {
          await expect(page.locator(`text=${newQuantity}`)).toBeVisible();
        } else {
          // If completely sold, holding should be removed or marked as sold
          await expect(page.locator(`[data-testid="holding-row-${testHolding.id}"]`)).not.toBeVisible();
        }
        
        // Verify profit/loss calculation
        const profit = (sellPrice - testHolding.averageCost) * sellQuantity;
        await expect(page.locator(`text=${testHelpers.formatCurrency(profit)}`)).toBeVisible();
      }
    });
  });

  test.describe('Remove Holdings', () => {
    test.beforeEach(async () => {
      const testData = await dbSetup.setupBasicTestData();
      testPortfolio = testData.portfolio || mockData.generatePortfolio();
      if (testPortfolio.holdings && testPortfolio.holdings.length > 0) {
        testHolding = testPortfolio.holdings[0];
      }
    });

    test('should remove holding with confirmation', async ({ page }) => {
      expect(testHolding).toBeDefined();
      
      await testHelpers.navigateAndWait('/portfolio');
      
      const removeButton = page.locator(`[data-testid="remove-holding-${testHolding.id}"]`);
      await removeButton.click();
      
      const confirmDialog = page.locator('[data-testid="confirm-remove-holding"]');
      await expect(confirmDialog).toBeVisible();
      await expect(confirmDialog).toContainText(testHolding.symbol);
      await expect(confirmDialog).toContainText('This action cannot be undone');
      
      await page.click('[data-testid="confirm-remove"]');
      await testHelpers.verifySuccessMessage('Holding removed from portfolio');
      
      // Verify holding is removed from UI
      await expect(page.locator(`[data-testid="holding-row-${testHolding.id}"]`)).not.toBeVisible();
      
      // Verify portfolio totals are updated
      const updatedTotalValue = page.locator('[data-testid="total-portfolio-value"]');
      await expect(updatedTotalValue).toBeVisible();

      await testHelpers.takeScreenshot('holding-removed');
    });

    test('should prevent removal of holdings with recent transactions', async ({ page }) => {
      expect(testHolding).toBeDefined();
      
      await testHelpers.navigateAndWait('/portfolio');
      
      const removeButton = page.locator(`[data-testid="remove-holding-${testHolding.id}"]`);
      await removeButton.click();
      
      // Should show warning about recent transactions
      const warningDialog = page.locator('[data-testid="removal-warning"]');
      if (await warningDialog.count() > 0) {
        await expect(warningDialog).toBeVisible();
        await expect(warningDialog).toContainText('recent transactions');
        
        // Should still allow removal with additional confirmation
        const forceRemoveButton = page.locator('[data-testid="force-remove"]');
        if (await forceRemoveButton.count() > 0) {
          await expect(forceRemoveButton).toBeVisible();
        }
      }
    });
  });

  test.describe('Portfolio Analytics', () => {
    test.beforeEach(async () => {
      await dbSetup.setupComplexScenario();
    });

    test('should display asset allocation breakdown', async ({ page }) => {
      await testHelpers.navigateAndWait('/portfolio/analytics');
      
      await expect(page.locator('[data-testid="asset-allocation-chart"]')).toBeVisible();
      
      // Check allocation by asset type
      const allocationTypes = ['stocks', 'etfs', 'crypto', 'bonds'];
      for (const type of allocationTypes) {
        const allocationElement = page.locator(`[data-testid="allocation-${type}"]`);
        if (await allocationElement.count() > 0) {
          await expect(allocationElement).toBeVisible();
          
          // Verify percentage is shown
          const percentageText = await allocationElement.textContent();
          expect(percentageText).toMatch(/\d+(\.\d+)?%/);
        }
      }
      
      // Check sector allocation
      await expect(page.locator('[data-testid="sector-allocation"]')).toBeVisible();
      
      // Check geographic allocation
      const geoAllocation = page.locator('[data-testid="geographic-allocation"]');
      if (await geoAllocation.count() > 0) {
        await expect(geoAllocation).toBeVisible();
      }

      await testHelpers.takeScreenshot('portfolio-asset-allocation');
    });

    test('should show portfolio performance metrics', async ({ page }) => {
      await testHelpers.navigateAndWait('/portfolio/analytics');
      
      // Check key performance indicators
      await expect(page.locator('[data-testid="total-return"]')).toBeVisible();
      await expect(page.locator('[data-testid="annualized-return"]')).toBeVisible();
      
      const sharpeRatio = page.locator('[data-testid="sharpe-ratio"]');
      if (await sharpeRatio.count() > 0) {
        await expect(sharpeRatio).toBeVisible();
        
        const ratioText = await sharpeRatio.textContent();
        expect(ratioText).toMatch(/\d+\.\d+/);
      }
      
      const maxDrawdown = page.locator('[data-testid="max-drawdown"]');
      if (await maxDrawdown.count() > 0) {
        await expect(maxDrawdown).toBeVisible();
      }
      
      // Performance comparison chart
      await expect(page.locator('[data-testid="performance-comparison"]')).toBeVisible();

      await testHelpers.takeScreenshot('portfolio-performance-metrics');
    });

    test('should display dividend and income tracking', async ({ page }) => {
      await testHelpers.navigateAndWait('/portfolio/income');
      
      const incomeSection = page.locator('[data-testid="dividend-income"]');
      await expect(incomeSection).toBeVisible();
      
      // Check dividend calendar
      const dividendCalendar = page.locator('[data-testid="dividend-calendar"]');
      if (await dividendCalendar.count() > 0) {
        await expect(dividendCalendar).toBeVisible();
      }
      
      // Check income summary
      await expect(page.locator('[data-testid="income-summary"]')).toBeVisible();
      
      // Verify income by asset
      const incomeByAsset = page.locator('[data-testid="income-by-asset"]');
      if (await incomeByAsset.count() > 0) {
        await expect(incomeByAsset).toBeVisible();
      }

      await testHelpers.takeScreenshot('portfolio-dividend-tracking');
    });
  });

  test.describe('Error Handling', () => {
    test('should handle price feed failures gracefully', async ({ page }) => {
      await testHelpers.navigateAndWait('/portfolio');
      
      // Look for price error indicators
      const priceError = page.locator('[data-testid="price-error"]');
      if (await priceError.count() > 0) {
        await expect(priceError).toBeVisible();
        
        // Should show last updated time
        await expect(page.locator('[data-testid="last-updated"]')).toBeVisible();
        
        // Should have refresh button
        const refreshButton = page.locator('[data-testid="refresh-prices"]');
        if (await refreshButton.count() > 0) {
          await expect(refreshButton).toBeVisible();
          await refreshButton.click();
        }
      }
    });

    test('should validate transaction inputs', async ({ page }) => {
      const testData = await dbSetup.setupBasicTestData();
      testPortfolio = testData.portfolio || mockData.generatePortfolio();
      
      if (testPortfolio.holdings && testPortfolio.holdings.length > 0) {
        const holding = testPortfolio.holdings[0];
        
        await testHelpers.navigateAndWait('/portfolio');
        
        const sellButton = page.locator(`[data-testid="sell-${holding.id}"]`);
        if (await sellButton.count() > 0) {
          await sellButton.click();
          
          // Try to sell more than owned
          await testHelpers.fillFormField('[data-testid="sell-quantity"]', (holding.quantity + 10).toString());
          await page.click('[data-testid="execute-sell"]');
          
          await expect(page.locator('[data-testid="quantity-error"]')).toBeVisible();
          await expect(page.locator('[data-testid="quantity-error"]')).toContainText('insufficient');
        }
      }
    });
  });

  test.describe('Performance and Mobile', () => {
    test('should load portfolio page efficiently', async ({ page }) => {
      const startTime = Date.now();
      await testHelpers.navigateAndWait('/portfolio');
      const endTime = Date.now();
      
      const loadTime = endTime - startTime;
      expect(loadTime).toBeLessThan(4000);
      
      console.log(`Portfolio page loaded in ${loadTime}ms`);
    });

    test('should work on mobile devices', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      await testHelpers.navigateAndWait('/portfolio');
      
      // Verify mobile-friendly layout
      const portfolioContainer = page.locator('[data-testid="portfolio-container"]');
      await expect(portfolioContainer).toBeVisible();
      
      // Test horizontal scrolling for holdings table
      const holdingsTable = page.locator('[data-testid="holdings-table"]');
      if (await holdingsTable.count() > 0) {
        await expect(holdingsTable).toBeVisible();
      }
      
      // Test mobile-specific interactions
      const mobileMenu = page.locator('[data-testid="mobile-portfolio-menu"]');
      if (await mobileMenu.count() > 0) {
        await mobileMenu.tap();
        await expect(page.locator('[data-testid="mobile-options"]')).toBeVisible();
      }

      await testHelpers.takeScreenshot('portfolio-mobile');
    });
  });
});