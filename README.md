# SmartMart POS & Inventory (Node.js + Postgres for Vercel)

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
│   ├── backup.js         Backup/restore core (collect, verify, retention)
│   ├── backup-store.js   Backup storage: local folder or private Supabase Storage
│   ├── stats.js          Day/week/month totals and 7-day chart queries
│   └── schema.js         Loads database/schema.sql for the installer
├── database/schema.sql   Tables: users, categories, products, sales, sale_items, stock_movements
├── public/
│   ├── html/             One page per original PHP screen
│   ├── css/              base.css (theme) and app.css (page additions)
│   └── js/               common.js plus one script per page
├── dev.js                Local server with the same routes as Vercel
├── vercel.json           Rewrites, security headers, function settings
└── .env.example
```

## Database: Supabase PostgreSQL

The app talks to Postgres over a plain **server-side** `pg` connection. It never
uses the Supabase browser client, the Data API, or Supabase Auth. The only
Supabase key used anywhere is an optional **server-side** `service_role` key for
the private backup bucket; it is never sent to the browser. Do not add an
`anon` key.

**Get the connection string:** Supabase Dashboard → your project → **Connect**
(top toolbar) → **Connection string** → **URI**. Choose **Session pooler**
(port `5432`, host `aws-0-<region>.pooler.supabase.com`) for both local
development and Vercel.

| Connection type | Host / port | Use it for |
| --- | --- | --- |
| **Session pooler** | `aws-0-<region>.pooler.supabase.com:5432` | **This app** (app code, Vercel, local dev) |
| Transaction pooler | `aws-0-<region>.pooler.supabase.com:6543` | Not used - this app runs multi-statement transactions, which the transaction pooler breaks |
| Direct | `db.<project-ref>.supabase.co:5432` | Schema work only (IPv6-only, no pooling) |

The string looks like
`postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres?sslmode=require`.
Percent-encode reserved characters in the password (`@` → `%40`, `/` → `%2F`,
`#` → `%23`, `?` → `%3F`); Supabase's copy button leaves the password unencoded.

**TLS:** `lib/db.js` connects with `rejectUnauthorized: true` against the
bundled `certs/supabase-root-ca.pem` (the public *Supabase Root 2021 CA*).
Certificate verification is never disabled and no certificate is fetched at
runtime. Keep that file in the repo - `vercel.json` ships it inside the
function via `includeFiles`.

**Row Level Security:** the app connects as the `postgres` role, which bypasses
RLS, and the Data API is unused. RLS is therefore left **enabled** on the
tables (do not disable it) - with no policies, `anon`/`authenticated` can read
or write nothing through the Data API, which is exactly what this app wants.

## Deploy to Vercel

1. Push this folder to a GitHub repository and import it in Vercel (framework preset: **Other**, no build command).
2. In **Settings → Environment Variables**, add for **Production** (and
   **Preview** if you use it):
   - `DATABASE_URL` — the Supabase **session pooler** URI from above.
   - `AUTH_SECRET` — a long random value
     (`node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`).
   - Optional: `STORE_NAME` (default `SmartMart`) and `STORE_TZ` (default `Asia/Manila`).
   - `SUPABASE_SERVICE_ROLE_KEY` — server-side key used only for durable backups
     (see **Backup & Restore** below). Optional but production backups are
     disabled until it is set.
   - Optional: `SUPABASE_URL` (derived from `DATABASE_URL` when possible) and
     `BACKUP_BUCKET` (default `smartmart-backups`).
3. Deploy. Open `https://your-app.vercel.app/api/status` and confirm
   `configured: true`, `installed: true` and that `dbHost` shows your
   `*.pooler.supabase.com` host.
4. If the database has no account yet, open `/install` to create the first
   owner (8+ character password). Otherwise sign in at `/login`.

Tip: set the function region (Project Settings → Functions) near your Supabase
region (`ap-southeast-2` for an `aws-0-ap-southeast-2` pooler host) for faster
queries.

