import { prisma } from '@kuratordashboard/db';
import {
  visibleCourseRunWhere,
  withCourseRunVisibilityFallback,
} from '../../utils/prisma-visibility';
import { resolveCourseRunMemberCustomerIds } from './runMembership';

type ScopedRun = { id: string; courseId: string };

async function resolveRunMemberSets(params: {
  tenantId: string;
  runs: ScopedRun[];
}): Promise<Map<string, Set<string>>> {
  const entries = await Promise.all(
    params.runs.map(async (run) => [
      run.id,
      new Set(
        await resolveCourseRunMemberCustomerIds({
          tenantId: params.tenantId,
          courseRunId: run.id,
          courseId: run.courseId,
        }),
      ),
    ] as const),
  );

  return new Map(entries);
}

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
        select: {
          customerId: true,
          courseRunId: true,
          courseRun: { select: { courseId: true } },
        },
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

  const assignmentRuns = Array.from(
    new Map(
      perCustomerRows.map((row) => [
        row.courseRunId,
        { id: row.courseRunId, courseId: row.courseRun.courseId },
      ]),
    ).values(),
  );
  const assignmentMemberSets = await resolveRunMemberSets({ tenantId, runs: assignmentRuns });
  const result = new Set<string>();

  for (const row of perCustomerRows) {
    if (assignmentMemberSets.get(row.courseRunId)?.has(row.customerId)) {
      result.add(row.customerId);
    }
  }

  if (ownedRuns.length === 0) {
    return Array.from(result);
  }

  const ownedRunMemberSets = await resolveRunMemberSets({ tenantId, runs: ownedRuns });

  for (const memberIds of ownedRunMemberSets.values()) {
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

  const directAssignments = await withCourseRunVisibilityFallback((withHiddenColumn) =>
    prisma.kuratorAssignment.findMany({
      where: {
        tenantId,
        kuratorUserId,
        customerId,
        isActive: true,
        ...(withHiddenColumn ? { courseRun: { isHidden: false } } : {}),
        ...(courseRunId ? { courseRunId } : {}),
      },
      select: {
        courseRunId: true,
        courseRun: { select: { courseId: true } },
      },
    }),
  );

  const directRuns = Array.from(
    new Map(
      directAssignments.map((row) => [
        row.courseRunId,
        { id: row.courseRunId, courseId: row.courseRun.courseId },
      ]),
    ).values(),
  );
  const directMemberSets = await resolveRunMemberSets({ tenantId, runs: directRuns });
  if (directRuns.some((run) => directMemberSets.get(run.id)?.has(customerId))) {
    return true;
  }

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

  const ownedMemberSets = await resolveRunMemberSets({ tenantId, runs: ownedRuns });
  return ownedRuns.some((run) => ownedMemberSets.get(run.id)?.has(customerId));
}
