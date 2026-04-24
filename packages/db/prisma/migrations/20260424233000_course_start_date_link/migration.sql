ALTER TABLE "courses"
  ADD COLUMN IF NOT EXISTS "startDate" TIMESTAMP(3);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'course_runs'
  ) THEN
    UPDATE "courses" AS c
    SET "startDate" = src.min_start
    FROM (
      SELECT "courseId", MIN("startDate") AS min_start
      FROM "course_runs"
      GROUP BY "courseId"
    ) AS src
    WHERE c."id" = src."courseId"
      AND c."startDate" IS NULL;
  END IF;
END $$;

UPDATE "courses"
SET "startDate" = "createdAt"
WHERE "startDate" IS NULL;

ALTER TABLE "courses"
  ALTER COLUMN "startDate" SET DEFAULT CURRENT_TIMESTAMP;
