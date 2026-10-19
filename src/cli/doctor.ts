import { join } from 'node:path';
import { loadConfig, pingOllama, listLocalModels, escalationPath, hasModel } from '../agents/llm-router.js';
import { inspectTemplate } from '../excel/template-writer.js';

const ok = (msg: string) => console.log(`  [OK]   ${msg}`);
const fail = (msg: string) => console.log(`  [FAIL] ${msg}`);
const info = (msg: string) => console.log(`  [INFO] ${msg}`);

export async function runDoctor(rootDir: string): Promise<void> {
  console.log('\nqa-agent doctor\n================\n');

  // 1. Node version
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  nodeMajor >= 20
    ? ok(`Node.js ${process.versions.node} (>= 20 required)`)
    : fail(`Node.js ${process.versions.node} — upgrade to v20+ (winget install OpenJS.NodeJS)`);

  // 2. Config
  let config;
  try {
    config = loadConfig(rootDir);
    ok('config/agent.config.json loaded');
  } catch (e) {
    fail(`config load failed: ${(e as Error).message}`);
    return;
  }

  // 3. Excel template
  const template = await inspectTemplate(join(rootDir, 'templates', 'QA Test Case Template.xlsx'));
  template.ok
    ? ok(`Excel template ready (${template.columnCount} columns on the Functional Testing sheet)`)
    : fail(`Excel template: ${template.error}`);

  // 4. Ollama reachable
  const up = await pingOllama(config.llm.ollamaBaseUrl);
  if (!up) {
    fail(`Ollama not reachable at ${config.llm.ollamaBaseUrl}`);
    info('Fix: run  .\\scripts\\setup-windows.ps1  (or start the Ollama app), then re-run doctor.');
    return;
  }
  ok(`Ollama reachable at ${config.llm.ollamaBaseUrl}`);

  // 5. Required models
  const models = await listLocalModels(config.llm.ollamaBaseUrl);
  const want = [config.llm.chatModel, config.llm.embedModel];
  for (const m of want) {
    hasModel(models, m)
      ? ok(`model present: ${m}`)
      : fail(`model missing: ${m}  ->  ollama pull ${m}`);
  }

  // 6. Escalation path
  info(`escalation path: ${escalationPath(config)} (add ANTHROPIC_API_KEY to config to upgrade)`);

  console.log('\nDone.\n');
}
