import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  reporter: 'list',
  timeout: 10 * 60 * 1000,
  expect: {
    timeout: 30 * 1000,
  },
  use: {
    baseURL: 'http://127.0.0.1:5174',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: 'python -m uvicorn app:app --host 127.0.0.1 --port 7861',
      cwd: '..',
      url: 'http://127.0.0.1:7861/docs',
      reuseExistingServer: true,
      timeout: 180 * 1000,
    },
    {
      command: 'npm run dev -- --host 127.0.0.1 --port 5174',
      url: 'http://127.0.0.1:5174',
      reuseExistingServer: true,
      timeout: 60 * 1000,
    },
  ],
});
