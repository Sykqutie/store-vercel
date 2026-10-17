'use strict';
// SmartMart owner account recovery (local administrator utility).
//
// Run on the computer hosting the app:
//   npm run recover            interactive recovery (reset or recreate the owner)
//   npm run recover -- --list  list accounts (usernames + roles only, no changes)
//   npm run recover -- --help  show help
//
// Security model:
// - There is deliberately NO web endpoint for password resets. Anyone able
//   to run this script already controls the server, which is the trust root.
// - Never prints passwords, hashes, tokens, or DATABASE_URL contents.
// - Reset path only UPDATES an existing owner row (WHERE role = 'owner').
//   Create path only runs when ZERO owner rows exist, and re-checks inside
//   the transaction, so duplicates are impossible.
// - Cashier rows are never selected for modification and never touched.
// - All queries are parameterized. Passwords are hashed with bcryptjs
//   (cost 10), the same library and cost the API uses.
const readline = require('readline');
const bcrypt = require('bcryptjs');
const db = require('../lib/db');
const SCHEMA = require('../lib/schema');

const OWNER_ROLES = ['owner', 'admin']; // 'admin' = pre-migration label, treated as owner

const ask = (q) => {
  if (process.stdin.isTTY && process.stdout.isTTY) {
    return new Promise((resolve) => {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      rl.question(q, (a) => { rl.close(); resolve(a); });
    });
  }
  process.stdout.write(q);
  return nextLine();
};

// Single shared line queue for piped / non-interactive stdin. (Multiple
// readline interfaces on one pipe race each other: the first buffers all
// input and later prompts silently get EOF. One queue avoids that.)
let lineQueue = null;
function queuedLines() {
  if (lineQueue) return lineQueue;
  lineQueue = { lines: [], waiters: [], closed: false };
  const rl = readline.createInterface({ input: process.stdin, terminal: false });
  rl.on('line', (l) => {
    const line = String(l).replace(/\r$/, '');
    if (lineQueue.waiters.length) lineQueue.waiters.shift()(line);
    else lineQueue.lines.push(line);
  });
  rl.on('close', () => {
    lineQueue.closed = true;
    let w;
    while ((w = lineQueue.waiters.shift())) w(null);
  });
  return lineQueue;
}
const nextLine = () => new Promise((resolve) => {
  const q = queuedLines();
  if (q.lines.length) return resolve(q.lines.shift());
  if (q.closed) return resolve(null); // EOF: callers treat as abort, changing nothing
  q.waiters.push(resolve);
});

// Hidden password entry (no echo) on a TTY; queued line-read when piped,
// so scripted tests and non-interactive shells still work.
function askSecret(prompt) {
  if (process.stdin.isTTY && process.stdout.isTTY) {
    return new Promise((resolve) => {
      process.stdout.write(prompt);
      const stdin = process.stdin;
      let pw = '';
      const cleanup = () => { stdin.setRawMode(false); stdin.pause(); stdin.removeListener('data', onData); };
      const done = () => { cleanup(); process.stdout.write('\n'); resolve(pw); };
      const onData = (ch) => {
        const s = String(ch);
        if (s === '\r' || s === '\n' || s === '\u0004') return done();
        if (s === '\u0003') { cleanup(); process.stdout.write('\nAborted.\n'); process.exit(1); }
        if (s === '\u007f' || s === '\b') { pw = pw.slice(0, -1); return; }
        if (s >= ' ' || s === '\t') pw += s;
      };
      stdin.setRawMode(true);
      stdin.resume();
      stdin.setEncoding('utf8');
      stdin.on('data', onData);
    });
  }
  process.stdout.write(prompt);
  return nextLine();
}

const validUsername = (u) => typeof u === 'string' && u.trim().length >= 3 && u.trim().length <= 50;
const validPassword = (p) => typeof p === 'string' && p.length >= 8 && p.length <= 72;

// Classify a stored password WITHOUT printing it. Only the algorithm family is
// returned, so it is safe to show in the audit output. Anything that is not a
// bcrypt hash cannot be verified by the app and must be reset.
function hashKind(stored) {
  const s = String(stored || '');
  if (/^\$2[abxy]\$\d{2}\$/.test(s)) return 'bcrypt (ok)';
  if (/^\$argon2/.test(s)) return 'argon2 (INCOMPATIBLE - reset needed)';
  if (/^[a-f0-9]{32}$/i.test(s)) return 'md5 (INCOMPATIBLE - reset needed)';
  if (/^[a-f0-9]{40}$/i.test(s)) return 'sha1 (INCOMPATIBLE - reset needed)';
  if (/^[a-f0-9]{64}$/i.test(s)) return 'sha256 (INCOMPATIBLE - reset needed)';
  if (!s) return 'empty (INCOMPATIBLE - reset needed)';
  return 'unknown format (INCOMPATIBLE - reset needed)';
}

