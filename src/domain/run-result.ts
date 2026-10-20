/**
 * What a test run produces. The same shapes will be written by the manual
 * runner (Week 5), so results from both sources can be merged.
 */

export const TEST_CASE_ID_PATTERN = /^(TC_[A-Za-z0-9]+_[A-Za-z0-9]+_\d{3,})\b/;

/** Spec titles start with the Test Case Id, for example "TC_Auth_ValidLogin_001 Verify login...". */
export function extractTestCaseId(title: string): string | undefined {
  return TEST_CASE_ID_PATTERN.exec(title.trim())?.[1];
}

export type TestStatus = 'passed' | 'failed' | 'timedOut' | 'skipped' | 'interrupted';

export type EvidenceKind = 'trace' | 'screenshot' | 'video' | 'har' | 'console' | 'context' | 'other';

/** 'context' is Playwright's page snapshot at the moment of failure (error-context.md), useful for RCA. */
export interface EvidenceFile {
  kind: EvidenceKind;
  /** Path relative to the project folder, with forward slashes. */
  path: string;
  sizeBytes: number;
  /** Set on videos larger than the policy limit; packaging can leave these out. */
  oversize?: boolean;
}

export interface TestResult {
  /** Test Case Id, or "_unmapped-..." when the spec title has no Test Case Id. */
  id: string;
  mapped: boolean;
  title: string;
  file: string;
  status: TestStatus;
  durationMs: number;
  error?: string;
  evidence: EvidenceFile[];
  warnings: string[];
}

export interface RunSummary {
  total: number;
  passed: number;
  failed: number;
  timedOut: number;
  skipped: number;
  interrupted: number;
}

export interface RunResultsFile {
  project: string;
  runId: string;
  startedAt: string;
  durationMs: number;
  baseUrl?: string;
  summary: RunSummary;
  /** Keyed by Test Case Id for traceability to the Excel test cases. */
  results: Record<string, TestResult>;
  warnings: string[];
}

export function isFailure(status: TestStatus): boolean {
  return status === 'failed' || status === 'timedOut' || status === 'interrupted';
}

export function summarize(results: readonly TestResult[]): RunSummary {
  const summary: RunSummary = { total: results.length, passed: 0, failed: 0, timedOut: 0, skipped: 0, interrupted: 0 };
  for (const r of results) summary[r.status] += 1;
  return summary;
}
