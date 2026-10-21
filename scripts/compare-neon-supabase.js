'use strict';
// READ-ONLY side-by-side: Neon (source) vs Supabase (target).
const { Pool } = require('pg');
const db = require('../lib/db.js');

const raw = String(process.env.NEON_DATABASE_URL || '').trim();
const neonCs = raw
  .replace(/([?&])sslmode=[^&]*/gi, '$1')
  .replace(/([?&])channel_binding=[^&]*/gi, '$1')
  .replace(/&&+/g, '&')
  .replace(/[?&]$/, '');

(async () => {
  const np = new Pool({ connectionString: neonCs, ssl: { rejectUnauthorized: true }, max: 1 });
  const n = await np.query(
    `SELECT id, barcode, name, category, cost_price::float8 AS cost, price::float8 AS price,
            stock, low_stock_threshold AS thr FROM products ORDER BY barcode`);
  const nu = await np.query(
    `SELECT id, username, role, active, created_at FROM users ORDER BY id`);
  const nm = await np.query(
    `SELECT id, product_id, product_name, change_qty, reason, note, created_at FROM stock_movements ORDER BY id`);
  await np.end();

  const s = await db.query(
    `SELECT id, barcode, name, category, cost_price::float8 AS cost, price::float8 AS price,
            stock, low_stock_threshold AS thr FROM products ORDER BY barcode`);
  const su = await db.query(`SELECT id, username, role, active, created_at FROM users ORDER BY id`);
  const sm = await db.query(
    `SELECT id, product_id, product_name, change_qty, reason, note, created_at FROM stock_movements ORDER BY id`);

  const sMap = new Map(s.rows.map((p) => [String(p.barcode), p]));
  console.log('=== PRODUCTS: Neon -> Supabase ===');
  console.log('barcode           name                 neon(stock/price)   supabase(stock/price)  result');
  for (const p of n.rows) {
    const t = sMap.get(String(p.barcode));
    const sTxt = t ? `${t.stock}/${t.price}` : '-';
    let result;
    if (!t) result = 'MISSING in Supabase -> will be inserted';
    else if (t.stock !== p.stock || t.price !== p.price || t.cost !== p.cost ||
             t.name !== p.name || t.category !== p.category || t.thr !== p.thr) result = 'DIFFERENT -> conflict';
    else result = 'identical';
    console.log(`${String(p.barcode).padEnd(17)} ${String(p.name).padEnd(20)} ${String(p.stock + '/' + p.price).padEnd(18)} ${sTxt.padEnd(20)} ${result}`);
  }
  const extra = s.rows.filter((p) => !n.rows.find((q) => String(q.barcode) === String(p.barcode)));
  console.log('Supabase-only products (not in Neon):', extra.length ? extra.map((p) => `${p.barcode}/${p.name}`).join(', ') : '(none)');

  console.log('\n=== USERS: Neon -> Supabase ===');
  for (const u of nu.rows) {
    const t = su.rows.find((x) => String(x.username).toLowerCase() === String(u.username).toLowerCase());
    console.log(`neon: ${JSON.stringify(u.username)} role=${u.role} active=${u.active} created=${new Date(u.created_at).toISOString().slice(0, 10)}`);
    console.log(`supabase: ${t ? JSON.stringify(t.username) + ' role=' + t.role + ' active=' + t.active + ' id=' + t.id : '(absent -> will be inserted)'}`);
  }
  console.log('Supabase-only users:', su.rows.filter((u) => !nu.rows.find((q) => String(q.username).toLowerCase() === String(u.username).toLowerCase()))
    .map((u) => `${u.username}/${u.role}`).join(', ') || '(none)');

  console.log('\n=== STOCK MOVEMENTS: Neon -> Supabase ===');
  for (const m of nm.rows) {
    console.log(`neon: #${m.id} product_id=${m.product_id} ${JSON.stringify(m.product_name)} qty=${m.change_qty} reason=${m.reason} note=${JSON.stringify(m.note)} at=${new Date(m.created_at).toISOString()}`);
  }
  console.log('supabase movements:', sm.rows.length);
  process.exit(0);
})().catch((e) => { console.error('FAIL', e.code || '', e.message); process.exit(1); });
