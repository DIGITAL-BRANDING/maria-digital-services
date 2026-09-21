# MySQL to Supabase PostgreSQL cutover

## What this deployment uses

The application now uses PostgreSQL. In Railway, set `DATABASE_URL` to the
Supabase **Session Pooler** connection string (the IPv4-compatible URL), with
`?sslmode=require` appended. Do not use a local XAMPP URL or expose this URL
to the web or mobile client.

```text
postgresql://postgres.PROJECT_REF:password@aws-region.pooler.supabase.com:5432/postgres?sslmode=require
```

The committed Prisma migrations in `prisma/migrations/` are PostgreSQL
migrations. The prior MySQL-only baseline is retained under
`prisma/migrations-mysql-archive/` for reference and must not be applied to
PostgreSQL.

## One-time data copy

During the maintenance window, stop application writes to MySQL. Apply the
PostgreSQL migrations to the target first, then copy. Keep both connection
strings out of source control, shells saved to disk, and screenshots.

```powershell
# MySQL is normally exposed locally through `railway connect MySQL`.
$env:MYSQL_SOURCE_URL = 'mysql://migration_export:password@127.0.0.1:LOCAL_PORT/railway'
$env:POSTGRES_DATABASE_URL = 'postgresql://postgres.PROJECT_REF:password@aws-region.pooler.supabase.com:5432/postgres?sslmode=require'

# Optional safety check: checks both schemas without writing target data.
$env:MIGRATION_DRY_RUN = 'true'
npm run migrate:mysql-to-postgres

# Final copy and row-count verification.
$env:MIGRATION_DRY_RUN = 'false'
npm run migrate:mysql-to-postgres
```

`scripts/migrate-mysql-to-postgres.mjs` reads from MySQL only. It is safe to
rerun after a lost SSH tunnel: destination inserts use upserts and the script
finishes by comparing the row count for every copied table. A successful run
ends with `Migration completed and all row counts match.`

If `railway connect MySQL` asks for the SSH-key passphrase, keep that terminal
open for the whole copy. If its connection terminates unexpectedly, rerun the
same migration command after reconnecting; do not delete target data.

## Railway cutover checklist

1. Confirm the final migration reports matching counts and spot-check a user,
   wallet balance, transaction history, pricing, and an admin account.
2. In Railway, replace the backend service's `DATABASE_URL` with the Supabase
   Session Pooler URL. Remove old MySQL-only connection variables when no
   longer needed.
3. Deploy this code. The backend's admin session store also uses PostgreSQL,
   so sessions survive normal restarts and multiple instances.
4. Verify `/health`, a normal user login, an admin login, and one controlled
   transaction before reopening writes.
5. Keep MySQL read-only and retain its backup for the agreed observation
   period. Only then retire the old database service.

`RUN_MIGRATIONS_ON_START=true` is only for applying pending versioned Prisma
migrations to an empty/new PostgreSQL database. Set it back to `false` after
the one-time deployment.
