import { writeFile } from 'node:fs/promises';
import { prisma } from '@kuratordashboard/db';
import { pickPreferredCourseRun } from '../trpc/utils/runMembership';

type Conflict = {
  tenantId: string;
  courseId: string;
  customerId: string;
  keptRunId: string;
  removedRunIds: string[];
};

type StaleMembership = {
  tenantId: string;
  courseId: string;
  courseRunId: string;
  customerId: string;
};

function enrollmentKey(tenantId: string, courseId: string, customerId: string): string {
  return `${tenantId}:${courseId}:${customerId}`;
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const exportIndex = process.argv.indexOf('--export');
  const exportPath = exportIndex >= 0 ? process.argv[exportIndex + 1] : undefined;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const runs = await prisma.courseRun.findMany({
    select: {
      id: true,
      tenantId: true,
      courseId: true,
      startDate: true,
      endDate: true,
      kuratorUserId: true,
      members: { select: { customerId: true } },
    },
  });
  const currentRuns = runs.filter((run) => run.endDate >= today);
  const currentCustomerIds = Array.from(new Set(
    currentRuns.flatMap((run) => run.members.map((member) => member.customerId)),
  ));
  const activeIncomes = currentCustomerIds.length > 0
    ? await prisma.income.findMany({
        where: {
          customerId: { in: currentCustomerIds },
          type: 'new_sale',
          lifecycleStatus: 'active',
        },
        select: { tenantId: true, courseId: true, customerId: true },
        distinct: ['tenantId', 'courseId', 'customerId'],
      })
    : [];
  const activeEnrollmentKeys = new Set(
    activeIncomes.flatMap((income) => (
      income.courseId ? [enrollmentKey(income.tenantId, income.courseId, income.customerId)] : []
    )),
  );
  const staleMemberships: StaleMembership[] = currentRuns.flatMap((run) =>
    run.members
      .filter((member) => !activeEnrollmentKeys.has(enrollmentKey(run.tenantId, run.courseId, member.customerId)))
      .map((member) => ({
        tenantId: run.tenantId,
        courseId: run.courseId,
        courseRunId: run.id,
        customerId: member.customerId,
      })),
  );
  const staleMembershipKeys = new Set(
    staleMemberships.map((row) => `${row.courseRunId}:${row.customerId}`),
  );

  const memberships = new Map<string, typeof runs>();
  for (const run of runs) {
    if (run.endDate < today) continue;
    for (const { customerId } of run.members) {
      if (staleMembershipKeys.has(`${run.id}:${customerId}`)) continue;
      const key = `${run.tenantId}:${run.courseId}:${customerId}`;
      const list = memberships.get(key) ?? [];
      list.push(run);
      memberships.set(key, list);
    }
  }

  const conflicts: Conflict[] = [];
  for (const [key, candidates] of memberships) {
    if (candidates.length < 2) continue;
    const [tenantId, courseId, customerId] = key.split(':');
    const kept = pickPreferredCourseRun(candidates, now);
    if (!kept) continue;
    conflicts.push({
      tenantId,
      courseId,
      customerId,
      keptRunId: kept.id,
      removedRunIds: candidates.filter((run) => run.id !== kept.id).map((run) => run.id),
    });
  }

  const report = {
    generatedAt: new Date().toISOString(),
    mode: apply ? 'apply' : 'dry-run',
    conflictCount: conflicts.length,
    staleMembershipCount: staleMemberships.length,
    membershipRowsRemoved:
      staleMemberships.length + conflicts.reduce((sum, row) => sum + row.removedRunIds.length, 0),
    staleMemberships,
    conflicts,
  };
  if (exportPath) await writeFile(exportPath, JSON.stringify(report, null, 2), 'utf8');

  if (apply) {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('reconcile-course-run-data'))`;
      for (const stale of staleMemberships) {
        await tx.courseRunMember.deleteMany({
          where: {
            tenantId: stale.tenantId,
            courseRunId: stale.courseRunId,
            customerId: stale.customerId,
          },
        });
      }
      for (const conflict of conflicts) {
        await tx.courseRunMember.deleteMany({
          where: {
            tenantId: conflict.tenantId,
            customerId: conflict.customerId,
            courseRunId: { in: conflict.removedRunIds },
          },
        });
      }

      const currentRuns = await tx.courseRun.findMany({
        select: {
          id: true,
          tenantId: true,
          kuratorUserId: true,
          members: { select: { customerId: true } },
        },
      });
      await tx.kuratorAssignment.updateMany({
        where: { isActive: true },
        data: { isActive: false },
      });
      for (const run of currentRuns) {
        if (!run.kuratorUserId || run.members.length === 0) continue;
        await tx.kuratorAssignment.createMany({
          data: run.members.map(({ customerId }) => ({
            tenantId: run.tenantId,
            courseRunId: run.id,
            customerId,
            kuratorUserId: run.kuratorUserId!,
            isActive: true,
          })),
          skipDuplicates: true,
        });
        await tx.kuratorAssignment.updateMany({
          where: {
            tenantId: run.tenantId,
            courseRunId: run.id,
            kuratorUserId: run.kuratorUserId,
            customerId: { in: run.members.map(({ customerId }) => customerId) },
          },
          data: { isActive: true },
        });
      }
    }, { isolationLevel: 'Serializable', timeout: 120_000 });
  }

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
