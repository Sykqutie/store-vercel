# SmartMart POS - Supabase connection plan (status: connected, data merged, deployed)

## Category management update (pending deployment)

- Adds a managed `categories` table plus `/categories` owner page and API.
- `products.category` stays a denormalized string; there is no product-category FK.
- New products with a blank category are classified from the item name
  (restocks reuse their existing barcode category first), then `Uncategorized`.
- `Uncategorized` is the protected fallback. Owners can rename, deactivate,
  reactivate, or merge categories; merges update product labels and preserve IDs.
- The API creates/backfills the table on first use, so the first production
  request after deploy performs the migration. It has not been run against
  production yet.
- Backups now include categories. Restoring an older backup without categories
  rebuilds the table from default names and existing product labels.

## Where things stand

- The app talks to Postgres **server-side only** (`pg` + `lib/db.js`). No browser
  code, no Supabase client, no Data API, no Supabase Auth.
- `.env` -> Supabase **session pooler** `aws-0-ap-southeast-2.pooler.supabase.com:5432`,
  user `postgres.<project-ref>`, database `postgres`.
- TLS verified end to end: client socket `encrypted=true`, **TLSv1.3**,
  `rejectUnauthorized: true` against the bundled `certs/supabase-root-ca.pem`
  (*Supabase Root 2021 CA*, valid to 2031). Certificate verification is on.
- The Supabase schema already matches `database/schema.sql` exactly - **no
  migration is required**. All 5 tables, columns, defaults, constraints,
  indexes and the FK on `sale_items.sale_id` are present.
- RLS is **enabled** on all 5 tables with **0 policies** (so the Data API is
  effectively closed) and must stay that way. The app connects as `postgres`
  (`rolbypassrls=true`), so it is unaffected.
- **The Neon -> Supabase merge has been applied** (2026-10-21). It was a pure
  insert: 3 products, 1 user, 3 stock movements. No existing row was updated
  or deleted, and 0 conflicts were found.

## Current data (after the merge)

| Table | Supabase (target) | Neon (source) | Neon still to migrate |
| --- | --- | --- | --- |
| products | 13 | 13 | 0 |
| users | 3 (`owner`, `cashier`, `admin`/owner) | 1 (`admin`/owner) | 0 |
| stock_movements | 3 | 3 | 0 |
| sales | 0 | 0 | 0 |
| sale_items | 0 | 0 | 0 |

The Neon database can now be treated as a spare copy; nothing in the app
points at it any more (only `scripts/merge-neon.js` reads it).

## Merge plan (dry-run verified against the live Neon DB) - APPLIED

Neon host `ep-young-wave-b4e3txx0-pooler.c-6.us-east-2.aws.neon.tech` is
PostgreSQL 18.6, reachable over TLSv1.3, and holds exactly 13 / 1 / 3 / 0 / 0.

| Action | Count | Detail |
| --- | --- | --- |
| products identical (skipped) | 10 | every demo-seed row matched on name, category, cost, price, stock, threshold |
| products inserted | 3 | `Del Monte` `4800024562616` (50/40), `Coca-Cola` `480009124818` (120/25), `Keratin` `480011100166` (120/10) |
| product conflicts | 0 | no barcode existed in both with different values |
| users inserted | 1 | `admin` / owner / active, bcrypt hash copied verbatim |
| users modified | 0 | `owner` and `cashier` were never touched |
| stock_movements inserted | 3 | all `reason=initial`, one per created product; `product_id` remapped after the product insert |
| sales / sale_items | 0 | nothing to copy |

Because there were **zero conflicts**, `--on-conflict` did not matter for this
run: `skip`, `neon` and `supabase` all produce the same 3 + 1 + 3 inserts.

Safety nets that were used:
- `smartmart-backup-20261021-163532-safety.json` - full pre-merge backup.
- `backups/merge-undo-2026-10-21T08-35-36-568Z.json` - ids of every inserted
  row, so the merge can be undone row by row.
- One transaction: any error rolls the whole merge back.

