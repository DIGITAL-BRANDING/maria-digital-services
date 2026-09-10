# Retired: Supabase PostgreSQL deployment

> This guide is retained only as historical context. The application now uses
> MySQL; follow [MYSQL_MIGRATION.md](MYSQL_MIGRATION.md) for the supported
> provision, data-copy, and cutover procedure. Do not set a PostgreSQL URL or
> `DIRECT_URL` in a current deployment.

Supabase will host the Postgres database. This Express backend still needs a Node host
such as Render free tier, Railway trial/free credits, Fly.io allowance, or a small VPS.

## 1. Create Supabase project

1. Create a new Supabase project.
2. Open Project Settings > Database.
3. Copy both connection strings:
   - `DATABASE_URL`: Transaction pooler URL, usually port `6543`.
   - `DIRECT_URL`: Direct connection URL, usually port `5432`.
4. Replace `[YOUR-PASSWORD]` with the real database password and URL-encode special
   characters in the password.

## 2. Backend environment variables

Set these on the Node host:

```bash
NODE_ENV=production
PORT=10000
DATABASE_URL=postgresql://postgres.PROJECT_REF:PASSWORD@aws-...pooler.supabase.com:6543/postgres?pgbouncer=true
DIRECT_URL=postgresql://postgres:PASSWORD@db.PROJECT_REF.supabase.co:5432/postgres
AUTH_TOKEN_SECRET=generate-a-strong-32-byte-or-longer-secret
ACCESS_TOKEN_TTL_SECONDS=86400
REFRESH_TOKEN_TTL_SECONDS=2592000
ADMIN_SESSION_SECRET=generate-another-strong-secret
ALRAHUZ_BASE_URL=https://alrahuzdata.com.ng/api
ALRAHUZ_API_TOKEN=your-provider-token
MOCK_PROVIDER=false
PAYSTACK_SECRET_KEY=your-paystack-secret
PAYSTACK_CALLBACK_URL=https://YOUR_BACKEND_DOMAIN/api/wallet/fund/verify
```

For MVP without live provider/payment yet, keep:

```bash
MOCK_PROVIDER=true
```

## 3. Render free tier settings

Use these commands:

```bash
Build Command: npm install && npm run build && npm run prisma:migrate:deploy
Start Command: npm run start
```

Health check URL:

```bash
/health
```

After deploy, open:

```bash
https://YOUR_BACKEND_DOMAIN/health
```

Expected response:

```json
{"status":true,"service":"imam-datasub-backend"}
```

## 4. Flutter production build

Point the app to the deployed backend:

```bash
flutter build apk --dart-define=APP_ENV=production --dart-define=API_BASE_URL=https://YOUR_BACKEND_DOMAIN/api
```

Do not pass `API_TOKEN` to Flutter. Provider tokens belong only in the backend host
environment variables.
