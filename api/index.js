'use strict';
// One Express app serves every /api/* route (vercel.json rewrites /api/(.*) to this file).
const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('../lib/db');
const auth = require('../lib/auth');
const SCHEMA = require('../lib/schema');
const { tz, periodStats, chart7 } = require('../lib/stats');

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '200kb' }));

const api = express.Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const bad = (res, message, code = 400) => res.status(code).json({ error: message });

const VAT_PERCENT = 12; // prices are VAT-inclusive; the VAT part is stored in sales.tax
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

const DEMO_PRODUCTS = [
  ['480001111111', 'Bottled Water 500ml', 'Beverages', 8.0, 12.0, 100, 10],
  ['480002222222', 'Instant Noodles Beef', 'Noodles', 14.0, 22.0, 80, 10],
  ['480003333333', 'Choco Bar 40g', 'Snacks', 18.0, 28.0, 60, 8],
  ['480004444444', 'Canned Tuna 155g', 'Canned Goods', 28.0, 42.0, 50, 6],
  ['480005555555', 'Coffee Sachet 3-in-1', 'Beverages', 9.0, 15.0, 120, 15],
  ['480006666666', 'White Bread Loaf', 'Bakery', 45.0, 65.0, 30, 5],
  ['480007777777', 'Eggs (per pc)', 'Dairy', 6.0, 9.0, 200, 30],
  ['480008888888', 'Shampoo Sachet', 'Hygiene', 5.0, 10.0, 150, 20],
  ['480009999999', 'Detergent Bar', 'Household', 22.0, 35.0, 70, 10],
  ['480001010101', 'Potato Chips 55g', 'Snacks', 25.0, 38.0, 55, 8]
];

// ---------- helpers ----------
const text = (v, max) => {
  const s = String(v == null ? '' : v).trim();
  return s && s.length <= max ? s : null;
};
const number = (v, { min = 0, max = 1e9, int = false } = {}) => {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max || (int && !Number.isInteger(n))) return null;
  return n;
};
const cents = (n) => Math.round(n * 100);
const money = (c) => (c / 100).toFixed(2);
const likePattern = (s) => '%' + s.replace(/[\\%_]/g, '\\$&') + '%';
const PRODUCT_COLS = `id, barcode, name, category, cost_price::float8 AS cost_price, price::float8 AS price, stock, low_stock_threshold`;

// Writes must be JSON (a plain cross-site HTML form cannot send this), which blocks CSRF.
api.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD' && !req.is('application/json')) {
    return bad(res, 'Content-Type must be application/json.', 415);
  }
  next();
});

// ---------- setup & auth ----------
api.get('/status', wrap(async (req, res) => {
  if (!(process.env.DATABASE_URL || process.env.POSTGRES_URL)) {
    return res.json({ configured: false, installed: false });
  }
  const authSecret = !!process.env.AUTH_SECRET && process.env.AUTH_SECRET.length >= 16;
  try {
    const { rows: [r] } = await db.query('SELECT COUNT(*)::int AS n FROM users');
    res.json({ configured: true, authSecret, installed: r.n > 0 });
  } catch (e) {
    if (e.code === '42P01') return res.json({ configured: true, authSecret, installed: false });
    console.error(e);
    res.json({ configured: true, authSecret, installed: false, dbError: 'Could not reach the database. Check DATABASE_URL.' });
  }
}));

api.post('/install', wrap(async (req, res) => {
  const username = text(req.body.username, 50);
  const password = String(req.body.password || '');
  if (!username) return bad(res, 'Choose an admin username (up to 50 characters).');
  if (password.length < 8 || password.length > 72) return bad(res, 'Password must be 8 to 72 characters.');

  await db.exec(SCHEMA);
  const { rows: [c] } = await db.query('SELECT COUNT(*)::int AS n FROM users');
  if (c.n > 0) return bad(res, 'Already installed. Sign in instead.', 403);

  await db.query('INSERT INTO users (username, password) VALUES ($1, $2)', [username, await bcrypt.hash(password, 10)]);

  let seeded = 0;
  if (req.body.seed) {
    const { rows: [p] } = await db.query('SELECT COUNT(*)::int AS n FROM products');
    if (p.n === 0) {
      for (const d of DEMO_PRODUCTS) {
        await db.query(
          'INSERT INTO products (barcode, name, category, cost_price, price, stock, low_stock_threshold) VALUES ($1,$2,$3,$4,$5,$6,$7)',
          d
        );
      }
      seeded = DEMO_PRODUCTS.length;
    }
  }
  res.json({ ok: true, seeded });
}));

