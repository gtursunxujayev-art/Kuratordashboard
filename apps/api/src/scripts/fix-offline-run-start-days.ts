import { writeFile } from 'node:fs/promises';
import { prisma } from '@kuratordashboard/db';
import {
  OFFLINE_SCHEDULE_CUTOVER_DATE,
  computeEndDate,
  isOfflineLikeCategory,
} from '../utils/course-schedule';

// Detects (and, with --apply, corrects) offline/intensiv CourseRuns that were
// created with a post-cutover startDate (>= 2026-09-01) under the OLD Saturday-
// start rule, before the Friday/Saturday schedule change went live. For each such
// run, the corrected Friday start is the Saturday's preceding day.
//
// Safety: --apply only moves startDate/endDate for runs with ZERO existing
// ClassAttendance rows. Runs with attendance history are reported but never
// auto-corrected — those need a human decision (the report lists exactly how
// many rows, by source, would be affected) before any manual fix.
//
// Usage:
//   tsx src/scripts/fix-offline-run-start-days.ts                 # dry-run, prints report
//   tsx src/scripts/fix-offline-run-start-days.ts --export out.json
//   tsx src/scripts/fix-offline-run-start-days.ts --apply         # corrects zero-attendance runs only

type AffectedRun = {
  courseRunId: string;
  tenantId: string;
  courseId: string;
  courseName: string;
  runName: string;
  oldStartDate: string;
  newStartDate: string;
  oldEndDate: string;
  newEndDate: string;
  attendanceRowsAffected: number;
  attendanceBySource: Record<string, number>;
  safeToAutoApply: boolean;
};

function toDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function precedingFriday(saturday: Date): Date {
  const friday = new Date(saturday);
  friday.setDate(friday.getDate() - 1);
  return friday;
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const exportIndex = process.argv.indexOf('--export');
  const exportPath = exportIndex >= 0 ? process.argv[exportIndex + 1] : undefined;

  const runs = await prisma.courseRun.findMany({
    select: {
      id: true,
      tenantId: true,
      courseId: true,
      name: true,
      startDate: true,
      endDate: true,
      durationWeeks: true,
      course: { select: { name: true, category: true } },
    },
  });

  const candidates = runs.filter((run) => (
    isOfflineLikeCategory(run.course.category)
    && run.startDate.getTime() >= OFFLINE_SCHEDULE_CUTOVER_DATE.getTime()
    && run.startDate.getDay() === 6 // still Saturday-start: created under the old rule
  ));

  const affected: AffectedRun[] = [];
  for (const run of candidates) {
    const newStartDate = precedingFriday(run.startDate);
    const newEndDate = computeEndDate(newStartDate, run.durationWeeks, run.course.category);

    const attendanceRows = await prisma.classAttendance.findMany({
      where: { tenantId: run.tenantId, courseRunId: run.id },
      select: { source: true },
    });
    const attendanceBySource: Record<string, number> = {};
    for (const row of attendanceRows) {
      attendanceBySource[row.source] = (attendanceBySource[row.source] ?? 0) + 1;
    }

    affected.push({
      courseRunId: run.id,
      tenantId: run.tenantId,
      courseId: run.courseId,
      courseName: run.course.name,
      runName: run.name,
      oldStartDate: toDateKey(run.startDate),
      newStartDate: toDateKey(newStartDate),
      oldEndDate: toDateKey(run.endDate),
      newEndDate: toDateKey(newEndDate),
      attendanceRowsAffected: attendanceRows.length,
      attendanceBySource,
      safeToAutoApply: attendanceRows.length === 0,
    });
  }

  const autoApplyCount = affected.filter((row) => row.safeToAutoApply).length;
  const needsManualReviewCount = affected.length - autoApplyCount;

  const report = {
    generatedAt: new Date().toISOString(),
    mode: apply ? 'apply' : 'dry-run',
    cutoverDate: toDateKey(OFFLINE_SCHEDULE_CUTOVER_DATE),
    affectedRunCount: affected.length,
    autoApplyCount,
    needsManualReviewCount,
    affected,
  };

  if (exportPath) await writeFile(exportPath, JSON.stringify(report, null, 2), 'utf8');

  if (apply && autoApplyCount > 0) {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('fix-offline-run-start-days'))`;
      for (const row of affected) {
        if (!row.safeToAutoApply) continue;
        await tx.courseRun.update({
          where: { id: row.courseRunId },
          data: {
            startDate: new Date(`${row.newStartDate}T00:00:00`),
            endDate: new Date(`${row.newEndDate}T00:00:00`),
          },
        });
      }
    }, { isolationLevel: 'Serializable', timeout: 120_000 });
  }

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (needsManualReviewCount > 0) {
    process.stderr.write(
      `\n${needsManualReviewCount} run(s) have existing attendance and were NOT auto-corrected — review "affected" entries with safeToAutoApply=false.\n`,
    );
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
