/**
 * A2 Test Generation agent.
 * Slice 3: deterministic graph -> test cases -> sink (Excel).
 * Slice 4 adds optional LLM step expansion between building and writing.
 * Contract: QA_Agent_System_Design.md section 7.
 */
import type { Graph } from '../domain/graph.js';
import type { TestCase } from '../domain/test-case.js';
import type { TestCaseSink, WriteOutcome } from '../domain/test-case-sink.js';
import { buildTestCases } from '../domain/test-case-builder.js';

export interface GenerationResult {
  testCases: TestCase[];
  outcome: WriteOutcome;
}

export class TestGeneration {
  constructor(private readonly sink: TestCaseSink) {}

  async run(graph: Graph): Promise<GenerationResult> {
    const testCases = buildTestCases(graph);
    const outcome = await this.sink.write(testCases);
    return { testCases, outcome };
  }
}
