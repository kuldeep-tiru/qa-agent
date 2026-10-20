/**
 * Turns qa-agent run settings (including the evidence policy) into a Playwright config.
 * Screenshot, video and trace are built-in Playwright options. HAR recording and
 * console capture are added by the fixtures in evidence-fixtures.ts.
 */
import { defineConfig, devices, type PlaywrightTestConfig } from '@playwright/test';
import { join } from 'node:path';
import type { RunSettings } from './run-settings.js';

export function buildPlaywrightConfig(settings: RunSettings): PlaywrightTestConfig {
  const { evidence, browser } = settings;
  return defineConfig({
    testDir: join(settings.projectDir, 'tests'),
    testMatch: '**/*.spec.ts',
    outputDir: settings.outputDir,
    // One worker and no retries: gentle on live sites, and evidence belongs to the first failure.
    workers: settings.workers,
    fullyParallel: false,
    retries: 0,
    timeout: 30_000,
    expect: { timeout: 5_000 },
    reporter: [['list'], ['json', { outputFile: settings.reportFile }]],
    use: {
      ...(settings.baseUrl ? { baseURL: settings.baseUrl } : {}),
      headless: !settings.headed,
      screenshot: evidence.screenshotOnFailure ? 'only-on-failure' : 'off',
      video: evidence.videoOnFailureOnly ? 'retain-on-failure' : 'on',
      trace: evidence.traceAlways ? 'on' : 'retain-on-failure',
      ...(browser
        ? {
            launchOptions: {
              ...(browser.executablePath ? { executablePath: browser.executablePath } : {}),
              ...(browser.args ? { args: browser.args } : {}),
            },
          }
        : {}),
    },
    projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  });
}
