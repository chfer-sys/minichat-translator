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
import { checkHealth } from './health.js';
import { naturalize } from './naturalize.js';
import { composeReply } from './reply.js';

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
/** @type {HTMLButtonElement} */
let statusBtn;
/** @type {HTMLSpanElement} */
let statusDot;
/** @type {HTMLSpanElement} */
let statusText;
/** @type {NodeListOf<HTMLButtonElement>} */
let modeTabs;
/** @type {HTMLDivElement} */
let translatePanel;
/** @type {HTMLDivElement} */
let naturalizePanel;
/** @type {HTMLDivElement} */
let replyPanel;
/** @type {HTMLTextAreaElement} */
let naturalizeInput;
/** @type {HTMLButtonElement} */
let naturalizeBtn;
/** @type {HTMLDivElement} */
let naturalizeOutputWrap;
/** @type {HTMLDivElement} */
let naturalizeOutput;
/** @type {HTMLButtonElement} */
let naturalizeCopyBtn;
/** @type {HTMLTextAreaElement} */
let replyContext;
/** @type {HTMLTextAreaElement} */
let replyIntent;
/** @type {HTMLButtonElement} */
let replyBtn;
/** @type {HTMLDivElement} */
let replyOutputWrap;
/** @type {HTMLDivElement} */
let replyOutput;
/** @type {HTMLButtonElement} */
let replyCopyBtn;

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
  statusBtn = document.getElementById('statusBtn');
  statusDot = document.getElementById('statusDot');
  statusText = document.getElementById('statusText');
  modeTabs = document.querySelectorAll('.mode-tab');
  translatePanel = document.getElementById('translatePanel');
  naturalizePanel = document.getElementById('naturalizePanel');
  replyPanel = document.getElementById('replyPanel');
  naturalizeInput = document.getElementById('naturalizeInput');
  naturalizeBtn = document.getElementById('naturalizeBtn');
  naturalizeOutputWrap = document.getElementById('naturalizeOutputWrap');
  naturalizeOutput = document.getElementById('naturalizeOutput');
  naturalizeCopyBtn = document.getElementById('naturalizeCopyBtn');
  replyContext = document.getElementById('replyContext');
  replyIntent = document.getElementById('replyIntent');
  replyBtn = document.getElementById('replyBtn');
  replyOutputWrap = document.getElementById('replyOutputWrap');
  replyOutput = document.getElementById('replyOutput');
  replyCopyBtn = document.getElementById('replyCopyBtn');
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

/** Status button click handler */
export async function handleStatusClick() {
  statusText.textContent = 'Checking…';
  statusDot.className = 'status-dot checking';

  try {
    const result = await checkHealth();
    if (result.ok) {
      statusText.textContent = `Online · ${result.latencyMs}ms`;
      statusDot.className = 'status-dot online';
    } else {
      statusText.textContent = 'Offline';
      statusDot.className = 'status-dot offline';
      statusBtn.title = result.error || '';
    }
  } catch {
    statusText.textContent = 'Offline';
    statusDot.className = 'status-dot offline';
  }
}

/** Mode tab switcher */
export function initModeTabs() {
  modeTabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const mode = tab.dataset.mode;
      modeTabs.forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      translatePanel.style.display = mode === 'translate' ? 'block' : 'none';
      naturalizePanel.style.display = mode === 'naturalize' ? 'block' : 'none';
      replyPanel.style.display = mode === 'reply' ? 'block' : 'none';
    });
  });
}

