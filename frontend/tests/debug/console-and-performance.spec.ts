import { test, expect, Page, ConsoleMessage } from '@playwright/test';

interface PerformanceMetrics {
  loadTime: number;
  firstContentfulPaint: number;
  largestContentfulPaint: number;
  cumulativeLayoutShift: number;
  firstInputDelay: number;
  timeToInteractive: number;
  totalBlockingTime: number;
}

interface NetworkRequest {
  url: string;
  method: string;
  status: number;
  responseTime: number;
  size: number;
  resourceType: string;
}

interface ConsoleError {
  type: string;
  text: string;
  location: string;
  timestamp: number;
}

test.describe('Console Errors and Performance Investigation', () => {
  let consoleLogs: ConsoleMessage[] = [];
  let consoleErrors: ConsoleError[] = [];
  let networkRequests: NetworkRequest[] = [];
  let performanceMetrics: PerformanceMetrics;

  test.beforeEach(async ({ page }) => {
    // Clear previous data
    consoleLogs = [];
    consoleErrors = [];
    networkRequests = [];

    // Listen to console messages
    page.on('console', (msg) => {
      consoleLogs.push(msg);

      if (msg.type() === 'error' || msg.type() === 'warning') {
        consoleErrors.push({
          type: msg.type(),
          text: msg.text(),
          location: msg.location().url || 'unknown',
          timestamp: Date.now()
        });
      }
    });

    // Listen to page errors
    page.on('pageerror', (error) => {
      consoleErrors.push({
        type: 'pageerror',
        text: error.message,
        location: error.stack || 'unknown',
        timestamp: Date.now()
      });
    });

    // Listen to failed requests
    page.on('requestfailed', (request) => {
      console.log('Failed request:', request.url(), request.failure()?.errorText);
    });

    // Monitor network requests
    page.on('response', async (response) => {
      try {
        const request = response.request();
        const timing = response.request().timing();

        networkRequests.push({
          url: response.url(),
          method: request.method(),
          status: response.status(),
          responseTime: timing ? (timing.responseEnd - timing.requestStart) : 0,
          size: parseInt(response.headers()['content-length'] || '0'),
          resourceType: request.resourceType()
        });
      } catch (error) {
        // Ignore errors from accessing response details
      }
    });
  });

  test('Investigate Dashboard Console Errors and Performance', async ({ page }) => {
    console.log('🔍 Starting Dashboard Investigation...');

    // Navigate to the dashboard and measure performance
    const startTime = Date.now();

    await page.goto('/', { waitUntil: 'networkidle' });

    const endTime = Date.now();
    const pageLoadTime = endTime - startTime;

    console.log(`📊 Page Load Time: ${pageLoadTime}ms`);

    // Take screenshot of current state
    await page.screenshot({
      path: 'test-results/dashboard-current-state.png',
      fullPage: true
    });

    // Get Web Vitals and performance metrics
    performanceMetrics = await page.evaluate(() => {
      return new Promise((resolve) => {
        // Get basic performance timing
        const perfData = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;

        // Try to get Web Vitals if available
        const metrics: any = {
          loadTime: perfData.loadEventEnd - perfData.navigationStart,
          firstContentfulPaint: 0,
          largestContentfulPaint: 0,
          cumulativeLayoutShift: 0,
          firstInputDelay: 0,
          timeToInteractive: perfData.domInteractive - perfData.navigationStart,
          totalBlockingTime: 0
        };

        // Get paint metrics
        const paintEntries = performance.getEntriesByType('paint');
        paintEntries.forEach((entry) => {
          if (entry.name === 'first-contentful-paint') {
            metrics.firstContentfulPaint = entry.startTime;
          }
        });

        // Get LCP if available
        try {
          new PerformanceObserver((list) => {
            const entries = list.getEntries();
            entries.forEach((entry: any) => {
              if (entry.entryType === 'largest-contentful-paint') {
                metrics.largestContentfulPaint = entry.startTime;
              }
            });
          }).observe({ entryTypes: ['largest-contentful-paint'] });
        } catch (e) {
          // LCP not supported
        }

        setTimeout(() => resolve(metrics), 1000);
      });
    });

    console.log('🎯 Performance Metrics:', performanceMetrics);

    // Wait for any async operations to complete
    await page.waitForTimeout(3000);

    // Test key dashboard elements and interactions
    console.log('🧪 Testing Dashboard Elements...');

    // Check if main dashboard components are present
    const dashboardElements = [
      '[data-testid="total-balance"]',
      '[data-testid="monthly-spending"]',
      '[data-testid="savings-rate"]',
      '[data-testid="fire-progress"]',
      '.recharts-responsive-container', // Charts
      'nav', // Navigation
    ];

    for (const selector of dashboardElements) {
      try {
        const element = await page.locator(selector).first();
        const isVisible = await element.isVisible({ timeout: 5000 });
        console.log(`✅ ${selector}: ${isVisible ? 'Visible' : 'Not visible'}`);
      } catch (error) {
        console.log(`❌ ${selector}: Error - ${error.message}`);
      }
    }

    // Test navigation performance
    console.log('🔄 Testing Navigation Performance...');

    const navigationTests = [
      '/transactions',
      '/portfolio',
      '/budgets',
      '/goals',
      '/' // Back to dashboard
    ];

    for (const route of navigationTests) {
      try {
        const navStart = Date.now();
        await page.goto(route, { waitUntil: 'networkidle', timeout: 10000 });
        const navEnd = Date.now();
        console.log(`📍 ${route}: ${navEnd - navStart}ms`);

        // Take screenshot of each page
        await page.screenshot({
          path: `test-results/${route.replace('/', '') || 'dashboard'}-page.png`
        });

        await page.waitForTimeout(1000);
      } catch (error) {
        console.log(`❌ Navigation to ${route} failed: ${error.message}`);
      }
    }

    // Analyze console errors
    console.log('🚨 Console Error Analysis:');
    if (consoleErrors.length === 0) {
      console.log('✅ No console errors found!');
    } else {
      consoleErrors.forEach((error, index) => {
        console.log(`❌ Error ${index + 1}:`);
        console.log(`   Type: ${error.type}`);
        console.log(`   Message: ${error.text}`);
        console.log(`   Location: ${error.location}`);
        console.log(`   Time: ${new Date(error.timestamp).toISOString()}`);
      });
    }

    // Analyze network requests
    console.log('🌐 Network Request Analysis:');
    const slowRequests = networkRequests.filter(req => req.responseTime > 1000);
    const failedRequests = networkRequests.filter(req => req.status >= 400);

    console.log(`📊 Total Requests: ${networkRequests.length}`);
    console.log(`⚠️  Slow Requests (>1s): ${slowRequests.length}`);
    console.log(`❌ Failed Requests: ${failedRequests.length}`);

    if (slowRequests.length > 0) {
      console.log('🐌 Slow Requests:');
      slowRequests.forEach(req => {
        console.log(`   ${req.method} ${req.url} - ${req.responseTime}ms`);
      });
    }

    if (failedRequests.length > 0) {
      console.log('💥 Failed Requests:');
      failedRequests.forEach(req => {
        console.log(`   ${req.method} ${req.url} - Status: ${req.status}`);
      });
    }

    // Check for accessibility issues that might impact performance
    console.log('♿ Accessibility Performance Check...');
    try {
      await page.addScriptTag({
        url: 'https://unpkg.com/axe-core@4.8.2/axe.min.js'
      });

      const accessibilityResults = await page.evaluate(() => {
        return new Promise((resolve) => {
          (window as any).axe.run((err: any, results: any) => {
            if (err) {
              resolve({ error: err.message });
            } else {
              resolve({
                violations: results.violations.length,
                passes: results.passes.length,
                incomplete: results.incomplete.length
              });
            }
          });
        });
      });

      console.log('♿ Accessibility Results:', accessibilityResults);
    } catch (error) {
      console.log('⚠️  Could not run accessibility check:', error.message);
    }

    // Memory usage check
    console.log('🧠 Memory Usage Check...');
    const memoryInfo = await page.evaluate(() => {
      const perf = (performance as any);
      return {
        usedJSHeapSize: perf.memory?.usedJSHeapSize || 0,
        totalJSHeapSize: perf.memory?.totalJSHeapSize || 0,
        jsHeapSizeLimit: perf.memory?.jsHeapSizeLimit || 0
      };
    });

    if (memoryInfo.usedJSHeapSize > 0) {
      console.log(`🧠 Memory Usage: ${(memoryInfo.usedJSHeapSize / 1024 / 1024).toFixed(2)}MB`);
      console.log(`🧠 Total Heap: ${(memoryInfo.totalJSHeapSize / 1024 / 1024).toFixed(2)}MB`);
    }

    // Create comprehensive report
    const report = {
      timestamp: new Date().toISOString(),
      performanceMetrics,
      consoleErrors: consoleErrors.length,
      networkRequests: networkRequests.length,
      slowRequests: slowRequests.length,
      failedRequests: failedRequests.length,
      pageLoadTime,
      memoryUsage: memoryInfo
    };

    console.log('\n📋 COMPREHENSIVE REPORT:');
    console.log('========================');
    console.log(JSON.stringify(report, null, 2));

    // Assertions for critical issues
    expect(consoleErrors.filter(e => e.type === 'error').length).toBe(0);
    expect(failedRequests.filter(r => r.url.includes('localhost')).length).toBe(0);
    expect(pageLoadTime).toBeLessThan(5000); // Page should load within 5 seconds
  });

  test('Test Mobile Performance and Console Errors', async ({ page }) => {
    console.log('📱 Starting Mobile Investigation...');

    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });

    const startTime = Date.now();
    await page.goto('/', { waitUntil: 'networkidle' });
    const endTime = Date.now();

    console.log(`📱 Mobile Load Time: ${endTime - startTime}ms`);

    // Take mobile screenshot
    await page.screenshot({
      path: 'test-results/mobile-dashboard.png',
      fullPage: true
    });

    // Test mobile-specific interactions
    console.log('👆 Testing Mobile Interactions...');

    try {
      // Test touch interactions
      await page.touchscreen.tap(50, 100);
      await page.waitForTimeout(500);

      // Test swipe gesture if any
      await page.touchscreen.tap(200, 300);
      await page.waitForTimeout(500);

    } catch (error) {
      console.log('⚠️  Mobile interaction test failed:', error.message);
    }

    // Mobile-specific console error check
    console.log('📱 Mobile Console Errors:', consoleErrors.length);

    expect(consoleErrors.filter(e => e.type === 'error').length).toBe(0);
  });

  test.afterEach(async () => {
    // Save detailed logs to file
    const logData = {
      timestamp: new Date().toISOString(),
      consoleLogs: consoleLogs.map(log => ({
        type: log.type(),
        text: log.text(),
        location: log.location()
      })),
      consoleErrors,
      networkRequests,
      performanceMetrics
    };

    await require('fs').promises.writeFile(
      'test-results/debug-logs.json',
      JSON.stringify(logData, null, 2)
    ).catch(() => {
      // Ignore file write errors
    });
  });
});