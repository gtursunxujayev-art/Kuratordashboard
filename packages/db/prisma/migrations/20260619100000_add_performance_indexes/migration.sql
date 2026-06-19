CREATE INDEX IF NOT EXISTS "incomes_tenant_course_active_customer_idx"
  ON "incomes" ("tenantId", "courseId", "type", "lifecycleStatus", "customerId");

CREATE INDEX IF NOT EXISTS "incomes_tenant_customer_active_entry_idx"
  ON "incomes" ("tenantId", "customerId", "type", "lifecycleStatus", "entryDate");

CREATE INDEX IF NOT EXISTS "course_runs_tenant_course_visible_dates_idx"
  ON "course_runs" ("tenantId", "courseId", "isHidden", "startDate", "endDate");

CREATE INDEX IF NOT EXISTS "student_exercise_logs_tenant_customer_completed_idx"
  ON "student_exercise_logs" ("tenantId", "customerId", "completedAt");

CREATE INDEX IF NOT EXISTS "class_attendances_tenant_customer_run_date_idx"
  ON "class_attendances" ("tenantId", "customerId", "courseRunId", "lessonDate");

CREATE INDEX IF NOT EXISTS "kurator_tasks_tenant_customer_completed_idx"
  ON "kurator_tasks" ("tenantId", "customerId", "completedAt");

CREATE INDEX IF NOT EXISTS "kurator_tasks_tenant_customer_created_idx"
  ON "kurator_tasks" ("tenantId", "customerId", "createdAt");
