import { defineConfig } from '@playwright/test';

const port = Number(process.env['PW_PORT'] || 4200);

/**
 * Browser tests of the web app. The API is mocked per test (page.route), so no backend or
 * database is needed. Runs the installed Google Chrome; set PW_CHANNEL to use another.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${port}`,
    channel: process.env['PW_CHANNEL'] ?? 'chrome',
    viewport: { width: 1280, height: 900 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `npm start -- --host localhost --port ${port}`,
    url: `http://localhost:${port}/invalid-link`,
    reuseExistingServer: !process.env['CI'],
    timeout: 120_000,
  },
});
