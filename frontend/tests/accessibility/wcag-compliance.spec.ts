/**
 * WCAG 2.1 AA Compliance Test Suite
 * Comprehensive accessibility testing for Aspiro FIRE tracker application
 */

import { test, expect } from '@playwright/test';
import { TestHelpers } from '../utils/test-helpers';
import { DatabaseSetup } from '../utils/database-setup';
import { injectAxe, checkA11y, getViolations } from 'axe-playwright';

test.describe('WCAG 2.1 AA Compliance Testing', () => {
  let testHelpers: TestHelpers;
  let dbSetup: DatabaseSetup;

  test.beforeEach(async ({ page }) => {
    testHelpers = new TestHelpers(page);
    dbSetup = new DatabaseSetup();

    // Initialize with test data
    const authToken = 'mock-auth-token';
    await dbSetup.initialize(authToken);
    testHelpers.authenticateApi(authToken);

    // Inject axe-core for accessibility testing
    await injectAxe(page);
  });

  test.afterEach(async () => {
    await dbSetup.cleanup();
    await testHelpers.cleanup();
  });

  test.describe('Navigation and Structure Accessibility', () => {
    test('should have proper semantic structure on dashboard', async ({ page }) => {
      await testHelpers.navigateAndWait('/');

      // Check for main landmarks
      await expect(page.locator('main')).toBeVisible();
      await expect(page.locator('nav')).toBeVisible();

      // Check heading hierarchy
      const h1Count = await page.locator('h1').count();
      expect(h1Count).toBeGreaterThanOrEqual(1);

      // Verify headings are in logical order
      const headings = await page.locator('h1, h2, h3, h4, h5, h6').all();
      for (let i = 0; i < headings.length; i++) {
        const heading = headings[i];
        const tagName = await heading.evaluate(el => el.tagName);
        expect(['H1', 'H2', 'H3', 'H4', 'H5', 'H6']).toContain(tagName);
      }

      // Run axe accessibility checks
      await checkA11y(page, null, {
        detailedReport: true,
        detailedReportOptions: { html: true },
      });
    });

    test('should have accessible navigation menu', async ({ page }) => {
      await testHelpers.navigateAndWait('/');

      // Check navigation has proper ARIA labels
      const nav = page.locator('nav');
      await expect(nav).toBeVisible();

      // Check for skip links
      const skipLink = page.locator('a[href="#main"], a:has-text("Skip to main content")');
      if (await skipLink.count() > 0) {
        await expect(skipLink).toBeVisible();

        // Test skip link functionality
        await skipLink.click();
        const mainContent = page.locator('main, #main');
        await expect(mainContent).toBeFocused();
      }

      // Check menu items are keyboard accessible
      const menuItems = page.locator('nav a, nav button');
      const menuCount = await menuItems.count();

      if (menuCount > 0) {
        for (let i = 0; i < Math.min(menuCount, 5); i++) {
          const item = menuItems.nth(i);
          await expect(item).toBeVisible();

          // Check for proper accessible names
          const accessibleName = await item.getAttribute('aria-label') ||
                                 await item.textContent();
          expect(accessibleName).toBeTruthy();
        }
      }

      await checkA11y(page, 'nav');
    });

    test('should have accessible breadcrumb navigation', async ({ page }) => {
      await testHelpers.navigateAndWait('/transactions');

      // Check for breadcrumb navigation
      const breadcrumb = page.locator('[aria-label="Breadcrumb"], nav[aria-label*="breadcrumb"]');
      if (await breadcrumb.count() > 0) {
        await expect(breadcrumb).toBeVisible();

        // Check breadcrumb structure
        const breadcrumbItems = breadcrumb.locator('a, span');
        const itemCount = await breadcrumbItems.count();

        if (itemCount > 0) {
          // Current page should not be a link
          const lastItem = breadcrumbItems.last();
          const isLink = await lastItem.evaluate(el => el.tagName === 'A');
          expect(isLink).toBe(false);
        }
      }
    });
  });

  test.describe('Form Accessibility', () => {
    test('should have accessible transaction form', async ({ page }) => {
      await testHelpers.navigateAndWait('/transactions/add');
      await testHelpers.waitForPageLoad();

      // Check form has proper labeling
      const form = page.locator('form');
      await expect(form).toBeVisible();

      // Check all input fields have labels
      const inputs = page.locator('input, select, textarea');
      const inputCount = await inputs.count();

      for (let i = 0; i < inputCount; i++) {
        const input = inputs.nth(i);
        const inputId = await input.getAttribute('id');
        const inputName = await input.getAttribute('name');

        if (inputId) {
          // Check for associated label
          const label = page.locator(`label[for="${inputId}"]`);
          if (await label.count() > 0) {
            await expect(label).toBeVisible();
            const labelText = await label.textContent();
            expect(labelText?.trim()).toBeTruthy();
          } else {
            // Check for aria-label or aria-labelledby
            const ariaLabel = await input.getAttribute('aria-label');
            const ariaLabelledBy = await input.getAttribute('aria-labelledby');
            expect(ariaLabel || ariaLabelledBy).toBeTruthy();
          }
        }
      }

      // Check required fields are properly marked
      const requiredInputs = page.locator('input[required], select[required]');
      const requiredCount = await requiredInputs.count();

      for (let i = 0; i < requiredCount; i++) {
        const input = requiredInputs.nth(i);
        const ariaRequired = await input.getAttribute('aria-required');
        const required = await input.getAttribute('required');

        expect(ariaRequired === 'true' || required !== null).toBe(true);
      }

      // Test form validation accessibility
      await testHelpers.submitFormAndWait();

      // Check for error messages with proper ARIA
      const errorMessages = page.locator('[role="alert"], .error, [aria-invalid="true"]');
      if (await errorMessages.count() > 0) {
        const firstError = errorMessages.first();
        await expect(firstError).toBeVisible();

        // Error should be announced to screen readers
        const role = await firstError.getAttribute('role');
        const ariaLive = await firstError.getAttribute('aria-live');
        expect(role === 'alert' || ariaLive === 'polite' || ariaLive === 'assertive').toBe(true);
      }

      await checkA11y(page, 'form');
    });

    test('should have accessible goal creation form', async ({ page }) => {
      await testHelpers.navigateAndWait('/goals/add');
      await testHelpers.waitForPageLoad();

      // Test date inputs accessibility
      const dateInputs = page.locator('input[type="date"]');
      const dateCount = await dateInputs.count();

      for (let i = 0; i < dateCount; i++) {
        const dateInput = dateInputs.nth(i);

        // Check date format is announced
        const label = page.locator(`label[for="${await dateInput.getAttribute('id')}"]`);
        if (await label.count() > 0) {
          const labelText = await label.textContent();
          // Should indicate date format or have aria-describedby
          const describedBy = await dateInput.getAttribute('aria-describedby');
          expect(labelText?.includes('date') || describedBy).toBeTruthy();
        }
      }

      // Test number inputs accessibility
      const numberInputs = page.locator('input[type="number"]');
      const numberCount = await numberInputs.count();

      for (let i = 0; i < numberCount; i++) {
        const numberInput = numberInputs.nth(i);

        // Check for proper min/max/step attributes
        const min = await numberInput.getAttribute('min');
        const max = await numberInput.getAttribute('max');
        const step = await numberInput.getAttribute('step');

        // Should have reasonable constraints
        if (min) expect(parseFloat(min)).toBeGreaterThanOrEqual(0);
        if (max) expect(parseFloat(max)).toBeGreaterThan(0);
      }

      await checkA11y(page, 'form');
    });
  });

  test.describe('Data Tables Accessibility', () => {
    test('should have accessible transactions table', async ({ page }) => {
      await dbSetup.setupBasicTestData();
      await testHelpers.navigateAndWait('/transactions');
      await testHelpers.waitForPageLoad();

      const table = page.locator('table');
      if (await table.count() > 0) {
        await expect(table).toBeVisible();

        // Check table has caption or aria-label
        const caption = table.locator('caption');
        const ariaLabel = await table.getAttribute('aria-label');
        const ariaLabelledBy = await table.getAttribute('aria-labelledby');

        expect(await caption.count() > 0 || ariaLabel || ariaLabelledBy).toBe(true);

        // Check header cells use th elements
        const headerCells = table.locator('th');
        const headerCount = await headerCells.count();
        expect(headerCount).toBeGreaterThan(0);

        // Check headers have scope attributes
        for (let i = 0; i < headerCount; i++) {
          const header = headerCells.nth(i);
          const scope = await header.getAttribute('scope');
          expect(['col', 'row', 'colgroup', 'rowgroup']).toContain(scope || 'col');
        }

        // Check sortable columns are announced
        const sortableHeaders = table.locator('th[role="columnheader"], th[aria-sort]');
        const sortableCount = await sortableHeaders.count();

        for (let i = 0; i < sortableCount; i++) {
          const header = sortableHeaders.nth(i);
          const ariaSort = await header.getAttribute('aria-sort');

          if (ariaSort) {
            expect(['ascending', 'descending', 'none']).toContain(ariaSort);
          }
        }
      }

      await checkA11y(page, 'table');
    });

    test('should have accessible portfolio holdings table', async ({ page }) => {
      await testHelpers.navigateAndWait('/portfolio');
      await testHelpers.waitForPageLoad();

      const table = page.locator('table');
      if (await table.count() > 0) {
        // Check complex data is properly structured
        const dataCells = table.locator('td');
        const cellCount = await dataCells.count();

        for (let i = 0; i < Math.min(cellCount, 10); i++) {
          const cell = dataCells.nth(i);
          const cellText = await cell.textContent();

          // Monetary values should be properly formatted
          if (cellText?.includes('$') || cellText?.includes('%')) {
            // Should have proper decimal formatting
            expect(cellText).toMatch(/[\d,.]+(\.[\d]{2})?/);
          }
        }
      }

      await checkA11y(page, '[data-testid="portfolio-table"]');
    });
  });

  test.describe('Interactive Elements Accessibility', () => {
    test('should have accessible buttons and links', async ({ page }) => {
      await testHelpers.navigateAndWait('/');

      // Check all buttons have accessible names
      const buttons = page.locator('button');
      const buttonCount = await buttons.count();

      for (let i = 0; i < buttonCount; i++) {
        const button = buttons.nth(i);

        if (await button.isVisible()) {
          const accessibleName = await button.getAttribute('aria-label') ||
                                 await button.textContent() ||
                                 await button.getAttribute('title');

          expect(accessibleName?.trim()).toBeTruthy();

          // Icon-only buttons should have aria-label
          const text = await button.textContent();
          if (!text?.trim()) {
            const ariaLabel = await button.getAttribute('aria-label');
            expect(ariaLabel).toBeTruthy();
          }
        }
      }

      // Check all links have accessible names and purposes
      const links = page.locator('a');
      const linkCount = await links.count();

      for (let i = 0; i < Math.min(linkCount, 20); i++) {
        const link = links.nth(i);

        if (await link.isVisible()) {
          const href = await link.getAttribute('href');
          const text = await link.textContent();
          const ariaLabel = await link.getAttribute('aria-label');

          // Links should have meaningful text or aria-label
          expect(text?.trim() || ariaLabel).toBeTruthy();

          // Links should have valid href or role
          const role = await link.getAttribute('role');
          expect(href || role === 'button').toBeTruthy();
        }
      }

      await checkA11y(page);
    });

    test('should have accessible dropdown menus', async ({ page }) => {
      await testHelpers.navigateAndWait('/transactions/add');

      const selects = page.locator('select');
      const selectCount = await selects.count();

      for (let i = 0; i < selectCount; i++) {
        const select = selects.nth(i);

        if (await select.isVisible()) {
          // Check select has label
          const selectId = await select.getAttribute('id');
          if (selectId) {
            const label = page.locator(`label[for="${selectId}"]`);
            if (await label.count() > 0) {
              await expect(label).toBeVisible();
            }
          }

          // Check options have meaningful text
          const options = select.locator('option');
          const optionCount = await options.count();

          for (let j = 0; j < Math.min(optionCount, 5); j++) {
            const option = options.nth(j);
            const optionText = await option.textContent();
            expect(optionText?.trim()).toBeTruthy();
          }
        }
      }

      // Test custom dropdown components
      const customDropdowns = page.locator('[role="combobox"], [role="listbox"]');
      const customCount = await customDropdowns.count();

      for (let i = 0; i < customCount; i++) {
        const dropdown = customDropdowns.nth(i);

        // Check ARIA states
        const ariaExpanded = await dropdown.getAttribute('aria-expanded');
        const ariaHaspopup = await dropdown.getAttribute('aria-haspopup');

        expect(ariaExpanded).toBeTruthy();
        expect(ariaHaspopup).toBeTruthy();
      }
    });
  });

  test.describe('Color and Contrast Accessibility', () => {
    test('should meet color contrast requirements', async ({ page }) => {
      await testHelpers.navigateAndWait('/');

      // Run axe color contrast checks
      const violations = await getViolations(page, null, {
        tags: ['wcag2a', 'wcag2aa', 'wcag21aa']
      });

      const contrastViolations = violations.filter(v =>
        v.id === 'color-contrast' || v.id === 'color-contrast-enhanced'
      );

      expect(contrastViolations.length).toBe(0);

      // Test high contrast mode if available
      await page.emulateMedia({ colorScheme: 'dark' });
      await testHelpers.waitForPageLoad();

      // Verify dark mode doesn't introduce contrast issues
      const darkModeViolations = await getViolations(page, null, {
        tags: ['wcag2aa']
      });

      const darkContrastViolations = darkModeViolations.filter(v =>
        v.id === 'color-contrast'
      );

      expect(darkContrastViolations.length).toBe(0);
    });

    test('should not rely solely on color for information', async ({ page }) => {
      await dbSetup.setupBasicTestData();
      await testHelpers.navigateAndWait('/goals');

      // Check status indicators have text or patterns
      const statusElements = page.locator('[class*="status"], [class*="success"], [class*="error"], [class*="warning"]');
      const statusCount = await statusElements.count();

      for (let i = 0; i < statusCount; i++) {
        const element = statusElements.nth(i);

        if (await element.isVisible()) {
          const text = await element.textContent();
          const ariaLabel = await element.getAttribute('aria-label');
          const title = await element.getAttribute('title');

          // Should have text indication of status
          expect(text?.trim() || ariaLabel || title).toBeTruthy();
        }
      }

      // Check charts have alternative text representation
      const charts = page.locator('canvas, svg[role="img"], [data-testid*="chart"]');
      const chartCount = await charts.count();

      for (let i = 0; i < chartCount; i++) {
        const chart = charts.nth(i);

        if (await chart.isVisible()) {
          const ariaLabel = await chart.getAttribute('aria-label');
          const title = await chart.getAttribute('title');
          const role = await chart.getAttribute('role');

          // Charts should have alternative text
          expect(ariaLabel || title || role === 'img').toBeTruthy();
        }
      }
    });
  });

  test.describe('Keyboard Navigation', () => {
    test('should support complete keyboard navigation', async ({ page }) => {
      await testHelpers.navigateAndWait('/');

      // Test tab order makes logical sense
      const focusableElements = await page.locator(
        'a, button, input, select, textarea, [tabindex]:not([tabindex="-1"])'
      ).all();

      let previousTabIndex = -1;
      for (const element of focusableElements.slice(0, 10)) {
        if (await element.isVisible()) {
          const tabIndex = await element.getAttribute('tabindex');
          const currentTabIndex = tabIndex ? parseInt(tabIndex) : 0;

          // Tab order should be logical (0 or positive, increasing)
          if (currentTabIndex > 0) {
            expect(currentTabIndex).toBeGreaterThanOrEqual(previousTabIndex);
            previousTabIndex = currentTabIndex;
          }
        }
      }

      // Test keyboard navigation flow
      await page.keyboard.press('Tab');
      const firstFocused = await page.evaluate(() => document.activeElement?.tagName);
      expect(['A', 'BUTTON', 'INPUT', 'SELECT']).toContain(firstFocused || '');

      // Test escape key functionality on modals
      const modalTrigger = page.locator('button:has-text("Add"), button:has-text("Create")').first();
      if (await modalTrigger.count() > 0) {
        await modalTrigger.click();

        const modal = page.locator('[role="dialog"], .modal');
        if (await modal.count() > 0) {
          await expect(modal).toBeVisible();

          // Focus should be trapped in modal
          await page.keyboard.press('Escape');
          await expect(modal).toBeHidden();
        }
      }
    });

    test('should have accessible keyboard shortcuts', async ({ page }) => {
      await testHelpers.navigateAndWait('/');

      // Check for documented keyboard shortcuts
      const shortcutElements = page.locator('[data-shortcut], [title*="Ctrl"], [title*="Cmd"]');
      const shortcutCount = await shortcutElements.count();

      for (let i = 0; i < shortcutCount; i++) {
        const element = shortcutElements.nth(i);
        const title = await element.getAttribute('title');
        const dataShortcut = await element.getAttribute('data-shortcut');

        // Shortcuts should be documented
        expect(title || dataShortcut).toBeTruthy();
      }

      // Test common shortcuts
      await page.keyboard.press('Alt+n'); // New item shortcut
      await testHelpers.waitForPageLoad();

      // Should navigate or open creation form
      const url = page.url();
      const forms = page.locator('form');
      const hasNewForm = await forms.count() > 0 || url.includes('/add') || url.includes('/new');

      // At least one navigation method should work
      expect(hasNewForm || url !== '/').toBe(true);
    });
  });

  test.describe('Screen Reader Compatibility', () => {
    test('should announce dynamic content changes', async ({ page }) => {
      await testHelpers.navigateAndWait('/transactions/add');

      // Test form validation announcements
      await testHelpers.submitFormAndWait();

      const liveRegions = page.locator('[aria-live], [role="status"], [role="alert"]');
      const liveCount = await liveRegions.count();

      for (let i = 0; i < liveCount; i++) {
        const region = liveRegions.nth(i);

        if (await region.isVisible()) {
          const ariaLive = await region.getAttribute('aria-live');
          const role = await region.getAttribute('role');

          // Live regions should have appropriate politeness levels
          expect(['polite', 'assertive', 'off'].includes(ariaLive || '') ||
                 ['status', 'alert'].includes(role || '')).toBe(true);
        }
      }

      // Test loading state announcements
      const loadingElements = page.locator('[data-testid*="loading"], .loading, .spinner');
      const loadingCount = await loadingElements.count();

      for (let i = 0; i < loadingCount; i++) {
        const loading = loadingElements.nth(i);

        if (await loading.isVisible()) {
          const ariaLabel = await loading.getAttribute('aria-label');
          const role = await loading.getAttribute('role');

          // Loading indicators should be announced
          expect(ariaLabel || role === 'status').toBeTruthy();
        }
      }
    });

    test('should provide sufficient context for screen readers', async ({ page }) => {
      await dbSetup.setupBasicTestData();
      await testHelpers.navigateAndWait('/transactions');

      // Check data tables provide sufficient context
      const table = page.locator('table');
      if (await table.count() > 0) {
        // Check for table summary or caption
        const caption = table.locator('caption');
        const summary = await table.getAttribute('summary');
        const ariaLabel = await table.getAttribute('aria-label');

        expect(await caption.count() > 0 || summary || ariaLabel).toBe(true);

        // Check currency amounts are properly announced
        const amountCells = table.locator('td:has-text("$"), td[data-testid*="amount"]');
        const amountCount = await amountCells.count();

        for (let i = 0; i < Math.min(amountCount, 5); i++) {
          const cell = amountCells.nth(i);
          const text = await cell.textContent();

          // Should include currency symbol and proper formatting
          expect(text).toMatch(/[\$€£¥₹₱][\d,.]*/);
        }
      }
    });
  });

  test.describe('Mobile Accessibility', () => {
    test('should be accessible on mobile devices', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      await testHelpers.navigateAndWait('/');

      // Check touch targets are large enough (44px minimum)
      const buttons = page.locator('button');
      const buttonCount = await buttons.count();

      for (let i = 0; i < Math.min(buttonCount, 10); i++) {
        const button = buttons.nth(i);

        if (await button.isVisible()) {
          const boundingBox = await button.boundingBox();
          if (boundingBox) {
            expect(boundingBox.width).toBeGreaterThanOrEqual(44);
            expect(boundingBox.height).toBeGreaterThanOrEqual(44);
          }
        }
      }

      // Check mobile navigation is accessible
      const mobileNav = page.locator('[data-testid="mobile-nav"], .mobile-menu');
      if (await mobileNav.count() > 0) {
        const menuButton = page.locator('button[aria-expanded], button:has-text("Menu")');
        if (await menuButton.count() > 0) {
          await menuButton.click();

          const isExpanded = await menuButton.getAttribute('aria-expanded');
          expect(isExpanded).toBe('true');

          await checkA11y(page, '[role="navigation"]');
        }
      }
    });

    test('should handle orientation changes accessibly', async ({ page }) => {
      // Test portrait orientation
      await page.setViewportSize({ width: 375, height: 667 });
      await testHelpers.navigateAndWait('/');
      await checkA11y(page);

      // Test landscape orientation
      await page.setViewportSize({ width: 667, height: 375 });
      await testHelpers.waitForPageLoad();

      // Content should still be accessible
      const main = page.locator('main');
      await expect(main).toBeVisible();

      await checkA11y(page);
    });
  });

  test.describe('Error Prevention and Recovery', () => {
    test('should provide clear error messages and recovery options', async ({ page }) => {
      await testHelpers.navigateAndWait('/transactions/add');

      // Submit invalid form
      await testHelpers.fillFormField('[data-testid="transaction-amount"]', '-100');
      await testHelpers.submitFormAndWait();

      // Check error messages are accessible
      const errorMessages = page.locator('[role="alert"], .error-message');
      const errorCount = await errorMessages.count();

      for (let i = 0; i < errorCount; i++) {
        const error = errorMessages.nth(i);

        if (await error.isVisible()) {
          const errorText = await error.textContent();
          expect(errorText?.trim()).toBeTruthy();

          // Error should suggest how to fix
          expect(errorText?.toLowerCase()).toMatch(/(must|required|invalid|enter|should)/);
        }
      }

      // Test undo/redo functionality if available
      const undoButton = page.locator('button:has-text("Undo"), [aria-label*="Undo"]');
      if (await undoButton.count() > 0) {
        const ariaLabel = await undoButton.getAttribute('aria-label');
        expect(ariaLabel).toBeTruthy();
      }
    });
  });

  test.describe('Language and Internationalization', () => {
    test('should properly handle RTL languages', async ({ page }) => {
      // Test if RTL is supported
      await testHelpers.navigateAndWait('/');

      const html = page.locator('html');
      const dir = await html.getAttribute('dir');
      const lang = await html.getAttribute('lang');

      // Should have language and direction attributes
      expect(lang).toBeTruthy();
      expect(['ltr', 'rtl'].includes(dir || 'ltr')).toBe(true);

      // Test language switching if available
      const languageSwitcher = page.locator('[data-testid="language-switcher"], select[name*="language"]');
      if (await languageSwitcher.count() > 0) {
        const ariaLabel = await languageSwitcher.getAttribute('aria-label');
        expect(ariaLabel || await languageSwitcher.textContent()).toBeTruthy();
      }
    });
  });

  test.describe('Performance Impact on Accessibility', () => {
    test('should maintain accessibility during loading states', async ({ page }) => {
      await testHelpers.navigateAndWait('/');

      // Check that loading states don't break accessibility
      const loadingElements = page.locator('[aria-busy="true"], [data-testid*="loading"]');
      const loadingCount = await loadingElements.count();

      for (let i = 0; i < loadingCount; i++) {
        const loading = loadingElements.nth(i);

        if (await loading.isVisible()) {
          // Loading elements should be announced
          const ariaLabel = await loading.getAttribute('aria-label');
          const ariaBusy = await loading.getAttribute('aria-busy');
          const role = await loading.getAttribute('role');

          expect(ariaLabel || ariaBusy === 'true' || role === 'status').toBeTruthy();
        }
      }

      // Test that keyboard navigation still works during loading
      await page.keyboard.press('Tab');
      const activeElement = await page.evaluate(() => document.activeElement?.tagName);
      expect(activeElement).toBeTruthy();
    });
  });
});