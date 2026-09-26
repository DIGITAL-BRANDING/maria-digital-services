CREATE TABLE "MajorDataLinkWebhookEvent" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "reference" TEXT,
    "payload" JSONB NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MajorDataLinkWebhookEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MajorDataLinkWebhookEvent_eventId_key" ON "MajorDataLinkWebhookEvent"("eventId");
CREATE INDEX "MajorDataLinkWebhookEvent_reference_receivedAt_idx" ON "MajorDataLinkWebhookEvent"("reference", "receivedAt");
CREATE INDEX "MajorDataLinkWebhookEvent_event_receivedAt_idx" ON "MajorDataLinkWebhookEvent"("event", "receivedAt");
