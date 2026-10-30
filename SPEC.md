# PERSONA — SPEC

## Concept & Vision
**PERSONA — "Talk with intention."** A private, local-first language and conversation companion PWA. It combines a profile-aware AI chat (coach a real person you know, in their language) with an English ↔ Chinese/Japanese translator. Mobile-first, installable, dark-free "paper" aesthetic. Everything you type stays on your device; only AI requests leave it.

## Design Language
- **Aesthetic**: Light, editorial "paper" utility — warm off-white, soft shadows, green accents
- **Colors** (`:root` in `src/styles.css`):
  - Paper bg: `#f6f5f1` · Surface: `#fff` · Ink: `#242723`
  - Muted: `#8a8e86` · Line: `#e8e8e1`
  - Green: `#c8e68c` · Green dark: `#536c30` · Green pale: `#f0f6e6`
  - Orange accent: `#f2a47e`
- **Typography**: system stack (`-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif`); headings reference `Manrope` with `sans-serif` fallback (no webfont is loaded)
- **Responsive**: mobile-first shell (max 1160px); ≤600px single column + fixed bottom nav + safe-area insets; ≥760px nav moves to top-right, profile list becomes 2 columns, overlays become centered modals
- **Motion**: minimal — view fade-in, sheet slide, `prefers-reduced-motion` respected

## Information Architecture — Four Screens
Hash-routed views (`#chat`, `#translate`, `#profiles`, `#settings`; `history.replaceState`), switched by a fixed bottom nav (Chat · Translate · Profiles · Settings).

Persistent chrome:
- **Topbar**: PERSONA brand (→ Chat), "Saved on device" badge (hidden ≤600px), **API status button**
- **API status**: runs a minimal completion on load and on click → `Checking…` / `Online · Nms` (latency) / `Offline`; 8s abort timeout
- **PWA note**: "Add to home screen…" shown only when not running standalone
- **Context sheet**: bottom sheet / modal (☷ "Context layers" button on Chat) showing the exact context about to be sent — per-layer text, char counts, included/excluded state, and a stable **context fingerprint** hash. "No hidden summaries."

## Chat (profile chat)
- **Profile tabs** select the active profile (+ "＋ Add profile"); conversation header shows avatar, name, `native · target · relationship`, and a `local` presence dot
- **Context strip**: `CONTEXT READY` · `<n> layers · <chars> chars · <hash>` · Review button
- **Compose**: textarea (maxlength 2000, auto-grows to 110px), **Enter sends / Shift+Enter newline** with IME-composition guard (CJK input), send button disabled while a request is pending
- **Image attachment** (optional): `＋` opens `accept="image/*"` file picker; the image is downscaled/re-encoded client-side (max side 1024px, JPEG q0.75) before storing, previewed as a removable chip, and sent as an OpenAI-style `image_url` content part
- **Assistant response contract** (strict JSON from the model):
  - `reply` — a natural, sendable message in the profile's target language (shown in a "SUGGESTED <TARGET> REPLY" box)
  - `pronunciation` — pinyin (Chinese) or romaji (Japanese), else empty
  - `coaching` — one short explanation in the configured response language (bubble text)
  - `extracted` — a short new fact worth remembering; appended to the profile notes as `Conversation note: …` (case-insensitive dedupe, capped at last 40 lines / 2000 chars)
- **Reply actions**: `Copy reply` (clipboard) and `Listen` (browser TTS in the target language)
- **Errors**: request aborts after 45s; on failure the user's message is kept and an error bubble offers `Retry` — only on the current last failure (stale retries are inert)
- **Empty states** for no profile / no messages; privacy note: "Your profiles and chats stay on this device. Only AI requests leave your device."

