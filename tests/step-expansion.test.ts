import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseGraph, type Graph } from '../src/domain/graph.js';
import { buildTestCaseEntries, type TestCaseEntry } from '../src/domain/test-case-builder.js';
import {
  ExpansionRejected,
  PROMPT_VERSION,
  buildPrompt,
  llmStepsJsonSchema,
  parseExpansion,
  toExpansionInput,
} from '../src/domain/step-expansion.js';
import { LlmTimeoutError, LlmUnavailableError, type JsonRequest, type LlmClient } from '../src/domain/llm-client.js';
import { StepExpander } from '../src/agents/step-expander.js';
import { TestGeneration, type GenerationEvent } from '../src/agents/test-generation.js';
import { FileExpansionCache, cacheKey } from '../src/knowledge/expansion-cache.js';
import { OllamaLlmClient } from '../src/agents/ollama-client.js';
import type { TestCaseSink } from '../src/domain/test-case-sink.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const pilot = (): Graph => {
  const r = parseGraph(JSON.parse(readFileSync(join(root, 'projects', 'saucedemo-pilot', 'graph.json'), 'utf-8')));
  if (!r.ok) throw new Error(r.errors.join('\n'));
  return r.graph;
};
const entries = () => buildTestCaseEntries(pilot());
const entry = (id: string): TestCaseEntry => entries().find((e) => e.testCase.id === id)!;
const loginEntry = () => entry('TC_Auth_ValidLogin_001');

/** A model answer for ValidLogin that satisfies every rule. */
const goodAnswer = JSON.stringify({
  steps: [
    { description: 'Enter the username', testData: 'standard_user', expected: '' },
    { description: 'Enter the password', testData: 'secret_sauce', expected: '' },
    {
      description: 'Click Login',
      testData: '',
      expected: 'AC-AUTH-01: User is redirected to the products page\nAC-AUTH-02: The products page shows the inventory list',
    },
  ],
});

class FakeClient implements LlmClient {
  readonly model = 'fake-model';
  calls: JsonRequest[] = [];
  constructor(private readonly script: (call: number, request: JsonRequest) => string | Error) {}
  async generateJson(request: JsonRequest): Promise<string> {
    this.calls.push(request);
    const result = this.script(this.calls.length, request);
    if (result instanceof Error) throw result;
    return result;
  }
}

class MemoryCache {
  store = new Map<string, import('../src/domain/test-case.js').TestStep[]>();
  get(key: string) { return this.store.get(key); }
  set(key: string, steps: import('../src/domain/test-case.js').TestStep[]) { this.store.set(key, steps); }
}

const nullSink: TestCaseSink = { write: async (cases) => ({ path: 'memory', version: 1, casesWritten: cases.length }) };

describe('prompt and schema', () => {
  it('builds a prompt that contains the scenario facts and criteria ids', () => {
    const prompt = buildPrompt(toExpansionInput(loginEntry()));
    assert.match(prompt, /https:\/\/www\.saucedemo\.com/);
    assert.match(prompt, /Scenario: Login with a valid username and password/);
    assert.match(prompt, /1\. User enters standard_user and secret_sauce/);
    assert.match(prompt, /AC-AUTH-01/);
  });

  it('adds the rejection reason on a retry', () => {
    const prompt = buildPrompt(toExpansionInput(loginEntry()), 'the answer was not valid JSON');
    assert.match(prompt, /previous answer was rejected: the answer was not valid JSON/);
  });

  it('gives Ollama a plain JSON schema without the $schema key', () => {
    const schema = llmStepsJsonSchema();
    assert.equal(schema['$schema'], undefined);
    assert.equal(schema['type'], 'object');
  });
});

describe('parseExpansion', () => {
  const input = () => toExpansionInput(loginEntry());

  it('accepts a good answer and turns empty strings into missing fields', () => {
    const { steps, notes } = parseExpansion(goodAnswer, input());
    assert.equal(steps.length, 3);
    assert.equal(steps[0]!.testData, 'standard_user');
    assert.equal(steps[0]!.expected, undefined);
    assert.deepEqual(notes, []);
  });

  it('rejects text that is not JSON and answers that break the format', () => {
    assert.throws(() => parseExpansion('Sure! Here are the steps', input()), ExpansionRejected);
    assert.throws(() => parseExpansion(JSON.stringify({ steps: [] }), input()), /did not match the format/);
    assert.throws(() => parseExpansion(JSON.stringify({ steps: [{ description: 'x' }] }), input()), ExpansionRejected);
  });

  it('rejects an invented URL but allows the base URL and paths below it', () => {
    const withUrl = (url: string) =>
      JSON.stringify({ steps: [{ description: `Open ${url}`, testData: '', expected: 'AC-AUTH-01 AC-AUTH-02' }] });
    assert.throws(() => parseExpansion(withUrl('https://evil.example.com/login'), input()), /not in the scenario/);
    assert.doesNotThrow(() => parseExpansion(withUrl('https://www.saucedemo.com'), input()));
    assert.doesNotThrow(() => parseExpansion(withUrl('https://www.saucedemo.com/inventory.html.'), input()));
  });

  it('appends acceptance criteria that the model left out', () => {
    const answer = JSON.stringify({
      steps: [
        { description: 'Enter the username', testData: 'standard_user', expected: '' },
        { description: 'Click Login', testData: '', expected: 'AC-AUTH-01: User is redirected to the products page' },
      ],
    });
    const { steps, notes } = parseExpansion(answer, input());
    assert.match(steps[1]!.expected!, /AC-AUTH-02: The products page shows the inventory list/);
    assert.equal(notes.length, 1);
  });

  it('rejects steps whose descriptions are empty', () => {
    const answer = JSON.stringify({ steps: [{ description: ' ', testData: '', expected: '' }] });
    assert.throws(() => parseExpansion(answer, input()), /no usable steps/);
  });
});

