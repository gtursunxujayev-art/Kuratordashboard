-- Add per-course-run kurator link
ALTER TABLE "course_runs" ADD COLUMN "kuratorUserId" TEXT;

-- Index for filtering runs by attached kurator within a tenant
CREATE INDEX "course_runs_tenantId_kuratorUserId_idx" ON "course_runs"("tenantId", "kuratorUserId");

-- FK with SET NULL on user delete (kurator removed -> column nulled, run preserved)
ALTER TABLE "course_runs"
  ADD CONSTRAINT "course_runs_kuratorUserId_fkey"
  FOREIGN KEY ("kuratorUserId") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
