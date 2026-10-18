/**
 * Turns a validated requirement graph into test case skeletons.
 * No LLM and no I/O: the same graph always gives the same test cases.
 *
 * Mapping (matches the "FB Login" example in the template):
 * - Test Case Id    TC_<ModuleId>_<ScenarioId>_NNN, assigned here
 * - Requirement #   the feature's requirementRef
 * - Test Scenario   the feature name
 * - Test Cases      "Verify " + the scenario title
 * - Pre-condition   the scenario preconditions
 * - Steps           one step per trigger; the acceptance criteria become the
 *                   expected result of the last step, prefixed with their ids
 */
import type { Graph, Scenario } from './graph.js';
import { TestCaseSchema, type TestCase, type TestStep } from './test-case.js';
import { inferPriority, inferTestType } from './test-rules.js';

/** "Login with a user" -> "login with a user"; "SEO tags" and "URL check" keep their capitals. */
function lowerFirst(text: string): string {
  const [first = '', second = ''] = text;
  const startsWithAcronym = second !== '' && second === second.toUpperCase() && /[A-Za-z]/.test(second);
  return startsWithAcronym ? text : first.toLowerCase() + text.slice(1);
}

export function buildTitle(scenarioTitle: string): string {
  const title = scenarioTitle.trim();
  return /^verify\b/i.test(title) ? title : `Verify ${lowerFirst(title)}`;
}

export function buildSteps(scenario: Scenario): TestStep[] {
  const descriptions = scenario.triggers.length > 0 ? scenario.triggers : [scenario.title];
  const expected = scenario.acceptanceCriteria.map((ac) => `${ac.id}: ${ac.text}`).join('\n');
  return descriptions.map((description, index) => ({
    description,
    ...(index === descriptions.length - 1 ? { expected } : {}),
  }));
}

/** A test case together with the graph nodes it came from (needed for LLM expansion). */
export interface TestCaseEntry {
  testCase: TestCase;
  moduleName: string;
  featureName: string;
  scenario: Scenario;
  baseUrl?: string;
}

export function buildTestCaseEntries(graph: Graph): TestCaseEntry[] {
  const counters = new Map<string, number>();
  const entries: TestCaseEntry[] = [];

  for (const module of graph.modules) {
    for (const feature of module.features) {
      for (const scenario of feature.scenarios) {
        const key = `${module.id}_${scenario.id}`;
        const sequence = (counters.get(key) ?? 0) + 1;
        counters.set(key, sequence);

        const testType = inferTestType(scenario);
        const testCase = TestCaseSchema.parse({
          id: `TC_${key}_${String(sequence).padStart(3, '0')}`,
          requirementRef: feature.requirementRef,
          scenario: feature.name,
          title: buildTitle(scenario.title),
          preconditions: scenario.preconditions,
          steps: buildSteps(scenario),
          priority: inferPriority(scenario, { moduleName: module.name, featureName: feature.name }, testType),
          testType,
        });
        entries.push({
          testCase,
          moduleName: module.name,
          featureName: feature.name,
          scenario,
          ...(graph.baseUrl ? { baseUrl: graph.baseUrl } : {}),
        });
      }
    }
  }
  return entries;
}

export function buildTestCases(graph: Graph): TestCase[] {
  return buildTestCaseEntries(graph).map((entry) => entry.testCase);
}
