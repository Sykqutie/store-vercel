'use strict';
// SmartMart backup & restore core: portable PostgreSQL data backups as JSON.
//
// Why JSON instead of pg_dump here:
// - Vercel serverless functions have an ephemeral, mostly read-only
//   filesystem and no pg_dump/pg_restore binaries, so a binary dump cannot
//   be created or restored there. A logical backup built with plain SELECTs
//   works identically on Vercel, on Windows, and against hosted Postgres
//   (Neon/Supabase), with no extra tools and no superuser rights.
// - Every row of every store table is captured (SELECT *), so current and
//   future columns (e.g. product expiry dates) are included automatically.
// - Reports are derived from sales/sale_items, so backing up the tables
//   backs up the reports. App settings are the STORE_NAME/STORE_TZ env
//   values, recorded as metadata (never secrets).
//
// What is covered: users (incl. password hashes), categories, products,
// sales, sale_items, stock_movements. If optional tables (e.g. expenses)
// are added later, extend BACKUP_TABLES below.
//
// Security: filenames are strictly validated, uploads are size-capped and
// fully validated before anything is touched, restores run inside one
// transaction with a mandatory safety backup first, and nothing here ever
// logs DATABASE_URL or backup contents.
const path = require('path');
const crypto = require('crypto');
const db = require('./db');
const store = require('./backup-store');
const categories = require('./categories');

const BACKUP_TABLES = ['users', 'categories', 'products', 'sales', 'sale_items', 'stock_movements'];
const BACKUP_KINDS = ['manual', 'daily', 'weekly', 'safety'];
const FORMAT_VERSION = 1;
const FILE_RE = /^smartmart-backup-\d{8}-\d{6}(?:-\d{3})?-(manual|daily|weekly|safety)\.json$/;
const MAX_FILE_BYTES = 25 * 1024 * 1024; // refuse files larger than this
const MAX_ROWS_TOTAL = 500000;
// Vercel rejects request bodies above ~4.5 MB before the function runs.
const VERCEL_UPLOAD_BYTES = 4 * 1024 * 1024;

const isEphemeral = store.isEphemeral;
const backupDir = store.backupDir;
const ensureDir = store.ensureDir;
const storageInfo = store.storageInfo;

function maxUploadBytes() {
  return isEphemeral() ? Math.min(MAX_FILE_BYTES, VERCEL_UPLOAD_BYTES) : MAX_FILE_BYTES;
}

function stamp(d) {
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${p(d.getMilliseconds(), 3)}`;
}

function fileName(kind, when) {
  const k = BACKUP_KINDS.includes(kind) ? kind : 'manual';
  return `smartmart-backup-${stamp(when || new Date())}-${k}.json`;
}

// Strict filename check: blocks path traversal and malicious names even if a
// caller passes "../..." or an absolute path.
function safeName(file) {
  const base = path.basename(String(file || ''));
  if (!FILE_RE.test(base) || base !== String(file || '')) {
    const e = new Error('Not a valid SmartMart backup filename.');
    e.status = 400;
    throw e;
  }
  return base;
}

function hashTables(tables) {
  return crypto.createHash('sha256').update(JSON.stringify(tables)).digest('hex');
}

async function tableExists(client, table) {
  const { rows } = await client.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1`,
    [table]
  );
  return rows.length > 0;
}

// Collect every row of every known table. SELECT * keeps future columns.
async function collectBackup() {
  const client = await db.getPoolConnect();
  try {
    const tables = {};
    for (const t of BACKUP_TABLES) {
      if (!(await tableExists(client, t))) {
        tables[t] = [];
        continue;
      }
      const { rows } = await client.query(`SELECT * FROM ${t}`);
      tables[t] = rows;
    }
    const counts = {};
    for (const t of BACKUP_TABLES) counts[t] = tables[t].length;
    const backup = {
      app: 'smartmart-pos',
      format: FORMAT_VERSION,
      created_at: new Date().toISOString(),
      store: process.env.STORE_NAME || 'SmartMart',
      timezone: process.env.STORE_TZ || 'Asia/Manila',
      tables,
      counts,
    };
    backup.sha256 = hashTables(tables);
    return backup;
  } finally {
    client.release();
  }
}