api.post('/login', wrap(async (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  if (!username || !password) return bad(res, 'Please enter your username and password.');

  const { rows: [u] } = await db.query('SELECT id, username, password FROM users WHERE username = $1', [username]);
  const ok = u ? await bcrypt.compare(password, u.password) : (await bcrypt.compare(password, DUMMY_HASH), false);
  if (!ok) {
    await new Promise((r) => setTimeout(r, 400));
    return bad(res, 'Invalid username or password.', 401);
  }
  auth.setSession(res, u);
  res.json({ username: u.username });
}));

api.post('/logout', (req, res) => {
  auth.clearSession(res);
  res.json({ ok: true });
});

api.get('/me', auth.requireAuth, (req, res) => {
  res.json({ username: req.user.username, store: process.env.STORE_NAME || 'SmartMart' });
});

// Everything below needs a signed-in user.
api.use(auth.requireAuth);

// ---------- dashboard ----------
api.get('/dashboard', wrap(async (req, res) => {
  const [stats, chart, inv, low, lowCount, recent, top, cats] = await Promise.all([
    periodStats(),
    chart7(),
    db.query(`SELECT COUNT(*)::int AS skus, COALESCE(SUM(stock),0)::int AS units, COALESCE(SUM(stock*price),0)::float8 AS value_amt FROM products`),
    db.query(`SELECT id, barcode, name, category, stock, low_stock_threshold FROM products WHERE stock <= low_stock_threshold ORDER BY stock ASC, name ASC LIMIT 8`),
    db.query(`SELECT COUNT(*)::int AS n FROM products WHERE stock <= low_stock_threshold`),
    db.query(`SELECT id, transaction_id, total_amount::float8 AS total_amount, profit::float8 AS profit, payment_method, sale_date FROM sales ORDER BY sale_date DESC LIMIT 8`),
    db.query(`SELECT product_name, SUM(quantity)::int AS qty, SUM(subtotal)::float8 AS amt FROM sale_items GROUP BY product_name ORDER BY qty DESC LIMIT 5`),
    db.query(`SELECT category, SUM(stock)::int AS units FROM products GROUP BY category ORDER BY units DESC LIMIT 6`)
  ]);
  res.json({
    stats,
    chart,
    inventory: inv.rows[0],
    low: low.rows,
    lowCount: lowCount.rows[0].n,
    recent: recent.rows,
    top: top.rows,
    categories: cats.rows,
    user: req.user.username
  });
}));

// ---------- products ----------
api.get('/products', wrap(async (req, res) => {
  const q = text(req.query.q, 100);
  const status = String(req.query.status || '');
  const where = [];
  const params = [];
  if (q) {
    params.push(likePattern(q));
    where.push(`(name ILIKE $${params.length} OR barcode ILIKE $${params.length} OR category ILIKE $${params.length})`);
  }
  if (status === 'low') where.push('stock <= low_stock_threshold');
  if (status === 'out') where.push('stock <= 0');
  const { rows } = await db.query(
    `SELECT ${PRODUCT_COLS} FROM products ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY name ASC LIMIT 1000`,
    params
  );
  res.json({ products: rows });
}));

api.get('/products/:id', wrap(async (req, res) => {
  const id = number(req.params.id, { min: 1, int: true });
  if (!id) return bad(res, 'Product not found.', 404);
  const { rows: [p] } = await db.query(`SELECT ${PRODUCT_COLS} FROM products WHERE id = $1`, [id]);
  if (!p) return bad(res, 'Product not found.', 404);
  res.json({ product: p });
}));

// Add a product, or restock an existing barcode (stock is added to what is on hand).
api.post('/products', wrap(async (req, res) => {
  const b = req.body;
  const barcode = text(b.barcode, 64);
  const name = text(b.name, 150);
  const category = text(b.category, 60) || 'General';
  const cost = number(b.cost_price, { max: 1e7 });
  const price = number(b.price, { max: 1e7 });
  const stock = number(b.stock, { max: 1e6, int: true });
  const threshold = number(b.low_stock_threshold, { max: 1e6, int: true });
  if (!barcode || !name) return bad(res, 'Barcode and item name are required.');
  if (cost === null || price === null) return bad(res, 'Enter valid cost and selling prices.');
  if (stock === null || threshold === null) return bad(res, 'Stock and threshold must be whole numbers, 0 or more.');

  const { rows: [r] } = await db.query(
    `INSERT INTO products (barcode, name, category, cost_price, price, stock, low_stock_threshold)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (barcode) DO UPDATE SET
       name = EXCLUDED.name, category = EXCLUDED.category, cost_price = EXCLUDED.cost_price, price = EXCLUDED.price,
       stock = products.stock + EXCLUDED.stock, low_stock_threshold = EXCLUDED.low_stock_threshold, updated_at = now()
     RETURNING id, (xmax = 0) AS inserted`,
    [barcode, name, category, cost, price, stock, threshold]
  );
  if (stock !== 0) {
    await db.query(
      'INSERT INTO stock_movements (product_id, product_name, change_qty, reason, note) VALUES ($1,$2,$3,$4,$5)',
      [r.id, name, stock, r.inserted ? 'initial' : 'restock', 'Added from Products page']
    );
  }
  res.json({ ok: true, id: r.id, created: r.inserted });
}));

