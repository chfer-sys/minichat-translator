import { describe, it, expect, beforeEach } from 'vitest';
import { state } from '../src/state.js';
import { cacheElements, loadHistoryItem } from '../src/ui.js';
import {
  getHistory,
  addToHistory,
  exportHistoryCSV,
  renderHistoryHTML,
  normalizeTargetLanguage,
  directionLabel,
} from '../src/history.js';

const STORAGE_KEY = 'minichat_history';

describe('history module', () => {
  beforeEach(() => {
    // Reset localStorage before each test
    localStorage.setItem(STORAGE_KEY, '[]');
  });

  describe('getHistory / saveHistory', () => {
    it('returns empty array when no history exists', () => {
      localStorage.removeItem(STORAGE_KEY);
      expect(getHistory()).toEqual([]);
    });

    it('returns parsed history from localStorage', () => {
      const entry = {
        id: 1,
        text: 'hello',
        translation: '你好',
        direction: 'en-zh',
        timestamp: '2026-07-18T00:00:00Z',
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify([entry]));
      expect(getHistory()).toEqual([entry]);
    });

    it('returns empty array on corrupted JSON', () => {
      localStorage.setItem(STORAGE_KEY, 'not valid json');
      expect(getHistory()).toEqual([]);
    });
  });

  describe('addToHistory', () => {
    it('adds an entry at the front', () => {
      addToHistory('hello', '你好', 'en-zh');
      const history = getHistory();
      expect(history.length).toBe(1);
      expect(history[0].text).toBe('hello');
      expect(history[0].translation).toBe('你好');
      expect(history[0].direction).toBe('en-zh');
      expect(history[0].id).toBeGreaterThan(0);
      expect(history[0].timestamp).toBeTruthy();
    });

    it('prepends when history already has entries', () => {
      addToHistory('first', '一', 'en-zh');
      addToHistory('second', '二', 'en-zh');
      const history = getHistory();
      expect(history.length).toBe(2);
      expect(history[0].text).toBe('second');
      expect(history[1].text).toBe('first');
    });

    it('caps history at 50 entries (FIFO)', () => {
      for (let i = 0; i < 60; i++) {
        addToHistory(`text${i}`, `trans${i}`, 'en-zh');
      }
      const history = getHistory();
      expect(history.length).toBe(50);
      expect(history[0].text).toBe('text59'); // newest
      expect(history[49].text).toBe('text10'); // 50th entry
    });
  });

  describe('exportHistoryCSV', () => {
    it('returns empty string when no history', () => {
      expect(exportHistoryCSV()).toBe('');
    });

    it('produces correct CSV header and columns', () => {
      addToHistory('Hello', '你好', 'en-zh');
      const csv = exportHistoryCSV();
      expect(csv).toMatch(/^Direction,Source Text,Translation,Timestamp/);
      expect(csv).toMatch(/"EN → ZH"/);
      expect(csv).toMatch(/"Hello"/);
      expect(csv).toMatch(/"你好"/);
    });

    it('escapes double quotes in text by doubling them', () => {
      addToHistory('say "hi"', '说"嗨"', 'en-zh');
      const csv = exportHistoryCSV();
      // The source field should have "" for each "
      expect(csv).toMatch(/"say ""hi"""/);
    });

    it('produces one row per history entry', () => {
      addToHistory('hello', '你好', 'en-zh');
      addToHistory('world', '世界', 'zh-en');
      const csv = exportHistoryCSV();
      const lines = csv.trim().split('\n');
      expect(lines.length).toBe(3); // header + 2 rows
    });

    it('labels a Japanese record EN → JA instead of EN → ZH', () => {
      addToHistory('Hello', 'こんにちは', 'en-zh', 'Japanese');
      const csv = exportHistoryCSV();
      expect(csv).toMatch(/"EN → JA"/);
      expect(csv).not.toMatch(/EN → ZH/);
    });

    it('labels a Japanese zh-en record as JA → EN', () => {
      addToHistory('こんにちは', 'Hello', 'zh-en', 'Japanese');
      expect(exportHistoryCSV()).toMatch(/"JA → EN"/);
    });

    it('keeps legacy records without targetLanguage as EN → ZH', () => {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify([
          {
            id: 1,
            text: 'hi',
            translation: '你好',
            direction: 'en-zh',
            timestamp: '2026-07-18T00:00:00Z',
          },
        ]),
      );
      expect(exportHistoryCSV()).toMatch(/"EN → ZH"/);
    });
  });

  describe('targetLanguage on entries', () => {
    it('defaults to Chinese when the caller omits it', () => {
      addToHistory('hello', '你好', 'en-zh');
      expect(getHistory()[0].targetLanguage).toBe('Chinese');
    });

    it('stores an explicit target language', () => {
      addToHistory('hello', 'こんにちは', 'en-zh', 'Japanese');
      expect(getHistory()[0].targetLanguage).toBe('Japanese');
    });

    it('normalizes blank and missing values to Chinese', () => {
      expect(normalizeTargetLanguage(undefined)).toBe('Chinese');
      expect(normalizeTargetLanguage(null)).toBe('Chinese');
      expect(normalizeTargetLanguage('   ')).toBe('Chinese');
      expect(normalizeTargetLanguage('Japanese')).toBe('Japanese');
      addToHistory('a', 'b', 'en-zh', '   ');
      expect(getHistory()[0].targetLanguage).toBe('Chinese');
    });

    it('keeps the other entry fields intact', () => {
      addToHistory('hello', 'こんにちは', 'en-zh', 'Japanese');
      const [entry] = getHistory();
      expect(entry).toMatchObject({ text: 'hello', translation: 'こんにちは', direction: 'en-zh' });
      expect(entry.id).toBeGreaterThan(0);
      expect(entry.timestamp).toBeTruthy();
    });
  });

  describe('directionLabel', () => {
    it('maps Chinese and Japanese to ZH and JA', () => {
      expect(directionLabel('en-zh', 'Chinese')).toBe('EN → ZH');
      expect(directionLabel('en-zh', 'Japanese')).toBe('EN → JA');
      expect(directionLabel('zh-en', 'Japanese')).toBe('JA → EN');
    });

    it('falls back to Chinese for entries written before the field existed', () => {
      expect(directionLabel('en-zh')).toBe('EN → ZH');
      expect(directionLabel('zh-en', undefined)).toBe('ZH → EN');
    });

    it('abbreviates unknown languages to their first two letters', () => {
      expect(directionLabel('en-zh', 'Korean')).toBe('EN → KO');
    });
  });

  describe('renderHistoryHTML', () => {
    it('renders a Japanese record with an EN → JA label', () => {
      addToHistory('Hello', 'こんにちは', 'en-zh', 'Japanese');
      const html = renderHistoryHTML(getHistory());
      expect(html).toContain('EN → JA');
      expect(html).not.toContain('EN → ZH');
      expect(html).toContain('こんにちは');
    });

    it('renders a Japanese zh-en record with a JA → EN label', () => {
      addToHistory('こんにちは', 'Hello', 'zh-en', 'Japanese');
      expect(renderHistoryHTML(getHistory())).toContain('JA → EN');
    });

    it('renders legacy records without targetLanguage as EN → ZH', () => {
      const legacy = {
        id: 7,
        text: 'hello',
        translation: '你好',
        direction: 'en-zh',
        timestamp: '2026-07-18T00:00:00Z',
      };
      const html = renderHistoryHTML([legacy]);
      expect(html).toContain('EN → ZH');
      expect(html).toContain('data-id="7"');
    });

    it('returns the empty state when there is no history', () => {
      expect(renderHistoryHTML([])).toContain('No translation history yet');
    });
  });
});

