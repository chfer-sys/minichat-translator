import { describe, it, expect } from 'vitest';
import { escapeHtml } from '../src/escape.js';

describe('escapeHtml', () => {
  it('escapes < and >', () => {
    expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
  });

  it('escapes &', () => {
    expect(escapeHtml('a & b')).toBe('a &amp; b');
  });

  it('escapes double quotes', () => {
    expect(escapeHtml('"hello"')).toBe('&quot;hello&quot;');
  });

  it('escapes single quotes', () => {
    expect(escapeHtml("'a'")).toBe('&#39;a&#39;');
  });

  it('leaves plain text unchanged', () => {
    expect(escapeHtml('hello world')).toBe('hello world');
  });

  it('escapes mixed content', () => {
    expect(escapeHtml('<div class="test">Hello & Goodbye</div>')).toBe(
      '&lt;div class=&quot;test&quot;&gt;Hello &amp; Goodbye&lt;/div&gt;',
    );
  });
});
