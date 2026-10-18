import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { graphPath, loadGraphFile } from '../adapters/graph-file.js';
import { TestGeneration } from '../agents/test-generation.js';
import { ExcelTestCaseSink } from '../excel/template-writer.js';
import { isSafeProjectName } from './project-name.js';

function tally(values: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts].map(([k, n]) => `${k} ${n}`).join(', ');
}

export async function runGenerate(rootDir: string, project: string, options: { force?: boolean }): Promise<void> {
  console.log(`\nqa-agent generate ${project}\n${'='.repeat(20 + project.length)}\n`);
  const fail = (message: string) => {
    console.log(`  [FAIL] ${message}\n`);
    process.exitCode = 1;
  };

  if (!isSafeProjectName(project)) return fail('invalid project name (use letters, digits, . _ or - only)');

  const loaded = loadGraphFile(graphPath(rootDir, project));
  if (!loaded.ok) {
    console.log(`  [FAIL] graph.json is not valid. Run: npm run qa-agent -- validate ${project}`);
    for (const error of loaded.errors) console.log(`         - ${error}`);
    console.log('');
    process.exitCode = 1;
    return;
  }

  const templatePath = join(rootDir, 'templates', 'QA Test Case Template.xlsx');
  if (!existsSync(templatePath)) return fail(`Excel template not found: ${templatePath}`);

  const sink = new ExcelTestCaseSink({
    templatePath,
    outputDir: join(rootDir, 'projects', project, 'test-cases'),
    baseName: `${project}-test-cases`,
    overwrite: options.force === true,
  });

  try {
    const { testCases, outcome } = await new TestGeneration(sink).run(loaded.graph);
    console.log(`  [OK]   ${outcome.casesWritten} test cases written to ${outcome.path}`);
    console.log(`         Priority:  ${tally(testCases.map((t) => t.priority))}`);
    console.log(`         Test type: ${tally(testCases.map((t) => t.testType))}`);
    if (outcome.version > 1) {
      console.log(`\n  An earlier file exists, so it was kept and this run was saved as version ${outcome.version}.`);
      console.log('  Use --force to overwrite the original instead.');
    }
    console.log('\n  Next: open the file in Excel, review and edit the cases, then approve them.\n');
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
}
