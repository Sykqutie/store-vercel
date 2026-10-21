'use strict';
// Read-only connection diagnostics.
// Reports which database we are connected to, how the connection is secured,
// and which Postgres roles exist. NEVER prints the connection string, the
// password, or any key.
//
//   node --env-file=.env scripts/db-inspect.js
'use strict';
const db = require('../lib/db.js');

const mask = (s) => String(s || '').replace(/^(.{0,4}).*$/, '$1***');

(async () => {
  const p = await db.query(`
    SELECT current_database() AS db, current_user AS usr, session_user AS susr,
           inet_server_addr()::text AS server_addr, inet_server_port() AS server_port,
           version() AS version
  `);
  const s = p.rows[0];
  console.log('=== session identity ===');
  console.log('database     :', s.db);
  console.log('role         :', s.usr);
  console.log('server port  :', s.server_port);
  console.log('server       :', s.version);

  console.log('\n=== connection string (masked) ===');
  console.log('host         :', db.publicHost());
  console.log('configured   :', JSON.stringify(db.envPresence()));

  // Client-side socket state is authoritative for "is the wire encrypted".
  // pg_stat_ssl is NOT: behind a pooler it describes the pooler's own hop
  // to Postgres, not this connection.
  console.log('\n=== TLS ===');
  const { Client } = require('pg');
  const { parse } = require('pg-connection-string');
  const cs = db.connectionString();
  const parsed = parse(cs);
  const probe = new Client({
    connectionString: cs.replace(/([?&])sslmode=[^&]*/gi, '$1').replace(/[?&]$/, ''),
    ssl: { ca: require('fs').readFileSync(require('path').join(__dirname, '..', 'certs', 'supabase-root-ca.pem'), 'utf8'), rejectUnauthorized: true }
  });
  try {
    await probe.connect();
    const stream = probe.connection && probe.connection.stream;
    console.log('user         :', parsed.user);
    console.log('password     :', '*** (' + String(parsed.password || '').length + ' chars, not shown)');
    console.log('encrypted    :', !!(stream && stream.encrypted));
    console.log('protocol     :', stream && typeof stream.getProtocol === 'function' ? stream.getProtocol() : '(n/a)');
    console.log('verify cert  : rejectUnauthorized=true against certs/supabase-root-ca.pem');
  } catch (e) {
    console.log('TLS probe failed:', e.code || '', e.message.split('\n')[0]);
  } finally {
    try { await probe.end(); } catch (_) {}
  }

  console.log('\n=== roles ===');
  const roles = await db.query(
    `SELECT rolname, rolsuper, rolbypassrls FROM pg_roles
      WHERE rolname IN ('postgres','anon','authenticated','service_role','authenticator') ORDER BY rolname`);
  for (const r of roles.rows) {
    console.log(`  ${r.rolname.padEnd(14)} superuser=${r.rolsuper} bypasses_rls=${r.rolbypassrls}`);
  }

  console.log('\n=== RLS on app tables ===');
  const rls = await db.query(
    `SELECT c.relname AS t, c.relrowsecurity AS enabled, c.relforcerowsecurity AS forced,
            (SELECT count(*)::int FROM pg_policy pol WHERE pol.polrelid = c.oid) AS policies
     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname='public' AND c.relkind='r' AND c.relname = ANY($1::text[])
     ORDER BY c.relname`, [['users', 'products', 'sales', 'sale_items', 'stock_movements']]);
  for (const r of rls.rows) {
    console.log(`  ${r.t.padEnd(16)} rls_enabled=${r.enabled} forced=${r.forced} policies=${r.policies}`);
  }
  process.exit(0);
})().catch((e) => { console.error('FAIL:', e.code || '', e.message); process.exit(1); });
