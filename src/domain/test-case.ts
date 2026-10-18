/**
 * Test case model: the single shape that every generator produces and every
 * output (Excel now, Playwright skeletons later) consumes.
 * Pure domain code; no file or network access.
 */
import { z } from 'zod';
import { PRIORITIES, TEST_TYPES } from './test-types.js';

/** Status values counted by the Coverage sheet. New cases start as Not Executed. */
export const TEST_STATUSES = ['Not Executed', 'Pass', 'Fail', 'Blocked'] as const;

const requiredText = (what: string) => z.string().trim().min(1, `${what} must not be empty`);

export const TestStepSchema = z.strictObject({
  description: requiredText('step description'),
  testData: z.string().optional(),
  expected: z.string().optional(),
});

export const TestCaseSchema = z.strictObject({
  /** Format TC_<Module>_<Scenario>_001, assigned by code, never by the LLM. */
  id: z.string().regex(/^TC_[A-Za-z0-9]+_[A-Za-z0-9]+_\d{3,}$/, 'must look like TC_<Module>_<Scenario>_001'),
  requirementRef: requiredText('requirementRef'),
  /** Written to the "Test Scenario" column. */
  scenario: requiredText('scenario'),
  /** Written to the "Test Cases" column. */
  title: requiredText('title'),
  preconditions: z.array(requiredText('precondition')).default([]),
  steps: z.array(TestStepSchema).min(1, 'a test case needs at least one step'),
  priority: z.enum(PRIORITIES),
  testType: z.enum(TEST_TYPES),
  status: z.enum(TEST_STATUSES).default('Not Executed'),
});

export type TestStep = z.infer<typeof TestStepSchema>;
export type TestCase = z.infer<typeof TestCaseSchema>;
/** Input shape before defaults are applied (preconditions and status optional). */
export type TestCaseInput = z.input<typeof TestCaseSchema>;
