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
      model: 'opencode-go/deepseek-v4-flash',
      max_tokens: 2000,
      reasoning: { enable: false },
      messages: [
        {
          role: 'system',
          content:
            'You are an expert Chinese editor. Rewrite the user\'s Chinese text to be more natural, idiomatic, and conversational — like a native speaker texting a friend. Preserve the original meaning. Only output the rewritten Chinese, no explanation.',
        },
        { role: 'user', content: text },
      ],
    }),
  });

  if (!res.ok) throw new Error('Naturalize failed');

  const data = await res.json();
  let result =
    data.choices?.[0]?.message?.reasoning_content?.trim() ||
    data.choices?.[0]?.message?.content?.trim() ||
    '';
  result = result.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  return { result };
}