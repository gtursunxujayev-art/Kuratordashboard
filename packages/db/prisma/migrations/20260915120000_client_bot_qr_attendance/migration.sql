-- Client Telegram bot + QR attendance ticket support.
-- Separate from the staff report bot (telegram_link_tokens) and the FaceID webhook.
-- 1) customers: add "telegramChatId" (+ unique index) and "telegramLinkedAt".
-- 2) client_telegram_link_tokens: per-client invite tokens (mirrors telegram_link_tokens).
-- 3) attendance_tickets: QR ticket token per (customer, courseRun).
-- All statements are idempotent so re-running is safe.

-- 1a) customers."telegramChatId"
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'customers'
      AND column_name = 'telegramChatId'
  ) THEN
    ALTER TABLE "customers"
      ADD COLUMN "telegramChatId" TEXT;
  END IF;
END $$;

-- 1b) customers."telegramLinkedAt"
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'customers'
      AND column_name = 'telegramLinkedAt'
  ) THEN
    ALTER TABLE "customers"
      ADD COLUMN "telegramLinkedAt" TIMESTAMP(3);
  END IF;
END $$;

-- 1c) unique index on telegramChatId (nulls allowed, uniqueness only among linked rows)
CREATE UNIQUE INDEX IF NOT EXISTS "customers_telegramChatId_key"
  ON "customers" ("telegramChatId");

-- 1d) index for fast client-bot lookups
CREATE INDEX IF NOT EXISTS "customers_tenantId_telegramChatId_idx"
  ON "customers" ("tenantId", "telegramChatId");

-- 2) client_telegram_link_tokens
CREATE TABLE IF NOT EXISTS "client_telegram_link_tokens" (
  "id"              TEXT NOT NULL,
  "tenantId"        TEXT NOT NULL,
  "customerId"      TEXT NOT NULL,
  "tokenHash"       TEXT NOT NULL,
  "expiresAt"       TIMESTAMP(3) NOT NULL,
  "usedAt"          TIMESTAMP(3),
  "createdByUserId" TEXT NOT NULL,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "client_telegram_link_tokens_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'client_telegram_link_tokens_tokenHash_key'
  ) THEN
    ALTER TABLE "client_telegram_link_tokens"
      ADD CONSTRAINT "client_telegram_link_tokens_tokenHash_key" UNIQUE ("tokenHash");
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'client_telegram_link_tokens_tenantId_fkey'
  ) THEN
    ALTER TABLE "client_telegram_link_tokens"
      ADD CONSTRAINT "client_telegram_link_tokens_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'client_telegram_link_tokens_customerId_fkey'
  ) THEN
    ALTER TABLE "client_telegram_link_tokens"
      ADD CONSTRAINT "client_telegram_link_tokens_customerId_fkey"
      FOREIGN KEY ("customerId") REFERENCES "customers"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "client_telegram_link_tokens_tenantId_customerId_idx"
  ON "client_telegram_link_tokens" ("tenantId", "customerId");
CREATE INDEX IF NOT EXISTS "client_telegram_link_tokens_expiresAt_idx"
  ON "client_telegram_link_tokens" ("expiresAt");
CREATE INDEX IF NOT EXISTS "client_telegram_link_tokens_usedAt_idx"
  ON "client_telegram_link_tokens" ("usedAt");

-- 3) attendance_tickets
CREATE TABLE IF NOT EXISTS "attendance_tickets" (
  "id"          TEXT NOT NULL,
  "tenantId"    TEXT NOT NULL,
  "customerId"  TEXT NOT NULL,
  "courseRunId" TEXT NOT NULL,
  "tokenHash"   TEXT NOT NULL,
  "issuedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deliveredAt" TIMESTAMP(3),
  "revokedAt"   TIMESTAMP(3),
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,

  CONSTRAINT "attendance_tickets_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'attendance_tickets_tokenHash_key'
  ) THEN
    ALTER TABLE "attendance_tickets"
      ADD CONSTRAINT "attendance_tickets_tokenHash_key" UNIQUE ("tokenHash");
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'attendance_tickets_tenantId_customerId_courseRunId_key'
  ) THEN
    ALTER TABLE "attendance_tickets"
      ADD CONSTRAINT "attendance_tickets_tenantId_customerId_courseRunId_key"
      UNIQUE ("tenantId", "customerId", "courseRunId");
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'attendance_tickets_tenantId_fkey'
  ) THEN
    ALTER TABLE "attendance_tickets"
      ADD CONSTRAINT "attendance_tickets_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'attendance_tickets_customerId_fkey'
  ) THEN
    ALTER TABLE "attendance_tickets"
      ADD CONSTRAINT "attendance_tickets_customerId_fkey"
      FOREIGN KEY ("customerId") REFERENCES "customers"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'attendance_tickets_courseRunId_fkey'
  ) THEN
    ALTER TABLE "attendance_tickets"
      ADD CONSTRAINT "attendance_tickets_courseRunId_fkey"
      FOREIGN KEY ("courseRunId") REFERENCES "course_runs"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "attendance_tickets_tenantId_courseRunId_idx"
  ON "attendance_tickets" ("tenantId", "courseRunId");
CREATE INDEX IF NOT EXISTS "attendance_tickets_revokedAt_idx"
  ON "attendance_tickets" ("revokedAt");

-- 4) class_attendances.source doc note: no schema change needed — "source" is already
-- a plain TEXT column (added in 20260611120000_faceid_student_attendance). The new
-- value 'qr' is written by application code only.
