/**
 * E2E spec for MiniChat Translator — PR #6 (feature/status-button).
 *
 * Covers three feature areas added by the PR:
 *   1. Status button        — `#statusBtn`, `#statusDot`, `#statusText`
 *   2. Naturalize mode      — `.mode-tabs`, `#naturalizeInput`, `#naturalizeBtn`, …
 *   3. Reply Helper mode    — `.mode-tabs`, `#replyContext`, `#replyIntent`, …
 *
 * All `/chat/completions` requests are intercepted with `page.route()` and
 * fulfilled with deterministic MiniMax-style JSON bodies. No real API call
 * is ever made — tests are hermetic, free, and fast.
 */
import { test, expect } from '@playwright/test';

/**
 * Install the standard mocked route for `/chat/completions`.
 *
 * Branches on the system prompt so a single mock can serve translate,
 * naturalize, reply, and ping (health) requests.
 */
async function mockChatCompletions(page, { mode = 'ok' } = {}) {
  await page.route('**/chat/completions', async (route) => {
    if (mode === 'reject') {
      // Simulate a network failure (DNS, offline, CORS, etc.)
      await route.abort('failed');
      return;
    }
    if (mode === '500') {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'internal' }),
      });
      return;
    }

    let body = {};
    try {
      body = route.request().postDataJSON() || {};
    } catch {
      body = {};
    }
    const sys = body.messages?.[0]?.content || '';
    let reply = '翻译结果';
    if (sys.includes('reply') || sys.includes('Reply')) reply = '好的，没问题';
    else if (sys.includes('natural') || sys.includes('idiomatic')) reply = '这是更自然的版本';
    else if (sys.includes('Respond with: ok') || sys.includes('ping')) reply = 'ok';

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'mock-' + Date.now(),
        model: 'MiniMax-M2.1',
        choices: [{ index: 0, message: { role: 'assistant', content: reply } }],
        usage: { total_tokens: 5 },
      }),
    });
  });
}

// ---------------------------------------------------------------------------
// Feature 1: Mode switching (Translate / Naturalize / Reply Helper)
// ---------------------------------------------------------------------------
test.describe('Mode switching', () => {
  test.beforeEach(async ({ page, context }) => {
    await mockChatCompletions(page);
    // Auto-fired health check on load shouldn't break mode tests.
    await page.goto('/');
    // Allow the initial health-check fetch to settle.
    await expect(page.locator('#statusText')).not.toHaveText('Checking…', { timeout: 4000 });
  });

  test('default tab is Translate; naturalize and reply panels hidden', async ({ page }) => {
    // Translate panel: language selector + input + translate button are visible.
    await expect(page.locator('#translateBtn')).toBeVisible();
    await expect(page.locator('#input')).toBeVisible();
    // Mode tabs exist with three tabs.
    await expect(page.locator('.mode-tabs')).toBeVisible();
    await expect(page.locator('.mode-tabs .mode-tab', { hasText: 'Translate' })).toHaveClass(/\bactive\b/);
    // Other panels hidden.
    await expect(page.locator('#naturalizeInput')).toBeHidden();
    await expect(page.locator('#replyContext')).toBeHidden();
  });

  test('clicking Naturalize tab shows naturalize panel and hides others', async ({ page }) => {
    await page.locator('.mode-tabs .mode-tab', { hasText: 'Naturalize' }).click();
    await expect(page.locator('.mode-tabs .mode-tab', { hasText: 'Naturalize' })).toHaveClass(/\bactive\b/);
    await expect(page.locator('#naturalizeInput')).toBeVisible();
    await expect(page.locator('#naturalizeBtn')).toBeVisible();
    // Translate panel hidden.
    await expect(page.locator('#translateBtn')).toBeHidden();
    // Reply hidden.
    await expect(page.locator('#replyContext')).toBeHidden();
  });

  test('clicking Reply Helper tab shows reply panel and hides others', async ({ page }) => {
    await page.locator('.mode-tabs .mode-tab', { hasText: 'Reply Helper' }).click();
    await expect(page.locator('.mode-tabs .mode-tab', { hasText: 'Reply Helper' })).toHaveClass(/\bactive\b/);
    await expect(page.locator('#replyContext')).toBeVisible();
    await expect(page.locator('#replyIntent')).toBeVisible();
    await expect(page.locator('#replyBtn')).toBeVisible();
    // Others hidden.
    await expect(page.locator('#translateBtn')).toBeHidden();
    await expect(page.locator('#naturalizeInput')).toBeHidden();
  });

  test('Translate tab restores translate panel after switching away', async ({ page }) => {
    await page.locator('.mode-tabs .mode-tab', { hasText: 'Naturalize' }).click();
    await expect(page.locator('#naturalizeInput')).toBeVisible();
    await page.locator('.mode-tabs .mode-tab', { hasText: 'Translate' }).click();
    await expect(page.locator('#translateBtn')).toBeVisible();
    await expect(page.locator('#naturalizeInput')).toBeHidden();
    await expect(page.locator('#replyContext')).toBeHidden();
  });
});

