import { test, expect } from '@playwright/test';

// Verifies the LIVE deployment end-to-end AND measures latency.
// No mocking. The real translation must be correct (Han chars) AND fast.
const CJK = /[\u4e00-\u9fff]/;

test('EN->ZH translation is fast and correct (live API)', async ({ page }) => {
  await page.goto('/');
  await page.locator('button.lang-btn[data-dir="en-zh"]').click();
  await page.fill('#input', 'Hello, how are you?');

  const start = Date.now();
  await page.click('#translateBtn');
  await expect(page.locator('#outputWrap')).toBeVisible({ timeout: 30_000 });
  const elapsedMs = Date.now() - start;

  const text = ((await page.locator('#output').textContent()) || '').trim();

  console.log('LIVE_TRANSLATION_OUTPUT=' + JSON.stringify(text));
  console.log('TRANSLATION_ELAPSED_MS=' + elapsedMs);

  expect(text.length).toBeGreaterThan(0);
  expect(text).not.toMatch(/\b(error|failed|undefined|null)\b/i);
  expect(CJK.test(text)).toBe(true);
  // After the terse-prompt fix, translation lands well under 8s
  // (measured ~2.7s mean; headroom for reasoning variance + network).
  expect(elapsedMs).toBeLessThan(8000);
});
