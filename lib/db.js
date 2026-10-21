'use strict';
// Postgres access. Works with Neon, Supabase, Vercel Postgres or any Postgres URL.
// Accepts every variable name the Vercel/Neon integrations are known to set:
//   DATABASE_URL (pooled, preferred for serverless)
//   DATABASE_URL_UNPOOLED (direct, used for migrations / fallback)
//   POSTGRES_URL / POSTGRES_URL_NON_POOLING (legacy Vercel Postgres names)
//   NEON_DATABASE_URL (some manual setups)
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

let pool;

function rawConnectionString() {
  return (
    process.env.DATABASE_URL ||
    process.env.DATABASE_URL_UNPOOLED ||
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_URL_NON_POOLING ||
    process.env.NEON_DATABASE_URL ||
    ''
  );
}

// Sanitize copy-paste mistakes without ever logging the value:
// trim whitespace/newlines, strip one layer of surrounding quotes.
// (Vercel values pasted with "quotes" or trailing spaces fail DNS otherwise.)
function connectionString() {
  let cs = rawConnectionString();
  if (!cs) return '';
  cs = String(cs).trim().replace(/^["'](.*)["']$/s, '$1').trim();
  cs = cs.replace(/[\r\n\s]+/g, '');
  return cs;
}

// Hostname only (no user, password, or database name) — safe to expose in
// /api/status so a typo/placeholder like "host" is visible without leaking secrets.
function publicHost() {
  const cs = connectionString();
  if (!cs) return null;
  try {
    return new URL(cs).hostname || null;
  } catch (_) {
    return null;
  }
}

 // Presence flags for /api/status diagnostics (booleans only — never leak values).
function envPresence() {
  return {
    DATABASE_URL: !!process.env.DATABASE_URL,
    DATABASE_URL_UNPOOLED: !!process.env.DATABASE_URL_UNPOOLED,
    POSTGRES_URL: !!process.env.POSTGRES_URL,
    POSTGRES_URL_NON_POOLING: !!process.env.POSTGRES_URL_NON_POOLING,
    NEON_DATABASE_URL: !!process.env.NEON_DATABASE_URL
  };
}

// Supabase presents a privately-issued certificate chain (Supabase Root 2021 CA)
// that is not in Node's default trust store, so the root CA must be supplied
// explicitly. Resolution order:
//   1. SUPABASE_CA_CERT_PATH (explicit override)
//   2. PGSSLROOTCERT        (libpq standard variable)
//   3. certs/supabase-root-ca.pem bundled with the app (local + Vercel)
let supabaseCaPem;

function loadSupabaseCa() {
  if (supabaseCaPem !== undefined) return supabaseCaPem;
  const candidates = [];
  if (process.env.SUPABASE_CA_CERT_PATH) candidates.push(process.env.SUPABASE_CA_CERT_PATH);
  if (process.env.PGSSLROOTCERT) candidates.push(process.env.PGSSLROOTCERT);
  candidates.push(path.join(__dirname, '..', 'certs', 'supabase-root-ca.pem'));
  candidates.push(path.join(process.cwd(), 'certs', 'supabase-root-ca.pem'));
  for (const p of candidates) {
    try {
      const pem = fs.readFileSync(p, 'utf8');
      if (pem.includes('-----BEGIN CERTIFICATE-----')) {
        supabaseCaPem = pem;
        return pem;
      }
    } catch (_) { /* try the next candidate */ }
  }
  const e = new Error(
    'Supabase CA certificate not found. Download it from the Supabase Dashboard ' +
    '(Settings -> Database -> SSL Configuration -> Download certificate) and save it as ' +
    'certs/supabase-root-ca.pem, or set SUPABASE_CA_CERT_PATH to its file path.'
  );
  e.expose = true;
  throw e;
}

// pg >= 8.23 parses ?sslmode=... out of the connection string and uses that parsed
// ssl config to OVERRIDE any explicit `ssl` option (Object.assign in ConnectionParameters),
// silently discarding our CA settings. Remove sslmode from the URL and configure TLS
// exclusively through the explicit ssl object below so it cannot be overridden.
function stripSslmode(cs) {
  return cs
    .replace(/([?&])sslmode=[^&]*/gi, '$1')
    .replace(/&&+/g, '&')
    .replace(/\?&/g, '?')
    .replace(/[?&]$/, '');
}

// TLS config for hosts that need it. Certificate verification stays ON everywhere:
// Supabase connections verify the chain against the pinned Supabase root CA and
// verify the hostname; other TLS hosts verify against Node's default trust store.
function sslFor(cs) {
  if (!cs) return undefined;
  if (/supabase\.(co|com)/i.test(cs)) {
    return { ca: loadSupabaseCa(), rejectUnauthorized: true };
  }
  if (/sslmode=|neon\.tech/i.test(cs)) {
    return { rejectUnauthorized: true };
  }
  return undefined;
}

function getPool() {
  if (!pool) {
    const cs = connectionString();
    if (!cs) {
      const e = new Error('DATABASE_URL is not set. Add a Postgres database to the Vercel project, then redeploy.');
      e.expose = true;
      throw e;
    }
    pool = new Pool({
      connectionString: stripSslmode(cs),
      ssl: sslFor(cs),
      max: 3,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 12000
    });
    pool.on('error', () => {});
  }
  return pool;
}

const query = (text, params) => getPool().query(text, params);

// Raw client for multi-query helpers (caller must release it).
const connect = () => getPool().connect();
const getPoolConnect = connect;

// Multi-statement SQL without parameters (used by the installer).
const exec = (text) => getPool().query(text);

// Run fn(client) inside BEGIN/COMMIT. client.query(text, params) is available.
async function tx(fn) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { query, exec, tx, connect, getPoolConnect, connectionString, envPresence, publicHost };