Never put `DATABASE_URL`, `AUTH_SECRET` or any Supabase key in the repository,
in client-side JavaScript, or in a Vercel variable that starts with
`NEXT_PUBLIC_` / `PUBLIC_`.

## Run locally

```
npm install
cp .env.example .env     # fill in DATABASE_URL and AUTH_SECRET
npm run dev              # http://localhost:3000
```

Needs Node 20.6+ (it uses `node --env-file`).

Read-only helpers (they never write to the database):

```
node --env-file=.env scripts/db-test.js        # connectivity + row counts
node --env-file=.env scripts/db-inspect.js     # host, TLS state, roles
node --env-file=.env scripts/schema-audit.js   # columns, constraints, indexes, RLS
node --env-file=.env scripts/data-snapshot.js  # current rows (hashes never printed)
```

## Account recovery (forgot owner login)

There is intentionally **no online password reset**. If you forget the owner
username or password, or the owner row was deleted, click **Forgot Password?**
on the login page for the recovery steps, then recover on the server
computer (Windows PowerShell, inside the project folder):

```
npm run recover            # interactive: reset the owner, or create it if none exists
npm run recover -- --list  # show account usernames without changing anything
```

The tool detects whether an owner exists: if one does, it resets that owner's
password (typing `RESET` to confirm, and offering reactivation if the account
was deactivated); if none exists, it creates the initial owner (typing
`CREATE` to confirm, refused if an owner already exists). Passwords are
hashed with bcrypt, all queries are parameterized, and cashiers, products,
inventory, and sales are never modified. If the database is unreachable it
exits with an error and changes nothing — check `DATABASE_URL` and that
Postgres is running (local Docker: `docker start smartmart-pg`).

## What changed from the PHP version, and why

