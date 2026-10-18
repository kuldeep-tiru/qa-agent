/**
 * Expands the skeleton steps of one test case with the LLM.
 * Order of attempts: cache, then the model (at most maxAttempts answers),
 * then fallback to the skeleton steps. A test case is never left without steps.
 */
import { LlmTimeoutError, type LlmClient } from '../domain/llm-client.js';
import {
  ExpansionRejected,
  SYSTEM_PROMPT,
  buildPrompt,
  llmStepsJsonSchema,
  parseExpansion,
  toExpansionInput,
} from '../domain/step-expansion.js';
import type { TestCaseEntry } from '../domain/test-case-builder.js';
import type { TestStep } from '../domain/test-case.js';
import { cacheKey, type ExpansionStore } from '../knowledge/expansion-cache.js';

export type ExpansionStatus = 'expanded' | 'cached' | 'fallback' | 'skipped';

export interface ExpansionResult {
  status: ExpansionStatus;
  /** Present for expanded and cached. */
  steps?: TestStep[];
  reason?: string;
  timedOut?: boolean;
  attempts: number;
  seconds: number;
}

export interface ExpanderOptions {
  client: LlmClient;
  cache: ExpansionStore;
  maxAttempts?: number;
}

export class StepExpander {
  private readonly maxAttempts: number;

  constructor(private readonly options: ExpanderOptions) {
    this.maxAttempts = options.maxAttempts ?? 2;
  }

  get model(): string {
    return this.options.client.model;
  }

  /**
   * Throws LlmUnavailableError when the model cannot be used at all, so the
   * caller can stop instead of failing every remaining scenario one by one.
   */
  async expand(entry: TestCaseEntry, allowCall: boolean): Promise<ExpansionResult> {
    const started = Date.now();
    const seconds = () => Math.round((Date.now() - started) / 100) / 10;
    const input = toExpansionInput(entry);
    const key = cacheKey(this.model, input);

    const cached = this.options.cache.get(key);
    if (cached) return { status: 'cached', steps: cached, attempts: 0, seconds: seconds() };
    if (!allowCall) return { status: 'skipped', reason: 'limit reached', attempts: 0, seconds: 0 };

    let rejection: string | undefined;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      let raw: string;
      try {
        raw = await this.options.client.generateJson({
          system: SYSTEM_PROMPT,
          prompt: buildPrompt(input, rejection),
          schema: llmStepsJsonSchema(),
        });
      } catch (err) {
        if (err instanceof LlmTimeoutError) {
          // No retry: a second attempt would just wait just as long.
          return { status: 'fallback', reason: 'timed out', timedOut: true, attempts: attempt, seconds: seconds() };
        }
        throw err; // LlmUnavailableError and anything unexpected
      }
      try {
        const { steps } = parseExpansion(raw, input);
        this.options.cache.set(key, steps);
        return { status: 'expanded', steps, attempts: attempt, seconds: seconds() };
      } catch (err) {
        if (!(err instanceof ExpansionRejected)) throw err;
        rejection = err.message;
      }
    }
    return { status: 'fallback', reason: rejection ?? 'rejected', attempts: this.maxAttempts, seconds: seconds() };
  }
}
