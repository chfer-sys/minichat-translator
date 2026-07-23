/**
 * Unit tests for health.js — tests checkHealth() behavior with mocked fetch.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock config.js before importing health.js
vi.mock('../config.js', () => ({
  apiKey: 'test-key',
  baseUrl: 'https://test.opencode.ai/zen/go/v1',
}));

describe('checkHealth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns ok:true with latencyMs on HTTP 200 and valid JSON', async () => {
    const { checkHealth } = await import('../src/health.js');

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ choices: [{ message: { content: 'ok' } }] }),
    });

    const result = await checkHealth();

    expect(result.ok).toBe(true);
    expect(typeof result.latencyMs).toBe('number');
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('returns ok:false with error string on network error', async () => {
    const { checkHealth } = await import('../src/health.js');

    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network failure'));

    const result = await checkHealth();

    expect(result.ok).toBe(false);
    expect(result.error).toBe('Network failure');
  });

  it('returns ok:false with error string on HTTP 500', async () => {
    const { checkHealth } = await import('../src/health.js');

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    });

    const result = await checkHealth();

    expect(result.ok).toBe(false);
    expect(result.error).toBe('HTTP 500');
  });
});