// ---------------------------------------------------------------------------
// Feature 2a: Status button — online path
// ---------------------------------------------------------------------------
test.describe('Status button (online)', () => {
  test('auto-fires health check on load and ends in Online state', async ({ page }) => {
    await mockChatCompletions(page);
    await page.goto('/');

    // The initial state on load may be "Checking…" briefly.
    // Eventually we must land on "Online · Nms" with a green dot.
    await expect(page.locator('#statusText')).toHaveText(/Online · \d+ms/, { timeout: 5000 });
    await expect(page.locator('#statusDot')).toHaveClass(/\bonline\b/);
  });

  test('clicking the status button re-runs the check', async ({ page }) => {
    await mockChatCompletions(page);
    await page.goto('/');
    await expect(page.locator('#statusText')).toHaveText(/Online · \d+ms/, { timeout: 5000 });

    await page.locator('#statusBtn').click();
    // Briefly enters Checking… then returns to Online.
    await expect(page.locator('#statusText')).toHaveText(/Online · \d+ms/, { timeout: 5000 });
    await expect(page.locator('#statusDot')).toHaveClass(/\bonline\b/);
  });
});

// ---------------------------------------------------------------------------
// Feature 2b: Status button — offline path
// ---------------------------------------------------------------------------
test.describe('Status button (offline)', () => {
  test('network failure yields Offline state with red dot', async ({ page }) => {
    await mockChatCompletions(page, { mode: 'reject' });
    await page.goto('/');

    await expect(page.locator('#statusText')).toHaveText('Offline', { timeout: 8000 });
    await expect(page.locator('#statusDot')).toHaveClass(/\boffline\b/);
  });

  test('HTTP 500 response yields Offline state', async ({ page }) => {
    await mockChatCompletions(page, { mode: '500' });
    await page.goto('/');

    await expect(page.locator('#statusText')).toHaveText('Offline', { timeout: 8000 });
    await expect(page.locator('#statusDot')).toHaveClass(/\boffline\b/);
  });
});

// ---------------------------------------------------------------------------
// Feature 3: Naturalize flow
// ---------------------------------------------------------------------------
test.describe('Naturalize flow', () => {
  test.beforeEach(async ({ page, context }) => {
    await mockChatCompletions(page);
    await page.goto('/');
    await expect(page.locator('#statusText')).not.toHaveText('Checking…', { timeout: 4000 });
    await page.locator('.mode-tabs .mode-tab', { hasText: 'Naturalize' }).click();
  });

  test('empty input + click → no spinner, no output', async ({ page }) => {
    await expect(page.locator('#naturalizeInput')).toHaveValue('');
    await page.locator('#naturalizeBtn').click();
    // Output wrap stays hidden.
    await expect(page.locator('#naturalizeOutputWrap')).toBeHidden();
    // Button text does not enter loading state.
    await expect(page.locator('#naturalizeBtn')).not.toHaveText(/Naturalizing/i);
  });

  test('non-empty input → loading state then mocked output', async ({ page }) => {
    await page.locator('#naturalizeInput').fill('你好世界');

    const before = Date.now();
    const [response] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/chat/completions')),
      page.locator('#naturalizeBtn').click(),
    ]);

    // Mock returns 200 with our canned reply.
    expect(response.status()).toBe(200);

    // Output wrap becomes visible and contains mocked text.
    await expect(page.locator('#naturalizeOutputWrap')).toBeVisible();
    await expect(page.locator('#naturalizeOutput')).toContainText('这是更自然的版本');
    expect(Date.now() - before).toBeLessThan(5000);
  });
});

// ---------------------------------------------------------------------------
// Feature 4: Reply Helper flow
// ---------------------------------------------------------------------------
test.describe('Reply Helper flow', () => {
  test.beforeEach(async ({ page }) => {
    await mockChatCompletions(page);
    await page.goto('/');
    await expect(page.locator('#statusText')).not.toHaveText('Checking…', { timeout: 4000 });
    await page.locator('.mode-tabs .mode-tab', { hasText: 'Reply Helper' }).click();
  });

  test('only context filled → click does nothing', async ({ page }) => {
    await page.locator('#replyContext').fill('hey are you free tonight?');
    await page.locator('#replyBtn').click();
    await expect(page.locator('#replyOutputWrap')).toBeHidden();
  });

  test('only intent filled → click does nothing', async ({ page }) => {
    await page.locator('#replyIntent').fill('tell them yes');
    await page.locator('#replyBtn').click();
    await expect(page.locator('#replyOutputWrap')).toBeHidden();
  });

  test('both filled → output appears', async ({ page }) => {
    await page.locator('#replyContext').fill('hey are you free tonight?');
    await page.locator('#replyIntent').fill('tell them yes');

    const [response] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/chat/completions')),
      page.locator('#replyBtn').click(),
    ]);
    expect(response.status()).toBe(200);

    await expect(page.locator('#replyOutputWrap')).toBeVisible();
    await expect(page.locator('#replyOutput')).toContainText('好的，没问题');
  });
});

// ---------------------------------------------------------------------------
// Feature 5 (optional): Copy buttons work
// ---------------------------------------------------------------------------
test.describe('Copy buttons', () => {
  test('naturalize copy button writes output to clipboard', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await mockChatCompletions(page);
    await page.goto('/');
    await expect(page.locator('#statusText')).not.toHaveText('Checking…', { timeout: 4000 });

    await page.locator('.mode-tabs .mode-tab', { hasText: 'Naturalize' }).click();
    await page.locator('#naturalizeInput').fill('你好世界');
    await page.locator('#naturalizeBtn').click();
    await expect(page.locator('#naturalizeOutput')).toContainText('这是更自然的版本');

    await page.locator('#naturalizeCopyBtn').click();

    // Small grace period for clipboard write.
    await expect.poll(async () => await page.evaluate(() => navigator.clipboard.readText()), {
      timeout: 3000,
    }).toContain('这是更自然的版本');
  });
});
