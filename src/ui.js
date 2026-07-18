/**
 * UI orchestrator — wires DOM events to extracted modules.
 * Phase 2: extracted from index.html inline script.
 * index.html loads this via <script type="module" src="/src/ui.js"></script>
 */
import { state } from './state.js';
import { translate, startTimer, stopTimer } from './translate.js';
import { loadPinyin } from './pinyin.js';
import { copyToClipboard } from './clipboard.js';
import { registerServiceWorker } from './sw-register.js';
import { getHistory, saveHistory, addToHistory, exportHistoryCSV, renderHistoryHTML } from './history.js';

/** @type {HTMLTextAreaElement} */
let input;
/** @type {HTMLSpanElement} */
let charCount;
/** @type {HTMLButtonElement} */
let translateBtn;
/** @type {HTMLDivElement} */
let outputWrap;
/** @type {HTMLDivElement} */
let output;
/** @type {HTMLDivElement} */
let pinyinSection;
/** @type {HTMLButtonElement} */
let pinyinToggle;
/** @type {HTMLDivElement} */
let pinyinText;
/** @type {HTMLButtonElement} */
let copyBtn;
/** @type {HTMLDivElement} */
let errorEl;
/** @type {HTMLParagraphElement} */
let pwaNote;
/** @type {NodeListOf<HTMLButtonElement>} */
let langBtns;
/** @type {HTMLButtonElement} */
let historyBtn;
/** @type {HTMLDivElement} */
let historyPanel;
/** @type {HTMLDivElement} */
let historyList;
/** @type {HTMLDivElement} */
let historyFooter;
/** @type {HTMLButtonElement} */
let clearHistoryBtn;
/** @type {HTMLButtonElement} */
let exportHistoryBtn;

/**
 * Cache all DOM references by id.
 * Exported so tests can call it directly before using handlers.
 */
export function cacheElements() {
  input = document.getElementById('input');
  charCount = document.getElementById('charCount');
  translateBtn = document.getElementById('translateBtn');
  outputWrap = document.getElementById('outputWrap');
  output = document.getElementById('output');
  pinyinSection = document.getElementById('pinyinSection');
  pinyinToggle = document.getElementById('pinyinToggle');
  pinyinText = document.getElementById('pinyinText');
  copyBtn = document.getElementById('copyBtn');
  errorEl = document.getElementById('error');
  pwaNote = document.getElementById('pwaNote');
  langBtns = document.querySelectorAll('.lang-btn');
  historyBtn = document.getElementById('historyBtn');
  historyPanel = document.getElementById('historyPanel');
  historyList = document.getElementById('historyList');
  historyFooter = document.getElementById('historyFooter');
  clearHistoryBtn = document.getElementById('clearHistoryBtn');
  exportHistoryBtn = document.getElementById('exportHistoryBtn');
}

/** PWA: hide install note if already installed */
function initPWA() {
  if (window.matchMedia?.('(display-mode: standalone)').matches) {
    pwaNote.classList.add('hidden');
  }
}

/** Character count live update */
function initCharCount() {
  input.addEventListener('input', () => {
    const len = input.value.length;
    charCount.textContent = `${len} char${len !== 1 ? 's' : ''}`;
  });
}

/** Language direction toggle */
function initLanguageToggle() {
  langBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      handleLanguageBtnClick(btn.dataset.dir);
    });
  });
}

/**
 * Handle language button click (exported for testing).
 * @param {string} dir  'en-zh' | 'zh-en'
 */
export function handleLanguageBtnClick(dir) {
  langBtns.forEach((b) => b.classList.remove('active'));
  const btn = Array.from(langBtns).find((b) => b.dataset.dir === dir);
  if (btn) btn.classList.add('active');
  state.currentDir = dir;
  // Clear output on direction change
  outputWrap.style.display = 'none';
  pinyinSection.style.display = 'none';
  state.pinyinLoaded = false;
}

/** History panel toggle */
function initHistoryToggle() {
  historyBtn.addEventListener('click', () => {
    const isOpen = historyPanel.classList.toggle('open');
    historyBtn.classList.toggle('active', isOpen);
    if (isOpen) {
      renderHistoryDOM();
    }
  });
}

/** Clear history */
function initClearHistory() {
  clearHistoryBtn.addEventListener('click', () => {
    if (confirm('Clear all translation history?')) {
      saveHistory([]);
      renderHistoryDOM();
    }
  });
}

/** Export CSV */
function initExportHistory() {
  exportHistoryBtn.addEventListener('click', () => {
    const csv = exportHistoryCSV();
    if (!csv) {
      alert('No history to export.');
      return;
    }
    downloadCSV(
      `minichat-translations-${new Date().toISOString().slice(0, 10)}.csv`,
      csv,
    );
  });
}

