/**
 * End-to-end check of `run auto`: a real browser runs real Playwright specs against a
 * local fake site, and the evidence layout and results.json are verified.
 * Skipped automatically when no browser is available (run `npx playwright install chromium`
 * or set QA_AGENT_BROWSER).
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Execution, type ExecutionOutcome } from '../src/agents/execution.js';
import { parseEvidencePolicy } from '../src/domain/evidence-policy.js';
import { PlaywrightRunner } from '../src/runners/playwright-runner.js';
import type { BrowserOverride } from '../src/runners/run-settings.js';
import { startFakeSauceDemo, type FakeSite } from './fixtures/fake-saucedemo.js';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const browserOverride: BrowserOverride | undefined = process.env['QA_AGENT_BROWSER']
  ? (JSON.parse(process.env['QA_AGENT_BROWSER']) as BrowserOverride)
  : undefined;
const browserAvailable = browserOverride?.executablePath !== undefined || existsSync(chromium.executablePath());

describe('run auto end to end', { skip: browserAvailable ? false : 'no browser installed (npx playwright install chromium)' }, () => {
  let site: FakeSite;
  let root: string;
  let outcome: ExecutionOutcome;
  const projectDir = () => join(root, 'projects', 'demo');

  before(async () => {
    site = await startFakeSauceDemo();
    root = mkdtempSync(join(tmpdir(), 'qa-agent-run-'));
    const testsDir = join(projectDir(), 'tests');
    mkdirSync(testsDir, { recursive: true });
    // Outside the repo there is no package.json, so mark the temp project as ESM like the repo itself.
    writeFileSync(join(root, 'package.json'), JSON.stringify({ type: 'module' }));
    const fixtures = relative(testsDir, join(repoRoot, 'src', 'runners', 'evidence-fixtures.ts')).split('\\').join('/');
    writeFileSync(
      join(testsDir, 'demo.spec.ts'),
      `import { expect, test } from '${fixtures}';
test('TC_Demo_Pass_001 Verify the login page loads', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('Swag Labs');
});
test('TC_Demo_Fail_001 Verify a title that is wrong on purpose', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('Wrong title', { timeout: 1000 });
});
test('Verify a spec with no test case id', async ({ page }) => {
  await page.goto('/');
});
test('TC_Demo_Skip_001 Verify something that is skipped', async () => {
  test.skip(true, 'skipped on purpose');
});
`,
    );
    outcome = await new Execution(new PlaywrightRunner()).run({
      rootDir: root,
      project: 'demo',
      baseUrl: site.baseUrl,
      policy: parseEvidencePolicy({}),
      ...(browserOverride ? { browser: browserOverride } : {}),
    });
  });

  after(async () => {
    await site.close();
    rmSync(root, { recursive: true, force: true });
  });

  const files = (id: string) => readdirSync(join(outcome.runDir, id)).sort();

  it('reports the run summary and exit code', () => {
    assert.equal(outcome.exitCode, 1);
    assert.deepEqual(
      { total: outcome.results.summary.total, passed: outcome.results.summary.passed, failed: outcome.results.summary.failed, skipped: outcome.results.summary.skipped },
      { total: 4, passed: 2, failed: 1, skipped: 1 },
    );
  });

  it('keys results by Test Case Id and flags specs without one', () => {
    const ids = Object.keys(outcome.results.results);
    assert.ok(ids.includes('TC_Demo_Pass_001'));
    assert.ok(ids.includes('TC_Demo_Fail_001'));
    const unmapped = ids.find((id) => id.startsWith('_unmapped-'));
    assert.ok(unmapped, 'the spec without an id is still recorded');
    assert.equal(outcome.results.results[unmapped!]!.mapped, false);
    assert.match(outcome.results.results[unmapped!]!.warnings.join(' '), /Test Case Id/);
  });

  it('keeps only the trace for a passed test and drops its HAR', () => {
    assert.deepEqual(files('TC_Demo_Pass_001'), ['trace.zip']);
  });

  it('keeps trace, screenshot, video, HAR, console log and page snapshot for a failed test', () => {
    assert.deepEqual(files('TC_Demo_Fail_001'), ['console.log', 'error-context.md', 'failure.png', 'network.har', 'trace.zip', 'video.webm']);
    const failed = outcome.results.results['TC_Demo_Fail_001']!;
    assert.equal(failed.status, 'failed');
    assert.match(failed.error ?? '', /Wrong title/);
    assert.ok(failed.evidence.every((e) => e.sizeBytes > 0));
    assert.ok(failed.evidence.every((e) => e.path.startsWith(`evidence/${outcome.runId}/TC_Demo_Fail_001/`)));
  });

  it('keeps no evidence for a skipped test', () => {
    assert.deepEqual(outcome.results.results['TC_Demo_Skip_001']!.evidence, []);
  });

  it('records browser console output and failed requests in console.log', () => {
    const log = readFileSync(join(outcome.runDir, 'TC_Demo_Fail_001', 'console.log'), 'utf-8');
    assert.match(log, /\[console\.error\] fake console error from the login page/);
    assert.match(log, /\[http 500\] GET .*\/api\/ping/);
  });

  it('records the failing request in the HAR', () => {
    const har = JSON.parse(readFileSync(join(outcome.runDir, 'TC_Demo_Fail_001', 'network.har'), 'utf-8')) as { log: { entries: { request: { url: string } }[] } };
    assert.ok(har.log.entries.some((e) => e.request.url.endsWith('/api/ping')));
  });

  it('writes results.json to the run folder and to reports/, and clears the raw staging folder', () => {
    assert.ok(existsSync(outcome.resultsFile));
    assert.deepEqual(JSON.parse(readFileSync(outcome.latestResultsFile, 'utf-8')), outcome.results);
    assert.equal(existsSync(join(outcome.runDir, '.raw')), false);
    assert.ok(existsSync(join(outcome.runDir, 'report.json')));
  });
});
