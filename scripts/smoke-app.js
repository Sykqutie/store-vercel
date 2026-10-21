'use strict';
// App-level smoke test against the merged Supabase data (READ-ONLY endpoints only).
const crypto = require('crypto');
const { spawn } = require('child_process');

const PORT = 3998;
const BASE = `http://127.0.0.1:${PORT}`;

function mintSession(uid, username) {
  const secret = process.env.AUTH_SECRET;
  const body = Buffer.from(JSON.stringify({ uid, username, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
  const hmac = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return body + '.' + hmac;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const srv = spawn(process.execPath, ['--env-file=.env', 'dev.js'], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  srv.stdout.on('data', () => {});
  srv.stderr.on('data', () => {});

  let up = false;
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    try { const r = await fetch(`${BASE}/api/status`); if (r.ok) { up = true; break; } } catch (_) { }
  }
  if (!up) { console.error('server never came up'); srv.kill(); process.exit(1); }

  const cookie = mintSession(3, 'admin');
  const H = { Cookie: `store_session=${cookie}` };

  const check = async (label, url, opts) => {
    const r = await fetch(`${BASE}${url}`, opts);
    let body = '';
    try { body = JSON.stringify(await r.json()).slice(0, 220); } catch (_) { body = r.statusText; }
    console.log(`${label.padEnd(34)} -> HTTP ${r.status}  ${body}`);
    return r;
  };

  await check('GET /api/status', '/api/status');
  await check('GET /api/products (no auth)', '/api/products');
  await check('GET /api/products (admin)', '/api/products', { headers: H });
  await check('GET /api/dashboard (admin)', '/api/dashboard', { headers: H });
  await check('GET /api/alerts/low-stock', '/api/alerts/low-stock', { headers: H });
  await check('GET /api/me', '/api/me', { headers: H });
  await check('GET /api/users (admin=owner)', '/api/users', { headers: H });
  await check('GET /api/lookup?code=480009124818', '/api/lookup?code=480009124818', { headers: H });
  await check('GET /api/lookup?code=480011100166', '/api/lookup?code=480011100166', { headers: H });
  await check('GET /api/report', '/api/report', { headers: H });

  srv.kill();
  process.exit(0);
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
