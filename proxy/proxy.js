// MiniChat CORS proxy.
// Forwards browser POSTs to the OpenCode Go gateway and injects the API key
// server-side (env OPENCODE_GO_API_KEY) so the key never reaches the browser.
// CORS: allows all origins (this is a LAN app behind the translator on :8081).

const http = require('http');
const https = require('https');

const PORT = 3000;
const UPSTREAM_HOST = 'opencode.ai';
const UPSTREAM_PATH = '/zen/go/v1/chat/completions';

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
    const bodyData = Buffer.concat(body);
    const proxyReq = https.request(
      {
        hostname: UPSTREAM_HOST,
        path: UPSTREAM_PATH,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + apiKey,
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