api.put('/products/:id', wrap(async (req, res) => {
  const id = number(req.params.id, { min: 1, int: true });
  const b = req.body;
  const name = text(b.name, 150);
  const category = text(b.category, 60);
  const price = number(b.price, { max: 1e7 });
  const cost = b.cost_price === undefined ? undefined : number(b.cost_price, { max: 1e7 });
  const stock = number(b.stock, { max: 1e6, int: true });
  const threshold = number(b.low_stock_threshold, { max: 1e6, int: true });
  if (!id) return bad(res, 'Product not found.', 404);
  if (!name) return bad(res, 'Product name is required.');
  if (price === null) return bad(res, 'Enter a valid price.');
  if (cost === null) return bad(res, 'Enter a valid cost price.');
  if (stock === null || threshold === null) return bad(res, 'Stock and threshold must be whole numbers, 0 or more.');

  const found = await db.tx(async (c) => {
    const { rows: [old] } = await c.query('SELECT stock, cost_price::float8 AS cost_price, category FROM products WHERE id = $1 FOR UPDATE', [id]);
    if (!old) return false;
    await c.query(
      `UPDATE products SET name=$1, price=$2, stock=$3, low_stock_threshold=$4, cost_price=$5, category=$6, updated_at=now() WHERE id=$7`,
      [name, price, stock, threshold, cost === undefined ? old.cost_price : cost, category || old.category, id]
    );
    if (stock !== old.stock) {
      await c.query(
        'INSERT INTO stock_movements (product_id, product_name, change_qty, reason, note) VALUES ($1,$2,$3,$4,$5)',
        [id, name, stock - old.stock, 'adjust', 'Edited on Edit Product page']
      );
    }
    return true;
  });
  if (!found) return bad(res, 'Product not found.', 404);
  res.json({ ok: true });
}));

// Barcode lookup used by the POS scanner box.
api.get('/lookup', wrap(async (req, res) => {
  const code = text(req.query.code, 64);
  if (!code) return bad(res, 'Enter a barcode.');
  const { rows: [p] } = await db.query(`SELECT ${PRODUCT_COLS} FROM products WHERE barcode = $1`, [code]);
  if (!p) return bad(res, 'No product with barcode ' + code + '.', 404);
  if (p.stock <= 0) return bad(res, p.name + ' is out of stock.', 409);
  res.json({ product: p });
}));

