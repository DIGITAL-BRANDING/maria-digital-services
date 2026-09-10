# MAJOR DATA-LINK Backend

Production-minded backend starter for the Flutter app at `C:\imam\imam_datasub`.

## Why This Backend

The Flutter app already has Firebase Auth, but wallet, VTU purchases, PIN checks, provider tokens, transactions, KYC, and support tickets must live behind a trusted server. The mobile app should never ship the Alrahuz API token or decide wallet balances locally.

## Stack

- Node.js + Express + TypeScript
- PostgreSQL + Prisma
- Firebase Admin for verifying Flutter Firebase ID tokens
- Server-side Alrahuz integration
- Idempotent wallet debit and transaction ledger foundation

## Start

```bash
cp .env.example .env
npm install
docker compose up -d
npm run prisma:generate
npm run prisma:migrate
npm run dev
```

Health check:

```bash
curl http://localhost:8787/health
```

Flutter development API base URL:

```dart
--dart-define=API_BASE_URL=http://10.0.2.2:8787/api
```

On a physical phone, use your computer LAN IP instead of `10.0.2.2`.

