/**
 * Week 2 exit criterion from the design doc: "Excel output matches your template columns".
 * Runs the whole deterministic pipeline (graph -> test cases -> Excel) on the SauceDemo
 * pilot graph and checks the result against the master template and the graph.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseGraph } from '../src/domain/graph.js';
import { TestGeneration } from '../src/agents/test-generation.js';
import { ExcelTestCaseSink, inspectTemplate } from '../src/excel/template-writer.js';
import { hasModel } from '../src/agents/llm-router.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const templatePath = join(root, 'templates', 'QA Test Case Template.xlsx');
const parsed = parseGraph(JSON.parse(readFileSync(join(root, 'projects', 'saucedemo-pilot', 'graph.json'), 'utf-8')));
if (!parsed.ok) throw new Error(parsed.errors.join('\n'));
const graph = parsed.graph;

const headers = (ws: ExcelJS.Worksheet) => (ws.getRow(1).values as ExcelJS.CellValue[]).slice(1).map(String);

let dir: string;
let output: ExcelJS.Workbook;
let master: ExcelJS.Workbook;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'qa-agent-week2-'));
  const sink = new ExcelTestCaseSink({ templatePath, outputDir: dir, baseName: 'pilot' });
  const { outcome } = await new TestGeneration(sink).run(graph);
  output = new ExcelJS.Workbook();
  await output.xlsx.readFile(outcome.path);
  master = new ExcelJS.Workbook();
  await master.xlsx.readFile(templatePath);
});
after(() => rmSync(dir, { recursive: true, force: true }));

describe('Week 2 exit: output matches the template', () => {
  it('has the same sheets and the same Functional Testing columns as the master', () => {
    assert.deepEqual(output.worksheets.map((s) => s.name), master.worksheets.map((s) => s.name));
    assert.deepEqual(headers(output.getWorksheet('Functional Testing')!), headers(master.getWorksheet('Functional Testing')!));
  });

  it('fills the identity, priority, status and type columns for every case', () => {
    const ws = output.getWorksheet('Functional Testing')!;
    let cases = 0;
    ws.eachRow((row, n) => {
      // Merged cells repeat their value on every row of the block, so count only each block's first row.
      if (n === 1 || String(row.getCell(6).value ?? '') !== 'Step 01') return;
      assert.ok(String(row.getCell(1).value ?? '').startsWith('TC_'), `row ${n} does not start a case`);
      cases += 1;
      for (const col of [1, 2, 3, 4, 5, 11, 12, 13]) {
        assert.ok(String(row.getCell(col).value ?? '').trim() !== '', `row ${n}, column ${col} is empty`);
      }
      assert.ok(String(row.getCell(7).value ?? '') !== '', `row ${n} has no step description`);
    });
    assert.equal(cases, 14);
  });

  it('keeps every acceptance criterion visible in Expected Results (traceability)', () => {
    const ws = output.getWorksheet('Functional Testing')!;
    const expected = ws.getColumn(9).values.map((v) => String(v ?? '')).join('\n');
    const ids = graph.modules.flatMap((m) => m.features.flatMap((f) => f.scenarios.flatMap((s) => s.acceptanceCriteria.map((a) => a.id))));
    assert.equal(ids.length, 26);
    for (const id of ids) assert.ok(expected.includes(id), `${id} is missing from Expected Results`);
  });

  it('leaves Coverage formulas intact, local, and covering the full range', () => {
    const ws = output.getWorksheet('Coverage')!;
    let formulas = 0;
    ws.eachRow((row) =>
      row.eachCell((cell) => {
        const v = cell.value as { formula?: string } | null;
        if (v && typeof v === 'object' && 'formula' in v && v.formula) {
          formulas += 1;
          assert.doesNotMatch(v.formula, /\[\d+\]/, `external link in ${cell.address}`);
          if (v.formula.includes("'Functional Testing'!")) assert.match(v.formula, /\$2000/);
        }
      }),
    );
    assert.ok(formulas > 100);
  });
});

describe('environment helpers', () => {
  it('accepts the master template and reports damaged or missing ones clearly', async () => {
    const good = await inspectTemplate(templatePath);
    assert.deepEqual(good, { ok: true, columnCount: 13 });
    const missing = await inspectTemplate(join(dir, 'nope.xlsx'));
    assert.equal(missing.ok, false);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(templatePath);
    wb.getWorksheet('Functional Testing')!.getCell('L1').value = 'State';
    const broken = join(dir, 'broken.xlsx');
    await wb.xlsx.writeFile(broken);
    const result = await inspectTemplate(broken);
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /missing header\(s\): Status/);
  });

  it('matches model names exactly, allowing only the :latest tag', () => {
    const installed = ['qwen2.5:7b-instruct', 'nomic-embed-text:latest'];
    assert.equal(hasModel(installed, 'qwen2.5:7b-instruct'), true);
    assert.equal(hasModel(installed, 'nomic-embed-text'), true);
    assert.equal(hasModel(installed, 'qwen2.5:3b'), false);
    assert.equal(hasModel(['qwen2.5:3b'], 'qwen2.5:7b-instruct'), false);
  });
});
