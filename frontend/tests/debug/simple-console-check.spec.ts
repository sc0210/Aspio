import { test, expect, Page, ConsoleMessage } from '@playwright/test';

interface ConsoleError {
  type: string;
  text: string;
  location: string;
  timestamp: string;
}

interface NetworkRequest {
  url: string;
  status: number;
  method: string;
  failed: boolean;
}

test.describe('Simple Console Error and Performance Check', () => {
  let consoleErrors: ConsoleError[] = [];
  let networkRequests: NetworkRequest[] = [];
  let performanceData: any = {};

  test.beforeEach(async ({ page }) => {
    consoleErrors = [];
    networkRequests = [];

    // Capture console messages
    page.on('console', (msg) => {
      if (msg.type() === 'error' || msg.type() === 'warning') {
        consoleErrors.push({
          type: msg.type(),
          text: msg.text(),
          location: msg.location().url || 'unknown',
          timestamp: new Date().toISOString()
        });
      }
    });

    // Capture page errors
    page.on('pageerror', (error) => {
      consoleErrors.push({
        type: 'pageerror',
        text: error.message,
        location: error.stack || 'unknown',
        timestamp: new Date().toISOString()
      });
    });

    // Capture network requests
    page.on('response', (response) => {
      networkRequests.push({
        url: response.url(),
        status: response.status(),
        method: response.request().method(),
        failed: response.status() >= 400
      });
    });

    page.on('requestfailed', (request) => {
      networkRequests.push({
        url: request.url(),
        status: 0,
        method: request.method(),
        failed: true
      });
    });
  });

  test('Basic Dashboard Console Check', async ({ page }) => {
    console.log('🚀 Starting basic console error investigation...');

    // Set a reasonable timeout and go to the page
    page.setDefaultTimeout(30000);

    const startTime = Date.now();

    try {
      await page.goto('http://localhost:3000/', {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      const loadTime = Date.now() - startTime;
      console.log(`📊 Initial load time: ${loadTime}ms`);

      // Take initial screenshot
      await page.screenshot({
        path: '/Users/samchen/Documents/Dev/Aspiro/frontend/test-results/dashboard-initial.png',
        fullPage: false
      });

      // Wait for the page to settle
      await page.waitForTimeout(3000);

      // Check for basic page elements
      const pageTitle = await page.title();
      console.log(`📋 Page title: ${pageTitle}`);

      // Check if basic UI elements exist
      const bodyExists = await page.locator('body').isVisible();
      const navExists = await page.locator('nav').count();
      const mainExists = await page.locator('main').count();

      console.log(`🎯 Page structure check:`);
      console.log(`   Body visible: ${bodyExists}`);
      console.log(`   Navigation elements: ${navExists}`);
      console.log(`   Main content areas: ${mainExists}`);

      // Get basic performance metrics
      performanceData = await page.evaluate(() => {
        const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
        return {
          domContentLoaded: navigation.domContentLoadedEventEnd - navigation.navigationStart,
          loadComplete: navigation.loadEventEnd - navigation.navigationStart,
          firstPaint: 0 // Will try to get this separately
        };
      });

      console.log(`⚡ Performance metrics:`, performanceData);

      // Report console errors
      console.log(`🚨 Console errors found: ${consoleErrors.length}`);
      if (consoleErrors.length > 0) {
        consoleErrors.forEach((error, index) => {
          console.log(`   ${index + 1}. [${error.type}] ${error.text}`);
          console.log(`      Location: ${error.location}`);
        });
      }

      // Report network issues
      const failedRequests = networkRequests.filter(req => req.failed);
      console.log(`🌐 Network requests: ${networkRequests.length} total, ${failedRequests.length} failed`);

      if (failedRequests.length > 0) {
        failedRequests.forEach((req, index) => {
          console.log(`   ${index + 1}. ${req.method} ${req.url} - Status: ${req.status}`);
        });
      }

      // Take final screenshot
      await page.screenshot({
        path: '/Users/samchen/Documents/Dev/Aspiro/frontend/test-results/dashboard-final.png',
        fullPage: true
      });

      // Basic functionality test - check if we can interact with the page
      try {
        const clickableElements = await page.locator('button, a, [role="button"]').count();
        console.log(`🖱️  Clickable elements found: ${clickableElements}`);

        if (clickableElements > 0) {
          // Try to click the first button/link
          const firstClickable = page.locator('button, a, [role="button"]').first();
          const isVisible = await firstClickable.isVisible();
          if (isVisible) {
            console.log(`✅ First clickable element is visible and ready for interaction`);
          }
        }
      } catch (error) {
        console.log(`⚠️  Interaction test failed: ${error.message}`);
      }

    } catch (error) {
      console.log(`❌ Test failed: ${error.message}`);

      // Take error screenshot
      await page.screenshot({
        path: '/Users/samchen/Documents/Dev/Aspiro/frontend/test-results/error-state.png'
      });
    }

    // Create a simple report
    const report = {
      timestamp: new Date().toISOString(),
      loadTime: Date.now() - startTime,
      consoleErrors: consoleErrors.length,
      networkRequests: networkRequests.length,
      failedRequests: networkRequests.filter(req => req.failed).length,
      performanceData,
      errors: consoleErrors,
      failedNetworkRequests: networkRequests.filter(req => req.failed)
    };

    console.log('\n📊 INVESTIGATION REPORT:');
    console.log('========================');
    console.log(JSON.stringify(report, null, 2));

    // Write report to file
    try {
      await require('fs').promises.writeFile(
        '/Users/samchen/Documents/Dev/Aspiro/frontend/test-results/console-investigation-report.json',
        JSON.stringify(report, null, 2)
      );
      console.log('📝 Report saved to test-results/console-investigation-report.json');
    } catch (writeError) {
      console.log('⚠️  Could not save report file');
    }

    // Basic assertions
    expect(consoleErrors.filter(e => e.type === 'error').length).toBeLessThanOrEqual(5);
    expect(networkRequests.filter(r => r.failed && r.url.includes('localhost')).length).toBe(0);
  });

  test('Mobile View Console Check', async ({ page }) => {
    console.log('📱 Checking mobile view...');

    await page.setViewportSize({ width: 375, height: 667 });

    const startTime = Date.now();
    await page.goto('http://localhost:3000/', {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });
    const loadTime = Date.now() - startTime;

    console.log(`📱 Mobile load time: ${loadTime}ms`);

    await page.screenshot({
      path: '/Users/samchen/Documents/Dev/Aspiro/frontend/test-results/mobile-view.png'
    });

    console.log(`📱 Mobile console errors: ${consoleErrors.length}`);

    expect(consoleErrors.filter(e => e.type === 'error').length).toBeLessThanOrEqual(5);
  });
});