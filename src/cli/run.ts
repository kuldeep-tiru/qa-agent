import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Execution, ExecutionError } from '../agents/execution.js';
import { loadConfig } from '../agents/llm-router.js';
import { parseEvidencePolicy } from '../domain/evidence-policy.js';
import { isFailure, type TestResult } from '../domain/run-result.js';
import { PlaywrightRunner } from '../runners/playwright-runner.js';
import type { BrowserOverride } from '../runners/run-settings.js';
import { isSafeProjectName } from './project-name.js';

export interface RunOptions {
  headed?: boolean;
  grep?: string;
  demoFailure?: boolean;
}

/** Reads baseUrl from graph.json without requiring the whole graph to be valid. */
function readBaseUrl(graphFile: string): string | undefined {
  if (!existsSync(graphFile)) return undefined;
  try {
    const data = JSON.parse(readFileSync(graphFile, 'utf-8')) as { baseUrl?: unknown };
    return typeof data.baseUrl === 'string' ? data.baseUrl : undefined;
  } catch {
    return undefined;
  }
}

/** QA_AGENT_BROWSER='{"executablePath":"C:\\\\path\\\\chrome.exe"}' uses a browser you already have. */
function readBrowserOverride(): BrowserOverride | undefined {
  const raw = process.env['QA_AGENT_BROWSER'];
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as BrowserOverride;
  } catch {
    throw new ExecutionError('QA_AGENT_BROWSER is set but is not valid JSON');
  }
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

function printResult(result: TestResult): void {
  const label = result.status === 'passed' ? '[PASS]' : result.status === 'skipped' ? '[SKIP]' : '[FAIL]';
  console.log(`  ${label} ${result.id}  ${result.status === 'skipped' ? '' : seconds(result.durationMs)}`.trimEnd());
  if (isFailure(result.status) && result.error) {
    console.log(`         ${result.error.split('\n')[0]}`);
  }
  if (isFailure(result.status) && result.evidence.length > 0) {
    console.log(`         evidence: ${result.evidence.map((e) => e.path.split('/').pop()).join(', ')}`);
  }
  for (const warning of result.warnings) console.log(`         note: ${warning}`);
}

export async function runRun(rootDir: string, mode: string, project: string, options: RunOptions): Promise<void> {
  const fail = (message: string) => {
    console.log(`  [FAIL] ${message}\n`);
    process.exitCode = 1;
  };

  console.log(`\nqa-agent run ${mode} ${project}\n${'='.repeat(14 + mode.length + project.length)}\n`);
  if (mode === 'manual') {
    console.log('  The manual runner arrives in Week 5. Use: run auto <project>\n');
    return;
  }
  if (mode !== 'auto') return fail(`unknown mode "${mode}". Use: auto`);
  if (!isSafeProjectName(project)) return fail('invalid project name (use letters, digits, . _ or - only)');

  let policy;
  try {
    policy = parseEvidencePolicy(loadConfig(rootDir).evidence);
  } catch (err) {
    return fail(`evidence settings in config/agent.config.json are invalid: ${err instanceof Error ? err.message : String(err)}`);
  }

  const baseUrl = readBaseUrl(join(rootDir, 'projects', project, 'graph.json'));
  try {
    const browser = readBrowserOverride();
    const outcome = await new Execution(new PlaywrightRunner()).run({
      rootDir,
      project,
      policy,
      ...(baseUrl ? { baseUrl } : {}),
      ...(options.headed ? { headed: true } : {}),
      ...(options.grep ? { grep: options.grep } : {}),
      ...(browser ? { browser } : {}),
      ...(options.demoFailure ? { env: { QA_DEMO_FAIL: '1' } } : {}),
    });

    const { summary, results, warnings } = outcome.results;
    console.log(`\n  Run ${outcome.runId}`);
    for (const result of Object.values(results)) printResult(result);
    for (const warning of warnings) console.log(`  note: ${warning}`);
    console.log(
      `\n  ${summary.passed} passed, ${summary.failed + summary.timedOut + summary.interrupted} failed, ${summary.skipped} skipped (${summary.total} total)`,
    );
    console.log(`  Evidence: ${outcome.runDir}`);
    console.log(`  Results:  ${outcome.latestResultsFile}\n`);
    if (options.demoFailure) console.log('  The demo failure is deliberate: it proves screenshot, video, trace, HAR and console capture.\n');
    if (outcome.exitCode !== 0 || summary.failed + summary.timedOut + summary.interrupted > 0) process.exitCode = 1;
  } catch (err) {
    fail(err instanceof ExecutionError || err instanceof Error ? err.message : String(err));
  }
}
