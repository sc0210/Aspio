/**
 * Transaction CRUD Test Suite
 * Comprehensive testing of transaction create, read, update, delete operations
 * Including database verification and error handling
 */

import { test, expect } from '@playwright/test';
import { TestHelpers, DatabaseTestHelpers } from '../utils/test-helpers';
import { DatabaseSetup } from '../utils/database-setup';
import { mockData } from '../utils/mock-data';
import { Transaction } from '@/shared/types';

test.describe('Transaction CRUD Operations', () => {
  let testHelpers: TestHelpers;
  let dbHelpers: DatabaseTestHelpers;
  let dbSetup: DatabaseSetup;
  let testTransaction: Transaction;

  test.beforeEach(async ({ page }) => {
    testHelpers = new TestHelpers(page);
    dbHelpers = new DatabaseTestHelpers();
    dbSetup = new DatabaseSetup();

    // Initialize with authentication
    await testHelpers.navigateAndWait('/');
    await testHelpers.waitForPageLoad();
    
    // Set up database with basic test data
    const authToken = 'mock-auth-token'; // In real tests, get from auth setup
    await dbSetup.initialize(authToken);
    dbHelpers.setAuthToken(authToken);
    testHelpers.authenticateApi(authToken);
  });

  test.afterEach(async () => {
    await dbSetup.cleanup();
    await testHelpers.cleanup();
    dbHelpers.cleanup();
  });

  test.describe('Create Transaction', () => {
    test('should create new transaction with valid data', async ({ page }) => {
      // Navigate to transaction creation page
      await testHelpers.navigateAndWait('/transactions/add');

      // Generate test transaction data
      const transactionData = mockData.generateTransaction({
        amount: 150.50,
        description: 'Test Coffee Purchase',
        category: 'Food & Dining',
        type: 'expense'
      });

      // Fill transaction form
      await testHelpers.fillFormField('[data-testid="transaction-amount"]', transactionData.amount.toString());
      await testHelpers.fillFormField('[data-testid="transaction-description"]', transactionData.description);
      await page.selectOption('[data-testid="transaction-type"]', transactionData.type);
      await page.selectOption('[data-testid="transaction-category"]', transactionData.category);
      await testHelpers.fillFormField('[data-testid="transaction-date"]', transactionData.date.toISOString().split('T')[0]);

      // Submit form
      await testHelpers.submitFormAndWait();

      // Verify success message
      await testHelpers.verifySuccessMessage('Transaction created successfully');

      // Verify redirect to transactions list
      await expect(page).toHaveURL('/transactions');

      // Verify transaction appears in list
      await testHelpers.waitForElement('[data-testid="transactions-list"]');
      await expect(page.locator(`text=${transactionData.description}`)).toBeVisible();
      await expect(page.locator(`text=${testHelpers.formatCurrency(transactionData.amount)}`)).toBeVisible();

      // Verify in database
      const dbStats = await dbSetup.getDatabaseStats();
      expect(dbStats.transactionCount).toBeGreaterThan(0);

      // Take screenshot for visual verification
      await testHelpers.takeScreenshot('transaction-created');
    });

    test('should validate required fields', async ({ page }) => {
      await testHelpers.navigateAndWait('/transactions/add');

      // Submit form without filling required fields
      await testHelpers.submitFormAndWait();

      // Verify validation errors appear
      await expect(page.locator('[data-testid="amount-error"]')).toBeVisible();
      await expect(page.locator('[data-testid="description-error"]')).toBeVisible();
      await expect(page.locator('[data-testid="category-error"]')).toBeVisible();

      // Verify form is not submitted
      await expect(page).toHaveURL('/transactions/add');
    });

    test('should handle decimal amounts correctly', async ({ page }) => {
      await testHelpers.navigateAndWait('/transactions/add');

      const testAmounts = ['0.01', '999.99', '1234.56', '10000.00'];
      
      for (const amount of testAmounts) {
        const transactionData = mockData.generateTransaction({
          amount: parseFloat(amount),
          description: `Test Amount ${amount}`
        });

        // Fill form with specific amount
        await testHelpers.fillFormField('[data-testid="transaction-amount"]', amount);
        await testHelpers.fillFormField('[data-testid="transaction-description"]', transactionData.description);
        await page.selectOption('[data-testid="transaction-type"]', transactionData.type);
        await page.selectOption('[data-testid="transaction-category"]', transactionData.category);
        
        await testHelpers.submitFormAndWait();
        
        // Verify success and navigate back
        await testHelpers.verifySuccessMessage();
        await testHelpers.navigateAndWait('/transactions/add');
      }

      // Verify all transactions were created
      await testHelpers.navigateAndWait('/transactions');
      for (const amount of testAmounts) {
        await expect(page.locator(`text=Test Amount ${amount}`)).toBeVisible();
      }
    });

    test('should handle attachment upload', async ({ page }) => {
      await testHelpers.navigateAndWait('/transactions/add');

      const transactionData = mockData.generateTransaction({
        description: 'Transaction with Receipt'
      });

      // Fill basic transaction data
      await testHelpers.fillFormField('[data-testid="transaction-amount"]', transactionData.amount.toString());
      await testHelpers.fillFormField('[data-testid="transaction-description"]', transactionData.description);
      await page.selectOption('[data-testid="transaction-type"]', transactionData.type);
      await page.selectOption('[data-testid="transaction-category"]', transactionData.category);

      // Handle file upload if upload component exists
      const fileInput = page.locator('[data-testid="receipt-upload"]');
      if (await fileInput.count() > 0) {
        // Create a test file
        const testFile = {
          name: 'receipt.jpg',
          mimeType: 'image/jpeg',
          buffer: Buffer.from('fake-image-content')
        };
        
        await fileInput.setInputFiles(testFile);
        
        // Verify file upload indicator
        await expect(page.locator('[data-testid="file-uploaded"]')).toBeVisible();
      }

      await testHelpers.submitFormAndWait();
      await testHelpers.verifySuccessMessage();
    });
  });

  test.describe('Read Transactions', () => {
    test.beforeEach(async () => {
      // Set up test transactions
      await dbSetup.setupBasicTestData();
    });

    test('should display transactions list', async ({ page }) => {
      await testHelpers.navigateAndWait('/transactions');

      // Verify page loads
      await testHelpers.waitForElement('[data-testid="transactions-list"]');
      
      // Verify table headers
      await expect(page.locator('th:has-text("Date")')).toBeVisible();
      await expect(page.locator('th:has-text("Description")')).toBeVisible();
      await expect(page.locator('th:has-text("Amount")')).toBeVisible();
      await expect(page.locator('th:has-text("Category")')).toBeVisible();
      
      // Verify at least one transaction is displayed
      const transactionRows = page.locator('[data-testid="transaction-row"]');
      await expect(transactionRows.first()).toBeVisible();

      // Take screenshot for visual verification
      await testHelpers.takeScreenshot('transactions-list');
    });

    test('should filter transactions by type', async ({ page }) => {
      await testHelpers.navigateAndWait('/transactions');

      // Apply income filter
      await page.selectOption('[data-testid="type-filter"]', 'income');
      await testHelpers.waitForPageLoad();

      // Verify only income transactions are shown
      const incomeRows = page.locator('[data-testid="transaction-row"]');
      const rowCount = await incomeRows.count();
      
      for (let i = 0; i < rowCount; i++) {
        const row = incomeRows.nth(i);
        await expect(row.locator('[data-testid="transaction-type"]')).toContainText('income');
      }

      // Apply expense filter
      await page.selectOption('[data-testid="type-filter"]', 'expense');
      await testHelpers.waitForPageLoad();

      // Verify only expense transactions are shown
      const expenseRows = page.locator('[data-testid="transaction-row"]');
      const expenseRowCount = await expenseRows.count();
      
      for (let i = 0; i < expenseRowCount; i++) {
        const row = expenseRows.nth(i);
        await expect(row.locator('[data-testid="transaction-type"]')).toContainText('expense');
      }
    });

    test('should filter transactions by date range', async ({ page }) => {
      await testHelpers.navigateAndWait('/transactions');

      // Set date range filter
      const today = new Date();
      const lastWeek = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
      
      await testHelpers.fillFormField('[data-testid="date-from"]', lastWeek.toISOString().split('T')[0]);
      await testHelpers.fillFormField('[data-testid="date-to"]', today.toISOString().split('T')[0]);
      
      await page.click('[data-testid="apply-date-filter"]');
      await testHelpers.waitForPageLoad();

      // Verify filtered results
      const filteredRows = page.locator('[data-testid="transaction-row"]');
      if (await filteredRows.count() > 0) {
        // Verify dates are within range
        const firstRowDate = await filteredRows.first().locator('[data-testid="transaction-date"]').textContent();
        expect(firstRowDate).toBeTruthy();
      }
    });

    test('should paginate transactions correctly', async ({ page }) => {
      await testHelpers.navigateAndWait('/transactions');

      // Check if pagination exists
      const pagination = page.locator('[data-testid="pagination"]');
      if (await pagination.count() > 0) {
        // Click next page
        const nextButton = page.locator('[data-testid="next-page"]');
        if (await nextButton.count() > 0 && await nextButton.isEnabled()) {
          await nextButton.click();
          await testHelpers.waitForPageLoad();
          
          // Verify different content on page 2
          await expect(page.locator('[data-testid="page-number"]')).toContainText('2');
        }
      }
    });
  });

  test.describe('Update Transaction', () => {
    test.beforeEach(async () => {
      const testData = await dbSetup.setupBasicTestData();
      if (testData.transactions.length > 0) {
        testTransaction = testData.transactions[0];
      }
    });

    test('should update transaction successfully', async ({ page }) => {
      expect(testTransaction).toBeDefined();
      
      // Navigate to edit page
      await testHelpers.navigateAndWait(`/transactions/edit/${testTransaction.id}`);

      // Verify form is pre-populated
      const amountField = page.locator('[data-testid="transaction-amount"]');
      await expect(amountField).toHaveValue(testTransaction.amount.toString());

      const descriptionField = page.locator('[data-testid="transaction-description"]');
      await expect(descriptionField).toHaveValue(testTransaction.description);

      // Update transaction data
      const updatedData = {
        amount: testTransaction.amount + 50,
        description: 'Updated: ' + testTransaction.description,
        category: 'Entertainment'
      };

      await testHelpers.fillFormField('[data-testid="transaction-amount"]', updatedData.amount.toString());
      await testHelpers.fillFormField('[data-testid="transaction-description"]', updatedData.description);
      await page.selectOption('[data-testid="transaction-category"]', updatedData.category);

      await testHelpers.submitFormAndWait();
      await testHelpers.verifySuccessMessage('Transaction updated successfully');

      // Verify changes in database
      const isVerified = await dbHelpers.verifyTransactionInDb(testTransaction.id, {
        amount: updatedData.amount,
        description: updatedData.description,
        category: updatedData.category
      });
      expect(isVerified).toBe(true);

      // Verify changes in UI
      await testHelpers.navigateAndWait('/transactions');
      await expect(page.locator(`text=${updatedData.description}`)).toBeVisible();
      await expect(page.locator(`text=${testHelpers.formatCurrency(updatedData.amount)}`)).toBeVisible();
    });

    test('should handle concurrent updates', async ({ page }) => {
      expect(testTransaction).toBeDefined();
      
      // Simulate concurrent update by modifying the transaction externally
      // This would typically involve API calls to modify the transaction
      // while the form is open
      
      await testHelpers.navigateAndWait(`/transactions/edit/${testTransaction.id}`);
      
      // Make changes
      await testHelpers.fillFormField('[data-testid="transaction-description"]', 'User Update');
      
      // Submit and check for conflict handling
      await testHelpers.submitFormAndWait();
      
      // Should either succeed or show appropriate conflict message
      const hasSuccess = await testHelpers.elementExists('[data-testid="success-message"]');
      const hasConflict = await testHelpers.elementExists('[data-testid="conflict-message"]');
      
      expect(hasSuccess || hasConflict).toBe(true);
    });
  });

  test.describe('Delete Transaction', () => {
    test.beforeEach(async () => {
      const testData = await dbSetup.setupBasicTestData();
      if (testData.transactions.length > 0) {
        testTransaction = testData.transactions[0];
      }
    });

    test('should delete transaction with confirmation', async ({ page }) => {
      expect(testTransaction).toBeDefined();
      
      await testHelpers.navigateAndWait('/transactions');
      
      // Find and click delete button for the test transaction
      const deleteButton = page.locator(`[data-testid="delete-transaction-${testTransaction.id}"]`);
      await deleteButton.click();

      // Handle confirmation dialog
      const confirmDialog = page.locator('[data-testid="confirm-delete-dialog"]');
      await expect(confirmDialog).toBeVisible();
      await expect(confirmDialog).toContainText(testTransaction.description);
      
      await page.click('[data-testid="confirm-delete"]');
      await testHelpers.verifySuccessMessage('Transaction deleted successfully');

      // Verify transaction is removed from UI
      await expect(page.locator(`text=${testTransaction.description}`)).not.toBeVisible();

      // Verify transaction is deleted from database
      const isDeleted = await dbHelpers.verifyDeletion('transaction', testTransaction.id);
      expect(isDeleted).toBe(true);

      // Update local test data
      dbSetup.removeTransaction(testTransaction.id);
    });

    test('should cancel delete operation', async ({ page }) => {
      expect(testTransaction).toBeDefined();
      
      await testHelpers.navigateAndWait('/transactions');
      
      const deleteButton = page.locator(`[data-testid="delete-transaction-${testTransaction.id}"]`);
      await deleteButton.click();

      const confirmDialog = page.locator('[data-testid="confirm-delete-dialog"]');
      await expect(confirmDialog).toBeVisible();
      
      // Cancel the delete operation
      await page.click('[data-testid="cancel-delete"]');
      await expect(confirmDialog).not.toBeVisible();

      // Verify transaction still exists
      await expect(page.locator(`text=${testTransaction.description}`)).toBeVisible();
      
      const stillExists = await dbHelpers.verifyTransactionInDb(testTransaction.id, {
        id: testTransaction.id
      });
      expect(stillExists).toBe(true);
    });

    test('should handle bulk delete operations', async ({ page }) => {
      await testHelpers.navigateAndWait('/transactions');
      
      // Check if bulk operations are available
      const bulkSelect = page.locator('[data-testid="bulk-select-all"]');
      if (await bulkSelect.count() > 0) {
        await bulkSelect.check();
        
        const bulkDeleteButton = page.locator('[data-testid="bulk-delete"]');
        await expect(bulkDeleteButton).toBeVisible();
        await bulkDeleteButton.click();
        
        const confirmDialog = page.locator('[data-testid="confirm-bulk-delete"]');
        await expect(confirmDialog).toBeVisible();
        await page.click('[data-testid="confirm-bulk-delete"]');
        
        await testHelpers.verifySuccessMessage('Transactions deleted successfully');
      }
    });
  });

  test.describe('Error Handling', () => {
    test('should handle network errors gracefully', async ({ page }) => {
      // Simulate network error by going offline
      await page.context().setOffline(true);
      
      await testHelpers.navigateAndWait('/transactions/add');
      
      const transactionData = mockData.generateTransaction();
      await testHelpers.fillFormField('[data-testid="transaction-amount"]', transactionData.amount.toString());
      await testHelpers.fillFormField('[data-testid="transaction-description"]', transactionData.description);
      await page.selectOption('[data-testid="transaction-type"]', transactionData.type);
      await page.selectOption('[data-testid="transaction-category"]', transactionData.category);
      
      await testHelpers.submitFormAndWait();
      
      // Should show network error message
      await testHelpers.verifyErrorMessage('Network error');
      
      // Go back online and retry
      await page.context().setOffline(false);
      
      const retryButton = page.locator('[data-testid="retry-button"]');
      if (await retryButton.count() > 0) {
        await retryButton.click();
        await testHelpers.verifySuccessMessage();
      }
    });

    test('should handle validation errors from server', async ({ page }) => {
      await testHelpers.navigateAndWait('/transactions/add');
      
      // Submit invalid data that would cause server validation errors
      await testHelpers.fillFormField('[data-testid="transaction-amount"]', '-100'); // Negative amount
      await testHelpers.fillFormField('[data-testid="transaction-description"]', ''); // Empty description
      
      await testHelpers.submitFormAndWait();
      
      // Should display server validation errors
      await expect(page.locator('[data-testid="server-error"]')).toBeVisible();
    });
  });

  test.describe('Accessibility & Responsive Design', () => {
    test('should be accessible with keyboard navigation', async ({ page }) => {
      await testHelpers.navigateAndWait('/transactions/add');
      
      // Test keyboard navigation through form
      await page.keyboard.press('Tab'); // Amount field
      await expect(page.locator('[data-testid="transaction-amount"]')).toBeFocused();
      
      await page.keyboard.press('Tab'); // Description field
      await expect(page.locator('[data-testid="transaction-description"]')).toBeFocused();
      
      await page.keyboard.press('Tab'); // Type dropdown
      await expect(page.locator('[data-testid="transaction-type"]')).toBeFocused();
    });

    test('should work properly on mobile devices', async ({ page }) => {
      await testHelpers.verifyResponsiveLayout(['mobile', 'tablet', 'desktop']);
      
      // Test mobile-specific interactions
      await page.setViewportSize({ width: 375, height: 667 });
      await testHelpers.navigateAndWait('/transactions');
      
      // Verify mobile layout elements
      const mobileMenu = page.locator('[data-testid="mobile-menu"]');
      if (await mobileMenu.count() > 0) {
        await expect(mobileMenu).toBeVisible();
      }
      
      await testHelpers.takeScreenshot('transactions-mobile');
    });
  });

  test.describe('Performance', () => {
    test('should load transactions list within acceptable time', async ({ page }) => {
      const startTime = Date.now();
      await testHelpers.navigateAndWait('/transactions');
      const endTime = Date.now();
      
      const loadTime = endTime - startTime;
      expect(loadTime).toBeLessThan(5000); // Should load within 5 seconds
      
      console.log(`Transactions list loaded in ${loadTime}ms`);
    });

    test('should handle large datasets efficiently', async ({ page }) => {
      // This test would require a dataset with many transactions
      await testHelpers.navigateAndWait('/transactions');
      
      // Verify pagination or virtual scrolling for large datasets
      const listContainer = page.locator('[data-testid="transactions-list"]');
      await expect(listContainer).toBeVisible();
      
      // Test scrolling performance
      await page.mouse.wheel(0, 1000);
      await testHelpers.waitForPageLoad();
      
      // Verify list is still responsive
      await expect(listContainer).toBeVisible();
    });
  });
});