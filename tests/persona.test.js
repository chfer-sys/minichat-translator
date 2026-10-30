/**
 * DOM tests for persona.js — clearLocalData reliability + loadStore write policy.
 * Uses happy-dom (configured in vitest.config.js).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { initPersona, buildBackup, applyTargetLanguage, normalizeBackup, importBackupText, LOCAL_DATA_EVENT } from '../src/persona.js';

const KEYS = { profiles: 'persona.profiles.v1', settings: 'persona.settings.v1', active: 'persona.active.v1' };
const HISTORY_KEY = 'minichat_history';

function buildDom() {
  document.body.innerHTML = `
    <div class="view active" id="chatView"></div>
    <div class="view" id="translateView"></div>
    <div class="view" id="profilesView"></div>
    <div class="view" id="settingsView"></div>
    <a class="brand" href="#">Minichat</a>
    <button class="nav-item active" data-view="chat">Chat</button>
    <button class="nav-item" data-view="profiles">Profiles</button>
    <button class="nav-item" data-view="settings">Settings</button>
    <button class="context-open">Open context</button>
    <p id="pwaNote" class="hidden">PWA note</p>
    <div id="chatProfileTabs"></div>
    <div id="chatProfileName"></div>
    <div id="chatProfileMeta"></div>
    <div id="chatAvatar"></div>
    <div id="messages"></div>
    <div id="chatError"></div>
    <textarea id="chatInput"></textarea>
    <button id="sendMessage">Send</button>
    <button id="attachImage">Attach</button>
    <input id="imageInput" type="file">
    <div id="attachmentPreview"></div>
    <div id="profileList"></div>
    <button id="addProfile"></button>
    <div id="profileFormCard" hidden>
      <form id="profileForm">
        <input id="profileId"><input id="profileName">
        <select id="profileNative"></select><select id="profileTarget"></select>
        <input id="profileRelationship"><textarea id="profileNotes"></textarea>
        <select id="profileTone"></select>
        <h2 id="profileFormTitle"></h2>
        <button type="button" id="closeProfileForm"></button>
        <button type="button" id="cancelProfile"></button>
      </form>
    </div>
    <div id="contextSheet"></div>
    <div id="contextBackdrop"></div>
    <button id="closeContext"></button>
    <div id="contextLayers"></div>
    <span id="contextHash"></span>
    <span id="contextSummary"></span>
    <span id="storageSummary"></span>
    <button id="exportData"></button>
    <button id="importData"></button>
    <input id="importFile" type="file" accept="application/json,.json">
    <p id="importStatus" role="status"></p>
    <button id="clearData"></button>
    <button id="voiceInput"></button>
    <button id="speakOutput"></button>
    <button id="clearTranslation"></button>
    <select id="targetLanguage"><option>Chinese</option><option>Japanese</option></select>
    <button class="lang-btn" data-dir="en-zh">English → <span class="target-label">Chinese</span></button>
    <button class="lang-btn" data-dir="zh-en"><span class="target-label">Chinese</span> → English</button>
    <div id="pinyinSection" style="display:none;">
      <button id="pinyinToggle">Show pinyin</button>
      <div id="pinyinText"></div>
    </div>
    <span id="pronunciationLabel">PINYIN</span>
    <button data-response-language="English">English</button>
    <button data-response-language="Chinese">Chinese</button>
    <button data-tone="Friendly">Friendly</button>
    <button data-tone="Direct">Direct</button>
    <input type="checkbox" data-context-layer="profile">
    <input type="checkbox" data-context-layer="history">
    <input type="checkbox" data-context-layer="preferences">
  `;
}

function seedValidStore() {
  localStorage.setItem(KEYS.profiles, JSON.stringify([{ id: 'p1', name: 'Ana', nativeLanguage: 'Japanese', targetLanguage: 'Japanese', relationship: '', notes: '', tone: 'Friendly', messages: [] }]));
  localStorage.setItem(KEYS.settings, JSON.stringify({ responseLanguage: 'Chinese', tone: 'Direct', layers: { profile: true, history: false, preferences: true } }));
  localStorage.setItem(KEYS.active, 'p1');
  localStorage.setItem(HISTORY_KEY, JSON.stringify([{ id: 1, text: 'hi', translation: '你好', direction: 'en-zh', timestamp: new Date().toISOString() }]));
}

describe('persona.js reliability', () => {
  beforeEach(() => {
    localStorage.clear();
    buildDom();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('clearLocalData removes persona keys AND translation history, resets controls without re-binding listeners', () => {
    seedValidStore();
    initPersona();

    // Store non-default settings in the UI, then confirm listeners were bound once.
    document.querySelector('[data-response-language="English"]').click();
    document.querySelector('[data-tone="Friendly"]').click();

    const toneButton = document.querySelector('[data-tone="Direct"]');
    const languageButton = document.querySelector('[data-response-language="Chinese"]');
    const layerInput = document.querySelector('[data-context-layer="history"]');
    let toneRegistrations = 0;
    let languageRegistrations = 0;
    let layerRegistrations = 0;
    for (const [element, counter] of [[toneButton, () => toneRegistrations++], [languageButton, () => languageRegistrations++], [layerInput, () => layerRegistrations++]]) {
      const original = element.addEventListener.bind(element);
      element.addEventListener = (...args) => { if (args[0] === 'click' || args[0] === 'change') counter(); return original(...args); };
    }

    vi.spyOn(window, 'prompt').mockReturnValue('CLEAR');
    document.getElementById('clearData').click();

    // All local data is gone — persona keys plus the translation history key.
    expect(localStorage.getItem(KEYS.profiles)).toBeNull();
    expect(localStorage.getItem(KEYS.settings)).toBeNull();
    expect(localStorage.getItem(KEYS.active)).toBeNull();
    expect(localStorage.getItem(HISTORY_KEY)).toBeNull();

    // Controls reflect the default settings again.
    expect(document.querySelector('[data-response-language="English"]').classList.contains('active')).toBe(true);
    expect(document.querySelector('[data-response-language="Chinese"]').classList.contains('active')).toBe(false);
    expect(document.querySelector('[data-tone="Friendly"]').classList.contains('active')).toBe(true);
    expect(layerInput.checked).toBe(true);

    // No listeners were re-bound during the clear.
    expect(toneRegistrations).toBe(0);
    expect(languageRegistrations).toBe(0);
    expect(layerRegistrations).toBe(0);

    // The chat view re-rendered cleanly.
    expect(document.getElementById('storageSummary').textContent).toMatch(/^0 profiles · 0 saved messages/);
    expect(document.getElementById('chatProfileName').textContent).toBe('No profile selected');
    expect(document.getElementById('messages').textContent).toContain('Choose a profile');

    // Settings controls still work exactly once after the clear.
    document.querySelector('[data-tone="Direct"]').click();
    expect(document.querySelector('[data-tone="Direct"]').classList.contains('active')).toBe(true);
    expect(JSON.parse(localStorage.getItem(KEYS.settings)).tone).toBe('Direct');
  });

  it('boot does not rewrite storage when stored data is already normalized', () => {
    seedValidStore();
    const writes = [];
    const originalSetItem = localStorage.setItem.bind(localStorage);
    localStorage.setItem = (...args) => { writes.push(args[0]); return originalSetItem(...args); };

    initPersona();

    expect(writes).toEqual([]);
    // Stored values survived untouched.
    expect(JSON.parse(localStorage.getItem(KEYS.settings)).tone).toBe('Direct');
    expect(localStorage.getItem(HISTORY_KEY)).not.toBeNull();
    localStorage.setItem = originalSetItem;
  });

  it('boot rewrites storage only when normalization is required', () => {
    localStorage.setItem(KEYS.profiles, JSON.stringify([{ id: 'p1', name: 'Ana', nativeLanguage: 'Japanese', targetLanguage: 'Japanese', messages: [] }, { name: 'broken entry without id' }]));
    localStorage.setItem(KEYS.settings, JSON.stringify({ responseLanguage: 'Chinese' })); // missing tone + layers
    localStorage.setItem(KEYS.active, 'gone-id'); // stale pointer

    initPersona();

    // Profiles filtered, settings completed, active pointer corrected.
    const profiles = JSON.parse(localStorage.getItem(KEYS.profiles));
    expect(profiles).toHaveLength(1);
    expect(profiles[0].id).toBe('p1');
    const settings = JSON.parse(localStorage.getItem(KEYS.settings));
    expect(settings.tone).toBe('Friendly');
    expect(settings.layers).toEqual({ profile: true, history: true, preferences: true });
    expect(localStorage.getItem(KEYS.active)).toBe('p1');
  });
});

describe('persona.js settings backup + target language labels', () => {
  beforeEach(() => {
    localStorage.clear();
    buildDom();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('backup payload carries the translation history alongside profiles and settings', () => {
    seedValidStore();
    initPersona();

    const backup = buildBackup();
    expect(backup.schemaVersion).toBe(1);
    expect(backup.exportedAt).toBeTruthy();
    expect(backup.activeId).toBe('p1');
    expect(backup.profiles).toHaveLength(1);
    expect(backup.profiles[0].name).toBe('Ana');
    expect(backup.settings.tone).toBe('Direct');
    expect(backup.history).toHaveLength(1);
    expect(backup.history[0]).toMatchObject({ text: 'hi', translation: '你好', direction: 'en-zh' });
  });

  it('backup payload reports an empty history when none is stored', () => {
    initPersona();
    expect(buildBackup().history).toEqual([]);
  });

  it('Export data downloads a JSON backup containing the history', async () => {
    seedValidStore();
    initPersona();

    const blobs = [];
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      blobs.push(blob);
      return 'blob:mock-url';
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const anchor = { href: '', download: '', click: vi.fn() };
    vi.spyOn(document, 'createElement').mockReturnValue(anchor);

    document.getElementById('exportData').click();

    expect(anchor.download).toMatch(/^persona-backup-\d{4}-\d{2}-\d{2}\.json$/);
    expect(anchor.click).toHaveBeenCalled();
    expect(blobs).toHaveLength(1);
    const payload = JSON.parse(await blobs[0].text());
    expect(payload.history[0].text).toBe('hi');
    expect(payload.profiles[0].name).toBe('Ana');
  });

  it('changing the target language updates the selector labels', () => {
    seedValidStore();
    initPersona();

    const select = document.getElementById('targetLanguage');
    select.value = 'Japanese';
    select.dispatchEvent(new window.Event('change'));

    expect(select.value).toBe('Japanese');
    document.querySelectorAll('.target-label').forEach((label) => {
      expect(label.textContent).toBe('Japanese');
    });
    expect(document.getElementById('pinyinToggle').textContent).toBe('Show romaji');
    expect(document.getElementById('pronunciationLabel').textContent).toBe('ROMAJI');
  });

  it('applyTargetLanguage round-trips the selector, labels and pronunciation UI', () => {
    initPersona();

    applyTargetLanguage('Japanese');
    expect(document.getElementById('targetLanguage').value).toBe('Japanese');
    document.querySelectorAll('.target-label').forEach((label) => {
      expect(label.textContent).toBe('Japanese');
    });
    expect(document.getElementById('pinyinToggle').textContent).toBe('Show romaji');
    expect(document.getElementById('pronunciationLabel').textContent).toBe('ROMAJI');

    applyTargetLanguage('Chinese');
    expect(document.getElementById('targetLanguage').value).toBe('Chinese');
    document.querySelectorAll('.target-label').forEach((label) => {
      expect(label.textContent).toBe('Chinese');
    });
    expect(document.getElementById('pinyinToggle').textContent).toBe('Show pinyin');
    expect(document.getElementById('pronunciationLabel').textContent).toBe('PINYIN');
  });
});

describe('persona.js backup import', () => {
  beforeEach(() => {
    localStorage.clear();
    buildDom();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('normalizeBackup rejects anything that is not a PERSONA backup', () => {
    expect(normalizeBackup(null)).toBeNull();
    expect(normalizeBackup('text')).toBeNull();
    expect(normalizeBackup([])).toBeNull();
    expect(normalizeBackup({})).toBeNull();
    expect(normalizeBackup({ profiles: 'nope' })).toBeNull();
    expect(normalizeBackup({ profiles: {} })).toBeNull();
    expect(normalizeBackup({ settings: { tone: 'Direct' }, history: [] })).toBeNull();
  });

  it('normalizeBackup drops malformed entries, applies the storage caps and keeps defaults', () => {
    const messages = (count) => Array.from({ length: count }, (_, index) => ({ role: 'user', text: `m${index}` }));
    const backup = normalizeBackup({
      profiles: [
        { id: 'p1', name: 'Ana', messages: messages(520) },
        { name: 'missing id' },
        null,
        { id: 'p2', name: 'Bo', messages: [null, 'junk', { role: 'user', text: 'ok' }] },
      ],
      settings: { tone: 'Direct', layers: { history: false } },
      history: [
        ...Array.from({ length: 60 }, (_, index) => ({ id: index, text: `t${index}`, translation: '译', direction: 'en-zh', timestamp: new Date().toISOString() })),
        { text: 42 },
        null,
        { translation: 'no source text' },
      ],
      activeId: 'p2',
    });

    expect(backup.profiles.map((profile) => profile.id)).toEqual(['p1', 'p2']);
    expect(backup.profiles[0].messages).toHaveLength(500);
    expect(backup.profiles[1].messages).toHaveLength(1);
    expect(backup.history).toHaveLength(50);
    expect(backup.history.every((entry) => typeof entry.text === 'string' && typeof entry.translation === 'string')).toBe(true);
    expect(backup.settings.tone).toBe('Direct');
    expect(backup.settings.responseLanguage).toBe('English');
    expect(backup.settings.layers).toEqual({ profile: true, history: false, preferences: true });
    expect(backup.activeId).toBe('p2');
    expect(backup.counts).toEqual({ profiles: 2, messages: 501, translations: 50 });
  });

  it('normalizeBackup falls back to the first profile when the active id is unknown', () => {
    const backup = normalizeBackup({ profiles: [{ id: 'p1', name: 'Ana' }], activeId: 'gone' });
    expect(backup.activeId).toBe('p1');
  });

  it('importBackupText replaces local data after a counted confirm and reports the result', () => {
    seedValidStore();
    initPersona();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    const applied = importBackupText(JSON.stringify({
      schemaVersion: 1,
      activeId: 'p9',
      profiles: [{ id: 'p9', name: 'Bo' }, { id: 'p10', name: 'Cy', messages: [] }],
      settings: { tone: 'Direct' },
      history: [{ id: 7, text: 'good morning', translation: '早上好', direction: 'en-zh', timestamp: new Date().toISOString() }],
    }));

    expect(applied).toBe(true);
    const question = confirmSpy.mock.calls[0][0];
    expect(question).toContain('Profiles: 2');
    expect(question).toContain('Saved messages: 0');
    expect(question).toContain('Translations: 1');

    expect(JSON.parse(localStorage.getItem(KEYS.profiles)).map((profile) => profile.name)).toEqual(['Bo', 'Cy']);
    expect(localStorage.getItem(KEYS.active)).toBe('p9');
    const storedSettings = JSON.parse(localStorage.getItem(KEYS.settings));
    expect(storedSettings.tone).toBe('Direct');
    expect(storedSettings.responseLanguage).toBe('English');
    expect(JSON.parse(localStorage.getItem(HISTORY_KEY)).map((entry) => entry.text)).toEqual(['good morning']);

    expect(document.getElementById('importStatus').textContent).toBe('Imported 2 profiles and 1 translation.');
    expect(document.getElementById('storageSummary').textContent).toMatch(/^2 profiles · 0 saved messages/);
    expect(document.getElementById('chatProfileName').textContent).toBe('Bo');
  });

  it('rejects invalid files and cancelled confirms without changing current data', () => {
    seedValidStore();
    initPersona();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);

    expect(importBackupText('not json at all')).toBe(false);
    expect(document.getElementById('importStatus').textContent).toBe('That file is not a PERSONA backup.');
    expect(importBackupText(JSON.stringify({ hello: 'world' }))).toBe(false);
    expect(document.getElementById('importStatus').textContent).toBe('That file is not a PERSONA backup.');
    expect(confirmSpy).not.toHaveBeenCalled();

    expect(importBackupText(JSON.stringify({ profiles: [{ id: 'x', name: 'X' }] }))).toBe(false);
    expect(document.getElementById('importStatus').textContent).toBe('Import cancelled.');
    expect(confirmSpy).toHaveBeenCalledTimes(1);

    expect(JSON.parse(localStorage.getItem(KEYS.profiles)).map((profile) => profile.name)).toEqual(['Ana']);
    expect(JSON.parse(localStorage.getItem(KEYS.settings)).tone).toBe('Direct');
    expect(localStorage.getItem(KEYS.active)).toBe('p1');
    expect(JSON.parse(localStorage.getItem(HISTORY_KEY)).map((entry) => entry.text)).toEqual(['hi']);
    expect(document.getElementById('chatProfileName').textContent).toBe('Ana');
  });

  it('import and clear both dispatch the local-data event for the history UI', () => {
    seedValidStore();
    initPersona();
    const listener = vi.fn();
    document.addEventListener(LOCAL_DATA_EVENT, listener);
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    importBackupText(JSON.stringify({ profiles: [], history: [] }));
    expect(listener).toHaveBeenCalledTimes(1);

    vi.spyOn(window, 'prompt').mockReturnValue('CLEAR');
    document.getElementById('clearData').click();
    expect(listener).toHaveBeenCalledTimes(2);
    document.removeEventListener(LOCAL_DATA_EVENT, listener);
  });

  it('the file input resets after selection and imports the chosen file', async () => {
    initPersona();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const input = document.getElementById('importFile');
    const file = { name: 'backup.json', type: 'application/json', text: async () => JSON.stringify({ profiles: [] }) };
    Object.defineProperty(input, 'files', { value: [file], configurable: true });

    input.dispatchEvent(new window.Event('change'));

    await vi.waitFor(() => {
      expect(document.getElementById('importStatus').textContent).toBe('Imported 0 profiles and 0 translations.');
    });
    expect(input.value).toBe('');
  });
});