## Translate
- **Direction toggle**: `English → <target>` / `<target> → English` plus a target-language select: **中文 (Chinese) or 日本語 (Japanese)** — labels, direction buttons, and pronunciation UI all follow the select (restoring a history entry restores its language too)
- **Input**: textarea + live `N chars` count, clear button, and **voice input** (Web Speech API)
- **Translate button**: elapsed-second timer (`Translating... Ns`), disabled while running, `isTranslating` guard against double-fire; output labeled `NATURAL TRANSLATION`
- **Output actions**: `Copy` (Copied! for 1.5s; Clipboard API with `execCommand` fallback), **Speak** (TTS of the output), and a pronunciation section — `PINYIN` / `ROMAJI` with a Show toggle that **lazily fetches** romanization via a second API call (stale pronunciation is cleared when the direction/language changes)
- **Translation history**: `localStorage` (`minichat_history`), newest-first, FIFO cap 50; each row shows direction label (`EN → ZH` / `JA → EN`), relative time, source, translation; click restores into the UI. **Export CSV** → `minichat-translations-YYYY-MM-DD.csv` (Direction, Source Text, Translation, Timestamp); **Clear history** behind a confirm
- **Legacy tools** collapsed in a `<details>`: Naturalize (make Chinese more natural) and Reply helper (context + intent → reply), both with copy buttons

## Profiles
- Fields: **Name** (required, ≤60), native language, target language (Japanese/Chinese/English), relationship (≤120), notes (≤1200), tone (Friendly · Warm · Flirty · Professional · Direct)
- Card grid: colored initial avatar, relationship/notes preview, actions **Open chat · Edit · Delete** (delete confirms and cannot be undone); empty state with "Create your first profile"
- Editor is a bottom sheet / centered modal (backdrop click, `×`, or `Esc` closes)

## Settings
- **AI response language**: `English` (clear explanations) or `Target language` (immersive practice)
- **Default tone**: 5 chips (profile tone overrides it per profile)
- **Deterministic context layers**: on/off toggles for `profile`, `history`, `preferences`
- **Local data**: storage summary (`N profiles · M saved messages on this device`), **Export backup** → `persona-backup-YYYY-MM-DD.json` (`schemaVersion: 1` with active profile id + profiles + settings + translation history), **Import backup** → hidden `accept="application/json,.json"` file picker (re-selecting the same file works); the JSON is validated/normalized (object with a `profiles` array; optional `settings`/`history`, capped like storage — last 500 messages per profile, newest 50 history entries; malformed entries tolerated) and rejected untouched if it is not a PERSONA backup; a valid backup is confirmed with counts (profiles · saved messages · translations) and then **replaces** local data, persists, re-syncs the settings controls, re-renders every view, restores the active profile, and refreshes the translation history via a `persona:local-data-changed` event from `persona.js`; results show on a `role="status"` line (`Imported 2 profiles and 1 translation.` / `That file is not a PERSONA backup.`), **Clear local data** → requires typing `CLEAR`, then wipes all persona keys **and** translation history, resets settings to defaults, and signals the same event
- Footer: **"No account. No cloud sync. API requests only when you ask for AI."**

## Deterministic Context
`src/persona-context.js` builds the system context in a **fixed order** from the same inputs every time:
1. **Profile details** — relationship + notes
2. **Recent conversation** — last 12 non-error messages, oldest→newest, `Name:`/`Me:` prefixed
3. **Response preferences** — tone, reply language (resolved from settings), target language

Each layer is marked included/excluded (excluded layers stay inspectable in the sheet, dimmed). The serialized text is fingerprinted with FNV-1a (8 hex chars) and shown in the Chat strip and context sheet — same conversation state ⇒ same fingerprint. Error messages are excluded from the window. The prompt instructs the model to use this as background only and not to invent profile facts.

## Storage (local-first)
- All state in `localStorage` — no backend of our own, no accounts:
  - `persona.profiles.v1` (profiles + messages, capped at last 500 messages per profile), `persona.settings.v1`, `persona.active.v1`, `minichat_history`
