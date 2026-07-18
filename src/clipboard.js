/**
 * Copy text to clipboard — modern Clipboard API with execCommand fallback.
 * Phase 2: extracted from index.html inline script.
 */

/**
 * @param {string} text
 * @param {() => void} onSuccess  called on successful copy (UI feedback)
 * @param {() => void} [_onError]   called on failure (silent fallback)
 */
export async function copyToClipboard(text, onSuccess, _onError) {
  // Modern path
  if (navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      onSuccess();
      return;
    } catch {
      // fall through to fallback
    }
  }
  // Legacy fallback
  fallbackCopy(text);
  onSuccess();
}

function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  try {
    document.execCommand('copy');
  } catch {
    // ignore
  }
  document.body.removeChild(ta);
}
