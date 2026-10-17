import { test as setup, expect } from '@playwright/test';

const authFile = 'playwright/.auth/user.json';

setup('authenticate', async ({ page }) => {
  // Go to the sign-in page
  await page.goto('/auth/signin');
  
  // Wait for the page to load
  await page.waitForLoadState('networkidle');
  
  // Check if Google sign-in button exists
  const googleSignInButton = page.locator('button:has-text("Sign in with Google"), button:has-text("Continue with Google")');
  
  if (await googleSignInButton.count() > 0) {
    console.log('Google sign-in button found, but cannot automate OAuth flow');
    
    // For now, we'll create a mock authenticated state
    // In a real scenario, you would need to set up OAuth test credentials
    await page.context().addCookies([
      {
        name: 'next-auth.session-token',
        value: 'mock-session-token',
        domain: 'localhost',
        path: '/',
      }
    ]);
  }
  
  // Try demo mode if available
  const demoButton = page.locator('button:has-text("Try Demo"), button:has-text("Demo Mode")');
  if (await demoButton.count() > 0) {
    await demoButton.click();
    await page.waitForURL('/', { timeout: 10000 });
  }
  
  // Save signed-in state to 'authFile'
  await page.context().storageState({ path: authFile });
});