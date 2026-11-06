'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { Client } = require('pg');
const SCHEMA = require('../lib/schema');

// Regression test for the installer (api/index.js -> lib/schema.js -> lib/db.js).
// The text test always runs; the database test runs only against a disposable
// local Postgres server supplied by an explicit TEST_DATABASE_URL variable.
const baseDatabaseUrl =
  process.env.SCHEMA_TEST_DATABASE_URL ||
  process.env.CATEGORY_TEST_DATABASE_URL ||
  process.env.SIZE_TEST_DATABASE_URL;
const runDb = baseDatabaseUrl ? test : test.skip;

const EXPECTED_PRODUCT_COLUMNS = [
  'id',
  'barcode',
  'name',
  'category',
  'size_value',
  'size_unit',
  'size_label',
  'cost_price',
  'price',
  'stock',
  'low_stock_threshold',
  'expiry_date',
  'created_at',
  'updated_at',
  'image_url'
];

const EXPECTED_TABLES = [
  'alert_dismissals',
  'categories',
  'products',
  'sale_items',
  'sales',
  'stock_movements',
  'users'
];

test('schema.sql has no literal escape sequences and declares image_url with real line breaks', () => {
  assert.ok(!SCHEMA.includes('\\r\\n'), 'schema.sql must not contain a literal \\r\\n sequence');
  assert.ok(!SCHEMA.includes('\\n'), 'schema.sql must not contain a literal \\n sequence');
  assert.ok(!SCHEMA.includes('\\t'), 'schema.sql must not contain a literal \\t sequence');

  const lines = SCHEMA.split(/\r?\n/);
  const imageLine = lines.findIndex((line) => /^\s*image_url\s+VARCHAR\(512\)\s*$/.test(line));
  assert.notEqual(imageLine, -1, 'products.image_url VARCHAR(512) must be on its own line');
  assert.match(lines[imageLine - 1], /^\s*updated_at\s+TIMESTAMPTZ\s+NOT NULL DEFAULT now\(\),\s*$/);
  assert.match(lines[imageLine + 1], /^\s*\);\s*$/);
});

function assertDisposableServer(url) {
  const parsed = new URL(url);
  if (!/^(127\.0\.0\.1|localhost|\[::1\])$/.test(parsed.hostname)) {
    throw new Error(
      'SCHEMA_TEST_DATABASE_URL (or CATEGORY/SIZE_TEST_DATABASE_URL) must point to a disposable local Postgres server.'
    );
  }
  return parsed;
}

async function createDisposableDatabase(url) {
  const parsed = assertDisposableServer(url);
  const name = 'smartmart_schema_' + crypto.randomBytes(6).toString('hex');
  const admin = new Client({ connectionString: url });
  await admin.connect();
  try {
    await admin.query('CREATE DATABASE ' + name);
  } finally {
    await admin.end();
  }
  parsed.pathname = '/' + name;
  return { name, url: parsed.toString() };
}

async function dropDisposableDatabase(url, name) {
  const admin = new Client({ connectionString: url });
  await admin.connect();
  try {
    await admin.query('DROP DATABASE IF EXISTS ' + name);
  } finally {
    await admin.end();
  }
}

runDb('the real schema installs cleanly on a fresh database and recreates image_url', { timeout: 60000 }, async () => {
  const disposable = await createDisposableDatabase(baseDatabaseUrl);
  const client = new Client({ connectionString: disposable.url });

  try {
    await client.connect();

    // This is exactly the text the installer reads through lib/schema.js.
    await client.query(SCHEMA);

    const products = await client.query(
      `SELECT column_name, data_type, character_maximum_length, is_nullable, column_default
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'products'
        ORDER BY ordinal_position`
    );
    assert.deepEqual(
      products.rows.map((row) => row.column_name),
      EXPECTED_PRODUCT_COLUMNS,
      'products table columns must be unchanged'
    );

    const image = products.rows.find((row) => row.column_name === 'image_url');
    assert.ok(image, 'products.image_url must exist');
    assert.equal(image.data_type, 'character varying');
    assert.equal(image.character_maximum_length, 512);
    assert.equal(image.is_nullable, 'YES');
    assert.equal(image.column_default, null);

    const tables = await client.query(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`
    );
    assert.deepEqual(
      tables.rows.map((row) => row.table_name).sort(),
      EXPECTED_TABLES.slice().sort(),
      'all schema tables must be created'
    );

    const stockCheck = await client.query(
      `SELECT pg_get_constraintdef(oid) AS def
         FROM pg_constraint
        WHERE conrelid = 'products'::regclass AND contype = 'c'`
    );
    assert.ok(
      stockCheck.rows.some((row) => /stock >= 0/.test(row.def)),
      'products must keep its stock >= 0 check constraint'
    );

    const salesIndexes = await client.query(
      `SELECT indexname FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'sales'`
    );
    assert.ok(
      salesIndexes.rows.some((row) => row.indexname === 'idx_sales_client_sale_id'),
      'sales must keep its client_sale_id unique index'
    );

    // Re-running the schema is what an existing installation does; it must stay safe.
    await client.query(SCHEMA);
    const imageAfterRerun = await client.query(
      `SELECT COUNT(*)::int AS n
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'products' AND column_name = 'image_url'`
    );
    assert.equal(imageAfterRerun.rows[0].n, 1, 're-running the schema must not duplicate image_url');

    // Existing installations add the column through this additive migration in
    // api/index.js (ensureImageSchema); it must keep working after this fix.
    await client.query('ALTER TABLE products DROP COLUMN image_url');
    await client.query('ALTER TABLE products ADD COLUMN IF NOT EXISTS image_url VARCHAR(512)');
    const migrated = await client.query(
      `SELECT data_type, character_maximum_length
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'products' AND column_name = 'image_url'`
    );
    assert.equal(migrated.rows[0].data_type, 'character varying');
    assert.equal(migrated.rows[0].character_maximum_length, 512);
  } finally {
    await client.end().catch(() => {});
    await dropDisposableDatabase(baseDatabaseUrl, disposable.name).catch(() => {});
  }
});
