import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E config for studio.
 *
 * Tests run against a local static server (npx serve public). Each test
 * gets a clean storage state — sign-in flows can stub the FAS session
 * by injecting into localStorage before navigation, since the page reads
 * `fas:session` on load.
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: process.env.STUDIO_URL ?? 'http://localhost:4173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: process.env.STUDIO_URL
    ? undefined
    : {
        command: 'pnpm dev',
        url: 'http://localhost:4173',
        reuseExistingServer: !process.env.CI,
        timeout: 30_000,
      },
});
