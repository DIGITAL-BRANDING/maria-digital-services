-- Split out of 20260803090000_enable_row_level_security, which ran BEFORE
-- these two tables existed (they were created a day later, in
-- 20260804090000_add_support_tickets) and so failed with "relation does
-- not exist" when it reached these two lines. Same reasoning as that
-- migration applies here: the backend accesses these tables as the
-- Postgres owner role, which RLS never restricts, so this only closes
-- off Supabase's separate PostgREST path - see the comment in
-- 20260803090000_enable_row_level_security/migration.sql for the full
-- explanation.

ALTER TABLE "SupportTicket" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SupportTicketMessage" ENABLE ROW LEVEL SECURITY;