describe('StepExpander', () => {
  it('expands, caches, and does not call the model again for the same scenario', async () => {
    const client = new FakeClient(() => goodAnswer);
    const expander = new StepExpander({ client, cache: new MemoryCache() });
    const first = await expander.expand(loginEntry(), true);
    assert.equal(first.status, 'expanded');
    assert.equal(first.attempts, 1);
    const second = await expander.expand(loginEntry(), true);
    assert.equal(second.status, 'cached');
    assert.equal(client.calls.length, 1);
  });

  it('retries once with the reason, then succeeds', async () => {
    const client = new FakeClient((n) => (n === 1 ? 'not json' : goodAnswer));
    const result = await new StepExpander({ client, cache: new MemoryCache() }).expand(loginEntry(), true);
    assert.equal(result.status, 'expanded');
    assert.equal(result.attempts, 2);
    assert.match(client.calls[1]!.prompt, /previous answer was rejected: the answer was not valid JSON/);
  });

  it('falls back after two bad answers and caches nothing', async () => {
    const client = new FakeClient(() => 'still not json');
    const cache = new MemoryCache();
    const result = await new StepExpander({ client, cache }).expand(loginEntry(), true);
    assert.equal(result.status, 'fallback');
    assert.equal(client.calls.length, 2);
    assert.equal(cache.store.size, 0);
  });

  it('does not retry after a timeout', async () => {
    const client = new FakeClient(() => new LlmTimeoutError('slow'));
    const result = await new StepExpander({ client, cache: new MemoryCache() }).expand(loginEntry(), true);
    assert.equal(result.status, 'fallback');
    assert.equal(result.timedOut, true);
    assert.equal(client.calls.length, 1);
  });

  it('lets an unavailable model bubble up so the caller can stop', async () => {
    const client = new FakeClient(() => new LlmUnavailableError('down'));
    await assert.rejects(() => new StepExpander({ client, cache: new MemoryCache() }).expand(loginEntry(), true), LlmUnavailableError);
  });

  it('skips scenarios that are not cached when calls are not allowed', async () => {
    const client = new FakeClient(() => goodAnswer);
    const result = await new StepExpander({ client, cache: new MemoryCache() }).expand(loginEntry(), false);
    assert.equal(result.status, 'skipped');
    assert.equal(client.calls.length, 0);
  });
});

describe('FileExpansionCache', () => {
  let dir: string;
  before(() => { dir = mkdtempSync(join(tmpdir(), 'qa-agent-cache-')); });
  after(() => rmSync(dir, { recursive: true, force: true }));

  it('persists across instances', () => {
    const file = join(dir, 'a', 'cache.json');
    const steps = [{ description: 'Click Login' }];
    new FileExpansionCache(file, 'm').set('k1', steps);
    assert.deepEqual(new FileExpansionCache(file, 'm').get('k1'), steps);
  });

  it('ignores a damaged file instead of crashing', () => {
    const file = join(dir, 'broken.json');
    writeFileSync(file, '{ this is not json');
    const cache = new FileExpansionCache(file, 'm');
    assert.equal(cache.get('anything'), undefined);
    cache.set('k', [{ description: 'Click Login' }]);
    assert.ok(cache.get('k'));
  });

  it('uses a different key when the model or the scenario text changes', () => {
    const input = toExpansionInput(loginEntry());
    const base = cacheKey('model-a', input);
    assert.notEqual(base, cacheKey('model-b', input));
    assert.notEqual(base, cacheKey('model-a', { ...input, triggers: [...input.triggers, 'extra'] }));
    assert.equal(base, cacheKey('model-a', toExpansionInput(loginEntry())));
    assert.ok(PROMPT_VERSION >= 1);
  });
});

