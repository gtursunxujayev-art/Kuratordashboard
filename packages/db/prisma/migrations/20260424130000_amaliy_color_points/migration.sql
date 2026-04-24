-- Amaliy color options and points snapshot support
-- Backward compatible: all new log columns are nullable.

CREATE TABLE IF NOT EXISTS "exercise_color_options" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "colorHex" TEXT NOT NULL,
  "points" INTEGER NOT NULL,
  "orderIndex" INTEGER NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "exercise_color_options_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'exercise_color_options_tenantId_fkey') THEN
    ALTER TABLE "exercise_color_options"
      ADD CONSTRAINT "exercise_color_options_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "tenants" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TABLE "student_exercise_logs"
  ADD COLUMN IF NOT EXISTS "colorOptionId" TEXT,
  ADD COLUMN IF NOT EXISTS "colorHex" TEXT,
  ADD COLUMN IF NOT EXISTS "points" INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'student_exercise_logs_colorOptionId_fkey') THEN
    ALTER TABLE "student_exercise_logs"
      ADD CONSTRAINT "student_exercise_logs_colorOptionId_fkey"
      FOREIGN KEY ("colorOptionId") REFERENCES "exercise_color_options" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "exercise_color_options_tenantId_idx"
  ON "exercise_color_options" ("tenantId");

CREATE INDEX IF NOT EXISTS "exercise_color_options_tenantId_isActive_orderIndex_idx"
  ON "exercise_color_options" ("tenantId", "isActive", "orderIndex");

CREATE INDEX IF NOT EXISTS "student_exercise_logs_colorOptionId_idx"
  ON "student_exercise_logs" ("colorOptionId");

CREATE INDEX IF NOT EXISTS "student_exercise_logs_tenantId_exerciseDefinitionId_completedAt_idx"
  ON "student_exercise_logs" ("tenantId", "exerciseDefinitionId", "completedAt");
