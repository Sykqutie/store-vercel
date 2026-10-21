'use strict';
// READ-ONLY data snapshot of the connected Supabase database.
// Passwords are NEVER printed - only the hash algorithm family.
const db = require('../lib/db.js');

const kind = (h) => {
  const s = String(h || '');
  if (/^\$2[abxy]\$\d{2}\$/.test(s)) return 'bcrypt';
  if (/^\$argon2/.test(s)) return 'argon2';
  if (/^[a-f0-9]{32}$/i.test(s)) return 'md5';
  if (/^[a-f0-9]{40}$/i.test(s)) return 'sha1';
  if (/^[a-f0-9]{64}$/i.test(s)) return 'sha256';
  return s ? 'unknown' : 'empty';
};

(async () => {
  const p = await db.query(
    `SELECT id, barcode, name, category, cost_price::float8 AS cost, price::float8 AS price,
            stock, low_stock_threshold AS thr, created_at, updated_at
     FROM products ORDER BY id`);
  console.log('=== products (' + p.rows.length + ') ===');
  console.log('id | barcode          | name                       | category     | cost  | price | stock | thr | created_at');
  for (const r of p.rows) {
    console.log(
      String(r.id).padStart(2) + ' | ' + String(r.barcode).padEnd(16) + ' | ' +
      String(r.name).padEnd(26) + ' | ' + String(r.category).padEnd(12) + ' | ' +
      String(r.cost).padStart(5) + ' | ' + String(r.price).padStart(5) + ' | ' +
      String(r.stock).padStart(5) + ' | ' + String(r.thr).padStart(3) + ' | ' +
      new Date(r.created_at).toISOString().slice(0, 16)
    );
  }
  const dup = await db.query(
    `SELECT barcode, COUNT(*)::int AS n FROM products GROUP BY barcode HAVING COUNT(*) > 1`);
  console.log('duplicate barcodes:', dup.rows.length ? JSON.stringify(dup.rows) : '(none)');

  const u = await db.query(
    `SELECT id, username, role, active, created_at, password FROM users ORDER BY id`);
  console.log('\n=== users (' + u.rows.length + ') ===');
  for (const r of u.rows) {
    console.log(`id=${r.id} username=${JSON.stringify(r.username)} role=${r.role} active=${r.active} hash=${kind(r.password)} created_at=${new Date(r.created_at).toISOString()}`);
  }

  const sm = await db.query(
    `SELECT id, product_id, product_name, change_qty, reason, note, created_at FROM stock_movements ORDER BY id`);
  console.log('\n=== stock_movements (' + sm.rows.length + ') ===');
  for (const r of sm.rows) {
    console.log(`id=${r.id} product_id=${r.product_id} name=${JSON.stringify(r.product_name)} qty=${r.change_qty} reason=${r.reason} note=${JSON.stringify(r.note)} at=${new Date(r.created_at).toISOString()}`);
  }

  const s = await db.query('SELECT COUNT(*)::int AS n FROM sales');
  const si = await db.query('SELECT COUNT(*)::int AS n FROM sale_items');
  console.log('\nsales=' + s.rows[0].n + ' sale_items=' + si.rows[0].n);

  const orphan = await db.query(
    `SELECT COUNT(*)::int AS n FROM stock_movements m LEFT JOIN products p ON p.id = m.product_id
     WHERE m.product_id IS NOT NULL AND p.id IS NULL`);
  console.log('stock_movements pointing at missing products:', orphan.rows[0].n);

  const orphans = await db.query(
    `SELECT COUNT(*)::int AS n FROM sale_items si LEFT JOIN products p ON p.id = si.product_id
     WHERE si.product_id IS NOT NULL AND p.id IS NULL`);
  console.log('sale_items pointing at missing products:', orphans.rows[0].n);
  process.exit(0);
})().catch((e) => { console.error('FAIL:', e.code || '', e.message); process.exit(1); });
