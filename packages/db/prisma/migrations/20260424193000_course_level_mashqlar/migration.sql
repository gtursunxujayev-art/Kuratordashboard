-- Move mashq ownership from course run to course level.
-- Add per-mashq per-color points mapping.

ALTER TABLE "exercise_definitions"
  ADD COLUMN IF NOT EXISTS "courseId" TEXT;

-- courseRunId becomes legacy metadata only.
ALTER TABLE "exercise_definitions"
  ALTER COLUMN "courseRunId" DROP NOT NULL;

UPDATE "exercise_definitions" ed
SET "courseId" = cr."courseId"
FROM "course_runs" cr
WHERE ed."courseRunId" = cr."id"
  AND ed."courseId" IS NULL;

-- Canonicalize duplicate run-level definitions into one course-level definition
-- by tenant + course + normalized name + type.
WITH ranked AS (
  SELECT
    d."id",
    d."tenantId",
    d."courseId",
    lower(trim(d."name")) AS norm_name,
    d."type",
    ROW_NUMBER() OVER (
      PARTITION BY d."tenantId", d."courseId", lower(trim(d."name")), d."type"
      ORDER BY d."isActive" DESC, d."targetCount" DESC, d."orderIndex" ASC, d."createdAt" ASC, d."id" ASC
    ) AS rn
  FROM "exercise_definitions" d
  WHERE d."courseId" IS NOT NULL
),
canonical AS (
  SELECT
    r."id" AS canonical_id,
    r."tenantId",
    r."courseId",
    r.norm_name,
    r."type"
  FROM ranked r
  WHERE r.rn = 1
),
aggregated AS (
  SELECT
    d."tenantId",
    d."courseId",
    lower(trim(d."name")) AS norm_name,
    d."type",
    MAX(d."targetCount") AS max_target_count,
    MIN(d."orderIndex") AS min_order_index,
    BOOL_OR(d."isActive") AS any_active
  FROM "exercise_definitions" d
  WHERE d."courseId" IS NOT NULL
  GROUP BY d."tenantId", d."courseId", lower(trim(d."name")), d."type"
)
UPDATE "exercise_definitions" d
SET
  "targetCount" = a.max_target_count,
  "orderIndex" = a.min_order_index,
  "isActive" = a.any_active
FROM canonical c
JOIN aggregated a
  ON a."tenantId" = c."tenantId"
 AND a."courseId" = c."courseId"
 AND a.norm_name = c.norm_name
 AND a."type" = c."type"
WHERE d."id" = c.canonical_id;

WITH ranked AS (
  SELECT
    d."id",
    d."tenantId",
    d."courseId",
    lower(trim(d."name")) AS norm_name,
    d."type",
    ROW_NUMBER() OVER (
      PARTITION BY d."tenantId", d."courseId", lower(trim(d."name")), d."type"
      ORDER BY d."isActive" DESC, d."targetCount" DESC, d."orderIndex" ASC, d."createdAt" ASC, d."id" ASC
    ) AS rn
  FROM "exercise_definitions" d
  WHERE d."courseId" IS NOT NULL
),
canonical AS (
  SELECT
    r."id" AS canonical_id,
    r."tenantId",
    r."courseId",
    r.norm_name,
    r."type"
  FROM ranked r
  WHERE r.rn = 1
),
mapping AS (
  SELECT
    d."id" AS source_id,
    c.canonical_id
  FROM "exercise_definitions" d
  JOIN canonical c
    ON c."tenantId" = d."tenantId"
   AND c."courseId" = d."courseId"
   AND c.norm_name = lower(trim(d."name"))
   AND c."type" = d."type"
)
UPDATE "student_exercise_logs" l
SET "exerciseDefinitionId" = m.canonical_id
FROM mapping m
WHERE l."exerciseDefinitionId" = m.source_id
  AND m.source_id <> m.canonical_id;