function dbHint(e) {
  const code = e && e.code;
  if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'ETIMEDOUT' || /timeout/i.test(e.message || '')) {
    return 'The database server cannot be reached. Check that DATABASE_URL in .env points at a running PostgreSQL ' +
      '(locally: make sure the smartmart-pg container is up with `docker start smartmart-pg`). Nothing was changed.';
  }
  if (code === '28P01') return 'Authentication failed: the username or password in DATABASE_URL is wrong. Fix .env and retry. Nothing was changed.';
  if (code === '3D000') return 'The database named in DATABASE_URL does not exist. Create it first (e.g. `docker exec smartmart-pg createdb -U postgres store`). Nothing was changed.';
  return 'Database error (' + (code || 'unknown') + '): ' + String((e && e.message) || e).split('\n')[0] + '. Nothing was changed.';
}

async function tableExists() {
  try {
    await db.query('SELECT 1 FROM users LIMIT 1');
    return true;
  } catch (e) {
    if (e.code === '42P01') return false; // undefined_table: fresh database
    throw e;
  }
}

async function listOwners() {
  const { rows } = await db.query(
    `SELECT id, username, role, active, created_at FROM users
     WHERE role = ANY($1::text[]) ORDER BY id ASC`,
    [OWNER_ROLES]
  );
  return rows;
}

async function doList() {
  // Full, read-only audit of the actual accounts. Never prints passwords or
  // hashes - only usernames, roles, active flag, and the hash FORMAT.
  const { rows } = await db.query(
    'SELECT id, username, role, active, created_at, password FROM users ORDER BY id ASC'
  );
  if (rows.length === 0) {
    console.log('No accounts found. The database is installed but has no users.');
    console.log('Run `npm run recover` (no flags) to create the initial owner.');
    return;
  }
  console.log('Accounts found: ' + rows.length);
  for (const u of rows) {
    console.log('  - username=' + JSON.stringify(u.username) +
      '  role=' + JSON.stringify(u.role) +
      '  ' + (u.active === false ? 'DEACTIVATED' : 'active') +
      '  password=' + hashKind(u.password));
  }
  const ownerCount = rows.filter((u) => OWNER_ROLES.includes(u.role)).length;
  const cashierCount = rows.filter((u) => u.role === 'cashier').length;
  console.log('Summary: owners=' + ownerCount + ' cashiers=' + cashierCount +
    ' other=' + (rows.length - ownerCount - cashierCount));

  const dups = await db.query(
    'SELECT lower(username) AS name, count(*)::int AS n FROM users GROUP BY lower(username) HAVING count(*) > 1'
  );
  if (dups.rows.length) {
    console.log('WARNING: case-insensitive duplicate usernames: ' +
      dups.rows.map((d) => JSON.stringify(d.name) + ' x' + d.n).join(', '));
  }
  const badHash = rows.filter((u) => !/^\$2[abxy]\$\d{2}\$/.test(String(u.password || '')));
  if (badHash.length) {
    console.log('WARNING: ' + badHash.length + ' account(s) do not have a bcrypt password and cannot sign in.');
    console.log('         Run `npm run recover` to reset the owner, then reset each cashier from the Users page.');
  }
}

async function doReset(owners) {
  let target = null;
  if (owners.length === 1) {
    const ans = (await ask(`Reset password for owner '${owners[0].username}'? [Y/n]: `)).trim().toLowerCase();
    if (ans && ans !== 'y' && ans !== 'yes') { console.log('Aborted. Nothing was changed.'); return 1; }
    target = owners[0];
  } else {
    console.log('Multiple owner rows found:');
    owners.forEach((o) => console.log(`  - ${o.username}${o.active ? '' : ' [deactivated]'}`));
    const name = (await ask('Type the owner username to reset: ')).trim();
    target = owners.find((o) => o.username === name) || null;
    if (!target) { console.log('Unknown owner username. Aborted. Nothing was changed.'); return 1; }
  }

  const pw1 = await askSecret('New password (8-72 characters, hidden): ');
  if (!validPassword(pw1)) { console.log('Password must be 8 to 72 characters. Aborted. Nothing was changed.'); return 1; }
  const pw2 = await askSecret('Type the new password again: ');
  if (pw1 !== pw2) { console.log('Passwords do not match. Aborted. Nothing was changed.'); return 1; }

  // Explicit confirmation before touching an existing owner.
  const confirm = (await ask(`Type RESET to change the password for '${target.username}': `)).trim();
  if (confirm !== 'RESET') { console.log('Confirmation did not match. Aborted. Nothing was changed.'); return 1; }

  let reactivate = target.active;
  if (!target.active) {
    const r = (await ask(`Owner '${target.username}' is deactivated (cannot sign in). Reactivate it? [Y/n]: `)).trim().toLowerCase();
    reactivate = !(r && r !== 'y' && r !== 'yes');
  }

  const hash = await bcrypt.hash(pw1, 10);
  const { rowCount } = await db.query(
    `UPDATE users SET password = $1, role = 'owner', active = $2
     WHERE id = $3 AND role = ANY($4::text[])`,
    [hash, reactivate, target.id, OWNER_ROLES]
  );
  if (rowCount !== 1) {
    console.log('Owner row changed unexpectedly during reset. Aborted. Verify accounts with `--list`.');
    return 1;
  }
  console.log(`Password updated for owner '${target.username}'. Sign in at /login with the new password.`);
  console.log('Cashier accounts, products, inventory, and sales were not modified.');
  return 0;
}

