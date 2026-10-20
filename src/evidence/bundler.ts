/**
 * EvidenceBundler: moves the raw files Playwright produced into the layout
 *   evidence/<runId>/<TestCaseId>/{trace.zip, failure.png, video.webm, network.har, console.log}
 * so every result points at evidence by Test Case Id.
 *
 * Rules:
 * - Evidence is moved, never copied twice and never deleted, except the HAR of a
 *   passed test (it is recorded for every test and only kept for failures).
 * - Videos over the policy limit are kept but flagged, so packaging can leave them out.
 * - The raw staging folder is removed only after every file has been moved.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import type { EvidencePolicy } from '../domain/evidence-policy.js';
import {
  extractTestCaseId,
  isFailure,
  type EvidenceFile,
  type EvidenceKind,
  type TestResult,
} from '../domain/run-result.js';
import type { ParsedAttachment, ParsedTest } from './report-parser.js';

export interface BundleInput {
  /** projects/<name> */
  projectDir: string;
  /** projects/<name>/evidence/<runId> */
  runDir: string;
  /** Playwright's staging output folder for this run. */
  rawDir: string;
  tests: readonly ParsedTest[];
  policy: EvidencePolicy;
}

const slug = (text: string) => text.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'test';

function classify(attachment: ParsedAttachment): EvidenceKind {
  const name = attachment.name.toLowerCase();
  if (name === 'trace') return 'trace';
  if (name === 'screenshot') return 'screenshot';
  if (name === 'video') return 'video';
  if (name === 'console') return 'console';
  if (name === 'error-context') return 'context';
  return 'other';
}

function moveFile(from: string, to: string): void {
  mkdirSync(dirname(to), { recursive: true });
  try {
    renameSync(from, to);
  } catch {
    copyFileSync(from, to); // different drive: copy, then remove the original
    unlinkSync(from);
  }
}

export interface BundleOutput {
  results: TestResult[];
  /** Run-level warnings, for example files that could not be classified. */
  warnings: string[];
}

export class EvidenceBundler {
  bundle(input: BundleInput): BundleOutput {
    const { projectDir, runDir, rawDir, tests, policy } = input;
    const usedFolders = new Map<string, number>();
    const maxVideoBytes = policy.maxVideoMbPerDefect * 1024 * 1024;
    const toRelative = (absolute: string) => relative(projectDir, absolute).split('\\').join('/');

    const results = tests.map((test): TestResult => {
      const caseId = extractTestCaseId(test.title);
      const baseId = caseId ?? `_unmapped-${slug(test.title)}`;
      const seen = (usedFolders.get(baseId) ?? 0) + 1;
      usedFolders.set(baseId, seen);
      const id = seen === 1 ? baseId : `${baseId}-${seen}`;

      const warnings: string[] = [];
      if (!caseId) warnings.push('the spec title does not start with a Test Case Id (TC_<Module>_<Scenario>_001)');
      if (seen > 1) warnings.push(`the Test Case Id appears more than once; this result is stored as ${id}`);

      const failed = isFailure(test.status);
      const targetDir = join(runDir, id);
      const evidence: EvidenceFile[] = [];
      const counters: Partial<Record<EvidenceKind, number>> = {};
      const sourceDirs = new Set<string>();

      /** Picks a free file name in the test's evidence folder, stores the file, and records it. */
      const place = (kind: EvidenceKind, preferredName: string, store: (to: string) => void) => {
        const count = (counters[kind] = (counters[kind] ?? 0) + 1);
        const dot = preferredName.lastIndexOf('.');
        const name = count === 1 || dot < 0 ? preferredName : `${preferredName.slice(0, dot)}-${count}${preferredName.slice(dot)}`;
        const to = join(targetDir, name);
        mkdirSync(targetDir, { recursive: true });
        store(to);
        const sizeBytes = statSync(to).size;
        const file: EvidenceFile = { kind, path: toRelative(to), sizeBytes };
        if (kind === 'video' && sizeBytes > maxVideoBytes) {
          file.oversize = true;
          warnings.push(`video is ${(sizeBytes / 1024 / 1024).toFixed(1)} MB, over the ${policy.maxVideoMbPerDefect} MB limit; packaging will leave it out`);
        }
        evidence.push(file);
      };
      const keep = (kind: EvidenceKind, from: string, preferredName: string) => place(kind, preferredName, (to) => moveFile(from, to));

      const preferredNameFor = (kind: EvidenceKind, fallback: string): string =>
        kind === 'trace' ? 'trace.zip' : kind === 'screenshot' ? 'failure.png' : kind === 'video' ? 'video.webm' : kind === 'console' ? 'console.log' : kind === 'context' ? 'error-context.md' : fallback;

      for (const attachment of test.attachments) {
        if (attachment.path) sourceDirs.add(dirname(attachment.path));
        if (test.status === 'skipped') {
          if (attachment.path && existsSync(attachment.path)) unlinkSync(attachment.path); // a skipped test has nothing to prove
          continue;
        }
        const kind = classify(attachment);
        if (attachment.path) {
          if (!existsSync(attachment.path)) {
            warnings.push(`the ${attachment.name || 'attachment'} file listed in the report was not found`);
            continue;
          }
          keep(kind, attachment.path, preferredNameFor(kind, basename(attachment.path)));
        } else if (attachment.body !== undefined) {
          const content = Buffer.from(attachment.body, 'base64');
          place(kind, preferredNameFor(kind, `${slug(attachment.name)}.txt`), (to) => writeFileSync(to, content));
        }
      }

      // The HAR sits next to the other artifacts of the same test.
      for (const dir of sourceDirs) {
        const har = join(dir, 'network.har');
        if (!existsSync(har)) continue;
        if (failed || !policy.harOnFailure) keep('har', har, 'network.har');
        else unlinkSync(har);
      }

      return {
        id,
        mapped: caseId !== undefined,
        title: test.title,
        file: test.file,
        status: test.status,
        durationMs: test.durationMs,
        ...(test.error ? { error: test.error } : {}),
        evidence,
        warnings,
      };
    });

    return { results, warnings: pruneRaw(rawDir, projectDir) };
  }
}

/**
 * Removes Playwright's bookkeeping file and any empty folders from the staging area.
 * Files that were not claimed by a test are left in place and reported, never deleted.
 */
function pruneRaw(rawDir: string, projectDir: string): string[] {
  if (!existsSync(rawDir)) return [];
  rmSync(join(rawDir, '.last-run.json'), { force: true });
  const leftovers: string[] = [];
  const prune = (dir: string): boolean => {
    let empty = true;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!prune(full)) empty = false;
      } else {
        leftovers.push(relative(projectDir, full).split('\\').join('/'));
        empty = false;
      }
    }
    if (empty) rmSync(dir, { recursive: true, force: true });
    return empty;
  };
  prune(rawDir);
  return leftovers.length > 0 ? [`${leftovers.length} file(s) were not linked to a test and stay in the raw folder: ${leftovers.slice(0, 5).join(', ')}`] : [];
}
