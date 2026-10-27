'use strict';
// One Express app serves every /api/* route (vercel.json rewrites /api/(.*) to this file).
const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('../lib/db');
const auth = require('../lib/auth');
const SCHEMA = require('../lib/schema');
const categories = require('../lib/categories');
const sizes = require('../lib/sizes');
const { tz, periodStats, chart7 } = require('../lib/stats');

const app = express();
app.disable('x-powered-by');
// 25mb: local backup restores upload a full JSON backup in the request body.
// Ordinary POS payloads are a few KB; Vercel's platform limit (~4.5 MB) still
// applies there, so lib/backup.js lowers the upload cap when running on Vercel.
app.use(express.json({ limit: '25mb' }));
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
// Date-only fields are kept as YYYY-MM-DD strings so the browser never has to
// guess a time zone from an ISO timestamp.
const dateOnly = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const s = String(v).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return undefined;
  const d = new Date(s + 'T00:00:00Z');
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) return undefined;
  return s;
};
const PRODUCT_COLS = `id, barcode, name, category, size_value::float8 AS size_value, size_unit, size_label, cost_price::float8 AS cost_price, price::float8 AS price, stock, low_stock_threshold, to_char(expiry_date, 'YYYY-MM-DD') AS expiry_date`;
const FALLBACK_CATEGORY = categories.FALLBACK_CATEGORY;
const CATEGORY_COLS = 'id, name, active, created_at, updated_at';
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
        return;
      }
      // Logins are case-insensitive (see POST /login). Keep the data consistent
      // with a unique index on lower(username) so "Owner" and "owner" cannot both
      // be created. Best-effort: a pre-existing case-only duplicate would make
      // this fail, which must not break the app - log and carry on.
      try {
        await db.query('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_lower ON users (lower(username))');
      } catch (e) {
        console.error('username case-insensitive index deferred:', e.message);
      }
    })();
  }
  return accountMigration;
}
ensureAccountColumns();

// Expiration fields and persisted alert dismissals. Safe to run repeatedly and
// retried after the installer creates the base tables on a fresh database.
let alertSchemaMigration = null;
function ensureAlertSchema() {
  if (!alertSchemaMigration) {
    alertSchemaMigration = (async () => {
      try {
        await db.query('ALTER TABLE products ADD COLUMN IF NOT EXISTS expiry_date DATE');
        await db.query('CREATE INDEX IF NOT EXISTS idx_products_expiry ON products (expiry_date)');
        await db.query(`CREATE TABLE IF NOT EXISTS alert_dismissals (
          user_id      INT          NOT NULL REFERENCES users (id) ON DELETE CASCADE,
          alert_key    VARCHAR(80)  NOT NULL,
          dismissed_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
          PRIMARY KEY (user_id, alert_key)
        )`);
        await db.query('CREATE INDEX IF NOT EXISTS idx_alert_dismissals_user ON alert_dismissals (user_id)');
        await db.query('ALTER TABLE alert_dismissals ENABLE ROW LEVEL SECURITY');
      } catch (e) {
        // Table may not exist yet (pre-install). Retry on the next request.
        console.error('alert schema migration deferred:', e.message);
        alertSchemaMigration = null;
      }
    })();
  }
  return alertSchemaMigration;
}
ensureAlertSchema();

let categorySchemaMigration = null;
function ensureCategorySchema() {
  if (!categorySchemaMigration) {
    categorySchemaMigration = (async () => {
      try {
        await db.query(`CREATE TABLE IF NOT EXISTS categories (
          id          SERIAL PRIMARY KEY,
          name        VARCHAR(60) NOT NULL,
          active      BOOLEAN     NOT NULL DEFAULT TRUE,
          created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        )`);
        await db.query('CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_name_lower ON categories (lower(name))');
        await db.query('CREATE INDEX IF NOT EXISTS idx_categories_active ON categories (active)');
        const { rows: [count] } = await db.query('SELECT COUNT(*)::int AS n FROM categories');
        if (!count || count.n === 0) {
          await db.query(
            'INSERT INTO categories (name) SELECT x FROM unnest($1::text[]) AS x ON CONFLICT DO NOTHING',
            [categories.DEFAULT_CATEGORIES]
          );
        }
        await db.query(
          `INSERT INTO categories (name)
           SELECT DISTINCT TRIM(category) FROM products
           WHERE category IS NOT NULL AND TRIM(category) <> ''
           ON CONFLICT DO NOTHING`
        );
      } catch (e) {
        console.error('category schema migration deferred:', e.message);
        categorySchemaMigration = null;
      }
    })();
  }
  return categorySchemaMigration;
}
ensureCategorySchema();

// Product size/volume fields. Additive and nullable by design: existing rows
// keep working as "Size not specified" and old backups restore with nulls.
let sizeSchemaMigration = null;
function ensureSizeSchema() {
  if (!sizeSchemaMigration) {
    sizeSchemaMigration = (async () => {
      try {
        await db.query('ALTER TABLE products ADD COLUMN IF NOT EXISTS size_value NUMERIC(10,3)');
        await db.query('ALTER TABLE products ADD COLUMN IF NOT EXISTS size_unit VARCHAR(10)');
        await db.query('ALTER TABLE products ADD COLUMN IF NOT EXISTS size_label VARCHAR(60)');
        await db.query('ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS size_label VARCHAR(60)');
      } catch (e) {
        // Table may not exist yet (pre-install). Retry on the next request.
        console.error('size schema migration deferred:', e.message);
        sizeSchemaMigration = null;
      }
    })();
  }
  return sizeSchemaMigration;
}
ensureSizeSchema();

function submittedSize(body) {
  const provided = body.size_value !== undefined || body.size_unit !== undefined || body.size_label !== undefined;
  if (!provided) return { provided: false, size: null };
  const size = sizes.cleanSize(body.size_value, body.size_unit, body.size_label);
  return { provided: true, size };
}

