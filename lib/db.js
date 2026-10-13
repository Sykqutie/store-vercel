'use strict';
// Postgres access. Works with Neon, Supabase, Vercel Postgres or any Postgres URL.
const { Pool } = require('pg');

let pool;

function connectionString() {
  return process.env.DATABASE_URL || process.env.POSTGRES_URL;
}

function getPool() {
  if (!pool) {
    if (!connectionString()) {
      const e = new Error('DATABASE_URL is not set. Add a Postgres database to the Vercel project, then redeploy.');
      e.expose = true;
      throw e;
    }
    pool = new Pool({
      connectionString: connectionString(),
      max: 5,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 8000
    });
    pool.on('error', () => {});
  }
  return pool;
}

const query = (text, params) => getPool().query(text, params);

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

module.exports = { query, exec, tx };
