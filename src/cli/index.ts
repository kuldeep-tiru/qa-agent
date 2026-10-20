#!/usr/bin/env node
import { Command } from 'commander';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { runDoctor } from './doctor.js';
import { scaffoldProject } from './scaffold.js';
import { runValidate } from './validate.js';
import { runGenerate, type GenerateOptions } from './generate.js';
import { runRun, type RunOptions } from './run.js';

const rootDir = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

const program = new Command();
program.name('qa-agent').description('Universal QA Agent — local-first').version('0.1.0');

program
  .command('doctor')
  .description('Check environment: Node, Ollama, models, config')
  .action(async () => runDoctor(rootDir));

program
  .command('new <name>')
  .description('Scaffold a new client project under projects/<name>')
  .action((name: string) => {
    const dir = scaffoldProject(rootDir, name);
    console.log(`\nCreated project: ${dir}\nNext (Week 2+): qa-agent ingest --url <demo-site>\n`);
  });

program
  .command('validate <project>')
  .description('Validate projects/<project>/graph.json against the requirement graph schema')
  .action((project: string) => runValidate(rootDir, project));

program
  .command('generate <project>')
  .description('Requirement graph -> Excel test cases (projects/<project>/test-cases/)')
  .option('--force', 'overwrite the existing file instead of writing a new version')
  .option('--llm', 'refine the steps with the local LLM (slow on a laptop; results are cached)')
  .option('--limit <n>', 'with --llm: ask the model for at most n new scenarios in this run')
  .action((project: string, options: GenerateOptions) => runGenerate(rootDir, project, options));

program
  .command('run <mode> <project>')
  .description('Execute tests: auto (Playwright, with evidence) or manual (Week 5)')
  .option('--headed', 'show the browser window while the tests run')
  .option('--grep <pattern>', 'only run tests whose title matches, for example a Test Case Id')
  .option('--demo-failure', 'also run the deliberate failing demo test to prove evidence capture')
  .action((mode: string, project: string, options: RunOptions) => runRun(rootDir, mode, project, options));

// ---- Stubs: every agent exists from day 1, hardened per the roadmap ----
const stub = (week: string, what: string) => () =>
  console.log(`\n[${what}] arrives ${week}. See QA_Agent_System_Design.md section 8 (Build Order).\n`);

program.command('ingest').description('PDF / URL / GitHub -> requirement graph').action(stub('Week 3', 'Adapters + Requirement Graph Builder'));
program.command('rca').description('Failure evidence -> root cause hypothesis').action(stub('Week 6', 'A5 RCA Agent'));
program.command('package').description('ZIP + portfolio README for GitHub').action(stub('Week 7', 'A7 Packaging Agent'));

program.parse(process.argv);