function validateBackup(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    const e = new Error('Backup file is not a valid SmartMart backup (bad JSON structure).');
    e.status = 400;
    throw e;
  }
  if (obj.app !== 'smartmart-pos' || obj.format !== FORMAT_VERSION || !obj.tables || typeof obj.tables !== 'object') {
    const e = new Error('Backup file is not a valid SmartMart backup (unknown format).');
    e.status = 400;
    throw e;
  }
  for (const k of Object.keys(obj.tables)) {
    if (!BACKUP_TABLES.includes(k)) {
      const e = new Error(`Backup file contains unrecognized table "${k}" and was rejected.`);
      e.status = 400;
      throw e;
    }
  }
  const req = (row, fields, table, i) => {
    for (const f of fields) {
      if (row[f] === undefined || row[f] === null || row[f] === '') {
        const e = new Error(`Backup "${table}" row ${i + 1} is missing "${f}" and was rejected.`);
        e.status = 400;
        throw e;
      }
    }
  };
  let total = 0;
  const counts = {};
  for (const t of BACKUP_TABLES) {
    const rows = obj.tables[t] || [];
    if (!Array.isArray(rows)) {
      const e = new Error(`Backup table "${t}" is corrupted and was rejected.`);
      e.status = 400;
      throw e;
    }
    rows.forEach((r, i) => {
      if (!r || typeof r !== 'object' || Array.isArray(r)) {
        const e = new Error(`Backup table "${t}" row ${i + 1} is corrupted and was rejected.`);
        e.status = 400;
        throw e;
      }
      if (t === 'users') {
        req(r, ['username', 'password'], t, i);
        if (String(r.username).length > 50 || String(r.password).length > 255 || String(r.password).length < 20) {
          const e = new Error(`Backup "users" row ${i + 1} failed validation and was rejected.`);
          e.status = 400;
          throw e;
        }
        if (r.role !== undefined && !['owner', 'cashier', 'admin'].includes(r.role)) {
          const e = new Error(`Backup "users" row ${i + 1} has an invalid role and was rejected.`);
          e.status = 400;
          throw e;
        }
      }
      if (t === 'categories') req(r, ['name'], t, i);
      if (t === 'products') req(r, ['barcode', 'name'], t, i);
      if (t === 'sales') req(r, ['transaction_id'], t, i);
      if (t === 'sale_items') req(r, ['product_name'], t, i);
      if (t === 'stock_movements') req(r, ['product_name'], t, i);
    });
    total += rows.length;
    counts[t] = rows.length;
  }
  if (total > MAX_ROWS_TOTAL) {
    const e = new Error('Backup file is too large to restore safely and was rejected.');
    e.status = 413;
    throw e;
  }
  if (obj.sha256) {
    const currentHash = hashTables(fillMissing(obj.tables));
    const legacyHash = hashTables(obj.tables);
    if (obj.sha256 !== currentHash && obj.sha256 !== legacyHash) {
      const e = new Error('Backup integrity check failed (checksum mismatch). The file may be corrupted.');
      e.status = 400;
      throw e;
    }
  }
  return counts;
}

function fillMissing(tables) {
  const out = {};
  for (const t of BACKUP_TABLES) out[t] = tables[t] || [];
  return out;
}

function metaFor(file, size, parsed, fallbackDate) {
  const m = file.match(/^smartmart-backup-(\d{8})-(\d{6})(?:-\d{3})?-(manual|daily|weekly|safety)\.json$/);
  return {
    file,
    kind: m ? m[3] : 'manual',
    size,
    created_at: (parsed && parsed.created_at) || fallbackDate || null,
    counts: (parsed && parsed.counts) || null,
    valid: !!parsed,
  };
}

// Write + verify: the object is read back, parsed, and checksum-verified
// before success is ever reported. On Vercel the JSON is uploaded straight to
// private Supabase Storage; no durable file is left in /tmp.
async function writeBackup(kind) {
  if (!storageInfo().configured) throw store.unconfiguredError();
  const backup = await collectBackup();
  const text = JSON.stringify(backup);
  const size = Buffer.byteLength(text, 'utf8');
  if (size > MAX_FILE_BYTES) {
    const e = new Error('Backup is larger than the 25 MB limit and was not saved. Contact support before making destructive changes.');
    e.status = 413;
    throw e;
  }
  const file = fileName(kind);
  await store.putObject(file, text);
  let read;
  try {
    read = JSON.parse((await store.getObject(file)).text);
    validateBackup(read);
    if (read.sha256 !== backup.sha256) throw new Error('checksum mismatch');
  } catch (e) {
    try {
      await store.removeObject(file);
    } catch (_) {}
    const err = new Error('Backup verification failed after writing; nothing was kept.');
    err.status = 500;
    throw err;
  }
  try {
    await pruneBackups();
  } catch (e) {
    console.error('backup retention skipped:', e.message);
  }
  return {
    file,
    size,
    created_at: backup.created_at,
    counts: backup.counts,
    storage: storageInfo().mode,
  };
}

