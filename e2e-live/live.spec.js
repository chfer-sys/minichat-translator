import { test, expect } from '@playwright/test';

// Verifies the LIVE deployment end-to-end: browser -> minichat-proxy -> opencode.ai.
// No mocking. The real translation must come back in message.content (Han chars).
const CJK = /[\u4e00-\u9fff]/;

test('EN->ZH translation returns real Chinese (live API)', async ({ page }) => {
  await page.goto('/');
  await page.locator('button.lang-btn[data-dir="en-zh"]').click();
  await page.fill('#input', 'Hello, how are you?');
  await page.click('#translateBtn');

  // app reveals #outputWrap and fills #output on success
  await expect(page.locator('#outputWrap')).toBeVisible({ timeout: 60_000 });
  const text = ((await page.locator('#output').textContent()) || '').trim();

  console.log('LIVE_TRANSLATION_OUTPUT=' + JSON.stringify(text));

  expect(text.length).toBeGreaterThan(0);
  expect(text).not.toMatch(/\b(error|failed|undefined|null)\b/i);
  expect(CJK.test(text)).toBe(true);
});
