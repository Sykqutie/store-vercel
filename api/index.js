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
// 12mb: backup restores upload a full JSON backup in the request body.
// Ordinary POS payloads are a few KB; backup size is capped separately in lib/backup.js.
app.use(express.json({ limit: '12mb' }));
const backup = require('../lib/backup');

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
// Cashiers get POS only — no inventory management. Cost, thresholds and
// margins are owner data, so they are stripped from every product/sale
// payload a cashier can read. Stock stays (the POS needs it to block
// oversells) but the POS UI no longer shows exact numbers to cashiers.
const isCashier = (req) => req.user && req.user.role === 'cashier';
const publicProduct = (req, p) => {
  if (!p || !isCashier(req)) return p;
  const { cost_price, low_stock_threshold, ...rest } = p;
  return rest;
};

// Offline-sync migration: idempotency key for sales queued while offline.
// Fresh installs get it from schema.sql; existing databases get it here.
// Safe to run repeatedly (IF NOT EXISTS). No secrets involved.
let offlineMigration = null;
function ensureOfflineColumns() {
  if (!offlineMigration) {
    offlineMigration = (async () => {
      try {
        await db.query('ALTER TABLE sales ADD COLUMN IF NOT EXISTS client_sale_id VARCHAR(64)');
        await db.query('CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_client_sale_id ON sales (client_sale_id)');
      } catch (e) {
        // Table may not exist yet (pre-install). The installer retries after creating tables.
        console.error('offline migration deferred:', e.message);
        offlineMigration = null;
      }
    })();
  }
  return offlineMigration;
}
ensureOfflineColumns();

// Account columns for role-based access: role ('owner' | 'cashier') and
// active flag (deactivation kicks in on the next request — no token store).
// Safe to run repeatedly. Normalizes the earlier 'admin' default to 'owner'.
let accountMigration = null;
function ensureAccountColumns() {
  if (!accountMigration) {
    accountMigration = (async () => {
      try {
        await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(20) NOT NULL DEFAULT 'owner'`);
        await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE`);
        await db.query(`UPDATE users SET role = 'owner' WHERE role = 'admin'`);
      } catch (e) {
        // Table may not exist yet (pre-install). The installer retries after creating tables.
        console.error('account migration deferred:', e.message);
        accountMigration = null;
      }
    })();
  }
  return accountMigration;
}
ensureAccountColumns();

// Session + fresh account state (role / active) from the database.
// Replaces the stateless requireAuth below so deactivation and role changes
// apply immediately, without leaking which check failed to logged-out users.
async function loadAccount(req, res, next) {
  const sess = auth.currentUser(req);
  if (!sess) return res.status(401).json({ error: 'Please sign in.' });
  try {
    const { rows: [u] } = await db.query('SELECT id, username, role, active FROM users WHERE id = $1', [sess.uid]);
    if (!u || u.active === false) {
      return res.status(401).json({ error: 'This account is deactivated. Please sign in.' });
    }
    req.user = { uid: u.id, username: u.username, role: u.role === 'cashier' ? 'cashier' : 'owner' };
    next();
  } catch (e) {
    if (e.code === '42703') {
      // Pre-migration database: add the columns once, then retry the request.
      await ensureAccountColumns();
      try {
        const { rows: [u] } = await db.query('SELECT id, username, role, active FROM users WHERE id = $1', [sess.uid]);
        if (!u || u.active === false) return res.status(401).json({ error: 'This account is deactivated. Please sign in.' });
        req.user = { uid: u.id, username: u.username, role: u.role === 'cashier' ? 'cashier' : 'owner' };
        return next();
      } catch (e2) { return next(e2); }
    }
    next(e);
  }
}

// Owner-only pages and actions. Cashiers get 403 (never a redirect; the
// frontend shows its own "restricted area" page for direct URL access).
function requireOwner(req, res, next) {
  if (req.user && req.user.role === 'owner') return next();
  return res.status(403).json({ error: 'Owner access required.' });
}

