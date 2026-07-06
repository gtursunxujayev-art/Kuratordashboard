import { prisma } from '@kuratordashboard/db';
import { TRPCError } from '@trpc/server';
import {
  visibleCourseRunWhere,
  withCourseRunVisibilityFallback,
} from '../../utils/prisma-visibility';
import { resolveCourseRunMemberSets } from './runMembership';

/** Curator visibility is derived from owned runs and explicit memberships only. */
export async function getCustomersScopedToKurator(params: {
  tenantId: string;
  kuratorUserId: string;
  courseRunId?: string;
}): Promise<string[]> {
  if (params.courseRunId) {
    const selectedRun = await withCourseRunVisibilityFallback((withHiddenColumn) =>
      prisma.courseRun.findFirst({
        where: {
          id: params.courseRunId,
          tenantId: params.tenantId,
          ...visibleCourseRunWhere(withHiddenColumn),
        },
        select: { id: true },
      }),
    );
    if (!selectedRun) throw new TRPCError({ code: 'NOT_FOUND', message: 'Oqim topilmadi' });
  }

  const ownedRuns = await withCourseRunVisibilityFallback((withHiddenColumn) =>
    prisma.courseRun.findMany({
      where: {
        tenantId: params.tenantId,
        kuratorUserId: params.kuratorUserId,
        ...visibleCourseRunWhere(withHiddenColumn),
        ...(params.courseRunId ? { id: params.courseRunId } : {}),
      },
      select: { id: true },
    }),
  );

  const memberSets = await resolveCourseRunMemberSets({
    tenantId: params.tenantId,
    runIds: ownedRuns.map((run) => run.id),
  });
  return Array.from(new Set(Array.from(memberSets.values()).flatMap((members) => Array.from(members))));
}

export async function kuratorCanAccessCustomer(params: {
  tenantId: string;
  kuratorUserId: string;
  customerId: string;
  courseRunId?: string;
}): Promise<boolean> {
  const customerIds = await getCustomersScopedToKurator(params);
  return customerIds.includes(params.customerId);
}