// ---------- checkout ----------
// Prices and costs come from the database, never from the browser.
api.post('/checkout', wrap(async (req, res) => {
  const b = req.body;
  const raw = Array.isArray(b.items) ? b.items : [];
  if (!raw.length || raw.length > 100) return bad(res, 'The cart is empty.');
  const qtyById = new Map();
  for (const it of raw) {
    const id = number(it && it.id, { min: 1, int: true });
    const qty = number(it && it.qty, { min: 1, max: 1000, int: true });
    if (!id || !qty) return bad(res, 'The cart has an invalid item.');
    qtyById.set(id, (qtyById.get(id) || 0) + qty);
  }
  const method = 'Cash';

  const result = await db.tx(async (c) => {
    const ids = [...qtyById.keys()];
    const { rows } = await c.query(
      'SELECT id, name, price::float8 AS price, cost_price::float8 AS cost, stock FROM products WHERE id = ANY($1::int[]) ORDER BY id FOR UPDATE',
      [ids]
    );
    if (rows.length !== ids.length) return { error: 'An item in the cart no longer exists.' };

    let sub = 0;
    let cost = 0;
    for (const p of rows) {
      const qty = qtyById.get(p.id);
      if (p.stock < qty) return { error: `Only ${p.stock} of ${p.name} left in stock.` };
      sub += cents(p.price) * qty;
      cost += cents(p.cost) * qty;
    }
    const total = sub;
    const profit = total - cost;
    const vat = Math.round((total * VAT_PERCENT) / (100 + VAT_PERCENT));

    const given = number(b.amount_tendered, { max: 1e9 });
    if (given === null || cents(given) < total) return { error: 'Cash received is less than the total.' };
    const tendered = cents(given);

    const txn = 'TXN-' + Date.now().toString(36).toUpperCase() + crypto.randomBytes(2).toString('hex').toUpperCase();
    const { rows: [sale] } = await c.query(
      `INSERT INTO sales (transaction_id, total_amount, total_cost, profit, discount, tax, amount_tendered, change_amount, payment_method, cashier)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [txn, money(total), money(cost), money(profit), money(0), money(vat), money(tendered), money(tendered - total), method, req.user.username]
    );
    for (const p of rows) {
      const qty = qtyById.get(p.id);
      await c.query(
        'INSERT INTO sale_items (sale_id, product_id, product_name, quantity, price, subtotal) VALUES ($1,$2,$3,$4,$5,$6)',
        [sale.id, p.id, p.name, qty, p.price, money(cents(p.price) * qty)]
      );
      await c.query('UPDATE products SET stock = stock - $1, updated_at = now() WHERE id = $2', [qty, p.id]);
      await c.query(
        'INSERT INTO stock_movements (product_id, product_name, change_qty, reason, note) VALUES ($1,$2,$3,$4,$5)',
        [p.id, p.name, -qty, 'sale', txn]
      );
    }
    return { id: sale.id, transaction_id: txn };
  });

  if (result.error) return bad(res, result.error, 409);
  res.json(result);
}));

// ---------- sales, receipts, reports ----------
// Shared filter: optional date (YYYY-MM-DD, store time zone) and text search on transaction id or item name.
function salesFilter(query) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(query.date || '')) ? query.date : null;
  const search = text(query.search, 100);
  return {
    clause: `($1::date IS NULL OR (s.sale_date AT TIME ZONE $3)::date = $1::date)
             AND ($2::text IS NULL OR s.transaction_id ILIKE $2
                  OR EXISTS (SELECT 1 FROM sale_items si WHERE si.sale_id = s.id AND si.product_name ILIKE $2))`,
    params: [date, search ? likePattern(search) : null, tz()]
  };
}

api.get('/report', wrap(async (req, res) => {
  const f = salesFilter(req.query);
  const [stats, chart, best, sales] = await Promise.all([
    periodStats(),
    chart7(),
    db.query(`SELECT product_name, SUM(quantity)::int AS total_qty FROM sale_items GROUP BY product_name ORDER BY total_qty DESC LIMIT 1`),
    db.query(
      `SELECT s.id, s.transaction_id, s.sale_date, s.total_amount::float8 AS total_amount, s.profit::float8 AS profit, s.payment_method
       FROM sales s WHERE ${f.clause} ORDER BY s.sale_date DESC LIMIT 500`,
      f.params
    )
  ]);
  res.json({ stats, chart, best: best.rows[0] || null, sales: sales.rows });
}));

api.get('/sales/:id', wrap(async (req, res) => {
  const id = number(req.params.id, { min: 1, int: true });
  if (!id) return bad(res, 'Receipt not found.', 404);
  const { rows: [sale] } = await db.query(
    `SELECT id, transaction_id, total_amount::float8 AS total_amount, total_cost::float8 AS total_cost, profit::float8 AS profit,
            discount::float8 AS discount, tax::float8 AS tax, amount_tendered::float8 AS amount_tendered,
            change_amount::float8 AS change_amount, payment_method, cashier, sale_date
     FROM sales WHERE id = $1`,
    [id]
  );
  if (!sale) return bad(res, 'Receipt not found.', 404);
  const { rows: items } = await db.query(
    'SELECT product_name, quantity, price::float8 AS price, subtotal::float8 AS subtotal FROM sale_items WHERE sale_id = $1 ORDER BY id',
    [id]
  );
  res.json({ sale, items, store: process.env.STORE_NAME || 'SmartMart' });
}));

// CSV of every sold line (honors the same date/search filters as the report).
const csvCell = (v) => {
  let s = v instanceof Date ? v.toISOString() : String(v == null ? '' : v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // stop spreadsheet formula injection
  return '"' + s.replace(/"/g, '""') + '"';
};

api.get('/export-sales', wrap(async (req, res) => {
  const f = salesFilter(req.query);
  const { rows } = await db.query(
    `SELECT s.transaction_id, s.sale_date, si.product_name, si.quantity, si.price::float8 AS price, si.subtotal::float8 AS subtotal
     FROM sales s JOIN sale_items si ON si.sale_id = s.id
     WHERE ${f.clause} ORDER BY s.id DESC, si.id ASC`,
    f.params
  );
  const head = ['Transaction No', 'Sale Date', 'Item Name', 'Quantity', 'Unit Price', 'Subtotal'];
  const lines = [head.map(csvCell).join(',')];
  for (const r of rows) {
    lines.push([r.transaction_id, r.sale_date, r.product_name, r.quantity, r.price.toFixed(2), r.subtotal.toFixed(2)].map(csvCell).join(','));
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="sales_report_${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send('﻿' + lines.join('\r\n') + '\r\n');
}));

api.use((req, res) => bad(res, 'Not found.', 404));

app.use('/api', api);

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return bad(res, 'Invalid JSON in request.');
  if (err.code === '23505') return bad(res, 'That value already exists.', 409);
  console.error(err);
  res.status(500).json({ error: err.expose ? err.message : 'Server error. Check the function logs in Vercel.' });
});

module.exports = app;