describe('loadHistoryItem (history restore)', () => {
  beforeEach(() => {
    localStorage.setItem(STORAGE_KEY, '[]');
    document.body.innerHTML = `
      <textarea id="input"></textarea>
      <span id="charCount">0 chars</span>
      <div id="outputWrap" style="display:none;"></div>
      <div id="output"></div>
      <div id="pinyinSection" style="display:none;">
        <button id="pinyinToggle">Show pinyin</button>
        <div id="pinyinText"></div>
      </div>
      <span id="pronunciationLabel">PINYIN</span>
      <button id="historyBtn">History</button>
      <div id="historyPanel" class="open"></div>
      <div id="historyList"></div>
      <div id="historyFooter" style="display:none;"></div>
      <button class="lang-btn" data-dir="en-zh">English → <span class="target-label">Chinese</span></button>
      <button class="lang-btn" data-dir="zh-en"><span class="target-label">Chinese</span> → English</button>
      <select id="targetLanguage"><option value="Chinese">中文</option><option value="Japanese">日本語</option></select>
    `;
    document.querySelector('.lang-btn[data-dir="en-zh"]').classList.add('active');
    cacheElements();
  });

  const japaneseEntry = {
    id: 42,
    text: 'Good morning',
    translation: 'おはようございます',
    direction: 'en-zh',
    targetLanguage: 'Japanese',
    timestamp: '2026-07-18T00:00:00Z',
  };

  it('restores the target-language selector and labels for a Japanese record', () => {
    loadHistoryItem(japaneseEntry);

    expect(document.getElementById('targetLanguage').value).toBe('Japanese');
    document.querySelectorAll('.target-label').forEach((label) => {
      expect(label.textContent).toBe('Japanese');
    });
    expect(state.currentDir).toBe('en-zh');
    expect(document.querySelector('.lang-btn.active').dataset.dir).toBe('en-zh');
    expect(document.getElementById('input').value).toBe('Good morning');
    expect(document.getElementById('output').textContent).toBe('おはようございます');
    expect(document.getElementById('outputWrap').style.display).toBe('block');
    expect(document.getElementById('pronunciationLabel').textContent).toBe('ROMAJI');
    expect(document.getElementById('pinyinToggle').textContent).toBe('Show romaji');
    expect(document.getElementById('historyPanel').classList.contains('open')).toBe(false);
  });

  it('activates the matching direction button for a Japanese zh-en record', () => {
    loadHistoryItem({
      ...japaneseEntry,
      text: 'おはようございます',
      translation: 'Good morning',
      direction: 'zh-en',
    });

    expect(document.querySelector('.lang-btn.active').dataset.dir).toBe('zh-en');
    expect(document.getElementById('targetLanguage').value).toBe('Japanese');
    document.querySelectorAll('.target-label').forEach((label) => {
      expect(label.textContent).toBe('Japanese');
    });
  });

  it('leaves the selector alone for legacy records without targetLanguage', () => {
    const select = document.getElementById('targetLanguage');
    // The user's current selection, selector and labels in sync.
    select.value = 'Japanese';
    document.querySelectorAll('.target-label').forEach((label) => {
      label.textContent = 'Japanese';
    });

    loadHistoryItem({
      id: 7,
      text: 'hello',
      translation: '你好',
      direction: 'en-zh',
      timestamp: '2026-07-18T00:00:00Z',
    });

    expect(select.value).toBe('Japanese');
    document.querySelectorAll('.target-label').forEach((label) => {
      expect(label.textContent).toBe('Japanese');
    });
    expect(document.getElementById('input').value).toBe('hello');
    expect(document.getElementById('output').textContent).toBe('你好');
  });
});
