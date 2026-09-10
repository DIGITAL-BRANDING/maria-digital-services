// Several Prisma models (Transaction, Coupon, DataPlanPricing) use BigInt
// columns for kobo-denominated amounts, since Postgres's `bigint` type maps
// to JS BigInt in Prisma. Node's JSON.stringify has no built-in support for
// BigInt and throws "Do not know how to serialize a BigInt" the moment any
// response - including AdminJS's own list/show/edit responses - tries to
// send one. Kobo amounts in this app are nowhere near Number.MAX_SAFE_INTEGER
// (2^53), so converting to Number here is lossless for any realistic
// transaction size. Must run before any other module that could trigger a
// JSON.stringify of a BigInt value, hence it's the very first thing here.
(BigInt.prototype as unknown as { toJSON: () => number }).toJSON = function toJSON(
  this: bigint
) {
  return Number(this);
};

import { env } from './config/env.js';
import { createApp } from './app.js';
import { prisma } from './lib/prisma.js';
import { alertCriticalError } from './lib/alerts.js';
import { purgeExpiredPii } from './scripts/purge-expired-pii.js';

process.on('uncaughtException', (error) => {
  console.error('[server] uncaught exception', error);
  // Best-effort: the process is exiting right after this regardless, so
  // this can't be awaited - but an uncaught exception is by definition the
  // most important thing this alerting will ever report, so it's worth the
  // attempt even without a guarantee the email makes it out before exit.
  void alertCriticalError('Uncaught exception (process exiting)', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('[server] unhandled rejection', reason);
  void alertCriticalError('Unhandled promise rejection (process exiting)', reason);
  process.exit(1);
});

async function startServer() {
  try {
    // MOCK_PROVIDER defaults to true when unset (see env.ts) - safe for local
    // dev, but if it's ever unset on a production deploy, data plans, purchases,
    // and the provider wallet balance shown in the admin dashboard will all be
    // fake/static instead of real Alrahuz data, with no visible error. Shout
    // about it loudly here so a missing Railway env var doesn't go unnoticed.
    if (env.NODE_ENV === 'production' && env.MOCK_PROVIDER) {
      console.error(
        '[server] WARNING: NODE_ENV=production but MOCK_PROVIDER is true (unset or not "false"). ' +
          'Data plans, purchases, and the provider wallet balance are all running on MOCK data. ' +
          'Set MOCK_PROVIDER=false in the Railway environment variables to use real Alrahuz data.'
      );
    }

    // Same shape of footgun as MOCK_PROVIDER above, for the independent
    // Techhub identity-verification provider (NIN/BVN) - see techhub.service.ts.
    if (env.NODE_ENV === 'production' && env.MOCK_TECHHUB) {
      console.error(
        '[server] WARNING: NODE_ENV=production but MOCK_TECHHUB is true (unset or not "false"). ' +
          'NIN/BVN verification requests are all running on MOCK data instead of hitting Techhub. ' +
          'Set MOCK_TECHHUB=false and TECHHUB_API_KEY in the Railway environment variables to use real Techhub data.'
      );
    }

    console.log('[server] Creating Express app');
    const app = createApp();

    // Eagerly create every ServicePricing row (both Techhub NIN/BVN services
    // and Alrahuz result-pin exam types) right now, instead of waiting for
    // each one's first real API call. Without this, a freshly-deployed
    // environment shows an incomplete/empty "Verification Pricing" admin
    // page until every single service has been purchased at least once —
    // getOrCreateVerificationPricingRow / getOrCreateServicePricingRow only
    // insert a row lazily on first read, and AdminJS's ServicePricing
    // resource queries the table directly (not through those functions), so
    // rows nobody has bought yet were simply invisible to admins trying to
    // review or adjust prices. Failure here must never block startup - it's
    // a convenience seed, not a dependency of anything else.
    try {
      const { listVerificationPricesForAdmin } = await import('./services/verification.service.js');
      const { listServicePricesForAdmin } = await import('./services/result-pin.service.js');
      const [verificationPrices, resultPinPrices] = await Promise.all([
        listVerificationPricesForAdmin(),
        listServicePricesForAdmin()
      ]);
      console.log(
        `[server] Seeded service pricing rows: ${verificationPrices.length} Techhub, ${resultPinPrices.length} Alrahuz`
      );
    } catch (error) {
      console.error('[server] Failed to seed service pricing rows (non-fatal):', error);
    }

    const server = app.listen(env.PORT, '0.0.0.0', () => {
      console.log(`MARIA Digital Solutions backend listening on port ${env.PORT}`);
    });

    // Daily PII purge, running in-process rather than requiring a separate
    // Railway Cron Job/external scheduler to be set up - `npm run
    // purge:pii` still works standalone for anyone who prefers that
    // instead (see purge-expired-pii.ts), but leaving it as opt-in-only
    // meant it was never actually wired up anywhere: PII was accumulating
    // past its retention window indefinitely. A short delay before the
    // first run avoids adding a slow query to the critical first seconds
    // after a fresh deploy; every run after that is a full 24h apart.
    // Errors are caught and logged (+ alertCriticalError below) but never
    // crash the server - a failed purge attempt should not take the whole
    // app down, it'll simply retry tomorrow.
    const PII_PURGE_INTERVAL_MS = 24 * 60 * 60 * 1000;
    setTimeout(() => {
      void purgeExpiredPii().catch((error) => void alertCriticalError('Scheduled PII purge failed', error));
      setInterval(() => {
        void purgeExpiredPii().catch((error) => void alertCriticalError('Scheduled PII purge failed', error));
      }, PII_PURGE_INTERVAL_MS);
    }, 60_000);

    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`[server] Port ${env.PORT} is already in use`);
      } else {
        console.error('[server] listen error', err);
      }
      process.exit(1);
    });

    const shutdownSignals: NodeJS.Signals[] = ['SIGTERM', 'SIGINT'];
    shutdownSignals.forEach((signal) => {
      process.on(signal, () => {
        console.log(`[server] Received ${signal}, shutting down gracefully`);
        server.close(async () => {
          await prisma.$disconnect();
          console.log('[server] Server closed, database disconnected');
          process.exit(0);
        });

        setTimeout(() => {
          console.error('[server] Forced shutdown after 10s timeout');
          process.exit(1);
        }, 10_000);
      });
    });
  } catch (error) {
    console.error('[server] Failed to start server', error);
    await prisma.$disconnect();
    process.exit(1);
  }
}

void startServer();

