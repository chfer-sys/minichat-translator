/**
 * DOM tests for ui.js — tests the UI behavior directly via exported handlers.
 * Uses happy-dom (configured in vitest.config.js).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { state } from '../src/state.js';
import {
  cacheElements,
  handleCopyClick,
  handleLanguageBtnClick,
  loadHistoryItem,
  downloadCSV,
} from '../src/ui.js';

describe('ui.js DOM behavior', () => {
  // -------------------------------------------------------------------------
  // DOM scaffold — set up the required element ids before each test
  // -------------------------------------------------------------------------
  beforeEach(() => {
    // Reset state
    state.currentDir = 'en-zh';
    state.isTranslating = false;
    state.lastTranslation = '';
    state.lastSourceText = '';
    state.pinyinLoaded = false;
    state.elapsedSeconds = 0;
    state.timerInterval = null;

    // Build minimal DOM so cacheElements() finds everything
    document.body.innerHTML = `
      <textarea id="input"></textarea>
      <span id="charCount">0 chars</span>
      <button id="translateBtn">Translate</button>
      <div id="outputWrap" style="display:none;"></div>
      <div id="output"></div>
      <div id="pinyinSection" style="display:none;">
        <button id="pinyinToggle">Show Pinyin</button>
        <div id="pinyinText"></div>
      </div>
      <button id="copyBtn">Copy</button>
      <div id="error"></div>
      <p id="pwaNote">Add to home screen</p>
      <button class="lang-btn active" data-dir="en-zh">EN → ZH</button>
      <button class="lang-btn" data-dir="zh-en">ZH → EN</button>
      <button id="historyBtn">History</button>
      <div id="historyPanel"></div>
      <div id="historyList"></div>
      <div id="historyFooter" style="display:none;"></div>
      <button id="clearHistoryBtn">Clear all history</button>
      <button id="exportHistoryBtn">Export CSV</button>
    `;

    // Clear localStorage mock
    localStorage.setItem('minichat_history', '[]');

    // Wire up DOM references so exported handlers work
    cacheElements();
  });

  // -------------------------------------------------------------------------
  // Test 1: language toggle clears output on switch
  // -------------------------------------------------------------------------
  it('handleLanguageBtnClick hides the output when switching language direction', () => {
    const outputWrap = document.getElementById('outputWrap');
    const pinyinSection = document.getElementById('pinyinSection');

    // Show output first (simulate a translation happened)
    outputWrap.style.display = 'block';
    pinyinSection.style.display = 'block';

    // Switch language direction
    handleLanguageBtnClick('zh-en');

    // Output and pinyin should be hidden
    expect(outputWrap.style.display).toBe('none');
    expect(pinyinSection.style.display).toBe('none');
    expect(state.currentDir).toBe('zh-en');
  });

  it('handleLanguageBtnClick activates the correct lang button', () => {
    const langBtns = document.querySelectorAll('.lang-btn');

    handleLanguageBtnClick('zh-en');

    const zhBtn = Array.from(langBtns).find((b) => b.dataset.dir === 'zh-en');
    const enBtn = Array.from(langBtns).find((b) => b.dataset.dir === 'en-zh');
    expect(zhBtn.classList.contains('active')).toBe(true);
    expect(enBtn.classList.contains('active')).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Test 2: history click loads entry into main UI
  // -------------------------------------------------------------------------
  it('loadHistoryItem restores a history entry into the main UI', () => {
    const input = document.getElementById('input');
    const output = document.getElementById('output');
    const outputWrap = document.getElementById('outputWrap');
    const pinyinSection = document.getElementById('pinyinSection');
    const charCount = document.getElementById('charCount');

    const item = {
      id: 123,
      text: 'hello world',
      translation: '你好世界',
      direction: 'en-zh',
      timestamp: new Date().toISOString(),
    };

    loadHistoryItem(item);

    expect(input.value).toBe('hello world');
    expect(output.textContent).toBe('你好世界');
    expect(outputWrap.style.display).toBe('block');
    expect(pinyinSection.style.display).toBe('none');
    expect(charCount.textContent).toBe('11 chars');
    expect(state.lastSourceText).toBe('hello world');
    expect(state.lastTranslation).toBe('你好世界');
  });

  // -------------------------------------------------------------------------
  // Test 3: copy button shows "Copied!" feedback
  // -------------------------------------------------------------------------
  it('handleCopyClick shows "Copied!" feedback on success', async () => {
    // Set a translation to copy
    state.lastTranslation = 'test translation';

    const copyBtn = document.getElementById('copyBtn');

    // Mock copyToClipboard to call onSuccess immediately (no clipboard API needed)
    const clipboardModule = await import('../src/clipboard.js');
    const spy = vi
      .spyOn(clipboardModule, 'copyToClipboard')
      .mockImplementation((_text, onSuccess) => {
        onSuccess();
        return Promise.resolve();
      });

    handleCopyClick();

    // Should show "Copied!" immediately
    expect(copyBtn.textContent).toBe('Copied!');
    expect(copyBtn.classList.contains('copied')).toBe(true);

    // Wait for the 1500ms timeout to reset
    await new Promise((r) => setTimeout(r, 1600));
    expect(copyBtn.textContent).toBe('Copy');
    expect(copyBtn.classList.contains('copied')).toBe(false);

    spy.mockRestore();
  });

  it('handleCopyClick shows error when nothing to copy', () => {
    state.lastTranslation = '';
    const errorEl = document.getElementById('error');
    const copyBtn = document.getElementById('copyBtn');

    handleCopyClick();

    expect(errorEl.textContent).toBe('Nothing to copy yet');
    expect(copyBtn.textContent).toBe('Copy'); // not changed
  });

  // -------------------------------------------------------------------------
  // Test 4: downloadCSV creates a Blob URL and triggers anchor download
  // -------------------------------------------------------------------------
  it('downloadCSV creates a Blob URL and clicks the anchor', () => {
    const mockAnchor = { href: '', download: '', click: vi.fn() };
    const createSpy = vi.spyOn(document, 'createElement').mockReturnValue(mockAnchor);
    const createObjectURLSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-url');
    const revokeObjectURLSpy = vi.spyOn(URL, 'revokeObjectURL');

    downloadCSV('test.csv', 'col1,col2\n"a","b"');

    expect(createObjectURLSpy).toHaveBeenCalled();
    expect(mockAnchor.download).toBe('test.csv');
    expect(mockAnchor.click).toHaveBeenCalled();
    expect(revokeObjectURLSpy).toHaveBeenCalledWith('blob:mock-url');

    createSpy.mockRestore();
    createObjectURLSpy.mockRestore();
    revokeObjectURLSpy.mockRestore();
  });
});
