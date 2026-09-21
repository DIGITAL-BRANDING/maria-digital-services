CREATE TABLE "UserDelivery" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "fileName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "filePath" TEXT NOT NULL,
  "fileSize" INTEGER NOT NULL,
  "reference" TEXT,
  "createdByAdminId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserDelivery_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "UserDelivery_filePath_key" ON "UserDelivery"("filePath");
CREATE INDEX "UserDelivery_userId_createdAt_idx" ON "UserDelivery"("userId", "createdAt");
ALTER TABLE "UserDelivery" ADD CONSTRAINT "UserDelivery_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "UserDelivery" ADD CONSTRAINT "UserDelivery_createdByAdminId_fkey" FOREIGN KEY ("createdByAdminId") REFERENCES "AdminUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
