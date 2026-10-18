import { graphPath, loadGraphFile } from '../adapters/graph-file.js';
import { graphStats } from '../domain/graph.js';
import { isSafeProjectName } from './project-name.js';

export function runValidate(rootDir: string, project: string): void {
  console.log(`\nqa-agent validate ${project}\n${'='.repeat(18 + project.length)}\n`);

  if (!isSafeProjectName(project)) {
    console.log('  [FAIL] invalid project name (use letters, digits, . _ or - only)\n');
    process.exitCode = 1;
    return;
  }

  const file = graphPath(rootDir, project);
  const result = loadGraphFile(file);

  if (!result.ok) {
    console.log(`  [FAIL] ${file}`);
    for (const error of result.errors) console.log(`         - ${error}`);
    console.log(`\n  ${result.errors.length} problem(s) found.\n`);
    process.exitCode = 1;
    return;
  }

  const s = graphStats(result.graph);
  console.log(`  [OK]   ${file}`);
  console.log(
    `         ${s.modules} modules, ${s.features} features, ${s.scenarios} scenarios, ${s.acceptanceCriteria} acceptance criteria\n`,
  );
}