/**
 * Download a CSV string as a file.
 * @param {string} filename
 * @param {string} content  CSV text
 */
export function downloadCSV(filename, content) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Render history into the DOM (DOM-wiring half).
 * Calls the pure renderHistoryHTML and wires click handlers.
 */
export function renderHistoryDOM() {
  const items = getHistory();
  historyList.innerHTML = renderHistoryHTML(items);
  historyFooter.style.display = items.length > 0 ? 'block' : 'none';

  // Attach click handlers to each history item
  historyList.querySelectorAll('.history-item').forEach((el) => {
    el.addEventListener('click', () => {
      const id = parseInt(el.dataset.id);
      const item = getHistory().find((h) => h.id === id);
      if (item) {
        loadHistoryItem(item);
      }
    });
  });
}

/** Load a history item back into the main UI */
export function loadHistoryItem(item) {
  state.currentDir = item.direction;
  langBtns.forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.dir === item.direction);
  });
  input.value = item.text;
  charCount.textContent = `${item.text.length} char${item.text.length !== 1 ? 's' : ''}`;
  state.lastSourceText = item.text;
  state.lastTranslation = item.translation;
  output.textContent = item.translation;
  outputWrap.style.display = 'block';
  pinyinSection.style.display = 'none';
  state.pinyinLoaded = false;
  historyPanel.classList.remove('open');
  historyBtn.classList.remove('active');
}

/** Main translate handler */
export async function handleTranslateClick() {
  const text = input.value.trim();
  if (!text) return;
  if (state.isTranslating) return; // guard against double-click

  state.isTranslating = true;
  errorEl.textContent = '';
  outputWrap.style.display = 'none';
  pinyinSection.style.display = 'none';
  startTimer(translateBtn);
  translateBtn.disabled = true;

  try {
    const { translation } = await translate(text, state.currentDir);
    state.lastTranslation = translation;
    state.lastSourceText = text;
    output.textContent = translation;
    outputWrap.style.display = 'block';

    addToHistory(text, translation, state.currentDir);

    if (state.currentDir === 'zh-en') {
      pinyinSection.style.display = 'block';
      pinyinToggle.textContent = 'Show Pinyin';
      pinyinText.style.display = 'none';
      state.pinyinLoaded = false;
    }
  } catch (err) {
    errorEl.textContent = 'Translation failed: ' + (err.message || 'Unknown error');
    console.error('Translation error:', err);
  } finally {
    state.isTranslating = false;
    stopTimer(translateBtn);
    translateBtn.disabled = false;
  }
}

/** Pinyin toggle handler (lazy load) */
export async function handlePinyinToggle() {
  if (pinyinText.style.display === 'none') {
    if (!state.pinyinLoaded) {
      pinyinToggle.textContent = 'Loading...';
      try {
        const pinyin = await loadPinyin(state.lastTranslation);
        pinyinText.textContent = pinyin;
        state.pinyinLoaded = true;
      } catch {
        pinyinText.textContent = '(failed to load pinyin)';
      }
      pinyinToggle.textContent = 'Hide Pinyin';
      pinyinText.style.display = 'block';
    } else {
      pinyinToggle.textContent = 'Hide Pinyin';
      pinyinText.style.display = 'block';
    }
  } else {
    pinyinToggle.textContent = 'Show Pinyin';
    pinyinText.style.display = 'none';
  }
}

/** Copy handler */
export function handleCopyClick() {
  const text = state.lastTranslation;
  if (!text) {
    errorEl.textContent = 'Nothing to copy yet';
    return;
  }
  copyToClipboard(
    text,
    () => {
      copyBtn.textContent = 'Copied!';
      copyBtn.classList.add('copied');
      setTimeout(() => {
        copyBtn.textContent = 'Copy';
        copyBtn.classList.remove('copied');
      }, 1500);
    },
    () => {
      // fallback error — already handled inside copyToClipboard
    },
  );
}

/** Wire all event listeners */
function wireEvents() {
  translateBtn.addEventListener('click', handleTranslateClick);
  pinyinToggle.addEventListener('click', handlePinyinToggle);
  copyBtn.addEventListener('click', handleCopyClick);
}

/**
 * Initialize the app — call once on DOMContentLoaded.
 * Exports for testability; index.html calls this directly.
 */
export function init() {
  cacheElements();
  initPWA();
  initCharCount();
  initLanguageToggle();
  initHistoryToggle();
  initClearHistory();
  initExportHistory();
  wireEvents();
  registerServiceWorker();
}