// Writes must be JSON (a plain cross-site HTML form cannot send this), which blocks CSRF.
api.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD' && !req.is('application/json')) {
    return bad(res, 'Content-Type must be application/json.', 415);
  }
  next();
});

// ---------- setup & auth ----------
api.get('/status', wrap(async (req, res) => {
  const hasDb = !!db.connectionString();
  const env = typeof db.envPresence === 'function' ? db.envPresence() : {
    DATABASE_URL: !!process.env.DATABASE_URL,
    POSTGRES_URL: !!process.env.POSTGRES_URL
  };
  if (!hasDb) {
    return res.json({ configured: false, installed: false, env });
  }
  const authSecret = !!process.env.AUTH_SECRET && process.env.AUTH_SECRET.length >= 16;
  // Hostname only (no credentials) — lets the owner spot a typo/placeholder
  // like "host" without ever exposing user, password, or database name.
  const dbHost = typeof db.publicHost === 'function' ? db.publicHost() : null;
  try {
    const { rows: [r] } = await db.query('SELECT COUNT(*)::int AS n FROM users');
    res.json({ configured: true, authSecret, installed: r.n > 0, env, dbHost });
  } catch (e) {
    if (e.code === '42P01') return res.json({ configured: true, authSecret, installed: false, env, dbHost });
    console.error(e);
    // Safe, specific hint: error codes + hostname only, never the URL, password, or db name.
    const code = String(e.code || '');
    let dbError = 'Could not reach the database. Check DATABASE_URL.';
    if (code === '28P01') dbError = 'Database login failed (wrong user/password in DATABASE_URL). Copy a fresh pooled connection string from Neon/Supabase and update the Vercel env var, then redeploy.';
    else if (code === '3D000') dbError = 'Database name in DATABASE_URL does not exist. Check the dbname part of the URL.';
    else if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') dbError = 'Database host not found (DNS)' + (dbHost ? ' — the app sees host "' + dbHost + '".' : '.') + ' Copy the pooled connection string again from your Neon project (Neon pooled hosts contain "-pooler").';
    else if (code === 'ECONNREFUSED') dbError = 'Database refused the connection. Wrong host/port, or the Neon compute is paused — open the Neon console once to resume, then retry /api/status.';
    else if (code === 'ETIMEDOUT' || /timeout/i.test(e.message || '')) dbError = 'Database connection timed out (cold start or wrong region/host). Retry /api/status once — Neon free-tier wake-up can exceed the first attempt — and confirm the pooled URL + function region near the DB.';
    else if (/password.*must.*be.*url-encoded|SASL|SCRAM/i.test(e.message || '')) dbError = 'Database password looks mis-encoded. Percent-encode @ / : # ? & in the password part of DATABASE_URL.';
    res.json({ configured: true, authSecret, installed: false, env, dbHost, dbError, dbCode: code || undefined });
  }
}));

api.post('/install', wrap(async (req, res) => {
  const username = text(req.body.username, 50);
  const password = String(req.body.password || '');
  if (!username) return bad(res, 'Choose an admin username (up to 50 characters).');
  if (password.length < 8 || password.length > 72) return bad(res, 'Password must be 8 to 72 characters.');

  await db.exec(SCHEMA);
  await ensureOfflineColumns();
  await ensureAccountColumns();
  const { rows: [c] } = await db.query('SELECT COUNT(*)::int AS n FROM users');
  if (c.n > 0) return bad(res, 'Already installed. Sign in instead.', 403);

  await db.query(`INSERT INTO users (username, password, role, active)
                  VALUES ($1, $2, 'owner', TRUE)`, [username, await bcrypt.hash(password, 10)]);

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

  const { rows: [u] } = await db.query('SELECT id, username, password, role, active FROM users WHERE username = $1', [username]);
  const ok = u ? await bcrypt.compare(password, u.password) : (await bcrypt.compare(password, DUMMY_HASH), false);
  if (!ok) {
    await new Promise((r) => setTimeout(r, 400));
    return bad(res, 'Invalid username or password.', 401);
  }
  if (u.active === false) return bad(res, 'This account is deactivated. Ask the store owner.', 403);
  auth.setSession(res, u);
  res.json({ username: u.username, role: u.role === 'cashier' ? 'cashier' : 'owner' });
}));

