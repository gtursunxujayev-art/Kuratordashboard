import { prisma } from '@kuratordashboard/db';

/**
 * Customers a kurator is allowed to see, unioned across:
 *   (A) explicit per-customer rows in `kurator_assignments` (the legacy/bulk path), and
 *   (B) customers enrolled (active `new_sale` income) in any course-run whose
 *       `kuratorUserId` equals this kurator (the new run-level link).
 *
 * Branch (B) is what makes "future enrollments inherit the kurator" work
 * without a write-time hook on `incomes` (Dashboarduz writes incomes; we can't
 * extend it).
 *
 * When `courseRunId` is provided, both branches are scoped to that run.
 */
export async function getCustomersScopedToKurator(params: {
  tenantId: string;
  kuratorUserId: string;
  courseRunId?: string;
}): Promise<string[]> {
  const { tenantId, kuratorUserId, courseRunId } = params;

  const [perCustomerRows, ownedRuns] = await Promise.all([
    prisma.kuratorAssignment.findMany({
      where: {
        tenantId,
        kuratorUserId,
        isActive: true,
        ...(courseRunId ? { courseRunId } : {}),
      },
      select: { customerId: true },
    }),
    prisma.courseRun.findMany({
      where: {
        tenantId,
        kuratorUserId,
        ...(courseRunId ? { id: courseRunId } : {}),
      },
      select: { courseId: true },
    }),
  ]);

  const result = new Set<string>(perCustomerRows.map((row) => row.customerId));

  const ownedCourseIds = Array.from(new Set(ownedRuns.map((row) => row.courseId)));
  if (ownedCourseIds.length > 0) {
    const enrolled = await prisma.income.findMany({
      where: {
        tenantId,
        courseId: { in: ownedCourseIds },
        type: 'new_sale',
        lifecycleStatus: 'active',
      },
      select: { customerId: true },
      distinct: ['customerId'],
    });
    for (const row of enrolled) {
      if (row.customerId) result.add(row.customerId);
    }
  }

  return Array.from(result);
}

/**
 * Permission check: may this kurator act on this customer (optionally pinned to a run)?
 * Mirrors the union from getCustomersScopedToKurator but returns a boolean cheaply.
 */
export async function kuratorCanAccessCustomer(params: {
  tenantId: string;
  kuratorUserId: string;
  customerId: string;
  courseRunId?: string;
}): Promise<boolean> {
  const { tenantId, kuratorUserId, customerId, courseRunId } = params;

  const directHit = await prisma.kuratorAssignment.findFirst({
    where: {
      tenantId,
      kuratorUserId,
      customerId,
      isActive: true,
      ...(courseRunId ? { courseRunId } : {}),
    },
    select: { id: true },
  });
  if (directHit) return true;

  const ownedRuns = await prisma.courseRun.findMany({
    where: {
      tenantId,
      kuratorUserId,
      ...(courseRunId ? { id: courseRunId } : {}),
    },
    select: { courseId: true },
  });
  if (ownedRuns.length === 0) return false;

  const incomeHit = await prisma.income.findFirst({
    where: {
      tenantId,
      customerId,
      courseId: { in: ownedRuns.map((row) => row.courseId) },
      type: 'new_sale',
      lifecycleStatus: 'active',
    },
    select: { id: true },
  });
  return Boolean(incomeHit);
}