Post-merge verification (`npm run db:verify-merge`) confirmed 13 / 3 / 3 / 0 / 0
rows and that all 3 stock movements resolve to the right product via
`product_id`. A rolled-back write test (`npm run db:smoke-writes`) exercised the
real checkout path (sale + sale_items + stock decrement + movement) and
confirmed the `sale_items_sale_id_fkey` cascade, then rolled back - the
database was left byte-identical.

## Deployment (live)

Production: **https://store-vercel-mu.vercel.app** (Vercel project `jennyrose/store-vercel`).
The same build is also reachable at `store-vercel-jennyrose.vercel.app` and
`store-vercel-git-main-jennyrose.vercel.app`; those two are behind Vercel
Authentication (project setting `ssoProtection = all_except_custom_domains`),
while the project domain above is served directly.

| Item | Value |
| --- | --- |
| Project / project id | `jennyrose/store-vercel` / `prj_rR4do24cMnR7hdJomD85ecc8PDyK` |
| Production env `DATABASE_URL` | Supabase session pooler, percent-encoded password |
| Production env `AUTH_SECRET` | same value as local `.env` (sessions are interchangeable) |
| Bundle inputs | `vercel.json` `functions.api.index.js.includeFiles = "{database,certs}/**"` |
| Health check | `GET /api/status` -> `configured/authSecret/installed = true`, `dbHost = aws-0-ap-southeast-2.pooler.supabase.com` |

Notes that cost time and are worth keeping:

- `includeFiles` **must be a string**. The published JSON schema allows an
  array, but the build rejects it with
  `functions.api.index.js.includeFiles should be string`, and the deployment
  fails before it ever starts.
- `.vercelignore` (not `.gitignore`) decides what Vercel uploads. It must keep
  `.env` and `backups/` out (the backups contain bcrypt hashes) while
  `certs/` and `database/` stay in.
- Vercel snapshots environment variables at build time, so changing an env var
  requires a new deployment (`vercel redeploy <deployment-id> --environment production`).
- The commit status "Vercel Deployments - jennyrose" is red even though every
  build ends with "Deployment completed". The cause is Vercel's own internal
  check on the deployment, not the build:

  ```
  GET /v13/deployments/<id>
    readyState    = READY
    readySubstate = STAGED
    aliasAssigned = false
    checks        = { "deployment-alias": { "state": "failed" } }
  ```

  The `deployment-alias` check tries to hand the production domain to the new
  deployment and fails, so the deployment stays STAGED, the project domain is
  not moved automatically, and the GitHub app reports
  "1 required project failed to deploy". It has been failing for every
  deployment of this project for at least 8 days (including the ones that
  were serving production), so it is a pre-existing project/team
  configuration problem, not something the Supabase migration caused. The
  project was transferred from the team whose slug is `mu`
  (`store-vercel-mu.vercel.app` is the leftover project domain) to `jennyrose`
  (`store-vercel-jennyrose.vercel.app`), and the alias assignment still
  disagrees with that.
- Workaround: assign the domain by hand after every build -
  `vercel alias set <deployment-url> store-vercel-mu.vercel.app` - and check
  it with `GET /api/status` (it must report the Supabase pooler host).
- The project domain does **not** follow the newest production deployment on
  its own. After a new build, re-point it explicitly:
  `vercel alias set <deployment-url> store-vercel-mu.vercel.app`.

## Conflict rules (kept for reference - none were hit)

1. **Users** - a Neon username that already exists in Supabase is *never*
   modified; it is reported and skipped. A new username is inserted with its
   bcrypt hash copied verbatim. `owner` and `cashier` were not touched.
2. **Products** - a Neon product whose barcode already exists in Supabase is
   a conflict. Default behaviour is *skip and report*; `--on-conflict=neon`
   overwrites the target row, `--on-conflict=supabase` keeps it. There were
   none in this run.
3. **stock_movements** - `product_id` is remapped from the Neon id to the
   Supabase id via barcode. Movements whose product was not imported are
   inserted with `product_id = NULL` (the table has no FK; `product_name` is
   kept, so history stays readable).

