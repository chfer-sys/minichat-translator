import { apiKey, baseUrl } from '../config.js';
import { getHistory, saveHistory, normalizeTargetLanguage } from './history.js';
import { buildContext, contextFingerprint } from './persona-context.js';
import { copyToClipboard } from './clipboard.js';
import { state } from './state.js';

const KEYS = { profiles: 'persona.profiles.v1', settings: 'persona.settings.v1', active: 'persona.active.v1' };
// Translation-history key owned by history.js (not exported there) — cleared too,
// since "Clear local data" promises to remove all data stored on this device.
const HISTORY_KEY = 'minichat_history';
const VIEWS = ['chat', 'translate', 'profiles', 'settings'];
const CHAT_TIMEOUT_MS = 45000;
const MAX_NOTE_LINES = 40;
const MAX_NOTE_CHARS = 2000;
const COLORS = ['#f5d7c9', '#e8edcf', '#e6e8f6', '#f5e7bd', '#dcece8'];
const defaultSettings = { responseLanguage: 'English', tone: 'Friendly', layers: { profile: true, history: true, preferences: true } };
let profiles = [];
let settings = { ...defaultSettings, layers: { ...defaultSettings.layers } };
let activeId = '';
let pendingImage = null;
let requestPending = false;

const byId = (id) => document.getElementById(id);
const safeParse = (value, fallback) => { try { return JSON.parse(value) ?? fallback; } catch { return fallback; } };
const escapeHTML = (value = '') => String(value).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
const activeProfile = () => profiles.find((profile) => profile.id === activeId) || null;

/**
 * Point the target-language selector and every label derived from it at one language.
 * Shared by the selector's change handler and by history restore, so a Japanese
 * record never comes back looking like a Chinese one.
 * @param {string} language e.g. 'Chinese' | 'Japanese'
 */
export function applyTargetLanguage(language) {
  const target = normalizeTargetLanguage(language);
  const select = byId('targetLanguage');
  if (select && select.value !== target) select.value = target;
  document.querySelectorAll('.lang-btn').forEach((button) => {
    const dir = button.dataset.dir;
    if (dir !== 'en-zh' && dir !== 'zh-en') return;
    const label = button.querySelector('.target-label');
    if (label) label.textContent = target;
    else button.innerHTML = dir === 'en-zh'
      ? `English → <span class="target-label">${escapeHTML(target)}</span>`
      : `<span class="target-label">${escapeHTML(target)}</span> → English`;
  });
  // Reset pronunciation UI (shared with ui.js) so stale pinyin/romaji is never shown.
  state.pinyinLoaded = false;
  const section = byId('pinyinSection');
  if (section) section.style.display = 'none';
  const pronunciation = byId('pinyinText');
  if (pronunciation) { pronunciation.textContent = ''; pronunciation.style.display = 'none'; }
  const toggle = byId('pinyinToggle');
  if (toggle) toggle.textContent = target === 'Japanese' ? 'Show romaji' : 'Show pinyin';
  const pronLabel = byId('pronunciationLabel');
  if (pronLabel) pronLabel.textContent = target === 'Japanese' ? 'ROMAJI' : 'PINYIN';
}

function persist() {
  try {
    localStorage.setItem(KEYS.profiles, JSON.stringify(profiles));
    localStorage.setItem(KEYS.settings, JSON.stringify(settings));
    localStorage.setItem(KEYS.active, activeId);
    return true;
  } catch {
    // Quota exceeded — retry once with image payloads stripped from the stored
    // copy only (in-memory messages keep their images for this session).
    const leanProfiles = profiles.map((profile) => ({ ...profile, messages: (profile.messages || []).map((message) => (message.image ? { ...message, image: '' } : message)) }));
    try {
      localStorage.setItem(KEYS.profiles, JSON.stringify(leanProfiles));
      localStorage.setItem(KEYS.settings, JSON.stringify(settings));
      localStorage.setItem(KEYS.active, activeId);
      const warning = byId('chatError');
      if (warning) warning.textContent = 'Storage is full — image attachments were not re-saved on this device. Export a backup to keep them.';
      return true;
    } catch {
      const error = byId('chatError');
      if (error) error.textContent = 'Could not save on this device. Export a backup or remove large image attachments.';
      return false;
    }
  }
}