async function sizeSuggestion(name, barcode) {
  if (barcode) {
    const { rows: [existing] } = await db.query(
      'SELECT size_value::float8 AS size_value, size_unit, size_label FROM products WHERE barcode = $1',
      [barcode]
    );
    if (existing && existing.size_value !== null && existing.size_unit && existing.size_label) {
      return {
        suggestion: { value: existing.size_value, unit: existing.size_unit, label: existing.size_label },
        source: 'existing'
      };
    }
  }
  const guessed = name ? sizes.fromName(name) : null;
  if (guessed) return { suggestion: guessed, source: 'name' };
  return { suggestion: null, source: 'none' };
}

async function categoryByName(name, runner) {
  const q = runner || db;
  const { rows: [row] } = await q.query(
    `SELECT ${CATEGORY_COLS} FROM categories WHERE lower(name) = lower($1)`,
    [name]
  );
  return row || null;
}

async function ensureCategoryRow(name, runner) {
  const clean = categories.cleanName(name);
  if (!clean) return null;
  const q = runner || db;
  const found = await categoryByName(clean, q);
  if (found) return found;
  const { rows: [created] } = await q.query(
    `INSERT INTO categories (name) VALUES ($1) ON CONFLICT DO NOTHING RETURNING ${CATEGORY_COLS}`,
    [clean]
  );
  return created || categoryByName(clean, q);
}

async function autoCategoryForProduct(name, barcode) {
  const { rows: [existing] } = await db.query('SELECT category FROM products WHERE barcode = $1', [barcode]);
  if (existing && existing.category) {
    const row = await categoryByName(existing.category);
    if (row) return row.active ? row.name : existing.category;
    return existing.category;
  }
  const suggested = categories.classifyName(name);
  const row = await categoryByName(suggested);
  if (row && row.active) return row.name;
  const fallback = await ensureCategoryRow(FALLBACK_CATEGORY);
  return fallback ? fallback.name : FALLBACK_CATEGORY;
}

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
    if (code === '28P01') dbError = 'Database login failed (wrong user/password in DATABASE_URL). Copy a fresh pooled connection string from Supabase (Connect -> Connection string -> URI -> Session pooler) and update the Vercel env var, then redeploy.';
    else if (code === '3D000') dbError = 'Database name in DATABASE_URL does not exist. Check the dbname part of the URL.';
    else if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') dbError = 'Database host not found (DNS)' + (dbHost ? ' — the app sees host "' + dbHost + '".' : '.') + ' Copy the Supabase pooled connection string again (the session pooler host contains ".pooler.supabase.com").';
    else if (code === 'ECONNREFUSED') dbError = 'Database refused the connection. Wrong host/port — use the Supabase session pooler on port 5432.';
    else if (code === 'ETIMEDOUT' || /timeout/i.test(e.message || '')) dbError = 'Database connection timed out (cold start or wrong region). Retry /api/status once, and confirm the function region is close to the Supabase region.';
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
  await ensureAlertSchema();
  await ensureCategorySchema();
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

// Classify a stored password value WITHOUT exposing it. Only the algorithm
// family is returned, never the hash itself, so it is safe to log.
function passwordHashKind(stored) {
  const s = String(stored || '');
  if (/^\$2[abxy]\$\d{2}\$/.test(s)) return 'bcrypt';
  if (/^\$argon2/.test(s)) return 'argon2';
  if (/^[a-f0-9]{32}$/i.test(s)) return 'md5';
  if (/^[a-f0-9]{40}$/i.test(s)) return 'sha1';
  if (/^[a-f0-9]{64}$/i.test(s)) return 'sha256';
  if (!s) return 'empty';
  return 'unknown';
}

// bcryptjs understands $2a/$2b/$2y, but normalising the legacy PHP prefix to
// $2a avoids any version-specific quirks. The salt and digest are unchanged.
const normalizeBcrypt = (hash) => String(hash || '').replace(/^\$2[by]\$/, '$2a$');

// Look up an account by username, case-insensitively (matches the original
// PHP/MySQL utf8mb4_unicode_ci behaviour; Postgres equality is case-sensitive).
// If the schema predates the role/active columns (partial migration), the
// 42703 error triggers the migration once and the lookup is retried.
async function findAccountByUsername(username) {
  const sql = 'SELECT id, username, password, role, active FROM users WHERE lower(username) = lower($1)';
  try {
    const { rows: [u] } = await db.query(sql, [username]);
    return u || null;
  } catch (e) {
    if (e.code === '42703') {
      await ensureAccountColumns();
      const { rows: [u] } = await db.query(sql, [username]);
      return u || null;
    }
    throw e;
  }
}

