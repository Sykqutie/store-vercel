'use strict';
// Post-supabase-connection verification: SELECT 1, version(), transactions, schema inventory.
const db = require('../lib/db.js');

(async () => {
  const r1 = await db.query('SELECT 1 AS ok, version() AS v');
  console.log('SELECT 1:', r1.rows[0].ok);
  console.log('version:', r1.rows[0].v);

  const who = await db.query('SELECT current_database() AS db, current_user AS usr');
  console.log('database:', who.rows[0].db, 'user:', who.rows[0].usr);

  const r3 = await db.tx(async (c) => {
    await c.query('SELECT 1');
    return (await c.query('SELECT 42 AS answer')).rows[0];
  });
  console.log('tx answer:', r3.answer);

  const tables = await db.query(
    "SELECT table_schema, table_name FROM information_schema.tables " +
    "WHERE table_schema NOT IN ('pg_catalog','information_schema') ORDER BY 1,2"
  );
  console.log('non-system tables:', tables.rows.map((x) => x.table_schema + '.' + x.table_name).join(', ') || '(none)');

  const appTables = ['users', 'products', 'sales', 'sale_items', 'stock_movements'];
  const present = tables.rows.filter((x) => x.table_schema === 'public' && appTables.includes(x.table_name)).map((x) => x.table_name);
  console.log('app tables present:', present.length ? present.join(', ') : '(none)');
  for (const t of present) {
    const r = await db.query(`SELECT COUNT(*) AS n FROM ${t}`);
    console.log(`count ${t}:`, r.rows[0].n);
  }
  console.log('CONNECTION TESTS PASSED');
  process.exit(0);
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