function loadStore() {
  // Write back only when normalization actually changed something: rewriting on
  // every boot would clobber changes made by other open tabs of the app.
  let needsRewrite = false;
  const rawProfiles = localStorage.getItem(KEYS.profiles);
  const storedProfiles = safeParse(rawProfiles, null);
  if (!Array.isArray(storedProfiles)) {
    profiles = [];
    needsRewrite = rawProfiles !== null; // corrupt payload — normalize to an empty list
  } else {
    profiles = storedProfiles.filter((item) => item && item.id && item.name).map((item) => ({ ...item, messages: Array.isArray(item.messages) ? item.messages.slice(-500) : [] }));
    needsRewrite = profiles.length !== storedProfiles.length
      || storedProfiles.some((item, index) => profiles[index].messages.length !== (Array.isArray(item.messages) ? item.messages.length : 0));
  }
  const rawSettings = localStorage.getItem(KEYS.settings);
  const storedSettings = safeParse(rawSettings, null);
  if (!storedSettings || typeof storedSettings !== 'object' || Array.isArray(storedSettings)) {
    settings = { ...defaultSettings, layers: { ...defaultSettings.layers } };
    if (rawSettings !== null) needsRewrite = true;
  } else {
    settings = { ...defaultSettings, ...storedSettings, layers: { ...defaultSettings.layers, ...(storedSettings.layers || {}) } };
    needsRewrite = needsRewrite
      || !('responseLanguage' in storedSettings)
      || !('tone' in storedSettings)
      || !storedSettings.layers
      || !['profile', 'history', 'preferences'].every((key) => key in storedSettings.layers);
  }
  const storedActive = localStorage.getItem(KEYS.active) || '';
  activeId = storedActive || profiles[0]?.id || '';
  if (!profiles.some((profile) => profile.id === activeId)) activeId = profiles[0]?.id || '';
  if (activeId !== storedActive) needsRewrite = true;
  if (needsRewrite) persist();
}

function contextData(profile = activeProfile()) {
  const layers = buildContext(profile, settings);
  const normalized = layers.filter((layer) => layer.included).map((layer) => `${layer.key.toUpperCase()}\n${layer.text}`).join('\n\n');
  return { layers, normalized, hash: contextFingerprint(normalized) };
}

function renderContext() {
  const profile = activeProfile();
  const { layers, normalized, hash } = contextData(profile);
  byId('contextLayers').innerHTML = profile ? layers.map((layer) => `<div class="context-layer ${layer.included ? '' : 'excluded'}"><div class="context-layer-head"><strong>${escapeHTML(layer.title)}</strong><span>${layer.included ? `${layer.text.length} chars · included` : 'excluded'}</span></div><p>${escapeHTML(layer.text)}</p></div>`).join('') : '<p class="sheet-intro">Create a profile to inspect its context.</p>';
  byId('contextHash').textContent = profile ? hash : 'Waiting for a profile';
  byId('contextSummary').textContent = profile ? `${layers.filter((item) => item.included).length} layers · ${normalized.length} chars · ${hash}` : 'Create a profile to begin';
}

function renderTabs() {
  const holder = byId('chatProfileTabs');
  holder.innerHTML = profiles.map((profile) => `<button class="profile-tab ${profile.id === activeId ? 'active' : ''}" data-profile="${escapeHTML(profile.id)}">${escapeHTML(profile.name)}</button>`).join('') + '<button class="profile-tab add" id="tabAddProfile">＋ Add profile</button>';
  holder.querySelectorAll('[data-profile]').forEach((button) => button.addEventListener('click', () => { activeId = button.dataset.profile; persist(); renderAll(); }));
  byId('tabAddProfile').addEventListener('click', () => openProfileForm());
}

