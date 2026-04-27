-- Explicit hand-picked roster for a course-run mini-group.
-- When non-empty, this is the source of truth for "who is in this run".
-- When empty, callers fall back to "all customers with active new_sale income on the run's course".
CREATE TABLE "course_run_members" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "courseRunId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "course_run_members_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "course_run_members_courseRunId_customerId_key" ON "course_run_members"("courseRunId", "customerId");
CREATE INDEX "course_run_members_tenantId_courseRunId_idx" ON "course_run_members"("tenantId", "courseRunId");
CREATE INDEX "course_run_members_tenantId_customerId_idx" ON "course_run_members"("tenantId", "customerId");

ALTER TABLE "course_run_members"
    ADD CONSTRAINT "course_run_members_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "course_run_members"
    ADD CONSTRAINT "course_run_members_courseRunId_fkey"
    FOREIGN KEY ("courseRunId") REFERENCES "course_runs"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "course_run_members"
    ADD CONSTRAINT "course_run_members_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "customers"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
