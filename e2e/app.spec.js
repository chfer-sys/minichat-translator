import { test, expect } from '@playwright/test';

async function mockChatCompletions(page) {
  await page.route('**/chat/completions', async (route) => {
    const body = route.request().postDataJSON() || {};
    const system = typeof body.messages?.[0]?.content === 'string' ? body.messages[0].content : '';
    let content = 'ok';
    if (system.includes('translation API')) content = system.includes('Japanese') ? 'こんにちは！' : '你好！';
    else if (system.includes('standard romaji')) content = 'konnichiwa';
    else if (system.includes('You are PERSONA')) {
      content = JSON.stringify({ reply: '陶芸が好きなんですね。', pronunciation: 'Tōgei ga suki nan desu ne.', coaching: 'A warm, natural reply.', extracted: 'Aiko enjoys pottery.' });
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }) });
  });
}

async function freshApp(page) {
  await mockChatCompletions(page);
  // Clear localStorage once, before the test's first meaningful navigation, then
  // reload so the app boots with pristine storage. Deliberately NOT an
  // addInitScript(() => localStorage.clear()): init scripts re-run on every
  // navigation, so a page.reload() mid-test would silently wipe the storage the
  // persistence assertions depend on (profiles surviving a reload, settings, …).
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('#statusText')).toHaveText(/Online · \d+ms/, { timeout: 5000 });
}

async function createAiko(page) {
  await page.locator('[data-view="profiles"]').click();
  await page.locator('#addProfile').click();
  await page.locator('#profileName').fill('Aiko');
  await page.locator('#profileRelationship').fill('Met at a design conference');
  await page.locator('#profileNotes').fill('Loves ceramics and slow weekends.');
  await page.locator('#profileForm button[type="submit"]').click();
  // Creating a profile persists it and re-renders, but does not auto-navigate;
  // the chat composer and attachment preview live in the chat view, so switch
  // there via the bottom nav exactly like a user would.
  await page.locator('[data-view="chat"]').click();
}

