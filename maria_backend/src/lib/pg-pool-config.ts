import type { PoolConfig } from 'pg';

/**
 * Builds a node-postgres pool config from DATABASE_URL for the admin session store.
 *
 * `pg` treats `sslmode=require` in a connection string as `verify-full`, which
 * fails against the Supabase certificate chain with SELF_SIGNED_CERT_IN_CHAIN
 * (Prisma connects fine because it does not go through this path). So the
 * sslmode parameters are removed from the URL and TLS is set explicitly here:
 *   - with a CA certificate (DATABASE_SSL_CA): full verification;
 *   - without one: encrypted, server certificate not verified (what sslmode=require
 *     actually promises in libpq semantics).
 */
export function buildPgPoolConfig(databaseUrl: string, caPem?: string): PoolConfig {
  const url = new URL(databaseUrl);
  url.searchParams.delete('sslmode');
  url.searchParams.delete('uselibpqcompat');

  const ca = caPem?.trim() ? caPem.replace(/\\n/g, '\n') : undefined;
  return {
    connectionString: url.toString(),
    ssl: ca ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: false }
  };
}
