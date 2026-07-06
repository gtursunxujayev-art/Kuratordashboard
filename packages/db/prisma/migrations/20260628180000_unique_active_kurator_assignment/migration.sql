-- Apply after running `npm run reconcile:runs --workspace @kuratordashboard/api -- --apply`.
-- Inactive history remains available; only the active cache row is unique per student/run.
CREATE UNIQUE INDEX IF NOT EXISTS "kurator_assignments_one_active_per_student_run"
ON "kurator_assignments" ("tenantId", "customerId", "courseRunId")
WHERE "isActive" = true;
