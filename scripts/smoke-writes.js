'use strict';
// Transactional write smoke test: exercises the exact checkout write path
// (sales + sale_items + stock decrement + stock_movements) and then ROLLBACKs,
// so nothing is persisted. Also verifies the offline-sync columns exist.
const db = require('../lib/db.js');

const money = (n) => (Math.round(n) / 100).toFixed(2);
const cents = (n) => Math.round(Number(n) * 100);
const VAT_PERCENT = 12;

(async () => {
  const before = (await db.query(
    `SELECT (SELECT COUNT(*)::int FROM products) p, (SELECT COUNT(*)::int FROM users) u,
            (SELECT COUNT(*)::int FROM stock_movements) m, (SELECT COUNT(*)::int FROM sales) s,
            (SELECT COUNT(*)::int FROM sale_items) si`
  )).rows[0];
  console.log('before:', JSON.stringify(before));

  const client = await db.getPoolConnect();
  try {
    await client.query('BEGIN');
    console.log('BEGIN');

    // offline-sync columns must exist (checkout uses client_sale_id)
    const cols = await client.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema='public' AND table_name='sales' AND column_name IN ('client_sale_id','sale_date','payment_method','cashier')
       ORDER BY column_name`);
    console.log('sales offline columns present:', cols.rows.map((r) => r.column_name).join(', '));

    // pick the 3 merged products
    const { rows: prods } = await client.query(
      `SELECT id, name, price::float8 price, cost_price::float8 cost, stock FROM products
       WHERE barcode IN ('4800024562616','480009124818','480011100166') ORDER BY id FOR UPDATE`);
    console.log('cart products:', prods.map((p) => `${p.name} x2`).join(', '));

    let sub = 0, cost = 0;
    const qty = 2;
    for (const p of prods) { sub += cents(p.price) * qty; cost += cents(p.cost) * qty; }
    const vat = Math.round((sub * VAT_PERCENT) / (100 + VAT_PERCENT));
    const txn = 'TXN-SMOKE-TEST-ONLY';
    const clientSaleId = 'smoke_test_client_0001';

    const { rows: [sale] } = await client.query(
      `INSERT INTO sales (transaction_id, client_sale_id, total_amount, total_cost, profit, discount, tax,
                          amount_tendered, change_amount, payment_method, cashier)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id, transaction_id, total_amount, profit, tax`,
      [txn, clientSaleId, money(sub), money(cost), money(sub - cost), money(0), money(vat),
       money(sub), money(0), 'Cash', 'admin']);
    console.log('sale inserted  :', JSON.stringify(sale));

    for (const p of prods) {
      await client.query(
        'INSERT INTO sale_items (sale_id, product_id, product_name, quantity, price, subtotal) VALUES ($1,$2,$3,$4,$5,$6)',
        [sale.id, p.id, p.name, qty, p.price, money(cents(p.price) * qty)]);
      await client.query('UPDATE products SET stock = stock - $1, updated_at = now() WHERE id = $2', [qty, p.id]);
      await client.query(
        'INSERT INTO stock_movements (product_id, product_name, change_qty, reason, note) VALUES ($1,$2,$3,$4,$5)',
        [p.id, p.name, -qty, 'sale', txn]);
    }
    console.log('sale_items + stock decrements + movements: OK');

    const chk = await client.query(
      `SELECT (SELECT COUNT(*)::int FROM sale_items WHERE sale_id=$1) si,
              (SELECT COUNT(*)::int FROM stock_movements WHERE note=$2) mv,
              (SELECT string_agg(name || '=' || stock, ', ' ORDER BY id) FROM products WHERE id = ANY($3::int[])) stock`,
      [sale.id, txn, prods.map((p) => p.id)]);
    console.log('inside txn   :', JSON.stringify(chk.rows[0]));

    // the FK on sale_items.sale_id is ON DELETE CASCADE -> deleting the sale
    // must remove its items too (no orphans), not fail.
    const fk = await client.query(
      `SELECT confdeltype FROM pg_constraint
       WHERE conrelid='public.sale_items'::regclass AND contype='f' AND conname='sale_items_sale_id_fkey'`);
    console.log('FK delete rule  :', fk.rows[0] ? fk.rows[0].confdeltype : 'MISSING (c=cascade, r=restrict)');
    const del = await client.query('DELETE FROM sales WHERE id = $1 RETURNING id', [sale.id]);
    const orphan = await client.query('SELECT COUNT(*)::int c FROM sale_items WHERE sale_id = $1', [sale.id]);
    const cascadeOk = fk.rows[0] && fk.rows[0].confdeltype === 'c' && orphan.rows[0].c === 0;
    console.log('FK CHECK        :', cascadeOk
      ? 'OK - deleting the sale cascaded to its items, no orphans'
      : 'UNEXPECTED - deleted=' + del.rowCount + ' orphan_items=' + orphan.rows[0].c);

    await client.query('ROLLBACK');
    console.log('ROLLBACK');
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) { }
    console.error('FAILED', e.code || '', e.message);
    process.exit(1);
  } finally {
    client.release();
  }

  const after = (await db.query(
    `SELECT (SELECT COUNT(*)::int FROM products) p, (SELECT COUNT(*)::int FROM users) u,
            (SELECT COUNT(*)::int FROM stock_movements) m, (SELECT COUNT(*)::int FROM sales) s,
            (SELECT COUNT(*)::int FROM sale_items) si`
  )).rows[0];
  console.log('after :', JSON.stringify(after));
  const same = JSON.stringify(before) === JSON.stringify(after);
  console.log(same ? 'PASS - rollback left the database untouched' : 'FAIL - database changed!');
  process.exit(same ? 0 : 1);
})().catch((e) => { console.error('FAIL', e.code || '', e.message); process.exit(1); });
