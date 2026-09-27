import { defineConfig } from '@playwright/test';

// A fresh optional run folder avoids locked old report assets on Windows.
const runId = (process.env['PW_RUN_ID'] ?? '').replace(/[^a-zA-Z0-9_-]/g, '');
const results = runId ? `test-results/${runId}` : 'test-results';
const port = Number(process.env['PW_PORT'] || 4200);

export default defineConfig({
  testDir: './e2e',
  outputDir: runId ? `${results}/artifacts` : 'test-results',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['json', { outputFile: `${results}/results.json` }],
    ['html', { open: 'never', outputFolder: runId ? `playwright-report/${runId}` : 'playwright-report' }]],
  use: {
    // Exercise the same origin and default prebundling as normal npm start.
    baseURL: `http://localhost:${port}`,
    viewport: { width: 1440, height: 1000 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    launchOptions: { args: ['--enable-unsafe-swiftshader'] }
  },
  webServer: {
    command: `npm start -- --host localhost --port ${port}`,
    url: `http://localhost:${port}/planner`,
    reuseExistingServer: !process.env['CI'],
    timeout: 120_000
  }
});
