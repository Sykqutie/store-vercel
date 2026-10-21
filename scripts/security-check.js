'use strict';
// READ-ONLY: confirm no probe row persisted + report anon/authenticated grants.
const db = require('../lib/db.js');

(async () => {
  const c = await db.query(
    `SELECT (SELECT COUNT(*)::int FROM products) AS products,
            (SELECT COUNT(*)::int FROM users) AS users,
            (SELECT COUNT(*)::int FROM stock_movements) AS movements,
            (SELECT COUNT(*)::int FROM products WHERE barcode LIKE 'SECURITY-PROBE%') AS probes`
  );
  console.log('counts =', JSON.stringify(c.rows[0]));

  const g = await db.query(
    `SELECT r.rolname,
            has_table_privilege(r.rolname, 'public.products', 'SELECT') AS sel,
            has_table_privilege(r.rolname, 'public.products', 'INSERT') AS ins,
            has_table_privilege(r.rolname, 'public.users', 'SELECT') AS users_sel,
            has_table_privilege(r.rolname, 'public.users', 'UPDATE') AS users_upd
     FROM pg_roles r WHERE r.rolname IN ('anon','authenticated','service_role','postgres') ORDER BY r.rolname`
  );
  console.log('\nrole          products:SELECT  products:INSERT  users:SELECT  users:UPDATE');
  for (const r of g.rows) {
    console.log(`${r.rolname.padEnd(13)} ${String(r.sel).padEnd(16)} ${String(r.ins).padEnd(16)} ${String(r.users_sel).padEnd(13)} ${r.users_upd}`);
  }

  const p = await db.query(
    `SELECT tablename, policyname, cmd, roles::text FROM pg_policies WHERE schemaname='public' ORDER BY tablename`
  );
  console.log('\nRLS policies in public =', p.rows.length);
  p.rows.forEach((r) => console.log('  ', r.tablename, r.policyname, r.cmd, r.roles));

  const e = await db.query(
    `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
     WHERE relnamespace='public'::regnamespace AND relkind='r' AND relname IN
     ('products','users','stock_movements','sales','sale_items') ORDER BY relname`
  );
  console.log('\ntable                  rls    force_rls');
  for (const r of e.rows) console.log(`${r.relname.padEnd(22)} ${String(r.relrowsecurity).padEnd(6)} ${r.relforcerowsecurity}`);
  process.exit(0);
})().catch((e) => { console.error('FAIL', e.code || '', e.message); process.exit(1); });
