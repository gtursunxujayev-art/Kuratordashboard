import { prisma } from '@kuratordashboard/db';
import { TRPCError } from '@trpc/server';

export type CourseRunMembershipRef = {
  id: string;
  courseId: string;
  startDate: Date;
  endDate: Date;
  kuratorUserId?: string | null;
  kurator?: { id: string; name: string | null; username: string | null } | null;
};

const ACTIVE_COURSE_ENROLLMENT_WHERE = {
  type: 'new_sale' as const,
  lifecycleStatus: 'active' as const,
};

function startOfToday(now = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function enrollmentKey(customerId: string, courseId: string): string {
  return `${customerId}:${courseId}`;
}

async function resolveActiveEnrollmentKeys(params: {
  tenantId: string;
  customerIds: string[];
  courseIds: string[];
}): Promise<Set<string>> {
  const customerIds = Array.from(new Set(params.customerIds));
  const courseIds = Array.from(new Set(params.courseIds));
  if (customerIds.length === 0 || courseIds.length === 0) return new Set();

  const rows = await prisma.income.findMany({
    where: {
      tenantId: params.tenantId,
      customerId: { in: customerIds },
      courseId: { in: courseIds },
      ...ACTIVE_COURSE_ENROLLMENT_WHERE,
    },
    select: { customerId: true, courseId: true },
    distinct: ['customerId', 'courseId'],
  });
  return new Set(
    rows.flatMap((row) => (row.courseId ? [enrollmentKey(row.customerId, row.courseId)] : [])),
  );
}

/** Explicit course_run_members rows establish membership; current/future rows also require an active course sale. */
export async function resolveCourseRunMemberCustomerIds(params: {
  tenantId: string;
  courseRunId: string;
  courseId?: string;
}): Promise<string[]> {
  const run = await prisma.courseRun.findFirst({
    where: {
      id: params.courseRunId,
      tenantId: params.tenantId,
      ...(params.courseId ? { courseId: params.courseId } : {}),
    },
    select: { id: true, courseId: true, endDate: true },
  });
  if (!run) throw new TRPCError({ code: 'NOT_FOUND', message: 'Oqim topilmadi' });

  const rows = await prisma.courseRunMember.findMany({
    where: {
      tenantId: params.tenantId,
      courseRunId: params.courseRunId,
      ...(params.courseId ? { courseRun: { courseId: params.courseId } } : {}),
    },
    select: { customerId: true },
  });

  if (run.endDate < startOfToday()) return rows.map((row) => row.customerId);

  const activeEnrollmentKeys = await resolveActiveEnrollmentKeys({
    tenantId: params.tenantId,
    customerIds: rows.map((row) => row.customerId),
    courseIds: [run.courseId],
  });
  return rows
    .filter((row) => activeEnrollmentKeys.has(enrollmentKey(row.customerId, run.courseId)))
    .map((row) => row.customerId);
}

export async function resolveCourseRunMemberSets(params: {
  tenantId: string;
  runIds: string[];
}): Promise<Map<string, Set<string>>> {
  const uniqueRunIds = Array.from(new Set(params.runIds));
  const result = new Map<string, Set<string>>(uniqueRunIds.map((runId) => [runId, new Set()]));
  if (uniqueRunIds.length === 0) return result;

  const [runs, rows] = await Promise.all([
    prisma.courseRun.findMany({
      where: { tenantId: params.tenantId, id: { in: uniqueRunIds } },
      select: { id: true, courseId: true, endDate: true },
    }),
    prisma.courseRunMember.findMany({
      where: { tenantId: params.tenantId, courseRunId: { in: uniqueRunIds } },
      select: { courseRunId: true, customerId: true },
    }),
  ]);

  const runById = new Map(runs.map((run) => [run.id, run]));
  const today = startOfToday();
  const currentRows = rows.filter((row) => {
    const run = runById.get(row.courseRunId);
    return run && run.endDate >= today;
  });
  const activeEnrollmentKeys = await resolveActiveEnrollmentKeys({
    tenantId: params.tenantId,
    customerIds: currentRows.map((row) => row.customerId),
    courseIds: currentRows.flatMap((row) => {
      const courseId = runById.get(row.courseRunId)?.courseId;
      return courseId ? [courseId] : [];
    }),
  });

  for (const row of rows) {
    const run = runById.get(row.courseRunId);
    if (!run) continue;
    if (run.endDate >= today && !activeEnrollmentKeys.has(enrollmentKey(row.customerId, run.courseId))) {
      continue;
    }
    result.get(row.courseRunId)?.add(row.customerId);
  }
  return result;
}

export function pickPreferredCourseRun<T extends CourseRunMembershipRef>(
  runs: T[],
  now = new Date(),
): T | null {
  if (runs.length === 0) return null;
  const time = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const active = runs
    .filter((run) => run.startDate.getTime() <= time && run.endDate.getTime() >= time)
    .sort((a, b) => b.startDate.getTime() - a.startDate.getTime());
  if (active[0]) return active[0];

  const upcoming = runs
    .filter((run) => run.startDate.getTime() > time)
    .sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
  if (upcoming[0]) return upcoming[0];

  return [...runs].sort((a, b) => b.endDate.getTime() - a.endDate.getTime())[0] ?? null;
}

export async function resolvePreferredRunByCustomer(params: {
  tenantId: string;
  courseId: string;
  customerIds: string[];
  now?: Date;
}): Promise<Map<string, CourseRunMembershipRef>> {
  const uniqueCustomerIds = Array.from(new Set(params.customerIds));
  if (uniqueCustomerIds.length === 0) return new Map();

  const rows = await prisma.courseRunMember.findMany({
    where: {
      tenantId: params.tenantId,
      customerId: { in: uniqueCustomerIds },
      courseRun: { courseId: params.courseId },
    },
    select: {
      customerId: true,
      courseRun: {
        select: {
          id: true,
          courseId: true,
          startDate: true,
          endDate: true,
          kuratorUserId: true,
          kurator: { select: { id: true, name: true, username: true } },
        },
      },
    },
  });

  const candidates = new Map<string, CourseRunMembershipRef[]>();
  const today = startOfToday(params.now);
  const activeEnrollmentKeys = await resolveActiveEnrollmentKeys({
    tenantId: params.tenantId,
    customerIds: rows
      .filter((row) => row.courseRun.endDate >= today)
      .map((row) => row.customerId),
    courseIds: [params.courseId],
  });
  for (const row of rows) {
    if (
      row.courseRun.endDate >= today &&
      !activeEnrollmentKeys.has(enrollmentKey(row.customerId, row.courseRun.courseId))
    ) {
      continue;
    }
    const list = candidates.get(row.customerId) ?? [];
    list.push(row.courseRun);
    candidates.set(row.customerId, list);
  }

  const result = new Map<string, CourseRunMembershipRef>();
  for (const [customerId, runs] of candidates) {
    const preferred = pickPreferredCourseRun(runs, params.now);
    if (preferred) result.set(customerId, preferred);
  }
  return result;
}