api.post('/logout', (req, res) => {
  auth.clearSession(res);
  res.json({ ok: true });
});

api.get('/me', loadAccount, wrap(async (req, res) => {
  res.json({ username: req.user.username, role: req.user.role, store: process.env.STORE_NAME || 'SmartMart' });
}));

// Self-service: the signed-in user (owner or cashier) can change their OWN
// username and/or password. Current password is always required, so a
// walk-away session alone is not enough to take over the account.
api.put('/me', loadAccount, wrap(async (req, res) => {
  const b = req.body || {};
  const hasUsername = b.new_username !== undefined && b.new_username !== null && String(b.new_username) !== '';
  const hasPassword = b.new_password !== undefined && b.new_password !== null && String(b.new_password) !== '';
  if (!hasUsername && !hasPassword) return bad(res, 'Nothing to update.');
  const newUsername = hasUsername ? text(b.new_username, 50) : null;
  if (hasUsername && (!newUsername || newUsername.length < 3)) {
    return bad(res, 'Username must be 3 to 50 characters.');
  }
  const newPassword = hasPassword ? String(b.new_password) : null;
  if (hasPassword && (newPassword.length < 8 || newPassword.length > 72)) {
    return bad(res, 'New password must be 8 to 72 characters.');
  }
  const currentPassword = String(b.current_password || '');
  if (!currentPassword) return bad(res, 'Enter your current password to confirm changes.');

  const { rows: [u] } = await db.query('SELECT id, username, password FROM users WHERE id = $1', [req.user.uid]);
  if (!u) return bad(res, 'Please sign in.', 401);
  const ok = await bcrypt.compare(currentPassword, u.password);
  if (!ok) {
    await new Promise((r) => setTimeout(r, 400));
    return bad(res, 'Current password is incorrect.', 401);
  }
  try {
    const { rows: [updated] } = await db.query(
      `UPDATE users SET username = COALESCE($1, username), password = COALESCE($2, password) WHERE id = $3
       RETURNING username, role`,
      [newUsername || null, newPassword ? await bcrypt.hash(newPassword, 10) : null, req.user.uid]
    );
    res.json({ user: { username: updated.username, role: updated.role === 'cashier' ? 'cashier' : 'owner' } });
  } catch (e) {
    if (e.code === '23505') return bad(res, 'That username is already taken.', 409);
    throw e;
  }
}));

// ---------- user management (owner only) ----------
// Lists cashier accounts (never passwords).
api.get('/users', loadAccount, requireOwner, wrap(async (req, res) => {
  const { rows } = await db.query(
    `SELECT id, username, role, active, created_at FROM users WHERE role = 'cashier' ORDER BY username ASC`
  );
  res.json({ users: rows });
}));

// Creates a cashier account. Only the 'cashier' role can be created here;
// owner accounts come from the installer.
api.post('/users', loadAccount, requireOwner, wrap(async (req, res) => {
  const username = text(req.body.username, 50);
  const password = String(req.body.password || '');
  if (!username || username.length < 3) return bad(res, 'Cashier username must be 3 to 50 characters.');
  if (password.length < 8 || password.length > 72) return bad(res, 'Password must be 8 to 72 characters.');
  try {
    const { rows: [u] } = await db.query(
      `INSERT INTO users (username, password, role, active) VALUES ($1, $2, 'cashier', TRUE)
       RETURNING id, username, role, active, created_at`,
      [username, await bcrypt.hash(password, 10)]
    );
    res.json({ user: u });
  } catch (e) {
    if (e.code === '23505') return bad(res, 'That username is already taken.', 409);
    throw e;
  }
}));

