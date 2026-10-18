import type { TestCase } from './test-case.js';

export interface WriteOutcome {
  /** Absolute path of the file that was written. */
  path: string;
  /** 1 for the first file, 2 for a re-run that kept the earlier file, and so on. */
  version: number;
  casesWritten: number;
}

/**
 * Port for anything that can store generated test cases.
 * The generator depends on this interface, not on Excel.
 */
export interface TestCaseSink {
  write(testCases: readonly TestCase[]): Promise<WriteOutcome>;
}