async function listBackups() {
  const objects = await store.listObjects();
  const out = [];
  for (const o of objects) {
    if (!FILE_RE.test(o.file)) continue;
    if (o.size > MAX_FILE_BYTES) continue;
    let parsed = null;
    let size = o.size;
    try {
      const got = await store.getObject(o.file);
      size = got.size;
      const obj = JSON.parse(got.text);
      validateBackup(obj);
      parsed = obj;
    } catch (_) {
      parsed = null; // listed as invalid; never auto-deleted here
    }
    out.push(metaFor(o.file, size, parsed, o.updated_at));
  }
  out.sort((a, b) => (String(a.created_at) < String(b.created_at) ? 1 : -1));
  return out;
}

async function readBackupFile(file) {
  const name = safeName(file);
  const got = await store.getObject(name);
  if (got.size > MAX_FILE_BYTES) {
    const e = new Error('Backup file is too large to restore safely and was rejected.');
    e.status = 400;
    throw e;
  }
  let obj;
  try {
    obj = JSON.parse(got.text);
  } catch (_) {
    const e = new Error('Backup file is not valid JSON and was rejected.');
    e.status = 400;
    throw e;
  }
  validateBackup(obj);
  return obj;
}

async function readBackupObject(file) {
  const name = safeName(file);
  const got = await store.getObject(name);
  if (got.size > MAX_FILE_BYTES) {
    const e = new Error('Backup file is too large to download.');
    e.status = 400;
    throw e;
  }
  return got;
}

async function deleteBackup(file) {
  const name = safeName(file);
  const all = await listBackups();
  const valid = all.filter((b) => b.valid);
  const target = valid.find((b) => b.file === name);
  if (target && valid.length <= 1) {
    const e = new Error('Refusing to delete the only available valid backup. Create a newer backup first.');
    e.status = 409;
    throw e;
  }
  await store.removeObject(name);
  return name;
}

// Retention: keep the newest N daily + M weekly backups. Manual and safety
// backups are never auto-deleted, and the last valid backup is never removed.
async function pruneBackups(opts) {
  const keepDaily = Math.max(0, parseInt(process.env.BACKUP_KEEP_DAILY || (opts && opts.daily) || 7, 10) || 0);
  const keepWeekly = Math.max(0, parseInt(process.env.BACKUP_KEEP_WEEKLY || (opts && opts.weekly) || 4, 10) || 0);
  const all = await listBackups();
  const valid = all.filter((b) => b.valid);
  if (valid.length <= 1) return { deleted: [] };
  const byKind = (k) => valid.filter((b) => b.kind === k);
  const keep = new Set();
  byKind('daily').slice(0, keepDaily).forEach((b) => keep.add(b.file));
  byKind('weekly').slice(0, keepWeekly).forEach((b) => keep.add(b.file));
  valid.filter((b) => b.kind === 'manual' || b.kind === 'safety').forEach((b) => keep.add(b.file));
  const candidates = valid.filter((b) => !keep.has(b.file));
  // Never delete the only remaining backup.
  const deletable = keep.size === 0 ? candidates.slice(0, Math.max(0, candidates.length - 1)) : candidates;
  const deleted = [];
  for (const b of deletable) {
    try {
      await store.removeObject(b.file);
      deleted.push(b.file);
    } catch (e) {
      console.error('backup prune skipped', b.file + ':', e.message);
    }
  }
  return { deleted };
}

