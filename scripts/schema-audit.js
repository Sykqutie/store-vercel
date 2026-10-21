'use strict';
// READ-ONLY schema audit of the connected Supabase database.
// Reports columns, types, defaults, nullability, constraints, indexes,
// sequences, foreign keys, RLS state and row counts for the app tables.
// Writes nothing.
const db = require('../lib/db.js');

const APP_TABLES = ['users', 'products', 'sales', 'sale_items', 'stock_movements'];

(async () => {
  const tables = await db.query(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name`
  );
  console.log('=== public tables ===');
  console.log(tables.rows.map((r) => r.table_name).join(', '));

  for (const t of APP_TABLES) {
    const exists = tables.rows.some((r) => r.table_name === t);
    console.log(`\n=== ${t} === (exists: ${exists})`);
    if (!exists) continue;

    const cols = await db.query(
      `SELECT ordinal_position AS pos, column_name, data_type, udt_name, character_maximum_length AS len,
              numeric_precision AS numprec, numeric_scale AS numscale, is_nullable, column_default
       FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`,
      [t]
    );
    for (const c of cols.rows) {
      const def = c.column_default === null ? '' : ` default=${String(c.column_default).replace(/\(.*\)/, '(...)')}`;
      console.log(`  ${String(c.pos).padStart(2)}. ${c.column_name.padEnd(22)} ${(c.udt_name + (c.len ? '(' + c.len + ')' : '') + (c.numscale !== null ? '(p' + c.numprec + ',s' + c.numscale + ')' : '')).padEnd(18)} null=${c.is_nullable === 'YES' ? 'YES' : 'no '}${def}`);
    }

    const cons = await db.query(
      `SELECT con.conname, pg_get_constraintdef(con.oid) AS def
       FROM pg_constraint con JOIN pg_class rel ON rel.oid=con.conrelid JOIN pg_namespace n ON n.oid=rel.relnamespace
       WHERE n.nspname='public' AND rel.relname=$1 ORDER BY con.conname`, [t]);
    console.log('  constraints:');
    for (const c of cons.rows) console.log(`    - ${c.conname}: ${c.def}`);

    const idx = await db.query(
      `SELECT ic.relname AS name, pg_get_indexdef(idx.indexrelid) AS def
       FROM pg_index idx JOIN pg_class rel ON rel.oid=idx.indrelid JOIN pg_class ic ON ic.oid=idx.indexrelid
       JOIN pg_namespace n ON n.oid=rel.relnamespace
       WHERE n.nspname='public' AND rel.relname=$1 ORDER BY ic.relname`, [t]);
    console.log('  indexes:');
    for (const i of idx.rows) console.log(`    - ${i.name}: ${i.def}`);

    const seq = await db.query(
      `SELECT s.relname AS seq
       FROM pg_class s JOIN pg_namespace n ON n.oid=s.relnamespace
       WHERE n.nspname='public' AND s.relkind='S' AND pg_get_serial_sequence('public.'||$1||'', 'id') IS NOT NULL
         AND s.relname = pg_get_serial_sequence('public.'||$1||'', 'id')
       ORDER BY 1`, [t]);
    console.log('  sequences:', seq.rows.length ? seq.rows.map((s) => `${s.seq} -> ${t}.id`).join(', ') : '(none)');

    const rls = await db.query(
      `SELECT c.relrowsecurity, c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname='public' AND c.relname=$1`, [t]);
    console.log('  RLS:', rls.rows[0] ? `enabled=${rls.rows[0].relrowsecurity} forced=${rls.rows[0].relforcerowsecurity}` : '(unknown)');

    const pol = await db.query(
      `SELECT pol.polname, pol.polcmd FROM pg_policy pol JOIN pg_class c ON c.oid=pol.polrelid
       JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=$1`, [t]);
    console.log('  policies:', pol.rows.length ? pol.rows.map((p) => `${p.polname}(${p.polcmd})`).join(', ') : '(none)');

    const cnt = await db.query(`SELECT COUNT(*)::int AS n FROM public."${t}"`);
    console.log(`  rows: ${cnt.rows[0].n}`);

    const owner = await db.query(
      `SELECT tableowner FROM pg_tables WHERE schemaname='public' AND tablename=$1`, [t]);
    console.log('  owner:', owner.rows[0] ? owner.rows[0].tableowner : '(unknown)');
  }

  // Extra public tables not used by the app
  const extra = tables.rows.map((r) => r.table_name).filter((t) => !APP_TABLES.includes(t));
  if (extra.length) {
    console.log('\n=== other public tables (not used by the app) ===');
    for (const t of extra) {
      const cnt = await db.query(`SELECT COUNT(*)::int AS n FROM public."${t}"`);
      const cols = await db.query(
        `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`, [t]);
      console.log(`  ${t} (rows=${cnt.rows[0].n}) cols: ${cols.rows.map((c) => c.column_name).join(', ')}`);
    }
  }

  // Privileges granted on app tables
  console.log('\n=== grants on app tables ===');
  const gr = await db.query(
    `SELECT grantee, table_name, string_agg(privilege_type, ',' ORDER BY privilege_type) AS privs
     FROM information_schema.role_table_grants
     WHERE table_schema='public' AND table_name = ANY($1::text[]) GROUP BY grantee, table_name
     ORDER BY table_name, grantee`, [APP_TABLES]);
  for (const g of gr.rows) console.log(`  ${g.table_name}: ${g.grantee} -> ${g.privs}`);

  // Sequences owned + last_value (data-only, no writes)
  console.log('\n=== sequence state ===');
  const seqs = await db.query(
    `SELECT c.relname AS seq FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='public' AND c.relkind='S' ORDER BY 1`);
  for (const s of seqs.rows) {
    const v = await db.query(`SELECT last_value, is_called FROM public."${s.seq}"`);
    console.log(`  ${s.seq}: last_value=${v.rows[0].last_value} is_called=${v.rows[0].is_called}`);
  }
  process.exit(0);
})().catch((e) => { console.error('FAIL:', e.code || '', e.message); process.exit(1); });
