import { formatRelativeTime } from './time.js';
import { escapeHtml } from './escape.js';

const STORAGE_KEY = 'minichat_history';
const MAX_HISTORY = 50;
const DEFAULT_TARGET_LANGUAGE = 'Chinese';
const LANGUAGE_CODES = { Chinese: 'ZH', Japanese: 'JA' };

/**
 * Normalize a target language read from storage or caller input.
 * Entries recorded before the targetLanguage field existed were written while
 * Chinese was selected, so a missing/blank value falls back to Chinese.
 * @param {string} [value]
 * @returns {string}
 */
export function normalizeTargetLanguage(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : DEFAULT_TARGET_LANGUAGE;
}

/**
 * Direction label for one history entry: "EN → ZH", "ZH → EN", "EN → JA", ...
 * @param {string} direction  'en-zh' | 'zh-en'
 * @param {string} [targetLanguage]
 * @returns {string}
 */
export function directionLabel(direction, targetLanguage) {
  const language = normalizeTargetLanguage(targetLanguage);
  const code = LANGUAGE_CODES[language] || language.slice(0, 2).toUpperCase();
  return direction === 'en-zh' ? `EN → ${code}` : `${code} → EN`;
}

/**
 * Get all history entries from localStorage.
 * @returns {Array<{id: number, text: string, translation: string, direction: string,
 *   targetLanguage?: string, timestamp: string}>}
 */
export function getHistory() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  } catch {
    return [];
  }
}

/**
 * Save history array to localStorage.
 * @param {Array} history
 */
export function saveHistory(history) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
}

/**
 * Add a new entry to history (prepend, enforce FIFO cap).
 * @param {string} text
 * @param {string} translation
 * @param {string} direction
 * @param {string} [targetLanguage] language selected when the translation was made
 */
export function addToHistory(
  text,
  translation,
  direction,
  targetLanguage = DEFAULT_TARGET_LANGUAGE,
) {
  const history = getHistory();
  const entry = {
    id: Date.now(),
    text,
    translation,
    direction,
    targetLanguage: normalizeTargetLanguage(targetLanguage),
    timestamp: new Date().toISOString(),
  };
  history.unshift(entry);
  if (history.length > MAX_HISTORY) {
    history.pop();
  }
  saveHistory(history);
}

/**
 * Export history as a CSV string.
 * @returns {string} CSV content (empty string if no history)
 */
export function exportHistoryCSV() {
  const history = getHistory();
  if (history.length === 0) {
    return '';
  }
  const header = 'Direction,Source Text,Translation,Timestamp\n';
  const rows = history
    .map((item) => {
      const dir = directionLabel(item.direction, item.targetLanguage);
      const source = item.text.replace(/"/g, '""');
      const trans = item.translation.replace(/"/g, '""');
      const ts = new Date(item.timestamp).toISOString();
      return `"${dir}","${source}","${trans}","${ts}"`;
    })
    .join('\n');
  return header + rows;
}

/**
 * Render history items as an HTML string (pure — no DOM side-effects).
 * @param {Array} items  history array from getHistory()
 * @returns {string} HTML
 */
export function renderHistoryHTML(items) {
  if (items.length === 0) {
    return '<div class="history-empty">No translation history yet</div>';
  }
  return items
    .map((item) => {
      const dirLabel = directionLabel(item.direction, item.targetLanguage);
      const relativeTime = formatRelativeTime(item.timestamp);
      const escapedText = escapeHtml(item.text);
      const escapedTranslation = escapeHtml(item.translation);
      return `<div class="history-item" data-id="${item.id}">
      <div class="history-item-header">
        <span class="history-item-dir">${dirLabel}</span>
        <span class="history-item-time">${relativeTime}</span>
      </div>
      <div class="history-item-source">${escapedText}</div>
      <div class="history-item-translation">${escapedTranslation}</div>
    </div>`;
    })
    .join('');
}
