/**
 * Fails on purpose to prove that screenshot, video, trace, HAR and console capture work.
 * Skipped unless you run:  npm run qa-agent -- run auto saucedemo-pilot --demo-failure
 */
import { expect, test } from '../../../src/runners/evidence-fixtures.js';

test('TC_Demo_ExpectedFailure_001 Deliberate failure to prove evidence capture', async ({ page }) => {
  test.skip(process.env['QA_DEMO_FAIL'] !== '1', 'Runs only with --demo-failure');
  await page.goto('/');
  await expect(page).toHaveTitle('This title is wrong on purpose');
});