test.describe('PERSONA mobile-first app', () => {
  test('shows the four main areas and local-first status', async ({ page }) => {
    await freshApp(page);
    await expect(page.getByRole('heading', { name: 'Chat', exact: true })).toBeVisible();
    await expect(page.locator('.bottom-nav .nav-item')).toHaveCount(4);
    await expect(page.locator('.local-badge')).toContainText('Saved on device');
    await page.locator('[data-view="settings"]').click();
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
    await expect(page.getByText('No account. No cloud sync.')).toBeVisible();
  });

  test('creates, stores, and switches into a profile chat', async ({ page }) => {
    await freshApp(page);
    await createAiko(page);
    await expect(page.locator('#chatProfileName')).toHaveText('Aiko');
    await expect(page.locator('#chatProfileMeta')).toContainText('Met at a design conference');
    await expect(page.locator('#chatProfileTabs')).toContainText('Aiko');
    await page.reload();
    await expect(page.locator('#chatProfileName')).toHaveText('Aiko');
    await page.locator('[data-view="profiles"]').click();
    await expect(page.locator('.profile-card')).toContainText('Loves ceramics and slow weekends.');
  });

  test('adds a profile directly from the chat view via the tab strip', async ({ page }) => {
    await freshApp(page);
    // Start on the initial Chat view — never visit the Profiles view.
    await expect(page.getByRole('heading', { name: 'Chat', exact: true })).toBeVisible();
    await page.locator('#tabAddProfile').click();
    // The editor is a top-level overlay, so it is visible even while Chat is active.
    await expect(page.locator('#profileFormCard')).toBeVisible();
    await page.locator('#profileName').fill('Aiko');
    await page.locator('#profileRelationship').fill('Met at a design conference');
    await page.locator('#profileForm button[type="submit"]').click();
    await expect(page.locator('#profileFormCard')).toBeHidden();
    // Still on Chat, with the new profile selected there.
    await expect(page.getByRole('heading', { name: 'Chat', exact: true })).toBeVisible();
    await expect(page.locator('#chatProfileName')).toHaveText('Aiko');
    await expect(page.locator('#chatProfileTabs')).toContainText('Aiko');
  });

  test('opens profile creation over chat when sending without a profile, keeping the draft', async ({ page }) => {
    await freshApp(page);
    await page.locator('#chatInput').fill('Hello there');
    await page.locator('#sendMessage').click();
    // Profile creation opens as a visible overlay; the user stays on Chat.
    await expect(page.locator('#profileFormCard')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Chat', exact: true })).toBeVisible();
    await expect(page.locator('#chatError')).toContainText('Create or choose a profile');
    await expect(page.locator('#chatInput')).toHaveValue('Hello there');
    // Completing the form selects the profile and leaves the draft ready to send.
    await page.locator('#profileName').fill('Aiko');
    await page.locator('#profileForm button[type="submit"]').click();
    await expect(page.locator('#chatProfileName')).toHaveText('Aiko');
    await expect(page.locator('#chatInput')).toHaveValue('Hello there');
  });

  test('offers retry only for the current last failed request, bound to that message', async ({ page }) => {
    await freshApp(page);
    await createAiko(page);
    let calls = 0;
    const sentMessages = [];
    await page.unroute('**/chat/completions');
    await page.route('**/chat/completions', async (route) => {
      const body = route.request().postDataJSON() || {};
      const system = typeof body.messages?.[0]?.content === 'string' ? body.messages[0].content : '';
      if (system.includes('Respond with: ok')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ok' } }] }) });
      }
      calls += 1;
      sentMessages[calls] = body.messages.at(-1).content;
      // Odd calls fail, even calls succeed.
      if (calls % 2 === 1) return route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
      const content = JSON.stringify({ reply: `Reply ${calls}`, pronunciation: '', coaching: '', extracted: '' });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }) });
    });

    await page.locator('#chatInput').fill('First message');
    await page.locator('#sendMessage').click();
    await expect(page.locator('[data-retry]')).toHaveCount(1);

    // A newer message succeeds — the stale retry on the old failure must not
    // survive, or clicking it would re-send this newest unrelated message.
    await page.locator('#chatInput').fill('Second message');
    await page.locator('#sendMessage').click();
    await expect(page.locator('.ai-reply-text')).toHaveText('Reply 2');
    await expect(page.locator('[data-retry]')).toHaveCount(0);

    // The current last failure does offer retry, and it resends that exact message.
    await page.locator('#chatInput').fill('Third message');
    await page.locator('#sendMessage').click();
    await expect(page.locator('[data-retry]')).toHaveCount(1);
    await page.locator('[data-retry]').click();
    await expect(page.locator('.ai-reply-text').last()).toHaveText('Reply 4');
    expect(sentMessages[4]).toBe('Third message');
    await expect(page.locator('[data-retry]')).toHaveCount(0);
  });

  test('sends a chat with ordered context and renders a copyable reply with pronunciation', async ({ page }) => {
    await freshApp(page);
    await createAiko(page);
    let requestBody;
    page.on('request', (request) => {
      if (request.url().includes('/chat/completions')) requestBody = request.postDataJSON();
    });
    await page.locator('#chatInput').fill('I love pottery.');
    await page.locator('#sendMessage').click();
    await expect(page.locator('.ai-reply-text')).toHaveText('陶芸が好きなんですね。');
    await expect(page.locator('.ai-pronunciation')).toContainText('Tōgei ga suki');
    expect(requestBody.messages[0].content.indexOf('PROFILE')).toBeLessThan(requestBody.messages[0].content.indexOf('HISTORY'));
    expect(requestBody.messages.at(-1).content).toBe('I love pottery.');
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('persona.profiles.v1'))[0].notes)).toContain('Aiko enjoys pottery.');
    await page.locator('#openContext').click();
    await expect(page.locator('#contextSheet')).toHaveClass(/open/);
    await expect(page.locator('#contextHash')).toHaveText(/[0-9a-f]{8}/);
    await expect(page.locator('#contextLayers')).toContainText('Recent conversation');
  });

  test('translates English into Japanese and reveals romaji', async ({ page }) => {
    await freshApp(page);
    await page.locator('[data-view="translate"]').click();
    await page.locator('#targetLanguage').selectOption('Japanese');
    await page.locator('#input').fill('Hello');
    await page.locator('#translateBtn').click();
    await expect(page.locator('#output')).toHaveText('こんにちは！');
    await page.locator('#pinyinToggle').click();
    await expect(page.locator('#pinyinText')).toHaveText('konnichiwa');
    await expect(page.locator('#pronunciationLabel')).toHaveText('ROMAJI');
  });

  test('persists response language and context-layer preferences', async ({ page }) => {
    await freshApp(page);
    await page.locator('[data-view="settings"]').click();
    await page.locator('[data-response-language="Target language"]').click();
    await page.locator('[data-context-layer="history"]').uncheck();
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('persona.settings.v1')).responseLanguage)).toBe('Target language');
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('persona.settings.v1')).layers.history)).toBe(false);
  });

  test('accepts an image attachment and keeps it as a local draft preview', async ({ page }) => {
    await freshApp(page);
    await createAiko(page);
    await page.locator('#imageInput').setInputFiles({ name: 'message.png', mimeType: 'image/png', buffer: Buffer.from('fake image bytes') });
    await expect(page.locator('#attachmentPreview img')).toBeVisible();
    await expect(page.locator('#attachmentPreview img')).toHaveAttribute('alt', 'Image to send');
  });
});
