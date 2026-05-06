CREATE TABLE IF NOT EXISTS "telegram_report_receivers" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "chatId" TEXT NOT NULL,
  "username" TEXT,
  "telegramName" TEXT,
  "createdByUserId" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "telegram_report_receivers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "telegram_report_receivers_tenantId_chatId_key"
  ON "telegram_report_receivers" ("tenantId", "chatId");

CREATE INDEX IF NOT EXISTS "telegram_report_receivers_tenantId_isActive_idx"
  ON "telegram_report_receivers" ("tenantId", "isActive");

CREATE INDEX IF NOT EXISTS "telegram_report_receivers_tenantId_createdByUserId_isActive_idx"
  ON "telegram_report_receivers" ("tenantId", "createdByUserId", "isActive");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'telegram_report_receivers_tenantId_fkey') THEN
    ALTER TABLE "telegram_report_receivers"
      ADD CONSTRAINT "telegram_report_receivers_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'telegram_report_receivers_createdByUserId_fkey') THEN
    ALTER TABLE "telegram_report_receivers"
      ADD CONSTRAINT "telegram_report_receivers_createdByUserId_fkey"
      FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