// Edits a cashier: activate/deactivate and/or reset password.
// Owners (including self) can never be modified here.
api.put('/users/:id', loadAccount, requireOwner, wrap(async (req, res) => {
  const id = number(req.params.id, { min: 1, int: true });
  if (!id) return bad(res, 'Account not found.', 404);
  if (id === req.user.uid) return bad(res, 'You cannot change your own account here.', 403);
  const { rows: [target] } = await db.query('SELECT id, role FROM users WHERE id = $1', [id]);
  if (!target) return bad(res, 'Account not found.', 404);
  if (target.role !== 'cashier') return bad(res, 'Only cashier accounts can be managed here.', 403);

  const updates = [];
  const params = [];
  if (req.body.active !== undefined) {
    updates.push(`active = $${updates.length + 1}`);
    params.push(!!req.body.active);
  }
  const pw = req.body.password === undefined || req.body.password === null || req.body.password === ''
    ? null : String(req.body.password);
  if (pw !== null) {
    if (pw.length < 8 || pw.length > 72) return bad(res, 'New password must be 8 to 72 characters.');
    updates.push(`password = $${updates.length + 1}`);
    params.push(await bcrypt.hash(pw, 10));
  }
  if (!updates.length) return bad(res, 'Nothing to update.');
  params.push(id);
  const { rows: [u] } = await db.query(
    `UPDATE users SET ${updates.join(', ')} WHERE id = $${params.length}
     RETURNING id, username, role, active, created_at`,
    params
  );
  res.json({ user: u });
}));

// Everything below needs a signed-in user with a live account.
api.use(loadAccount);

// ---------- dashboard (owner only) ----------
api.get('/dashboard', loadAccount, requireOwner, wrap(async (req, res) => {
  const [stats, chart, inv, low, lowCount, outCount, todayItems, recent, top, cats] = await Promise.all([
    periodStats(),
    chart7(),
    db.query(`SELECT COUNT(*)::int AS skus, COALESCE(SUM(stock),0)::int AS units, COALESCE(SUM(stock*price),0)::float8 AS value_amt FROM products`),
    db.query(`SELECT id, barcode, name, category, stock, low_stock_threshold FROM products WHERE stock <= low_stock_threshold ORDER BY stock ASC, name ASC LIMIT 8`),
    db.query(`SELECT COUNT(*)::int AS n FROM products WHERE stock <= low_stock_threshold`),
    db.query(`SELECT COUNT(*)::int AS n FROM products WHERE stock <= 0`),
    db.query(`SELECT COALESCE(SUM(si.quantity),0)::int AS items FROM sale_items si JOIN sales s ON s.id = si.sale_id WHERE (s.sale_date AT TIME ZONE $1)::date = (now() AT TIME ZONE $1)::date`, [tz()]),
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
    outCount: outCount.rows[0].n,
    todayItems: todayItems.rows[0].items,
    recent: recent.rows,
    top: top.rows,
    categories: cats.rows,
    user: req.user.username
  });
}));

