import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseEvidencePolicy } from '../src/domain/evidence-policy.js';
import { extractTestCaseId, summarize, type TestResult } from '../src/domain/run-result.js';
import { parseReport } from '../src/evidence/report-parser.js';
import { EvidenceBundler } from '../src/evidence/bundler.js';
import { buildPlaywrightConfig } from '../src/runners/playwright-config.js';
import { SETTINGS_ENV, encodeSettings, readSettingsFromEnv, type RunSettings } from '../src/runners/run-settings.js';
import { Execution, ExecutionError, makeRunId } from '../src/agents/execution.js';
import type { TestRunner } from '../src/runners/playwright-runner.js';

describe('extractTestCaseId', () => {
  it('reads the id at the start of a spec title', () => {
    assert.equal(extractTestCaseId('TC_Auth_ValidLogin_001 Verify login'), 'TC_Auth_ValidLogin_001');
    assert.equal(extractTestCaseId('  TC_Cart_AddToCart_012'), 'TC_Cart_AddToCart_012');
  });
  it('returns nothing when the title has no id at the start', () => {
    assert.equal(extractTestCaseId('Verify login TC_Auth_ValidLogin_001'), undefined);
    assert.equal(extractTestCaseId('TC_Auth_001 too short'), undefined);
  });
});

describe('evidence policy and Playwright config', () => {
  it('applies the design doc defaults', () => {
    assert.deepEqual(parseEvidencePolicy(undefined), {
      screenshotOnFailure: true,
      videoOnFailureOnly: true,
      traceAlways: true,
      harOnFailure: true,
      maxVideoMbPerDefect: 50,
    });
  });

  const settings = (over: Partial<RunSettings> = {}): RunSettings => ({
    projectDir: join('p', 'demo'),
    outputDir: join('p', 'demo', 'evidence', 'r', '.raw'),
    reportFile: join('p', 'demo', 'evidence', 'r', 'report.json'),
    baseUrl: 'https://example.test',
    headed: false,
    workers: 1,
    evidence: parseEvidencePolicy({}),
    ...over,
  });

  it('maps the policy to screenshot, video and trace modes', () => {
    const use = buildPlaywrightConfig(settings()).use!;
    assert.equal(use.screenshot, 'only-on-failure');
    assert.equal(use.video, 'retain-on-failure');
    assert.equal(use.trace, 'on');
    assert.equal(use.baseURL, 'https://example.test');
    assert.equal(use.headless, true);

    const relaxed = buildPlaywrightConfig(
      settings({ headed: true, evidence: parseEvidencePolicy({ screenshotOnFailure: false, videoOnFailureOnly: false, traceAlways: false }) }),
    ).use!;
    assert.equal(relaxed.screenshot, 'off');
    assert.equal(relaxed.video, 'on');
    assert.equal(relaxed.trace, 'retain-on-failure');
    assert.equal(relaxed.headless, false);
  });

  it('runs one worker with no retries, and passes a browser override through', () => {
    const config = buildPlaywrightConfig(settings({ browser: { executablePath: '/usr/bin/chrome', args: ['--no-sandbox'] } }));
    assert.equal(config.workers, 1);
    assert.equal(config.retries, 0);
    assert.deepEqual(config.use!.launchOptions, { executablePath: '/usr/bin/chrome', args: ['--no-sandbox'] });
  });

  it('round-trips settings through the environment variable', () => {
    const s = settings();
    assert.deepEqual(readSettingsFromEnv({ [SETTINGS_ENV]: encodeSettings(s) }), s);
    assert.equal(readSettingsFromEnv({}), undefined);
  });
});

