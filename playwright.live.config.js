// @ts-check
import { defineConfig, devices } from '@playwright/test';

// LIVE verification config — runs against the DEPLOYED app on 192.168.100.101.
// No webServer, no API mocking. Proves the real browser -> minichat-proxy ->
// opencode.ai chain works end-to-end (CORS, model id, key, content extraction).
//
// Run (match the image to your installed @playwright/test version):
//   docker run --rm -v "$PWD":/app -w /app mcr.microsoft.com/playwright:v<VER>-noble \
//     npx playwright test --config=playwright.live.config.js --reporter=list
export default defineConfig({
  testDir: './e2e-live',
  fullyParallel: false,
  retries: 1,
  reporter: [['list']],
  timeout: 90_000,
  expect: { timeout: 20_000 },
  use: {
    baseURL: 'http://192.168.100.101:8081',
    headless: true,
    trace: 'retain-on-failure',
    contextOptions: { serviceWorkers: 'block' },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
