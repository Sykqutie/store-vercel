'use strict';
// Signed, HttpOnly session cookie (HMAC-SHA256). No server-side session store needed.
const crypto = require('crypto');

const COOKIE = 'store_session';
const MAX_AGE = 60 * 60 * 8; // 8 hours

function secret() {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 16) {
    const e = new Error('AUTH_SECRET is not set (use 16+ random characters). Add it in Vercel, then redeploy.');
    e.expose = true;
    throw e;
  }
  return s;
}

const hmac = (body) => crypto.createHmac('sha256', secret()).update(body).digest('base64url');

function sign(payload) {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + MAX_AGE })).toString('base64url');
  return body + '.' + hmac(body);
}

function verify(token) {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const expected = Buffer.from(hmac(parts[0]));
  const given = Buffer.from(parts[1]);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
  try {
    const p = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
    return p.exp > Date.now() / 1000 ? p : null;
  } catch (_) {
    return null;
  }
}

function parseCookies(header) {
  const out = {};
  String(header || '').split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

const secure = () => (process.env.VERCEL ? '; Secure' : '');

function setSession(res, user) {
  const token = sign({ uid: user.id, username: user.username });
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${MAX_AGE}${secure()}`);
}

function clearSession(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${secure()}`);
}

function currentUser(req) {
  return verify(parseCookies(req.headers.cookie)[COOKIE]);
}

function requireAuth(req, res, next) {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: 'Please sign in.' });
  req.user = user;
  next();
}

module.exports = { setSession, clearSession, currentUser, requireAuth };
