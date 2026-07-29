-- System-managed two-day runs for Intensive course tariffs and a persisted
-- provisional attendance status. These tables are shared with Dashboarduz.

ALTER TABLE "course_runs"
  ADD COLUMN IF NOT EXISTS "tariffId" TEXT,
  ADD COLUMN IF NOT EXISTS "isSystemManaged" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "class_attendances"
  ADD COLUMN IF NOT EXISTS "status" TEXT;

UPDATE "class_attendances"
SET "status" = CASE WHEN "attended" THEN 'keldi' ELSE 'kelmadi' END
WHERE "status" IS NULL;

ALTER TABLE "class_attendances"
  ALTER COLUMN "status" SET DEFAULT 'kelmadi',
  ALTER COLUMN "status" SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'course_runs_tariffId_fkey') THEN
    ALTER TABLE "course_runs"
      ADD CONSTRAINT "course_runs_tariffId_fkey"
      FOREIGN KEY ("tariffId") REFERENCES "tariffs"("id") ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "course_runs_tariffId_idx" ON "course_runs" ("tariffId");
CREATE INDEX IF NOT EXISTS "class_attendances_status_idx" ON "class_attendances" ("tenantId", "status", "lessonDate");
CREATE UNIQUE INDEX IF NOT EXISTS "course_runs_one_system_intensive_tariff"
  ON "course_runs" ("tenantId", "courseId", "tariffId")
  WHERE "isSystemManaged" = true AND "tariffId" IS NOT NULL;

CREATE OR REPLACE FUNCTION "kd_sync_system_intensive_runs"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO "course_runs" (
    "id", "tenantId", "courseId", "tariffId", "name", "startDate", "endDate",
    "durationWeeks", "baseLessons", "premiumExtraLessons", "isSystemManaged", "isHidden", "createdAt", "updatedAt"
  )
  SELECT
    md5('intensive-run:' || course_row."tenantId" || ':' || course_row."id" || ':' || tariff_row."id"),
    course_row."tenantId", course_row."id", tariff_row."id",
    tariff_row."name" || ' intensiv oqimi', course_row."startDate", course_row."startDate" + INTERVAL '1 day',
    1, 2, 0, true, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM "tariffs" tariff_row
  JOIN "courses" course_row ON course_row."id" = tariff_row."courseId" AND course_row."tenantId" = tariff_row."tenantId"
  WHERE course_row."category" ILIKE '%intens%'
    AND course_row."isActive" = true
    AND tariff_row."isActive" = true
    AND course_row."startDate" IS NOT NULL
  ON CONFLICT DO NOTHING;

  UPDATE "course_runs" system_run
  SET
    "name" = tariff_row."name" || ' intensiv oqimi',
    "startDate" = course_row."startDate",
    "endDate" = course_row."startDate" + INTERVAL '1 day',
    "durationWeeks" = 1,
    "baseLessons" = 2,
    "premiumExtraLessons" = 0,
    "updatedAt" = CURRENT_TIMESTAMP
  FROM "tariffs" tariff_row
  JOIN "courses" course_row ON course_row."id" = tariff_row."courseId" AND course_row."tenantId" = tariff_row."tenantId"
  WHERE system_run."tenantId" = course_row."tenantId"
    AND system_run."courseId" = course_row."id"
    AND system_run."tariffId" = tariff_row."id"
    AND system_run."isSystemManaged" = true
    AND course_row."category" ILIKE '%intens%'
    AND course_row."startDate" IS NOT NULL;

  INSERT INTO "course_run_members" ("id", "tenantId", "courseRunId", "customerId", "addedAt")
  SELECT md5('intensive-member:' || income_row."tenantId" || ':' || system_run."id" || ':' || income_row."customerId"),
    income_row."tenantId", system_run."id", income_row."customerId", CURRENT_TIMESTAMP
  FROM "incomes" income_row
  JOIN "course_runs" system_run
    ON system_run."tenantId" = income_row."tenantId"
   AND system_run."courseId" = income_row."courseId"
   AND system_run."tariffId" = income_row."tariffId"
   AND system_run."isSystemManaged" = true
  WHERE income_row."type" = 'new_sale'
    AND income_row."lifecycleStatus" = 'active'
  ON CONFLICT ("courseRunId", "customerId") DO NOTHING;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS "kd_sync_system_intensive_runs_from_tariffs" ON "tariffs";
CREATE TRIGGER "kd_sync_system_intensive_runs_from_tariffs"
AFTER INSERT OR UPDATE OF "name", "isActive", "courseId" ON "tariffs"
FOR EACH STATEMENT EXECUTE FUNCTION "kd_sync_system_intensive_runs"();

DROP TRIGGER IF EXISTS "kd_sync_system_intensive_runs_from_courses" ON "courses";
CREATE TRIGGER "kd_sync_system_intensive_runs_from_courses"
AFTER UPDATE OF "startDate", "category", "isActive" ON "courses"
FOR EACH STATEMENT EXECUTE FUNCTION "kd_sync_system_intensive_runs"();

-- Create and populate system-managed runs for Intensive tariffs that already
-- existed before this migration was deployed.
UPDATE "courses"
SET "startDate" = "startDate"
WHERE "category" ILIKE '%intens%' AND "startDate" IS NOT NULL;

