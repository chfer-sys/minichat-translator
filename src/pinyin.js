/**
 * Lazy pinyin toggle — fetches pinyin from the translation API on first activation.
 * Phase 2: extracted from index.html inline script.
 */
import { apiKey, baseUrl } from '../config.js';

/**
 * @param {string} chineseText
 * @returns {Promise<string>} pinyin romanization
 */
export async function loadPinyin(chineseText) {
  const res = await fetch(baseUrl + '/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + apiKey,
    },
    body: JSON.stringify({
      model: 'opencode-go/deepseek-v4-flash',
      reasoning: { enable: false },
      messages: [
        {
          role: 'system',
          content:
            'Convert the Chinese text to casual pinyin (romanized Chinese) like texting. Use spaces. Only output the pinyin.',
        },
        { role: 'user', content: chineseText },
      ],
    }),
  });
  const data = await res.json();
  return (
    data.choices?.[0]?.message?.reasoning_content?.trim() ||
    data.choices?.[0]?.message?.content?.trim() ||
    ''
  );
}
