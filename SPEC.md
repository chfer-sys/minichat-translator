# MiniChat Translator — SPEC

## Concept & Vision
A minimal, mobile-first translation PWA for casual chat. Dark-themed, instant loading, "add to home screen" feel. Translates between English and Chinese using MiniMax AI. Quick wins: character count, elapsed timer, pinyin toggle for ZH→EN.

## Design Language
- **Aesthetic**: Dark utility, developer-friendly
- **Colors**:
  - Background: #0f172a (deep navy)
  - Card: #1e293b (slate)
  - Border: #334155
  - Text: #f1f5f9
  - Text muted: #94a3b8
  - Accent: #6366f1 (indigo)
  - Accent hover: #818cf8
  - Success: #22c55e
  - Error: #ef4444
- **Typography**: SF Pro (system), -apple-system, BlinkMacSystemFont, sans-serif
- **Spacing**: 16px base unit
- **Motion**: Minimal — timer updates in button, fade on copy success

## Layout
- Single column, mobile-first (max-width: 600px centered)
- Top: App title + subtitle
- Main: Language toggle → Input textarea → Translate button
- Output: Translated text + Copy button + Pinyin toggle (ZH→EN only)
- Footer: PWA install hint

## Features & Interactions

### Language Toggle
- Two states: "EN → ZH" and "ZH → EN"
- Active state: indigo border + tinted background
- Switching clears output

### Translation Input
- Textarea with dark background
- Character count displayed bottom-right ("X chars")
- Placeholder: "Enter text to translate..."

### Translate Button
- Full-width, indigo background
- On tap: shows "Translating... Xs" with live second counter
- Disabled while loading
- Returns to "Translate" on complete/error

### Translation Output
- Read-only display area with pre-wrap
- Copy button (top-right): copies to clipboard, shows "Copied!" for 1.5s then reverts
- Pinyin toggle (ZH→EN only): "Show/Hide Pinyin" — lazy loads pinyin via second API call

### PWA
- Service worker: network-first, cache fallback
- Manifest: standalone display, indigo theme
- Icons: 192x192 and 512x512 PNG
- Install hint hidden when in standalone mode

## Component States
- **Translate button**: default ("Translate"), loading ("Translating... Xs"), disabled
- **Copy button**: default, success (green border + "Copied!")
- **Input**: empty (placeholder), filled
- **Output**: hidden, visible
- **Pinyin toggle**: hidden (EN→ZH), visible (ZH→EN); Show/Hide toggle

## Technical Approach
- Single HTML file, no build step
- Vanilla JS, no frameworks
- CSS embedded in `<style>`
- MiniMax API direct (not OpenRouter)
- Service worker for offline caching
- No backend required — client-side only

## API Integration
- Endpoint: `https://api.minimax.chat/v1/text/translate_task`
- Method: POST
- Auth: Bearer token (API key in config.js)
- Model: `MiniMax-Text-01`
- System prompt: sets source/target language, asks for translation only

## File Structure
```
/root/vault/projects/minichat-translator/
├── index.html      # Main app
├── config.js       # API key (gitignored)
├── sw.js           # Service worker
├── manifest.json   # PWA manifest
├── icon-192.png   # App icon 192x192
└── icon-512.png   # App icon 512x512
```

## GitHub
- Repo: chfer-sys/minichat-translator (separate from vault)
- config.js should NOT be committed (contains API key)
