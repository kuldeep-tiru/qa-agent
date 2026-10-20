/**
 * A3 Execution agent: runs the automated specs of a project and turns the run
 * into evidence plus results.json keyed by Test Case Id.
 * Contract: QA_Agent_System_Design.md section 7.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EvidencePolicy } from '../domain/evidence-policy.js';
import { summarize, type RunResultsFile } from '../domain/run-result.js';
import { EvidenceBundler } from '../evidence/bundler.js';
import { parseReport } from '../evidence/report-parser.js';
import type { BrowserOverride, RunSettings } from '../runners/run-settings.js';
import type { TestRunner } from '../runners/playwright-runner.js';

export interface ExecutionRequest {
  /** qa-agent root folder. */
  rootDir: string;
  project: string;
  baseUrl?: string;
  policy: EvidencePolicy;
  headed?: boolean;
  grep?: string;
  browser?: BrowserOverride;
  env?: Record<string, string>;
}

export interface ExecutionOutcome {
  runId: string;
  runDir: string;
  resultsFile: string;
  latestResultsFile: string;
  results: RunResultsFile;
  exitCode: number;
}

/** The run could not produce results at all (as opposed to tests failing). */
export class ExecutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExecutionError';
  }
}

/** 20261019-113045 in local time: readable in folder listings and sorts correctly. */
export function makeRunId(date: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
}

export class Execution {
  constructor(
    private readonly runner: TestRunner,
    private readonly bundler: EvidenceBundler = new EvidenceBundler(),
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async run(request: ExecutionRequest): Promise<ExecutionOutcome> {
    const projectDir = join(request.rootDir, 'projects', request.project);
    if (!existsSync(join(projectDir, 'tests'))) {
      throw new ExecutionError(`no tests folder found: ${join(projectDir, 'tests')}`);
    }

    const runId = makeRunId(this.clock());
    const runDir = join(projectDir, 'evidence', runId);
    const rawDir = join(runDir, '.raw');
    const reportFile = join(runDir, 'report.json');
    mkdirSync(rawDir, { recursive: true });

    const settings: RunSettings = {
      projectDir,
      outputDir: rawDir,
      reportFile,
      ...(request.baseUrl ? { baseUrl: request.baseUrl } : {}),
      headed: request.headed === true,
      workers: 1,
      evidence: request.policy,
      ...(request.browser ? { browser: request.browser } : {}),
    };

    const exitCode = await this.runner.run(settings, {
      cwd: request.rootDir,
      ...(request.grep ? { grep: request.grep } : {}),
      ...(request.env ? { env: request.env } : {}),
    });

    if (!existsSync(reportFile)) {
      throw new ExecutionError(
        'Playwright did not produce a report. Read the messages above: the usual causes are a spec file that fails to load or no tests matching --grep.',
      );
    }
    const report = parseReport(JSON.parse(readFileSync(reportFile, 'utf-8')));
    const bundled = this.bundler.bundle({ projectDir, runDir, rawDir, tests: report.tests, policy: request.policy });

    const results: RunResultsFile = {
      project: request.project,
      runId,
      startedAt: report.startedAt,
      durationMs: report.durationMs,
      ...(request.baseUrl ? { baseUrl: request.baseUrl } : {}),
      summary: summarize(bundled.results),
      results: Object.fromEntries(bundled.results.map((r) => [r.id, r])),
      warnings: [...report.errors.map((e) => `report error: ${e}`), ...bundled.warnings],
    };

    const json = JSON.stringify(results, null, 2) + '\n';
    const resultsFile = join(runDir, 'results.json');
    const latestResultsFile = join(projectDir, 'reports', 'results.json');
    writeFileSync(resultsFile, json, 'utf-8');
    mkdirSync(join(projectDir, 'reports'), { recursive: true });
    writeFileSync(latestResultsFile, json, 'utf-8');

    return { runId, runDir, resultsFile, latestResultsFile, results, exitCode };
  }
}
