/**
 * File-backed cache of LLM step expansions, stored per project in
 * knowledge/expansion-cache.json. A 7B model on a laptop is slow, so a finished
 * scenario is never asked twice, and an interrupted run can be resumed.
 * A damaged or unreadable cache file is ignored, never fatal.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';
import { PROMPT_VERSION, type ExpansionInput } from '../domain/step-expansion.js';
import { TestStepSchema, type TestStep } from '../domain/test-case.js';

export interface ExpansionStore {
  get(key: string): TestStep[] | undefined;
  set(key: string, steps: TestStep[]): void;
}

const CacheFileSchema = z.object({
  version: z.literal(1),
  entries: z.record(z.string(), z.object({ steps: z.array(TestStepSchema).min(1), model: z.string(), createdAt: z.string() })),
});

export function cacheKey(model: string, input: ExpansionInput): string {
  return createHash('sha256').update(JSON.stringify({ v: PROMPT_VERSION, model, input })).digest('hex');
}

export class FileExpansionCache implements ExpansionStore {
  private entries: Record<string, { steps: TestStep[]; model: string; createdAt: string }> = {};

  constructor(
    private readonly filePath: string,
    private readonly model: string,
  ) {
    if (!existsSync(filePath)) return;
    try {
      const parsed = CacheFileSchema.safeParse(JSON.parse(readFileSync(filePath, 'utf-8')));
      if (parsed.success) this.entries = parsed.data.entries;
    } catch {
      // unreadable cache: start empty
    }
  }

  get(key: string): TestStep[] | undefined {
    return this.entries[key]?.steps;
  }

  set(key: string, steps: TestStep[]): void {
    this.entries[key] = { steps, model: this.model, createdAt: new Date().toISOString() };
    mkdirSync(dirname(this.filePath), { recursive: true });
    const temp = `${this.filePath}.tmp`;
    writeFileSync(temp, JSON.stringify({ version: 1, entries: this.entries }, null, 2) + '\n', 'utf-8');
    renameSync(temp, this.filePath);
  }
}
