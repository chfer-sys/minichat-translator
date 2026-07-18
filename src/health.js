/**
 * Health check for the translation API.
 * Sends a minimal request to verify API connectivity and measure latency.
 */
/* global performance, AbortController */
import { apiKey, baseUrl } from '../config.js';

/**
 * Check API health by sending a minimal chat completion request.
 * @returns {Promise<{ ok: boolean, latencyMs?: number, error?: string }>}
 */
export async function checkHealth() {
  const start = performance.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch(baseUrl + '/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + apiKey,
      },
      body: JSON.stringify({
        model: 'MiniMax-M2.1',
        max_tokens: 10,
        messages: [
          { role: 'system', content: 'Respond with: ok' },
          { role: 'user', content: 'ping' },
        ],
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}` };
    }

    // Verify we got valid JSON
    const data = await res.json();
    if (!data || typeof data !== 'object') {
      return { ok: false, error: 'Invalid JSON response' };
    }

    const latencyMs = Math.round(performance.now() - start);
    return { ok: true, latencyMs };
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') {
      return { ok: false, error: 'Request timeout' };
    }
    return { ok: false, error: err.message || 'Network error' };
  }
}
