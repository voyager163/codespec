import { defineConfig } from '@playwright/test';
import { loadEnv } from '../shared/env';

// Engine 2 tests the running app against the approved MVP. baseURL is resolved
// per run: the pushed power-apps app link when Dataverse is connected, else dev.
const env = loadEnv();

export default defineConfig({
  testDir: './specs',
  fullyParallel: true,
  use: {
    channel: 'msedge',
    headless: false,
    baseURL: env.appBaseUrl,
    storageState: env.storageStatePath,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  reporter: [['list'], ['json', { outputFile: 'automation/e2e-suite/reports/results.json' }]],
});
