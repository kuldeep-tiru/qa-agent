/**
 * Writes the sample test cases into a copy of the template so you can open the
 * result in Excel and check the layout. Run: npm run sample:excel
 * Output: projects/saucedemo-pilot/test-cases/_sample-test-cases.xlsx (git-ignored)
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ExcelTestCaseSink } from '../src/excel/template-writer.js';
import { sampleTestCases } from '../tests/fixtures/sample-test-cases.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

const sink = new ExcelTestCaseSink({
  templatePath: join(root, 'templates', 'QA Test Case Template.xlsx'),
  outputDir: join(root, 'projects', 'saucedemo-pilot', 'test-cases'),
  baseName: '_sample-test-cases',
  overwrite: true,
});

const outcome = await sink.write(sampleTestCases);
console.log(`Wrote ${outcome.casesWritten} test cases to ${outcome.path}`);
