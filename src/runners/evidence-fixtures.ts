/**
 * Import `test` and `expect` from here instead of from '@playwright/test' in every spec.
 * Adds, on top of Playwright's built-in screenshot, video and trace capture:
 * - a per-test HAR network recording (kept only for failed tests by the bundler)
 * - a console.log of browser console messages, page errors and failed requests,
 *   attached when a test fails (this is what the RCA agent reads)
 */
import { expect, test as base } from '@playwright/test';
import { readSettingsFromEnv } from './run-settings.js';

const recordHar = readSettingsFromEnv()?.evidence.harOnFailure ?? false;

export const test = base.extend<{ evidenceCapture: void }>({
  contextOptions: async ({ contextOptions }, use, testInfo) => {
    await use(
      recordHar
        ? { ...contextOptions, recordHar: { path: testInfo.outputPath('network.har'), mode: 'full' } }
        : contextOptions,
    );
  },

  evidenceCapture: [
    async ({ page }, use, testInfo) => {
      const lines: string[] = [];
      page.on('console', (msg) => lines.push(`[console.${msg.type()}] ${msg.text()}`));
      page.on('pageerror', (error) => lines.push(`[pageerror] ${error.message}`));
      page.on('requestfailed', (request) =>
        lines.push(`[requestfailed] ${request.method()} ${request.url()} ${request.failure()?.errorText ?? ''}`.trim()),
      );
      page.on('response', (response) => {
        if (response.status() >= 400) lines.push(`[http ${response.status()}] ${response.request().method()} ${response.url()}`);
      });

      await use();

      if (testInfo.status !== testInfo.expectedStatus) {
        const text = lines.length > 0 ? lines.join('\n') + '\n' : '(no console output or failed requests)\n';
        await testInfo.attach('console', { body: text, contentType: 'text/plain' });
      }
    },
    { auto: true },
  ],
});

export { expect };
