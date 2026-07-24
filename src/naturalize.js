/**
 * Naturalize API call.
 * Rewrites Chinese text to be more natural and idiomatic.
 */
import { apiKey, baseUrl } from '../config.js';

/**
 * @param {string} text
 * @returns {Promise<{ result: string }>}
 */
export async function naturalize(text) {
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
          content:
            'You are a Chinese editing API. Rewrite the text to be more natural and conversational, preserving the original meaning. Reply with ONLY the rewritten Chinese.',
        },
        { role: 'user', content: text },
      ],
    }),
  });

  if (!res.ok) throw new Error('Naturalize failed');

  const data = await res.json();
  let result =
    data.choices?.[0]?.message?.content?.trim() ||
    data.choices?.[0]?.message?.reasoning_content?.trim() ||
    '';
  result = result.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  return { result };
}