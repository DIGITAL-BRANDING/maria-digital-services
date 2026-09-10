# Railway deployment (MySQL)

Set a direct MySQL 8.0+ `DATABASE_URL` in Railway, together with the normal
application secrets. It must use `mysql://`, not a PostgreSQL/Supabase URL.

```text
NODE_ENV=production
DATABASE_URL=mysql://user:password@mysql-host:3306/infoverify
AUTH_TOKEN_SECRET=<random string with at least 32 characters>
ADMIN_SESSION_SECRET=<random string with at least 16 characters>
PII_ENCRYPTION_KEY=<random 32-byte key>
```

`railway.json` installs dependencies, generates the Prisma client, and builds
both backend and web applications. Apply the committed MySQL migration once
against the new database using `npm run prisma:migrate:deploy`; set
`RUN_MIGRATIONS_ON_START=true` only for that one controlled deployment, then
remove it. `npm run start:prod` starts the API without migrations by default.

Complete the data transfer and verification in
[MYSQL_MIGRATION.md](MYSQL_MIGRATION.md) before changing production traffic.
