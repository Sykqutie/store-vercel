'use strict';
// Postgres access. Works with Neon, Supabase, Vercel Postgres or any Postgres URL.
// Accepts every variable name the Vercel/Neon integrations are known to set:
//   DATABASE_URL (pooled, preferred for serverless)
//   DATABASE_URL_UNPOOLED (direct, used for migrations / fallback)
//   POSTGRES_URL / POSTGRES_URL_NON_POOLING (legacy Vercel Postgres names)
//   NEON_DATABASE_URL (some manual setups)
const { Pool } = require('pg');

let pool;

function connectionString() {
  return (
    process.env.DATABASE_URL ||
    process.env.DATABASE_URL_UNPOOLED ||
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_URL_NON_POOLING ||
    process.env.NEON_DATABASE_URL ||
    ''
  );
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

// Neon / Supabase require TLS. `pg` honours ?sslmode=require in the URL, but
// explicit ssl is more reliable on Vercel serverless (avoids self-signed errors).
function sslFor(cs) {
  if (!cs) return undefined;
  if (/sslmode=require|neon\.tech|supabase\.co/.test(cs)) {
    return { rejectUnauthorized: false };
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
      connectionString: cs,
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

module.exports = { query, exec, tx, connect, getPoolConnect, connectionString, envPresence };
