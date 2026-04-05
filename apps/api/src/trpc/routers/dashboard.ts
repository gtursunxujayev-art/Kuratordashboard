import { router, protectedProcedure } from '../trpc';
import { z } from 'zod';
import { prisma } from '@kuratordashboard/db';

const dateFilterSchema = z.enum(['today', 'this_week', 'last_week', 'this_month', 'last_month', 'all']);

const ACTIVE_ENROLLMENT_FILTER = {
  type: 'new_sale' as const,
  lifecycleStatus: 'active' as const,
};

function isMissingCourseRunsTableError(error: unknown): boolean {
  const code = String((error as any)?.code || '');
  const message = String((error as any)?.message || '').toLowerCase();
  if (code !== 'P2021' && code !== 'P2022') {
    return message.includes('course_runs') && message.includes('does not exist');
  }
  return message.includes('course_runs');
}

function isMissingCustomerGenderColumnError(error: unknown): boolean {
  const code = String((error as any)?.code || '');
  const message = String((error as any)?.message || '').toLowerCase();
  if (code !== 'P2021' && code !== 'P2022') {
    return message.includes('customers.gender') && message.includes('does not exist');
  }
  return message.includes('customers.gender');
}

function startOfDayLocal(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function getCalendarDateRange(filter: Exclude<z.infer<typeof dateFilterSchema>, 'all'>): { from: Date; to: Date } {
  const now = new Date();
  const dayStart = startOfDayLocal(now);

  switch (filter) {
    case 'today':
      return { from: dayStart, to: addDays(dayStart, 1) };
    case 'this_week': {
      const weekday = now.getDay();
      const diffToMonday = (weekday + 6) % 7;
      const from = addDays(dayStart, -diffToMonday);
      return { from, to: addDays(from, 7) };
    }
    case 'last_week': {
      const weekday = now.getDay();
      const diffToMonday = (weekday + 6) % 7;
      const thisMonday = addDays(dayStart, -diffToMonday);
      return { from: addDays(thisMonday, -7), to: thisMonday };
    }
    case 'this_month':
      return {
        from: new Date(now.getFullYear(), now.getMonth(), 1),
        to: new Date(now.getFullYear(), now.getMonth() + 1, 1),
      };
    case 'last_month':
      return {
        from: new Date(now.getFullYear(), now.getMonth() - 1, 1),
        to: new Date(now.getFullYear(), now.getMonth(), 1),
      };
  }
}

async function getCoursePeriodRange(tenantId: string, courseRunId?: string): Promise<{ from: Date; to: Date } | null> {
  try {
    const now = new Date();

    const selectedRun = courseRunId
      ? await prisma.courseRun.findFirst({
          where: { id: courseRunId, tenantId },
          select: { startDate: true, endDate: true },
        })
      : null;

    const fallbackRun = selectedRun
      ? null
      : await prisma.courseRun.findFirst({
          where: {
            tenantId,
            startDate: { lte: now },
            endDate: { gte: now },
          },
          orderBy: { startDate: 'desc' },
          select: { startDate: true, endDate: true },
        });

    const latestRun = selectedRun || fallbackRun ||
      (await prisma.courseRun.findFirst({
        where: { tenantId },
        orderBy: { startDate: 'desc' },
        select: { startDate: true, endDate: true },
      }));

    if (!latestRun) return null;

    const from = startOfDayLocal(latestRun.startDate);
    const to = addDays(startOfDayLocal(latestRun.endDate), 1);
    return { from, to };
  } catch (error) {
    if (!isMissingCourseRunsTableError(error)) {
      throw error;
    }
    return null;
  }
}

export const dashboardRouter = router({
  stats: protectedProcedure
    .input(
      z.object({
        dateFilter: dateFilterSchema,
        courseRunId: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { tenantId, user } = ctx;
      const isKurator =
        user.roles.includes('Kurator') &&
        !user.roles.includes('Admin') &&
        !user.roles.includes('Manager');

      const dateRange = input.dateFilter === 'all'
        ? await getCoursePeriodRange(tenantId, input.courseRunId)
        : getCalendarDateRange(input.dateFilter);

      let scopedCustomerIds: string[] | undefined;

      if (input.courseRunId) {
        const runAssignments = await prisma.kuratorAssignment.findMany({
          where: {
            tenantId,
            courseRunId: input.courseRunId,
            isActive: true,
            ...(isKurator ? { kuratorUserId: user.userId } : {}),
          },
          select: { customerId: true },
        });
        scopedCustomerIds = Array.from(new Set(runAssignments.map((a) => a.customerId)));
      } else if (isKurator) {
        const assignments = await prisma.kuratorAssignment.findMany({
          where: {
            tenantId,
            kuratorUserId: user.userId,
            isActive: true,
          },
          select: { customerId: true },
        });
        scopedCustomerIds = Array.from(new Set(assignments.map((a) => a.customerId)));
      }

      const incomeWhere = {
        tenantId,
        ...ACTIVE_ENROLLMENT_FILTER,
        ...(dateRange ? { entryDate: { gte: dateRange.from, lt: dateRange.to } } : {}),
        ...(scopedCustomerIds ? { customerId: { in: scopedCustomerIds } } : {}),
      };

      let incomes: Array<{
        customerId: string;
        tariffId: string | null;
        tariff: { name: string } | null;
        customer?: { gender: string | null } | null;
      }>;
      try {
        incomes = await prisma.income.findMany({
          where: incomeWhere,
          select: {
            customerId: true,
            tariffId: true,
            customer: {
              select: {
                gender: true,
              },
            },
            tariff: {
              select: {
                name: true,
              },
            },
          },
        });
      } catch (error) {
        if (!isMissingCustomerGenderColumnError(error)) {
          throw error;
        }

        const fallbackIncomes = await prisma.income.findMany({
          where: incomeWhere,
          select: {
            customerId: true,
            tariffId: true,
            tariff: {
              select: {
                name: true,
              },
            },
          },
        });
        incomes = fallbackIncomes.map((income) => ({ ...income, customer: null }));
      }

      const seenCustomers = new Map<string, { gender: string | null; tariffId: string | null; tariffName: string | null }>();
      for (const income of incomes) {
        if (!seenCustomers.has(income.customerId)) {
          seenCustomers.set(income.customerId, {
            gender: income.customer?.gender ?? null,
            tariffId: income.tariffId,
            tariffName: income.tariff?.name ?? null,
          });
        }
      }

      const customers = Array.from(seenCustomers.values());
      const total = customers.length;
      const male = customers.filter((c) => c.gender === 'male').length;
      const female = customers.filter((c) => c.gender === 'female').length;

      const tariffMap = new Map<string, { name: string; total: number; male: number; female: number }>();
      for (const c of customers) {
        const key = c.tariffId ?? 'unknown';
        const name = c.tariffName ?? "Noma'lum";
        const current = tariffMap.get(key) ?? { name, total: 0, male: 0, female: 0 };
        current.total += 1;
        if (c.gender === 'male') current.male += 1;
        if (c.gender === 'female') current.female += 1;
        tariffMap.set(key, current);
      }

      return {
        total,
        male,
        female,
        tariffs: Array.from(tariffMap.values()),
      };
    }),

  kuratorList: protectedProcedure
    .input(
      z.object({
        courseRunId: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { tenantId } = ctx;

      const [kurators, assignments, completedGroups, pendingGroups] = await Promise.all([
        prisma.user.findMany({
          where: {
            tenantId,
            roles: { has: 'Kurator' },
            isActive: true,
          },
          select: {
            id: true,
            name: true,
            username: true,
          },
        }),
        prisma.kuratorAssignment.findMany({
          where: {
            tenantId,
            isActive: true,
            ...(input.courseRunId ? { courseRunId: input.courseRunId } : {}),
          },
          select: { kuratorUserId: true, customerId: true },
        }),
        prisma.kuratorTask.groupBy({
          by: ['kuratorUserId'],
          where: {
            tenantId,
            completedAt: { not: null },
          },
          _count: { id: true },
        }),
        prisma.kuratorTask.groupBy({
          by: ['kuratorUserId'],
          where: {
            tenantId,
            completedAt: null,
          },
          _count: { id: true },
        }),
      ]);

      const studentIdsByKurator = new Map<string, Set<string>>();
      const kuratorsByStudent = new Map<string, string[]>();
      for (const assignment of assignments) {
        const studentSet = studentIdsByKurator.get(assignment.kuratorUserId) ?? new Set<string>();
        studentSet.add(assignment.customerId);
        studentIdsByKurator.set(assignment.kuratorUserId, studentSet);

        const linkedKurators = kuratorsByStudent.get(assignment.customerId) ?? [];
        linkedKurators.push(assignment.kuratorUserId);
        kuratorsByStudent.set(assignment.customerId, linkedKurators);
      }

      const uniqueStudentIds = Array.from(kuratorsByStudent.keys());
      const missedRows = uniqueStudentIds.length > 0
        ? await prisma.classAttendance.findMany({
            where: {
              tenantId,
              customerId: { in: uniqueStudentIds },
              attended: false,
              ...(input.courseRunId ? { courseRunId: input.courseRunId } : {}),
            },
            select: { customerId: true },
            distinct: ['customerId'],
          })
        : [];

      const missedByKurator = new Map<string, number>();
      for (const missed of missedRows) {
        const ownerKurators = kuratorsByStudent.get(missed.customerId) ?? [];
        for (const kuratorId of ownerKurators) {
          missedByKurator.set(kuratorId, (missedByKurator.get(kuratorId) ?? 0) + 1);
        }
      }

      const completedByKurator = new Map(completedGroups.map((row) => [row.kuratorUserId, row._count.id]));
      const pendingByKurator = new Map(pendingGroups.map((row) => [row.kuratorUserId, row._count.id]));

      return kurators.map((kurator) => {
        const studentCount = studentIdsByKurator.get(kurator.id)?.size ?? 0;
        const completedTasks = completedByKurator.get(kurator.id) ?? 0;
        const pendingTasks = pendingByKurator.get(kurator.id) ?? 0;
        const totalTasks = completedTasks + pendingTasks;
        const performancePercent = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

        return {
          id: kurator.id,
          name: kurator.name ?? kurator.username ?? 'Kurator',
          studentCount,
          performancePercent,
          performanceNote: 'Vaqtinchalik formula',
          completedTasks,
          pendingTasks,
          missedStudents: missedByKurator.get(kurator.id) ?? 0,
        };
      });
    }),

  courseRuns: protectedProcedure.query(async ({ ctx }) => {
    try {
      return await prisma.courseRun.findMany({
        where: { tenantId: ctx.tenantId },
        include: { course: { select: { name: true, category: true } } },
        orderBy: { startDate: 'desc' },
      });
    } catch (error) {
      if (!isMissingCourseRunsTableError(error)) {
        throw error;
      }
      return [];
    }
  }),
});