describe('parseReport', () => {
  const report = {
    stats: { startTime: '2026-10-19T06:00:00.000Z', duration: 4321 },
    errors: [{ message: '\u001b[31mfile failed to load\u001b[39m' }],
    suites: [
      {
        title: 'a.spec.ts',
        specs: [
          { title: 'TC_A_B_001 top level', file: 'a.spec.ts', tests: [{ status: 'expected', results: [{ status: 'passed', duration: 10, attachments: [{ name: 'trace', contentType: 'application/zip', path: '/x/trace.zip' }] }] }] },
        ],
        suites: [
          {
            title: 'group',
            specs: [
              {
                title: 'TC_A_B_002 nested failure',
                file: 'a.spec.ts',
                tests: [
                  {
                    status: 'unexpected',
                    results: [
                      { status: 'failed', duration: 20, errors: [{ message: '\u001b[31mexpect failed\u001b[39m' }], attachments: [{ name: 'console', contentType: 'text/plain', body: Buffer.from('hi').toString('base64') }] },
                    ],
                  },
                ],
              },
              { title: 'TC_A_B_003 skipped', file: 'a.spec.ts', tests: [{ status: 'skipped', results: [{ status: 'skipped', duration: 0, attachments: [] }] }] },
            ],
          },
        ],
      },
    ],
  };

  it('flattens nested suites, strips colour codes and keeps inline attachments', () => {
    const parsed = parseReport(report);
    assert.equal(parsed.tests.length, 3);
    assert.deepEqual(parsed.tests.map((t) => t.status), ['passed', 'failed', 'skipped']);
    assert.equal(parsed.tests[1]!.error, 'expect failed');
    assert.equal(parsed.tests[1]!.attachments[0]!.body, 'aGk=');
    assert.equal(parsed.tests[0]!.attachments[0]!.path, '/x/trace.zip');
    assert.deepEqual(parsed.errors, ['file failed to load']);
    assert.equal(parsed.durationMs, 4321);
  });

  it('survives garbage without throwing', () => {
    assert.equal(parseReport(null).tests.length, 0);
    assert.equal(parseReport({ suites: [{ specs: [{ tests: [{}] }] }] }).tests[0]!.status, 'failed');
  });
});

describe('EvidenceBundler', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'qa-agent-bundle-')); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  /** Creates a raw test folder with the given files and returns absolute paths. */
  const raw = (testFolder: string, files: Record<string, string | number>) => {
    const folder = join(dir, 'evidence', 'run1', '.raw', testFolder);
    mkdirSync(folder, { recursive: true });
    const paths: Record<string, string> = {};
    for (const [name, content] of Object.entries(files)) {
      paths[name] = join(folder, name);
      writeFileSync(paths[name]!, typeof content === 'number' ? Buffer.alloc(content) : content);
    }
    return paths;
  };
  const bundle = (tests: Parameters<EvidenceBundler['bundle']>[0]['tests'], policy = parseEvidencePolicy({})) =>
    new EvidenceBundler().bundle({ projectDir: dir, runDir: join(dir, 'evidence', 'run1'), rawDir: join(dir, 'evidence', 'run1', '.raw'), tests, policy });
  const attach = (name: string, path: string) => ({ name, contentType: 'x', path });

  it('keeps the HAR for a failure and drops it for a pass', () => {
    const fail = raw('f', { 'trace.zip': 'z', 'network.har': '{}' });
    const pass = raw('p', { 'trace.zip': 'z', 'network.har': '{}' });
    const { results } = bundle([
      { title: 'TC_A_B_001 fails', file: 'a', status: 'failed', durationMs: 1, error: 'boom', attachments: [attach('trace', fail['trace.zip']!)] },
      { title: 'TC_A_B_002 passes', file: 'a', status: 'passed', durationMs: 1, attachments: [attach('trace', pass['trace.zip']!)] },
    ]);
    assert.deepEqual(results[0]!.evidence.map((e) => e.kind).sort(), ['har', 'trace']);
    assert.deepEqual(results[1]!.evidence.map((e) => e.kind), ['trace']);
    assert.ok(existsSync(join(dir, 'evidence', 'run1', 'TC_A_B_001', 'network.har')));
    assert.equal(existsSync(join(dir, 'evidence', 'run1', 'TC_A_B_002', 'network.har')), false);
    assert.equal(existsSync(join(dir, 'evidence', 'run1', '.raw')), false, 'empty staging folder is removed');
  });

  it('flags an oversize video but still keeps it', () => {
    const files = raw('f', { 'video.webm': 2 * 1024 * 1024 });
    const { results } = bundle(
      [{ title: 'TC_A_B_001 x', file: 'a', status: 'failed', durationMs: 1, attachments: [attach('video', files['video.webm']!)] }],
      parseEvidencePolicy({ maxVideoMbPerDefect: 1 }),
    );
    assert.equal(results[0]!.evidence[0]!.oversize, true);
    assert.match(results[0]!.warnings.join(' '), /over the 1 MB limit/);
    assert.ok(existsSync(join(dir, 'evidence', 'run1', 'TC_A_B_001', 'video.webm')));
  });

  it('writes inline attachments to files', () => {
    const { results } = bundle([
      { title: 'TC_A_B_001 x', file: 'a', status: 'failed', durationMs: 1, attachments: [{ name: 'console', contentType: 'text/plain', body: Buffer.from('line one\n').toString('base64') }] },
    ]);
    assert.equal(readFileSync(join(dir, 'evidence', 'run1', 'TC_A_B_001', 'console.log'), 'utf-8'), 'line one\n');
    assert.equal(results[0]!.evidence[0]!.kind, 'console');
  });

  it('uses relative forward-slash paths and never loses a listed file that is missing', () => {
    const files = raw('f', { 'trace.zip': 'z' });
    const { results } = bundle([
      { title: 'TC_A_B_001 x', file: 'a', status: 'failed', durationMs: 1, attachments: [attach('trace', files['trace.zip']!), attach('screenshot', join(dir, 'gone.png'))] },
    ]);
    assert.equal(results[0]!.evidence[0]!.path, 'evidence/run1/TC_A_B_001/trace.zip');
    assert.match(results[0]!.warnings.join(' '), /screenshot file listed in the report was not found/);
  });

  it('flags specs without an id and keeps duplicate ids apart', () => {
    const { results } = bundle([
      { title: 'No id here', file: 'a', status: 'passed', durationMs: 1, attachments: [] },
      { title: 'TC_A_B_001 once', file: 'a', status: 'passed', durationMs: 1, attachments: [] },
      { title: 'TC_A_B_001 twice', file: 'a', status: 'passed', durationMs: 1, attachments: [] },
    ]);
    assert.equal(results[0]!.mapped, false);
    assert.match(results[0]!.id, /^_unmapped-No-id-here/);
    assert.deepEqual([results[1]!.id, results[2]!.id], ['TC_A_B_001', 'TC_A_B_001-2']);
    assert.match(results[2]!.warnings.join(' '), /more than once/);
  });

  it('reports unclaimed files instead of deleting them', () => {
    raw('mystery', { 'notes.txt': 'keep me' });
    const { warnings } = bundle([]);
    assert.match(warnings.join(' '), /not linked to a test/);
    assert.ok(existsSync(join(dir, 'evidence', 'run1', '.raw', 'mystery', 'notes.txt')));
    assert.deepEqual(readdirSync(join(dir, 'evidence', 'run1', '.raw')), ['mystery']);
  });
});

