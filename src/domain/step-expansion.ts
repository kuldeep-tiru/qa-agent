/**
 * Prompt building and answer checking for LLM step expansion. Pure code, no I/O.
 *
 * The LLM only refines the steps of one scenario. Everything it returns is
 * checked here before it is allowed into a test case:
 * - it must match the schema,
 * - it must not contain a URL that is not in the scenario or the base URL,
 * - every acceptance criterion id must appear in an expected result
 *   (missing ones are appended by code, never left out).
 */
import { z } from 'zod';
import type { TestCaseEntry } from './test-case-builder.js';
import type { TestStep } from './test-case.js';

/** Bump when the prompt or checks change, so old cached answers are not reused. */
export const PROMPT_VERSION = 1;

const LlmStepSchema = z.object({
  description: z.string(),
  testData: z.string(),
  expected: z.string(),
});

export const LlmStepsSchema = z.object({
  steps: z.array(LlmStepSchema).min(1).max(12),
});

export function llmStepsJsonSchema(): Record<string, unknown> {
  const schema = z.toJSONSchema(LlmStepsSchema) as Record<string, unknown>;
  delete schema['$schema'];
  return schema;
}

export interface ExpansionInput {
  baseUrl?: string;
  moduleName: string;
  featureName: string;
  scenarioTitle: string;
  preconditions: string[];
  triggers: string[];
  criteria: { id: string; text: string }[];
}

export function toExpansionInput(entry: TestCaseEntry): ExpansionInput {
  return {
    ...(entry.baseUrl ? { baseUrl: entry.baseUrl } : {}),
    moduleName: entry.moduleName,
    featureName: entry.featureName,
    scenarioTitle: entry.scenario.title,
    preconditions: entry.scenario.preconditions,
    triggers: entry.scenario.triggers,
    criteria: entry.scenario.acceptanceCriteria.map((ac) => ({ id: ac.id, text: ac.text })),
  };
}

export const SYSTEM_PROMPT = [
  'You are a senior QA engineer writing manual test steps for ONE test scenario.',
  'Answer with JSON only, in the requested format.',
  'Rules:',
  '- Write 2 to 8 concrete steps in the order a tester performs them. One action per step.',
  '- Start each description with a verb such as Open, Enter, Click, Select or Verify.',
  '- Use only data that appears in the scenario. Never invent URLs, usernames, passwords, emails or product names.',
  '- For personal details the scenario does not specify (names, postal codes) you may use obvious dummy values such as "Test" and "12345".',
  '- If a step needs no data, use an empty string for testData.',
  '- Put an expected result only on steps where something observable happens, otherwise use an empty string.',
  '- Together the expected results must cover every acceptance criterion. Start each one with its id, for example "AC-AUTH-01: ...".',
  '- Do not add steps the scenario does not need.',
  'Good step: description "Enter the username", testData "standard_user". Bad step: "Login" (several actions in one step).',
].join('\n');

export function buildPrompt(input: ExpansionInput, rejection?: string): string {
  const lines: string[] = [];
  if (input.baseUrl) lines.push(`Application base URL: ${input.baseUrl}`);
  lines.push(`Module: ${input.moduleName}`, `Feature: ${input.featureName}`, `Scenario: ${input.scenarioTitle}`);
  if (input.preconditions.length > 0) {
    lines.push('Preconditions:', ...input.preconditions.map((p) => `- ${p}`));
  }
  if (input.triggers.length > 0) {
    lines.push('Actions to cover, in order:', ...input.triggers.map((t, i) => `${i + 1}. ${t}`));
  }
  lines.push('Acceptance criteria:', ...input.criteria.map((c) => `- ${c.id}: ${c.text}`));
  if (rejection) {
    lines.push('', `Your previous answer was rejected: ${rejection}. Answer again and fix this.`);
  }
  return lines.join('\n');
}

/** The model's answer was unusable. The caller may retry with the reason. */
export class ExpansionRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExpansionRejected';
  }
}

export interface ParsedExpansion {
  steps: TestStep[];
  /** Human-readable notes about repairs made by code. */
  notes: string[];
}

const URL_PATTERN = /https?:\/\/[^\s"'<>)\]]+/gi;
const trimUrl = (url: string) => url.toLowerCase().replace(/[.,;:!?]+$/, '');

export function parseExpansion(raw: string, input: ExpansionInput): ParsedExpansion {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new ExpansionRejected('the answer was not valid JSON');
  }
  const parsed = LlmStepsSchema.safeParse(data);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.join('.') || 'answer';
    throw new ExpansionRejected(`the answer did not match the format (${where}: ${issue?.message ?? 'invalid'})`);
  }

  let steps: TestStep[] = parsed.data.steps
    .map((s) => ({
      description: s.description.trim(),
      ...(s.testData.trim() ? { testData: s.testData.trim() } : {}),
      ...(s.expected.trim() ? { expected: s.expected.trim() } : {}),
    }))
    .filter((s) => s.description.length >= 3);
  if (steps.length === 0) throw new ExpansionRejected('no usable steps were returned');

  // URL grounding: only URLs that come from the scenario or extend the base URL.
  const corpus = [
    input.baseUrl ?? '',
    input.moduleName,
    input.featureName,
    input.scenarioTitle,
    ...input.preconditions,
    ...input.triggers,
    ...input.criteria.map((c) => c.text),
  ]
    .join(' ')
    .toLowerCase();
  const base = input.baseUrl?.toLowerCase().replace(/\/+$/, '');
  for (const step of steps) {
    const text = [step.description, step.testData ?? '', step.expected ?? ''].join(' ');
    for (const match of text.match(URL_PATTERN) ?? []) {
      const url = trimUrl(match);
      const known = corpus.includes(url) || (base !== undefined && url.startsWith(base));
      if (!known) throw new ExpansionRejected(`it contained a URL that is not in the scenario (${match})`);
    }
  }

  // Traceability: every acceptance criterion id must appear in some expected result.
  const notes: string[] = [];
  const expectedText = steps.map((s) => s.expected ?? '').join('\n');
  const missing = input.criteria.filter((c) => !expectedText.includes(c.id));
  if (missing.length > 0) {
    const last = steps[steps.length - 1]!;
    const added = missing.map((c) => `${c.id}: ${c.text}`).join('\n');
    steps = [...steps.slice(0, -1), { ...last, expected: last.expected ? `${last.expected}\n${added}` : added }];
    notes.push(`added ${missing.length} missing acceptance criteria to the last step`);
  }
  return { steps, notes };
}