- Boot normalizes corrupt/legacy payloads and only rewrites storage when something actually changed (avoids clobbering other open tabs)
- **Quota handling**: on write failure, retries once with image payloads stripped from the stored copy (in-memory messages keep images for the session) and surfaces a warning to export a backup
- **Local-first transfer** — no cloud sync; data moves between devices only when the user carries the exported JSON backup (re-importable via **Settings › Import backup**) or CSV history themselves.

## API Integration
- **Endpoint**: `${baseUrl}/chat/completions` — OpenAI-compatible chat completions, model **`deepseek-v4-flash`**
  - Translate: `max_tokens: 2000`, translation-only system prompt; Chat: `max_tokens: 1200`, JSON contract above; Health: `max_tokens: 10`; Pinyin/romaji, Naturalize, Reply helper each have their own terse system prompt
  - `<think>…</think>` blocks are stripped; translate/naturalize/reply fall back to `reasoning_content`
- **`config.js`** (ESM, **gitignored**, template `config.example.js`):
  ```js
  export const baseUrl = 'http://192.168.100.101:3000';
  export const apiKey = ''; // empty by design — injected server-side
  ```
- **CORS proxy** (`proxy/proxy.js`, container `minichat-proxy` on :3000): accepts browser `POST`s (CORS `*`), injects the key from env `OPENCODE_GO_API_KEY` **server-side**, and forwards to `opencode.ai/zen/go/v1/chat/completions` — the API key never reaches the browser. 500 if the env key is missing, 502 on upstream failure
- **Serving**: `docker-compose.yml` → `minichat-translator` (nginx:alpine static site on **:8081**) + `minichat-proxy` (:3000)

## Architecture
- **Vanilla JS, ES modules, no framework, no build step.** `index.html` + external `src/styles.css`; entry `<script type="module" src="/src/ui.js">` with a guarded boot block (checks `#translateBtn` so vitest imports don't auto-init)
- Modules: `ui` (wiring) · `persona` (chat/profiles/settings/storage) · `persona-context` · `translate` · `pinyin` · `naturalize` · `reply` · `health` · `history` · `clipboard` · `escape` · `time` · `state` · `sw-register`
- **PWA**: `manifest.json` (PERSONA, `standalone`, paper theme `#f6f5f1`, icons 192/512); `sw.js` cache `persona-v3` — **network-first with cache fallback for GET only, never caches POST/API traffic**; old caches purged on activate; registration failures are swallowed
- **Tests/tooling**: `npm run lint` (ESLint), `npm test` (Vitest + happy-dom), `npm run test:e2e` (Playwright; service workers blocked in tests so mocks hold), Prettier
- File structure:
  ```
  index.html  manifest.json  sw.js  config.js (gitignored)  config.example.js
  icon-192.png  icon-512.png
  src/*.js  src/styles.css
  proxy/proxy.js  docker-compose.yml
  tests/  e2e/  playwright.config.js  vitest.config.js  eslint.config.js
  ```

## Browser Support Constraints
- **Voice input** needs `SpeechRecognition`/`webkitSpeechRecognition` (Web Speech API): available in Chrome/Edge and iOS Safari; **Firefox desktop has no support** — the Translator shows *"Voice input is not supported by this browser."* Recognition also depends on the browser's own (often network-based) speech service
- **Text-to-speech** uses `speechSynthesis` (broadly supported); if the API is absent, Speak/Listen no-op silently. Chinese/Japanese output requires an OS/browser `zh-CN`/`ja-JP` voice to be installed, otherwise the utterance may speak in the wrong language or not at all
- **Service worker / offline shell** requires a secure context (HTTPS or `localhost`); on plain-HTTP LAN deploys registration fails silently and the app works online-only
- **Clipboard**: `navigator.clipboard` (secure context) with a legacy `execCommand` fallback

## Non-Goals / Explicitly Not Implemented
- No accounts, no login, no cloud sync, no multi-device sync
- No backend beyond the thin CORS proxy; no analytics, no telemetry
