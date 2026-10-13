# Convenience Store POS & Inventory (Node.js + Postgres for Vercel)

A port of the PHP/MySQL store system. Same screens (login, installer, dashboard, POS, products, edit product, reports, receipt, CSV export), rebuilt so it runs on Vercel.

| PHP original | This project |
| --- | --- |
| PHP pages and sessions | Static pages in `public/html` plus one Express function in `api/index.js`, signed login cookie |
| MySQL (`database.sql`) | Postgres (`database/schema.sql`) |
| `password_hash` / `password_verify` | `bcryptjs` |
| `install.php` | `/install` page and `POST /api/install` |

## Folder structure

```
store-vercel/
├── api/index.js          Express API: every /api/* route (one Vercel function)
├── lib/
│   ├── db.js             Postgres pool and transactions
│   ├── auth.js           Signed HttpOnly session cookie
│   ├── stats.js          Day/week/month totals and 7-day chart queries
│   └── schema.js         Loads database/schema.sql for the installer
├── database/schema.sql   Tables: users, products, sales, sale_items, stock_movements
├── public/
│   ├── html/             One page per original PHP screen
│   ├── css/              base.css (theme) and app.css (page additions)
│   └── js/               common.js plus one script per page
├── dev.js                Local server with the same routes as Vercel
├── vercel.json           Rewrites, security headers, function settings
└── .env.example
```

## Deploy to Vercel

1. Push this folder to a GitHub repository and import it in Vercel (framework preset: **Other**, no build command).
2. In the Vercel project, open **Storage** and add a **Neon Postgres** database. This sets `DATABASE_URL` automatically. Any other Postgres works too: set `DATABASE_URL` yourself.
3. In **Settings → Environment Variables** add `AUTH_SECRET` with a long random value (`openssl rand -base64 32`). Optional: `STORE_NAME` and `STORE_TZ` (default `Asia/Manila`).
4. Deploy. Open `https://your-app.vercel.app/install`, choose an admin username and a password (8+ characters), and tick the demo products box if you want sample items.
5. Sign in at `/login`.

Tip: set the function region (Project Settings → Functions) near your database region for faster queries.

## Run locally

```
npm install
cp .env.example .env     # fill in DATABASE_URL and AUTH_SECRET
npm run dev              # http://localhost:3000
```

Needs Node 20.6+ (it uses `node --env-file`).

## What changed from the PHP version, and why

- **Installer is locked after first use.** `install.php` was open to anyone. `/api/install` refuses once an admin exists, and you choose the password (no default `admin123`).
- **Checkout trusts the database, not the browser.** The PHP POS posted prices and costs from the cart. Now the browser sends only product ids and quantities; prices, cost, profit, VAT and change are computed on the server inside one transaction that locks the product rows, so stock cannot go negative.
- **POS extras that the schema already supported:** payment method (Cash, GCash, Card), discount, cash received and change, 12% VAT shown as included, cashier name.
- **Stock history** is written to `stock_movements` on sales, restocks and edits.
- **CSV export works.** The PHP query used columns that do not exist (`transaction_no`, a join to `products`). The new export reads `sales` and `sale_items` and honors the report's date and search filters. Cells that start with `=`, `+`, `-` or `@` are escaped.
- **Product form has a Category field** (the old form skipped it, so everything was "General").
- **Logins:** failed attempts are slowed down, cookies are `HttpOnly`, `SameSite=Lax` and `Secure`, and write requests must be JSON (blocks cross-site form posts).

## Notes

- The page files themselves are public; all data comes from `/api`, which requires a signed-in session. Anyone opening `/pos` while signed out is sent to `/login`.
- Dates are grouped in `STORE_TZ`, so "today" matches the store's clock, not the server's.
- Changing the VAT rate: `VAT_PERCENT` in `api/index.js` and `VAT` in `public/js/pos.js`/`receipt.js` text.
- Passwords created by the PHP installer (`password_hash`) are not carried over. Run the installer and create a new admin.
