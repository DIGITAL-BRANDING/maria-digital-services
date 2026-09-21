CREATE TABLE "AssistantAuditEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "intent" TEXT,
    "stage" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "errorCode" TEXT,
    "transactionRef" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AssistantAuditEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AssistantAuditEvent_userId_createdAt_idx" ON "AssistantAuditEvent"("userId", "createdAt");
CREATE INDEX "AssistantAuditEvent_stage_outcome_createdAt_idx" ON "AssistantAuditEvent"("stage", "outcome", "createdAt");
ALTER TABLE "AssistantAuditEvent" ADD CONSTRAINT "AssistantAuditEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
