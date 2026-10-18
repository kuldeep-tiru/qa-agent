import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ExcelTestCaseSink, nextVersionPath } from '../src/excel/template-writer.js';
import { TestCaseSchema } from '../src/domain/test-case.js';
import { TEST_TYPES } from '../src/domain/test-types.js';
import { sampleTestCases } from './fixtures/sample-test-cases.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const templatePath = join(root, 'templates', 'QA Test Case Template.xlsx');
const sha = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');

async function open(path: string) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);
  return wb;
}

let dir: string;
before(() => {
  dir = mkdtempSync(join(tmpdir(), 'qa-agent-xlsx-'));
});
after(() => rmSync(dir, { recursive: true, force: true }));

describe('test case model', () => {
  it('accepts the sample cases and applies defaults', () => {
    assert.equal(sampleTestCases.length, 3);
    assert.equal(sampleTestCases[0]!.status, 'Not Executed');
  });

  it('rejects a malformed id and an empty step list', () => {
    const base = { ...sampleTestCases[0]! };
    assert.equal(TestCaseSchema.safeParse({ ...base, id: 'LOGIN-1' }).success, false);
    assert.equal(TestCaseSchema.safeParse({ ...base, steps: [] }).success, false);
  });
});

describe('nextVersionPath', () => {
  it('returns base, then -v2, then -v3', () => {
    const taken = new Set([join('out', 'a.xlsx'), join('out', 'a-v2.xlsx')]);
    const r = nextVersionPath('out', 'a', (p) => taken.has(p));
    assert.equal(r.version, 3);
    assert.equal(r.path, join('out', 'a-v3.xlsx'));
    assert.equal(nextVersionPath('out', 'b', () => false).version, 1);
  });
});

describe('master template', () => {
  it('lists exactly the test types the schema allows', async () => {
    const ws = (await open(templatePath)).getWorksheet('Coverage')!;
    const labels = Array.from({ length: 22 }, (_, i) => String(ws.getCell(i + 2, 1).value));
    assert.deepEqual(labels, [...TEST_TYPES]);
  });

  it('has Coverage formulas that read to row 2000 and no external links', async () => {
    const ws = (await open(templatePath)).getWorksheet('Coverage')!;
    const f = ws.getCell('B2').value as { formula: string };
    assert.match(f.formula, /\$M\$2:\$M\$2000/);
    assert.doesNotMatch(f.formula, /\[\d+\]/);
  });
});

