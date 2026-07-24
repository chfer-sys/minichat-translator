/**
 * Tests for naturalize.js
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { naturalize } from '../src/naturalize.js';

describe('naturalize', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('sends correct system prompt and user text to the API', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [{ message: { content: '自然表达' } }],
        }),
    });
    globalThis.fetch = mockFetch;

    await naturalize('你好呀');

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain('/chat/completions');
    expect(opts.method).toBe('POST');
    const messages = JSON.parse(opts.body).messages;
    expect(messages[0].role).toBe('system');
    expect(messages[0].content).toContain('Chinese editing API');
    expect(messages[0].content).toContain('natural');
    expect(messages[1].content).toBe('你好呀');
  });

  it('returns result from content field', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [{ message: { content: '自然表达' } }],
        }),
    });

    const { result } = await naturalize('你好');
    expect(result).toBe('自然表达');
  });

  it('strips<think> tags from response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [
            { message: { content: '<think>思考过程</think>自然表达' } },
          ],
        }),
    });

    const { result } = await naturalize('你好');
    expect(result).toBe('自然表达');
  });

  it('throws Error("Naturalize failed") on non-OK response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    });

    await expect(naturalize('你好')).rejects.toThrow('Naturalize failed');
  });
});
