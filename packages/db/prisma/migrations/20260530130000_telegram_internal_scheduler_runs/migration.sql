CREATE TABLE IF NOT EXISTS "telegram_schedule_runs" (
  "id" TEXT NOT NULL,
  "jobKey" TEXT NOT NULL,
  "slotTime" TIMESTAMP(3) NOT NULL,
  "status" TEXT NOT NULL,
  "error" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "telegram_schedule_runs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "telegram_schedule_runs_jobKey_slotTime_key"
  ON "telegram_schedule_runs" ("jobKey", "slotTime");

CREATE INDEX IF NOT EXISTS "telegram_schedule_runs_slotTime_idx"
  ON "telegram_schedule_runs" ("slotTime");

CREATE INDEX IF NOT EXISTS "telegram_schedule_runs_status_idx"
  ON "telegram_schedule_runs" ("status");
