import { router, protectedProcedure } from '../trpc';
import { z } from 'zod';
import { prisma } from '@kuratordashboard/db';

const dateFilterSchema = z.enum(['today', 'this_week', 'last_week', 'this_month', 'last_month', 'all']);

function getDateRange(filter: z.infer<typeof dateFilterSchema>): { from: Date; to: Date } | null {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  switch (filter) {
    case 'today': {
      const to = new Date(startOfDay);
      to.setDate(to.getDate() + 1);
      return { from: startOfDay, to };
    }
    case 'this_week': {
      const day = now.getDay(); // 0 = Sunday
      const diffToMonday = (day + 6) % 7;
      const from = new Date(startOfDay);
      from.setDate(from.getDate() - diffToMonday);
      const to = new Date(from);
      to.setDate(to.getDate() + 7);
      return { from, to };
    }
    case 'last_week': {
      const day = now.getDay();
      const diffToMonday = (day + 6) % 7;
      const thisMonday = new Date(startOfDay);
      thisMonday.setDate(thisMonday.getDate() - diffToMonday);
      const from = new Date(thisMonday);
      from.setDate(from.getDate() - 7);
      return { from, to: thisMonday };
    }
    case 'this_month': {
      const from = new Date(now.getFullYear(), now.getMonth(), 1);
      const to = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      return { from, to };
    }
    case 'last_month': {
      const from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const to = new Date(now.getFullYear(), now.getMonth(), 1);
      return { from, to };
    }
    case 'all':
      return null;
    default:
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
      const isKurator = user.roles.includes('Kurator') && !user.roles.includes('Admin') && !user.roles.includes('Manager');
      const dateRange = getDateRange(input.dateFilter);

      // Build base customer ID list
      let customerIds: string[] | undefined;

      if (isKurator) {
        const assignments = await prisma.kuratorAssignment.findMany({
          where: {
            tenantId,
            kuratorUserId: user.userId,
            isActive: true,
            ...(input.courseRunId ? { courseRunId: input.courseRunId } : {}),
          },
          select: { customerId: true },
        });
        customerIds = assignments.map((a) => a.customerId);
      }

      // Get incomes to find enrolled students in the date range
      const incomeWhere = {
        tenantId,
        type: 'new_sale',
        lifecycleStatus: { not: 'refunded' },
        ...(dateRange ? { entryDate: { gte: dateRange.from, lt: dateRange.to } } : {}),
        ...(customerIds ? { customerId: { in: customerIds } } : {}),
      };

      const incomes = await prisma.income.findMany({
        where: incomeWhere,
        select: {
          customerId: true,
          tariffId: true,
          customer: {
            select: {
              id: true,
              gender: true,
            },
          },
          tariff: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });

      // De-duplicate by customer (one customer may have multiple income records)
      const seenCustomers = new Map<string, { gender: string | null; tariffId: string | null; tariffName: string | null }>();
      for (const income of incomes) {
        if (!seenCustomers.has(income.customerId)) {
          seenCustomers.set(income.customerId, {
            gender: income.customer.gender,
            tariffId: income.tariffId,
            tariffName: income.tariff?.name ?? null,
          });
        }
      }

      const customers = Array.from(seenCustomers.values());
      const total = customers.length;
      const male = customers.filter((c) => c.gender === 'male').length;
      const female = customers.filter((c) => c.gender === 'female').length;

      // Group by tariff
      const tariffMap = new Map<string, { name: string; total: number; male: number; female: number }>();
      for (const c of customers) {
        const key = c.tariffId ?? 'unknown';
        const name = c.tariffName ?? "Noma'lum";
        const existing = tariffMap.get(key) ?? { name, total: 0, male: 0, female: 0 };
        existing.total += 1;
        if (c.gender === 'male') existing.male += 1;
        if (c.gender === 'female') existing.female += 1;
        tariffMap.set(key, existing);
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

      // Get all kurator users for this tenant
      const kurators = await prisma.user.findMany({
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
      });

      const result = await Promise.all(
        kurators.map(async (kurator) => {
          const assignmentWhere = {
            tenantId,
            kuratorUserId: kurator.id,
            isActive: true,
            ...(input.courseRunId ? { courseRunId: input.courseRunId } : {}),
          };

          const assignments = await prisma.kuratorAssignment.findMany({
            where: assignmentWhere,
            select: { customerId: true },
          });

          const studentIds = assignments.map((a) => a.customerId);

          // Tasks stats
          const [completedTasks, pendingTasks] = await Promise.all([
            prisma.kuratorTask.count({
              where: {
                tenantId,
                kuratorUserId: kurator.id,
                completedAt: { not: null },
              },
            }),
            prisma.kuratorTask.count({
              where: {
                tenantId,
                kuratorUserId: kurator.id,
                completedAt: null,
              },
            }),
          ]);

          // Students who haven't attended (missed classes)
          let missedStudents = 0;
          if (studentIds.length > 0) {
            missedStudents = await prisma.classAttendance.count({
              where: {
                tenantId,
                customerId: { in: studentIds },
                attended: false,
                ...(input.courseRunId ? { courseRunId: input.courseRunId } : {}),
              },
            });
          }

          // Performance: ratio of completed tasks to total tasks (placeholder formula)
          const totalTasks = completedTasks + pendingTasks;
          const performancePercent =
            totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

          return {
            id: kurator.id,
            name: kurator.name ?? kurator.username ?? 'Kurator',
            studentCount: studentIds.length,
            performancePercent,
            completedTasks,
            pendingTasks,
            missedStudents,
          };
        }),
      );

      return result;
    }),

  courseRuns: protectedProcedure.query(async ({ ctx }) => {
    return prisma.courseRun.findMany({
      where: { tenantId: ctx.tenantId },
      include: { course: { select: { name: true } } },
      orderBy: { startDate: 'desc' },
    });
  }),
});
