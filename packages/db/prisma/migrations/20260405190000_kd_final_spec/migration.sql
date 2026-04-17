-- KD final spec migration (camelCase column version)
-- Safe for environments where KD tables do not yet exist.

CREATE TABLE IF NOT EXISTS "course_runs" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "courseId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "startDate" TIMESTAMP(3) NOT NULL,
  "endDate" TIMESTAMP(3) NOT NULL,
  "durationWeeks" INTEGER NOT NULL DEFAULT 6,
  "baseLessons" INTEGER NOT NULL DEFAULT 12,
  "premiumExtraLessons" INTEGER NOT NULL DEFAULT 2,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "course_runs_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "course_runs"
  ADD COLUMN IF NOT EXISTS "durationWeeks" INTEGER NOT NULL DEFAULT 6,
  ADD COLUMN IF NOT EXISTS "premiumExtraLessons" INTEGER NOT NULL DEFAULT 2;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'course_runs_tenantId_fkey') THEN
    ALTER TABLE "course_runs"
      ADD CONSTRAINT "course_runs_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "tenants" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'course_runs_courseId_fkey') THEN
    ALTER TABLE "course_runs"
      ADD CONSTRAINT "course_runs_courseId_fkey"
      FOREIGN KEY ("courseId") REFERENCES "courses" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "exercise_definitions" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "courseRunId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "targetCount" INTEGER NOT NULL DEFAULT 1,
  "orderIndex" INTEGER NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "exercise_definitions_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'exercise_definitions_tenantId_fkey') THEN
    ALTER TABLE "exercise_definitions"
      ADD CONSTRAINT "exercise_definitions_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "tenants" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'exercise_definitions_courseRunId_fkey') THEN
    ALTER TABLE "exercise_definitions"
      ADD CONSTRAINT "exercise_definitions_courseRunId_fkey"
      FOREIGN KEY ("courseRunId") REFERENCES "course_runs" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "student_exercise_logs" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "exerciseDefinitionId" TEXT NOT NULL,
  "completedAt" TIMESTAMP(3) NOT NULL,
  "loggedByUserId" TEXT NOT NULL,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "student_exercise_logs_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'student_exercise_logs_tenantId_fkey') THEN
    ALTER TABLE "student_exercise_logs"
      ADD CONSTRAINT "student_exercise_logs_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "tenants" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'student_exercise_logs_customerId_fkey') THEN
    ALTER TABLE "student_exercise_logs"
      ADD CONSTRAINT "student_exercise_logs_customerId_fkey"
      FOREIGN KEY ("customerId") REFERENCES "customers" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'student_exercise_logs_exerciseDefinitionId_fkey') THEN
    ALTER TABLE "student_exercise_logs"
      ADD CONSTRAINT "student_exercise_logs_exerciseDefinitionId_fkey"
      FOREIGN KEY ("exerciseDefinitionId") REFERENCES "exercise_definitions" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'student_exercise_logs_loggedByUserId_fkey') THEN
    ALTER TABLE "student_exercise_logs"
      ADD CONSTRAINT "student_exercise_logs_loggedByUserId_fkey"
      FOREIGN KEY ("loggedByUserId") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "class_attendances" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "courseRunId" TEXT NOT NULL,
  "lessonDate" TIMESTAMP(3) NOT NULL,
  "lessonType" TEXT NOT NULL DEFAULT 'base',
  "attended" BOOLEAN NOT NULL DEFAULT false,
  "markedByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "class_attendances_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "class_attendances"
  ADD COLUMN IF NOT EXISTS "lessonType" TEXT NOT NULL DEFAULT 'base';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'class_attendances_tenantId_fkey') THEN
    ALTER TABLE "class_attendances"
      ADD CONSTRAINT "class_attendances_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "tenants" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'class_attendances_customerId_fkey') THEN
    ALTER TABLE "class_attendances"
      ADD CONSTRAINT "class_attendances_customerId_fkey"
      FOREIGN KEY ("customerId") REFERENCES "customers" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'class_attendances_courseRunId_fkey') THEN
    ALTER TABLE "class_attendances"
      ADD CONSTRAINT "class_attendances_courseRunId_fkey"
      FOREIGN KEY ("courseRunId") REFERENCES "course_runs" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'class_attendances_markedByUserId_fkey') THEN
    ALTER TABLE "class_attendances"
      ADD CONSTRAINT "class_attendances_markedByUserId_fkey"
      FOREIGN KEY ("markedByUserId") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- Replace old uniqueness to allow base and premium rows on same date.
ALTER TABLE "class_attendances"
  DROP CONSTRAINT IF EXISTS "class_attendances_tenant_id_customer_id_course_run_id_lesson_date_key";
