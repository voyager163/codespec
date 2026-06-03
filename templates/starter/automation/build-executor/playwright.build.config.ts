import { defineConfig } from '@playwright/test';
import { loadEnv } from '../shared/env';

// Engine 1 runs headed against the maker portal with the authenticated build
// profile. It is NOT a test runner in the usual sense — see run-task.ts.
const env = loadEnv();

export default defineConfig({
  testDir: './',
  fullyParallel: false,
  workers: 1,
  use: {
    channel: 'msedge',
    headless: false,
    baseURL: env.makerPortalUrl,
    storageState: env.storageStatePath,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
