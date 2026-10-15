-- Optional per-student, per-lesson-day note ("izoh") written in Davomat.
-- Separate from class_attendances, whose rows are deleted/recreated on every save.
-- All statements are idempotent so re-running is safe.

CREATE TABLE IF NOT EXISTS "attendance_notes" (
  "id"              TEXT NOT NULL,
  "tenantId"        TEXT NOT NULL,
  "customerId"      TEXT NOT NULL,
  "courseRunId"     TEXT NOT NULL,
  "lessonDate"      TIMESTAMP(3) NOT NULL,
  "note"            TEXT NOT NULL,
  "updatedByUserId" TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,

  CONSTRAINT "attendance_notes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "attendance_notes_tenantId_customerId_courseRunId_lessonDate_key"
  ON "attendance_notes" ("tenantId", "customerId", "courseRunId", "lessonDate");

CREATE INDEX IF NOT EXISTS "attendance_notes_tenantId_courseRunId_lessonDate_idx"
  ON "attendance_notes" ("tenantId", "courseRunId", "lessonDate");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attendance_notes_tenantId_fkey') THEN
    ALTER TABLE "attendance_notes"
      ADD CONSTRAINT "attendance_notes_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attendance_notes_customerId_fkey') THEN
    ALTER TABLE "attendance_notes"
      ADD CONSTRAINT "attendance_notes_customerId_fkey"
      FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attendance_notes_courseRunId_fkey') THEN
    ALTER TABLE "attendance_notes"
      ADD CONSTRAINT "attendance_notes_courseRunId_fkey"
      FOREIGN KEY ("courseRunId") REFERENCES "course_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
