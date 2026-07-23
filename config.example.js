// MiniChat Translator configuration (template).
//
// The app calls the OpenCode Go gateway (model: deepseek-v4-flash) THROUGH the
// minichat-proxy CORS container (see docker-compose.yml, service minichat-proxy).
// The API key is injected SERVER-SIDE by the proxy from OPENCODE_GO_API_KEY
// (kept in .env on the host) — it never ships to the browser, so apiKey below
// is intentionally empty.
//
// Copy this file to config.js and adjust baseUrl for your environment:
//   cp config.example.js config.js
//
// config.js is gitignored — never commit.

export const baseUrl = 'http://192.168.100.101:3000';
export const apiKey = '';
