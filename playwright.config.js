import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser', timeout: 30000, workers: 1,
  retries: process.env.CI ? 2 : 0, // shared CI runners are noisy; a retried pass shows up as "flaky" in the report
  use: { baseURL: 'http://127.0.0.1:5173', viewport: { width: 1280, height: 820 }, deviceScaleFactor: 2,
    screenshot: 'only-on-failure', trace: 'retain-on-failure',
    launchOptions: { ...(process.env.SILK_BROWSER_PATH ? { executablePath: process.env.SILK_BROWSER_PATH } : {}), args: ['--enable-unsafe-swiftshader'] } },
  webServer: { command: 'node scripts/preview-server.mjs', url: 'http://127.0.0.1:5173/index.html', reuseExistingServer: !process.env.CI },
});
