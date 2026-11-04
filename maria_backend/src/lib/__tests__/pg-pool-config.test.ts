import { describe, expect, it } from 'vitest';
import { buildPgPoolConfig } from '../pg-pool-config.js';

const URL_WITH_SSL = 'postgresql://postgres.ref:p%40ss@aws-1-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=require';

describe('buildPgPoolConfig', () => {
  it('removes sslmode from the URL so it cannot override the explicit ssl setting', () => {
    const config = buildPgPoolConfig(URL_WITH_SSL);
    expect(config.connectionString).not.toContain('sslmode');
    expect(config.connectionString).toContain('pooler.supabase.com:5432/postgres');
  });

  it('keeps the password encoding intact', () => {
    expect(buildPgPoolConfig(URL_WITH_SSL).connectionString).toContain('p%40ss');
  });

  it('encrypts without verifying the certificate when no CA is configured', () => {
    expect(buildPgPoolConfig(URL_WITH_SSL).ssl).toEqual({ rejectUnauthorized: false });
  });

  it('verifies the certificate against the configured CA, converting escaped newlines', () => {
    const pem = '-----BEGIN CERTIFICATE-----\\nABC\\n-----END CERTIFICATE-----';
    expect(buildPgPoolConfig(URL_WITH_SSL, pem).ssl).toEqual({
      ca: '-----BEGIN CERTIFICATE-----\nABC\n-----END CERTIFICATE-----',
      rejectUnauthorized: true
    });
  });

  it('treats a blank CA value as not configured', () => {
    expect(buildPgPoolConfig(URL_WITH_SSL, '   ').ssl).toEqual({ rejectUnauthorized: false });
  });
});
