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
// What is covered: users (incl. password hashes), products, sales,
// sale_items, stock_movements. If optional tables (e.g. expenses) are added
// later, extend BACKUP_TABLES below.
//
// Security: filenames are strictly validated, uploads are size-capped and
// fully validated before anything is touched, restores run inside one
// transaction with a mandatory safety backup first, and nothing here ever
// logs DATABASE_URL or backup contents.
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const db = require('./db');

const BACKUP_TABLES = ['users', 'products', 'sales', 'sale_items', 'stock_movements'];
const BACKUP_KINDS = ['manual', 'daily', 'weekly', 'safety'];
const FORMAT_VERSION = 1;
const FILE_RE = /^smartmart-backup-\d{8}-\d{6}-(manual|daily|weekly|safety)\.json$/;
const MAX_FILE_BYTES = 25 * 1024 * 1024; // refuse files larger than this
const MAX_ROWS_TOTAL = 500000;

function isEphemeral() {
  return !!process.env.VERCEL;
}

function backupDir() {
  if (process.env.BACKUP_DIR) {
    return path.resolve(process.env.BACKUP_DIR);
  }
  if (process.env.VERCEL) {
    return path.join(os.tmpdir(), 'smartmart-backups');
  }
  return path.join(process.cwd(), 'backups');
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function stamp(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function fileName(kind, when) {
  const k = BACKUP_KINDS.includes(kind) ? kind : 'manual';
  return `smartmart-backup-${stamp(when || new Date())}-${k}.json`;
}

// Strict filename check + realpath containment: blocks path traversal and
// malicious names even if a caller passes "../..." or absolute paths.
function safePath(file) {
  const base = path.basename(String(file || ''));
  if (!FILE_RE.test(base)) {
    const e = new Error('Not a valid SmartMart backup filename.');
    e.status = 400;
    throw e;
  }
  const dir = path.resolve(backupDir());
  const full = path.resolve(dir, base);
  if (full !== path.join(dir, base) || !full.startsWith(dir + path.sep)) {
    const e = new Error('Not a valid SmartMart backup filename.');
    e.status = 400;
    throw e;
  }
  return full;
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
  if (obj.sha256 && obj.sha256 !== hashTables(fillMissing(obj.tables))) {
    const e = new Error('Backup integrity check failed (checksum mismatch). The file may be corrupted.');
    e.status = 400;
    throw e;
  }
  return counts;
}

function fillMissing(tables) {
  const out = {};
  for (const t of BACKUP_TABLES) out[t] = tables[t] || [];
  return out;
}

function metaFor(full, stat, parsed) {
  const base = path.basename(full);
  const m = base.match(/^smartmart-backup-(\d{8})-(\d{6})-(manual|daily|weekly|safety)\.json$/);
  return {
    file: base,
    kind: m ? m[3] : 'manual',
    size: stat.size,
    created_at: (parsed && parsed.created_at) || stat.mtime.toISOString(),
    counts: (parsed && parsed.counts) || null,
    valid: !!parsed,
  };
}

// Write + verify: the file is read back, parsed, and checksum-verified
// before success is ever reported.
async function writeBackup(kind) {
  const backup = await collectBackup();
  const text = JSON.stringify(backup);
  const dir = ensureDir(backupDir());
  const full = path.join(dir, fileName(kind));
  fs.writeFileSync(full, text, { mode: 0o600 });
  const read = JSON.parse(fs.readFileSync(full, 'utf8'));
  validateBackup(read);
  if (read.sha256 !== backup.sha256) throw new Error('Backup verification failed after writing; nothing was kept.');
  const stat = fs.statSync(full);
  try {
    pruneBackups();
  } catch (e) {
    console.error('backup retention skipped:', e.message);
  }
  return { file: path.basename(full), size: stat.size, created_at: backup.created_at, counts: backup.counts };
}

function listBackups() {
  const dir = backupDir();
  ensureDir(dir);
  const files = fs.readdirSync(dir).filter((f) => FILE_RE.test(f));
  const out = [];
  for (const f of files) {
    const full = path.join(dir, f);
    let stat;
    try {
      stat = fs.statSync(full);
      if (!stat.isFile() || stat.size > MAX_FILE_BYTES) continue;
    } catch (_) {
      continue;
    }
    let parsed = null;
    try {
      const obj = JSON.parse(fs.readFileSync(full, 'utf8'));
      validateBackup(obj);
      parsed = obj;
    } catch (_) {
      parsed = null; // listed as invalid; never auto-deleted here
    }
    out.push(metaFor(full, stat, parsed));
  }
  out.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  return out;
}

function readBackupFile(file) {
  const full = safePath(file);
  let stat;
  try {
    stat = fs.statSync(full);
  } catch (_) {
    const e = new Error('Backup file not found.');
    e.status = 404;
    throw e;
  }
  if (!stat.isFile() || stat.size > MAX_FILE_BYTES) {
    const e = new Error('Backup file is not usable (missing or too large).');
    e.status = 400;
    throw e;
  }
  let obj;
  try {
    obj = JSON.parse(fs.readFileSync(full, 'utf8'));
  } catch (_) {
    const e = new Error('Backup file is not valid JSON and was rejected.');
    e.status = 400;
    throw e;
  }
  validateBackup(obj);
  return obj;
}

// Retention: keep the newest N daily + M weekly backups. Manual and safety
// backups are never auto-deleted, and the last valid backup is never removed.
function pruneBackups(opts) {
  const keepDaily = Math.max(0, parseInt(process.env.BACKUP_KEEP_DAILY || (opts && opts.daily) || 7, 10) || 0);
  const keepWeekly = Math.max(0, parseInt(process.env.BACKUP_KEEP_WEEKLY || (opts && opts.weekly) || 4, 10) || 0);
  const all = listBackups();
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
      fs.unlinkSync(safePath(b.file));
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
  const use = Object.keys(rows[0]).filter((c) => cols.includes(c));
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
    await client.query(
      `SELECT setval(pg_get_serial_sequence($1, 'id'), COALESCE((SELECT MAX(id) FROM ${t}), 1))`,
      [t]
    );
  }
}

// Full restore inside ONE transaction: safety backup first (abort if that
// fails), delete in FK-safe order, re-insert, reset sequences, verify counts
// before COMMIT. Any failure rolls everything back untouched.
async function restoreBackup(backupObj, opts) {
  const counts = validateBackup(backupObj);
  const tables = fillMissing(backupObj.tables);
  let safety = null;
  if (!opts || opts.safety !== false) {
    try {
      safety = await writeBackup('safety');
    } catch (e) {
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
    if (await tableExists(c, 'users')) await c.query('DELETE FROM users');
    await insertRows(c, 'users', tables.users);
    await insertRows(c, 'products', tables.products);
    await insertRows(c, 'sales', tables.sales);
    await insertRows(c, 'sale_items', tables.sale_items);
    await insertRows(c, 'stock_movements', tables.stock_movements);
    await resetSequences(c);
    // Verify inside the transaction: counts must match the backup.
    for (const t of BACKUP_TABLES) {
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

function describeAuto() {
  if (isEphemeral()) {
    return {
      supported: false,
      reason: 'This app is running on Vercel, whose filesystem is ephemeral: files written during a request can disappear at any time. Automatic backups to a local folder are NOT reliable here.',
      alternative: 'Use one of these instead: (1) press Create Backup + Download before important changes and keep a copy offsite; (2) run scheduled backups on the store computer with Task Scheduler (see README); (3) enable scheduled backups in your Postgres host (Neon/Supabase) as a second safety net.',
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
  isEphemeral,
  backupDir,
  ensureDir,
  safePath,
  collectBackup,
  validateBackup,
  writeBackup,
  listBackups,
  readBackupFile,
  pruneBackups,
  restoreBackup,
  describeAuto,
};
