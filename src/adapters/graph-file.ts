/**
 * Reads a project's graph.json from disk and validates it.
 * Keeps file access out of the domain layer.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseGraph, type ParseResult } from '../domain/graph.js';

export function graphPath(rootDir: string, project: string): string {
  return join(rootDir, 'projects', project, 'graph.json');
}

export function loadGraphFile(filePath: string): ParseResult {
  if (!existsSync(filePath)) {
    return { ok: false, errors: [`graph file not found: ${filePath}`] };
  }
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { ok: false, errors: [`graph.json is not valid JSON: ${reason}`] };
  }
  return parseGraph(data);
}
