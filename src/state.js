/**
 * Centralized mutable app state.
 * Modules import this object and read/mutate its fields directly.
 * Phase 1: created but not yet wired into index.html — that's Phase 2.
 */
export const state = {
  currentDir: 'en-zh',
  isTranslating: false,
  lastTranslation: '',
  lastSourceText: '',
  // Timer state
  timerInterval: null,
  elapsedSeconds: 0,
  // Pinyin state
  pinyinLoaded: false,
  // Max history entries (FIFO)
  MAX_HISTORY: 50,
};
