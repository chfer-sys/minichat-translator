import { describe, expect, it } from 'vitest';
import { buildContext, contextFingerprint } from '../src/persona-context.js';

const profile = {
  name: 'Aiko',
  relationship: 'Met at a design conference',
  notes: 'Loves ceramics',
  nativeLanguage: 'Japanese',
  targetLanguage: 'Japanese',
  tone: 'Warm',
  messages: [{ role: 'user', text: 'How was your weekend?' }, { role: 'assistant', reply: '週末はどうだった？', text: 'A friendly question.' }],
};

describe('PERSONA deterministic context', () => {
  it('builds stable, ordered layers from the same inputs', () => {
    const first = buildContext(profile);
    const second = buildContext(profile);
    expect(first).toEqual(second);
    expect(first.map((layer) => layer.key)).toEqual(['profile', 'history', 'preferences']);
    expect(first[1].text).toContain('Aiko: 週末はどうだった？ (A friendly question.)');
  });

  it('marks disabled layers as excluded without removing them from inspection', () => {
    const layers = buildContext(profile, { responseLanguage: 'Target language', layers: { profile: true, history: false, preferences: true } });
    expect(layers).toHaveLength(3);
    expect(layers[1].included).toBe(false);
    expect(layers[2].text).toContain('Reply language: Japanese');
  });

  it('fingerprints identical serialized context consistently', () => {
    const context = buildContext(profile).map((layer) => layer.text).join('\n');
    expect(contextFingerprint(context)).toBe(contextFingerprint(context));
    expect(contextFingerprint(context)).toMatch(/^[0-9a-f]{8}$/);
    expect(contextFingerprint(context)).not.toBe(contextFingerprint(`${context} `));
  });

  it('excludes error messages from the conversation layer', () => {
    const withErrors = {
      ...profile,
      messages: [
        ...profile.messages,
        { role: 'assistant', text: "I couldn't reach the AI service. Try again later.", error: true, retry: true },
        { role: 'user', text: 'Still there?' },
      ],
    };
    const layers = buildContext(withErrors);
    expect(layers[1].text).not.toContain("couldn't reach the AI service");
    expect(layers[1].text).toContain('Me: Still there?');
    expect(layers[1].text).toContain('Aiko: 週末はどうだった？');
  });

  it('still respects the message window after filtering errors', () => {
    const noisy = {
      ...profile,
      messages: [
        { role: 'user', text: 'kept-early' },
        ...Array.from({ length: 20 }, (_, index) => ({ role: 'assistant', text: `error-${index}`, error: true })),
        { role: 'user', text: 'kept-late' },
      ],
    };
    const layers = buildContext(noisy);
    expect(layers[1].text).toContain('kept-late');
    expect(layers[1].text).not.toContain('error-');
    // window of 12 non-error messages: kept-early, kept-late both survive here
    expect(layers[1].text).toContain('kept-early');
  });
});
