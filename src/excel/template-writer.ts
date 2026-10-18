/**
 * Writes test cases into a copy of "QA Test Case Template.xlsx".
 *
 * - The master template is never modified. Each run copies it into the project.
 * - Columns are found by header label, not by letter, so reordering columns in
 *   the template does not break the writer.
 * - Cell styles are cloned from the template's own rows, so the output looks
 *   exactly like the template (borders, fills, fonts, wrapping).
 * - Re-running never overwrites an existing file: it writes -v2, -v3 ... unless
 *   `overwrite` is set. You edit these files by hand, so silent overwrites are unsafe.
 */
import ExcelJS from 'exceljs';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { TestCase } from '../domain/test-case.js';
import type { TestCaseSink, WriteOutcome } from '../domain/test-case-sink.js';

export const SHEET_NAME = 'Functional Testing';
/** Coverage formulas in the master template read rows 2 to 2000. */
export const MAX_SHEET_ROW = 2000;
/** The template shows Step 01 to Step 04 per case, so blocks have at least 4 rows. */
export const MIN_STEP_ROWS = 4;

const HEADER = {
  id: 'Test Case Id',
  requirement: 'Requirement #',
  scenario: 'Test Scenario',
  title: 'Test Cases',
  precondition: 'Pre-condition',
  step: 'Test Steps',
  stepDescription: 'Step Description',
  testData: 'Test data',
  expected: 'Expected Results',
  actual: 'Actual Results',
  priority: 'Priority',
  status: 'Status',
  testType: 'Test Type',
} as const;

/** Output-only minimum widths (the master keeps the author's widths). */
const MIN_WIDTHS: Partial<Record<keyof typeof HEADER, number>> = {
  id: 34,
  precondition: 34,
  stepDescription: 46,
  testData: 28,
  expected: 46,
  status: 14,
};

const LINE_HEIGHT = 15;

type Columns = Record<keyof typeof HEADER, number>;
type StyleMap = Map<number, Partial<ExcelJS.Style>>;

export interface ExcelSinkOptions {
  /** Path to the master template, e.g. templates/QA Test Case Template.xlsx */
  templatePath: string;
  outputDir: string;
  /** File name without extension, e.g. "saucedemo-pilot-test-cases". */
  baseName: string;
  overwrite?: boolean;
}

/** First free path: base.xlsx, then base-v2.xlsx, base-v3.xlsx ... */
export function nextVersionPath(
  outputDir: string,
  baseName: string,
  exists: (p: string) => boolean = existsSync,
): { path: string; version: number } {
  let version = 1;
  let path = join(outputDir, `${baseName}.xlsx`);
  while (exists(path)) {
    version += 1;
    path = join(outputDir, `${baseName}-v${version}.xlsx`);
  }
  return { path, version };
}

function cloneStyle(style: Partial<ExcelJS.Style>): Partial<ExcelJS.Style> {
  return structuredClone(style);
}

function findColumns(ws: ExcelJS.Worksheet): Columns {
  const byLabel = new Map<string, number>();
  ws.getRow(1).eachCell((cell, col) => byLabel.set(String(cell.value ?? '').trim(), col));
  const missing = Object.values(HEADER).filter((label) => !byLabel.has(label));
  if (missing.length > 0) {
    throw new Error(
      `Template "${SHEET_NAME}" sheet is missing header(s): ${missing.join(', ')}. ` +
        'Use the master "QA Test Case Template.xlsx" or restore the headers.',
    );
  }
  return Object.fromEntries(
    (Object.keys(HEADER) as (keyof typeof HEADER)[]).map((k) => [k, byLabel.get(HEADER[k])!]),
  ) as Columns;
}

function captureStyles(ws: ExcelJS.Worksheet, rowNumber: number, lastCol: number): StyleMap {
  const map: StyleMap = new Map();
  for (let c = 1; c <= lastCol; c++) map.set(c, cloneStyle(ws.getRow(rowNumber).getCell(c).style));
  return map;
}

function estimateLines(text: string, width: number): number {
  // 0.9 keeps the estimate on the safe side: long words and URLs wrap earlier than plain text.
  const perLine = Math.max(1, Math.floor(width * 0.9));
  return text
    .split('\n')
    .reduce((sum, line) => sum + Math.max(1, Math.ceil((line.length * 1.1) / perLine)), 0);
}

function formatPreconditions(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return items.map((p, i) => `${i + 1}. ${p}`).join('\n');
}

export class ExcelTestCaseSink implements TestCaseSink {
  constructor(private readonly options: ExcelSinkOptions) {}

