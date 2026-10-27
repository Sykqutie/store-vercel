'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('child_process');
const { Client } = require('pg');

const baseDatabaseUrl = process.env.SIZE_TEST_DATABASE_URL;
const run = baseDatabaseUrl ? test : test.skip;

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

// Creates a brand-new database in the disposable test server. Nothing is
// dropped or truncated, so production URLs are rejected up front.
async function createDisposableDatabase() {
  const parsed = new URL(baseDatabaseUrl);
  if (!/^(127\.0\.0\.1|localhost)$/.test(parsed.hostname)) {
    throw new Error('SIZE_TEST_DATABASE_URL must point to a disposable local Postgres server.');
  }
  const name = 'smartmart_size_' + crypto.randomBytes(6).toString('hex');
  const admin = new Client({ connectionString: baseDatabaseUrl });
  await admin.connect();
  await admin.query('CREATE DATABASE ' + name);
  await admin.end();
  parsed.pathname = '/' + name;
  return parsed.toString();
}

run('product size API, checkout snapshots, reports, and legacy backup restore', { timeout: 120000 }, async () => {
  const databaseUrl = await createDisposableDatabase();
  const port = 6000 + Math.floor(Math.random() * 300);
  const base = 'http://127.0.0.1:' + port;
  const root = path.join(__dirname, '..');
  const logs = [];
  const child = spawn(process.execPath, ['dev.js'], {
    cwd: root,
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      AUTH_SECRET: 'size-integration-test-secret',
      PORT: String(port),
      BACKUP_AUTO: 'off',
      BACKUP_STORAGE: 'local',
      BACKUP_DIR: path.join(os.tmpdir(), 'smartmart-size-test-backups-' + crypto.randomBytes(4).toString('hex')),
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

    const unauthorized = await json(await request('/api/products'));
    assert.equal(unauthorized.status, 401);

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

    const suggestion = await json(await request('/api/sizes/suggest?name=' + encodeURIComponent('Coca-Cola 1.5L'), {
      cookie: ownerCookie
    }));
    assert.equal(suggestion.status, 200, JSON.stringify(suggestion.data));
    assert.deepEqual(suggestion.data.suggestion, { value: 1.5, unit: 'L', label: '1.5 L' });
    assert.equal(suggestion.data.source, 'name');

    const ambiguous = await json(await request('/api/sizes/suggest?name=' + encodeURIComponent('Bundle 500 mL and 1 L'), {
      cookie: ownerCookie
    }));
    assert.equal(ambiguous.status, 200);
    assert.equal(ambiguous.data.suggestion, null);
    assert.equal(ambiguous.data.source, 'none');

    const badSuggestion = await json(await request('/api/sizes/suggest', { cookie: ownerCookie }));
    assert.equal(badSuggestion.status, 400);

    async function addProduct(barcode, name, size, extra) {
      const body = Object.assign({
        barcode, name, category: 'Beverages',
        cost_price: 1, price: 10, stock: 10, low_stock_threshold: 2
      }, extra || {});
      if (size) {
        body.size_value = size.value;
        body.size_unit = size.unit;
        body.size_label = size.label;
      }
      const res = await json(await request('/api/products', {
        method: 'POST',
        cookie: ownerCookie,
        body
      }));
      assert.equal(res.status, 200, JSON.stringify(res.data));
      return res.data;
    }

    async function product(id) {
      const r = await json(await request('/api/products/' + id, { cookie: ownerCookie }));
      assert.equal(r.status, 200, JSON.stringify(r.data));
      return r.data.product;
    }

    // Suggestions are not saved automatically: this name has an explicit
    // size, but no size fields were submitted.
    const unsized = await addProduct('size-000', 'Bare Name 500 mL', null, { price: 5 });
    let p = await product(unsized.id);
    assert.equal(p.size_value, null);
    assert.equal(p.size_unit, null);
    assert.equal(p.size_label, null);

    const half = await addProduct('size-001', 'Coke', { value: 500, unit: 'mL', label: '500 mL' });
    const liter = await addProduct('size-002', 'Coke', { value: 1, unit: 'L', label: '1 L' });
    const sachet = await addProduct('size-003', 'Coffee', { value: 12, unit: 'mL', label: '12 mL sachet' }, { category: 'Beverages' });

    p = await product(sachet.id);
    assert.deepEqual(
      { value: p.size_value, unit: p.size_unit, label: p.size_label },
      { value: 12, unit: 'mL', label: '12 mL sachet' }
    );

    const existingSuggestion = await json(await request(
      '/api/sizes/suggest?name=' + encodeURIComponent('Coke') + '&barcode=size-001',
      { cookie: ownerCookie }
    ));
    assert.equal(existingSuggestion.status, 200);
    assert.equal(existingSuggestion.data.source, 'existing');
    assert.equal(existingSuggestion.data.suggestion.label, '500 mL');

    let search = await json(await request('/api/products?q=' + encodeURIComponent('sachet'), { cookie: ownerCookie }));
    assert.equal(search.status, 200);
    assert.deepEqual(search.data.products.map((x) => x.barcode), ['size-003']);

    const invalidPartial = await json(await request('/api/products', {
      method: 'POST',
      cookie: ownerCookie,
      body: {
        barcode: 'size-bad', name: 'Bad Size', category: 'Beverages',
        cost_price: 1, price: 1, stock: 1, low_stock_threshold: 1,
        size_value: 500, size_unit: '', size_label: ''
      }
    }));
    assert.equal(invalidPartial.status, 400);

    const tooLarge = await json(await request('/api/products', {
      method: 'POST',
      cookie: ownerCookie,
      body: {
        barcode: 'size-huge', name: 'Huge Size', category: 'Beverages',
        cost_price: 1, price: 1, stock: 1, low_stock_threshold: 1,
        size_value: 10000000, size_unit: 'mL', size_label: ''
      }
    }));
    assert.equal(tooLarge.status, 400);

    // Restocking with an old payload (no size fields) must keep the saved size.
    const restock = await json(await request('/api/products', {
      method: 'POST',
      cookie: ownerCookie,
      body: {
        barcode: 'size-001', name: 'Coke', category: 'Beverages',
        cost_price: 1, price: 10, stock: 2, low_stock_threshold: 2
      }
    }));
    assert.equal(restock.status, 200, JSON.stringify(restock.data));
    p = await product(half.id);
    assert.equal(p.stock, 12);
    assert.equal(p.size_label, '500 mL');

    // Editing the name without size fields keeps the manually entered size.
    let edit = await json(await request('/api/products/' + half.id, {
      method: 'PUT',
      cookie: ownerCookie,
      body: {
        name: 'Coke Original', category: 'Beverages',
        cost_price: 1, price: 10, stock: 12, low_stock_threshold: 2
      }
    }));
    assert.equal(edit.status, 200, JSON.stringify(edit.data));
    p = await product(half.id);
    assert.equal(p.name, 'Coke Original');
    assert.equal(p.size_label, '500 mL');

    // An explicit blank set clears the size; a later legacy edit preserves null.
    edit = await json(await request('/api/products/' + unsized.id, {
      method: 'PUT',
      cookie: ownerCookie,
      body: {
        name: 'Bare Name', category: 'Beverages',
        cost_price: 1, price: 5, stock: 10, low_stock_threshold: 2,
        size_value: 750, size_unit: 'mL', size_label: '750 mL'
      }
    }));
    assert.equal(edit.status, 200, JSON.stringify(edit.data));
    p = await product(unsized.id);
    assert.equal(p.size_label, '750 mL');
    edit = await json(await request('/api/products/' + unsized.id, {
      method: 'PUT',
      cookie: ownerCookie,
      body: {
        name: 'Bare Name Renamed', category: 'Beverages',
        cost_price: 1, price: 5, stock: 10, low_stock_threshold: 2
      }
    }));
    assert.equal(edit.status, 200);
    p = await product(unsized.id);
    assert.equal(p.size_label, '750 mL');
    edit = await json(await request('/api/products/' + unsized.id, {
      method: 'PUT',
      cookie: ownerCookie,
      body: {
        name: 'Bare Name Renamed', category: 'Beverages',
        cost_price: 1, price: 5, stock: 10, low_stock_threshold: 2,
        size_value: '', size_unit: '', size_label: ''
      }
    }));
    assert.equal(edit.status, 200);
    p = await product(unsized.id);
    assert.equal(p.size_label, null);

    const cashier = await json(await request('/api/users', {
      method: 'POST',
      cookie: ownerCookie,
      body: { username: 'cashier1', password: 'testpass123' }
    }));
    assert.equal(cashier.status, 200, JSON.stringify(cashier.data));
    const cashierLogin = await request('/api/login', {
      method: 'POST',
      body: { username: 'cashier1', password: 'testpass123' }
    });
    assert.equal(cashierLogin.status, 200);
    const cashierCookie = cookieFrom(cashierLogin);
    const cashierProducts = await json(await request('/api/products', { cookie: cashierCookie }));
    assert.equal(cashierProducts.status, 200);
    const visibleHalf = cashierProducts.data.products.find((x) => x.barcode === 'size-001');
    assert.equal(visibleHalf.size_label, '500 mL');
    assert.equal(visibleHalf.cost_price, undefined);
    const cashierWrite = await json(await request('/api/products', {
      method: 'POST',
      cookie: cashierCookie,
      body: { barcode: 'size-nope', name: 'Nope', cost_price: 1, price: 1, stock: 1, low_stock_threshold: 1 }
    }));
    assert.equal(cashierWrite.status, 403);
    const cashierSuggestion = await json(await request('/api/sizes/suggest?name=Coke', { cookie: cashierCookie }));
    assert.equal(cashierSuggestion.status, 403);

    // Older checkout payloads send only id/qty. The server must snapshot the
    // current product size into the sale.
    const checkout = await json(await request('/api/checkout', {
      method: 'POST',
      cookie: ownerCookie,
      body: {
        items: [{ id: half.id, qty: 1 }, { id: liter.id, qty: 1 }],
        amount_tendered: 100,
        client_sale_id: 'size-sale-0001'
      }
    }));
    assert.equal(checkout.status, 200, JSON.stringify(checkout.data));
    const receipt = await json(await request('/api/sales/' + checkout.data.id, { cookie: ownerCookie }));
    assert.equal(receipt.status, 200);
    const receiptSizes = receipt.data.items.map((i) => [i.product_name, i.size_label]);
    assert.deepEqual(receiptSizes, [['Coke Original', '500 mL'], ['Coke', '1 L']]);

    const dashboard = await json(await request('/api/dashboard', { cookie: ownerCookie }));
    assert.equal(dashboard.status, 200, JSON.stringify(dashboard.data));
    assert.deepEqual(
      dashboard.data.top.map((x) => x.size_label).sort(),
      ['1 L', '500 mL']
    );

    const report = await json(await request('/api/report?period=all', { cookie: ownerCookie }));
    assert.equal(report.status, 200, JSON.stringify(report.data));
    const cokeTops = report.data.topProducts.filter((x) => x.product_name === 'Coke' || x.product_name === 'Coke Original');
    assert.equal(cokeTops.length, 2);
    assert.deepEqual(cokeTops.map((x) => x.size_label).sort(), ['1 L', '500 mL']);
    assert.equal(report.data.best.size_label, '1 L');

    const filtered = await json(await request('/api/report?period=all&search=' + encodeURIComponent('500 mL'), {
      cookie: ownerCookie
    }));
    assert.equal(filtered.status, 200);
    assert.equal(filtered.data.sales.length, 1);

    const csv = await request('/api/export-sales?period=all', { cookie: ownerCookie });
    assert.equal(csv.status, 200);
    const csvText = await csv.text();
    assert.match(csvText, /Size \/ Volume/);
    assert.match(csvText, /500 mL/);
    assert.match(csvText, /1 L/);

    // Backups capture sizes. Restoring a legacy backup without any size columns
    // must succeed and leave those fields null on the restored rows.
    const backupRes = await json(await request('/api/backups', {
      method: 'POST',
      cookie: ownerCookie,
      body: { kind: 'manual' }
    }));
    assert.equal(backupRes.status, 200, JSON.stringify(backupRes.data));
    const backupFile = backupRes.data.backup.file;
    const download = await request('/api/backups/' + encodeURIComponent(backupFile), { cookie: ownerCookie });
    assert.equal(download.status, 200);
    const backup = JSON.parse(await download.text());
    assert.ok(backup.tables.products.some((x) => x.size_label === '500 mL'));
    assert.ok(backup.tables.sale_items.some((x) => x.size_label === '500 mL'));

    const legacy = JSON.parse(JSON.stringify(backup));
    delete legacy.sha256;
    legacy.tables.products.forEach((row) => {
      delete row.size_value;
      delete row.size_unit;
      delete row.size_label;
    });
    legacy.tables.sale_items.forEach((row) => delete row.size_label);

    const restore = await json(await request('/api/backups/restore', {
      method: 'POST',
      cookie: ownerCookie,
      body: { backup: legacy }
    }));
    assert.equal(restore.status, 200, JSON.stringify(restore.data));
    p = await product(half.id);
    assert.equal(p.size_value, null);
    assert.equal(p.size_unit, null);
    assert.equal(p.size_label, null);
    const restoredReceipt = await json(await request('/api/sales/' + checkout.data.id, { cookie: ownerCookie }));
    assert.equal(restoredReceipt.status, 200);
    assert.ok(restoredReceipt.data.items.every((i) => i.size_label === null));
  } finally {
    child.kill();
    await new Promise((resolve) => setTimeout(resolve, 500));
    if (child.exitCode === null) child.kill('SIGKILL');
  }
});
