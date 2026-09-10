-- CreateTable
CREATE TABLE "WhatsAppSession" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "userId" TEXT,
    "state" TEXT NOT NULL DEFAULT 'START',
    "context" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppSession_phone_key" ON "WhatsAppSession"("phone");

-- Same reasoning as 20260803090000_enable_row_level_security: the backend
-- reads/writes this table as the Postgres owner role, which RLS never
-- restricts, so this only closes off Supabase's separate PostgREST path.
ALTER TABLE "WhatsAppSession" ENABLE ROW LEVEL SECURITY;