  async write(testCases: readonly TestCase[]): Promise<WriteOutcome> {
    const { templatePath, outputDir, baseName, overwrite } = this.options;
    if (!existsSync(templatePath)) {
      throw new Error(`Excel template not found: ${templatePath}`);
    }

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(templatePath);
    const ws = wb.getWorksheet(SHEET_NAME);
    if (!ws) throw new Error(`Template has no "${SHEET_NAME}" sheet`);

    const cols = findColumns(ws);
    const lastCol = Math.max(...Object.values(cols));
    const identityCols = [cols.id, cols.requirement, cols.scenario, cols.title, cols.precondition];

    // Style prototypes come from the template's own example rows.
    const firstStepStyles = captureStyles(ws, 2, lastCol);
    const nextStepStyles = captureStyles(ws, 3, lastCol);
    const separatorStyles = captureStyles(ws, 6, lastCol);

    this.clearExampleRows(ws, lastCol);
    for (const [key, min] of Object.entries(MIN_WIDTHS) as [keyof typeof HEADER, number][]) {
      const column = ws.getColumn(cols[key]);
      column.width = Math.max(column.width ?? 0, min);
    }

    let row = 2;
    testCases.forEach((tc, index) => {
      if (index > 0) {
        this.paintRow(ws, row, separatorStyles, lastCol);
        row += 1;
      }
      const blockRows = Math.max(tc.steps.length, MIN_STEP_ROWS);
      const start = row;
      const end = start + blockRows - 1;
      if (end > MAX_SHEET_ROW) {
        throw new RangeError(
          `Too many test cases: the sheet would pass row ${MAX_SHEET_ROW}, which is where the Coverage formulas stop counting.`,
        );
      }

      const preconditions = formatPreconditions(tc.preconditions);
      const rowHeights: number[] = [];
      for (let i = 0; i < blockRows; i++) {
        const r = ws.getRow(start + i);
        this.paintRow(ws, start + i, i === 0 ? firstStepStyles : nextStepStyles, lastCol);
        // The template leaves step cells bottom-aligned; top alignment reads better in tall rows.
        for (let c = 1; c <= lastCol; c++) {
          if (identityCols.includes(c)) continue;
          const cell = ws.getRow(start + i).getCell(c);
          cell.alignment = { ...(cell.alignment ?? {}), vertical: 'top' };
        }
        const step = tc.steps[i];
        r.getCell(cols.step).value = `Step ${String(i + 1).padStart(2, '0')}`;
        if (step) {
          r.getCell(cols.stepDescription).value = step.description;
          if (step.testData) r.getCell(cols.testData).value = step.testData;
          if (step.expected) r.getCell(cols.expected).value = step.expected;
        }
        const lines = Math.max(
          1,
          estimateLines(step?.description ?? '', ws.getColumn(cols.stepDescription).width ?? 10),
          estimateLines(step?.testData ?? '', ws.getColumn(cols.testData).width ?? 10),
          estimateLines(step?.expected ?? '', ws.getColumn(cols.expected).width ?? 10),
        );
        rowHeights.push(lines * LINE_HEIGHT);
      }

      // Merged identity cells must fit inside the combined height of the block.
      const mergedLines = Math.max(
        estimateLines(tc.id, ws.getColumn(cols.id).width ?? 10),
        estimateLines(tc.requirementRef, ws.getColumn(cols.requirement).width ?? 10),
        estimateLines(tc.scenario, ws.getColumn(cols.scenario).width ?? 10),
        estimateLines(tc.title, ws.getColumn(cols.title).width ?? 10),
        estimateLines(preconditions, ws.getColumn(cols.precondition).width ?? 10),
      );
      const shortfall = mergedLines * LINE_HEIGHT - rowHeights.reduce((a, b) => a + b, 0);
      if (shortfall > 0) rowHeights[rowHeights.length - 1] += shortfall;
      rowHeights.forEach((h, i) => (ws.getRow(start + i).height = h));

      const first = ws.getRow(start);
      first.getCell(cols.id).value = tc.id;
      first.getCell(cols.requirement).value = tc.requirementRef;
      first.getCell(cols.scenario).value = tc.scenario;
      first.getCell(cols.title).value = tc.title;
      if (preconditions) first.getCell(cols.precondition).value = preconditions;
      first.getCell(cols.priority).value = tc.priority;
      first.getCell(cols.status).value = tc.status;
      first.getCell(cols.testType).value = tc.testType;
      for (const c of identityCols) ws.mergeCells(start, c, end, c);

      row = end + 1;
    });

    wb.creator = 'qa-agent';
    wb.calcProperties.fullCalcOnLoad = true;

    mkdirSync(outputDir, { recursive: true });
    const target = overwrite
      ? { path: join(outputDir, `${baseName}.xlsx`), version: 1 }
      : nextVersionPath(outputDir, baseName);
    mkdirSync(dirname(target.path), { recursive: true });
    await wb.xlsx.writeFile(target.path);
    return { path: target.path, version: target.version, casesWritten: testCases.length };
  }

  /** Removes the template's example rows (values, merges, styles, heights) below the header. */
  private clearExampleRows(ws: ExcelJS.Worksheet, lastCol: number): void {
    const merges: string[] = (ws.model as { merges?: string[] }).merges ?? [];
    for (const range of merges) {
      const startRow = Number(/\d+/.exec(range)?.[0] ?? 0);
      if (startRow >= 2) ws.unMergeCells(range);
    }
    for (let r = 2; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      for (let c = 1; c <= lastCol; c++) {
        const cell = row.getCell(c);
        cell.value = null;
        cell.style = {};
      }
      row.height = undefined as unknown as number;
    }
  }

  private paintRow(ws: ExcelJS.Worksheet, rowNumber: number, styles: StyleMap, lastCol: number): void {
    const row = ws.getRow(rowNumber);
    for (let c = 1; c <= lastCol; c++) row.getCell(c).style = cloneStyle(styles.get(c) ?? {});
  }
}
