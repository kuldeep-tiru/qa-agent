/**
 * Playwright config entry point used by `qa-agent run`. Settings arrive through
 * the QA_AGENT_RUN_SETTINGS environment variable.
 */
import { buildPlaywrightConfig } from './playwright-config.js';
import { SETTINGS_ENV, readSettingsFromEnv } from './run-settings.js';

const settings = readSettingsFromEnv();
if (!settings) {
  throw new Error(`${SETTINGS_ENV} is not set. Run your tests with: npm run qa-agent -- run auto <project>`);
}

export default buildPlaywrightConfig(settings);
