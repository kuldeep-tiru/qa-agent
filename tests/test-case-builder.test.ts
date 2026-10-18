import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseGraph, type Graph, type Scenario } from '../src/domain/graph.js';
import { buildTestCases, buildTitle } from '../src/domain/test-case-builder.js';
import { inferPriority, inferTestType } from '../src/domain/test-rules.js';
import { TestGeneration } from '../src/agents/test-generation.js';
import { ExcelTestCaseSink } from '../src/excel/template-writer.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const raw = () => JSON.parse(readFileSync(join(root, 'projects', 'saucedemo-pilot', 'graph.json'), 'utf-8'));
const pilot = (): Graph => {
  const r = parseGraph(raw());
  if (!r.ok) throw new Error(r.errors.join('\n'));
  return r.graph;
};
const byId = (id: string) => buildTestCases(pilot()).find((t) => t.id === id)!;

describe('buildTitle', () => {
  it('prefixes Verify and lowercases the first word', () => {
    assert.equal(buildTitle('Login with a valid username and password'), 'Verify login with a valid username and password');
  });
  it('keeps acronyms and existing Verify prefixes', () => {
    assert.equal(buildTitle('SEO tags are present'), 'Verify SEO tags are present');
    assert.equal(buildTitle('Verify cart total'), 'Verify cart total');
  });
});

describe('buildTestCases on the SauceDemo pilot graph', () => {
  it('makes one case per scenario with unique, well-formed ids', () => {
    const cases = buildTestCases(pilot());
    assert.equal(cases.length, 14);
    assert.equal(new Set(cases.map((c) => c.id)).size, 14);
    assert.equal(cases[0]!.id, 'TC_Auth_ValidLogin_001');
    assert.ok(cases.every((c) => c.status === 'Not Executed'));
  });

  it('is deterministic', () => {
    assert.deepEqual(buildTestCases(pilot()), buildTestCases(pilot()));
  });

  it('maps feature, requirement, title and preconditions like the template example', () => {
    const c = byId('TC_Auth_ValidLogin_001');
    assert.equal(c.scenario, 'Login');
    assert.equal(c.requirementRef, 'BR 1.1');
    assert.equal(c.title, 'Verify login with a valid username and password');
    assert.deepEqual(c.preconditions, ['User is on the SauceDemo login page']);
  });

  it('turns triggers into steps and puts the criteria on the last step only', () => {
    const c = byId('TC_Auth_ValidLogin_001');
    assert.equal(c.steps.length, 2);
    assert.equal(c.steps[0]!.description, 'User enters standard_user and secret_sauce');
    assert.equal(c.steps[0]!.expected, undefined);
    assert.equal(
      c.steps[1]!.expected,
      'AC-AUTH-01: User is redirected to the products page\nAC-AUTH-02: The products page shows the inventory list',
    );
  });

  it('applies the priority rules', () => {
    const p = (id: string) => byId(id).priority;
    assert.equal(p('TC_Auth_ValidLogin_001'), 'High');
    assert.equal(p('TC_Auth_InvalidPassword_001'), 'Medium');
    assert.equal(p('TC_Auth_EmptyCredentials_001'), 'Medium');
    assert.equal(p('TC_Checkout_CompleteOrder_001'), 'High');
    assert.equal(p('TC_Checkout_CheckoutRequiredFields_001'), 'Medium');
    assert.equal(p('TC_Cart_AddToCart_001'), 'Low');
    assert.equal(p('TC_Inventory_SortByName_001'), 'Low');
    assert.equal(p('TC_Auth_LogoutFromMenu_001'), 'Low');
  });

  it('uses the test type from graph.json', () => {
    assert.equal(byId('TC_Auth_LockedOutUser_001').testType, 'Negative');
    assert.equal(byId('TC_Checkout_CompleteOrder_001').testType, 'End-to-End');
  });
});

describe('rules', () => {
  const scenario = (over: Partial<Scenario>): Scenario => ({
    id: 'X',
    title: 'Something happens',
    preconditions: [],
    triggers: [],
    acceptanceCriteria: [{ id: 'AC-1', text: 'It works as expected' }],
    ...over,
  });
  const ctx = { moduleName: 'Shop', featureName: 'Browsing' };

  it('lets an explicit priority and test type win', () => {
    const s = scenario({ priority: 'High', testType: 'Security' });
    assert.equal(inferPriority(s, ctx), 'High');
    assert.equal(inferTestType(s), 'Security');
  });

  it('infers Validation, Negative and Functional from the wording', () => {
    assert.equal(inferTestType(scenario({ title: 'Submit with an empty name' })), 'Validation');
    assert.equal(inferTestType(scenario({ title: 'Login with a wrong password' })), 'Negative');
    assert.equal(inferTestType(scenario({})), 'Functional');
  });

  it('treats login, payment and checkout names as critical', () => {
    assert.equal(inferPriority(scenario({}), { moduleName: 'Payments', featureName: 'Payment methods' }), 'High');
    assert.equal(inferPriority(scenario({}), { moduleName: 'Shop', featureName: 'Checkout' }), 'High');
    assert.equal(inferPriority(scenario({}), ctx), 'Low');
  });

  it('falls back to one step named after the scenario when there are no triggers', () => {
    const g = raw();
    g.modules[0].features[0].scenarios[0].triggers = [];
    const parsed = parseGraph(g);
    assert.ok(parsed.ok);
    if (parsed.ok) {
      const c = buildTestCases(parsed.graph)[0]!;
      assert.equal(c.steps.length, 1);
      assert.equal(c.steps[0]!.description, 'Login with a valid username and password');
      assert.match(c.steps[0]!.expected ?? '', /AC-AUTH-01/);
    }
  });
});

describe('TestGeneration agent with the Excel sink', () => {
  let dir: string;
  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'qa-agent-gen-'));
  });
  after(() => rmSync(dir, { recursive: true, force: true }));

  it('writes every pilot test case to the workbook', async () => {
    const sink = new ExcelTestCaseSink({
      templatePath: join(root, 'templates', 'QA Test Case Template.xlsx'),
      outputDir: dir,
      baseName: 'pilot',
    });
    const { testCases, outcome } = await new TestGeneration(sink).run(pilot());
    assert.equal(outcome.casesWritten, 14);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(outcome.path);
    const ws = wb.getWorksheet('Functional Testing')!;
    const ids = new Set<string>();
    ws.eachRow((row, n) => {
      const v = row.getCell(1).value;
      if (n > 1 && typeof v === 'string' && v.startsWith('TC_')) ids.add(v);
    });
    assert.deepEqual([...ids].sort(), testCases.map((t) => t.id).sort());
  });
});
