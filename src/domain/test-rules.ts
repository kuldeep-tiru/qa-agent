/**
 * Deterministic rules for priority and test type. Pure functions, no I/O.
 * These run before (and instead of) the LLM, so a small local model is never
 * asked to guess something a rule can decide. A value set explicitly in
 * graph.json always wins over these rules.
 */
import type { Scenario } from './graph.js';
import type { Priority, TestType } from './test-types.js';

/** Flows that carry business risk. Matched against module, feature and scenario names. */
export const CRITICAL_FLOW_KEYWORDS = ['login', 'payment', 'checkout'] as const;

/** On a critical flow, these types are Medium instead of High. */
const SECONDARY_TYPES: ReadonlySet<TestType> = new Set<TestType>(['Negative', 'Validation', 'Error Handling', 'Boundary']);

const VALIDATION_WORDS = /\b(required|empty|blank|mandatory|must)\b/;
const NEGATIVE_WORDS = /\b(error|invalid|incorrect|wrong|locked|denied|unauthori[sz]ed|fails?|rejected)\b/;

export function inferTestType(scenario: Scenario): TestType {
  if (scenario.testType) return scenario.testType;
  const text = [scenario.title, ...scenario.acceptanceCriteria.map((ac) => ac.text)].join(' ').toLowerCase();
  if (VALIDATION_WORDS.test(text)) return 'Validation';
  if (NEGATIVE_WORDS.test(text)) return 'Negative';
  return 'Functional';
}

export function isCriticalFlow(...names: string[]): boolean {
  const text = names.join(' ').toLowerCase();
  return CRITICAL_FLOW_KEYWORDS.some((keyword) => text.includes(keyword));
}

/**
 * - Explicit priority in graph.json wins.
 * - Critical flow, main path: High.
 * - Critical flow, negative / validation / error / boundary case: Medium.
 * - Everything else: Low.
 */
export function inferPriority(
  scenario: Scenario,
  context: { moduleName: string; featureName: string },
  testType: TestType = inferTestType(scenario),
): Priority {
  if (scenario.priority) return scenario.priority;
  if (!isCriticalFlow(context.moduleName, context.featureName, scenario.title)) return 'Low';
  return SECONDARY_TYPES.has(testType) ? 'Medium' : 'High';
}
