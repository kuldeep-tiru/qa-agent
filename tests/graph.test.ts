import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { graphStats, parseGraph } from '../src/domain/graph.js';
import { loadGraphFile } from '../src/adapters/graph-file.js';
import { TEST_TYPES } from '../src/domain/test-types.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const pilotPath = join(root, 'projects', 'saucedemo-pilot', 'graph.json');
const pilot = () => JSON.parse(readFileSync(pilotPath, 'utf-8'));

describe('requirement graph schema', () => {
  it('accepts the SauceDemo pilot graph', () => {
    const result = parseGraph(pilot());
    assert.equal(result.ok, true);
    if (result.ok) {
      const s = graphStats(result.graph);
      assert.deepEqual(s, { modules: 4, features: 7, scenarios: 14, acceptanceCriteria: 26 });
    }
  });

  it('uses 22 test types matching the Coverage sheet', () => {
    assert.equal(TEST_TYPES.length, 22);
  });

  it('rejects an empty graph with a helpful message', () => {
    const result = parseGraph({ project: 'demo-project', version: '0.1', modules: [] });
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.errors[0]!, /no modules yet/);
  });

  it('rejects unknown keys (typo protection)', () => {
    const g = pilot();
    g.modules[0].features[0].scenarios[0].preconditon = ['typo'];
    const result = parseGraph(g);
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.errors.join('\n'), /preconditon/);
  });

  it('rejects duplicate scenario ids and reports where', () => {
    const g = pilot();
    g.modules[0].features[0].scenarios[1].id = g.modules[0].features[0].scenarios[0].id;
    const result = parseGraph(g);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.errors.join('\n'), /modules\[0\]\.features\[0\]\.scenarios\[1\]\.id: duplicate scenario id/);
    }
  });

  it('rejects ids that cannot be joined into a test case id', () => {
    const g = pilot();
    g.modules[0].id = 'Auth_Module';
    const result = parseGraph(g);
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.errors.join('\n'), /modules\[0\]\.id/);
  });

  it('rejects a test type that is not on the Coverage sheet', () => {
    const g = pilot();
    g.modules[0].features[0].scenarios[0].testType = 'Smoke';
    assert.equal(parseGraph(g).ok, false);
  });

  it('requires a requirementRef on every feature', () => {
    const g = pilot();
    delete g.modules[0].features[0].requirementRef;
    const result = parseGraph(g);
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.errors.join('\n'), /requirementRef/);
  });

  it('requires at least one acceptance criterion per scenario', () => {
    const g = pilot();
    g.modules[0].features[0].scenarios[0].acceptanceCriteria = [];
    assert.equal(parseGraph(g).ok, false);
  });
});

describe('graph file loader', () => {
  it('loads and validates the pilot graph from disk', () => {
    assert.equal(loadGraphFile(pilotPath).ok, true);
  });

  it('reports a missing file without throwing', () => {
    const result = loadGraphFile(join(root, 'projects', 'does-not-exist', 'graph.json'));
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.errors[0]!, /not found/);
  });
});
