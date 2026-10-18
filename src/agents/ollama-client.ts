/**
 * LlmClient backed by a local Ollama server.
 * Uses Ollama's structured output: the JSON Schema is passed as `format`, so the
 * model can only produce text that follows the schema.
 */
import { LlmTimeoutError, LlmUnavailableError, type JsonRequest, type LlmClient } from '../domain/llm-client.js';

export interface OllamaClientOptions {
  baseUrl: string;
  model: string;
  /**
   * Per-request limit. Keep it under 300000: Node's built-in fetch gives up on
   * its own after 5 minutes without a response.
   */
  timeoutMs?: number;
  /** How long Ollama keeps the model in memory after a request. */
  keepAlive?: string;
  numCtx?: number;
  /** Upper bound on generated tokens, so a runaway answer cannot hang a run. */
  numPredict?: number;
  temperature?: number;
}

export const DEFAULT_TIMEOUT_MS = 240_000;

function isTimeout(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const cause = (err as Error & { cause?: { code?: string } }).cause;
  return (
    err.name === 'TimeoutError' ||
    err.name === 'AbortError' ||
    cause?.code === 'UND_ERR_HEADERS_TIMEOUT' ||
    cause?.code === 'UND_ERR_BODY_TIMEOUT'
  );
}

export class OllamaLlmClient implements LlmClient {
  constructor(private readonly options: OllamaClientOptions) {}

  get model(): string {
    return this.options.model;
  }

  async generateJson(request: JsonRequest): Promise<string> {
    const { baseUrl, model } = this.options;
    const timeoutMs = this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    let response: Response;
    try {
      response = await fetch(`${baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
        body: JSON.stringify({
          model,
          system: request.system,
          prompt: request.prompt,
          stream: false,
          format: request.schema,
          keep_alive: this.options.keepAlive ?? '30m',
          options: {
            temperature: this.options.temperature ?? 0.2,
            num_ctx: this.options.numCtx ?? 4096,
            num_predict: this.options.numPredict ?? 1200,
          },
        }),
      });
    } catch (err) {
      if (isTimeout(err)) throw new LlmTimeoutError(`no answer from ${model} within ${Math.round(timeoutMs / 1000)}s`);
      const reason = err instanceof Error ? err.message : String(err);
      throw new LlmUnavailableError(`cannot reach Ollama at ${baseUrl} (${reason})`);
    }

    if (!response.ok) {
      const body = (await response.text().catch(() => '')).slice(0, 200);
      throw new LlmUnavailableError(`Ollama answered ${response.status} for model ${model}: ${body}`);
    }

    try {
      const data = (await response.json()) as { response?: unknown };
      return typeof data.response === 'string' ? data.response : '';
    } catch (err) {
      if (isTimeout(err)) throw new LlmTimeoutError(`no complete answer from ${model} within ${Math.round(timeoutMs / 1000)}s`);
      throw new LlmUnavailableError('Ollama sent a response that could not be read');
    }
  }
}
