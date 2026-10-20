/**
 * Settings that qa-agent hands to Playwright. They travel in one environment
 * variable because Playwright loads its config file in a separate process.
 */
import type { EvidencePolicy } from '../domain/evidence-policy.js';

export const SETTINGS_ENV = 'QA_AGENT_RUN_SETTINGS';

export interface BrowserOverride {
  /** Use a browser you already have instead of Playwright's own download. */
  executablePath?: string;
  args?: string[];
}

export interface RunSettings {
  /** Folder that contains tests/ (projects/<name>). */
  projectDir: string;
  /** Where Playwright writes raw artifacts during the run (a staging area). */
  outputDir: string;
  /** Where the JSON report is written. */
  reportFile: string;
  baseUrl?: string;
  headed: boolean;
  workers: number;
  evidence: EvidencePolicy;
  browser?: BrowserOverride;
}

export function encodeSettings(settings: RunSettings): string {
  return JSON.stringify(settings);
}

export function readSettingsFromEnv(env: NodeJS.ProcessEnv = process.env): RunSettings | undefined {
  const raw = env[SETTINGS_ENV];
  if (!raw) return undefined;
  return JSON.parse(raw) as RunSettings;
}
