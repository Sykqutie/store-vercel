'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('path');
const { spawn } = require('child_process');
const { Client } = require('pg');

const databaseUrl = process.env.CATEGORY_TEST_DATABASE_URL;
const run = databaseUrl ? test : test.skip;

function cookieFrom(res) {
  return String(res.headers.get('set-cookie') || '').split(';')[0];
}

async function waitForServer(base, child, logs) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error('Test server exited early:\n' + logs.join(''));
    try {
      const res = await fetch(base + '/api/status');
      if (res.ok) return;
    } catch (_) {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Test server did not become ready:\n' + logs.join(''));
}

run('category API works end to end with ownership and fallback protection', { timeout: 90000 }, async () => {
  const port = 5700 + Math.floor(Math.random() * 200);
  const base = 'http://127.0.0.1:' + port;
  const root = path.join(__dirname, '..');
  const admin = new Client({ connectionString: databaseUrl });
  await admin.connect();
  await admin.query('DROP SCHEMA public CASCADE');
  await admin.query('CREATE SCHEMA public');
  await admin.end();

  const logs = [];
  const child = spawn(process.execPath, ['dev.js'], {
    cwd: root,
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      AUTH_SECRET: 'category-integration-test-secret',
      PORT: String(port),
      BACKUP_AUTO: 'off',
      BACKUP_STORAGE: 'local',
      BACKUP_DIR: path.join(require('os').tmpdir(), 'smartmart-category-test-backups'),
      SUPABASE_SERVICE_ROLE_KEY: ''
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', (d) => logs.push(String(d)));
  child.stderr.on('data', (d) => logs.push(String(d)));

  try {
    await waitForServer(base, child, logs);

    async function request(urlPath, opts) {
      opts = opts || {};
      const headers = Object.assign({}, opts.headers || {});
      if (opts.cookie) headers.cookie = opts.cookie;
      if (opts.body !== undefined) headers['content-type'] = 'application/json';
      return fetch(base + urlPath, {
        method: opts.method || 'GET',
        headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body)
      });
    }

    async function json(res) {
      return { status: res.status, data: await res.json() };
    }

    const noAuth = await json(await request('/api/categories?all=1'));
    assert.equal(noAuth.status, 401);

    const install = await json(await request('/api/install', {
      method: 'POST',
      body: { username: 'owner', password: 'testpass123', seed: false }
    }));
    assert.equal(install.status, 200, JSON.stringify(install.data));

    const login = await request('/api/login', {
      method: 'POST',
      body: { username: 'owner', password: 'testpass123' }
    });
    assert.equal(login.status, 200);
    const ownerCookie = cookieFrom(login);
    assert.match(ownerCookie, /^[^=]+=/);

    const initial = await json(await request('/api/categories?all=1', { cookie: ownerCookie }));
    assert.equal(initial.status, 200);
    const fallback = initial.data.categories.find((c) => c.name === 'Uncategorized');
    assert.ok(fallback);
    assert.equal(fallback.active, true);
    assert.equal(fallback.is_fallback, true);
    assert.ok(initial.data.categories.some((c) => c.name === 'Noodles' && c.active));
    assert.ok(initial.data.categories.some((c) => c.name === 'General' && c.active));
    const categoriesPage = await request('/categories');
    assert.equal(categoriesPage.status, 200);
    assert.match(await categoriesPage.text(), /\/js\/categories\.js/);

    async function addProduct(barcode, name, category) {
      const res = await json(await request('/api/products', {
        method: 'POST',
        cookie: ownerCookie,
        body: {
          barcode, name, category,
          cost_price: 1, price: 2, stock: 5, low_stock_threshold: 2
        }
      }));
      assert.equal(res.status, 200, JSON.stringify(res.data));
      return res.data;
    }

    const noodle = await addProduct('cat-001', 'Lucky Me Pancit Canton', '');
    assert.equal(noodle.category, 'Noodles');

    const unknown = await addProduct('cat-002', 'Mystery Widget 9000', '');
    assert.equal(unknown.category, 'Uncategorized');

    const explicit = await addProduct('cat-003', 'Owner Choice Product', '  Custom   Cat ');
    assert.equal(explicit.category, 'Custom Cat');
    let custom = (await json(await request('/api/categories?all=1', { cookie: ownerCookie }))).data.categories
      .find((c) => c.name === 'Custom Cat');
    assert.ok(custom);
    assert.equal(custom.product_count, 1);

    const preserve = await json(await request('/api/products/' + explicit.id, {
      method: 'PUT',
      cookie: ownerCookie,
      body: { name: 'Owner Choice Product', category: '', cost_price: 1, price: 2, stock: 5, low_stock_threshold: 2 }
    }));
    assert.equal(preserve.status, 200, JSON.stringify(preserve.data));
    let product = (await json(await request('/api/products/' + explicit.id, { cookie: ownerCookie }))).data.product;
    assert.equal(product.category, 'Custom Cat');

    const rename = await json(await request('/api/categories/' + custom.id, {
      method: 'PUT', cookie: ownerCookie, body: { name: 'Custom Renamed' }
    }));
    assert.equal(rename.status, 200, JSON.stringify(rename.data));
    assert.equal(rename.data.products_updated, 1);
    product = (await json(await request('/api/products/' + explicit.id, { cookie: ownerCookie }))).data.product;
    assert.equal(product.category, 'Custom Renamed');

    const temp = await json(await request('/api/categories', {
      method: 'POST', cookie: ownerCookie, body: { name: 'Temp Inactive' }
    }));
    assert.equal(temp.status, 201);
    const tempId = temp.data.category.id;
    const deactivate = await json(await request('/api/categories/' + tempId, {
      method: 'PUT', cookie: ownerCookie, body: { active: false }
    }));
    assert.equal(deactivate.status, 200);
    const inactivePost = await json(await request('/api/products', {
      method: 'POST', cookie: ownerCookie,
      body: { barcode: 'cat-004', name: 'Inactive Choice', category: 'Temp Inactive', cost_price: 1, price: 2, stock: 1, low_stock_threshold: 1 }
    }));
    assert.equal(inactivePost.status, 400);
    const inactivePut = await json(await request('/api/products/' + explicit.id, {
      method: 'PUT', cookie: ownerCookie,
      body: { name: 'Owner Choice Product', category: 'Temp Inactive', cost_price: 1, price: 2, stock: 5, low_stock_threshold: 2 }
    }));
    assert.equal(inactivePut.status, 400);

    const source = await json(await request('/api/categories', {
      method: 'POST', cookie: ownerCookie, body: { name: 'Merge Source' }
    }));
    const target = await json(await request('/api/categories', {
      method: 'POST', cookie: ownerCookie, body: { name: 'Merge Target' }
    }));
    const sourcedProduct = await addProduct('cat-005', 'Merge Source Product', 'Merge Source');
    const merge = await json(await request('/api/categories/' + source.data.category.id + '/merge', {
      method: 'POST', cookie: ownerCookie, body: { target_id: target.data.category.id }
    }));
    assert.equal(merge.status, 200, JSON.stringify(merge.data));
    assert.equal(merge.data.products_moved, 1);
    product = (await json(await request('/api/products/' + sourcedProduct.id, { cookie: ownerCookie }))).data.product;
    assert.equal(product.category, 'Merge Target');
    const afterMerge = (await json(await request('/api/categories?all=1', { cookie: ownerCookie }))).data.categories;
    assert.ok(!afterMerge.some((c) => c.name === 'Merge Source'));

    const fallbackRename = await json(await request('/api/categories/' + fallback.id, {
      method: 'PUT', cookie: ownerCookie, body: { name: 'Something Else' }
    }));
    assert.equal(fallbackRename.status, 400);
    const fallbackOff = await json(await request('/api/categories/' + fallback.id, {
      method: 'PUT', cookie: ownerCookie, body: { active: false }
    }));
    assert.equal(fallbackOff.status, 400);
    const fallbackMerge = await json(await request('/api/categories/' + fallback.id + '/merge', {
      method: 'POST', cookie: ownerCookie, body: { target_id: target.data.category.id }
    }));
    assert.equal(fallbackMerge.status, 400);

    const cashier = await json(await request('/api/users', {
      method: 'POST', cookie: ownerCookie, body: { username: 'cashier1', password: 'testpass123' }
    }));
    assert.equal(cashier.status, 200, JSON.stringify(cashier.data));
    const cashierLogin = await request('/api/login', {
      method: 'POST', body: { username: 'cashier1', password: 'testpass123' }
    });
    assert.equal(cashierLogin.status, 200);
    const cashierCookie = cookieFrom(cashierLogin);
    const cashierList = await json(await request('/api/categories?all=1', { cookie: cashierCookie }));
    assert.equal(cashierList.status, 200);
    assert.ok(!cashierList.data.categories.some((c) => c.name === 'Temp Inactive'));
    const cashierCreate = await json(await request('/api/categories', {
      method: 'POST', cookie: cashierCookie, body: { name: 'Cashier Nope' }
    }));
    assert.equal(cashierCreate.status, 403);

    const backupRes = await json(await request('/api/backups', {
      method: 'POST', cookie: ownerCookie, body: { kind: 'manual' }
    }));
    assert.equal(backupRes.status, 200, JSON.stringify(backupRes.data));
    const backupFile = backupRes.data.backup.file;
    const download = await request('/api/backups/' + encodeURIComponent(backupFile), { cookie: ownerCookie });
    assert.equal(download.status, 200);
    const backupObj = JSON.parse(await download.text());
    assert.ok(Array.isArray(backupObj.tables.categories));
    assert.ok(backupObj.tables.categories.some((c) => c.name === 'Custom Renamed'));
    assert.ok(backupObj.tables.categories.some((c) => c.name === 'Uncategorized'));

    const legacyWithChecksum = JSON.parse(JSON.stringify(backupObj));
    delete legacyWithChecksum.tables.categories;
    legacyWithChecksum.sha256 = crypto.createHash('sha256')
      .update(JSON.stringify(legacyWithChecksum.tables)).digest('hex');
    const restoreLegacyChecksum = await json(await request('/api/backups/restore', {
      method: 'POST', cookie: ownerCookie, body: { backup: legacyWithChecksum }
    }));
    assert.equal(restoreLegacyChecksum.status, 200, JSON.stringify(restoreLegacyChecksum.data));

    const legacyNoChecksum = JSON.parse(JSON.stringify(legacyWithChecksum));
    delete legacyNoChecksum.sha256;
    const restore = await json(await request('/api/backups/restore', {
      method: 'POST', cookie: ownerCookie, body: { backup: legacyNoChecksum }
    }));
    assert.equal(restore.status, 200, JSON.stringify(restore.data));
    const restoredCats = await json(await request('/api/categories?all=1', { cookie: ownerCookie }));
    assert.equal(restoredCats.status, 200);
    assert.ok(restoredCats.data.categories.some((c) => c.name === 'Custom Renamed'));
    assert.ok(restoredCats.data.categories.some((c) => c.name === 'Merge Target'));
    assert.ok(restoredCats.data.categories.some((c) => c.name === 'Uncategorized' && c.is_fallback));
    product = (await json(await request('/api/products/' + explicit.id, { cookie: ownerCookie }))).data.product;
    assert.equal(product.category, 'Custom Renamed');
  } finally {
    child.kill();
    await new Promise((resolve) => setTimeout(resolve, 500));
    if (child.exitCode === null) child.kill('SIGKILL');
  }
});
