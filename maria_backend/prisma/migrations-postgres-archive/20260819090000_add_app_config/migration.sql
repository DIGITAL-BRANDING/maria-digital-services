-- App-version gate configuration used by GET /api/public/app-config and the
-- AppConfig AdminJS resource. The Prisma model was added without its matching
-- database migration, leaving production deployments to fail with P2021.
CREATE TABLE IF NOT EXISTS "AppConfig" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "minAndroidVersion" TEXT NOT NULL DEFAULT '1.0.0',
    "latestAndroidVersion" TEXT NOT NULL DEFAULT '1.0.0',
    "androidDownloadUrl" TEXT NOT NULL DEFAULT 'https://github.com/DIGITAL-BRANDING/MAJOR-DATA-LINK/releases/latest/download/MajorDataLink.apk',
    "updateMessage" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppConfig_pkey" PRIMARY KEY ("id")
);