/** Naturalize button click handler */
export async function handleNaturalizeClick() {
  const text = naturalizeInput.value.trim();
  if (!text) return;
  if (state.isTranslating) return; // guard against double-click

  state.isTranslating = true;
  naturalizeOutputWrap.style.display = 'none';
  const originalText = naturalizeBtn.textContent;
  naturalizeBtn.disabled = true;
  naturalizeBtn.textContent = 'Naturalizing…';

  let elapsed = 0;
  const interval = setInterval(() => {
    elapsed++;
    naturalizeBtn.textContent = `Naturalizing… ${elapsed}s`;
  }, 1000);

  try {
    const { result } = await naturalize(text);
    naturalizeOutput.textContent = result;
    naturalizeOutputWrap.style.display = 'block';
  } catch (err) {
    naturalizeOutput.textContent = 'Naturalization failed: ' + (err.message || 'Unknown error');
    naturalizeOutputWrap.style.display = 'block';
  } finally {
    clearInterval(interval);
    state.isTranslating = false;
    naturalizeBtn.disabled = false;
    naturalizeBtn.textContent = originalText;
  }
}

/** Reply compose button click handler */
export async function handleReplyClick() {
  const context = replyContext.value.trim();
  const intent = replyIntent.value.trim();
  if (!context || !intent) return;
  if (state.isTranslating) return; // guard against double-click

  state.isTranslating = true;
  replyOutputWrap.style.display = 'none';
  const originalText = replyBtn.textContent;
  replyBtn.disabled = true;
  replyBtn.textContent = 'Composing…';

  let elapsed = 0;
  const interval = setInterval(() => {
    elapsed++;
    replyBtn.textContent = `Composing… ${elapsed}s`;
  }, 1000);

  try {
    const { result } = await composeReply(context, intent);
    replyOutput.textContent = result;
    replyOutputWrap.style.display = 'block';
  } catch (err) {
    replyOutput.textContent = 'Failed to compose reply: ' + (err.message || 'Unknown error');
    replyOutputWrap.style.display = 'block';
  } finally {
    clearInterval(interval);
    state.isTranslating = false;
    replyBtn.disabled = false;
    replyBtn.textContent = originalText;
  }
}

/** Copy handler for naturalize output */
export function handleNaturalizeCopyClick() {
  const text = naturalizeOutput.textContent;
  if (!text) {
    return;
  }
  copyToClipboard(
    text,
    () => {
      naturalizeCopyBtn.textContent = 'Copied!';
      naturalizeCopyBtn.classList.add('copied');
      setTimeout(() => {
        naturalizeCopyBtn.textContent = 'Copy';
        naturalizeCopyBtn.classList.remove('copied');
      }, 1500);
    },
    () => {},
  );
}

/** Copy handler for reply output */
export function handleReplyCopyClick() {
  const text = replyOutput.textContent;
  if (!text) {
    return;
  }
  copyToClipboard(
    text,
    () => {
      replyCopyBtn.textContent = 'Copied!';
      replyCopyBtn.classList.add('copied');
      setTimeout(() => {
        replyCopyBtn.textContent = 'Copy';
        replyCopyBtn.classList.remove('copied');
      }, 1500);
    },
    () => {},
  );
}

/** Initialize status button */
function initStatusButton() {
  statusBtn.addEventListener('click', handleStatusClick);
  // Initial health check on load
  handleStatusClick();
}

/** Wire all event listeners */
function wireEvents() {
  translateBtn.addEventListener('click', handleTranslateClick);
  pinyinToggle.addEventListener('click', handlePinyinToggle);
  copyBtn.addEventListener('click', handleCopyClick);
  naturalizeBtn.addEventListener('click', handleNaturalizeClick);
  naturalizeCopyBtn.addEventListener('click', handleNaturalizeCopyClick);
  replyBtn.addEventListener('click', handleReplyClick);
  replyCopyBtn.addEventListener('click', handleReplyCopyClick);
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
  initModeTabs();
  wireEvents();
  initStatusButton();
  registerServiceWorker();
}

/**
 * Boot — invoke init() in browser context only.
 *
 * Module scripts (`<script type="module">`) are deferred, so the DOM is
 * fully parsed by the time this runs in a real browser. We guard by
 * checking for an expected element so the auto-init does NOT fire when
 * this module is imported by vitest tests (which set up their own DOM
 * in beforeEach, AFTER the import has already executed).
 */
if (typeof document !== 'undefined' && document.getElementById('translateBtn')) {
  init();
}