function renderMessages() {
  const profile = activeProfile();
  const holder = byId('messages');
  if (!profile || !profile.messages.length) {
    holder.innerHTML = `<div class="empty-chat"><div class="empty-art">✳</div><strong>${profile ? `Say hello to ${escapeHTML(profile.name)}.` : 'Your conversations, with context.'}</strong><span>${profile ? 'Start with a message. Your profile context stays on this device.' : 'Choose a profile and start a thoughtful chat.'}</span></div>`;
    return;
  }
  holder.innerHTML = profile.messages.map((message, index) => {
    const image = message.image ? `<img src="${escapeHTML(message.image)}" alt="Attached image">` : '';
    const suggestion = message.role === 'assistant' && message.reply ? `<div class="ai-reply-box"><div class="ai-reply-label">SUGGESTED ${escapeHTML(profile.targetLanguage || 'TARGET LANGUAGE')} REPLY</div><div class="ai-reply-text">${escapeHTML(message.reply)}</div>${message.pronunciation ? `<div class="ai-pronunciation">${escapeHTML(message.pronunciation)}</div>` : ''}<div class="bubble-actions"><button data-copy="${index}">Copy reply</button><button data-speak="${index}">Listen</button></div></div>` : '';
    // Retry is only offered on the current last failed request: an older
    // failure that a later message followed must not stay clickable, or it
    // would re-send the newest unrelated user message.
    const retryButton = message.retry && index === profile.messages.length - 1 ? '<div class="bubble-actions"><button data-retry="true">Retry AI response</button></div>' : '';
    return `<article class="message ${message.role === 'user' ? 'user' : ''}"><div class="bubble">${image}${escapeHTML(message.text || '')}</div>${suggestion}${retryButton}<div class="message-meta">${message.role === 'assistant' ? `${escapeHTML(profile.name)} · PERSONA` : 'You'}${message.pending ? ' · thinking…' : ''}</div></article>`;
  }).join('');
  holder.querySelectorAll('[data-copy]').forEach((button) => button.addEventListener('click', () => {
    const message = profile.messages[Number(button.dataset.copy)];
    if (!message?.reply) return;
    copyToClipboard(message.reply, () => {
      button.textContent = 'Copied';
      setTimeout(() => { button.textContent = 'Copy reply'; }, 1500);
    });
  }));
  holder.querySelectorAll('[data-speak]').forEach((button) => button.addEventListener('click', () => {
    const message = profile.messages[Number(button.dataset.speak)];
    speak(message?.reply || '', profile.targetLanguage);
  }));
  holder.querySelectorAll('[data-retry]').forEach((button) => button.addEventListener('click', () => sendMessage(true)));
  holder.scrollTop = holder.scrollHeight;
}

function renderProfiles() {
  const holder = byId('profileList');
  if (!profiles.length) {
    holder.innerHTML = '<div class="no-profiles"><strong>Your people, thoughtfully remembered.</strong>Create a profile for someone you are getting to know.<br><br><button class="primary-small" id="emptyAddProfile">＋ Create your first profile</button></div>';
    byId('emptyAddProfile').addEventListener('click', () => openProfileForm());
    return;
  }
  holder.innerHTML = profiles.map((profile, index) => `<article class="profile-card"><div class="profile-avatar" style="background:${COLORS[index % COLORS.length]}">${escapeHTML(profile.name.trim().charAt(0).toUpperCase())}</div><div class="profile-card-body"><h3>${escapeHTML(profile.name)}</h3><p>${escapeHTML(profile.relationship || `${profile.nativeLanguage} · ${profile.targetLanguage}`)}</p><p class="profile-note">${escapeHTML(profile.notes || 'No notes added yet.')}</p><div class="profile-actions"><button class="chat-now" data-chat="${escapeHTML(profile.id)}">Open chat</button><button data-edit="${escapeHTML(profile.id)}">Edit</button><button data-delete="${escapeHTML(profile.id)}">Delete</button></div></div></article>`).join('');
  holder.querySelectorAll('[data-chat]').forEach((button) => button.addEventListener('click', () => { activeId = button.dataset.chat; persist(); navigate('chat'); renderAll(); }));
  holder.querySelectorAll('[data-edit]').forEach((button) => button.addEventListener('click', () => openProfileForm(profiles.find((item) => item.id === button.dataset.edit))));
  holder.querySelectorAll('[data-delete]').forEach((button) => button.addEventListener('click', () => {
    const profile = profiles.find((item) => item.id === button.dataset.delete);
  if (!profile || !window.confirm(`Delete ${profile.name} and this conversation? This cannot be undone.`)) return;
    profiles = profiles.filter((item) => item.id !== profile.id);
    if (activeId === profile.id) activeId = profiles[0]?.id || '';
    persist(); renderAll();
  }));
}

