/**
 * Tests for reply.js
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { composeReply } from '../src/reply.js';

describe('composeReply', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('sends context and intent in user message', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [{ message: { content: '好的！' } }],
        }),
    });
    globalThis.fetch = mockFetch;

    await composeReply('你好', '想打招呼');

    expect(mockFetch).toHaveBeenCalledOnce();
    const [, opts] = mockFetch.mock.calls[0];
    const messages = JSON.parse(opts.body).messages;
    expect(messages[1].content).toContain('Context: 你好');
    expect(messages[1].content).toContain('Intent: 想打招呼');
  });

  it('returns result from content field', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [{ message: { content: '好的！' } }],
        }),
    });

    const { result } = await composeReply('Hello', 'Say hi');
    expect(result).toBe('好的！');
  });

  it('strips<think> tags from response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [
            { message: { content: '<think>思考过程</think>好的！' } },
          ],
        }),
    });

    const { result } = await composeReply('Hello', 'Say hi');
    expect(result).toBe('好的！');
  });

  it('throws Error("Compose reply failed") on non-OK response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    });

    await expect(composeReply('Hello', 'hi')).rejects.toThrow(
      'Compose reply failed',
    );
  });
});
