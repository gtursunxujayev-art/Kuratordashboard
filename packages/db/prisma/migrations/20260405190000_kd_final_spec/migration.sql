-- KD final spec migration: schedule templates, offline run fields, premium lesson attendance

ALTER TABLE "course_runs"
  ADD COLUMN IF NOT EXISTS "duration_weeks" INTEGER NOT NULL DEFAULT 6,
  ADD COLUMN IF NOT EXISTS "premium_extra_lessons" INTEGER NOT NULL DEFAULT 2;

ALTER TABLE "class_attendances"
  ADD COLUMN IF NOT EXISTS "lesson_type" TEXT NOT NULL DEFAULT 'base';

-- Replace old uniqueness to allow base and premium rows on the same date.
ALTER TABLE "class_attendances"
  DROP CONSTRAINT IF EXISTS "class_attendances_tenant_id_customer_id_course_run_id_lesson_date_key";

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'class_attendances_tenant_id_customer_id_course_run_id_lesson_type_key'
  ) THEN
    ALTER TABLE "class_attendances"
      ADD CONSTRAINT "class_attendances_tenant_id_customer_id_course_run_id_lesson_type_key"
      UNIQUE ("tenant_id", "customer_id", "course_run_id", "lesson_date", "lesson_type");
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "class_attendances_tenant_id_course_run_id_customer_id_attended_idx"
  ON "class_attendances" ("tenant_id", "course_run_id", "customer_id", "attended");

CREATE INDEX IF NOT EXISTS "class_attendances_tenant_id_course_run_id_lesson_date_lesson_type_idx"
  ON "class_attendances" ("tenant_id", "course_run_id", "lesson_date", "lesson_type");

CREATE TABLE IF NOT EXISTS "course_schedule_templates" (
  "id" TEXT PRIMARY KEY,
  "tenant_id" TEXT NOT NULL,
  "course_category" TEXT NOT NULL,
  "duration_weeks" INTEGER NOT NULL DEFAULT 6,
  "base_lessons" INTEGER NOT NULL DEFAULT 12,
  "premium_extra_lessons" INTEGER NOT NULL DEFAULT 2,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "course_schedule_templates_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "course_schedule_templates_tenant_id_course_category_key"
  ON "course_schedule_templates" ("tenant_id", "course_category");

CREATE INDEX IF NOT EXISTS "course_schedule_templates_tenant_id_idx"
  ON "course_schedule_templates" ("tenant_id");

CREATE INDEX IF NOT EXISTS "incomes_tenant_id_type_lifecycle_status_entry_date_idx"
  ON "incomes" ("tenant_id", "type", "lifecycle_status", "entry_date");

CREATE INDEX IF NOT EXISTS "student_exercise_logs_tenant_id_customer_id_exercise_definition_id_idx"
  ON "student_exercise_logs" ("tenant_id", "customer_id", "exercise_definition_id");

CREATE INDEX IF NOT EXISTS "kurator_assignments_tenant_id_course_run_id_is_active_idx"
  ON "kurator_assignments" ("tenant_id", "course_run_id", "is_active");

CREATE INDEX IF NOT EXISTS "kurator_assignments_tenant_id_kurator_user_id_is_active_idx"
  ON "kurator_assignments" ("tenant_id", "kurator_user_id", "is_active");
