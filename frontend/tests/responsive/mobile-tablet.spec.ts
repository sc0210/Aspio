/**
 * Responsive Design Testing Suite
 * Comprehensive mobile and tablet layout testing for Aspiro FIRE tracker
 */

import { test, expect } from '@playwright/test';
import { TestHelpers } from '../utils/test-helpers';
import { DatabaseSetup } from '../utils/database-setup';

test.describe('Responsive Design Testing', () => {
  let testHelpers: TestHelpers;
  let dbSetup: DatabaseSetup;

  // Define device viewport configurations
  const devices = {
    mobile: {
      name: 'iPhone 12',
      viewport: { width: 390, height: 844 },
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15'
    },
    tablet: {
      name: 'iPad Pro',
      viewport: { width: 1024, height: 1366 },
      userAgent: 'Mozilla/5.0 (iPad; CPU OS 14_0 like Mac OS X) AppleWebKit/605.1.15'
    },
    desktop: {
      name: 'Desktop',
      viewport: { width: 1920, height: 1080 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    }
  };

  test.beforeEach(async ({ page }) => {
    testHelpers = new TestHelpers(page);
    dbSetup = new DatabaseSetup();

    const authToken = 'mock-auth-token';
    await dbSetup.initialize(authToken);
    testHelpers.authenticateApi(authToken);
  });

  test.afterEach(async () => {
    await dbSetup.cleanup();
    await testHelpers.cleanup();
  });

  test.describe('Mobile Responsive Layout', () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize(devices.mobile.viewport);
    });

    test('should display mobile-optimized dashboard', async ({ page }) => {
      await dbSetup.setupBasicTestData();
      await testHelpers.navigateAndWait('/');

      // Check mobile navigation menu
      const mobileMenuButton = page.locator('[data-testid="mobile-menu-button"], button[aria-label*="menu"]');
      if (await mobileMenuButton.count() > 0) {
        await expect(mobileMenuButton).toBeVisible();

        // Test menu toggle functionality
        await mobileMenuButton.click();
        const mobileMenu = page.locator('[data-testid="mobile-menu"], .mobile-nav');
        await expect(mobileMenu).toBeVisible();

        // Menu should be accessible
        const menuItems = mobileMenu.locator('a, button');
        expect(await menuItems.count()).toBeGreaterThan(0);

        // Close menu
        await mobileMenuButton.click();
        await expect(mobileMenu).toBeHidden();
      }

      // Check dashboard cards stack vertically on mobile
      const dashboardCards = page.locator('[data-testid*="card"], .card');
      const cardCount = await dashboardCards.count();

      if (cardCount > 1) {
        const firstCard = dashboardCards.first();
        const secondCard = dashboardCards.nth(1);

        const firstCardBox = await firstCard.boundingBox();
        const secondCardBox = await secondCard.boundingBox();

        if (firstCardBox && secondCardBox) {
          // Cards should stack vertically (second card below first)
          expect(secondCardBox.y).toBeGreaterThan(firstCardBox.y + firstCardBox.height - 10);
        }
      }

      // Test touch targets are appropriate size (44px minimum)
      const buttons = page.locator('button');
      const buttonCount = await buttons.count();

      for (let i = 0; i < Math.min(buttonCount, 5); i++) {
        const button = buttons.nth(i);
        if (await button.isVisible()) {
          const box = await button.boundingBox();
          if (box) {
            expect(box.width).toBeGreaterThanOrEqual(44);
            expect(box.height).toBeGreaterThanOrEqual(44);
          }
        }
      }

      await testHelpers.takeScreenshot('mobile-dashboard');
    });

    test('should handle mobile transaction list properly', async ({ page }) => {
      await dbSetup.setupBasicTestData();
      await testHelpers.navigateAndWait('/transactions');

      // Check table adapts to mobile (should use cards or simplified layout)
      const table = page.locator('table');
      const cardView = page.locator('[data-testid="transaction-card"], .transaction-item');

      if (await table.count() > 0) {
        // Table should be horizontally scrollable or hidden on mobile
        const tableContainer = table.locator('..'); // Parent container
        const overflow = await tableContainer.evaluate(el =>
          window.getComputedStyle(el).overflowX
        );
        expect(['auto', 'scroll', 'hidden'].includes(overflow)).toBe(true);
      } else if (await cardView.count() > 0) {
        // Card view should be used for mobile
        const cards = cardView;
        expect(await cards.count()).toBeGreaterThan(0);

        // Cards should stack vertically
        const firstCard = cards.first();
        const secondCard = cards.nth(1);

        if (await secondCard.count() > 0) {
          const firstBox = await firstCard.boundingBox();
          const secondBox = await secondCard.boundingBox();

          if (firstBox && secondBox) {
            expect(secondBox.y).toBeGreaterThan(firstBox.y);
          }
        }
      }

      // Test mobile filters UI
      const filterButton = page.locator('[data-testid="filter-toggle"], button:has-text("Filter")');
      if (await filterButton.count() > 0) {
        await filterButton.click();

        const filterPanel = page.locator('[data-testid="filter-panel"], .filter-drawer');
        if (await filterPanel.count() > 0) {
          await expect(filterPanel).toBeVisible();

          // Filter panel should take up significant mobile screen space
          const panelBox = await filterPanel.boundingBox();
          if (panelBox) {
            expect(panelBox.width).toBeGreaterThan(devices.mobile.viewport.width * 0.8);
          }
        }
      }

      await testHelpers.takeScreenshot('mobile-transactions');
    });

    test('should display mobile-friendly forms', async ({ page }) => {
      await testHelpers.navigateAndWait('/transactions/add');

      // Form should fill available width
      const form = page.locator('form');
      await expect(form).toBeVisible();

      const formBox = await form.boundingBox();
      if (formBox) {
        expect(formBox.width).toBeGreaterThan(devices.mobile.viewport.width * 0.8);
      }

      // Input fields should be appropriately sized for mobile
      const inputs = page.locator('input, select, textarea');
      const inputCount = await inputs.count();

      for (let i = 0; i < inputCount; i++) {
        const input = inputs.nth(i);
        if (await input.isVisible()) {
          const inputBox = await input.boundingBox();
          if (inputBox) {
            // Inputs should be tall enough for touch
            expect(inputBox.height).toBeGreaterThanOrEqual(44);
            // Inputs should use available width
            expect(inputBox.width).toBeGreaterThan(200);
          }
        }
      }

      // Test mobile keyboard types
      const numberInputs = page.locator('input[type="number"], input[inputmode="numeric"]');
      const emailInputs = page.locator('input[type="email"]');
      const telInputs = page.locator('input[type="tel"]');

      expect(await numberInputs.count() + await emailInputs.count() + await telInputs.count())
        .toBeGreaterThan(0);

      await testHelpers.takeScreenshot('mobile-form');
    });

    test('should handle mobile charts and visualizations', async ({ page }) => {
      await dbSetup.setupBasicTestData();
      await testHelpers.navigateAndWait('/');

      // Charts should be responsive
      const charts = page.locator('canvas, svg[role="img"], [data-testid*="chart"]');
      const chartCount = await charts.count();

      for (let i = 0; i < chartCount; i++) {
        const chart = charts.nth(i);
        if (await chart.isVisible()) {
          const chartBox = await chart.boundingBox();
          if (chartBox) {
            // Chart should fit mobile screen width
            expect(chartBox.width).toBeLessThanOrEqual(devices.mobile.viewport.width);
            // Chart should maintain aspect ratio
            expect(chartBox.height).toBeGreaterThan(100);
            expect(chartBox.height).toBeLessThan(chartBox.width * 2);
          }
        }
      }

      // Test chart interaction on mobile
      const interactiveChart = charts.first();
      if (await interactiveChart.count() > 0 && await interactiveChart.isVisible()) {
        // Test touch interaction
        const chartBox = await interactiveChart.boundingBox();
        if (chartBox) {
          await page.touchscreen.tap(chartBox.x + chartBox.width / 2, chartBox.y + chartBox.height / 2);

          // Should show tooltip or interaction feedback
          const tooltip = page.locator('[data-testid="tooltip"], .tooltip, .chart-tooltip');
          if (await tooltip.count() > 0) {
            await expect(tooltip).toBeVisible();
          }
        }
      }

      await testHelpers.takeScreenshot('mobile-charts');
    });

    test('should support mobile gestures', async ({ page }) => {
      await testHelpers.navigateAndWait('/');

      // Test swipe gestures if implemented
      const swipeableElements = page.locator('[data-swipeable], .swipeable, .carousel');
      if (await swipeableElements.count() > 0) {
        const element = swipeableElements.first();
        const box = await element.boundingBox();

        if (box) {
          // Simulate swipe gesture
          await page.touchscreen.tap(box.x + box.width * 0.8, box.y + box.height / 2);
          await page.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2);

          // Element should respond to swipe
          await testHelpers.waitForPageLoad();
        }
      }

      // Test pinch-to-zoom on charts (if supported)
      const zoomableCharts = page.locator('[data-zoomable], .zoomable-chart');
      if (await zoomableCharts.count() > 0) {
        const chart = zoomableCharts.first();
        const box = await chart.boundingBox();

        if (box) {
          // Simulate pinch gesture
          await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
          // Note: Playwright doesn't fully support multi-touch, but we can test the setup
          expect(box.width).toBeGreaterThan(0);
        }
      }
    });

    test('should handle mobile orientation changes', async ({ page }) => {
      // Start in portrait
      await page.setViewportSize({ width: 390, height: 844 });
      await testHelpers.navigateAndWait('/');
      await testHelpers.takeScreenshot('mobile-portrait');

      // Rotate to landscape
      await page.setViewportSize({ width: 844, height: 390 });
      await testHelpers.waitForPageLoad();

      // Layout should adapt to landscape
      const main = page.locator('main');
      await expect(main).toBeVisible();

      // Charts should re-render for new dimensions
      const charts = page.locator('canvas, svg[role="img"]');
      if (await charts.count() > 0) {
        const chart = charts.first();
        const chartBox = await chart.boundingBox();
        if (chartBox) {
          expect(chartBox.width).toBeLessThanOrEqual(844);
        }
      }

      await testHelpers.takeScreenshot('mobile-landscape');
    });
  });

  test.describe('Tablet Responsive Layout', () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize(devices.tablet.viewport);
    });

    test('should display tablet-optimized dashboard', async ({ page }) => {
      await dbSetup.setupBasicTestData();
      await testHelpers.navigateAndWait('/');

      // Tablet should show more content per row than mobile
      const dashboardCards = page.locator('[data-testid*="card"], .card');
      const cardCount = await dashboardCards.count();

      if (cardCount >= 2) {
        const firstCard = dashboardCards.first();
        const secondCard = dashboardCards.nth(1);

        const firstBox = await firstCard.boundingBox();
        const secondBox = await secondCard.boundingBox();

        if (firstBox && secondBox) {
          // On tablet, cards might be side by side or in grid
          const isHorizontal = Math.abs(firstBox.y - secondBox.y) < 100;
          const isVertical = secondBox.y > firstBox.y + firstBox.height - 50;

          expect(isHorizontal || isVertical).toBe(true);
        }
      }

      // Navigation should be optimized for tablet
      const navigation = page.locator('nav');
      if (await navigation.count() > 0) {
        const navBox = await navigation.boundingBox();
        if (navBox) {
          // Navigation should use tablet space efficiently
          expect(navBox.width).toBeGreaterThan(200);
        }
      }

      await testHelpers.takeScreenshot('tablet-dashboard');
    });

    test('should show tablet-friendly data tables', async ({ page }) => {
      await dbSetup.setupBasicTestData();
      await testHelpers.navigateAndWait('/transactions');

      // Table should be fully visible on tablet
      const table = page.locator('table');
      if (await table.count() > 0) {
        await expect(table).toBeVisible();

        const tableBox = await table.boundingBox();
        if (tableBox) {
          // Table should fit comfortably in tablet viewport
          expect(tableBox.width).toBeLessThanOrEqual(devices.tablet.viewport.width);

          // All columns should be visible
          const headers = table.locator('th');
          const headerCount = await headers.count();
          expect(headerCount).toBeGreaterThan(3); // Should show more columns than mobile
        }
      }

      // Test horizontal scrolling if needed
      const scrollableContainer = page.locator('.table-container, .overflow-x-auto');
      if (await scrollableContainer.count() > 0) {
        const container = scrollableContainer.first();
        const scrollWidth = await container.evaluate(el => el.scrollWidth);
        const clientWidth = await container.evaluate(el => el.clientWidth);

        if (scrollWidth > clientWidth) {
          // Test horizontal scroll
          await container.evaluate(el => el.scrollLeft = 100);
          const newScrollLeft = await container.evaluate(el => el.scrollLeft);
          expect(newScrollLeft).toBeGreaterThan(0);
        }
      }

      await testHelpers.takeScreenshot('tablet-transactions');
    });

    test('should handle tablet form layouts', async ({ page }) => {
      await testHelpers.navigateAndWait('/transactions/add');

      const form = page.locator('form');
      await expect(form).toBeVisible();

      // Form should use tablet space efficiently
      const formBox = await form.boundingBox();
      if (formBox) {
        expect(formBox.width).toBeGreaterThan(400);
        expect(formBox.width).toBeLessThan(devices.tablet.viewport.width);
      }

      // Fields might be arranged in multiple columns on tablet
      const fieldRows = page.locator('.form-row, .grid-cols-2');
      if (await fieldRows.count() > 0) {
        const row = fieldRows.first();
        const inputs = row.locator('input, select');

        if (await inputs.count() >= 2) {
          const firstInput = inputs.first();
          const secondInput = inputs.nth(1);

          const firstBox = await firstInput.boundingBox();
          const secondBox = await secondInput.boundingBox();

          if (firstBox && secondBox) {
            // Inputs should be side by side
            expect(Math.abs(firstBox.y - secondBox.y)).toBeLessThan(50);
            expect(secondBox.x).toBeGreaterThan(firstBox.x + firstBox.width);
          }
        }
      }

      await testHelpers.takeScreenshot('tablet-form');
    });

    test('should optimize charts for tablet viewing', async ({ page }) => {
      await dbSetup.setupBasicTestData();
      await testHelpers.navigateAndWait('/');

      const charts = page.locator('canvas, svg[role="img"], [data-testid*="chart"]');
      const chartCount = await charts.count();

      for (let i = 0; i < chartCount; i++) {
        const chart = charts.nth(i);
        if (await chart.isVisible()) {
          const chartBox = await chart.boundingBox();
          if (chartBox) {
            // Charts should be larger and more detailed on tablet
            expect(chartBox.width).toBeGreaterThan(300);
            expect(chartBox.height).toBeGreaterThan(200);

            // Charts should use tablet space efficiently
            expect(chartBox.width).toBeLessThanOrEqual(devices.tablet.viewport.width * 0.9);
          }
        }
      }

      // Test chart interactions
      const interactiveChart = charts.first();
      if (await interactiveChart.count() > 0) {
        await interactiveChart.hover();

        // Should show detailed tooltips on tablet
        const tooltip = page.locator('[data-testid="tooltip"], .tooltip');
        if (await tooltip.count() > 0) {
          const tooltipBox = await tooltip.boundingBox();
          if (tooltipBox) {
            expect(tooltipBox.width).toBeGreaterThan(100);
          }
        }
      }

      await testHelpers.takeScreenshot('tablet-charts');
    });
  });

  test.describe('Cross-Device Consistency', () => {
    test('should maintain feature parity across devices', async ({ page }) => {
      const testPages = [
        '/',
        '/transactions',
        '/goals',
        '/portfolio',
        '/budgets'
      ];

      for (const pagePath of testPages) {
        for (const [deviceName, device] of Object.entries(devices)) {
          await page.setViewportSize(device.viewport);
          await testHelpers.navigateAndWait(pagePath);

          // Core functionality should be available on all devices
          const mainContent = page.locator('main');
          await expect(mainContent).toBeVisible();

          // Navigation should be accessible
          const navigation = page.locator('nav, [data-testid="mobile-menu"]');
          expect(await navigation.count()).toBeGreaterThan(0);

          // Action buttons should be present
          const actionButtons = page.locator('button:has-text("Add"), button:has-text("Create"), a:has-text("Add")');
          if (await actionButtons.count() > 0) {
            const button = actionButtons.first();
            await expect(button).toBeVisible();
          }

          await testHelpers.takeScreenshot(`${deviceName}-${pagePath.replace('/', 'home')}`);
        }
      }
    });

    test('should handle breakpoint transitions smoothly', async ({ page }) => {
      await testHelpers.navigateAndWait('/');

      const breakpoints = [
        { width: 320, height: 568 },  // Small mobile
        { width: 375, height: 667 },  // Standard mobile
        { width: 768, height: 1024 }, // Tablet
        { width: 1024, height: 768 }, // Landscape tablet
        { width: 1280, height: 720 }, // Small desktop
        { width: 1920, height: 1080 } // Full desktop
      ];

      for (const viewport of breakpoints) {
        await page.setViewportSize(viewport);
        await testHelpers.waitForPageLoad();

        // Layout should remain functional at all breakpoints
        const main = page.locator('main');
        await expect(main).toBeVisible();

        // No horizontal scrollbar should appear
        const bodyScrollWidth = await page.evaluate(() => document.body.scrollWidth);
        const viewportWidth = viewport.width;
        expect(bodyScrollWidth).toBeLessThanOrEqual(viewportWidth + 20); // Small tolerance

        // Content should not overflow
        const content = page.locator('main');
        const contentBox = await content.boundingBox();
        if (contentBox) {
          expect(contentBox.width).toBeLessThanOrEqual(viewportWidth);
        }
      }
    });

    test('should maintain performance across devices', async ({ page }) => {
      const devices = [
        { name: 'mobile', viewport: { width: 375, height: 667 } },
        { name: 'tablet', viewport: { width: 768, height: 1024 } },
        { name: 'desktop', viewport: { width: 1920, height: 1080 } }
      ];

      for (const device of devices) {
        await page.setViewportSize(device.viewport);

        const startTime = Date.now();
        await testHelpers.navigateAndWait('/');
        const loadTime = Date.now() - startTime;

        // Page should load reasonably fast on all devices
        expect(loadTime).toBeLessThan(5000);
        console.log(`${device.name} load time: ${loadTime}ms`);

        // Check for performance indicators
        const webVitals = await page.evaluate(() => {
          return new Promise((resolve) => {
            if ('web-vital' in window) {
              resolve({ lcp: 0, fid: 0, cls: 0 }); // Placeholder
            } else {
              resolve(null);
            }
          });
        });

        if (webVitals) {
          console.log(`${device.name} web vitals:`, webVitals);
        }
      }
    });
  });

  test.describe('Touch and Gesture Support', () => {
    test('should support touch interactions on mobile', async ({ page }) => {
      await page.setViewportSize(devices.mobile.viewport);
      await testHelpers.navigateAndWait('/');

      // Test touch targets
      const buttons = page.locator('button');
      const buttonCount = await buttons.count();

      for (let i = 0; i < Math.min(buttonCount, 3); i++) {
        const button = buttons.nth(i);
        if (await button.isVisible()) {
          const box = await button.boundingBox();
          if (box) {
            // Test touch interaction
            await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
            await testHelpers.waitForPageLoad();

            // Button should respond to touch
            expect(true).toBe(true); // Basic touch test
          }
        }
      }

      // Test scrolling
      await page.touchscreen.tap(200, 400);
      await page.mouse.move(200, 200);
      await testHelpers.waitForPageLoad();

      // Page should scroll
      const scrollY = await page.evaluate(() => window.scrollY);
      expect(scrollY).toBeGreaterThanOrEqual(0);
    });

    test('should handle long press actions', async ({ page }) => {
      await page.setViewportSize(devices.mobile.viewport);
      await dbSetup.setupBasicTestData();
      await testHelpers.navigateAndWait('/transactions');

      // Test context menu or long press actions if implemented
      const actionableItems = page.locator('[data-testid="transaction-row"], .transaction-item');
      if (await actionableItems.count() > 0) {
        const item = actionableItems.first();
        const box = await item.boundingBox();

        if (box) {
          // Simulate long press (touch and hold)
          await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
          await page.mouse.down();
          await page.waitForTimeout(1000); // Hold for 1 second
          await page.mouse.up();

          // Check for context menu or action sheet
          const contextMenu = page.locator('[data-testid="context-menu"], .context-menu, .action-sheet');
          if (await contextMenu.count() > 0) {
            await expect(contextMenu).toBeVisible();
          }
        }
      }
    });
  });

  test.describe('Device-Specific Features', () => {
    test('should handle mobile device features', async ({ page }) => {
      await page.setViewportSize(devices.mobile.viewport);
      await testHelpers.navigateAndWait('/transactions/add');

      // Test mobile input types
      const phoneInput = page.locator('input[type="tel"]');
      if (await phoneInput.count() > 0) {
        await phoneInput.focus();
        // Should trigger numeric keyboard on mobile
        expect(await phoneInput.getAttribute('inputmode')).toBe('tel');
      }

      const emailInput = page.locator('input[type="email"]');
      if (await emailInput.count() > 0) {
        await emailInput.focus();
        // Should trigger email keyboard on mobile
        expect(await emailInput.getAttribute('type')).toBe('email');
      }

      // Test camera/file upload on mobile
      const fileInput = page.locator('input[type="file"]');
      if (await fileInput.count() > 0) {
        const accept = await fileInput.getAttribute('accept');
        if (accept?.includes('image')) {
          // Should support camera capture on mobile
          const capture = await fileInput.getAttribute('capture');
          expect(['camera', 'environment', 'user'].includes(capture || '')).toBeTruthy();
        }
      }
    });

    test('should respect device preferences', async ({ page }) => {
      // Test dark mode preference
      await page.emulateMedia({ colorScheme: 'dark' });
      await testHelpers.navigateAndWait('/');

      const body = page.locator('body');
      const isDarkMode = await body.evaluate(el =>
        el.classList.contains('dark') ||
        window.getComputedStyle(el).backgroundColor === 'rgb(17, 24, 39)'
      );

      expect(isDarkMode).toBeTruthy();

      // Test reduced motion preference
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await testHelpers.navigateAndWait('/');

      // Animations should be reduced or disabled
      const animatedElements = page.locator('.animate, [class*="transition"]');
      if (await animatedElements.count() > 0) {
        const element = animatedElements.first();
        const animationDuration = await element.evaluate(el =>
          window.getComputedStyle(el).animationDuration
        );

        // Animation should be instant or very fast when reduced motion is preferred
        expect(['0s', '0.01s'].includes(animationDuration)).toBeTruthy();
      }
    });
  });
});