async function doCreate() {
  console.log('No owner account found. This will CREATE the initial owner (nothing else is touched).');
  const username = (await ask('Choose an owner username (3-50 characters): ')).trim();
  if (!validUsername(username)) { console.log('Username must be 3 to 50 characters. Aborted. Nothing was changed.'); return 1; }
  const { rows: [taken] } = await db.query('SELECT id FROM users WHERE lower(username) = lower($1)', [username]);
  if (taken) { console.log('That username is already taken (by a non-owner row). Choose another. Nothing was changed.'); return 1; }

  const pw1 = await askSecret('New password (8-72 characters, hidden): ');
  if (!validPassword(pw1)) { console.log('Password must be 8 to 72 characters. Aborted. Nothing was changed.'); return 1; }
  const pw2 = await askSecret('Type the new password again: ');
  if (pw1 !== pw2) { console.log('Passwords do not match. Aborted. Nothing was changed.'); return 1; }

  const confirm = (await ask(`Type CREATE to create owner '${username}': `)).trim();
  if (confirm !== 'CREATE') { console.log('Confirmation did not match. Aborted. Nothing was changed.'); return 1; }

  const hash = await bcrypt.hash(pw1, 10);
  const created = await db.tx(async (c) => {
    // Re-check inside the transaction: never create a second owner.
    const { rows: [n] } = await c.query(
      `SELECT COUNT(*)::int AS n FROM users WHERE role = ANY($1::text[])`, [OWNER_ROLES]
    );
    if (n.n > 0) return false;
    await c.query(
      `INSERT INTO users (username, password, role, active) VALUES ($1, $2, 'owner', TRUE)`,
      [username, hash]
    );
    return true;
  });
  if (!created) {
    console.log('An owner account appeared while you were confirming. Use the reset path instead (`npm run recover`). Nothing was changed.');
    return 1;
  }
  console.log(`Owner '${username}' created with the owner role. Sign in at /login.`);
  return 0;
}

function help() {
  console.log([
    'SmartMart owner account recovery.',
    '',
    '  npm run recover            interactive: reset an existing owner password,',
    '                             or create the owner if none exists',
    '  npm run recover -- --list  audit all accounts: username, role, active,',
    '                             password format (read-only, no hashes shown)',
    '',
    'Notes:',
    '- Run on the server computer. There is no web password reset by design.',
    '- Needs DATABASE_URL in .env to point at the store database.',
    '- Cashiers, products, inventory, and sales are never modified.'
  ].join('\n'));
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) { help(); return 0; }

  console.log('SmartMart owner account recovery');
  console.log('--------------------------------');

  let schemaReady = false;
  try {
    schemaReady = await tableExists();
  } catch (e) {
    console.error('ERROR: ' + dbHint(e));
    return 2;
  }
  if (!schemaReady) {
    // Fresh database (tables missing entirely): same schema the installer runs.
    try {
      await db.exec(SCHEMA);
      console.log('Initialized empty database tables (same schema as the /install page).');
    } catch (e) {
      console.error('ERROR: could not initialize tables. ' + dbHint(e));
      return 2;
    }
  }

  try {
    if (args.includes('--list')) { await doList(); return 0; }
    const owners = await listOwners();
    if (owners.length > 0) return await doReset(owners);
    return await doCreate();
  } catch (e) {
    console.error('ERROR: ' + dbHint(e));
    return 2;
  }
}

main().then((code) => process.exit(code || 0)).catch((e) => {
  console.error('ERROR: ' + dbHint(e));
  process.exit(2);
});
