import { prisma } from '@kuratordashboard/db';

const ACTIVE_ENROLLMENT_FILTER = {
  type: 'new_sale' as const,
  lifecycleStatus: 'active' as const,
};

export async function resolveCourseRunMemberCustomerIds(params: {
  tenantId: string;
  courseRunId: string;
  courseId: string;
}): Promise<string[]> {
  const { tenantId, courseRunId, courseId } = params;

  try {
    const explicitMembers = await prisma.courseRunMember.findMany({
      where: { tenantId, courseRunId },
      select: { customerId: true },
    });

    if (explicitMembers.length > 0) {
      return explicitMembers.map((row) => row.customerId);
    }
  } catch (error) {
    const code = String((error as any)?.code || '');
    const message = String((error as any)?.message || '').toLowerCase();
    const missingMembersTable =
      (code === 'P2021' || code === 'P2022')
        ? message.includes('course_run_members')
        : message.includes('course_run_members') && message.includes('does not exist');

    if (!missingMembersTable) {
      throw error;
    }
  }

  const enrolled = await prisma.income.findMany({
    where: {
      tenantId,
      courseId,
      ...ACTIVE_ENROLLMENT_FILTER,
    },
    select: { customerId: true },
    distinct: ['customerId'],
  });

  return enrolled.map((row) => row.customerId).filter((id): id is string => Boolean(id));
}
