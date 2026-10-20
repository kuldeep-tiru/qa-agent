/**
 * Reads Playwright's JSON report into a flat list of tests.
 * Tolerant on purpose: unknown or missing fields are ignored, never fatal.
 */
import type { TestStatus } from '../domain/run-result.js';

export interface ParsedAttachment {
  name: string;
  contentType: string;
  path?: string;
  /** Inline content (base64) for attachments that were created from text, such as the console log. */
  body?: string;
}

export interface ParsedTest {
  /** The spec title, which starts with the Test Case Id. */
  title: string;
  file: string;
  status: TestStatus;
  durationMs: number;
  error?: string;
  attachments: ParsedAttachment[];
}

export interface ParsedReport {
  startedAt: string;
  durationMs: number;
  tests: ParsedTest[];
  /** Errors outside any test, such as a spec file that failed to load. */
  errors: string[];
}

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;]*m/g;
const MAX_ERROR_CHARS = 2000;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const asString = (value: unknown): string => (typeof value === 'string' ? value : '');
const clean = (text: string): string => text.replace(ANSI, '').trim().slice(0, MAX_ERROR_CHARS);

const STATUSES: readonly TestStatus[] = ['passed', 'failed', 'timedOut', 'skipped', 'interrupted'];
const toStatus = (value: unknown): TestStatus => (STATUSES.includes(value as TestStatus) ? (value as TestStatus) : 'failed');

function errorMessage(result: Record<string, unknown>): string | undefined {
  const first = isRecord(result['error']) ? result['error'] : isRecord(asArray(result['errors'])[0]) ? (asArray(result['errors'])[0] as Record<string, unknown>) : undefined;
  const message = first ? clean(asString(first['message'])) : '';
  return message || undefined;
}

function collectSpecs(suite: unknown, out: ParsedTest[]): void {
  if (!isRecord(suite)) return;
  for (const spec of asArray(suite['specs'])) {
    if (!isRecord(spec)) continue;
    const title = asString(spec['title']);
    const file = asString(spec['file']);
    for (const test of asArray(spec['tests'])) {
      if (!isRecord(test)) continue;
      const results = asArray(test['results']).filter(isRecord);
      const last = results[results.length - 1];
      const status: TestStatus = last ? toStatus(last['status']) : asString(test['status']) === 'skipped' ? 'skipped' : 'failed';
      const error = last ? errorMessage(last) : undefined;
      out.push({
        title,
        file,
        status,
        durationMs: last && typeof last['duration'] === 'number' ? last['duration'] : 0,
        ...(error ? { error } : {}),
        attachments: last
          ? asArray(last['attachments']).filter(isRecord).map((a) => ({
              name: asString(a['name']),
              contentType: asString(a['contentType']),
              ...(typeof a['path'] === 'string' ? { path: a['path'] } : {}),
              ...(typeof a['body'] === 'string' ? { body: a['body'] } : {}),
            }))
          : [],
      });
    }
  }
  for (const child of asArray(suite['suites'])) collectSpecs(child, out);
}

export function parseReport(json: unknown): ParsedReport {
  const tests: ParsedTest[] = [];
  if (!isRecord(json)) return { startedAt: '', durationMs: 0, tests, errors: ['the report is not a JSON object'] };
  for (const suite of asArray(json['suites'])) collectSpecs(suite, tests);
  const stats = isRecord(json['stats']) ? json['stats'] : {};
  return {
    startedAt: asString(stats['startTime']),
    durationMs: typeof stats['duration'] === 'number' ? stats['duration'] : 0,
    tests,
    errors: asArray(json['errors']).filter(isRecord).map((e) => clean(asString(e['message']))).filter(Boolean),
  };
}
