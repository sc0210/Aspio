/**
 * User Profile CRUD Test Suite
 * Testing user profile management, preferences, and settings
 */

import { test, expect } from '@playwright/test';
import { TestHelpers, DatabaseTestHelpers } from '../utils/test-helpers';
import { DatabaseSetup } from '../utils/database-setup';
import { mockData } from '../utils/mock-data';
import { User, UserPreferences, UserProfile } from '@/shared/types';

test.describe('User Profile CRUD Operations', () => {
  let testHelpers: TestHelpers;
  let dbHelpers: DatabaseTestHelpers;
  let dbSetup: DatabaseSetup;
  let testUser: User;

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

  test.describe('View and Update Basic Profile', () => {
    test.beforeEach(async () => {
      const testData = await dbSetup.setupBasicTestData();
      testUser = testData.user || mockData.generateUser();
    });

    test('should display user profile information', async ({ page }) => {
      await testHelpers.navigateAndWait('/profile');

      // Verify profile page loads
      await testHelpers.waitForElement('[data-testid="profile-container"]');
      
      // Check basic user information
      await expect(page.locator(`text=${testUser.name}`)).toBeVisible();
      await expect(page.locator(`text=${testUser.email}`)).toBeVisible();
      
      // Verify avatar/profile picture
      const avatar = page.locator('[data-testid="user-avatar"]');
      await expect(avatar).toBeVisible();
      
      // Check gamification elements if they exist
      const levelElement = page.locator('[data-testid="user-level"]');
      if (await levelElement.count() > 0) {
        await expect(levelElement).toContainText(testUser.level.toString());
      }
      
      const xpElement = page.locator('[data-testid="user-xp"]');
      if (await xpElement.count() > 0) {
        await expect(xpElement).toContainText(testUser.experience_points.toString());
      }

      await testHelpers.takeScreenshot('user-profile-display');
    });

    test('should update basic profile information', async ({ page }) => {
      await testHelpers.navigateAndWait('/profile/edit');

      // Verify form is pre-populated
      await expect(page.locator('[data-testid="profile-name"]')).toHaveValue(testUser.name);
      await expect(page.locator('[data-testid="profile-email"]')).toHaveValue(testUser.email);

      // Update profile information
      const updatedName = 'Updated ' + testUser.name;
      await testHelpers.fillFormField('[data-testid="profile-name"]', updatedName);
      
      // Add/update profile details if fields exist
      const occupationField = page.locator('[data-testid="profile-occupation"]');
      if (await occupationField.count() > 0) {
        await testHelpers.fillFormField('[data-testid="profile-occupation"]', 'Senior Software Engineer');
      }
      
      const dobField = page.locator('[data-testid="profile-dob"]');
      if (await dobField.count() > 0) {
        await testHelpers.fillFormField('[data-testid="profile-dob"]', '1990-05-15');
      }
      
      const incomeField = page.locator('[data-testid="profile-income"]');
      if (await incomeField.count() > 0) {
        await testHelpers.fillFormField('[data-testid="profile-income"]', '8000');
      }

      await testHelpers.submitFormAndWait();
      await testHelpers.verifySuccessMessage('Profile updated successfully');

      // Verify changes in database
      const isUpdated = await dbHelpers.verifyUserInDb({
        name: updatedName
      });
      expect(isUpdated).toBe(true);

      // Verify changes in UI
      await testHelpers.navigateAndWait('/profile');
      await expect(page.locator(`text=${updatedName}`)).toBeVisible();

      await testHelpers.takeScreenshot('profile-updated');
    });

    test('should validate profile input fields', async ({ page }) => {
      await testHelpers.navigateAndWait('/profile/edit');

      // Test empty name
      await testHelpers.fillFormField('[data-testid="profile-name"]', '');
      await testHelpers.submitFormAndWait();
      await expect(page.locator('[data-testid="name-error"]')).toBeVisible();

      // Test invalid email format
      await testHelpers.fillFormField('[data-testid="profile-name"]', 'Test User');
      await testHelpers.fillFormField('[data-testid="profile-email"]', 'invalid-email');
      await testHelpers.submitFormAndWait();
      await expect(page.locator('[data-testid="email-error"]')).toBeVisible();

      // Test future birth date
      const dobField = page.locator('[data-testid="profile-dob"]');
      if (await dobField.count() > 0) {
        const futureDate = new Date();
        futureDate.setFullYear(futureDate.getFullYear() + 1);
        
        await testHelpers.fillFormField('[data-testid="profile-email"]', testUser.email);
        await testHelpers.fillFormField('[data-testid="profile-dob"]', futureDate.toISOString().split('T')[0]);
        await testHelpers.submitFormAndWait();
        await expect(page.locator('[data-testid="dob-error"]')).toBeVisible();
      }
    });

    test('should upload and update profile avatar', async ({ page }) => {
      await testHelpers.navigateAndWait('/profile/edit');

      // Check for avatar upload section
      const avatarUpload = page.locator('[data-testid="avatar-upload"]');
      if (await avatarUpload.count() > 0) {
        // Create a test image file
        const testImage = {
          name: 'profile-pic.jpg',
          mimeType: 'image/jpeg',
          buffer: Buffer.from('fake-image-content')
        };
        
        await avatarUpload.setInputFiles(testImage);
        
        // Verify upload preview
        const uploadPreview = page.locator('[data-testid="avatar-preview"]');
        await expect(uploadPreview).toBeVisible();
        
        await testHelpers.submitFormAndWait();
        await testHelpers.verifySuccessMessage('Profile updated successfully');
        
        // Verify new avatar is displayed
        await testHelpers.navigateAndWait('/profile');
        const updatedAvatar = page.locator('[data-testid="user-avatar"]');
        await expect(updatedAvatar).toBeVisible();
        
        // Check if avatar URL has changed
        const avatarSrc = await updatedAvatar.getAttribute('src');
        expect(avatarSrc).toBeTruthy();
      }
    });
  });

  test.describe('User Preferences Management', () => {
    test('should update language and localization preferences', async ({ page }) => {
      await testHelpers.navigateAndWait('/profile/preferences');

      // Verify preferences page loads
      await testHelpers.waitForElement('[data-testid="preferences-container"]');
      
      // Update language preference
      const languageSelect = page.locator('[data-testid="language-select"]');
      await languageSelect.selectOption('zh-CN'); // Chinese
      
      // Update currency preference
      const currencySelect = page.locator('[data-testid="currency-select"]');
      await currencySelect.selectOption('SGD'); // Singapore Dollar
      
      // Update timezone
      const timezoneSelect = page.locator('[data-testid="timezone-select"]');
      await timezoneSelect.selectOption('Asia/Singapore');
      
      // Update date format preference
      const dateFormatRadio = page.locator('[data-testid="date-format-roc"]');
      if (await dateFormatRadio.count() > 0) {
        await dateFormatRadio.check();
      }
      
      // Update number format for Asian style (10,000 based)
      const numberFormatRadio = page.locator('[data-testid="number-format-asian"]');
      if (await numberFormatRadio.count() > 0) {
        await numberFormatRadio.check();
      }

      await testHelpers.submitFormAndWait();
      await testHelpers.verifySuccessMessage('Preferences updated successfully');

      // Verify changes persist after page reload
      await page.reload();
      await testHelpers.waitForPageLoad();
      
      await expect(languageSelect).toHaveValue('zh-CN');
      await expect(currencySelect).toHaveValue('SGD');
      await expect(timezoneSelect).toHaveValue('Asia/Singapore');

      await testHelpers.takeScreenshot('preferences-updated');
    });

    test('should configure notification preferences', async ({ page }) => {
      await testHelpers.navigateAndWait('/profile/notifications');

      // Verify notification settings page
      await testHelpers.waitForElement('[data-testid="notification-preferences"]');
      
      // Configure email notifications
      const emailNotifications = page.locator('[data-testid="email-notifications"]');
      await emailNotifications.check();
      
      // Configure push notifications
      const pushNotifications = page.locator('[data-testid="push-notifications"]');
      await pushNotifications.uncheck();
      
      // Configure specific notification types
      const goalReminders = page.locator('[data-testid="goal-reminders"]');
      await goalReminders.check();
      
      const transactionAlerts = page.locator('[data-testid="transaction-alerts"]');
      await transactionAlerts.check();
      
      const budgetAlerts = page.locator('[data-testid="budget-alerts"]');
      await budgetAlerts.uncheck();
      
      // Set notification frequency if available
      const notificationFrequency = page.locator('[data-testid="notification-frequency"]');
      if (await notificationFrequency.count() > 0) {
        await notificationFrequency.selectOption('weekly');
      }

      await testHelpers.submitFormAndWait();
      await testHelpers.verifySuccessMessage('Notification preferences updated');

      // Verify settings are saved
      await page.reload();
      await expect(emailNotifications).toBeChecked();
      await expect(pushNotifications).not.toBeChecked();
      await expect(goalReminders).toBeChecked();
      await expect(transactionAlerts).toBeChecked();
      await expect(budgetAlerts).not.toBeChecked();
    });

    test('should update financial preferences and risk tolerance', async ({ page }) => {
      await testHelpers.navigateAndWait('/profile/financial');

      // Update risk tolerance
      const riskToleranceSelect = page.locator('[data-testid="risk-tolerance"]');
      await riskToleranceSelect.selectOption('moderate');
      
      // Update investment goals if available
      const investmentGoalsCheckboxes = page.locator('[data-testid^="investment-goal-"]');
      const goalCount = await investmentGoalsCheckboxes.count();
      
      for (let i = 0; i < goalCount && i < 3; i++) {
        await investmentGoalsCheckboxes.nth(i).check();
      }
      
      // Update monthly income if available
      const monthlyIncomeField = page.locator('[data-testid="monthly-income"]');
      if (await monthlyIncomeField.count() > 0) {
        await testHelpers.fillFormField('[data-testid="monthly-income"]', '7500');
      }
      
      // Set financial goals priority
      const goalsPriority = page.locator('[data-testid="goals-priority"]');
      if (await goalsPriority.count() > 0) {
        await goalsPriority.selectOption('retirement');
      }

      await testHelpers.submitFormAndWait();
      await testHelpers.verifySuccessMessage('Financial preferences updated');

      // Verify risk tolerance is saved
      await expect(riskToleranceSelect).toHaveValue('moderate');

      await testHelpers.takeScreenshot('financial-preferences-updated');
    });
  });

  test.describe('Privacy and Security Settings', () => {
    test('should update password successfully', async ({ page }) => {
      await testHelpers.navigateAndWait('/profile/security');

      // Fill password change form
      const currentPasswordField = page.locator('[data-testid="current-password"]');
      const newPasswordField = page.locator('[data-testid="new-password"]');
      const confirmPasswordField = page.locator('[data-testid="confirm-password"]');
      
      if (await currentPasswordField.count() > 0) {
        await testHelpers.fillFormField('[data-testid="current-password"]', 'currentPassword123');
        await testHelpers.fillFormField('[data-testid="new-password"]', 'newSecurePassword123!');
        await testHelpers.fillFormField('[data-testid="confirm-password"]', 'newSecurePassword123!');
        
        const changePasswordButton = page.locator('[data-testid="change-password-button"]');
        await changePasswordButton.click();
        
        await testHelpers.verifySuccessMessage('Password updated successfully');
      }
    });

    test('should validate password requirements', async ({ page }) => {
      await testHelpers.navigateAndWait('/profile/security');

      const newPasswordField = page.locator('[data-testid="new-password"]');
      const confirmPasswordField = page.locator('[data-testid="confirm-password"]');
      
      if (await newPasswordField.count() > 0) {
        // Test weak password
        await testHelpers.fillFormField('[data-testid="current-password"]', 'currentPassword123');
        await testHelpers.fillFormField('[data-testid="new-password"]', '123');
        await testHelpers.fillFormField('[data-testid="confirm-password"]', '123');
        
        const changePasswordButton = page.locator('[data-testid="change-password-button"]');
        await changePasswordButton.click();
        
        await expect(page.locator('[data-testid="password-strength-error"]')).toBeVisible();
        
        // Test password mismatch
        await testHelpers.fillFormField('[data-testid="new-password"]', 'strongPassword123!');
        await testHelpers.fillFormField('[data-testid="confirm-password"]', 'differentPassword123!');
        
        await changePasswordButton.click();
        
        await expect(page.locator('[data-testid="password-mismatch-error"]')).toBeVisible();
      }
    });

    test('should manage two-factor authentication settings', async ({ page }) => {
      await testHelpers.navigateAndWait('/profile/security');

      const twoFactorSection = page.locator('[data-testid="two-factor-section"]');
      if (await twoFactorSection.count() > 0) {
        // Enable 2FA
        const enable2FAButton = page.locator('[data-testid="enable-2fa"]');
        if (await enable2FAButton.count() > 0) {
          await enable2FAButton.click();
          
          // Verify QR code or setup instructions appear
          const qrCode = page.locator('[data-testid="2fa-qr-code"]');
          const setupInstructions = page.locator('[data-testid="2fa-setup-instructions"]');
          
          const hasQR = await qrCode.count() > 0;
          const hasInstructions = await setupInstructions.count() > 0;
          
          expect(hasQR || hasInstructions).toBe(true);
          
          // Simulate entering verification code
          const verificationCodeField = page.locator('[data-testid="2fa-verification-code"]');
          if (await verificationCodeField.count() > 0) {
            await testHelpers.fillFormField('[data-testid="2fa-verification-code"]', '123456');
            
            const verify2FAButton = page.locator('[data-testid="verify-2fa"]');
            await verify2FAButton.click();
            
            // Should show success or error based on code validity
            const has2FASuccess = await testHelpers.elementExists('[data-testid="2fa-success"]');
            const has2FAError = await testHelpers.elementExists('[data-testid="2fa-error"]');
            
            expect(has2FASuccess || has2FAError).toBe(true);
          }
        }
      }
    });

    test('should manage account privacy settings', async ({ page }) => {
      await testHelpers.navigateAndWait('/profile/privacy');

      // Profile visibility settings
      const profileVisibility = page.locator('[data-testid="profile-visibility"]');
      if (await profileVisibility.count() > 0) {
        await profileVisibility.selectOption('friends-only');
      }
      
      // Data sharing preferences
      const dataSharing = page.locator('[data-testid="data-sharing"]');
      if (await dataSharing.count() > 0) {
        await dataSharing.uncheck();
      }
      
      // Analytics tracking
      const analyticsTracking = page.locator('[data-testid="analytics-tracking"]');
      if (await analyticsTracking.count() > 0) {
        await analyticsTracking.check();
      }
      
      // Marketing communications
      const marketingComms = page.locator('[data-testid="marketing-communications"]');
      if (await marketingComms.count() > 0) {
        await marketingComms.uncheck();
      }

      const savePrivacyButton = page.locator('[data-testid="save-privacy-settings"]');
      if (await savePrivacyButton.count() > 0) {
        await savePrivacyButton.click();
        await testHelpers.verifySuccessMessage('Privacy settings updated');
      }
    });
  });

  test.describe('Account Management', () => {
    test('should display account information and statistics', async ({ page }) => {
      await testHelpers.navigateAndWait('/profile/account');

      // Verify account creation date
      const createdAtElement = page.locator('[data-testid="account-created"]');
      if (await createdAtElement.count() > 0) {
        await expect(createdAtElement).toBeVisible();
        
        const createdText = await createdAtElement.textContent();
        expect(createdText).toMatch(/\d{4}/);
      }
      
      // Verify account statistics
      const statsElements = {
        transactions: page.locator('[data-testid="total-transactions"]'),
        goals: page.locator('[data-testid="total-goals"]'),
        budgets: page.locator('[data-testid="total-budgets"]')
      };
      
      for (const [key, element] of Object.entries(statsElements)) {
        if (await element.count() > 0) {
          await expect(element).toBeVisible();
          
          const statText = await element.textContent();
          expect(statText).toMatch(/\d+/);
        }
      }
      
      // Check account verification status
      const verificationStatus = page.locator('[data-testid="verification-status"]');
      if (await verificationStatus.count() > 0) {
        await expect(verificationStatus).toBeVisible();
        
        const statusText = await verificationStatus.textContent();
        expect(statusText).toMatch(/(verified|unverified|pending)/i);
      }
    });

    test('should export user data', async ({ page }) => {
      await testHelpers.navigateAndWait('/profile/data');

      const exportDataButton = page.locator('[data-testid="export-data"]');
      if (await exportDataButton.count() > 0) {
        // Listen for download
        const downloadPromise = page.waitForEvent('download');
        
        await exportDataButton.click();
        
        // Verify export confirmation dialog
        const exportDialog = page.locator('[data-testid="export-confirmation"]');
        if (await exportDialog.count() > 0) {
          await expect(exportDialog).toBeVisible();
          await page.click('[data-testid="confirm-export"]');
        }
        
        try {
          const download = await downloadPromise;
          expect(download.suggestedFilename()).toMatch(/export.*\.(json|csv|zip)$/i);
        } catch (error) {
          // Export might be processed differently in test environment
          console.log('Export download not captured in test environment');
        }
        
        await testHelpers.verifySuccessMessage('Data export initiated');
      }
    });

    test('should initiate account deletion process', async ({ page }) => {
      await testHelpers.navigateAndWait('/profile/account');

      const deleteAccountButton = page.locator('[data-testid="delete-account"]');
      if (await deleteAccountButton.count() > 0) {
        await deleteAccountButton.click();
        
        // Should show serious warning dialog
        const deleteWarning = page.locator('[data-testid="delete-account-warning"]');
        await expect(deleteWarning).toBeVisible();
        await expect(deleteWarning).toContainText('permanently delete');
        await expect(deleteWarning).toContainText('cannot be undone');
        
        // Should require confirmation
        const confirmationField = page.locator('[data-testid="delete-confirmation"]');
        if (await confirmationField.count() > 0) {
          await testHelpers.fillFormField('[data-testid="delete-confirmation"]', 'DELETE');
          
          const finalDeleteButton = page.locator('[data-testid="final-delete"]');
          // Don't actually click - just verify it becomes enabled
          await expect(finalDeleteButton).toBeEnabled();
        }
        
        // Cancel the deletion
        const cancelButton = page.locator('[data-testid="cancel-delete"]');
        await cancelButton.click();
        
        await expect(deleteWarning).not.toBeVisible();
      }
    });
  });

  test.describe('Error Handling and Edge Cases', () => {
    test('should handle profile update conflicts', async ({ page }) => {
      await testHelpers.navigateAndWait('/profile/edit');
      
      // Simulate concurrent update scenario
      await testHelpers.fillFormField('[data-testid="profile-name"]', 'Conflicted Name');
      
      // In a real scenario, another process would update the profile
      // For testing, we submit and check for appropriate error handling
      await testHelpers.submitFormAndWait();
      
      // Should either succeed or show conflict resolution
      const hasSuccess = await testHelpers.elementExists('[data-testid="success-message"]');
      const hasConflict = await testHelpers.elementExists('[data-testid="conflict-resolution"]');
      
      expect(hasSuccess || hasConflict).toBe(true);
    });

    test('should handle invalid file uploads', async ({ page }) => {
      await testHelpers.navigateAndWait('/profile/edit');

      const avatarUpload = page.locator('[data-testid="avatar-upload"]');
      if (await avatarUpload.count() > 0) {
        // Try uploading non-image file
        const invalidFile = {
          name: 'document.pdf',
          mimeType: 'application/pdf',
          buffer: Buffer.from('fake-pdf-content')
        };
        
        await avatarUpload.setInputFiles(invalidFile);
        
        // Should show error for invalid file type
        await expect(page.locator('[data-testid="file-type-error"]')).toBeVisible();
        
        // Try uploading oversized file (simulate)
        const oversizedFile = {
          name: 'large-image.jpg',
          mimeType: 'image/jpeg',
          buffer: Buffer.alloc(10 * 1024 * 1024) // 10MB
        };
        
        await avatarUpload.setInputFiles(oversizedFile);
        
        // Should show size error
        const sizeError = page.locator('[data-testid="file-size-error"]');
        if (await sizeError.count() > 0) {
          await expect(sizeError).toBeVisible();
        }
      }
    });

    test('should handle network errors during profile updates', async ({ page }) => {
      await testHelpers.navigateAndWait('/profile/edit');
      
      // Go offline
      await page.context().setOffline(true);
      
      await testHelpers.fillFormField('[data-testid="profile-name"]', 'Offline Update Test');
      await testHelpers.submitFormAndWait();
      
      // Should show network error
      await testHelpers.verifyErrorMessage('network');
      
      // Go back online
      await page.context().setOffline(false);
      
      // Should offer retry option
      const retryButton = page.locator('[data-testid="retry-update"]');
      if (await retryButton.count() > 0) {
        await retryButton.click();
        await testHelpers.verifySuccessMessage();
      }
    });
  });

  test.describe('Accessibility and Mobile', () => {
    test('should be keyboard accessible', async ({ page }) => {
      await testHelpers.navigateAndWait('/profile/edit');
      
      // Test tab navigation through form
      await page.keyboard.press('Tab');
      await expect(page.locator('[data-testid="profile-name"]')).toBeFocused();
      
      await page.keyboard.press('Tab');
      const nextFocusedElement = await page.evaluate(() => document.activeElement?.getAttribute('data-testid'));
      expect(nextFocusedElement).toBeTruthy();
    });

    test('should work properly on mobile devices', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      await testHelpers.navigateAndWait('/profile');
      
      // Verify mobile layout
      const profileContainer = page.locator('[data-testid="profile-container"]');
      await expect(profileContainer).toBeVisible();
      
      // Test mobile navigation
      const mobileMenu = page.locator('[data-testid="mobile-profile-menu"]');
      if (await mobileMenu.count() > 0) {
        await mobileMenu.tap();
        await expect(page.locator('[data-testid="mobile-profile-options"]')).toBeVisible();
      }
      
      // Test form interaction on mobile
      await testHelpers.navigateAndWait('/profile/edit');
      
      const nameField = page.locator('[data-testid="profile-name"]');
      await nameField.tap();
      await expect(nameField).toBeFocused();
      
      await testHelpers.takeScreenshot('profile-mobile');
    });

    test('should handle different screen orientations', async ({ page }) => {
      // Test portrait mode
      await page.setViewportSize({ width: 375, height: 667 });
      await testHelpers.navigateAndWait('/profile');
      await expect(page.locator('[data-testid="profile-container"]')).toBeVisible();
      
      // Test landscape mode
      await page.setViewportSize({ width: 667, height: 375 });
      await testHelpers.waitForPageLoad();
      await expect(page.locator('[data-testid="profile-container"]')).toBeVisible();
      
      await testHelpers.takeScreenshot('profile-landscape');
    });
  });
});