- **Installer is locked after first use.** `install.php` was open to anyone. `/api/install` refuses once an admin exists, and you choose the password (no default `admin123`).
- **Checkout trusts the database, not the browser.** The PHP POS posted prices and costs from the cart. Now the browser sends only product ids and quantities; prices, cost, profit, VAT and change are computed on the server inside one transaction that locks the product rows, so stock cannot go negative.
- **POS extras that the schema already supported:** payment method (Cash, GCash, Card), discount, cash received and change, 12% VAT shown as included, cashier name.
- **Stock history** is written to `stock_movements` on sales, restocks and edits.
- **CSV export works.** The PHP query used columns that do not exist (`transaction_no`, a join to `products`). The new export reads `sales` and `sale_items` and honors the report's date and search filters. Cells that start with `=`, `+`, `-` or `@` are escaped.
- **Product form has a Category field** (the old form skipped it, so everything was "General").
- **Automatic categories:** new items with a blank category are classified from their name (and an existing barcode's category when restocking). Owners can manage categories at `/categories`, rename or deactivate them, and merge one into another without touching product IDs or sales history. `Uncategorized` is the protected fallback.
- **Product sizes / volumes:** products can store an optional structured size (`value`, unit, and display label, such as `500 mL` or `12 mL sachet`). Inventory and Edit Product suggest a size only from an explicit number+unit in the item name or an existing barcode; suggestions are never saved automatically, and ordinary name edits/restocks keep a manually confirmed size. Missing sizes show **Size not specified**. Sales snapshot the size into `sale_items`, so receipts and reports preserve historical labels and group variants separately. Existing products and older backups remain valid with null sizes.
- **Logins:** failed attempts are slowed down, cookies are `HttpOnly`, `SameSite=Lax` and `Secure`, and write requests must be JSON (blocks cross-site form posts).

## Backup & Restore (owner only)

The **Backup** page (`/backup`, owner-only — cashiers see a restricted page)
protects all store data: users + password hashes, categories, products, sales,
sale items, stock movements, plus store/timezone metadata. Older backups that
predate categories are still accepted and rebuilt from product labels on
restore. Backups without product/sale size fields are also accepted; restored
rows simply have no size. Backups are portable JSON files
named `smartmart-backup-YYYYMMDD-HHMMSS-mmm-<kind>.json` (older files without
the milliseconds part are still accepted), checksummed and verified before
success is reported. No `pg_dump` binary or superuser rights needed.

- **Where files live:** on Windows/VPS they go to `backups/` (outside
  `public/`; override with `BACKUP_DIR`). On Vercel the filesystem is
  ephemeral, so the app stores backups in a **private Supabase Storage bucket**
  instead. If durable storage is not configured there, the Backup page shows
  the exact setup steps and disables create/restore rather than pretending a
  temporary file is safe.
- **One-time Supabase Storage setup (Vercel):**
  1. Supabase Dashboard → **Storage** → create a **private** bucket named
     `smartmart-backups` (or set `BACKUP_BUCKET` to another private bucket).
  2. Supabase Dashboard → **Project Settings → API Keys** → copy the
     server-side `service_role` / secret key. Reveal it first; do not paste a
     masked preview (bullets are not valid key characters).
  3. Vercel → project → **Settings → Environment Variables** → add
     `SUPABASE_SERVICE_ROLE_KEY` for **Production** (and Preview if used).
     `SUPABASE_URL` is optional when `DATABASE_URL` points at Supabase; if set,
     it must be `https://<project-ref>.supabase.co`, never the database or
     pooler hostname.
  4. Redeploy, then create a backup on `/backup` and confirm it lists as valid.
  Never expose this key in browser code or commit it.
- **Create:** open `/backup` → **Create Backup**, or on the server run
  `npm run backup`. Every restore first writes an automatic `safety` backup.
- **Download/store safely:** press **Download** (or **Download Backup** for the
  latest) and keep an extra copy on an external drive or secure cloud storage.
- **Restore:** on `/backup`, pick a server backup or upload a saved file →
  **Restore Backup** → type `RESTORE` to confirm. The restore is validated,
  runs in one transaction, is count-verified before commit, and reports a
  safety-backup file. If your login was replaced, sign in again. Uploading a
  file over HTTP is capped at **25 MB** locally and **4 MB** on Vercel
  (platform request limit); server-stored Supabase backups are not subject to
  that upload cap.
- **Automatic/retention:** local mode supports `BACKUP_AUTO=daily|weekly` in
  `.env` (keeps 7 daily / 4 weekly by default, configurable via
  `BACKUP_KEEP_DAILY/WEEKLY`; manual and safety backups are never auto-deleted,
  and the last valid backup is never removed). This needs the local server kept
  running. For hands-off scheduling on Windows, use Task Scheduler to run
  `npm run backup -- --kind=daily` daily (works even when the server is off).
  Scheduled auto-backups are not enabled in Supabase Storage mode; create them
  from `/backup` or add a scheduled job.
- **Safe testing:** test restores against a separate database first
  (`DATABASE_URL` pointing at a test DB). A restore overwrites newer records.
- **`pg_dump` alternative (optional):** if you prefer native SQL dumps on
  Windows, install PostgreSQL (e.g. `winget install PostgreSQL.17`), then run
  `"C:\Program Files\PostgreSQL\17\bin\pg_dump.exe" "%DATABASE_URL%" -F c -f store.dump`
  and restore with `pg_restore`. The built-in JSON system above is recommended
  because it works on Vercel too and needs no extra tools.

## Notes

- The page files themselves are public; all data comes from `/api`, which requires a signed-in session. Anyone opening `/pos` while signed out is sent to `/login`.
- Dates are grouped in `STORE_TZ`, so "today" matches the store's clock, not the server's.
- Changing the VAT rate: `VAT_PERCENT` in `api/index.js` and `VAT` in `public/js/pos.js`/`receipt.js` text.
- Passwords created by the PHP installer (`password_hash`) are not carried over. Run the installer and create a new admin.
