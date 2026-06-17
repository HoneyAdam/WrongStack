import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E configuration for WrongStack WebUI.
 *
 * Tests run against the actual WebUI server (startWebUI from server/index.ts).
 * The server is started per-test-suite using a global setup that launches
 * the CLI in webui mode, waits for the HTTP port to be ready, then passes
 * the base URL to all tests.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  use: {
    baseURL: process.env.WEBUI_URL ?? 'http://127.0.0.1:3456',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
