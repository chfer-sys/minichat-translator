/**
 * Translation API call with elapsed timer.
 * Phase 2: extracted from index.html inline script.
 */
import { apiKey, baseUrl } from '../config.js';
import { state } from './state.js';

/**
 * @param {string} text
 * @param {string} direction  'en-zh' | 'zh-en'
 * @returns {Promise<{ translation: string, reasoning?: string }>}
 */
export async function translate(text, direction) {
  const sourceLang = direction === 'en-zh' ? 'English' : 'Chinese';
  const targetLang = direction === 'en-zh' ? 'Chinese' : 'English';
  // NOTE: this gateway ignores reasoning-control params (reasoning_effort /
  // reasoning.enable), so latency is controlled via a terse prompt instead.
  const res = await fetch(baseUrl + '/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + apiKey,
    },
    body: JSON.stringify({
      model: 'deepseek-v4-flash',
      max_tokens: 2000,
      messages: [
        {
          role: 'system',
          content: `You are a translation API. Translate ${sourceLang} to ${targetLang}. Reply with ONLY the translation — no notes, no pinyin, no explanation.`,
        },
        { role: 'user', content: text },
      ],
    }),
  });

  if (!res.ok) throw new Error('Translation failed');

  const data = await res.json();
  let translation =
    data.choices?.[0]?.message?.content?.trim() ||
    data.choices?.[0]?.message?.reasoning_content?.trim() ||
    '';
  translation = translation.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  return { translation };
}

/**
 * Start the elapsed-seconds timer on the translate button.
 * @param {HTMLButtonElement} btn
 */
export function startTimer(btn) {
  state.elapsedSeconds = 0;
  btn.textContent = 'Translating... 0s';
  state.timerInterval = setInterval(() => {
    state.elapsedSeconds++;
    btn.textContent = `Translating... ${state.elapsedSeconds}s`;
  }, 1000);
}

/**
 * Stop the timer and restore button label.
 * @param {HTMLButtonElement} btn
 */
export function stopTimer(btn) {
  if (state.timerInterval) {
    clearInterval(state.timerInterval);
    state.timerInterval = null;
  }
  btn.textContent = 'Translate';
}
