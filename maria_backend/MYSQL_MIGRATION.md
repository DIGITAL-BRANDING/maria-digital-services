# PostgreSQL to MySQL cutover

## Production database on Railway

The local XAMPP URL (`127.0.0.1`) is only for development. Railway cannot
reach it. Put the API and a Railway MySQL service in the **same Railway
project and environment** so their connection stays on Railway's private
network.

1. In the Railway project canvas, click **+ New** and choose **Database →
   MySQL**. Keep its service private; do not enable Public Access merely for
   the API.
2. Wait until the MySQL service is healthy. In the backend service's
   **Variables** tab, create `DATABASE_URL` as a reference to the MySQL
   service's `MYSQL_URL`. In Railway raw-variable form this is
   `${{MySQL.MYSQL_URL}}` when the database service is named `MySQL`; replace
   `MySQL` with the exact service name shown in the canvas.
3. Set `NODE_ENV=production`, the production `WEB_ALLOWED_ORIGINS`, and real
   random values for `AUTH_TOKEN_SECRET`, `ADMIN_SESSION_SECRET`, and
   `PII_ENCRYPTION_KEY`. Mark secrets as sealed in Railway.
4. For the **first** backend deployment only, set
   `RUN_MIGRATIONS_ON_START=true`. The app runs the versioned Prisma MySQL
   baseline before starting. After a successful deployment, set it back to
   `false` (or remove it) so ordinary restarts do not run a migration command.
5. Deploy the backend, then check `/health` and perform one normal user login
   and one admin login. Only after these checks should Supabase credentials be
   removed or the old database be deleted.

Railway documents the MySQL service variables and its private-network
connection pattern at https://docs.railway.com/databases/mysql . Public Access
is necessary only if a tool outside Railway needs direct database access; it
creates a TCP proxy and is not required by this backend.

This project now targets MySQL 8.0+ through Prisma. The old PostgreSQL
migrations are retained under `prisma/migrations-postgres-archive` as an audit
record; they must never be deployed to a MySQL database.

## Before the maintenance window

1. Keep the PostgreSQL database unchanged and take a provider-level backup.
2. Provision an empty MySQL 8.0+ database using `utf8mb4` and a dedicated,
   least-privileged application account. Set a TLS-enabled `DATABASE_URL` in
   the deployment environment; it must start with `mysql://`.
3. Deploy this code only after the MySQL baseline migration below has been
   applied. Do not change production `DATABASE_URL` yet.
4. Run `npm ci`, `npm run prisma:generate`, `npm run build`, and `npm test` in
   CI using a MySQL URL. For local development, `docker compose up -d` starts
   MySQL at `mysql://infoverify:infoverify_dev_only@localhost:3306/infoverify`.

## Apply the schema

The committed baseline migration is generated from `prisma/schema.prisma` for
MySQL. On the new, empty target database run:

```powershell
$env:DATABASE_URL = 'mysql://user:password@host:3306/infoverify'
npm run prisma:migrate:deploy
```

`prisma migrate deploy` creates and records the schema; it does not copy data.

## Copy and verify data

During a maintenance window, stop writes to the PostgreSQL application first.
Use a direct, read-only PostgreSQL connection as the source. Never commit these
URLs or paste them into scripts.

```powershell
$env:PG_SOURCE_URL = 'postgresql://readonly-user:password@source-host:5432/database'
$env:MYSQL_DATABASE_URL = 'mysql://user:password@mysql-host:3306/infoverify'
npm run migrate:postgres-to-mysql
```

The script streams tables in foreign-key order, preserves UTC timestamps,
keeps foreign keys enabled, restores self-referencing transaction rows in a
second pass, and fails if the destination schema differs or any row count does
not match. It is restartable: existing primary keys are left intact, while
invalid/truncated rows fail visibly rather than being ignored. First run it
with `MIGRATION_DRY_RUN=true` to validate connectivity and schema only.

### Data API fallback (no direct PostgreSQL connection)

If the source network cannot reach Supabase's IPv6-only direct endpoint and a
pooler is unreliable, the same script can read through Supabase's Data API.
This uses an existing service-role key; it must never be exposed in a browser,
source file, screenshot, or client application.

```powershell
$env:MIGRATION_SOURCE = 'supabase-api'
$env:SUPABASE_SOURCE_URL = 'https://your-project.supabase.co'
$env:SUPABASE_SOURCE_SERVICE_ROLE_KEY = '<service-role-key>'
$env:MYSQL_DATABASE_URL = 'mysql://user:password@127.0.0.1:3306/infoverify'
$env:MIGRATION_DRY_RUN = 'true'
npm run migrate:postgres-to-mysql
```

The API mode reads every table in keyset-paginated batches, preserves raw
PostgreSQL bigint values before JavaScript parses JSON, and performs the same
row-count verification. After a successful dry run, set
`MIGRATION_DRY_RUN=false` and rerun. It still requires the Supabase project to
remain active and its API to be reachable.

## Cut over safely

1. Keep the write freeze in place until row-count verification succeeds.
2. Spot-check wallet balances, transaction histories, encrypted JSON/PII,
   support messages, user deliveries, and admin login/session persistence.
3. Change the production `DATABASE_URL` to the MySQL URL and remove
   `DIRECT_URL`; it no longer has a purpose.
4. Deploy, monitor logs, and make a small controlled transaction before
   reopening normal writes.
5. Keep PostgreSQL read-only and retain its provider backup until the agreed
   observation period completes. Revert by pointing the prior deployment at
   PostgreSQL only while no writes have been accepted on MySQL.

## MySQL-specific notes

- Free-form messages/descriptions use `TEXT` so MySQL's default 191-character
  `VARCHAR` limit cannot truncate business data.
- Prisma represents the application's enums as MySQL enums. Future enum
  changes must be made through a generated Prisma migration and deployed
  before code uses the new value.
- PostgreSQL row-level-security policies do not transfer to MySQL. Access is
  enforced by the backend and MySQL database account privileges; do not grant
  the runtime user schema-administration permissions.
