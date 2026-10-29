// MiniChat CORS proxy.
// Forwards browser POSTs to the OpenCode Go gateway and injects the API key
// server-side (env OPENCODE_GO_API_KEY) so the key never reaches the browser.
// On the compose network it is internal-only: nginx (web, :8081) reaches it at
// http://proxy:3000 through the stripped /api prefix; no host port is published.
// CORS: allows all origins (harmless same-origin; kept for direct LAN debugging).

const http = require('http');
const https = require('https');
const crypto = require('crypto');

const PORT = 3000;
const UPSTREAM_HOST = 'opencode.ai';
const UPSTREAM_PATH = '/inference/go/openai/v1/chat/completions';

// Go rejects requests without x-opencode-session (MissingSessionID) and asks
// for a STABLE session id per client for routing/prompt caching. One UUID per
// proxy process is stable across every request this deployment sends.
const SESSION_ID = crypto.randomUUID();

// The frontend (src/*.js) still sends the retired model id. Rewrite it
// server-side so the static app needs no change.
const MODEL_ALIASES = { 'deepseek-v4-flash': 'deepseek-v4.1-flash' };

function proxy(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }
  if (req.method !== 'POST') {
    res.writeHead(405);
    res.end('Method not allowed');
    return;
  }

  const body = [];
  req.on('data', (chunk) => body.push(chunk));
  req.on('end', () => {
    const apiKey = process.env.OPENCODE_GO_API_KEY;
    if (!apiKey) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'OPENCODE_GO_API_KEY not set' }));
      return;
    }
    let bodyData = Buffer.concat(body);
    try {
      const payload = JSON.parse(bodyData.toString('utf8'));
      if (payload && MODEL_ALIASES[payload.model]) {
        payload.model = MODEL_ALIASES[payload.model];
        bodyData = Buffer.from(JSON.stringify(payload), 'utf8');
      }
    } catch {
      // Not JSON — forward the body untouched.
    }
    const proxyReq = https.request(
      {
        hostname: UPSTREAM_HOST,
        path: UPSTREAM_PATH,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + apiKey,
          'x-opencode-session': SESSION_ID,
          'User-Agent': 'minichat-translator/0.1',
          'Content-Length': bodyData.length,
        },
      },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        proxyRes.pipe(res);
      }
    );
    proxyReq.on('error', (err) => {
      console.error('Proxy error:', err.message);
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    });
    proxyReq.write(bodyData);
    proxyReq.end();
  });
}

http.createServer(proxy).listen(PORT, '0.0.0.0', () => {
  console.log(`MiniChat CORS proxy listening on port ${PORT} -> ${UPSTREAM_HOST}${UPSTREAM_PATH}`);
});
