import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { formatRelativeTime } from '../src/time.js';

describe('formatRelativeTime', () => {
  // vitest fake timers for deterministic time-based tests
  let now;

  beforeEach(() => {
    now = new Date('2026-07-18T12:00:00Z');
    vi.useFakeTimers();
    vi.setSystemTime(now);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns "just now" for timestamps less than 1 minute ago', () => {
    const past = new Date(now.getTime() - 30 * 1000).toISOString();
    expect(formatRelativeTime(past)).toBe('just now');
  });

  it('returns "Xm ago" for timestamps less than 60 minutes ago', () => {
    const past = new Date(now.getTime() - 5 * 60 * 1000).toISOString();
    expect(formatRelativeTime(past)).toBe('5m ago');
    const past59 = new Date(now.getTime() - 59 * 60 * 1000).toISOString();
    expect(formatRelativeTime(past59)).toBe('59m ago');
  });

  it('returns "Xh ago" for timestamps less than 24 hours ago', () => {
    const past = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
    expect(formatRelativeTime(past)).toBe('2h ago');
    const past23 = new Date(now.getTime() - 23 * 60 * 60 * 1000).toISOString();
    expect(formatRelativeTime(past23)).toBe('23h ago');
  });

  it('returns "Xd ago" for timestamps less than 7 days ago', () => {
    const past = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000).toISOString();
    expect(formatRelativeTime(past)).toBe('1d ago');
    const past6 = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000).toISOString();
    expect(formatRelativeTime(past6)).toBe('6d ago');
  });

  it('returns a date string for timestamps 7+ days ago', () => {
    const past = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString();
    const result = formatRelativeTime(past);
    // Should be a locale date string, not a relative one
    expect(result).not.toMatch(/ago$/);
    expect(result).not.toMatch(/just now/);
  });
});
