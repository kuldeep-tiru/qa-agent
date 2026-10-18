/**
 * Port for a language model that must answer with JSON.
 * Agents depend on this interface, never on Ollama directly, so the same code
 * works with a fake in tests and with another provider later.
 */
export interface JsonRequest {
  system: string;
  prompt: string;
  /** JSON Schema the answer must follow (Ollama constrains decoding to it). */
  schema: Record<string, unknown>;
}

export interface LlmClient {
  readonly model: string;
  /** Returns the raw JSON text produced by the model. */
  generateJson(request: JsonRequest): Promise<string>;
}

/** The model cannot be used at all (not running, model missing, server error). Stop trying. */
export class LlmUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LlmUnavailableError';
  }
}

/** One request took longer than the allowed time. */
export class LlmTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LlmTimeoutError';
  }
}
