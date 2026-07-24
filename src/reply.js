/**
 * Reply composer API call.
 * Composes a natural reply based on context and user intent.
 */
import { apiKey, baseUrl } from '../config.js';

/**
 * @param {string} context  The message being replied to
 * @param {string} intent  What the user wants to express
 * @returns {Promise<{ result: string }>}
 */
export async function composeReply(context, intent) {
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
            'You are a reply API. Using the context and intent, write a short natural reply in the SAME language as the context. Reply with ONLY the reply.',
        },
        { role: 'user', content: `Context: ${context}\n\nIntent: ${intent}` },
      ],
    }),
  });

  if (!res.ok) throw new Error('Compose reply failed');

  const data = await res.json();
  let result =
    data.choices?.[0]?.message?.content?.trim() ||
    data.choices?.[0]?.message?.reasoning_content?.trim() ||
    '';
  result = result.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  return { result };
}