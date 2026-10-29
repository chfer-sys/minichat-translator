/**
 * Lazy pinyin toggle — fetches pinyin from the translation API on first activation.
 * Phase 2: extracted from index.html inline script.
 */
import { apiKey, baseUrl } from '../config.js';

/**
 * @param {string} text
 * @param {string} language
 * @returns {Promise<string>} pinyin or romaji romanization
 */
export async function loadPinyin(text, language = 'Chinese') {
  const res = await fetch(baseUrl + '/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + apiKey,
    },
    body: JSON.stringify({
      model: 'deepseek-v4-flash',
      messages: [
        {
          role: 'system',
          content:
            language === 'Japanese'
              ? 'Convert the Japanese text to standard romaji. Reply with ONLY the romaji.'
              : 'Convert the Chinese text to spaced pinyin. Reply with ONLY the pinyin.',
        },
        { role: 'user', content: text },
      ],
    }),
  });
  const data = await res.json();
  return (
    data.choices?.[0]?.message?.content?.trim() ||
    data.choices?.[0]?.message?.reasoning_content?.trim() ||
    ''
  );
}