WITH ranked AS (
  SELECT
    d."id",
    d."tenantId",
    d."courseId",
    lower(trim(d."name")) AS norm_name,
    d."type",
    ROW_NUMBER() OVER (
      PARTITION BY d."tenantId", d."courseId", lower(trim(d."name")), d."type"
      ORDER BY d."isActive" DESC, d."targetCount" DESC, d."orderIndex" ASC, d."createdAt" ASC, d."id" ASC
    ) AS rn
  FROM "exercise_definitions" d
  WHERE d."courseId" IS NOT NULL
),
canonical AS (
  SELECT
    r."id" AS canonical_id,
    r."tenantId",
    r."courseId",
    r.norm_name,
    r."type"
  FROM ranked r
  WHERE r.rn = 1
),
mapping AS (
  SELECT
    d."id" AS source_id,
    c.canonical_id
  FROM "exercise_definitions" d
  JOIN canonical c
    ON c."tenantId" = d."tenantId"
   AND c."courseId" = d."courseId"
   AND c.norm_name = lower(trim(d."name"))
   AND c."type" = d."type"
)
DELETE FROM "exercise_definitions" d
USING mapping m
WHERE d."id" = m.source_id
  AND m.source_id <> m.canonical_id;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "exercise_definitions" WHERE "courseId" IS NULL) THEN
    RAISE EXCEPTION 'exercise_definitions.courseId backfill failed for some rows';
  END IF;
END $$;

ALTER TABLE "exercise_definitions"
  ALTER COLUMN "courseId" SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'exercise_definitions_courseId_fkey') THEN
    ALTER TABLE "exercise_definitions"
      ADD CONSTRAINT "exercise_definitions_courseId_fkey"
      FOREIGN KEY ("courseId") REFERENCES "courses" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "exercise_definitions_courseId_idx"
  ON "exercise_definitions" ("courseId");

CREATE TABLE IF NOT EXISTS "exercise_definition_color_points" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "exerciseDefinitionId" TEXT NOT NULL,
  "colorOptionId" TEXT NOT NULL,
  "points" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "exercise_definition_color_points_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'exercise_definition_color_points_tenantId_fkey') THEN
    ALTER TABLE "exercise_definition_color_points"
      ADD CONSTRAINT "exercise_definition_color_points_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "tenants" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'exercise_definition_color_points_exerciseDefinitionId_fkey') THEN
    ALTER TABLE "exercise_definition_color_points"
      ADD CONSTRAINT "exercise_definition_color_points_exerciseDefinitionId_fkey"
      FOREIGN KEY ("exerciseDefinitionId") REFERENCES "exercise_definitions" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'exercise_definition_color_points_colorOptionId_fkey') THEN
    ALTER TABLE "exercise_definition_color_points"
      ADD CONSTRAINT "exercise_definition_color_points_colorOptionId_fkey"
      FOREIGN KEY ("colorOptionId") REFERENCES "exercise_color_options" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "exercise_definition_color_points_exerciseDefinitionId_colorOptionId_key"
  ON "exercise_definition_color_points" ("exerciseDefinitionId", "colorOptionId");

CREATE INDEX IF NOT EXISTS "exercise_definition_color_points_tenantId_idx"
  ON "exercise_definition_color_points" ("tenantId");

CREATE INDEX IF NOT EXISTS "exercise_definition_color_points_exerciseDefinitionId_idx"
  ON "exercise_definition_color_points" ("exerciseDefinitionId");

CREATE INDEX IF NOT EXISTS "exercise_definition_color_points_colorOptionId_idx"
  ON "exercise_definition_color_points" ("colorOptionId");

-- Seed mapping table from legacy global color points.
INSERT INTO "exercise_definition_color_points" (
  "id",
  "tenantId",
  "exerciseDefinitionId",
  "colorOptionId",
  "points",
  "createdAt",
  "updatedAt"
)
SELECT
  md5(ed."id" || ':' || eco."id") AS "id",
  ed."tenantId",
  ed."id" AS "exerciseDefinitionId",
  eco."id" AS "colorOptionId",
  eco."points",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "exercise_definitions" ed
JOIN "exercise_color_options" eco
  ON eco."tenantId" = ed."tenantId"
LEFT JOIN "exercise_definition_color_points" p
  ON p."exerciseDefinitionId" = ed."id"
 AND p."colorOptionId" = eco."id"
WHERE p."id" IS NULL;
