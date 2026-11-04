import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e', fullyParallel: false,
  use: { baseURL: 'http://127.0.0.1:3000', trace: 'retain-on-failure' },
  projects: [{ name: 'phone', use: { ...devices['iPhone 13'], browserName: 'chromium', viewport: { width: 375, height: 812 } } }, { name: 'desktop', use: { ...devices['Desktop Chrome'] } }],
  webServer: { command: 'pnpm dev', url: 'http://127.0.0.1:3000', reuseExistingServer: !process.env.CI, env: { LUMEN_DEMO_MODE: 'true' }, timeout: 120000 },
});