describe('ExcelTestCaseSink', () => {
  it('writes blocks, merges, styles and values from the template layout', async () => {
    const before = sha(templatePath);
    const sink = new ExcelTestCaseSink({ templatePath, outputDir: dir, baseName: 'out' });
    const outcome = await sink.write(sampleTestCases);
    assert.equal(outcome.version, 1);
    assert.equal(outcome.casesWritten, 3);
    assert.equal(sha(templatePath), before, 'master template must not change');

    const ws = (await open(outcome.path)).getWorksheet('Functional Testing')!;
    assert.equal(ws.getCell('A1').value, 'Test Case Id');
    assert.equal(ws.getCell('M1').value, 'Test Type');

    // case 1: rows 2-5 (4 steps); separator row 6; case 2: rows 7-10 (2 steps padded to 4);
    // separator row 11; case 3: rows 12-17 (6 steps)
    assert.equal(ws.getCell('A2').value, 'TC_Auth_ValidLogin_001');
    assert.equal(ws.getCell('A7').value, 'TC_Auth_LockedOutUser_001');
    assert.equal(ws.getCell('A12').value, 'TC_Checkout_CompleteOrder_001');
    assert.equal(ws.getCell('F17').value, 'Step 06');
    assert.equal(ws.getCell('A18').value, null);

    const merges = (ws.model as { merges: string[] }).merges;
    for (const m of ['A2:A5', 'E2:E5', 'A7:A10', 'A12:A17', 'E12:E17']) assert.ok(merges.includes(m), m);

    // priority, status and type once per case, on the first row only
    assert.equal(ws.getCell('K2').value, 'High');
    assert.equal(ws.getCell('L2').value, 'Not Executed');
    assert.equal(ws.getCell('M2').value, 'Functional');
    assert.equal(ws.getCell('K3').value, null);
    assert.equal(ws.getCell('L3').value, null);

    // multiple preconditions are numbered in one cell
    assert.equal(ws.getCell('E12').value, '1. User is logged in as standard_user\n2. At least one product is in the cart');
    assert.equal(ws.getCell('H3').value, 'standard_user');

    assert.equal(ws.getCell('G2').alignment?.vertical, 'top');
    assert.ok((ws.getColumn('A').width ?? 0) >= 34);

    // separator rows keep the template's coloured fill; data rows have none
    assert.equal(ws.getCell('A6').fill.type, 'pattern');
    assert.equal(ws.getCell('A11').fill.type, 'pattern');
    assert.ok(!ws.getCell('A7').fill || (ws.getCell('A7').fill as ExcelJS.FillPattern).pattern !== 'solid');
  });

  it('keeps the other sheets and Coverage formulas intact', async () => {
    const sink = new ExcelTestCaseSink({ templatePath, outputDir: dir, baseName: 'sheets', overwrite: true });
    const outcome = await sink.write(sampleTestCases);
    const wb = await open(outcome.path);
    assert.deepEqual(
      wb.worksheets.map((s) => s.name),
      ['Summary', 'Early Observations', 'Execution Plan', 'Coverage', 'Client Mapping', 'Functional Testing', 'Defects', 'Regression Testing'],
    );
    const f = wb.getWorksheet('Coverage')!.getCell('C2').value as { formula: string };
    assert.match(f.formula, /\$L\$2:\$L\$2000/);
  });

  it('never overwrites: the second run writes -v2', async () => {
    const options = { templatePath, outputDir: dir, baseName: 'twice' };
    const first = await new ExcelTestCaseSink(options).write(sampleTestCases);
    const second = await new ExcelTestCaseSink(options).write(sampleTestCases.slice(0, 1));
    assert.equal(first.version, 1);
    assert.equal(second.version, 2);
    assert.ok(second.path.endsWith('twice-v2.xlsx'));
    assert.ok(existsSync(first.path));
  });

  it('overwrites only when asked', async () => {
    const options = { templatePath, outputDir: dir, baseName: 'forced', overwrite: true };
    const a = await new ExcelTestCaseSink(options).write(sampleTestCases);
    const b = await new ExcelTestCaseSink(options).write(sampleTestCases.slice(0, 1));
    assert.equal(a.path, b.path);
  });

  it('clears the template example when no cases are written', async () => {
    const out = await new ExcelTestCaseSink({ templatePath, outputDir: dir, baseName: 'empty' }).write([]);
    const ws = (await open(out.path)).getWorksheet('Functional Testing')!;
    assert.equal(ws.getCell('A2').value, null);
    assert.equal(ws.getCell('F2').value, null);
  });

  it('stops before the Coverage formulas would miss rows', async () => {
    const many = Array.from({ length: 450 }, (_, i) => ({
      ...sampleTestCases[1]!,
      id: `TC_Auth_Bulk_${String(i + 1).padStart(3, '0')}`,
    }));
    const sink = new ExcelTestCaseSink({ templatePath, outputDir: dir, baseName: 'many' });
    await assert.rejects(() => sink.write(many), /Too many test cases/);
  });

  it('explains a missing template and a damaged header', async () => {
    await assert.rejects(
      () => new ExcelTestCaseSink({ templatePath: join(dir, 'nope.xlsx'), outputDir: dir, baseName: 'x' }).write([]),
      /template not found/,
    );
    const wb = await open(templatePath);
    wb.getWorksheet('Functional Testing')!.getCell('M1').value = 'Kind';
    const broken = join(dir, 'broken.xlsx');
    await wb.xlsx.writeFile(broken);
    await assert.rejects(
      () => new ExcelTestCaseSink({ templatePath: broken, outputDir: dir, baseName: 'x' }).write([]),
      /missing header\(s\): Test Type/,
    );
  });
});
