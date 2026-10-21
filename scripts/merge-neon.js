'use strict';
// ---------------------------------------------------------------------------
// Non-destructive merge: copy the OLD Neon data into Supabase.
//
//   node --env-file=.env scripts/merge-neon.js            # dry run (writes nothing)
//   node --env-file=.env scripts/merge-neon.js --apply    # apply, one transaction
//
// Rules (these are the whole point of this tool):
//   * NOTHING is ever deleted, truncated or overwritten by default.
//   * An existing Supabase user is NEVER modified. A new user is only ADDED
//     when the username does not exist yet (case-insensitive).
//   * An existing Supabase product is only updated when you explicitly pass
//     --on-conflict=neon. Default is to leave it alone and report it.
//   * Password hashes are copied verbatim (bcrypt) but never printed - only
//     the algorithm family is shown.
//   * Everything runs inside ONE transaction on the target: if anything fails,
//     the target is left exactly as it was.
//   * A safety backup of the target is written before an --apply.
//   * An undo file (backups/merge-undo-<timestamp>.json) lists everything that
//     was inserted, so the merge can be reversed by hand.
//
// Source (old Neon) URL: NEON_DATABASE_URL (env var or .env - never committed)
// Target (Supabase) URL: DATABASE_URL
// ---------------------------------------------------------------------------
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const db = require('../lib/db.js');

const ARGS = process.argv.slice(2);
const APPLY = ARGS.includes('--apply');
const CONFLICT = (ARGS.find((a) => a.startsWith('--on-conflict=')) || '').split('=')[1] || 'skip';
if (!['skip', 'neon', 'supabase'].includes(CONFLICT)) {
  console.error('--on-conflict must be one of: skip | neon | supabase');
  process.exit(2);
}

const hashKind = (h) => {
  const s = String(h || '');
  if (/^\$2[abxy]\$\d{2}\$/.test(s)) return 'bcrypt';
  if (/^\$argon2/.test(s)) return 'argon2';
  if (/^[a-f0-9]{32}$/i.test(s)) return 'md5';
  if (/^[a-f0-9]{40}$/i.test(s)) return 'sha1';
  if (/^[a-f0-9]{64}$/i.test(s)) return 'sha256';
  return s ? 'unknown' : 'empty';
};

// The old Neon host: plain Postgres with a publicly-trusted certificate.
// sslmode / channel_binding are stripped from the URL so that pg cannot
// override the explicit TLS options below (pg >= 8.23 lets the parsed
// sslmode win over an explicit `ssl` object).
function sourcePool() {
  const raw = (process.env.NEON_DATABASE_URL || '').trim();
  if (!raw) {
    console.error('NEON_DATABASE_URL is not set. Add it to .env (it is git-ignored) and retry.');
    process.exit(2);
  }
  const url = raw
    .replace(/([?&])sslmode=[^&]*/gi, '$1')
    .replace(/([?&])channel_binding=[^&]*/gi, '$1')
    .replace(/&&+/g, '&')
    .replace(/[?&]$/, '');
  return new Pool({ connectionString: url, ssl: { rejectUnauthorized: true }, max: 1, connectionTimeoutMillis: 15000 });
}

const num = (v) => (v === null || v === undefined ? null : Number(v));
const sameNum = (a, b) => Number(a) === Number(b);

async function readSource(pool) {
  const products = await pool.query(
    `SELECT id, barcode, name, category, cost_price, price, stock, low_stock_threshold, created_at, updated_at
     FROM products ORDER BY id`);
  const users = await pool.query(
    `SELECT id, username, password, role, active, created_at FROM users ORDER BY id`);
  const movements = await pool.query(
    `SELECT id, product_id, product_name, change_qty, reason, note, created_at
     FROM stock_movements ORDER BY id`);
  return { products: products.rows, users: users.rows, movements: movements.rows };
}

async function readTarget() {
  const products = await db.query(
    `SELECT id, barcode, name, category, cost_price, price, stock, low_stock_threshold FROM products ORDER BY id`);
  const users = await db.query(
    `SELECT id, username, role, active FROM users ORDER BY id`);
  const movements = await db.query(
    `SELECT id, product_id, product_name, change_qty, reason, note, created_at FROM stock_movements ORDER BY id`);
  return { products: products.rows, users: users.rows, movements: movements.rows };
}