api.post('/login', wrap(async (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  if (!username || !password) return bad(res, 'Please enter your username and password.');

  // Case-insensitive lookup (see helper) with a retry if the schema was only
  // partially migrated. This keeps login working on older/imported databases.
  const u = await findAccountByUsername(username);
  const kind = u ? passwordHashKind(u.password) : null;
  let ok = false;
  if (u && kind === 'bcrypt') {
    ok = await bcrypt.compare(password, u.password.replace(/^\$2[xy]\$/, '$2a$'));
  } else if (u) {
    ok = false;
  } else {
    await bcrypt.compare(password, DUMMY_HASH);
    ok = false;
  }
  if (!ok) {
    // Server-side diagnostics without secrets: never log the password or hash.
    if (!u) console.warn('[auth] login rejected: no account for username %j', username);
    else if (kind !== 'bcrypt') console.warn('[auth] login rejected: account %j has an incompatible password hash (%s) - a reset is required', u.username, kind);
    else console.warn('[auth] login rejected: wrong password for username %j', u.username);
    await new Promise((r) => setTimeout(r, 400));
    return bad(res, 'Invalid username or password.', 401);
  }
  if (u.active === false) {
    console.warn('[auth] login rejected: account deactivated for username %j', u.username);
    return bad(res, 'This account is deactivated. Ask the store owner.', 403);
  }
  auth.setSession(res, u);
  console.log('[auth] login ok: username %j role %j', u.username, u.role === 'cashier' ? 'cashier' : 'owner');
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

// ---------- unified inventory alerts ----------
// One feed powers the dashboard panel and the header notification center.
// Rules:
//   out       stock <= 0                                  critical (never dismissible)
//   low       0 < stock <= low_stock_threshold             warning  (dismissible)
//   expired   stock > 0 and expiry_date < store today      critical (never dismissible)
//   expiring  stock > 0 and 0..30 days left                buckets 30/14/7/1 days
// Dismissals are persisted per user and pruned as soon as the alert resolves,
// so a warning that comes back later is visible again. Product rows and stock
// history are never touched by a dismissal.
async function buildAlertData(userId) {
  await ensureAlertSchema();
  const tzName = tz();
  const { rows } = await db.query(
    `SELECT id, barcode, name, category, stock, low_stock_threshold,
            to_char(expiry_date, 'YYYY-MM-DD') AS expiry_date,
            CASE WHEN expiry_date IS NULL THEN NULL
                 ELSE expiry_date - (now() AT TIME ZONE $1)::date END AS days_left
     FROM products
     WHERE stock <= low_stock_threshold
        OR (stock > 0 AND expiry_date IS NOT NULL
            AND expiry_date <= (now() AT TIME ZONE $1)::date + 30)
     ORDER BY name ASC`,
    [tzName]
  );

  const alerts = [];
  for (const p of rows) {
    const base = {
      product_id: p.id,
      id: p.id,
      name: p.name,
      barcode: p.barcode,
      category: p.category,
      stock: p.stock,
      low_stock_threshold: p.low_stock_threshold,
      expiry_date: p.expiry_date || null,
      days_left: p.days_left == null ? null : p.days_left
    };
    if (p.stock <= 0) {
      alerts.push({ ...base, key: `out:${p.id}`, type: 'out', severity: 'critical', status: 'OUT OF STOCK' });
    } else if (p.stock <= p.low_stock_threshold) {
      alerts.push({ ...base, key: `low:${p.id}`, type: 'low', severity: 'warning', status: 'LOW STOCK' });
    }
    if (p.stock > 0 && p.expiry_date && p.days_left != null) {
      if (p.days_left < 0) {
        alerts.push({ ...base, key: `expired:${p.id}:${p.expiry_date}`, type: 'expired', severity: 'critical', status: 'EXPIRED' });
      } else if (p.days_left <= 30) {
        const severity = p.days_left <= 1 ? 'critical'
          : p.days_left <= 7 ? 'urgent'
            : p.days_left <= 14 ? 'warning' : 'info';
        alerts.push({ ...base, key: `expiring:${p.id}:${p.expiry_date}`, type: 'expiring', severity, status: 'EXPIRING SOON' });
      }
    }
  }

  let dismissed = new Set();
  if (userId != null) {
    const keys = alerts.map((a) => a.key);
    if (keys.length) {
      await db.query(
        'DELETE FROM alert_dismissals WHERE user_id = $1 AND alert_key <> ALL($2::text[])',
        [userId, keys]
      );
    } else {
      await db.query('DELETE FROM alert_dismissals WHERE user_id = $1', [userId]);
    }
    const { rows: dRows } = await db.query('SELECT alert_key FROM alert_dismissals WHERE user_id = $1', [userId]);
    dismissed = new Set(dRows.map((r) => r.alert_key));
  }

  const rank = { critical: 0, urgent: 1, warning: 2, info: 3 };
  alerts.forEach((a) => {
    a.dismissible = a.severity !== 'critical';
    // A warning dismissed earlier must become visible again if it escalates to
    // critical (e.g. an expiring item reaches its last day). The stale dismissal
    // row is pruned once the alert resolves or its expiry date changes.
    a.dismissed = a.dismissible && dismissed.has(a.key);
  });
  alerts.sort((a, b) =>
    (rank[a.severity] - rank[b.severity]) ||
    String(a.name).localeCompare(String(b.name)) ||
    String(a.type).localeCompare(String(b.type))
  );

  const active = alerts.filter((a) => !a.dismissed);
  const countType = (t) => active.filter((a) => a.type === t).length;
  return {
    generated_at: new Date().toISOString(),
    timezone: tzName,
    alerts,
    counts: {
      low: countType('low'),
      out: countType('out'),
      expiring: countType('expiring'),
      expired: countType('expired'),
      total: active.length,
      critical: active.filter((a) => a.severity === 'critical').length,
      dismissed: alerts.length - active.length
    }
  };
}

// ---------- dashboard (owner only) ----------
api.get('/dashboard', loadAccount, requireOwner, wrap(async (req, res) => {
  await ensureSizeSchema();
  const [stats, chart, inv, low, lowCount, outCount, todayItems, recent, top, cats, alertData] = await Promise.all([
    periodStats(),
    chart7(),
    db.query(`SELECT COUNT(*)::int AS skus, COALESCE(SUM(stock),0)::int AS units, COALESCE(SUM(stock*price),0)::float8 AS value_amt FROM products`),
    db.query(`SELECT id, barcode, name, category, size_label, stock, low_stock_threshold FROM products WHERE stock <= low_stock_threshold ORDER BY stock ASC, name ASC LIMIT 8`),
    db.query(`SELECT COUNT(*)::int AS n FROM products WHERE stock <= low_stock_threshold`),
    db.query(`SELECT COUNT(*)::int AS n FROM products WHERE stock <= 0`),
    db.query(`SELECT COALESCE(SUM(si.quantity),0)::int AS items FROM sale_items si JOIN sales s ON s.id = si.sale_id WHERE (s.sale_date AT TIME ZONE $1)::date = (now() AT TIME ZONE $1)::date`, [tz()]),
    db.query(`SELECT id, transaction_id, total_amount::float8 AS total_amount, profit::float8 AS profit, payment_method, sale_date FROM sales ORDER BY sale_date DESC LIMIT 8`),
    db.query(`SELECT product_name, size_label, SUM(quantity)::int AS qty, SUM(subtotal)::float8 AS amt FROM sale_items GROUP BY product_name, size_label ORDER BY qty DESC, product_name ASC, size_label ASC LIMIT 5`),
    db.query(`SELECT category, SUM(stock)::int AS units FROM products GROUP BY category ORDER BY units DESC LIMIT 6`),
    buildAlertData(req.user.uid)
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
    alerts: alertData,
    user: req.user.username
  });
}));

// ---------- stock alerts (owner only) ----------
// Unified feed used by the header notification bell dropdown.
api.get('/alerts', loadAccount, requireOwner, wrap(async (req, res) => {
  res.json(await buildAlertData(req.user.uid));
}));

// Dismiss a non-critical warning. Critical alerts (out of stock, expired, and
// expiring today/tomorrow) stay visible until the inventory is fixed.
api.post('/alerts/dismiss', loadAccount, requireOwner, wrap(async (req, res) => {
  const key = text(req.body.key, 80);
  if (!key) return bad(res, 'Choose an alert to dismiss.');
  const data = await buildAlertData(req.user.uid);
  const alert = data.alerts.find((a) => a.key === key);
  if (!alert) return bad(res, 'That alert is no longer active.', 404);
  if (!alert.dismissible) {
    return bad(res, 'Critical alerts cannot be dismissed. Restock, remove, or update the item to clear it.');
  }
  await db.query(
    'INSERT INTO alert_dismissals (user_id, alert_key) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [req.user.uid, key]
  );
  res.json(await buildAlertData(req.user.uid));
}));

// Restore a previously dismissed warning.
api.post('/alerts/restore', loadAccount, requireOwner, wrap(async (req, res) => {
  const key = text(req.body.key, 80);
  if (!key) return bad(res, 'Choose an alert to restore.');
  await db.query('DELETE FROM alert_dismissals WHERE user_id = $1 AND alert_key = $2', [req.user.uid, key]);
  res.json(await buildAlertData(req.user.uid));
}));

// Backwards-compatible low-stock feed (used by older pages and smoke tests).
api.get('/alerts/low-stock', loadAccount, requireOwner, wrap(async (req, res) => {
  const data = await buildAlertData(req.user.uid);
  const shape = (a, status) => ({
    id: a.product_id,
    barcode: a.barcode,
    name: a.name,
    category: a.category,
    stock: a.stock,
    low_stock_threshold: a.low_stock_threshold,
    expiry_date: a.expiry_date,
    days_left: a.days_left,
    status,
    supplier_name: null,
    supplier_contact: null
  });
  const out = data.alerts.filter((a) => a.type === 'out' && !a.dismissed);
  const low = data.alerts.filter((a) => a.type === 'low' && !a.dismissed);
  res.json({
    counts: { out: out.length, low: low.length, total: out.length + low.length },
    out_of_stock: out.map((a) => shape(a, 'OUT OF STOCK')),
    low_stock: low.map((a) => shape(a, 'LOW STOCK')),
    truncated: false
  });
}));

// ---------- categories ----------
api.get('/categories', loadAccount, wrap(async (req, res) => {
  await ensureCategorySchema();
  const includeInactive = req.user.role === 'owner' && String(req.query.all || '') === '1';
  const where = includeInactive ? '' : 'WHERE c.active = TRUE';
  const { rows } = await db.query(
    `SELECT c.id, c.name, c.active, c.created_at, c.updated_at,
            COUNT(p.id)::int AS product_count
     FROM categories c
     LEFT JOIN products p ON lower(p.category) = lower(c.name)
     ${where}
     GROUP BY c.id
     ORDER BY c.active DESC, lower(c.name) ASC`
  );
  res.json({
    categories: rows.map((c) => ({
      ...c,
      is_fallback: String(c.name).toLowerCase() === FALLBACK_CATEGORY.toLowerCase()
    }))
  });
}));

api.get('/categories/suggest', loadAccount, requireOwner, wrap(async (req, res) => {
  await ensureCategorySchema();
  const name = text(req.query.name, 150);
  const barcode = text(req.query.barcode, 64);
  if (!name && !barcode) return bad(res, 'Enter an item name or barcode.');

  let suggestion = null;
  let source = null;
  if (barcode) {
    const { rows: [existing] } = await db.query('SELECT category FROM products WHERE barcode = $1', [barcode]);
    if (existing && existing.category) {
      const row = await categoryByName(existing.category);
      if (row && row.active) {
        suggestion = row.name;
        source = 'existing';
      }
    }
  }
  if (!suggestion && name) {
    const row = await categoryByName(categories.classifyName(name));
    if (row && row.active) {
      suggestion = row.name;
      source = 'keyword';
    }
  }
  if (!suggestion) {
    const fallback = await categoryByName(FALLBACK_CATEGORY);
    suggestion = fallback && fallback.active ? fallback.name : FALLBACK_CATEGORY;
    source = 'fallback';
  }
  res.json({ suggestion, source });
}));

api.get('/sizes/suggest', loadAccount, requireOwner, wrap(async (req, res) => {
  await ensureSizeSchema();
  const name = text(req.query.name, 150);
  const barcode = text(req.query.barcode, 64);
  if (!name && !barcode) return bad(res, 'Enter an item name or barcode.');
  res.json(await sizeSuggestion(name, barcode));
}));

api.post('/categories', loadAccount, requireOwner, wrap(async (req, res) => {
  await ensureCategorySchema();
  const name = categories.cleanName(req.body.name);
  if (!name) return bad(res, 'Category name is required and must be 60 characters or fewer.');
  const existing = await categoryByName(name);
  if (existing) {
    return res.status(409).json({
      error: existing.active
        ? 'That category already exists.'
        : 'That category already exists but is inactive. Reactivate it or choose another name.',
      category: existing
    });
  }
  const { rows: [created] } = await db.query(
    `INSERT INTO categories (name) VALUES ($1) ON CONFLICT DO NOTHING RETURNING ${CATEGORY_COLS}`,
    [name]
  );
  if (!created) return bad(res, 'That category already exists.', 409);
  res.status(201).json({ category: { ...created, product_count: 0, is_fallback: false } });
}));

api.put('/categories/:id', loadAccount, requireOwner, wrap(async (req, res) => {
  await ensureCategorySchema();
  const id = number(req.params.id, { min: 1, int: true });
  if (!id) return bad(res, 'Category not found.', 404);

  let requestedName;
  if (req.body.name !== undefined) {
    requestedName = categories.cleanName(req.body.name);
    if (!requestedName) return bad(res, 'Category name is required and must be 60 characters or fewer.');
  }
  if (req.body.active !== undefined && typeof req.body.active !== 'boolean') {
    return bad(res, 'Active must be true or false.');
  }

  const result = await db.tx(async (c) => {
    const { rows: [old] } = await c.query(
      `SELECT ${CATEGORY_COLS} FROM categories WHERE id = $1 FOR UPDATE`,
      [id]
    );
    if (!old) return { missing: true };

    const name = requestedName === undefined ? old.name : requestedName;
    const active = req.body.active === undefined ? old.active : req.body.active;
    const isFallback = String(old.name).toLowerCase() === FALLBACK_CATEGORY.toLowerCase();
    if (isFallback && (name !== old.name || active !== true)) {
      return { system: true };
    }
    if (name !== old.name) {
      const duplicate = await categoryByName(name, c);
      if (duplicate && duplicate.id !== old.id) return { duplicate: true };
    }

    await c.query(
      'UPDATE categories SET name = $1, active = $2, updated_at = now() WHERE id = $3',
      [name, active, id]
    );
    let moved = 0;
    if (name !== old.name) {
      const updated = await c.query(
        'UPDATE products SET category = $1 WHERE lower(category) = lower($2)',
        [name, old.name]
      );
      moved = updated.rowCount || 0;
    }
    return { category: { ...old, name, active, updated_at: new Date().toISOString() }, moved };
  });

  if (result.missing) return bad(res, 'Category not found.', 404);
  if (result.system) return bad(res, 'Uncategorized is the fallback category and must stay active.');
  if (result.duplicate) return bad(res, 'Another category already uses that name.', 409);
  res.json({ ok: true, category: result.category, products_updated: result.moved });
}));

api.post('/categories/:id/merge', loadAccount, requireOwner, wrap(async (req, res) => {
  await ensureCategorySchema();
  const sourceId = number(req.params.id, { min: 1, int: true });
  const targetId = number(req.body.target_id, { min: 1, int: true });
  if (!sourceId || !targetId) return bad(res, 'Choose a source and target category.');
  if (sourceId === targetId) return bad(res, 'Choose a different category to merge into.');

  const result = await db.tx(async (c) => {
    const { rows: [source] } = await c.query(
      `SELECT ${CATEGORY_COLS} FROM categories WHERE id = $1 FOR UPDATE`,
      [sourceId]
    );
    const { rows: [target] } = await c.query(
      `SELECT ${CATEGORY_COLS} FROM categories WHERE id = $1 FOR UPDATE`,
      [targetId]
    );
    if (!source || !target) return { missing: true };
    if (String(source.name).toLowerCase() === FALLBACK_CATEGORY.toLowerCase()) {
      return { system: true };
    }
    if (!target.active) return { targetInactive: true };

    const updated = await c.query(
      'UPDATE products SET category = $1 WHERE lower(category) = lower($2)',
      [target.name, source.name]
    );
    await c.query('DELETE FROM categories WHERE id = $1', [sourceId]);
    return { moved: updated.rowCount || 0, target: target.name, source: source.name };
  });

  if (result.missing) return bad(res, 'Category not found.', 404);
  if (result.system) return bad(res, 'Uncategorized is the fallback category and cannot be merged away.');
  if (result.targetInactive) return bad(res, 'Choose an active category to merge into.');
  res.json({
    ok: true,
    source: result.source,
    target: result.target,
    products_moved: result.moved
  });
}));

// ---------- products ----------
// Cashiers may read the catalog (the POS needs it) but never manage it.
// Cost price and low-stock thresholds are stripped for cashiers (see
// publicProduct) — POS-only, no inventory data.
api.get('/products', wrap(async (req, res) => {
  await ensureAlertSchema();
  await ensureSizeSchema();
  const q = text(req.query.q, 100);
  const category = text(req.query.category, 60);
  const status = String(req.query.status || '');
  const where = [];
  const params = [];
  if (q) {
    params.push(likePattern(q));
    where.push(`(name ILIKE $${params.length} OR barcode ILIKE $${params.length} OR category ILIKE $${params.length} OR size_label ILIKE $${params.length})`);
  }
  if (category) {
    params.push(category);
    where.push(`lower(category) = lower($${params.length})`);
  }
  const expiryFilter = status === 'expiring' || status === 'expired';
  if (expiryFilter) params.push(tz());
  if (status === 'low') where.push('stock > 0 AND stock <= low_stock_threshold');
  if (status === 'out') where.push('stock <= 0');
  if (status === 'expiring') {
    where.push(`stock > 0 AND expiry_date IS NOT NULL AND expiry_date BETWEEN (now() AT TIME ZONE $${params.length})::date AND (now() AT TIME ZONE $${params.length})::date + 30`);
  }
  if (status === 'expired') {
    where.push(`stock > 0 AND expiry_date IS NOT NULL AND expiry_date < (now() AT TIME ZONE $${params.length})::date`);
  }
  const order = expiryFilter ? 'expiry_date ASC, name ASC' : 'name ASC';
  const { rows } = await db.query(
    `SELECT ${PRODUCT_COLS} FROM products ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${order} LIMIT 1000`,
    params
  );
  res.json({ products: rows.map((p) => publicProduct(req, p)) });
}));

api.get('/products/:id', wrap(async (req, res) => {
  await ensureAlertSchema();
  await ensureSizeSchema();
  const id = number(req.params.id, { min: 1, int: true });
  if (!id) return bad(res, 'Product not found.', 404);
  const { rows: [p] } = await db.query(`SELECT ${PRODUCT_COLS} FROM products WHERE id = $1`, [id]);
  if (!p) return bad(res, 'Product not found.', 404);
  res.json({ product: publicProduct(req, p) });
}));

// Add a product, or restock an existing barcode (owner only; stock is added to what is on hand).
api.post('/products', loadAccount, requireOwner, wrap(async (req, res) => {
  await ensureAlertSchema();
  await ensureCategorySchema();
  await ensureSizeSchema();
  const b = req.body;
  const barcode = text(b.barcode, 64);
  const name = text(b.name, 150);
  const suppliedCategory = b.category === undefined || b.category === null ? '' : String(b.category).trim();
  const requestedCategory = suppliedCategory ? categories.cleanName(suppliedCategory) : null;
  const cost = number(b.cost_price, { max: 1e7 });
  const price = number(b.price, { max: 1e7 });
  const stock = number(b.stock, { max: 1e6, int: true });
  const threshold = number(b.low_stock_threshold, { max: 1e6, int: true });
  const expiry = b.expiry_date === undefined ? null : dateOnly(b.expiry_date);
  const sizeInput = submittedSize(b);
  if (!barcode || !name) return bad(res, 'Barcode and item name are required.');
  if (suppliedCategory && !requestedCategory) return bad(res, 'Category must be 60 characters or fewer.');
  if (cost === null || price === null) return bad(res, 'Enter valid cost and selling prices.');
  if (stock === null || threshold === null) return bad(res, 'Stock and threshold must be whole numbers, 0 or more.');
  if (expiry === undefined) return bad(res, 'Expiration date must be a valid date (YYYY-MM-DD).');
  if (sizeInput.size === undefined) return bad(res, 'Size value and unit must be provided together, with a valid positive value and supported unit.');

  let category;
  if (requestedCategory) {
    const row = await ensureCategoryRow(requestedCategory);
    if (!row || !row.active) return bad(res, 'That category is inactive. Choose another or reactivate it.');
    category = row.name;
  } else {
    category = await autoCategoryForProduct(name, barcode);
  }

  const size = sizeInput.size;
  const { rows: [r] } = await db.query(
    `INSERT INTO products (barcode, name, category, cost_price, price, stock, low_stock_threshold, expiry_date,
                           size_value, size_unit, size_label)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (barcode) DO UPDATE SET
       name = EXCLUDED.name, category = EXCLUDED.category, cost_price = EXCLUDED.cost_price, price = EXCLUDED.price,
       stock = products.stock + EXCLUDED.stock, low_stock_threshold = EXCLUDED.low_stock_threshold,
       expiry_date = COALESCE(EXCLUDED.expiry_date, products.expiry_date),
       size_value = COALESCE(EXCLUDED.size_value, products.size_value),
       size_unit = COALESCE(EXCLUDED.size_unit, products.size_unit),
       size_label = COALESCE(EXCLUDED.size_label, products.size_label),
       updated_at = now()
     RETURNING id, (xmax = 0) AS inserted`,
    [barcode, name, category, cost, price, stock, threshold, expiry,
      size ? size.value : null, size ? size.unit : null, size ? size.label : null]
  );
  if (stock !== 0) {
    await db.query(
      'INSERT INTO stock_movements (product_id, product_name, change_qty, reason, note) VALUES ($1,$2,$3,$4,$5)',
      [r.id, name, stock, r.inserted ? 'initial' : 'restock', 'Added from Products page']
    );
  }
  res.json({ ok: true, id: r.id, created: r.inserted, category });
}));

api.put('/products/:id', loadAccount, requireOwner, wrap(async (req, res) => {
  await ensureAlertSchema();
  await ensureCategorySchema();
  await ensureSizeSchema();
  const id = number(req.params.id, { min: 1, int: true });
  const b = req.body;
  const name = text(b.name, 150);
  const suppliedCategory = b.category === undefined || b.category === null ? '' : String(b.category).trim();
  const requestedCategory = suppliedCategory ? categories.cleanName(suppliedCategory) : null;
  const price = number(b.price, { max: 1e7 });
  const cost = b.cost_price === undefined ? undefined : number(b.cost_price, { max: 1e7 });
  const stock = number(b.stock, { max: 1e6, int: true });
  const threshold = number(b.low_stock_threshold, { max: 1e6, int: true });
  let expiry;
  if (b.expiry_date !== undefined) {
    expiry = dateOnly(b.expiry_date);
    if (expiry === undefined) return bad(res, 'Expiration date must be a valid date (YYYY-MM-DD).');
  }
  // Optional conflict guard for offline-queued edits: the stock the editor saw.
  const baseStock = (b.base_stock === undefined || b.base_stock === null || b.base_stock === '') ? undefined : number(b.base_stock, { max: 1e6, int: true });
  const sizeInput = submittedSize(b);
  if (!id) return bad(res, 'Product not found.', 404);
  if (!name) return bad(res, 'Product name is required.');
  if (suppliedCategory && !requestedCategory) return bad(res, 'Category must be 60 characters or fewer.');
  if (price === null) return bad(res, 'Enter a valid price.');
  if (cost === null) return bad(res, 'Enter a valid cost price.');
  if (stock === null || threshold === null) return bad(res, 'Stock and threshold must be whole numbers, 0 or more.');
  if (b.base_stock !== undefined && b.base_stock !== null && b.base_stock !== '' && baseStock === null) {
    return bad(res, 'Base stock is invalid.');
  }
  if (sizeInput.size === undefined) return bad(res, 'Size value and unit must be provided together, with a valid positive value and supported unit.');

  const found = await db.tx(async (c) => {
    const { rows: [old] } = await c.query(
      `SELECT stock, cost_price::float8 AS cost_price, category,
              size_value::float8 AS size_value, size_unit, size_label,
              to_char(expiry_date, 'YYYY-MM-DD') AS expiry_date
       FROM products WHERE id = $1 FOR UPDATE`,
      [id]
    );
    if (!old) return false;
    if (baseStock !== undefined && old.stock !== baseStock) {
      return { conflict: true, current_stock: old.stock };
    }
    let nextCategory = old.category;
    if (requestedCategory) {
      const row = await ensureCategoryRow(requestedCategory, c);
      if (row && !row.active && String(row.name).toLowerCase() !== String(old.category).toLowerCase()) {
        return { inactiveCategory: true };
      }
      if (row) nextCategory = row.name;
    }
    const nextSize = sizeInput.provided
      ? sizeInput.size
      : old.size_label
        ? { value: old.size_value, unit: old.size_unit, label: old.size_label }
        : null;
    await c.query(
      `UPDATE products SET name=$1, price=$2, stock=$3, low_stock_threshold=$4, cost_price=$5, category=$6,
              expiry_date=$7, size_value=$8, size_unit=$9, size_label=$10, updated_at=now() WHERE id=$11`,
      [name, price, stock, threshold, cost === undefined ? old.cost_price : cost, nextCategory,
        expiry === undefined ? old.expiry_date : expiry,
        nextSize ? nextSize.value : null, nextSize ? nextSize.unit : null,
        nextSize ? nextSize.label : null, id]
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
  if (found.inactiveCategory) return bad(res, 'That category is inactive. Choose another or reactivate it.');
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
  await ensureAlertSchema();
  await ensureSizeSchema();
  const code = text(req.query.code, 64);
  if (!code) return bad(res, 'Enter a barcode.');
  const { rows: [p] } = await db.query(
    `SELECT ${PRODUCT_COLS},
            (expiry_date IS NOT NULL AND expiry_date < (now() AT TIME ZONE $2)::date) AS expired
     FROM products WHERE barcode = $1`,
    [code, tz()]
  );
  if (!p) return bad(res, 'No product with barcode ' + code + '.', 404);
  if (p.expired) return bad(res, p.name + ' expired on ' + p.expiry_date + ' and cannot be sold.', 409);
  if (p.stock <= 0) return bad(res, p.name + ' is out of stock.', 409);
  res.json({ product: publicProduct(req, p) });
}));

// ---------- checkout ----------
// Prices and costs come from the database, never from the browser.
// Accepts an optional client_sale_id (offline idempotency key): retried
// syncs with the same key return the original sale instead of duplicating it.
api.post('/checkout', wrap(async (req, res) => {
  await ensureAlertSchema();
  await ensureSizeSchema();
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
        `SELECT id, name, size_label, price::float8 AS price, cost_price::float8 AS cost, stock,
                to_char(expiry_date, 'YYYY-MM-DD') AS expiry_date,
                (expiry_date IS NOT NULL AND expiry_date < (now() AT TIME ZONE $2)::date) AS expired
         FROM products WHERE id = ANY($1::int[]) ORDER BY id FOR UPDATE`,
        [ids, tz()]
      );
      if (rows.length !== ids.length) return { error: 'An item in the cart no longer exists.' };

      let sub = 0;
      let cost = 0;
      for (const p of rows) {
        const qty = qtyById.get(p.id);
        if (p.expired) return { error: `${p.name} expired on ${p.expiry_date} and cannot be sold.` };
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
          'INSERT INTO sale_items (sale_id, product_id, product_name, size_label, quantity, price, subtotal) VALUES ($1,$2,$3,$4,$5,$6,$7)',
          [sale.id, p.id, p.name, p.size_label || null, qty, p.price, money(cents(p.price) * qty)]
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
      await ensureSizeSchema();
      return bad(res, 'Database was just migrated. Please retry this sale (it is safe — duplicates are blocked).', 409);
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
                  OR EXISTS (SELECT 1 FROM sale_items si WHERE si.sale_id = s.id
                             AND (si.product_name ILIKE $2 OR si.size_label ILIKE $2)))`,
    params: [date, search ? likePattern(search) : null, tz()]
  };
}

api.get('/report', loadAccount, requireOwner, wrap(async (req, res) => {
  await ensureSizeSchema();
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
    db.query(`SELECT product_name, size_label, SUM(quantity)::int AS total_qty FROM sale_items GROUP BY product_name, size_label ORDER BY total_qty DESC, product_name ASC LIMIT 1`),
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
      `SELECT si.product_name, si.size_label, SUM(si.quantity)::int AS qty, SUM(si.subtotal)::float8 AS revenue
       FROM sale_items si JOIN sales s ON s.id = si.sale_id
       WHERE ${where} GROUP BY 1, 2 ORDER BY qty DESC, revenue DESC, 1 ASC, 2 ASC LIMIT 5`,
      f.params
    ),
    // Best seller in EVERY category for the selected period. Ties are broken
    // deterministically (quantity, then revenue, then name) so results are
    // fair and stable instead of arbitrary.
    db.query(
      `SELECT category, product_name, size_label, qty, revenue FROM (
         SELECT COALESCE(p.category,'General') AS category, si.product_name, si.size_label,
                SUM(si.quantity)::int AS qty, SUM(si.subtotal)::float8 AS revenue,
                ROW_NUMBER() OVER (
                  PARTITION BY COALESCE(p.category,'General')
                  ORDER BY SUM(si.quantity) DESC, SUM(si.subtotal) DESC, si.product_name ASC, si.size_label ASC
                ) AS rn
         FROM sale_items si JOIN sales s ON s.id = si.sale_id LEFT JOIN products p ON p.id = si.product_id
         WHERE ${where} GROUP BY 1, 2, 3
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
  await ensureSizeSchema();
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
    'SELECT product_name, size_label, quantity, price::float8 AS price, subtotal::float8 AS subtotal FROM sale_items WHERE sale_id = $1 ORDER BY id',
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
  await ensureSizeSchema();
  const f = salesFilter(req.query);
  const { rows } = await db.query(
    `SELECT s.transaction_id, s.sale_date, si.product_name, si.size_label, si.quantity, si.price::float8 AS price, si.subtotal::float8 AS subtotal
     FROM sales s JOIN sale_items si ON si.sale_id = s.id
     WHERE ${f.clause} ORDER BY s.id DESC, si.id ASC`,
    f.params
  );
  const head = ['Transaction No', 'Sale Date', 'Item Name', 'Size / Volume', 'Quantity', 'Unit Price', 'Subtotal'];
  const lines = [head.map(csvCell).join(',')];
  for (const r of rows) {
    lines.push([r.transaction_id, r.sale_date, r.product_name, r.size_label || 'Size not specified', r.quantity, r.price.toFixed(2), r.subtotal.toFixed(2)].map(csvCell).join(','));
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

const backupFail = (res, e, fallback) => {
  const status = e && e.status ? e.status : 500;
  const body = { error: e && e.message ? e.message : fallback };
  if (e && e.setup) body.setup = e.setup;
  if (status >= 500 && !(e && e.status)) body.error = fallback;
  return res.status(status).json(body);
};

api.get('/backups', loadAccount, requireOwner, wrap(async (req, res) => {
  const storage = backup.storageInfo();
  const meta = {
    ephemeral: backup.isEphemeral(),
    persistent: backup.isPersistent(),
    uploadLimit: backup.maxUploadBytes(),
    storage,
    auto: backup.describeAuto(),
  };
  if (storage.mode === 'unconfigured') {
    return res.json({ backups: [], latest: null, ...meta });
  }
  try {
    const backups = await backup.listBackups();
    const latest = backups.find((b) => b.valid) || null;
    res.json({ backups, latest, ...meta });
  } catch (e) {
    console.error('BACKUPS_LIST_ERR:', e && e.stack ? e.stack : e);
    return backupFail(res, e, 'Could not list backups. Check the server logs and try again.');
  }
}));

api.post('/backups', loadAccount, requireOwner, wrap(async (req, res) => {
  const kind = ['manual', 'daily', 'weekly'].includes(req.body.kind) ? req.body.kind : 'manual';
  try {
    const created = await backup.writeBackup(kind);
    res.json({
      ok: true,
      backup: created,
      ephemeral: backup.isEphemeral(),
      persistent: backup.isPersistent(),
      storage: backup.storageInfo(),
    });
  } catch (e) {
    console.error('BACKUPS_CREATE_ERR:', e && e.stack ? e.stack : e);
    return backupFail(res, e, 'Could not create the backup. Nothing was changed.');
  }
}));

api.get('/backups/:file', loadAccount, requireOwner, wrap(async (req, res) => {
  try {
    const obj = await backup.readBackupObject(req.params.file);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${obj.file}"`);
    res.setHeader('Content-Length', String(obj.size));
    res.send(obj.text);
  } catch (e) {
    return backupFail(res, e, 'Could not download that backup.');
  }
}));

api.delete('/backups/:file', loadAccount, requireOwner, wrap(async (req, res) => {
  try {
    const file = await backup.deleteBackup(req.params.file);
    res.json({ ok: true, file });
  } catch (e) {
    return backupFail(res, e, 'Could not delete that backup.');
  }
}));

// Restore: { file } restores a server-stored backup, { backup } restores an
// uploaded one. Always creates a safety backup first; the restore itself is
// one transaction, verified before COMMIT. Restoring users may sign out the
// current session (see sessionKept).
api.post('/backups/restore', loadAccount, requireOwner, wrap(async (req, res) => {
  let obj = null;
  try {
    if (req.body.file) {
      obj = await backup.readBackupFile(req.body.file);
    } else if (req.body.backup) {
      const size = Buffer.byteLength(JSON.stringify(req.body.backup), 'utf8');
      const limit = backup.maxUploadBytes();
      if (size > limit) {
        return bad(res, `Uploaded backup is too large (${(size / 1048576).toFixed(1)} MB). This server accepts at most ${(limit / 1048576).toFixed(1)} MB for uploads; restore a server-stored backup instead.`, 413);
      }
      obj = req.body.backup;
    } else {
      return bad(res, 'Choose a backup file to restore (file or uploaded backup).');
    }
    const result = await backup.restoreBackup(obj, { sessionUid: req.user.uid });
    res.json({ ok: true, counts: result.counts, safety: result.safety, sessionKept: result.sessionKept });
  } catch (e) {
    if (e.status) return backupFail(res, e, 'Restore failed. Nothing was changed.');
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
