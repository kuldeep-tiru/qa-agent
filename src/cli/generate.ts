import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { graphPath, loadGraphFile } from '../adapters/graph-file.js';
import { createLlmClient, listLocalModels, loadConfig, pingOllama } from '../agents/llm-router.js';
import { StepExpander } from '../agents/step-expander.js';
import { TestGeneration, type GenerationEvent } from '../agents/test-generation.js';
import { FileExpansionCache } from '../knowledge/expansion-cache.js';
import { ExcelTestCaseSink } from '../excel/template-writer.js';
import { isSafeProjectName } from './project-name.js';

function tally(values: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts].map(([k, n]) => `${k} ${n}`).join(', ');
}

export interface GenerateOptions {
  force?: boolean;
  llm?: boolean;
  limit?: string;
}

function printEvent(event: GenerationEvent): void {
  if (event.type === 'expansion-start') {
    console.log(`  Expanding steps with ${event.model} for ${event.total} scenarios.`);
    console.log('  On a laptop CPU each new scenario can take 30 to 90 seconds. Press Ctrl+C to stop;');
    console.log('  finished scenarios are saved and will not be asked again.\n');
  } else if (event.type === 'case') {
    const detail = event.reason ? ` (${event.reason})` : event.seconds > 0 ? ` (${event.seconds}s)` : '';
    console.log(`  [${String(event.index).padStart(2)}/${event.total}] ${event.id}  ${event.status}${detail}`);
  } else {
    console.log(`\n  [STOP] LLM expansion stopped: ${event.reason}`);
  }
}

export async function runGenerate(rootDir: string, project: string, options: GenerateOptions): Promise<void> {
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

  let expander: StepExpander | undefined;
  let maxNewExpansions: number | undefined;
  if (options.llm) {
    if (options.limit !== undefined) {
      maxNewExpansions = Number(options.limit);
      if (!Number.isInteger(maxNewExpansions) || maxNewExpansions < 1) return fail('--limit must be a whole number of 1 or more');
    }
    const config = loadConfig(rootDir);
    const { ollamaBaseUrl, chatModel } = config.llm;
    if (!(await pingOllama(ollamaBaseUrl))) {
      return fail(`Ollama is not reachable at ${ollamaBaseUrl}. Start Ollama, or run without --llm.`);
    }
    const models = await listLocalModels(ollamaBaseUrl);
    if (!models.some((m) => m === chatModel || m === `${chatModel}:latest`)) {
      return fail(`model ${chatModel} is not installed. Run: ollama pull ${chatModel}`);
    }
    expander = new StepExpander({
      client: createLlmClient(config),
      cache: new FileExpansionCache(join(rootDir, 'projects', project, 'knowledge', 'expansion-cache.json'), chatModel),
    });
  } else if (options.limit !== undefined) {
    return fail('--limit only works together with --llm');
  }

  const sink = new ExcelTestCaseSink({
    templatePath,
    outputDir: join(rootDir, 'projects', project, 'test-cases'),
    baseName: `${project}-test-cases`,
    overwrite: options.force === true,
  });

  try {
    const { testCases, outcome, expansion } = await new TestGeneration(sink).run(loaded.graph, {
      ...(expander ? { expander } : {}),
      ...(maxNewExpansions !== undefined ? { maxNewExpansions } : {}),
      onEvent: printEvent,
    });
    if (expansion) {
      console.log('');
      console.log(
        `  LLM steps: ${expansion.expanded} new, ${expansion.cached} from cache, ${expansion.fallback} fell back to plain steps, ${expansion.skipped} not expanded`,
      );
    }
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