describe('Execution agent', () => {
  let root: string;
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'qa-agent-exec-')); });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const policy = parseEvidencePolicy({});

  it('formats run ids from local time', () => {
    assert.equal(makeRunId(new Date(2026, 9, 19, 11, 30, 45)), '20261019-113045');
  });

  it('fails clearly when the project has no tests folder', async () => {
    const runner: TestRunner = { run: async () => 0 };
    await assert.rejects(() => new Execution(runner).run({ rootDir: root, project: 'nope', policy }), /no tests folder/);
  });

  it('fails clearly when Playwright wrote no report', async () => {
    mkdirSync(join(root, 'projects', 'demo', 'tests'), { recursive: true });
    const runner: TestRunner = { run: async () => 1 };
    await assert.rejects(() => new Execution(runner).run({ rootDir: root, project: 'demo', policy }), ExecutionError);
  });

  it('turns a report into results.json keyed by test case id', async () => {
    mkdirSync(join(root, 'projects', 'demo', 'tests'), { recursive: true });
    const runner: TestRunner = {
      run: async (settings) => {
        writeFileSync(
          settings.reportFile,
          JSON.stringify({ suites: [{ specs: [{ title: 'TC_A_B_001 ok', file: 'a.spec.ts', tests: [{ results: [{ status: 'passed', duration: 5, attachments: [] }] }] }] }] }),
        );
        return 0;
      },
    };
    const outcome = await new Execution(runner, undefined, () => new Date(2026, 0, 2, 3, 4, 5)).run({ rootDir: root, project: 'demo', baseUrl: 'https://x.test', policy });
    assert.equal(outcome.runId, '20260102-030405');
    assert.equal(outcome.results.results['TC_A_B_001']!.status, 'passed');
    assert.deepEqual(summarize(Object.values(outcome.results.results) as TestResult[]).passed, 1);
    assert.deepEqual(JSON.parse(readFileSync(outcome.latestResultsFile, 'utf-8')), outcome.results);
    assert.equal(outcome.exitCode, 0);
  });
});