async function dbColumns(client, table) {
  const { rows } = await client.query(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`,
    [table]
  );
  return rows.map((r) => r.column_name);
}

// Chunked multi-row INSERT using only columns that exist in the live table,
// so backups stay restorable across minor schema changes.
async function insertRows(client, table, rows) {
  if (!rows.length) return;
  const cols = await dbColumns(client, table);
  const use = [];
  for (const row of rows) {
    for (const c of Object.keys(row)) if (cols.includes(c) && !use.includes(c)) use.push(c);
  }
  if (!use.length) return;
  const CHUNK = 200;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const vals = [];
    const marks = slice.map((r) => {
      const row = use.map((c) => {
        vals.push(r[c] === undefined ? null : r[c]);
        return `$${vals.length}`;
      });
      return `(${row.join(',')})`;
    });
    await client.query(`INSERT INTO ${table} (${use.map((c) => `"${c}"`).join(',')}) VALUES ${marks.join(',')}`, vals);
  }
}

async function resetSequences(client) {
  for (const t of BACKUP_TABLES) {
    if (!(await tableExists(client, t))) continue;
    const cols = await dbColumns(client, t);
    if (!cols.includes('id')) continue;
    const { rows: [seq] } = await client.query(`SELECT pg_get_serial_sequence($1, 'id') AS name`, [t]);
    if (!seq || !seq.name) continue;
    const { rows: [max] } = await client.query(`SELECT MAX(id)::bigint AS id FROM ${t}`);
    if (max && max.id !== null && max.id !== undefined) {
      await client.query(`SELECT setval($1::regclass, $2::bigint)`, [seq.name, max.id]);
    } else {
      await client.query(`SELECT setval($1::regclass, 1, false)`, [seq.name]);
    }
  }
}

// Full restore inside ONE transaction: safety backup first (abort if that
// fails), delete in FK-safe order, re-insert, reset sequences, verify counts
// before COMMIT. Any failure rolls everything back untouched.
async function restoreBackup(backupObj, opts) {
  if (!storageInfo().configured) throw store.unconfiguredError();
  const counts = validateBackup(backupObj);
  const tables = fillMissing(backupObj.tables);
  const backupHasCategories = Array.isArray(backupObj.tables.categories);
  let safety = null;
  if (!opts || opts.safety !== false) {
    try {
      safety = await writeBackup('safety');
    } catch (e) {
      if (e && e.status) throw e;
      const err = new Error('Could not create a safety backup of the current data, so restore was aborted. Nothing was changed.');
      err.status = 500;
      throw err;
    }
  }
  const result = await db.tx(async (c) => {
    await c.query('DELETE FROM sale_items');
    await c.query('DELETE FROM stock_movements');
    await c.query('DELETE FROM sales');
    if (await tableExists(c, 'products')) await c.query('DELETE FROM products');
    if (await tableExists(c, 'categories')) await c.query('DELETE FROM categories');
    if (await tableExists(c, 'users')) await c.query('DELETE FROM users');
    await insertRows(c, 'users', tables.users);
    await insertRows(c, 'categories', tables.categories);
    await insertRows(c, 'products', tables.products);
    if (!backupHasCategories) {
      await c.query(
        'INSERT INTO categories (name) SELECT x FROM unnest($1::text[]) AS x ON CONFLICT DO NOTHING',
        [categories.DEFAULT_CATEGORIES]
      );
      await c.query(
        `INSERT INTO categories (name)
         SELECT DISTINCT TRIM(category) FROM products
         WHERE category IS NOT NULL AND TRIM(category) <> ''
         ON CONFLICT DO NOTHING`
      );
    }
    await insertRows(c, 'sales', tables.sales);
    await insertRows(c, 'sale_items', tables.sale_items);
    await insertRows(c, 'stock_movements', tables.stock_movements);
    await resetSequences(c);
    // Verify inside the transaction: counts must match the backup.
    for (const t of BACKUP_TABLES) {
      if (t === 'categories' && !backupHasCategories) continue;
      if (!(await tableExists(c, t))) continue;
      const { rows: [r] } = await c.query(`SELECT COUNT(*)::int AS n FROM ${t}`);
      if (r.n !== tables[t].length) {
        throw new Error(`Restore verification failed on "${t}" (expected ${tables[t].length}, found ${r.n}). Nothing was changed.`);
      }
    }
    return { counts };
  });
  // Is the current session's account still present after restore?
  let sessionKept = true;
  try {
    if (opts && opts.sessionUid) {
      const { rows } = await db.query('SELECT 1 FROM users WHERE id = $1', [opts.sessionUid]);
      sessionKept = rows.length > 0;
    }
  } catch (_) {
    sessionKept = false;
  }
  return { counts: result.counts, safety, sessionKept };
}

function isPersistent() {
  return storageInfo().persistent;
}

function describeAuto() {
  const storage = storageInfo();
  if (storage.mode === 'supabase') {
    return {
      supported: false,
      mode: 'off',
      reason: `Backups are stored durably in the private Supabase Storage bucket "${storage.bucket}". Automatic daily/weekly scheduling is not enabled in this deployment; create backups manually or add a scheduled job.`,
      alternative: null,
    };
  }
  if (storage.mode === 'unconfigured') {
    return {
      supported: false,
      mode: 'off',
      reason: 'Persistent backup storage is not configured, so backups are disabled.',
      alternative: storage.setup.join(' '),
    };
  }
  const mode = process.env.BACKUP_AUTO || 'off';
  return {
    supported: mode === 'daily' || mode === 'weekly',
    mode,
    reason: mode === 'daily' || mode === 'weekly'
      ? `Local scheduler active (${mode}). Backups are kept in the local backup folder with retention applied.`
      : 'Set BACKUP_AUTO=daily or BACKUP_AUTO=weekly in .env and keep the store server running to enable local automatic backups.',
    alternative: null,
  };
}

module.exports = {
  BACKUP_TABLES,
  BACKUP_KINDS,
  MAX_FILE_BYTES,
  maxUploadBytes,
  isEphemeral,
  isPersistent,
  storageInfo,
  backupDir,
  ensureDir,
  collectBackup,
  validateBackup,
  writeBackup,
  listBackups,
  readBackupFile,
  readBackupObject,
  deleteBackup,
  pruneBackups,
  restoreBackup,
  describeAuto,
};
