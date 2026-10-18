import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SUBDIRS = [
  'requirements',
  'test-cases',
  'tests',
  'evidence/screenshots',
  'evidence/videos',
  'evidence/traces',
  'evidence/har',
  'defects',
  'reports',
  'knowledge',
];

export function scaffoldProject(rootDir: string, name: string): string {
  const dir = join(rootDir, 'projects', name);
  mkdirSync(dir, { recursive: true });
  for (const sub of SUBDIRS) mkdirSync(join(dir, sub), { recursive: true });

  writeFileSync(
    join(dir, 'graph.json'),
    JSON.stringify(
      {
        project: name,
        version: '0.1',
        modules: [],
        notes: 'Requirement graph. Reviewed by human before test generation. Populated by `qa-agent ingest` (Week 3).',
      },
      null,
      2,
    ),
  );

  writeFileSync(
    join(dir, 'project.config.json'),
    JSON.stringify({ name, created: new Date().toISOString(), status: 'onboarding' }, null, 2),
  );

  writeFileSync(join(dir, 'knowledge', '.gitkeep'), '');
  return dir;
}
