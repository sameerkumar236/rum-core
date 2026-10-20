import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  expect: { timeout: 10000 },
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome',
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'node scripts/demo.js',
    url: 'http://127.0.0.1:4173/api/health',
    timeout: 180000,
    reuseExistingServer: false,
    env: { DEMO_PORT: '4173', DEMO_EPHEMERAL: '1' },
  },
});
