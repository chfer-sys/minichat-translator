const STORAGE_KEY = 'minichat_history';
const MAX_HISTORY = 50;

/**
 * Get all history entries from localStorage.
 * @returns {Array<{id: number, text: string, translation: string, direction: string, timestamp: string}>}
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
 */
export function addToHistory(text, translation, direction) {
  const history = getHistory();
  const entry = {
    id: Date.now(),
    text,
    translation,
    direction,
    timestamp: new Date().toISOString(),
  };
  history.unshift(entry);
  if (history.length > MAX_HISTORY) {
    history.pop();
  }
  saveHistory(history);
}

/**
 * Export history as a CSV Blob for download.
 * @returns {string} CSV content
 */
export function exportHistoryCSV() {
  const history = getHistory();
  if (history.length === 0) {
    return '';
  }
  const header = 'Direction,Source Text,Translation,Timestamp\n';
  const rows = history
    .map((item) => {
      const dir = item.direction === 'en-zh' ? 'EN → ZH' : 'ZH → EN';
      const source = item.text.replace(/"/g, '""');
      const trans = item.translation.replace(/"/g, '""');
      const ts = new Date(item.timestamp).toISOString();
      return `"${dir}","${source}","${trans}","${ts}"`;
    })
    .join('\n');
  return header + rows;
}

/**
 * Trigger a CSV download of history.
 * Uses the browser's Blob + Object URL pattern.
 */
export function downloadHistoryCSV() {
  const csv = exportHistoryCSV();
  if (!csv) {
    alert('No history to export.');
    return;
  }
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `minichat-translations-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
