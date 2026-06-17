ALTER TABLE "course_runs"
  ADD COLUMN IF NOT EXISTS "isHidden" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "exercise_definitions"
  ADD COLUMN IF NOT EXISTS "startDate" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "isHidden" BOOLEAN NOT NULL DEFAULT false;

UPDATE "exercise_definitions" AS ed
SET "startDate" = c."startDate"
FROM "courses" AS c
WHERE ed."courseId" = c."id"
  AND ed."tenantId" = c."tenantId"
  AND ed."startDate" IS NULL
  AND c."startDate" IS NOT NULL;
