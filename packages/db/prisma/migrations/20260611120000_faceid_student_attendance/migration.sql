-- Face ID student attendance support.
-- NOTE: this DB uses camelCase column names (e.g. "markedByUserId"), only table names are snake_case.
-- 1) class_attendances: add "source", make "markedByUserId" nullable, relax FK to SET NULL.
-- 2) customers: add "faceIdExternalId" (+ index) for robust Face ID device mapping.
-- All statements are idempotent so re-running is safe.

-- 1a) source column (default 'manual' keeps existing rows backward-compatible)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'class_attendances'
      AND column_name = 'source'
  ) THEN
    ALTER TABLE "class_attendances"
      ADD COLUMN "source" TEXT NOT NULL DEFAULT 'manual';
  END IF;
END $$;

-- 1b) make "markedByUserId" nullable
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'class_attendances'
      AND column_name = 'markedByUserId'
      AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE "class_attendances"
      ALTER COLUMN "markedByUserId" DROP NOT NULL;
  END IF;
END $$;

-- 1c) recreate FK with ON DELETE SET NULL (was ON DELETE RESTRICT)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'class_attendances_markedByUserId_fkey'
  ) THEN
    ALTER TABLE "class_attendances"
      DROP CONSTRAINT "class_attendances_markedByUserId_fkey";
  END IF;

  ALTER TABLE "class_attendances"
    ADD CONSTRAINT "class_attendances_markedByUserId_fkey"
    FOREIGN KEY ("markedByUserId") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
END $$;

-- 2a) customers."faceIdExternalId"
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'customers'
      AND column_name = 'faceIdExternalId'
  ) THEN
    ALTER TABLE "customers"
      ADD COLUMN "faceIdExternalId" TEXT;
  END IF;
END $$;

-- 2b) index for fast Face ID lookups
CREATE INDEX IF NOT EXISTS "customers_tenantId_faceIdExternalId_idx"
  ON "customers" ("tenantId", "faceIdExternalId");
