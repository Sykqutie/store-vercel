'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

const DEFAULT_BUCKET = 'smartmart-backups';
const OBJECT_PREFIX = 'backups/';
const LOCAL_HOSTS = /^(localhost|127\.0\.0\.1|\[::1\])$/i;

function cleanValue(value) {
  return String(value || '').trim().replace(/^["'](.*)["']$/s, '$1').trim();
}

function serviceKey() {
  return cleanValue(process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function isEphemeral() {
  return !!(process.env.VERCEL || process.env.VERCEL_ENV || process.env.AWS_LAMBDA_FUNCTION_NAME);
}

function backupDir() {
  if (process.env.BACKUP_DIR) return path.resolve(process.env.BACKUP_DIR);
  if (isEphemeral()) return path.join(os.tmpdir(), 'smartmart-backups');
  return path.join(process.cwd(), 'backups');
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function bucketName() {
  return String(process.env.BACKUP_BUCKET || DEFAULT_BUCKET).trim() || DEFAULT_BUCKET;
}

function deriveSupabaseUrl() {
  const raw = cleanValue(process.env.DATABASE_URL || process.env.DATABASE_URL_UNPOOLED);
  try {
    const u = new URL(raw);
    const user = decodeURIComponent(u.username || '');
    const m = /^postgres\.([a-z0-9]{20})$/i.exec(user);
    if (m) return `https://${m[1]}.supabase.co`;
    const h = /^db\.([a-z0-9]{20})\.supabase\.co$/i.exec(u.hostname || '');
    if (h) return `https://${h[1]}.supabase.co`;
    const direct = /^([a-z0-9]{20})\.supabase\.co$/i.exec(u.hostname || '');
    if (direct) return `https://${direct[1]}.supabase.co`;
  } catch (_) {}
  return null;
}

function normalizeSupabaseUrl(raw) {
  const value = cleanValue(raw);
  if (!value) return null;
  let u;
  try {
    u = new URL(value);
  } catch (_) {
    return null;
  }
  const host = String(u.hostname || '').toLowerCase();
  if (!host || u.username || u.password) return null;
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && LOCAL_HOSTS.test(host))) return null;
  if (host.includes('pooler.supabase.com') || /^db\.[a-z0-9-]+\.supabase\.co$/i.test(host)) return null;
  return u.origin;
}

function resolveSupabaseUrl() {
  const explicit = cleanValue(process.env.SUPABASE_URL);
  const explicitUrl = normalizeSupabaseUrl(explicit);
  if (explicitUrl) return { url: explicitUrl, invalidExplicit: false };
  const derived = deriveSupabaseUrl();
  if (derived) return { url: derived, invalidExplicit: !!explicit };
  return { url: null, invalidExplicit: !!explicit };
}

function keyProblem(key) {
  if (!key) return '';
  for (let i = 0; i < key.length; i++) {
    const code = key.charCodeAt(i);
    if (code < 0x21 || code > 0x7e) {
      const hex = code.toString(16).toUpperCase().padStart(4, '0');
      return `SUPABASE_SERVICE_ROLE_KEY contains an invalid non-ASCII or whitespace character (U+${hex}) at position ${i + 1}. This usually means a masked or partially copied key was pasted; reveal and copy the real server key from Supabase, then replace the Vercel value.`;
    }
  }
  if (key.length < 20) {
    return 'SUPABASE_SERVICE_ROLE_KEY is too short to be a valid Supabase server key. Copy the real service_role or secret key from Supabase.';
  }
  return '';
}

function setupSteps() {
  const bucket = bucketName();
  return [
    `Create a PRIVATE Storage bucket named "${bucket}" in Supabase Dashboard -> Storage (or set BACKUP_BUCKET to the bucket you create). Do not make it public.`,
    'Reveal and copy the actual service_role or secret key from Supabase Dashboard -> Project Settings -> API Keys. Do not paste a masked preview (bullets or other non-ASCII characters).',
    'In Vercel -> store-vercel -> Settings -> Environment Variables add SUPABASE_SERVICE_ROLE_KEY for Production (and Preview if used). SUPABASE_URL is optional and derived from DATABASE_URL; if set, it must be the API URL https://<project-ref>.supabase.co, never the database or pooler hostname.',
    'Redeploy the project so the environment variable takes effect, then create a backup here to verify it appears in Supabase Storage.',
    'Never put the service_role key in browser code or commit it to git.',
  ];
}

function storageInfo() {
  const bucket = bucketName();
  const forced = String(process.env.BACKUP_STORAGE || '').toLowerCase();
  const key = serviceKey();
  const keyError = keyProblem(key);
  const resolved = resolveSupabaseUrl();
  const url = resolved.url;
  const urlError = key && !url
    ? resolved.invalidExplicit
      ? 'SUPABASE_URL is invalid: it must be the Supabase API URL (https://<project-ref>.supabase.co), not the database or pooler hostname. Remove it or correct it; backups are disabled until then.'
      : 'SUPABASE_URL could not be determined from DATABASE_URL. Set SUPABASE_URL to https://<project-ref>.supabase.co; backups are disabled until then.'
    : '';
  let mode;
  let message;

  if (forced === 'local') {
    mode = 'local';
  } else if (forced === 'supabase') {
    mode = key && !keyError && url ? 'supabase' : 'unconfigured';
  } else if (key) {
    mode = !keyError && url ? 'supabase' : 'unconfigured';
  } else if (isEphemeral()) {
    mode = 'unconfigured';
  } else {
    mode = 'local';
  }

  if (mode === 'supabase') {
    message = `Backups are stored durably in the private Supabase Storage bucket "${bucket}".`;
  } else if (mode === 'local') {
    message = isEphemeral()
      ? `Backups are written to "${backupDir()}", but this filesystem is ephemeral and NOT durable.`
      : `Backups are written to the local folder "${backupDir()}".`;
  } else {
    message = keyError || urlError ||
      'Persistent backup storage is not configured. Backups are disabled until Supabase Storage credentials are added.';
  }

  return {
    mode,
    configured: mode !== 'unconfigured',
    persistent: mode === 'supabase' || (mode === 'local' && !isEphemeral()),
    bucket: mode === 'supabase' ? bucket : null,
    location: mode === 'local' ? backupDir() : mode === 'supabase' ? `supabase://${bucket}/${OBJECT_PREFIX}` : null,
    message,
    setup: mode === 'unconfigured' ? setupSteps() : [],
  };
}

function unconfiguredError() {
  const e = new Error(storageInfo().message + ' No backup was created or changed.');
  e.status = 503;
  e.setup = setupSteps();
  return e;
}

function mapError(e, file) {
  const msg = String((e && e.message) || e || '');
  const status = Number((e && (e.statusCode || e.status)) || 0);
  if (/bucket.*not.*found|not.*found.*bucket/i.test(msg)) {
    const err = new Error(`Backup bucket "${bucketName()}" was not found in Supabase Storage. Create it as a PRIVATE bucket, then try again.`);
    err.status = 503;
    err.setup = setupSteps();
    return err;
  }
  if (status === 404 || /object not found/i.test(msg)) {
    const err = new Error('Backup file not found.');
    err.status = 404;
    return err;
  }
  if (status === 401 || status === 403 || /invalid.*(api key|jwt)|unauthorized|forbidden/i.test(msg)) {
    const err = new Error('Supabase Storage rejected the credentials. Check SUPABASE_SERVICE_ROLE_KEY: it must be the server-side service_role or secret key, not the anon key.');
    err.status = 503;
    err.setup = setupSteps();
    return err;
  }
  if (/bytestring|character at index|non-ascii|invalid character/i.test(msg)) {
    const err = new Error('SUPABASE_SERVICE_ROLE_KEY contains an invalid character (usually a masked key was pasted). Reveal and copy the real server key in Supabase, replace the Vercel value, then redeploy.');
    err.status = 503;
    err.setup = setupSteps();
    return err;
  }
  if (/fetch failed|enotfound|econnrefused|etimedout|network|timeout/i.test(msg)) {
    const err = new Error('Could not reach Supabase Storage. Check SUPABASE_URL and network access, then try again.');
    err.status = 503;
    return err;
  }
  if (status >= 400 && status < 500) {
    const err = new Error('Supabase Storage request failed: ' + msg);
    err.status = 503;
    return err;
  }
  if (file && /not found/i.test(msg)) {
    const err = new Error('Backup file not found.');
    err.status = 404;
    return err;
  }
  return e;
}

function assertName(file) {
  const base = path.basename(String(file || ''));
  if (!base || base !== String(file || '') || base === '.' || base === '..') {
    const e = new Error('Not a valid SmartMart backup filename.');
    e.status = 400;
    throw e;
  }
  return base;
}

let client = null;
let clientFingerprint = '';

function supabaseClient() {
  const info = storageInfo();
  if (info.mode !== 'supabase') throw unconfiguredError();
  const url = resolveSupabaseUrl().url;
  const key = serviceKey();
  const fingerprint = url + '|' + key;
  if (!client || clientFingerprint !== fingerprint) {
    const { createClient } = require('@supabase/supabase-js');
    client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { headers: { 'X-Client-Info': 'smartmart-pos-backup' } },
    });
    clientFingerprint = fingerprint;
  }
  return client;
}

function localPath(file) {
  return path.join(ensureDir(backupDir()), assertName(file));
}

async function putObject(file, text) {
  const name = assertName(file);
  const info = storageInfo();
  const size = Buffer.byteLength(text, 'utf8');
  if (info.mode === 'local') {
    fs.writeFileSync(localPath(name), text, { mode: 0o600 });
    return { file: name, size };
  }
  if (info.mode !== 'supabase') throw unconfiguredError();
  const sb = supabaseClient();
  const { error } = await sb.storage.from(bucketName()).upload(OBJECT_PREFIX + name, text, {
    contentType: 'application/json; charset=utf-8',
    cacheControl: '0',
    upsert: false,
  });
  if (error) throw mapError(error, name);
  return { file: name, size };
}

async function getObject(file) {
  const name = assertName(file);
  const info = storageInfo();
  if (info.mode === 'local') {
    let stat;
    try {
      stat = fs.statSync(localPath(name));
    } catch (_) {
      const e = new Error('Backup file not found.');
      e.status = 404;
      throw e;
    }
    if (!stat.isFile()) {
      const e = new Error('Backup file not found.');
      e.status = 404;
      throw e;
    }
    const text = fs.readFileSync(localPath(name), 'utf8');
    return { file: name, text, size: stat.size };
  }
  if (info.mode !== 'supabase') throw unconfiguredError();
  const sb = supabaseClient();
  const { data, error } = await sb.storage.from(bucketName()).download(OBJECT_PREFIX + name);
  if (error) throw mapError(error, name);
  let text;
  if (typeof data === 'string') text = data;
  else if (data && typeof data.text === 'function') text = await data.text();
  else if (data && typeof data.arrayBuffer === 'function') text = Buffer.from(await data.arrayBuffer()).toString('utf8');
  else {
    const e = new Error('Could not read the backup object from Supabase Storage.');
    e.status = 502;
    throw e;
  }
  return { file: name, text, size: Buffer.byteLength(text, 'utf8') };
}

async function listObjects() {
  const info = storageInfo();
  if (info.mode === 'local') {
    const dir = ensureDir(backupDir());
    const out = [];
    for (const f of fs.readdirSync(dir)) {
      const full = path.join(dir, f);
      try {
        const stat = fs.statSync(full);
        if (!stat.isFile()) continue;
        out.push({ file: f, size: stat.size, updated_at: stat.mtime.toISOString() });
      } catch (_) {}
    }
    return out;
  }
  if (info.mode !== 'supabase') throw unconfiguredError();
  const sb = supabaseClient();
  const out = [];
  let offset = 0;
  const limit = 1000;
  for (;;) {
    const { data, error } = await sb.storage.from(bucketName()).list(OBJECT_PREFIX.replace(/\/$/, ''), {
      limit,
      offset,
      sortBy: { column: 'name', order: 'asc' },
    });
    if (error) throw mapError(error);
    const items = data || [];
    for (const it of items) {
      if (!it || !it.name || it.name.endsWith('/')) continue;
      const meta = it.metadata || {};
      out.push({
        file: it.name,
        size: Number(meta.size || 0),
        updated_at: it.updated_at || it.created_at || null,
      });
    }
    if (items.length < limit) break;
    offset += items.length;
  }
  return out;
}

async function removeObject(file) {
  const name = assertName(file);
  const info = storageInfo();
  if (info.mode === 'local') {
    try {
      fs.unlinkSync(localPath(name));
    } catch (_) {
      const e = new Error('Backup file not found.');
      e.status = 404;
      throw e;
    }
    return;
  }
  if (info.mode !== 'supabase') throw unconfiguredError();
  const sb = supabaseClient();
  const { error } = await sb.storage.from(bucketName()).remove([OBJECT_PREFIX + name]);
  if (error) throw mapError(error, name);
}

module.exports = {
  isEphemeral,
  backupDir,
  ensureDir,
  storageInfo,
  setupSteps,
  unconfiguredError,
  putObject,
  getObject,
  listObjects,
  removeObject,
};
