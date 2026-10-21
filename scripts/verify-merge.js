'use strict';
// Post-merge verification (READ-ONLY).
const db = require('../lib/db.js');
const bcrypt = require('bcryptjs');

(async () => {
  const p = await db.query(
    `SELECT id, barcode, name, category, cost_price::float8 cost, price::float8 price, stock, low_stock_threshold thr
     FROM products ORDER BY barcode`);
  const u = await db.query(
    `SELECT id, username, role, active, left(password, 4) AS hash_prefix, length(password) AS hash_len, created_at
     FROM users ORDER BY id`);
  const m = await db.query(
    `SELECT m.id, m.product_id, m.product_name, m.change_qty, m.reason, m.note, m.created_at,
            p.barcode AS mapped_barcode, p.name AS mapped_name, p.stock AS mapped_stock
     FROM stock_movements m LEFT JOIN products p ON p.id = m.product_id ORDER BY m.id`);

  console.log('=== products (' + p.rows.length + ') ===');
  for (const r of p.rows) console.log(`  id=${String(r.id).padEnd(4)} ${String(r.barcode).padEnd(15)} ${String(r.name).padEnd(22)} ${r.category.padEnd(10)} cost=${r.cost} price=${r.price} stock=${r.stock} thr=${r.thr}`);

  console.log('\n=== users (' + u.rows.length + ') ===');
  for (const r of u.rows) console.log(`  id=${r.id} username=${r.username.padEnd(9)} role=${r.role.padEnd(7)} active=${r.active} hash=${r.hash_prefix}*** (len ${r.hash_len}) created=${new Date(r.created_at).toISOString().slice(0, 10)}`);

  console.log('\n=== stock_movements (' + m.rows.length + ') ===');
  for (const r of m.rows) {
    const ok = r.mapped_barcode ? 'linked -> ' + r.mapped_barcode + ' / ' + r.mapped_name + ' (stock ' + r.mapped_stock + ')' : 'NOT LINKED';
    console.log(`  id=${r.id} product_id=${r.product_id} ${JSON.stringify(r.product_name)} qty=${r.change_qty} reason=${r.reason} at=${new Date(r.created_at).toISOString()}`);
    console.log(`       ${ok}`);
  }

  // consistency: every movement's product_id must resolve to a product with the same name
  let bad = 0;
  for (const r of m.rows) {
    if (r.product_id === null) { console.log('  WARN: movement ' + r.id + ' has NULL product_id'); bad++; }
    else if (r.mapped_name !== r.product_name) { console.log('  WARN: movement ' + r.id + ' name mismatch'); bad++; }
  }
  console.log(bad === 0 ? '\nALL MOVEMENTS LINKED CORRECTLY' : '\n' + bad + ' PROBLEM(S)');

  // the Neon admin hash must verify against the real password
  const admin = u.rows.find((x) => x.username === 'admin');
  if (admin) {
    const full = await db.query(`SELECT password FROM users WHERE id=$1`, [admin.id]);
    const hash = full.rows[0].password;
    console.log('\nadmin hash is bcrypt          :', /^\$2[aby]\$/.test(hash));
    console.log('admin hash verifies vs "admin":', bcrypt.compareSync('admin', hash));
    console.log('admin hash verifies vs "admin123":', bcrypt.compareSync('admin123', hash));
  }
  process.exit(0);
})().catch((e) => { console.error('FAIL', e.code || '', e.message); process.exit(1); });