// ---------- stock alerts (owner only) ----------
// Lightweight low-stock / out-of-stock feed for the header notification bell.
// Same rules as everywhere else: OUT = stock <= 0, LOW = 0 < stock <= threshold.
api.get('/alerts/low-stock', loadAccount, requireOwner, wrap(async (req, res) => {
  const LIMIT = 100; // dropdown-sized lists; counts always reflect the full totals
  const [counts, out, low] = await Promise.all([
    db.query(`SELECT COUNT(*) FILTER (WHERE stock <= 0)::int AS out_count,
                     COUNT(*) FILTER (WHERE stock > 0 AND stock <= low_stock_threshold)::int AS low_count,
                     COUNT(*) FILTER (WHERE stock <= low_stock_threshold)::int AS total
              FROM products`),
    db.query(`SELECT id, barcode, name, category, stock, low_stock_threshold
              FROM products WHERE stock <= 0 ORDER BY name ASC LIMIT ${LIMIT}`),
    db.query(`SELECT id, barcode, name, category, stock, low_stock_threshold
              FROM products WHERE stock > 0 AND stock <= low_stock_threshold
              ORDER BY stock ASC, name ASC LIMIT ${LIMIT}`)
  ]);
  const shape = (p, status) => ({
    id: p.id,
    barcode: p.barcode,
    name: p.name,
    category: p.category,
    stock: p.stock,
    low_stock_threshold: p.low_stock_threshold,
    status,
    // No supplier columns exist in the schema; kept nullable so the UI can
    // show them automatically if they are ever added.
    supplier_name: p.supplier_name || null,
    supplier_contact: p.supplier_contact || null
  });
  const c = counts.rows[0];
  res.json({
    counts: { out: c.out_count, low: c.low_count, total: c.total },
    out_of_stock: out.rows.map((p) => shape(p, 'OUT OF STOCK')),
    low_stock: low.rows.map((p) => shape(p, 'LOW STOCK')),
    truncated: out.rows.length === LIMIT || low.rows.length === LIMIT
  });
}));

// ---------- products ----------
// Cashiers may read the catalog (the POS needs it) but never manage it.
// Cost price and low-stock thresholds are stripped for cashiers (see
// publicProduct) — POS-only, no inventory data.
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
  res.json({ products: rows.map((p) => publicProduct(req, p)) });
}));

api.get('/products/:id', wrap(async (req, res) => {
  const id = number(req.params.id, { min: 1, int: true });
  if (!id) return bad(res, 'Product not found.', 404);
  const { rows: [p] } = await db.query(`SELECT ${PRODUCT_COLS} FROM products WHERE id = $1`, [id]);
  if (!p) return bad(res, 'Product not found.', 404);
  res.json({ product: publicProduct(req, p) });
}));

