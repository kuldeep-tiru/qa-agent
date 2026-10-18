/**
 * A2 Test Generation agent.
 * 1. Build deterministic test cases from the graph (IDs, priority, type, skeleton steps).
 * 2. Optionally refine the steps with the LLM, one scenario at a time.
 * 3. Hand the result to the sink (Excel).
 * Contract: QA_Agent_System_Design.md section 7.
 */
import { LlmUnavailableError } from '../domain/llm-client.js';
import type { Graph } from '../domain/graph.js';
import { TestCaseSchema, type TestCase } from '../domain/test-case.js';
import type { TestCaseSink, WriteOutcome } from '../domain/test-case-sink.js';
import { buildTestCaseEntries } from '../domain/test-case-builder.js';
import type { ExpansionStatus, StepExpander } from './step-expander.js';

export type GenerationEvent =
  | { type: 'expansion-start'; total: number; model: string }
  | { type: 'case'; index: number; total: number; id: string; status: ExpansionStatus; seconds: number; reason?: string }
  | { type: 'expansion-aborted'; reason: string };

export interface GenerationOptions {
  expander?: StepExpander;
  /** Expand at most this many scenarios that are not cached yet. Cached ones are always used. */
  maxNewExpansions?: number;
  onEvent?: (event: GenerationEvent) => void;
}

export interface ExpansionSummary {
  expanded: number;
  cached: number;
  fallback: number;
  skipped: number;
  aborted?: string;
}

export interface GenerationResult {
  testCases: TestCase[];
  outcome: WriteOutcome;
  /** Only present when an expander was used. */
  expansion?: ExpansionSummary;
}

/** Stop asking the model after this many timeouts in a row: it is too slow for this machine. */
const MAX_CONSECUTIVE_TIMEOUTS = 2;

export class TestGeneration {
  constructor(private readonly sink: TestCaseSink) {}

  async run(graph: Graph, options: GenerationOptions = {}): Promise<GenerationResult> {
    const entries = buildTestCaseEntries(graph);
    const { expander, onEvent } = options;
    let expansion: ExpansionSummary | undefined;

    if (expander) {
      expansion = { expanded: 0, cached: 0, fallback: 0, skipped: 0 };
      onEvent?.({ type: 'expansion-start', total: entries.length, model: expander.model });
      let newCalls = 0;
      let consecutiveTimeouts = 0;

      for (const [i, entry] of entries.entries()) {
        const id = entry.testCase.id;
        const emit = (status: ExpansionStatus, seconds: number, reason?: string) =>
          onEvent?.({ type: 'case', index: i + 1, total: entries.length, id, status, seconds, ...(reason ? { reason } : {}) });

        if (expansion.aborted) {
          expansion.skipped += 1;
          emit('skipped', 0, 'expansion stopped');
          continue;
        }

        const allowCall = options.maxNewExpansions === undefined || newCalls < options.maxNewExpansions;
        try {
          const result = await expander.expand(entry, allowCall);
          if (result.attempts > 0) newCalls += 1;
          consecutiveTimeouts = result.timedOut ? consecutiveTimeouts + 1 : 0;

          if (result.steps) {
            entry.testCase = TestCaseSchema.parse({ ...entry.testCase, steps: result.steps });
          }
          expansion[result.status] += 1;
          emit(result.status, result.seconds, result.reason);

          if (consecutiveTimeouts >= MAX_CONSECUTIVE_TIMEOUTS) {
            expansion.aborted = `the model timed out ${MAX_CONSECUTIVE_TIMEOUTS} times in a row`;
            onEvent?.({ type: 'expansion-aborted', reason: expansion.aborted });
          }
        } catch (err) {
          if (!(err instanceof LlmUnavailableError)) throw err;
          expansion.aborted = err.message;
          expansion.skipped += 1;
          emit('skipped', 0, 'model unavailable');
          onEvent?.({ type: 'expansion-aborted', reason: err.message });
        }
      }
    }

    const testCases = entries.map((entry) => entry.testCase);
    const outcome = await this.sink.write(testCases);
    return { testCases, outcome, ...(expansion ? { expansion } : {}) };
  }
}