(async () => {
  console.log('=== SmartMart Neon -> Supabase merge ===');
  console.log('mode         :', APPLY ? 'APPLY (writes to the target)' : 'DRY RUN (writes nothing)');
  console.log('conflicts    :', CONFLICT, '(skip | neon | supabase)');
  console.log('target host  :', db.publicHost());
  console.log('');

  const sp = sourcePool();
  let src;
  try {
    src = await readSource(sp);
  } finally {
    await sp.end().catch(() => {});
  }
  const tgt = await readTarget();

  console.log(`source (Neon)   : products=${src.products.length} users=${src.users.length} stock_movements=${src.movements.length}`);
  console.log(`target (Supabase): products=${tgt.products.length} users=${tgt.users.length} stock_movements=${tgt.movements.length}`);
  console.log('');

  const tgtByBarcode = new Map(tgt.products.map((p) => [String(p.barcode), p]));
  const tgtUsers = new Map(tgt.users.map((u) => [String(u.username).toLowerCase(), u]));

  // ---------- products ----------
  const productsToInsert = [];
  const productConflicts = [];
  const productsToUpdate = [];
  for (const p of src.products) {
    const key = String(p.barcode);
    const t = tgtByBarcode.get(key);
    if (!t) {
      productsToInsert.push(p);
      continue;
    }
    const diffs = [];
    if (String(t.name) !== String(p.name)) diffs.push(`name(${t.name} != ${p.name})`);
    if (String(t.category) !== String(p.category)) diffs.push(`category(${t.category} != ${p.category})`);
    if (!sameNum(t.cost_price, p.cost_price)) diffs.push(`cost(${t.cost_price} != ${p.cost_price})`);
    if (!sameNum(t.price, p.price)) diffs.push(`price(${t.price} != ${p.price})`);
    if (!sameNum(t.stock, p.stock)) diffs.push(`stock(${t.stock} != ${p.stock})`);
    if (!sameNum(t.low_stock_threshold, p.low_stock_threshold)) diffs.push(`threshold(${t.low_stock_threshold} != ${p.low_stock_threshold})`);
    if (diffs.length === 0) continue; // identical, nothing to do
    productConflicts.push({ target: t, source: p, diffs });
    if (CONFLICT === 'neon') productsToUpdate.push({ target: t, source: p });
  }
  console.log('--- products ---');
  console.log('identical (skip) :', src.products.length - productsToInsert.length - productConflicts.length);
  console.log('to insert        :', productsToInsert.length);
  for (const p of productsToInsert) {
    console.log(`   + barcode=${p.barcode} name=${JSON.stringify(p.name)} stock=${p.stock} price=${p.price}`);
  }
  console.log('conflicts        :', productConflicts.length);
  for (const c of productConflicts) {
    console.log(`   ! barcode=${c.source.barcode} target_id=${c.target.id} -> ${c.diffs.join(', ')}`);
    console.log(`     action: ${CONFLICT === 'neon' ? 'UPDATE target to Neon values' : CONFLICT === 'supabase' ? 'KEEP Supabase values' : 'SKIP (target left unchanged)'}`);
  }

  // ---------- users ----------
  const usersToInsert = [];
  const userConflicts = [];
  for (const u of src.users) {
    const key = String(u.username).toLowerCase();
    const t = tgtUsers.get(key);
    if (!t) {
      usersToInsert.push({ ...u, role: u.role === 'admin' ? 'owner' : u.role });
    } else {
      userConflicts.push({ target: t, source: u });
    }
  }
  console.log('\n--- users ---');
  console.log('to insert        :', usersToInsert.length);
  for (const u of usersToInsert) {
    console.log(`   + username=${JSON.stringify(u.username)} role=${u.role} active=${u.active} hash=${hashKind(u.password)}`);
  }
  console.log('already exists   :', userConflicts.length, '(never modified)');
  for (const c of userConflicts) {
    console.log(`   = username=${JSON.stringify(c.source.username)} -> existing target row id=${c.target.id} role=${c.target.role} (skipped)`);
  }

  // ---------- stock movements ----------
  // product_id is remapped from the source id to the target id via barcode.
  // Products that do not exist in the target yet are created first, so their
  // target id is only known during the apply phase - the plan below records
  // them as "pending" and the id is filled in once the product insert returns.
  const srcProductById = new Map(src.products.map((p) => [p.id, p]));
  const productIdMap = new Map(); // source product id -> target product id
  const pendingProducts = new Map(); // source product id -> { barcode }
  for (const p of src.products) {
    const t = tgtByBarcode.get(String(p.barcode));
    if (t) productIdMap.set(p.id, t.id);
    else pendingProducts.set(p.id, { barcode: p.barcode, name: p.name });
  }
  const movementKey = (m) => [m.product_name, m.change_qty, m.reason, m.note || '', new Date(m.created_at).toISOString()].join('|');
  const tgtMovementKeys = new Set(tgt.movements.map(movementKey));
  const movementsToInsert = [];
  const movementsUnmapped = [];
  const movementsDuplicate = [];
  for (const m of src.movements) {
    if (tgtMovementKeys.has(movementKey(m))) { movementsDuplicate.push(m); continue; }
    const sp2 = srcProductById.get(m.product_id);
    let targetId = null;
    let pending = false;
    if (sp2) {
      const t = tgtByBarcode.get(String(sp2.barcode));
      if (t) targetId = t.id;
      else pending = pendingProducts.has(sp2.id);
    }
    if (m.product_id !== null && m.product_id !== undefined && targetId === null && !pending) {
      movementsUnmapped.push(m);
    }
    movementsToInsert.push({ ...m, targetProductId: targetId, pendingProduct: pending, sourceProductId: sp2 ? sp2.id : null });
  }
  console.log('\n--- stock_movements ---');
  console.log('to insert        :', movementsToInsert.length);
  for (const m of movementsToInsert) {
    const where = m.targetProductId !== null ? 'existing target id ' + m.targetProductId
      : m.pendingProduct ? 'new product (id assigned on insert)'
      : 'NULL (source product unknown)';
    console.log(`   + ${m.product_name} qty=${m.change_qty} reason=${m.reason} -> product_id=${where}`);
  }
  console.log('already present  :', movementsDuplicate.length);
  console.log('unmapped product :', movementsUnmapped.length);

  if (!APPLY) {
    console.log('\nDRY RUN - nothing was written. Re-run with --apply to execute this plan.');
    process.exit(0);
  }

  // ---------- apply ----------
  const backup = require('../lib/backup.js');
  console.log('\n--- applying ---');
  try {
    const safety = await backup.writeBackup('safety');
    console.log('safety backup    :', safety.file);
  } catch (e) {
    console.error('Could not write the safety backup, so nothing was changed:', e.message);
    process.exit(1);
  }

  const undo = { created_at: new Date().toISOString(), target: db.publicHost(), products: [], users: [], stock_movements: [] };
  await db.tx(async (c) => {
    // products
    for (const p of productsToInsert) {
      const r = await c.query(
        `INSERT INTO products (barcode, name, category, cost_price, price, stock, low_stock_threshold, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7, COALESCE($8, now()), COALESCE($9, now()))
         RETURNING id`,
        [p.barcode, p.name, p.category || 'General', p.cost_price, p.price, p.stock,
          p.low_stock_threshold === null ? 5 : p.low_stock_threshold, p.created_at, p.updated_at]);
      undo.products.push({ id: r.rows[0].id, barcode: p.barcode });
      // remember the new id so stock movements can point at it
      productIdMap.set(p.id, r.rows[0].id);
    }
    for (const u of productsToUpdate) {
      await c.query(
        `UPDATE products SET name=$1, category=$2, cost_price=$3, price=$4, stock=$5,
                low_stock_threshold=$6, updated_at=now() WHERE id=$7`,
        [u.source.name, u.source.category || 'General', u.source.cost_price, u.source.price,
          u.source.stock, u.source.low_stock_threshold === null ? 5 : u.source.low_stock_threshold, u.target.id]);
      undo.products.push({
        id: u.target.id, barcode: u.source.barcode, updated: true,
        previous: {
          name: u.target.name, category: u.target.category, cost_price: u.target.cost_price,
          price: u.target.price, stock: u.target.stock, low_stock_threshold: u.target.low_stock_threshold
        }
      });
    }
    // users
    for (const u of usersToInsert) {
      const r = await c.query(
        `INSERT INTO users (username, password, role, active, created_at)
         VALUES ($1,$2,$3,$4, COALESCE($5, now())) RETURNING id`,
        [u.username, u.password, u.role, u.active === false ? false : true, u.created_at]);
      undo.users.push({ id: r.rows[0].id, username: u.username });
    }
    // stock movements
    for (const m of movementsToInsert) {
      const productId = m.sourceProductId !== null && m.sourceProductId !== undefined
        ? (productIdMap.has(m.sourceProductId) ? productIdMap.get(m.sourceProductId) : null)
        : null;
      const r = await c.query(
        `INSERT INTO stock_movements (product_id, product_name, change_qty, reason, note, created_at)
         VALUES ($1,$2,$3,$4,$5, COALESCE($6, now())) RETURNING id`,
        [productId, m.product_name, m.change_qty, m.reason || 'adjust', m.note || null, m.created_at]);
      undo.stock_movements.push({ id: r.rows[0].id, product_id: productId });
    }
    // verify
    const counts = await c.query(
      `SELECT (SELECT COUNT(*)::int FROM products) AS p, (SELECT COUNT(*)::int FROM users) AS u,
              (SELECT COUNT(*)::int FROM stock_movements) AS m`);
    console.log('target counts now:', JSON.stringify(counts.rows[0]));
  });

  const undoFile = path.join(backup.backupDir(), `merge-undo-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(undoFile, JSON.stringify(undo, null, 2), { mode: 0o600 });
  console.log('undo file        :', undoFile);
  console.log('MERGE COMPLETE.');
  process.exit(0);
})().catch((e) => {
  console.error('FAILED (target unchanged if the error happened inside the transaction):', e.code || '', e.message);
  process.exit(1);
});
