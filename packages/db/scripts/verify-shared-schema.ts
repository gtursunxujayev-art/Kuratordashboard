import { Prisma, PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

type ColumnRow = {
  table_name: string;
  column_name: string;
};

type NameRow = {
  name: string;
};

type FailedMigrationRow = {
  migration_name: string;
  logs: string | null;
};

const requiredTriggers = [
  'kd_sync_course_run_members_after_income_change',
  'kd_sync_system_intensive_runs_from_courses',
  'kd_sync_system_intensive_runs_from_tariffs',
] as const;

const requiredIndexes = [
  'course_runs_one_system_intensive_tariff',
  'kurator_assignments_one_active_per_student_run',
] as const;

async function main() {
  const [columns, triggers, indexes, failedMigrations] = await Promise.all([
    prisma.$queryRaw<ColumnRow[]>(Prisma.sql`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
    `),
    prisma.$queryRaw<NameRow[]>(Prisma.sql`
      SELECT trigger_name AS name
      FROM information_schema.triggers
      WHERE trigger_schema = 'public'
    `),
    prisma.$queryRaw<NameRow[]>(Prisma.sql`
      SELECT indexname AS name
      FROM pg_indexes
      WHERE schemaname = 'public'
    `),
    prisma.$queryRaw<FailedMigrationRow[]>(Prisma.sql`
      SELECT migration_name, logs
      FROM "_prisma_migrations"
      WHERE finished_at IS NULL
        AND rolled_back_at IS NULL
      ORDER BY started_at
    `),
  ]);

  const actualColumns = new Set(
    columns.map(({ table_name, column_name }) => `${table_name}.${column_name}`),
  );
  const missingColumns: string[] = [];

  for (const model of Prisma.dmmf.datamodel.models) {
    const tableName = model.dbName ?? model.name;
    for (const field of model.fields) {
      if (field.kind === 'object') continue;
      const columnName = field.dbName ?? field.name;
      const qualifiedName = `${tableName}.${columnName}`;
      if (!actualColumns.has(qualifiedName)) missingColumns.push(qualifiedName);
    }
  }

  const actualTriggers = new Set(triggers.map(({ name }) => name));
  const missingTriggers = requiredTriggers.filter((name) => !actualTriggers.has(name));

  const actualIndexes = new Set(indexes.map(({ name }) => name));
  const missingIndexes = requiredIndexes.filter((name) => !actualIndexes.has(name));

  if (
    missingColumns.length === 0
    && missingTriggers.length === 0
    && missingIndexes.length === 0
    && failedMigrations.length === 0
  ) {
    console.log(
      `Shared schema verified: ${Prisma.dmmf.datamodel.models.length} models, `
      + `${actualColumns.size} columns, ${requiredTriggers.length} critical triggers, `
      + `${requiredIndexes.length} critical indexes.`,
    );
    return;
  }

  if (missingColumns.length > 0) {
    console.error(`Missing tables/columns (${missingColumns.length}):`);
    for (const name of missingColumns.sort()) console.error(`- ${name}`);
  }

  if (missingTriggers.length > 0) {
    console.error('Missing critical triggers:');
    for (const name of missingTriggers) console.error(`- ${name}`);
  }

  if (missingIndexes.length > 0) {
    console.error('Missing critical indexes:');
    for (const name of missingIndexes) console.error(`- ${name}`);
  }

  if (failedMigrations.length > 0) {
    console.error('Incomplete or rolled-back migrations:');
    for (const migration of failedMigrations) {
      console.error(`- ${migration.migration_name}${migration.logs ? `: ${migration.logs}` : ''}`);
    }
  }

  process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error('Shared schema verification failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
