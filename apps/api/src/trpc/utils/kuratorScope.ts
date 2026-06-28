import { prisma } from '@kuratordashboard/db';
import {
  visibleCourseRunWhere,
  withCourseRunVisibilityFallback,
} from '../../utils/prisma-visibility';
import { resolveCourseRunMemberCustomerIds } from './runMembership';

/**
 * "Who is in this run?" resolution rule used by every kurator-scoped query:
 *   - If a run has any explicit `course_run_members` rows, those — and only those — are members.
 *   - Otherwise the run uses the default-group fallback: every customer with an active
 *     `new_sale` income on the run's course.
 *
 * This file exposes that rule via two helpers used everywhere kurator visibility is gated:
 *   - `getCustomersScopedToKurator`: list customer IDs visible to a given kurator.
 *   - `kuratorCanAccessCustomer`:    boolean predicate for guard checks.
 *
 * Both unite (A) per-customer `kuratorAssignment` rows (legacy/bulk path) with (B) the
 * resolved member set of every course-run owned by the kurator (new run-level link).
 *
 * Branch (B) is what makes "future enrollments inherit the kurator" work for runs that
 * use the default-group fallback, without a write-time hook on `incomes` (Dashboarduz
 * writes incomes; we can't extend it).
 */
export async function getCustomersScopedToKurator(params: {
  tenantId: string;
  kuratorUserId: string;
  courseRunId?: string;
}): Promise<string[]> {
  const { tenantId, kuratorUserId, courseRunId } = params;

  const [perCustomerRows, ownedRuns] = await withCourseRunVisibilityFallback((withHiddenColumn) =>
    Promise.all([
      prisma.kuratorAssignment.findMany({
        where: {
          tenantId,
          kuratorUserId,
          isActive: true,
          ...(withHiddenColumn ? { courseRun: { isHidden: false } } : {}),
          ...(courseRunId ? { courseRunId } : {}),
        },
        select: { customerId: true },
      }),
      prisma.courseRun.findMany({
        where: {
          tenantId,
          kuratorUserId,
          ...visibleCourseRunWhere(withHiddenColumn),
          ...(courseRunId ? { id: courseRunId } : {}),
        },
        select: { id: true, courseId: true },
      }),
    ]),
  );

  const result = new Set<string>(perCustomerRows.map((row) => row.customerId));

  if (ownedRuns.length === 0) {
    return Array.from(result);
  }

  const ownedRunMembers = await Promise.all(
    ownedRuns.map((run) =>
      resolveCourseRunMemberCustomerIds({
        tenantId,
        courseRunId: run.id,
        courseId: run.courseId,
      }),
    ),
  );

  for (const memberIds of ownedRunMembers) {
    for (const customerId of memberIds) {
      result.add(customerId);
    }
  }

  return Array.from(result);
}

/**
 * Permission check: may this kurator act on this customer (optionally pinned to a run)?
 * Mirrors the union from `getCustomersScopedToKurator` but returns a boolean cheaply.
 */
export async function kuratorCanAccessCustomer(params: {
  tenantId: string;
  kuratorUserId: string;
  customerId: string;
  courseRunId?: string;
}): Promise<boolean> {
  const { tenantId, kuratorUserId, customerId, courseRunId } = params;

  const directHit = await withCourseRunVisibilityFallback((withHiddenColumn) =>
    prisma.kuratorAssignment.findFirst({
      where: {
        tenantId,
        kuratorUserId,
        customerId,
        isActive: true,
        ...(withHiddenColumn ? { courseRun: { isHidden: false } } : {}),
        ...(courseRunId ? { courseRunId } : {}),
      },
      select: { id: true },
    }),
  );
  if (directHit) return true;

  const ownedRuns = await withCourseRunVisibilityFallback((withHiddenColumn) =>
    prisma.courseRun.findMany({
      where: {
        tenantId,
        kuratorUserId,
        ...visibleCourseRunWhere(withHiddenColumn),
        ...(courseRunId ? { id: courseRunId } : {}),
      },
      select: { id: true, courseId: true },
    }),
  );
  if (ownedRuns.length === 0) return false;

  const ownedRunIds = ownedRuns.map((row) => row.id);

  // Check explicit roster membership.
  const explicitMember = await prisma.courseRunMember.findFirst({
    where: {
      tenantId,
      customerId,
      courseRunId: { in: ownedRunIds },
    },
    select: { id: true },
  });
  if (explicitMember) return true;

  // ALWAYS check active income for ALL owned runs (not just fallback ones).
  // This ensures newly enrolled customers are accessible immediately.
  const allCourseIds = Array.from(new Set(ownedRuns.map((run) => run.courseId)));
  if (allCourseIds.length > 0) {
    const incomeHit = await prisma.income.findFirst({
      where: {
        tenantId,
        customerId,
        courseId: { in: allCourseIds },
        type: 'new_sale',
        lifecycleStatus: 'active',
      },
      select: { id: true },
    });
    return Boolean(incomeHit);
  }

  return false;
}
