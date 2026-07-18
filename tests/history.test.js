import { describe, it, expect, beforeEach } from 'vitest';
import { getHistory, addToHistory, exportHistoryCSV } from '../src/history.js';

describe('history module', () => {
  const STORAGE_KEY = 'minichat_history';

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
  });
});