ALTER TABLE "class_attendances"
  DROP CONSTRAINT IF EXISTS "class_attendances_tenantId_customerId_courseRunId_lessonDate_key";

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'class_attendances_tenantId_customerId_courseRunId_lessonDate_lessonType_key'
  ) THEN
    ALTER TABLE "class_attendances"
      ADD CONSTRAINT "class_attendances_tenantId_customerId_courseRunId_lessonDate_lessonType_key"
      UNIQUE ("tenantId", "customerId", "courseRunId", "lessonDate", "lessonType");
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "kurator_assignments" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "kuratorUserId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "courseRunId" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "kurator_assignments_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'kurator_assignments_tenantId_fkey') THEN
    ALTER TABLE "kurator_assignments"
      ADD CONSTRAINT "kurator_assignments_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "tenants" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'kurator_assignments_kuratorUserId_fkey') THEN
    ALTER TABLE "kurator_assignments"
      ADD CONSTRAINT "kurator_assignments_kuratorUserId_fkey"
      FOREIGN KEY ("kuratorUserId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'kurator_assignments_customerId_fkey') THEN
    ALTER TABLE "kurator_assignments"
      ADD CONSTRAINT "kurator_assignments_customerId_fkey"
      FOREIGN KEY ("customerId") REFERENCES "customers" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'kurator_assignments_courseRunId_fkey') THEN
    ALTER TABLE "kurator_assignments"
      ADD CONSTRAINT "kurator_assignments_courseRunId_fkey"
      FOREIGN KEY ("courseRunId") REFERENCES "course_runs" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "kurator_assignments_tenantId_kuratorUserId_customerId_courseRunId_key"
  ON "kurator_assignments" ("tenantId", "kuratorUserId", "customerId", "courseRunId");

CREATE TABLE IF NOT EXISTS "kurator_tasks" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "kuratorUserId" TEXT NOT NULL,
  "customerId" TEXT,
  "title" TEXT NOT NULL,
  "dueDate" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "kurator_tasks_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'kurator_tasks_tenantId_fkey') THEN
    ALTER TABLE "kurator_tasks"
      ADD CONSTRAINT "kurator_tasks_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "tenants" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'kurator_tasks_kuratorUserId_fkey') THEN
    ALTER TABLE "kurator_tasks"
      ADD CONSTRAINT "kurator_tasks_kuratorUserId_fkey"
      FOREIGN KEY ("kuratorUserId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'kurator_tasks_customerId_fkey') THEN
    ALTER TABLE "kurator_tasks"
      ADD CONSTRAINT "kurator_tasks_customerId_fkey"
      FOREIGN KEY ("customerId") REFERENCES "customers" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "region_configs" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "region_configs_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'region_configs_tenantId_fkey') THEN
    ALTER TABLE "region_configs"
      ADD CONSTRAINT "region_configs_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "tenants" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "region_configs_tenantId_name_key"
  ON "region_configs" ("tenantId", "name");

CREATE TABLE IF NOT EXISTS "course_schedule_templates" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "courseCategory" TEXT NOT NULL,
  "durationWeeks" INTEGER NOT NULL DEFAULT 6,
  "baseLessons" INTEGER NOT NULL DEFAULT 12,
  "premiumExtraLessons" INTEGER NOT NULL DEFAULT 2,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "course_schedule_templates_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'course_schedule_templates_tenantId_fkey') THEN
    ALTER TABLE "course_schedule_templates"
      ADD CONSTRAINT "course_schedule_templates_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "tenants" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "course_schedule_templates_tenantId_courseCategory_key"
  ON "course_schedule_templates" ("tenantId", "courseCategory");

CREATE INDEX IF NOT EXISTS "course_schedule_templates_tenantId_idx"
  ON "course_schedule_templates" ("tenantId");

CREATE INDEX IF NOT EXISTS "incomes_tenantId_type_lifecycleStatus_entryDate_idx"
  ON "incomes" ("tenantId", "type", "lifecycleStatus", "entryDate");

CREATE INDEX IF NOT EXISTS "student_exercise_logs_tenantId_customerId_exerciseDefinitionId_idx"
  ON "student_exercise_logs" ("tenantId", "customerId", "exerciseDefinitionId");

CREATE INDEX IF NOT EXISTS "class_attendances_tenantId_courseRunId_customerId_attended_idx"
  ON "class_attendances" ("tenantId", "courseRunId", "customerId", "attended");

CREATE INDEX IF NOT EXISTS "class_attendances_tenantId_courseRunId_lessonDate_lessonType_idx"
  ON "class_attendances" ("tenantId", "courseRunId", "lessonDate", "lessonType");

CREATE INDEX IF NOT EXISTS "kurator_assignments_tenantId_courseRunId_isActive_idx"
  ON "kurator_assignments" ("tenantId", "courseRunId", "isActive");

CREATE INDEX IF NOT EXISTS "kurator_assignments_tenantId_kuratorUserId_isActive_idx"
  ON "kurator_assignments" ("tenantId", "kuratorUserId", "isActive");
