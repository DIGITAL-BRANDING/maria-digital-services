-- A provider reference identifies one external payment event.  `reference`
-- remains an app-owned ledger ID, so external references cannot collide with
-- an unrelated historical transaction.
CREATE UNIQUE INDEX "Transaction_provider_providerRef_key"
ON "Transaction"("provider", "providerRef");