CREATE OR REPLACE FUNCTION "kd_sync_course_run_members_after_income_change"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  old_sale_lost_course_eligibility BOOLEAN;
  old_sale_lost_tariff_eligibility BOOLEAN;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    old_sale_lost_course_eligibility :=
      OLD."type" = 'new_sale'
      AND OLD."lifecycleStatus" = 'active'
      AND OLD."courseId" IS NOT NULL
      AND (
        TG_OP = 'DELETE' OR NEW."type" <> 'new_sale' OR NEW."lifecycleStatus" <> 'active'
        OR NEW."courseId" IS DISTINCT FROM OLD."courseId"
        OR NEW."customerId" IS DISTINCT FROM OLD."customerId"
        OR NEW."tenantId" IS DISTINCT FROM OLD."tenantId"
      );

    IF old_sale_lost_course_eligibility AND NOT EXISTS (
      SELECT 1 FROM "incomes" remaining_income
      WHERE remaining_income."tenantId" = OLD."tenantId"
        AND remaining_income."customerId" = OLD."customerId"
        AND remaining_income."courseId" = OLD."courseId"
        AND remaining_income."type" = 'new_sale'
        AND remaining_income."lifecycleStatus" = 'active'
    ) THEN
      WITH removed_memberships AS (
        DELETE FROM "course_run_members" member
        USING "course_runs" run
        WHERE member."tenantId" = OLD."tenantId"
          AND member."customerId" = OLD."customerId"
          AND member."courseRunId" = run."id"
          AND run."tenantId" = OLD."tenantId"
          AND run."courseId" = OLD."courseId"
          AND run."endDate" >= (timezone('Asia/Tashkent', CURRENT_TIMESTAMP))::date
        RETURNING member."tenantId", member."customerId", member."courseRunId"
      )
      UPDATE "kurator_assignments" assignment
      SET "isActive" = false
      FROM removed_memberships removed
      WHERE assignment."tenantId" = removed."tenantId"
        AND assignment."customerId" = removed."customerId"
        AND assignment."courseRunId" = removed."courseRunId"
        AND assignment."isActive" = true;
    END IF;

    old_sale_lost_tariff_eligibility :=
      OLD."type" = 'new_sale'
      AND OLD."lifecycleStatus" = 'active'
      AND OLD."courseId" IS NOT NULL
      AND OLD."tariffId" IS NOT NULL
      AND (
        TG_OP = 'DELETE' OR NEW."type" <> 'new_sale' OR NEW."lifecycleStatus" <> 'active'
        OR NEW."courseId" IS DISTINCT FROM OLD."courseId"
        OR NEW."tariffId" IS DISTINCT FROM OLD."tariffId"
        OR NEW."customerId" IS DISTINCT FROM OLD."customerId"
        OR NEW."tenantId" IS DISTINCT FROM OLD."tenantId"
      );

    IF old_sale_lost_tariff_eligibility AND NOT EXISTS (
      SELECT 1 FROM "incomes" remaining_income
      WHERE remaining_income."tenantId" = OLD."tenantId"
        AND remaining_income."customerId" = OLD."customerId"
        AND remaining_income."courseId" = OLD."courseId"
        AND remaining_income."tariffId" = OLD."tariffId"
        AND remaining_income."type" = 'new_sale'
        AND remaining_income."lifecycleStatus" = 'active'
    ) THEN
      DELETE FROM "course_run_members" member
      USING "course_runs" run
      WHERE member."tenantId" = OLD."tenantId"
        AND member."customerId" = OLD."customerId"
        AND member."courseRunId" = run."id"
        AND run."tenantId" = OLD."tenantId"
        AND run."courseId" = OLD."courseId"
        AND run."tariffId" = OLD."tariffId"
        AND run."isSystemManaged" = true;
    END IF;
  END IF;

  IF TG_OP <> 'DELETE'
    AND NEW."type" = 'new_sale'
    AND NEW."lifecycleStatus" = 'active'
    AND NEW."courseId" IS NOT NULL
    AND NEW."tariffId" IS NOT NULL THEN
    INSERT INTO "course_run_members" ("id", "tenantId", "courseRunId", "customerId", "addedAt")
    SELECT md5('intensive-member:' || NEW."tenantId" || ':' || system_run."id" || ':' || NEW."customerId"),
      NEW."tenantId", system_run."id", NEW."customerId", CURRENT_TIMESTAMP
    FROM "course_runs" system_run
    WHERE system_run."tenantId" = NEW."tenantId"
      AND system_run."courseId" = NEW."courseId"
      AND system_run."tariffId" = NEW."tariffId"
      AND system_run."isSystemManaged" = true
    ON CONFLICT ("courseRunId", "customerId") DO NOTHING;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "kd_sync_course_run_members_after_income_change" ON "incomes";
CREATE TRIGGER "kd_sync_course_run_members_after_income_change"
AFTER INSERT OR UPDATE OF "tenantId", "customerId", "type", "lifecycleStatus", "courseId", "tariffId" OR DELETE
ON "incomes"
FOR EACH ROW EXECUTE FUNCTION "kd_sync_course_run_members_after_income_change"();
