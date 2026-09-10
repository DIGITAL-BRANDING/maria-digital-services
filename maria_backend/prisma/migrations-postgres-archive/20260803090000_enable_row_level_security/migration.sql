-- Supabase flags every public-schema table that has Row Level Security (RLS)
-- disabled, because Supabase auto-exposes ALL public tables through its
-- PostgREST API (https://<project>.supabase.co/rest/v1/<table>) using the
-- project's anon/public API key. That key is *meant* to be safe to expose
-- (it's baked into client apps everywhere) - the thing that's supposed to
-- keep it safe is RLS. With RLS off, anyone who has (or finds) that anon
-- key can read and write every row in every table directly through
-- Supabase's API, completely bypassing this app's own backend, its auth
-- checks, and all of its business logic (wallet balance checks, KYC status,
-- transaction validation, etc).
--
-- This app's Flutter client never uses the Supabase SDK or PostgREST at
-- all - it only ever talks to this repo's own Express backend, which
-- connects to Postgres directly via Prisma using the `postgres` role
-- (see DATABASE_URL / DIRECT_URL in schema.prisma). Postgres's Row Level
-- Security NEVER applies to a table's owner - the `postgres` role - so
-- enabling RLS here does not require writing a single policy and cannot
-- break anything the backend does: the backend was never subject to RLS
-- to begin with, and never will be. What it DOES do is close off the
-- separate, currently-wide-open PostgREST path entirely, since with RLS
-- enabled and zero policies defined, Postgres denies ALL access to any
-- role that isn't the owner - exactly what we want here, since nothing
-- legitimate is supposed to use that path anyway.
--
-- If a future feature ever needs the Supabase client SDK directly from the
-- app (e.g. Supabase Storage or Realtime), add narrow, explicit CREATE
-- POLICY statements for exactly that table/role at that time - don't
-- remove this blanket lockdown for the rest.

ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RefreshToken" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Transaction" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DataPlanPricing" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ServicePricing" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ReferralSettings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Coupon" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProviderBalanceStatus" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DeviceToken" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Notification" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "NotificationBroadcast" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AdminUser" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AdminAuditLog" ENABLE ROW LEVEL SECURITY;

-- SupportTicket / SupportTicketMessage were intentionally NOT added here.
-- Those two tables don't exist yet at this point in migration history (they're
-- created later, in 20260804090000_add_support_tickets) - enabling RLS on them
-- from this migration made a fresh database applying all migrations in order
-- fail with "relation does not exist". Enabling RLS on them was moved to
-- 20260809140000_enable_rls_support_tickets, which runs after that table exists.

-- Prisma's own internal migration-tracking table also lives in the public
-- schema, so Supabase's linter flags it too even though it holds no user
-- data. Same reasoning applies: the backend touches it as table owner
-- (bypassing RLS automatically), so this is safe with zero policies.
ALTER TABLE "_prisma_migrations" ENABLE ROW LEVEL SECURITY;