function renderAll() {
  const profile = activeProfile();
  byId('chatProfileName').textContent = profile?.name || 'No profile selected';
  byId('chatProfileMeta').textContent = profile ? `${profile.nativeLanguage} · ${profile.targetLanguage}${profile.relationship ? ` · ${profile.relationship}` : ''}` : 'Create a profile to begin';
  byId('chatAvatar').textContent = profile?.name?.trim().charAt(0).toUpperCase() || '✦';
  renderTabs(); renderMessages(); renderProfiles(); renderContext();
  byId('storageSummary').textContent = `${profiles.length} profile${profiles.length === 1 ? '' : 's'} · ${profiles.reduce((count, item) => count + item.messages.length, 0)} saved messages on this device.`;
}

function navigate(view) {
  document.querySelectorAll('.view').forEach((element) => element.classList.toggle('active', element.id === `${view}View`));
  document.querySelectorAll('.nav-item').forEach((button) => button.classList.toggle('active', button.dataset.view === view));
  window.history.replaceState(null, '', `#${view}`);
}

function setProfileFormOpen(open) {
  byId('profileFormCard').hidden = !open;
  byId('profileBackdrop')?.classList.toggle('open', open);
}

function openProfileForm(profile = null) {
  const form = byId('profileForm');
  form.reset();
  byId('profileId').value = profile?.id || '';
  byId('profileName').value = profile?.name || '';
  byId('profileNative').value = profile?.nativeLanguage || 'Japanese';
  byId('profileTarget').value = profile?.targetLanguage || 'Japanese';
  byId('profileRelationship').value = profile?.relationship || '';
  byId('profileNotes').value = profile?.notes || '';
  byId('profileTone').value = profile?.tone || settings.tone;
  byId('profileFormTitle').textContent = profile ? 'Edit profile' : 'New profile';
  setProfileFormOpen(true);
  byId('profileName').focus();
}

