const defaultSettings = { responseLanguage: 'English', tone: 'Friendly', layers: { profile: true, history: true, preferences: true } };

/** Stable, ordered context builder: same profile and settings always yield identical layers. */
export function buildContext(profile, prefs = defaultSettings, messageWindow = 12) {
  if (!profile) return [];
  const layers = prefs.layers || defaultSettings.layers;
  const messages = (profile.messages || []).filter((message) => !message.error).slice(-messageWindow);
  return [
    {
      key: 'profile',
      title: 'Profile details',
      included: layers.profile !== false,
      text: [profile.relationship && `Relationship: ${profile.relationship}`, profile.notes && `Notes: ${profile.notes}`].filter(Boolean).join('\n') || 'No additional profile details.',
    },
    {
      key: 'history',
      title: 'Recent conversation',
      included: layers.history !== false,
      text: messages.length ? messages.map((message) => `${message.role === 'assistant' ? profile.name : 'Me'}: ${message.reply ? `${message.reply}${message.text ? ` (${message.text})` : ''}` : message.text || '[image attachment]'}`).join('\n') : 'No earlier messages.',
    },
    {
      key: 'preferences',
      title: 'Response preferences',
      included: layers.preferences !== false,
      text: `Tone: ${profile.tone || prefs.tone || 'Friendly'}\nReply language: ${prefs.responseLanguage === 'Target language' ? (profile.targetLanguage || 'Chinese') : (prefs.responseLanguage || 'English')}\nTarget language: ${profile.targetLanguage || 'Chinese'}`,
    },
  ];
}

/** Compact deterministic fingerprint; stable across reloads and platforms. */
export function contextFingerprint(text) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
