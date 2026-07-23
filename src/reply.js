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
      model: 'opencode-go/deepseek-v4-flash',
      max_tokens: 2000,
      reasoning: { enable: false },
      messages: [
        {
          role: 'system',
          content:
            'You are helping the user reply to a message. The user provides the message they received (context) and what they want to say (intent). Write a natural, casual reply in the same language as the context that conveys the intent. Only output the reply, no explanation. If the context is in Chinese, reply in Chinese. If the context is in English, reply in English.',
        },
        { role: 'user', content: `Context: ${context}\n\nIntent: ${intent}` },
      ],
    }),
  });

  if (!res.ok) throw new Error('Compose reply failed');

  const data = await res.json();
  let result =
    data.choices?.[0]?.message?.reasoning_content?.trim() ||
    data.choices?.[0]?.message?.content?.trim() ||
    '';
  result = result.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  return { result };
}