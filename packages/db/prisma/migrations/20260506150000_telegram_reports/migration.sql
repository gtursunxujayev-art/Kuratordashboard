CREATE TABLE IF NOT EXISTS "telegram_link_tokens" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "telegram_link_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "telegram_link_tokens_tokenHash_key"
  ON "telegram_link_tokens" ("tokenHash");

CREATE INDEX IF NOT EXISTS "telegram_link_tokens_tenantId_userId_idx"
  ON "telegram_link_tokens" ("tenantId", "userId");

CREATE INDEX IF NOT EXISTS "telegram_link_tokens_expiresAt_idx"
  ON "telegram_link_tokens" ("expiresAt");

CREATE INDEX IF NOT EXISTS "telegram_link_tokens_usedAt_idx"
  ON "telegram_link_tokens" ("usedAt");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'telegram_link_tokens_tenantId_fkey') THEN
    ALTER TABLE "telegram_link_tokens"
      ADD CONSTRAINT "telegram_link_tokens_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'telegram_link_tokens_userId_fkey') THEN
    ALTER TABLE "telegram_link_tokens"
      ADD CONSTRAINT "telegram_link_tokens_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "report_delivery_logs" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "periodKind" TEXT NOT NULL,
  "dateFrom" TIMESTAMP(3) NOT NULL,
  "dateTo" TIMESTAMP(3) NOT NULL,
  "recipient" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "report_delivery_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "report_delivery_logs_tenantId_periodKind_createdAt_idx"
  ON "report_delivery_logs" ("tenantId", "periodKind", "createdAt");

CREATE INDEX IF NOT EXISTS "report_delivery_logs_status_idx"
  ON "report_delivery_logs" ("status");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'report_delivery_logs_tenantId_fkey') THEN
    ALTER TABLE "report_delivery_logs"
      ADD CONSTRAINT "report_delivery_logs_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
