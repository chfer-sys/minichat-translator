import { test, expect } from '@playwright/test';

// LIVE verification against the deployed Coolify stack (docker-compose.yml):
//   browser -> nginx :8081 -> /api (prefix stripped) -> minichat-proxy
//   (internal only, injects OPENCODE_GO_API_KEY) -> opencode.ai
// No mocking, no service worker (blocked in playwright.live.config.js) —
// the boot health check plus a real PERSONA chat prove the whole chain:
// CORS-free same-origin /api, proxy key injection, model id, JSON extraction.

const CJK = /[\u4e00-\u9fff]/;

test('PERSONA chat reaches the live API through /api and replies in Chinese', async ({ page }) => {
  await page.goto('/');
  // Deterministic run: wipe profiles/messages left by previous live runs.
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  // Boot health check is itself a POST through /api — the cheapest full-chain probe.
  await expect(page.locator('#statusText')).toHaveText(/Online · \d+ms/, { timeout: 15_000 });

  // Reply + coaching in the target language (Chinese) rather than English.
  await page.locator('[data-view="settings"]').click();
  await page.locator('[data-response-language="Target language"]').click();
  await page.locator('[data-view="chat"]').click();

  // PERSONA requires a profile before the composer will send.
  await page.locator('[data-view="profiles"]').click();
  await page.locator('#addProfile').click();
  await page.locator('#profileName').fill('Live QA');
  await page.locator('#profileForm button[type="submit"]').click();
  await page.locator('[data-view="chat"]').click();
  await expect(page.locator('#chatProfileName')).toHaveText('Live QA');

  await page.locator('#chatInput').fill('Hello, how are you?');
  const start = Date.now();
  await page.locator('#sendMessage').click();
  // Chat aborts at 45s and renders an error bubble instead — 60s covers both.
  const reply = page.locator('.ai-reply-text').first();
  await expect(reply).toBeVisible({ timeout: 60_000 });
  const elapsedMs = Date.now() - start;

  const text = ((await reply.textContent()) || '').trim();
  console.log('LIVE_PERSONA_REPLY=' + JSON.stringify(text));
  console.log('LIVE_PERSONA_ELAPSED_MS=' + elapsedMs);

  expect(text.length).toBeGreaterThan(0);
  // Error bubbles say "couldn't reach"/"timed out" without literal "error".
  expect(text).not.toMatch(/\b(error|failed|undefined|null)\b|couldn't reach|timed out/i);
  expect(CJK.test(text)).toBe(true);
  expect(elapsedMs).toBeLessThan(45_000);
});