function saveProfile(event) {
  event.preventDefault();
  const id = byId('profileId').value || (globalThis.crypto?.randomUUID?.() || `p-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
  const previous = profiles.find((item) => item.id === id);
  const profile = { id, name: byId('profileName').value.trim(), nativeLanguage: byId('profileNative').value, targetLanguage: byId('profileTarget').value, relationship: byId('profileRelationship').value.trim(), notes: byId('profileNotes').value.trim(), tone: byId('profileTone').value, messages: previous?.messages || [] };
  if (!profile.name) return;
  if (previous) profiles = profiles.map((item) => item.id === id ? profile : item); else profiles.push(profile);
  activeId = id; byId('chatError').textContent = ''; setProfileFormOpen(false); persist(); renderAll();
}

function showContext(open = true) {
  byId('contextSheet').classList.toggle('open', open);
  byId('contextBackdrop').classList.toggle('open', open);
  byId('contextSheet').setAttribute('aria-hidden', String(!open));
  if (open) renderContext();
}

function appendConversationNote(profile, extracted) {
  const note = `Conversation note: ${String(extracted).trim()}`;
  const lines = String(profile.notes || '').split('\n').map((line) => line.trim()).filter(Boolean);
  if (lines.some((line) => line.toLowerCase() === note.toLowerCase())) return;
  let joined = [...lines, note].slice(-MAX_NOTE_LINES).join('\n');
  if (joined.length > MAX_NOTE_CHARS) joined = joined.slice(-MAX_NOTE_CHARS).replace(/^[^\n]*\n/, '');
  profile.notes = joined;
}

async function sendMessage(retry = false) {
  const input = byId('chatInput');
  let text = input.value.trim();
  let image = pendingImage;
  if ((!text && !image && !retry) || requestPending) return;
  const profile = activeProfile();
  if (!profile) {
    // The compose box lives in the Chat view; opening the (top-level overlay)
    // profile form keeps the draft visible instead of navigating away and
    // stranding the error in a hidden view.
    byId('chatError').textContent = 'Create or choose a profile before sending a message.';
    openProfileForm();
    return;
  }
  let priorMessages;
  if (retry) {
    // A retry button may only exist on the current last failed request
    // (renderMessages enforces this). If it is stale — e.g. a newer message
    // already followed the failure — do nothing rather than re-send the
    // latest unrelated user message.
    if (!profile.messages.at(-1)?.retry) return;
    profile.messages.pop();
    const lastUserIndex = profile.messages.map((item) => item.role).lastIndexOf('user');
    if (lastUserIndex < 0) return;
    const lastUser = profile.messages[lastUserIndex];
    text = lastUser.text;
    image = lastUser.image ? { data: lastUser.image } : null;
    priorMessages = profile.messages.slice(0, lastUserIndex);
  } else {
    priorMessages = profile.messages.slice();
    profile.messages.push({ role: 'user', text, image: image?.data || '', timestamp: new Date().toISOString() });
  }
  pendingImage = null; input.value = ''; input.style.height = '44px'; byId('attachmentPreview').innerHTML = ''; byId('chatError').textContent = '';
  const placeholder = { role: 'assistant', text: 'Putting the context together…', pending: true };
  profile.messages.push(placeholder); persist(); renderMessages(); renderContext();
  requestPending = true; byId('sendMessage').disabled = true;
  const { normalized } = contextData({ ...profile, messages: priorMessages });
  const messages = [{ role: 'system', content: `You are PERSONA, a helpful intercultural communication coach. Use the ordered, local profile context below exactly as background. Follow the profile tone. Keep coaching in the requested response language. Return ONLY valid JSON with keys: reply (a natural, sendable message in the target language), pronunciation (pinyin for Chinese or romaji for Japanese; otherwise empty), coaching (one short explanation in the response language), and extracted (a short new fact from this turn worth remembering, or empty). Do not invent profile facts.\n\n${normalized}` }];
  for (const item of priorMessages.filter((entry) => !entry.error).slice(-12)) {
    if (item.role === 'assistant') messages.push({ role: 'assistant', content: JSON.stringify({ reply: item.reply || item.text, pronunciation: item.pronunciation || '', coaching: item.coaching || '' }) });
    else messages.push({ role: 'user', content: item.image ? [{ type: 'text', text: item.text || 'Please look at this image.' }, { type: 'image_url', image_url: { url: item.image } }] : item.text });
  }
  messages.push({ role: 'user', content: image ? [{ type: 'text', text: text || 'Please look at this image and help me understand it.' }, { type: 'image_url', image_url: { url: image.data } }] : text });
  const controller = new window.AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CHAT_TIMEOUT_MS);
  try {
    const response = await fetch(`${baseUrl}/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` }, body: JSON.stringify({ model: 'deepseek-v4-flash', max_tokens: 1200, messages }), signal: controller.signal });
    if (!response.ok) throw new Error(`AI request failed (${response.status})`);
    const data = await response.json();
    let content = (data.choices?.[0]?.message?.content || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    let result;
    try { result = JSON.parse(content.replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch { result = { reply: content, pronunciation: '', coaching: '', extracted: '' }; }
    Object.assign(placeholder, { text: result.coaching || 'Here is a natural way to say it.', reply: result.reply || content, pronunciation: result.pronunciation || '', pending: false });
    if (result.extracted) appendConversationNote(profile, result.extracted);
  } catch (error) {
    profile.messages.pop();
    const reason = error?.name === 'AbortError' ? `timed out after ${Math.round(CHAT_TIMEOUT_MS / 1000)}s` : (error?.message || 'network error');
    profile.messages.push({ role: 'assistant', text: `I couldn't reach the AI service. Your message is saved — try again when the connection is available. (${reason})`, error: true, retry: true });
  } finally {
    clearTimeout(timeoutId);
    requestPending = false; byId('sendMessage').disabled = false; persist(); renderAll();
  }
}

