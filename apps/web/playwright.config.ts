import { existsSync } from 'node:fs';
import { defineConfig } from '@playwright/test';

// Use the system Chromium when there is one, so no browser download is needed.
const executablePath = process.env.E2E_CHROMIUM ?? (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);

export default defineConfig({
  testDir: './tests/e2e',
  // One signed-in test user and one database: run serially.
  workers: 1,
  fullyParallel: false,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: [['list']],
  globalSetup: './tests/e2e/global-setup.ts',
  globalTeardown: './tests/e2e/global-teardown.ts',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    storageState: 'tests/e2e/.auth/state.json',
    viewport: { width: 1280, height: 860 },
    trace: 'retain-on-failure',
    launchOptions: { executablePath },
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
