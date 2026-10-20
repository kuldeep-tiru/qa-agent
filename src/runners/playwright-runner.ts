/**
 * Runs the project's Playwright specs with the shared config.
 * Starts Playwright's own CLI with the current Node (not through npx), which
 * avoids PATH and .cmd problems on Windows.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { SETTINGS_ENV, encodeSettings, type RunSettings } from './run-settings.js';

export interface TestRunOptions {
  /** Only run tests whose title matches this text or pattern (Playwright --grep). */
  grep?: string;
  /** Working directory for the run (the qa-agent root). */
  cwd: string;
  /** Extra environment variables for the test process. */
  env?: Record<string, string>;
}

export interface TestRunner {
  /** Resolves with the exit code; 0 means all tests passed, 1 means some failed. */
  run(settings: RunSettings, options: TestRunOptions): Promise<number>;
}

const require = createRequire(import.meta.url);

export class PlaywrightRunner implements TestRunner {
  run(settings: RunSettings, options: TestRunOptions): Promise<number> {
    const cli = require.resolve('@playwright/test/cli');
    const config = fileURLToPath(new URL('./playwright.config.ts', import.meta.url));
    const args = [cli, 'test', '--config', config, ...(options.grep ? ['--grep', options.grep] : [])];

    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, args, {
        cwd: options.cwd,
        stdio: 'inherit',
        env: { ...process.env, ...options.env, [SETTINGS_ENV]: encodeSettings(settings) },
      });
      child.on('error', reject);
      child.on('close', (code) => resolve(code ?? 1));
    });
  }
}
