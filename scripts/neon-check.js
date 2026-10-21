'use strict';
// READ-ONLY: verify connectivity to the OLD Neon source database.
const { Client } = require('pg');

const url = String(process.env.NEON_DATABASE_URL || '').trim();
if (!url) { console.error('NEON_DATABASE_URL is not set'); process.exit(2); }
const u = new URL(url);
console.log('neon host =', u.hostname, 'port', u.port || '5432', 'db', u.pathname.replace(/^\//, ''), 'user', u.username);

const cs = url
  .replace(/([?&])sslmode=[^&]*/gi, '$1')
  .replace(/([?&])channel_binding=[^&]*/gi, '$1')
  .replace(/&&+/g, '&')
  .replace(/[?&]$/, '');

(async () => {
  const c = new Client({ connectionString: cs, ssl: { rejectUnauthorized: true } });
  await c.connect();
  const r = await c.query(
    `SELECT current_database() AS d, current_user AS u, version() AS v, inet_server_port() AS p,
            current_setting('ssl', true) AS ssl_setting`
  );
  const st = c.connection && c.connection.stream;
  console.log('db      =', r.rows[0].d);
  console.log('user    =', r.rows[0].u);
  console.log('port    =', r.rows[0].p);
  console.log('version =', r.rows[0].v.split(' ').slice(0, 2).join(' '));
  console.log('client encrypted =', !!(st && st.encrypted),
    'proto =', st && typeof st.getProtocol === 'function' ? st.getProtocol() : 'n/a');
  const cnt = await c.query(
    `SELECT (SELECT COUNT(*)::int FROM products) AS products,
            (SELECT COUNT(*)::int FROM users) AS users,
            (SELECT COUNT(*)::int FROM stock_movements) AS movements,
            (SELECT COUNT(*)::int FROM sales) AS sales,
            (SELECT COUNT(*)::int FROM sale_items) AS sale_items`
  );
  console.log('rows    =', JSON.stringify(cnt.rows[0]));
  await c.end();
  process.exit(0);
})().catch((e) => { console.error('FAIL', e.code || '', e.message); process.exit(1); });
