// @ts-check
import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Playwright E2E config for MiniChat Translator.
 *
 * - Headless chromium only (sufficient for E2E validation of a static PWA).
 * - webServer serves the repo root so `<script type="module" src="/src/ui.js">`
 *   resolves exactly as it does in production.
 * - All API calls are mocked inside the spec via `page.route()` — the webServer
 *   never proxies to the real MiniMax API, so tests are deterministic and free.
 *
 * Run locally (the project standard) inside a throwaway container:
 *
 *   docker run --rm -v "$PWD":/app -w /app \
 *     mcr.microsoft.com/playwright:v1.49.1-noble \
 *     npx playwright test --reporter=list
 *
 * Or, after `npm install` + `npx playwright install chromium`:
 *
 *   npm run test:e2e
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['list'], ['html', { open: 'never' }]],
  timeout: 30_000,
  expect: { timeout: 5_000 },

  use: {
    baseURL: 'http://localhost:5173',
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    // Block service worker registration so fetches go through page.route
    // mocks directly. The app's sw.js intercepts fetches in its own context,
    // which bypasses Playwright's request interception.
    contextOptions: {
      serviceWorkers: 'block',
    },
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: {
    // `serve` is a zero-config static file server that handles SPA fallback
    // and correct MIME types for ES modules out of the box.
    // Fallback: `python3 -m http.server 5173` also works.
    command: 'npx --yes serve -s . -l 5173',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    cwd: __dirname,
  },
});