function speak(text, language = 'Chinese') {
  if (!text || !('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new window.SpeechSynthesisUtterance(text);
  utterance.lang = language === 'Japanese' ? 'ja-JP' : language === 'Chinese' ? 'zh-CN' : 'en-US';
  window.speechSynthesis.speak(utterance);
}

function downscaleImage(dataUrl, maxSide = 1024, quality = 0.75) {
  return new Promise((resolve) => {
    const img = new window.Image();
    img.onload = () => {
      const longest = Math.max(img.width || 0, img.height || 0);
      if (!longest) { resolve(dataUrl); return; }
      const scale = Math.min(1, maxSide / longest);
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) { resolve(dataUrl); return; }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      try {
        const out = canvas.toDataURL('image/jpeg', quality);
        resolve(out && out.length < dataUrl.length ? out : dataUrl);
      } catch { resolve(dataUrl); }
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

function attachImage(file) {
  if (!file || !file.type.startsWith('image/')) return;
  const reader = new window.FileReader();
  reader.onload = () => {
    // Downscale/re-encode before storing so localStorage quota survives photos.
    downscaleImage(reader.result).then((data) => {
      pendingImage = { name: file.name, data };
      byId('attachmentPreview').innerHTML = `<span class="attachment-chip"><img class="attachment-thumb" src="${data}" alt="Image to send"><button id="removeImage" aria-label="Remove image">×</button></span>`;
      byId('removeImage').addEventListener('click', () => { pendingImage = null; byId('attachmentPreview').innerHTML = ''; });
    });
  };
  reader.readAsDataURL(file);
}

function wireSettings() {
  document.querySelectorAll('[data-response-language]').forEach((button) => button.addEventListener('click', () => {
    settings.responseLanguage = button.dataset.responseLanguage;
    syncSettingsControls(); persist(); renderContext();
  }));
  document.querySelectorAll('[data-tone]').forEach((button) => button.addEventListener('click', () => {
    settings.tone = button.dataset.tone;
    syncSettingsControls(); persist();
  }));
  document.querySelectorAll('[data-context-layer]').forEach((input) => {
    input.addEventListener('change', () => { settings.layers[input.dataset.contextLayer] = input.checked; persist(); renderContext(); });
  });
  syncSettingsControls();
}

function syncSettingsControls() {
  document.querySelectorAll('[data-response-language]').forEach((button) => button.classList.toggle('active', button.dataset.responseLanguage === settings.responseLanguage));
  document.querySelectorAll('[data-tone]').forEach((button) => button.classList.toggle('active', button.dataset.tone === settings.tone));
  document.querySelectorAll('[data-context-layer]').forEach((input) => { input.checked = settings.layers[input.dataset.contextLayer] !== false; });
}

/**
 * Settings backup payload — profiles, preferences and the local translation history.
 * @returns {object}
 */
export function buildBackup() {
  return {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    activeId,
    profiles,
    settings,
    history: getHistory(),
  };
}

/** Event persona.js dispatches after local data changes (import/clear) — consumed by ui.js. */
export const LOCAL_DATA_EVENT = 'persona:local-data-changed';

function setImportStatus(message) {
  const status = byId('importStatus');
  if (status) status.textContent = message;
}

/**
 * Validate and normalize an untrusted backup payload (parsed JSON).
 * Returns null when it is not a PERSONA backup (no `profiles` array) so the
 * caller can reject it without touching current data. Caps mirror loadStore:
 * last 500 messages per profile, newest 50 history entries; malformed entries
 * are dropped instead of crashing the render.
 * @param {*} raw parsed JSON value
 * @returns {{profiles: Array, settings: object, history: Array, activeId: string, counts: {profiles: number, messages: number, translations: number}} | null}
 */
export function normalizeBackup(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !Array.isArray(raw.profiles)) return null;
  const profiles = raw.profiles
    .filter((item) => item && typeof item === 'object' && item.id && item.name)
    .map((item) => ({ ...item, messages: (Array.isArray(item.messages) ? item.messages : []).filter((message) => message && typeof message === 'object').slice(-500) }));
  const storedSettings = raw.settings && typeof raw.settings === 'object' && !Array.isArray(raw.settings) ? raw.settings : null;
  const storedLayers = storedSettings?.layers;
  const layers = storedLayers && typeof storedLayers === 'object' && !Array.isArray(storedLayers) ? storedLayers : {};
  const settings = { ...defaultSettings, ...(storedSettings || {}), layers: { ...defaultSettings.layers, ...layers } };
  const history = (Array.isArray(raw.history) ? raw.history : [])
    .filter((item) => item && typeof item === 'object' && typeof item.text === 'string' && typeof item.translation === 'string')
    .slice(0, 50) // same newest-first FIFO cap as history.js
    .map((item, index) => ({ ...item, id: Number.isFinite(item.id) ? item.id : Date.now() + index, direction: item.direction === 'zh-en' ? 'zh-en' : 'en-zh', targetLanguage: typeof item.targetLanguage === 'string' && item.targetLanguage.trim() ? item.targetLanguage.trim() : undefined, timestamp: typeof item.timestamp === 'string' ? item.timestamp : new Date().toISOString() }));
  const activeId = typeof raw.activeId === 'string' && profiles.some((profile) => profile.id === raw.activeId) ? raw.activeId : profiles[0]?.id || '';
  const messages = profiles.reduce((count, profile) => count + profile.messages.length, 0);
  return { profiles, settings, history, activeId, counts: { profiles: profiles.length, messages, translations: history.length } };
}

function importSummary(counts) {
  const parts = [`${counts.profiles} profile${counts.profiles === 1 ? '' : 's'}`];
  if (counts.messages) parts.push(`${counts.messages} saved message${counts.messages === 1 ? '' : 's'}`);
  parts.push(`${counts.translations} translation${counts.translations === 1 ? '' : 's'}`);
  return `Imported ${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}.`;
}

/**
 * Import a JSON backup: reject invalid files untouched, confirm with counts,
 * then replace local data, persist and re-render everything.
 * @param {string} text raw file contents
 * @returns {boolean} true when the import was applied
 */
export function importBackupText(text) {
  let raw;
  try { raw = JSON.parse(text); } catch { raw = null; }
  const backup = normalizeBackup(raw);
  if (!backup) { setImportStatus('That file is not a PERSONA backup.'); return false; }
  const { profiles: nextProfiles, settings: nextSettings, history: nextHistory, activeId: nextActiveId, counts } = backup;
  const question = `Import this backup? It replaces the data on this device.\n\nProfiles: ${counts.profiles}\nSaved messages: ${counts.messages}\nTranslations: ${counts.translations}`;
  if (!window.confirm(question)) { setImportStatus('Import cancelled.'); return false; }
  profiles = nextProfiles; settings = nextSettings; activeId = nextActiveId;
  saveHistory(nextHistory);
  persist();
  syncSettingsControls(); renderAll();
  setImportStatus(importSummary(counts));
  document.dispatchEvent(new window.CustomEvent(LOCAL_DATA_EVENT));
  return true;
}

async function handleImportFile(event) {
  const file = event.target.files?.[0];
  event.target.value = ''; // permit re-selecting the same file
  if (!file) return;
  try {
    importBackupText(await file.text());
  } catch {
    setImportStatus('That file is not a PERSONA backup.');
  }
}

function exportBackup() {
  const blob = new Blob([JSON.stringify(buildBackup(), null, 2)], { type: 'application/json' });
  const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `persona-backup-${new Date().toISOString().slice(0, 10)}.json`; link.click(); URL.revokeObjectURL(link.href);
}

function clearLocalData() {
  if (window.prompt('Type CLEAR to permanently remove all profiles and conversations from this device.') !== 'CLEAR') return;
  profiles = []; activeId = ''; settings = { ...defaultSettings, layers: { ...defaultSettings.layers } };
  Object.values(KEYS).forEach((key) => localStorage.removeItem(key));
  localStorage.removeItem(HISTORY_KEY);
  setImportStatus('');
  syncSettingsControls(); renderAll();
  document.dispatchEvent(new window.CustomEvent(LOCAL_DATA_EVENT));
}

export function initPersona() {
  loadStore(); wireSettings(); renderAll();
  const initial = window.location.hash.replace('#', '');
  navigate(VIEWS.includes(initial) ? initial : 'chat');
  window.addEventListener('hashchange', () => {
    const hash = window.location.hash.replace('#', '');
    navigate(VIEWS.includes(hash) ? hash : 'chat');
  });
  document.querySelector('.brand')?.addEventListener('click', (event) => { event.preventDefault(); navigate('chat'); });
  const pwaNote = byId('pwaNote');
  if (pwaNote && !window.matchMedia?.('(display-mode: standalone)')?.matches) pwaNote.classList.remove('hidden');
  document.querySelectorAll('.nav-item').forEach((button) => button.addEventListener('click', () => navigate(button.dataset.view)));
  byId('addProfile').addEventListener('click', () => openProfileForm());
  byId('closeProfileForm').addEventListener('click', () => setProfileFormOpen(false));
  byId('cancelProfile').addEventListener('click', () => setProfileFormOpen(false));
  byId('profileBackdrop')?.addEventListener('click', () => setProfileFormOpen(false));
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !byId('profileFormCard').hidden) setProfileFormOpen(false); });
  byId('profileForm').addEventListener('submit', saveProfile);
  document.querySelectorAll('.context-open').forEach((button) => button.addEventListener('click', () => showContext(true)));
  byId('closeContext').addEventListener('click', () => showContext(false));
  byId('contextBackdrop').addEventListener('click', () => showContext(false));
  byId('sendMessage').addEventListener('click', () => sendMessage());
  byId('chatInput').addEventListener('keydown', (event) => {
    if (event.isComposing || event.keyCode === 229) return; // IME composition in progress
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); sendMessage(); }
  });
  byId('chatInput').addEventListener('input', (event) => { event.target.style.height = '44px'; event.target.style.height = `${Math.min(event.target.scrollHeight, 110)}px`; });
  byId('attachImage').addEventListener('click', () => byId('imageInput').click());
  byId('imageInput').addEventListener('change', (event) => {
    attachImage(event.target.files?.[0]);
    event.target.value = ''; // permit re-selecting the same file
  });
  byId('exportData').addEventListener('click', exportBackup);
  byId('importData').addEventListener('click', () => byId('importFile').click());
  byId('importFile').addEventListener('change', handleImportFile);
  byId('clearData').addEventListener('click', clearLocalData);
  byId('voiceInput').addEventListener('click', () => {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) { byId('error').textContent = 'Voice input is not supported by this browser.'; return; }
    const recognition = new Recognition(); recognition.lang = document.querySelector('.lang-btn.active')?.dataset.dir === 'zh-en' ? (byId('targetLanguage').value === 'Japanese' ? 'ja-JP' : 'zh-CN') : 'en-US';
    recognition.onresult = (event) => { byId('input').value = event.results[0][0].transcript; byId('input').dispatchEvent(new window.Event('input')); };
    recognition.onerror = () => { byId('error').textContent = 'Voice input could not be recognized.'; }; recognition.start();
  });
  byId('speakOutput').addEventListener('click', () => {
    const dir = document.querySelector('.lang-btn.active')?.dataset.dir || 'en-zh';
    speak(byId('output').textContent, dir === 'zh-en' ? 'English' : stateTargetLanguage());
  });
  byId('clearTranslation').addEventListener('click', () => { byId('input').value = ''; byId('input').dispatchEvent(new window.Event('input')); byId('outputWrap').style.display = 'none'; });
  byId('targetLanguage').addEventListener('change', () => {
    applyTargetLanguage(byId('targetLanguage').value);
  });
}

function stateTargetLanguage() { return byId('targetLanguage')?.value || 'Chinese'; }
