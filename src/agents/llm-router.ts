/**
 * LLM Router — single gateway every agent talks to.
 * Primary: local Ollama (free). Escalation: BYOK Anthropic key, or manual
 * paste into Claude web chat via an exported brief (budget = 0 path).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface AgentConfig {
  llm: {
    ollamaBaseUrl: string;
    chatModel: string;
    embedModel: string;
    anthropicApiKey?: string;
  };
  evidence: Record<string, unknown>;
  liveSiteSafety: Record<string, unknown>;
}

export function loadConfig(rootDir: string): AgentConfig {
  const raw = readFileSync(join(rootDir, 'config', 'agent.config.json'), 'utf-8');
  return JSON.parse(raw) as AgentConfig;
}

export async function pingOllama(baseUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function listLocalModels(baseUrl: string): Promise<string[]> {
  const res = await fetch(`${baseUrl}/api/tags`);
  if (!res.ok) throw new Error(`Ollama responded ${res.status}`);
  const data = (await res.json()) as { models?: { name: string }[] };
  return (data.models ?? []).map((m) => m.name);
}

export interface GenerateOptions {
  model?: string;
  system?: string;
  formatJson?: boolean;
  temperature?: number;
}

/** One-shot generation via Ollama. Throws if Ollama is unreachable. */
export async function generate(
  baseUrl: string,
  prompt: string,
  opts: GenerateOptions = {},
): Promise<string> {
  const res = await fetch(`${baseUrl}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: opts.model,
      prompt,
      system: opts.system,
      stream: false,
      format: opts.formatJson ? 'json' : undefined,
      options: { temperature: opts.temperature ?? 0.2 },
    }),
  });
  if (!res.ok) throw new Error(`Ollama generate failed: ${res.status}`);
  const data = (await res.json()) as { response: string };
  return data.response;
}

/** Returns the escalation path available right now. */
export function escalationPath(config: AgentConfig): 'anthropic-api' | 'claude-web-manual' {
  return config.llm.anthropicApiKey ? 'anthropic-api' : 'claude-web-manual';
}

/**
 * Builds the compact RCA brief you can paste into free Claude web chat
 * when the local model's hypothesis confidence is low.
 */
export function buildClaudeWebBrief(input: {
  project: string;
  testCaseId: string;
  failureSummary: string;
  consoleErrors: string[];
  lastRequests: string[];
}): string {
  const lines = [
    'You are assisting a QA engineer doing root cause analysis. Reply with:',
    '1) Most likely root cause (ranked hypotheses)',
    '2) Evidence that would confirm each',
    '3) Suggested fix / next test to isolate',
    '',
    `Project: ${input.project}`,
    `Test Case: ${input.testCaseId}`,
    `Failure: ${input.failureSummary}`,
    `Console errors:\n${input.consoleErrors.slice(0, 20).join('\n')}`,
    `Recent network requests:\n${input.lastRequests.slice(0, 20).join('\n')}`,
  ];
  return lines.join('\n');
}
