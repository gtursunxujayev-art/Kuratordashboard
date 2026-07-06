-- Keep current/future course-run rosters aligned with active new-sale rows in the
-- shared database. Inserts intentionally do not assign a run: run membership
-- remains an explicit administrator decision.
CREATE OR REPLACE FUNCTION "kd_cleanup_course_run_members_after_income_change"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  old_sale_lost_eligibility BOOLEAN;
BEGIN
  IF TG_OP = 'INSERT' THEN
    RETURN NEW;
  END IF;

  old_sale_lost_eligibility :=
    OLD."type" = 'new_sale'
    AND OLD."lifecycleStatus" = 'active'
    AND OLD."courseId" IS NOT NULL
    AND (
      TG_OP = 'DELETE'
      OR NEW."type" <> 'new_sale'
      OR NEW."lifecycleStatus" <> 'active'
      OR NEW."courseId" IS DISTINCT FROM OLD."courseId"
      OR NEW."customerId" IS DISTINCT FROM OLD."customerId"
      OR NEW."tenantId" IS DISTINCT FROM OLD."tenantId"
    );

  IF old_sale_lost_eligibility AND NOT EXISTS (
    SELECT 1
    FROM "incomes" AS remaining_income
    WHERE remaining_income."tenantId" = OLD."tenantId"
      AND remaining_income."customerId" = OLD."customerId"
      AND remaining_income."courseId" = OLD."courseId"
      AND remaining_income."type" = 'new_sale'
      AND remaining_income."lifecycleStatus" = 'active'
  ) THEN
    WITH removed_memberships AS (
      DELETE FROM "course_run_members" AS member
      USING "course_runs" AS run
      WHERE member."tenantId" = OLD."tenantId"
        AND member."customerId" = OLD."customerId"
        AND member."courseRunId" = run."id"
        AND run."tenantId" = OLD."tenantId"
        AND run."courseId" = OLD."courseId"
        AND run."endDate" >= (timezone('Asia/Tashkent', CURRENT_TIMESTAMP))::date
      RETURNING member."tenantId", member."customerId", member."courseRunId"
    )
    UPDATE "kurator_assignments" AS assignment
    SET "isActive" = false
    FROM removed_memberships AS removed
    WHERE assignment."tenantId" = removed."tenantId"
      AND assignment."customerId" = removed."customerId"
      AND assignment."courseRunId" = removed."courseRunId"
      AND assignment."isActive" = true;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "kd_sync_course_run_members_after_income_change" ON "incomes";
CREATE TRIGGER "kd_sync_course_run_members_after_income_change"
AFTER INSERT OR UPDATE OF "tenantId", "customerId", "type", "lifecycleStatus", "courseId" OR DELETE
ON "incomes"
FOR EACH ROW
EXECUTE FUNCTION "kd_cleanup_course_run_members_after_income_change"();
