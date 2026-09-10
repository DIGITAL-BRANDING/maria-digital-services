/**
 * Runs once before the whole test suite (see vitest.config.ts's `setupFiles`).
 * env.ts calls `process.exit(1)` if its zod schema fails to parse - mainly
 * guarding DATABASE_URL, which is genuinely required in every real
 * environment but isn't set here since these are unit tests against mocked
 * dependencies, not a real database connection.
 *
 * PII_ENCRYPTION_KEY is set to a valid (if obviously fake) 64-hex-char key so
 * src/lib/pii-encryption.ts tests don't need a real one either.
 */
process.env.DATABASE_URL ??= 'mysql://test:test@localhost:3306/test_db';
process.env.PII_ENCRYPTION_KEY ??= 'a'.repeat(64);
process.env.NODE_ENV ??= 'test';
