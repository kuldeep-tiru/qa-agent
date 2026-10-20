/**
 * Authentication tests for https://www.saucedemo.com (public demo site).
 * Each test title starts with the Test Case Id from the generated Excel file,
 * so results and evidence are traceable by ID.
 * Read-only flows with the public demo users; no data is created.
 */
import { expect, test } from '../../../src/runners/evidence-fixtures.js';

const username = '[data-test="username"]';
const password = '[data-test="password"]';
const loginButton = '[data-test="login-button"]';
const error = '[data-test="error"]';

test.describe('Authentication', () => {
  test('TC_Auth_ValidLogin_001 Verify login with a valid username and password', async ({ page }) => {
    await page.goto('/');
    await page.locator(username).fill('standard_user');
    await page.locator(password).fill('secret_sauce');
    await page.locator(loginButton).click();
    await expect(page).toHaveURL(/inventory\.html/);
    await expect(page.locator('[data-test="inventory-item"]')).toHaveCount(6);
  });

  test('TC_Auth_InvalidPassword_001 Verify login with a valid username and a wrong password', async ({ page }) => {
    await page.goto('/');
    await page.locator(username).fill('standard_user');
    await page.locator(password).fill('wrong_password');
    await page.locator(loginButton).click();
    await expect(page.locator(error)).toContainText('do not match any user');
    await expect(page).not.toHaveURL(/inventory\.html/);
  });

  test('TC_Auth_LockedOutUser_001 Verify login is blocked for a locked out user', async ({ page }) => {
    await page.goto('/');
    await page.locator(username).fill('locked_out_user');
    await page.locator(password).fill('secret_sauce');
    await page.locator(loginButton).click();
    await expect(page.locator(error)).toContainText('locked out');
  });

  test('TC_Auth_EmptyCredentials_001 Verify login with empty username and password', async ({ page }) => {
    await page.goto('/');
    await page.locator(loginButton).click();
    await expect(page.locator(error)).toContainText('Username is required');
  });
});