describe('TestGeneration with an expander', () => {
  it('replaces skeleton steps, reports progress, and honours the limit', async () => {
    const client = new FakeClient(() => goodAnswer);
    const expander = new StepExpander({ client, cache: new MemoryCache() });
    const events: GenerationEvent[] = [];
    const result = await new TestGeneration(nullSink).run(pilot(), { expander, maxNewExpansions: 2, onEvent: (e) => events.push(e) });

    assert.equal(result.testCases.length, 14);
    assert.deepEqual(
      { e: result.expansion!.expanded, s: result.expansion!.skipped, f: result.expansion!.fallback },
      { e: 2, s: 12, f: 0 },
    );
    assert.equal(client.calls.length, 2);
    assert.equal(result.testCases[0]!.steps[0]!.testData, 'standard_user');
    assert.equal(result.testCases[13]!.steps[0]!.testData, undefined, 'skipped cases keep their plain steps');
    assert.equal(events.filter((e) => e.type === 'case').length, 14);
  });

  it('reuses cached scenarios without counting them against the limit', async () => {
    const cache = new MemoryCache();
    const client = new FakeClient(() => goodAnswer);
    await new TestGeneration(nullSink).run(pilot(), { expander: new StepExpander({ client, cache }), maxNewExpansions: 1 });
    const second = await new TestGeneration(nullSink).run(pilot(), { expander: new StepExpander({ client, cache }), maxNewExpansions: 1 });
    assert.equal(second.expansion!.cached, 1);
    assert.equal(second.expansion!.expanded, 1);
  });

  it('stops asking when the model is unavailable but still writes every case', async () => {
    const client = new FakeClient(() => new LlmUnavailableError('connection refused'));
    const events: GenerationEvent[] = [];
    const result = await new TestGeneration(nullSink).run(pilot(), {
      expander: new StepExpander({ client, cache: new MemoryCache() }),
      onEvent: (e) => events.push(e),
    });
    assert.equal(client.calls.length, 1);
    assert.equal(result.testCases.length, 14);
    assert.equal(result.expansion!.skipped, 14);
    assert.match(result.expansion!.aborted ?? '', /connection refused/);
    assert.ok(events.some((e) => e.type === 'expansion-aborted'));
  });

  it('stops after two timeouts in a row', async () => {
    const client = new FakeClient(() => new LlmTimeoutError('slow'));
    const result = await new TestGeneration(nullSink).run(pilot(), {
      expander: new StepExpander({ client, cache: new MemoryCache() }),
    });
    assert.equal(client.calls.length, 2);
    assert.equal(result.expansion!.fallback, 2);
    assert.equal(result.expansion!.skipped, 12);
    assert.match(result.expansion!.aborted ?? '', /timed out/);
  });

  it('falls back to plain steps for a scenario whose answers stay unusable', async () => {
    const client = new FakeClient(() => 'nope');
    const result = await new TestGeneration(nullSink).run(pilot(), {
      expander: new StepExpander({ client, cache: new MemoryCache() }),
      maxNewExpansions: 1,
    });
    assert.equal(result.expansion!.fallback, 1);
    assert.equal(result.testCases[0]!.steps[0]!.description, 'User enters standard_user and secret_sauce');
  });
});

describe('OllamaLlmClient against a mock Ollama server', () => {
  let server: Server;
  let baseUrl: string;
  let lastBody: Record<string, unknown> = {};
  let mode: 'ok' | 'missing' | 'slow' = 'ok';

  before(async () => {
    server = createServer((req, res) => {
      let data = '';
      req.on('data', (chunk) => (data += chunk));
      req.on('end', () => {
        lastBody = JSON.parse(data || '{}');
        if (mode === 'missing') {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'model not found' }));
        } else if (mode === 'slow') {
          setTimeout(() => { res.writeHead(200); res.end('{}'); }, 600);
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ response: '{"steps":[]}' }));
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  after(() => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }));

  const request: JsonRequest = { system: 'sys', prompt: 'prompt', schema: { type: 'object' } };

  it('sends the schema as format, non-streaming, with the model and keep-alive', async () => {
    mode = 'ok';
    const text = await new OllamaLlmClient({ baseUrl, model: 'qwen2.5:7b-instruct' }).generateJson(request);
    assert.equal(text, '{"steps":[]}');
    assert.equal(lastBody['model'], 'qwen2.5:7b-instruct');
    assert.equal(lastBody['stream'], false);
    assert.deepEqual(lastBody['format'], { type: 'object' });
    assert.equal(lastBody['system'], 'sys');
    assert.equal(lastBody['keep_alive'], '30m');
  });

  it('reports a missing model as unavailable', async () => {
    mode = 'missing';
    await assert.rejects(
      () => new OllamaLlmClient({ baseUrl, model: 'nope' }).generateJson(request),
      (err: Error) => err instanceof LlmUnavailableError && /404/.test(err.message),
    );
  });

  it('reports a slow answer as a timeout', async () => {
    mode = 'slow';
    await assert.rejects(() => new OllamaLlmClient({ baseUrl, model: 'm', timeoutMs: 100 }).generateJson(request), LlmTimeoutError);
  });

  it('reports an unreachable server as unavailable', async () => {
    await assert.rejects(
      () => new OllamaLlmClient({ baseUrl: 'http://127.0.0.1:9', model: 'm' }).generateJson(request),
      LlmUnavailableError,
    );
  });
});