## Re-running the merge (it is idempotent)

```
# 1. add the old Neon URL to .env (git-ignored, never committed)
#    NEON_DATABASE_URL=postgresql://...@ep-xxx.region.aws.neon.tech/neondb?sslmode=require

npm run db:merge-neon                        # dry run - prints the plan only
npm run db:merge-neon -- --apply             # apply inside ONE transaction
npm run db:merge-neon -- --apply --on-conflict=neon
```

The apply path writes a `safety` backup first and an undo file
(`backups/merge-undo-<timestamp>.json`) listing every inserted row.
Re-running it now is a no-op: the 3 products, the user and the 3 movements
already exist, so they are reported as identical/present.

## Steps that need a human

1. **Rotate the Supabase database password** (it was shared in plaintext) and
   update `.env` + Vercel `DATABASE_URL` together, keeping the value
   percent-encoded (`@` -> `%40`). *Deliberately deferred for now.*
2. ~~Vercel -> Settings -> Environment Variables -> DATABASE_URL~~ - done,
   production + preview already point at the Supabase session pooler.
3. ~~Vercel -> Settings -> Environment Variables -> AUTH_SECRET~~ - done, the
   production/preview/development values now match local `.env`, so a session
   minted locally is accepted in production (and the other way round).
4. ~~Deploy, then check `/api/status`~~ - done, it returns
   `configured:true`, `authSecret:true`, `installed:true` and
   `dbHost:"aws-0-ap-southeast-2.pooler.supabase.com"`.
5. ~~Commit the repo changes~~ - done: `76f99a8` (Supabase + merge tooling)
   and `8fc16c2` (build fix), both pushed to `origin/main`.

## Housekeeping

- `certs/supabase-root-ca.pem` must be **committed** (public CA cert, not a
  secret) - `vercel.json` ships it to the function via `includeFiles`.
- `@supabase/supabase-js` / `@supabase/ssr` in `package.json` are **unused**
  (dead weight). `NEXT_PUBLIC_SUPABASE_URL` /
  `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` in `.env` are **unused** too and are
  not needed for a browser client that does not exist.
- `.agents/` and `skills-lock.json` are local agent tooling - keep them out of
  the repo or ignore them explicitly.

## The Supabase `anon` key (verified read-only)

The `anon` JWT + project URL (`https://yczcnrhqnionxdpumaen.supabase.co`) were
probed against the Data API:

| Request | Result |
| --- | --- |
| `GET /rest/v1/{products,users,stock_movements,sales,sale_items}` | `200 []` - empty, RLS filters everything |
| `POST /rest/v1/products` (`Prefer: tx=rollback`) | `401` `42501` "new row violates row-level security policy" |

So the `anon` key exposes **no data** and cannot write. It is still not needed
by this app (no browser client) and must not be committed. It was only used
for the probe above and was not written to any file in the repo.

Note that `anon` and `authenticated` do hold table-level `SELECT`/`INSERT`/
`UPDATE` privileges, but with RLS enabled and zero policies every statement
is filtered to zero rows. Optional hardening (needs approval): revoke
`INSERT`/`UPDATE`/`DELETE`/`TRUNCATE` from `anon` and `authenticated` and
grant only `SELECT` on the tables the browser would ever need.

## Credential hygiene

Both the Supabase database password and the Neon `neondb_owner` password were
shared in plaintext in the chat, so treat them as disclosed:

- Supabase: **Settings -> Database -> Reset database password**, then update
  `.env` `DATABASE_URL` **and** the Vercel `DATABASE_URL` in the same sitting
  (the value must stay percent-encoded: `@` -> `%40`). A mismatch shows up as
  `28P01` (password authentication failed).
- Neon: no longer used by the app after the merge; rotate it only if the
  Neon project will be kept around.

`.env` holds all three secrets and is git-ignored - confirmed untracked, and
no credential appears in any tracked file or diff.
