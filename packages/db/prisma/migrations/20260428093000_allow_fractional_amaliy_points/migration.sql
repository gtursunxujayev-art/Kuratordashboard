-- Allow fractional points (e.g. 0.5) for amaliy color mapping and log snapshots.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'exercise_definition_color_points'
      AND column_name = 'points'
  ) THEN
    ALTER TABLE "exercise_definition_color_points"
      ALTER COLUMN "points" TYPE DOUBLE PRECISION USING "points"::double precision;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'student_exercise_logs'
      AND column_name = 'points'
  ) THEN
    ALTER TABLE "student_exercise_logs"
      ALTER COLUMN "points" TYPE DOUBLE PRECISION USING "points"::double precision;
  END IF;
END $$;
