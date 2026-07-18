/**
 * Service worker registration.
 * Phase 2: extracted from index.html inline script.
 */
export function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
}