// Add a product, or restock an existing barcode (owner only; stock is added to what is on hand).
api.post('/products', loadAccount, requireOwner, wrap(async (req, res) => {
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

api.put('/products/:id', loadAccount, requireOwner, wrap(async (req, res) => {
  const id = number(req.params.id, { min: 1, int: true });
  const b = req.body;
  const name = text(b.name, 150);
  const category = text(b.category, 60);
  const price = number(b.price, { max: 1e7 });
  const cost = b.cost_price === undefined ? undefined : number(b.cost_price, { max: 1e7 });
  const stock = number(b.stock, { max: 1e6, int: true });
  const threshold = number(b.low_stock_threshold, { max: 1e6, int: true });
  // Optional conflict guard for offline-queued edits: the stock the editor saw.
  const baseStock = (b.base_stock === undefined || b.base_stock === null || b.base_stock === '') ? undefined : number(b.base_stock, { max: 1e6, int: true });
  if (!id) return bad(res, 'Product not found.', 404);
  if (!name) return bad(res, 'Product name is required.');
  if (price === null) return bad(res, 'Enter a valid price.');
  if (cost === null) return bad(res, 'Enter a valid cost price.');
  if (stock === null || threshold === null) return bad(res, 'Stock and threshold must be whole numbers, 0 or more.');
  if (b.base_stock !== undefined && b.base_stock !== null && b.base_stock !== '' && baseStock === null) {
    return bad(res, 'Base stock is invalid.');
  }

  const found = await db.tx(async (c) => {
    const { rows: [old] } = await c.query('SELECT stock, cost_price::float8 AS cost_price, category FROM products WHERE id = $1 FOR UPDATE', [id]);
    if (!old) return false;
    if (baseStock !== undefined && old.stock !== baseStock) {
      return { conflict: true, current_stock: old.stock };
    }
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
  if (found.conflict) {
    return res.status(409).json({
      error: `Inventory changed on the server (now ${found.current_stock} in stock). Refresh and retry your edit.`,
      current_stock: found.current_stock
    });
  }
  res.json({ ok: true });
}));

// Delete a product (owner only). Past sales keep their stored product_name, so history is safe.
api.delete('/products/:id', loadAccount, requireOwner, wrap(async (req, res) => {
  const id = number(req.params.id, { min: 1, int: true });
  if (!id) return bad(res, 'Product not found.', 404);
  const { rows: [p] } = await db.query('SELECT id, name FROM products WHERE id = $1', [id]);
  if (!p) return bad(res, 'Product not found.', 404);
  await db.query('DELETE FROM products WHERE id = $1', [id]);
  res.json({ ok: true, name: p.name });
}));

// Barcode lookup used by the POS scanner box (POS-only for cashiers;
// cost and thresholds are stripped — see publicProduct).
api.get('/lookup', wrap(async (req, res) => {
  const code = text(req.query.code, 64);
  if (!code) return bad(res, 'Enter a barcode.');
  const { rows: [p] } = await db.query(`SELECT ${PRODUCT_COLS} FROM products WHERE barcode = $1`, [code]);
  if (!p) return bad(res, 'No product with barcode ' + code + '.', 404);
  if (p.stock <= 0) return bad(res, p.name + ' is out of stock.', 409);
  res.json({ product: publicProduct(req, p) });
}));

// ---------- checkout ----------
// Prices and costs come from the database, never from the browser.
// Accepts an optional client_sale_id (offline idempotency key): retried
// syncs with the same key return the original sale instead of duplicating it.
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
  const clientSaleId = (() => {
    const s = String(b.client_sale_id || '').trim();
    return /^[A-Za-z0-9_-]{8,64}$/.test(s) ? s : null;
  })();

  // Fast path: this offline sale already synced (e.g. retried after a timeout).
  if (clientSaleId) {
    try {
      const { rows: [dup] } = await db.query('SELECT id, transaction_id FROM sales WHERE client_sale_id = $1', [clientSaleId]);
      if (dup) return res.json({ id: dup.id, transaction_id: dup.transaction_id, deduped: true });
    } catch (e) {
      if (e.code !== '42703') throw e; // 42703 = column missing on a pre-migration DB
      await ensureOfflineColumns();
    }
  }

  let result;
  try {
    result = await db.tx(async (c) => {
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
        `INSERT INTO sales (transaction_id, client_sale_id, total_amount, total_cost, profit, discount, tax, amount_tendered, change_amount, payment_method, cashier)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
        [txn, clientSaleId, money(total), money(cost), money(profit), money(0), money(vat), money(tendered), money(tendered - total), method, req.user.username]
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
  } catch (e) {
    // Race: two syncs with the same key — return the winner instead of duplicating.
    // Missing column on a pre-migration DB: migrate once, then ask the client to retry
    // (the idempotency key makes the retry safe).
    if (e.code === '23505' && clientSaleId) {
      try {
        const { rows: [dup] } = await db.query('SELECT id, transaction_id FROM sales WHERE client_sale_id = $1', [clientSaleId]);
        if (dup) return res.json({ id: dup.id, transaction_id: dup.transaction_id, deduped: true });
      } catch (_) { /* fall through */ }
    }
    if (e.code === '42703') {
      await ensureOfflineColumns();
      return bad(res, 'Database was just migrated for offline sync. Please retry this sale (it is safe — duplicates are blocked).', 409);
    }
    throw e;
  }

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

api.get('/report', loadAccount, requireOwner, wrap(async (req, res) => {
  const f = salesFilter(req.query);
  const period = ['today', 'week', 'month'].includes(String(req.query.period || '')) ? req.query.period : 'all';
  // Reuses $3 (store time zone) from salesFilter — no extra params needed.
  const periodClause = period === 'today'
    ? `(s.sale_date AT TIME ZONE $3)::date = (now() AT TIME ZONE $3)::date`
    : period === 'week'
      ? `date_trunc('week', s.sale_date AT TIME ZONE $3) = date_trunc('week', now() AT TIME ZONE $3)`
      : period === 'month'
        ? `date_trunc('month', s.sale_date AT TIME ZONE $3) = date_trunc('month', now() AT TIME ZONE $3)`
        : 'TRUE';
  const where = `(${periodClause}) AND ${f.clause}`;
  const [stats, chart, best, sales, summary, byCategory, hourly, topProducts, categoryLeaders, allCategories] = await Promise.all([
    periodStats(),
    chart7(),
    db.query(`SELECT product_name, SUM(quantity)::int AS total_qty FROM sale_items GROUP BY product_name ORDER BY total_qty DESC LIMIT 1`),
    db.query(
      `SELECT s.id, s.transaction_id, s.sale_date, s.total_amount::float8 AS total_amount, s.profit::float8 AS profit, s.payment_method
       FROM sales s WHERE ${where} ORDER BY s.sale_date DESC LIMIT 500`,
      f.params
    ),
    db.query(
      `SELECT COUNT(*)::int AS txns, COALESCE(SUM(s.total_amount),0)::float8 AS sales,
              COALESCE(SUM(s.tax),0)::float8 AS tax
       FROM sales s WHERE ${where}`,
      f.params
    ),
    db.query(
      `SELECT COALESCE(p.category,'General') AS category, SUM(si.quantity)::int AS qty, SUM(si.subtotal)::float8 AS amt
       FROM sale_items si JOIN sales s ON s.id = si.sale_id LEFT JOIN products p ON p.id = si.product_id
       WHERE ${where} GROUP BY 1 ORDER BY amt DESC LIMIT 8`,
      f.params
    ),
    db.query(
      `SELECT EXTRACT(HOUR FROM s.sale_date AT TIME ZONE $3)::int AS h, COUNT(*)::int AS txns,
              COALESCE(SUM(s.total_amount),0)::float8 AS revenue
       FROM sales s WHERE ${where} GROUP BY 1 ORDER BY 1`,
      f.params
    ),
    db.query(
      `SELECT si.product_name, SUM(si.quantity)::int AS qty, SUM(si.subtotal)::float8 AS revenue
       FROM sale_items si JOIN sales s ON s.id = si.sale_id
       WHERE ${where} GROUP BY 1 ORDER BY qty DESC, revenue DESC, 1 ASC LIMIT 5`,
      f.params
    ),
    // Best seller in EVERY category for the selected period. Ties are broken
    // deterministically (quantity, then revenue, then name) so results are
    // fair and stable instead of arbitrary.
    db.query(
      `SELECT category, product_name, qty, revenue FROM (
         SELECT COALESCE(p.category,'General') AS category, si.product_name,
                SUM(si.quantity)::int AS qty, SUM(si.subtotal)::float8 AS revenue,
                ROW_NUMBER() OVER (
                  PARTITION BY COALESCE(p.category,'General')
                  ORDER BY SUM(si.quantity) DESC, SUM(si.subtotal) DESC, si.product_name ASC
                ) AS rn
         FROM sale_items si JOIN sales s ON s.id = si.sale_id LEFT JOIN products p ON p.id = si.product_id
         WHERE ${where} GROUP BY 1, 2
       ) t WHERE rn = 1 ORDER BY qty DESC, category ASC`,
      f.params
    ),
    db.query(`SELECT DISTINCT category FROM products ORDER BY category ASC`)
  ]);
  const itemSum = await db.query(
    `SELECT COALESCE(SUM(si.quantity),0)::int AS items FROM sale_items si JOIN sales s ON s.id = si.sale_id WHERE ${where}`,
    f.params
  );
  res.json({
    stats, chart, best: best.rows[0] || null, sales: sales.rows, period,
    summary: { ...summary.rows[0], items: itemSum.rows[0].items },
    byCategory: byCategory.rows,
    hourly: hourly.rows,
    topProducts: topProducts.rows,
    categoryLeaders: categoryLeaders.rows,
    allCategories: allCategories.rows.map(function (r) { return r.category; })
  });
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
  // Cashiers see receipt totals only — cost and profit are owner data.
  if (isCashier(req)) {
    delete sale.total_cost;
    delete sale.profit;
  }
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

api.get('/export-sales', loadAccount, requireOwner, wrap(async (req, res) => {
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

// ---------- backups (owner only) ----------
// Portable JSON data backups (see lib/backup.js). Never streams the database
// connection string or credentials; every route below requires an owner.
const dbDown = (res, e) => {
  if (e && (e.code === 'ECONNREFUSED' || e.code === 'ENOTFOUND' || e.code === 'ETIMEDOUT' || /timeout/i.test(e.message || ''))) {
    return bad(res, 'Could not reach the database. Check DATABASE_URL and that Postgres is running. No backup was created or changed.', 503);
  }
  throw e;
};

api.get('/backups', loadAccount, requireOwner, wrap(async (req, res) => {
  try {
    const backups = backup.listBackups();
    const latest = backups.find((b) => b.valid) || null;
    res.json({ backups, latest, ephemeral: backup.isEphemeral(), auto: backup.describeAuto() });
  } catch (e) {
    return dbDown(res, e);
  }
}));

api.post('/backups', loadAccount, requireOwner, wrap(async (req, res) => {
  const kind = ['manual', 'daily', 'weekly'].includes(req.body.kind) ? req.body.kind : 'manual';
  try {
    const created = await backup.writeBackup(kind);
    res.json({ ok: true, backup: created, ephemeral: backup.isEphemeral() });
  } catch (e) {
    if (e.status) return bad(res, e.message, e.status);
    return dbDown(res, e);
  }
}));

api.get('/backups/:file', loadAccount, requireOwner, wrap(async (req, res) => {
  const fs = require('fs');
  let full;
  try {
    full = backup.safePath(req.params.file);
  } catch (e) {
    return bad(res, e.message, e.status || 400);
  }
  fs.stat(full, (err, stat) => {
    if (err || !stat.isFile()) return bad(res, 'Backup file not found.', 404);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${req.params.file}"`);
    fs.createReadStream(full).pipe(res);
  });
}));

api.delete('/backups/:file', loadAccount, requireOwner, wrap(async (req, res) => {
  const fs = require('fs');
  let full;
  try {
    full = backup.safePath(req.params.file);
  } catch (e) {
    return bad(res, e.message, e.status || 400);
  }
  const remaining = backup.listBackups().filter((b) => b.valid && b.file !== require('path').basename(full));
  if (remaining.length === 0) {
    return bad(res, 'Refusing to delete the only available valid backup. Create a newer backup first.', 409);
  }
  try {
    fs.unlinkSync(full);
  } catch (_) {
    return bad(res, 'Backup file not found.', 404);
  }
  res.json({ ok: true, file: require('path').basename(full) });
}));

// Restore: { file } restores a server-stored backup, { backup } restores an
// uploaded one. Always creates a safety backup first; the restore itself is
// one transaction, verified before COMMIT. Restoring users may sign out the
// current session (see sessionKept).
api.post('/backups/restore', loadAccount, requireOwner, wrap(async (req, res) => {
  let obj = null;
  try {
    if (req.body.file) {
      obj = backup.readBackupFile(req.body.file);
    } else if (req.body.backup) {
      if (JSON.stringify(req.body.backup).length > backup.MAX_FILE_BYTES) {
        return bad(res, 'Uploaded backup is too large and was rejected.', 413);
      }
      obj = req.body.backup;
    } else {
      return bad(res, 'Choose a backup file to restore (file or uploaded backup).');
    }
    const result = await backup.restoreBackup(obj, { sessionUid: req.user.uid });
    res.json({ ok: true, counts: result.counts, safety: result.safety, sessionKept: result.sessionKept });
  } catch (e) {
    if (e.status) return bad(res, e.message, e.status);
    return dbDown(res, e);
  }
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
