import { router, protectedProcedure } from '../trpc';
import { z } from 'zod';
import { prisma } from '@kuratordashboard/db';
import { TRPCError } from '@trpc/server';
import {
  mockCatalog,
  mockDashboardStats,
  mockKuratorDetail,
  mockKuratorList,
  mockStudentPerformanceDetail,
  mockStudentPerformanceList,
} from '../../services/mock-data';

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

function isAdminOrManager(roles: string[]): boolean {
  return roles.includes('Admin') || roles.includes('Manager');
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

async function resolveDateRange(
  tenantId: string,
  dateFilter: z.infer<typeof dateFilterSchema>,
  courseRunId?: string,
): Promise<{ from: Date; to: Date } | null> {
  if (dateFilter === 'all') {
    return getCoursePeriodRange(tenantId, courseRunId);
  }
  return getCalendarDateRange(dateFilter);
}

function intersectCustomerIds(base?: string[], extra?: string[]): string[] | undefined {
  if (!base && !extra) return undefined;
  if (!base) return extra;
  if (!extra) return base;
  const right = new Set(extra);
  return base.filter((id) => right.has(id));
}

async function getRoleScopedCustomerIds(
  tenantId: string,
  user: { userId: string; roles: string[] },
  courseRunId?: string,
): Promise<string[] | undefined> {
  const kuratorOnly = user.roles.includes('Kurator') && !isAdminOrManager(user.roles);
  if (!kuratorOnly && !courseRunId) return undefined;

  const assignments = await prisma.kuratorAssignment.findMany({
    where: {
      tenantId,
      isActive: true,
      ...(kuratorOnly ? { kuratorUserId: user.userId } : {}),
      ...(courseRunId ? { courseRunId } : {}),
    },
    select: { customerId: true },
  });
  return Array.from(new Set(assignments.map((row) => row.customerId)));
}

async function getCourseScopedCustomerIds(
  tenantId: string,
  courseId?: string,
): Promise<string[] | undefined> {
  if (!courseId) return undefined;
  const rows = await prisma.income.findMany({
    where: {
      tenantId,
      ...ACTIVE_ENROLLMENT_FILTER,
      courseId,
    },
    select: { customerId: true },
    distinct: ['customerId'],
  });
  return rows.map((row) => row.customerId);
}

type StudentPerformance = {
  completedTasks: number;
  pendingTasks: number;
  attendedLessons: number;
  totalLessons: number;
  exerciseLogs: number;
  performancePercent: number;
};

async function buildStudentPerformanceMap(params: {
  tenantId: string;
  customerIds: string[];
  dateRange: { from: Date; to: Date } | null;
  courseId?: string;
  courseRunId?: string;
  kuratorUserId?: string;
}): Promise<Map<string, StudentPerformance>> {
  const { tenantId, customerIds, dateRange, courseId, courseRunId, kuratorUserId } = params;
  const map = new Map<string, StudentPerformance>();
  if (customerIds.length === 0) return map;

  const taskBaseWhere: Record<string, unknown> = {
    tenantId,
    customerId: { in: customerIds },
    ...(kuratorUserId ? { kuratorUserId } : {}),
  };

  const [completedTasksByCustomer, pendingTasksByCustomer] = await Promise.all([
    prisma.kuratorTask.groupBy({
      by: ['customerId'],
      where: {
        ...taskBaseWhere,
        completedAt: dateRange ? { gte: dateRange.from, lt: dateRange.to } : { not: null },
      },
      _count: { id: true },
    }),
    prisma.kuratorTask.groupBy({
      by: ['customerId'],
      where: {
        ...taskBaseWhere,
        completedAt: null,
        ...(dateRange ? { createdAt: { gte: dateRange.from, lt: dateRange.to } } : {}),
      },
      _count: { id: true },
    }),
  ]);

  const attendanceBaseWhere: Record<string, unknown> = {
    tenantId,
    customerId: { in: customerIds },
    ...(courseRunId ? { courseRunId } : {}),
    ...(dateRange ? { lessonDate: { gte: dateRange.from, lt: dateRange.to } } : {}),
  };

  let attendanceTotals: Array<{ customerId: string; _count: { id: number } }> = [];
  let attendanceAttended: Array<{ customerId: string; _count: { id: number } }> = [];
  const attendanceWhereWithCourse =
    courseId && !courseRunId ? { ...attendanceBaseWhere, courseRun: { courseId } } : attendanceBaseWhere;
  try {
    [attendanceTotals, attendanceAttended] = await Promise.all([
      prisma.classAttendance.groupBy({
        by: ['customerId'],
        where: attendanceWhereWithCourse,
        _count: { id: true },
      }),
      prisma.classAttendance.groupBy({
        by: ['customerId'],
        where: { ...attendanceWhereWithCourse, attended: true },
        _count: { id: true },
      }),
    ]);
  } catch (error) {
    if (!(courseId && !courseRunId && isMissingCourseRunsTableError(error))) {
      throw error;
    }
    [attendanceTotals, attendanceAttended] = await Promise.all([
      prisma.classAttendance.groupBy({
        by: ['customerId'],
        where: attendanceBaseWhere,
        _count: { id: true },
      }),
      prisma.classAttendance.groupBy({
        by: ['customerId'],
        where: { ...attendanceBaseWhere, attended: true },
        _count: { id: true },
      }),
    ]);
  }

  const exerciseBaseWhere: Record<string, unknown> = {
    tenantId,
    customerId: { in: customerIds },
    ...(dateRange ? { completedAt: { gte: dateRange.from, lt: dateRange.to } } : {}),
    ...(courseRunId
      ? { exerciseDefinition: { courseRunId } }
      : courseId
      ? { exerciseDefinition: { courseRun: { courseId } } }
      : {}),
  };

  let exerciseCounts: Array<{ customerId: string; _count: { id: number } }> = [];
  try {
    exerciseCounts = await prisma.studentExerciseLog.groupBy({
      by: ['customerId'],
      where: exerciseBaseWhere as any,
      _count: { id: true },
    } as any);
  } catch (error) {
    if (!(courseId && !courseRunId && isMissingCourseRunsTableError(error))) {
      throw error;
    }
    exerciseCounts = await prisma.studentExerciseLog.groupBy(
      {
        by: ['customerId'],
        where: {
          tenantId,
          customerId: { in: customerIds },
          ...(dateRange ? { completedAt: { gte: dateRange.from, lt: dateRange.to } } : {}),
        } as any,
        _count: { id: true },
      } as any,
    );
  }

  const completedMap = new Map(completedTasksByCustomer.map((row) => [row.customerId as string, row._count.id]));
  const pendingMap = new Map(pendingTasksByCustomer.map((row) => [row.customerId as string, row._count.id]));
  const attendedMap = new Map(attendanceAttended.map((row) => [row.customerId, row._count.id]));
  const totalAttendanceMap = new Map(attendanceTotals.map((row) => [row.customerId, row._count.id]));
  const exerciseMap = new Map(exerciseCounts.map((row) => [row.customerId, row._count.id]));

  for (const customerId of customerIds) {
    const completedTasks = completedMap.get(customerId) ?? 0;
    const pendingTasks = pendingMap.get(customerId) ?? 0;
    const attendedLessons = attendedMap.get(customerId) ?? 0;
    const totalLessons = totalAttendanceMap.get(customerId) ?? 0;
    const exerciseLogs = exerciseMap.get(customerId) ?? 0;

    const taskTotal = completedTasks + pendingTasks;
    const taskRate = taskTotal > 0 ? (completedTasks / taskTotal) * 100 : 0;
    const attendanceRate = totalLessons > 0 ? (attendedLessons / totalLessons) * 100 : 0;
    const activityRate = Math.min(100, exerciseLogs * 10);

    const performancePercent =
      taskTotal === 0 && totalLessons === 0 && exerciseLogs === 0
        ? 0
        : Math.round(taskRate * 0.4 + attendanceRate * 0.5 + activityRate * 0.1);

    map.set(customerId, {
      completedTasks,
      pendingTasks,
      attendedLessons,
      totalLessons,
      exerciseLogs,
      performancePercent,
    });
  }

  return map;
}

export const dashboardRouter = router({
  courses: protectedProcedure.query(async ({ ctx }) => {
    if (ctx.mockPreview) {
      return mockCatalog().courses;
    }
    return prisma.course.findMany({
      where: { tenantId: ctx.tenantId, isActive: true },
      select: { id: true, name: true, category: true },
      orderBy: { name: 'asc' },
    });
  }),

  stats: protectedProcedure
    .input(
      z.object({
        dateFilter: dateFilterSchema,
        courseId: z.string().optional(),
        courseRunId: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      if (ctx.mockPreview) {
        return mockDashboardStats({ courseId: input.courseId });
      }
      const { tenantId, user } = ctx;
      const dateRange = await resolveDateRange(tenantId, input.dateFilter, input.courseRunId);
      const roleScopedIds = await getRoleScopedCustomerIds(tenantId, user, input.courseRunId);
      const courseScopedIds = await getCourseScopedCustomerIds(tenantId, input.courseId);
      const scopedCustomerIds = intersectCustomerIds(roleScopedIds, courseScopedIds);
      const statsDateRange = input.courseId ? null : dateRange;

      const incomeWhere = {
        tenantId,
        ...ACTIVE_ENROLLMENT_FILTER,
        ...(input.courseId ? { courseId: input.courseId } : {}),
        ...(statsDateRange ? { entryDate: { gte: statsDateRange.from, lt: statsDateRange.to } } : {}),
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
        dateFilter: dateFilterSchema.default('all'),
        courseId: z.string().optional(),
        courseRunId: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      if (ctx.mockPreview) {
        return mockKuratorList({
          courseId: input.courseId,
          dateFilter: input.dateFilter,
        });
      }
      const { tenantId, user } = ctx;
      const dateRange = await resolveDateRange(tenantId, input.dateFilter, input.courseRunId);
      const roleScopedIds = await getRoleScopedCustomerIds(tenantId, user, input.courseRunId);
      const courseScopedIds = await getCourseScopedCustomerIds(tenantId, input.courseId);
      const scopedStudentIds = intersectCustomerIds(roleScopedIds, courseScopedIds);
      const adminOrManager = isAdminOrManager(user.roles);

      const [kurators, assignments, completedGroups, pendingGroups] = await Promise.all([
        prisma.user.findMany({
          where: {
            tenantId,
            roles: { has: 'Kurator' },
            isActive: true,
            ...(!adminOrManager ? { id: user.userId } : {}),
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
            ...(scopedStudentIds ? { customerId: { in: scopedStudentIds } } : {}),
            ...(!adminOrManager ? { kuratorUserId: user.userId } : {}),
          },
          select: { kuratorUserId: true, customerId: true },
        }),
        prisma.kuratorTask.groupBy({
          by: ['kuratorUserId'],
          where: {
            tenantId,
            ...(!adminOrManager ? { kuratorUserId: user.userId } : {}),
            ...(scopedStudentIds ? { customerId: { in: scopedStudentIds } } : {}),
            completedAt: dateRange ? { gte: dateRange.from, lt: dateRange.to } : { not: null },
          },
          _count: { id: true },
        }),
        prisma.kuratorTask.groupBy({
          by: ['kuratorUserId'],
          where: {
            tenantId,
            ...(!adminOrManager ? { kuratorUserId: user.userId } : {}),
            ...(scopedStudentIds ? { customerId: { in: scopedStudentIds } } : {}),
            completedAt: null,
            ...(dateRange ? { createdAt: { gte: dateRange.from, lt: dateRange.to } } : {}),
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
              ...(dateRange ? { lessonDate: { gte: dateRange.from, lt: dateRange.to } } : {}),
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

  studentPerformanceList: protectedProcedure
    .input(
      z.object({
        dateFilter: dateFilterSchema.default('all'),
        courseId: z.string().optional(),
        courseRunId: z.string().optional(),
        page: z.number().int().min(1).default(1),
        limit: z.number().int().min(1).max(200).default(100),
      }),
    )
    .query(async ({ ctx, input }) => {
      if (ctx.mockPreview) {
        return mockStudentPerformanceList({
          courseId: input.courseId,
          dateFilter: input.dateFilter,
          page: input.page,
          limit: input.limit,
        });
      }
      const { tenantId, user } = ctx;
      const dateRange = await resolveDateRange(tenantId, input.dateFilter, input.courseRunId);
      const roleScopedIds = await getRoleScopedCustomerIds(tenantId, user, input.courseRunId);
      const courseScopedIds = await getCourseScopedCustomerIds(tenantId, input.courseId);
      const scopedCustomerIds = intersectCustomerIds(roleScopedIds, courseScopedIds);

      const enrolledRows = await prisma.income.findMany({
        where: {
          tenantId,
          ...ACTIVE_ENROLLMENT_FILTER,
          ...(input.courseId ? { courseId: input.courseId } : {}),
          ...(scopedCustomerIds ? { customerId: { in: scopedCustomerIds } } : {}),
        },
        select: { customerId: true },
        distinct: ['customerId'],
      });

      const enrolledIds = enrolledRows.map((row) => row.customerId);
      if (enrolledIds.length === 0) {
        return {
          data: [],
          pagination: { page: input.page, limit: input.limit, total: 0 },
        };
      }

      const customers = await prisma.customer.findMany({
        where: { tenantId, id: { in: enrolledIds } },
        select: { id: true, name: true, customerNumber: true },
        orderBy: { name: 'asc' },
      });

      const total = customers.length;
      const start = (input.page - 1) * input.limit;
      const pageCustomers = customers.slice(start, start + input.limit);
      const pageIds = pageCustomers.map((c) => c.id);

      const perfMap = await buildStudentPerformanceMap({
        tenantId,
        customerIds: pageIds,
        dateRange,
        courseId: input.courseId,
        courseRunId: input.courseRunId,
      });

      return {
        data: pageCustomers.map((customer) => {
          const perf =
            perfMap.get(customer.id) ??
            ({
              completedTasks: 0,
              pendingTasks: 0,
              attendedLessons: 0,
              totalLessons: 0,
              exerciseLogs: 0,
              performancePercent: 0,
            } satisfies StudentPerformance);
          return {
            id: customer.id,
            name: customer.name,
            number: customer.customerNumber,
            ...perf,
          };
        }),
        pagination: { page: input.page, limit: input.limit, total },
      };
    }),

  studentPerformanceDetail: protectedProcedure
    .input(
      z.object({
        customerId: z.string(),
        dateFilter: dateFilterSchema.default('all'),
        courseId: z.string().optional(),
        courseRunId: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      if (ctx.mockPreview) {
        return mockStudentPerformanceDetail({
          customerId: input.customerId,
          courseId: input.courseId,
          dateFilter: input.dateFilter,
        });
      }
      const { tenantId, user } = ctx;
      const kuratorOnly = user.roles.includes('Kurator') && !isAdminOrManager(user.roles);
      if (kuratorOnly) {
        const assignment = await prisma.kuratorAssignment.findFirst({
          where: {
            tenantId,
            kuratorUserId: user.userId,
            customerId: input.customerId,
            isActive: true,
            ...(input.courseRunId ? { courseRunId: input.courseRunId } : {}),
          },
          select: { id: true },
        });
        if (!assignment) {
          throw new TRPCError({ code: 'FORBIDDEN', message: "Ruxsat yo'q" });
        }
      }

      const customer = await prisma.customer.findFirst({
        where: { id: input.customerId, tenantId },
        select: {
          id: true,
          name: true,
          customerNumber: true,
          telegramUsername: true,
          incomes: {
            where: {
              ...ACTIVE_ENROLLMENT_FILTER,
              ...(input.courseId ? { courseId: input.courseId } : {}),
            },
            include: { course: true, tariff: true },
            orderBy: { entryDate: 'desc' },
            take: 10,
          },
        },
      });
      if (!customer) {
        throw new TRPCError({ code: 'NOT_FOUND', message: "O'quvchi topilmadi" });
      }

      const dateRange = await resolveDateRange(tenantId, input.dateFilter, input.courseRunId);
      const perfMap = await buildStudentPerformanceMap({
        tenantId,
        customerIds: [input.customerId],
        dateRange,
        courseId: input.courseId,
        courseRunId: input.courseRunId,
      });

      const taskWhere: Record<string, unknown> = {
        tenantId,
        customerId: input.customerId,
        ...(dateRange ? { createdAt: { gte: dateRange.from, lt: dateRange.to } } : {}),
      };

      const recentTasks = await prisma.kuratorTask.findMany({
        where: taskWhere,
        select: {
          id: true,
          title: true,
          dueDate: true,
          completedAt: true,
          createdAt: true,
          kurator: { select: { id: true, name: true, username: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 30,
      });

      const attendanceBaseWhere: Record<string, unknown> = {
        tenantId,
        customerId: input.customerId,
        ...(input.courseRunId ? { courseRunId: input.courseRunId } : {}),
        ...(dateRange ? { lessonDate: { gte: dateRange.from, lt: dateRange.to } } : {}),
      };
      const attendanceWhereWithCourse =
        input.courseId && !input.courseRunId
          ? { ...attendanceBaseWhere, courseRun: { courseId: input.courseId } }
          : attendanceBaseWhere;
      let recentAttendance: Array<{
        id: string;
        lessonDate: Date;
        attended: boolean;
        lessonType: string;
      }> = [];
      try {
        recentAttendance = await prisma.classAttendance.findMany({
          where: attendanceWhereWithCourse,
          select: { id: true, lessonDate: true, attended: true, lessonType: true },
          orderBy: { lessonDate: 'desc' },
          take: 50,
        });
      } catch (error) {
        if (!(input.courseId && !input.courseRunId && isMissingCourseRunsTableError(error))) {
          throw error;
        }
        recentAttendance = await prisma.classAttendance.findMany({
          where: attendanceBaseWhere,
          select: { id: true, lessonDate: true, attended: true, lessonType: true },
          orderBy: { lessonDate: 'desc' },
          take: 50,
        });
      }

      const exerciseWhere: Record<string, unknown> = {
        tenantId,
        customerId: input.customerId,
        ...(dateRange ? { completedAt: { gte: dateRange.from, lt: dateRange.to } } : {}),
        ...(input.courseRunId
          ? { exerciseDefinition: { courseRunId: input.courseRunId } }
          : input.courseId
          ? { exerciseDefinition: { courseRun: { courseId: input.courseId } } }
          : {}),
      };
      let recentExercises: Array<{
        id: string;
        completedAt: Date;
        note: string | null;
        exerciseDefinition: { id: string; name: string; type: string };
      }> = [];
      try {
        recentExercises = await prisma.studentExerciseLog.findMany({
          where: exerciseWhere,
          select: {
            id: true,
            completedAt: true,
            note: true,
            exerciseDefinition: { select: { id: true, name: true, type: true } },
          },
          orderBy: { completedAt: 'desc' },
          take: 50,
        });
      } catch (error) {
        if (!(input.courseId && !input.courseRunId && isMissingCourseRunsTableError(error))) {
          throw error;
        }
        recentExercises = await prisma.studentExerciseLog.findMany({
          where: {
            tenantId,
            customerId: input.customerId,
            ...(dateRange ? { completedAt: { gte: dateRange.from, lt: dateRange.to } } : {}),
          },
          select: {
            id: true,
            completedAt: true,
            note: true,
            exerciseDefinition: { select: { id: true, name: true, type: true } },
          },
          orderBy: { completedAt: 'desc' },
          take: 50,
        });
      }

      return {
        customer,
        performance:
          perfMap.get(input.customerId) ??
          ({
            completedTasks: 0,
            pendingTasks: 0,
            attendedLessons: 0,
            totalLessons: 0,
            exerciseLogs: 0,
            performancePercent: 0,
          } satisfies StudentPerformance),
        recentTasks,
        recentAttendance,
        recentExercises,
      };
    }),

  kuratorDetail: protectedProcedure
    .input(
      z.object({
        kuratorUserId: z.string(),
        dateFilter: dateFilterSchema.default('all'),
        courseId: z.string().optional(),
        courseRunId: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      if (ctx.mockPreview) {
        return mockKuratorDetail({
          kuratorUserId: input.kuratorUserId,
          courseId: input.courseId,
          dateFilter: input.dateFilter,
        });
      }
      const { tenantId, user } = ctx;
      const adminOrManager = isAdminOrManager(user.roles);
      if (!adminOrManager && user.userId !== input.kuratorUserId) {
        throw new TRPCError({ code: 'FORBIDDEN', message: "Ruxsat yo'q" });
      }

      const kurator = await prisma.user.findFirst({
        where: {
          id: input.kuratorUserId,
          tenantId,
          roles: { has: 'Kurator' },
          isActive: true,
        },
        select: { id: true, name: true, username: true, phone: true, email: true },
      });
      if (!kurator) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Kurator topilmadi' });
      }

      const dateRange = await resolveDateRange(tenantId, input.dateFilter, input.courseRunId);
      const courseScopedIds = await getCourseScopedCustomerIds(tenantId, input.courseId);

      const assignments = await prisma.kuratorAssignment.findMany({
        where: {
          tenantId,
          kuratorUserId: input.kuratorUserId,
          isActive: true,
          ...(input.courseRunId ? { courseRunId: input.courseRunId } : {}),
          ...(courseScopedIds ? { customerId: { in: courseScopedIds } } : {}),
        },
        select: { customerId: true },
      });

      const studentIds = Array.from(new Set(assignments.map((row) => row.customerId)));
      const perfMap = await buildStudentPerformanceMap({
        tenantId,
        customerIds: studentIds,
        dateRange,
        courseId: input.courseId,
        courseRunId: input.courseRunId,
        kuratorUserId: input.kuratorUserId,
      });

      const students = studentIds.length
        ? await prisma.customer.findMany({
            where: { tenantId, id: { in: studentIds } },
            select: { id: true, name: true, customerNumber: true },
            orderBy: { name: 'asc' },
          })
        : [];

      const enrichedStudents = students.map((student) => {
        const perf =
          perfMap.get(student.id) ??
          ({
            completedTasks: 0,
            pendingTasks: 0,
            attendedLessons: 0,
            totalLessons: 0,
            exerciseLogs: 0,
            performancePercent: 0,
          } satisfies StudentPerformance);
        return {
          id: student.id,
          name: student.name,
          number: student.customerNumber,
          ...perf,
        };
      });

      const completedTasks = enrichedStudents.reduce((sum, row) => sum + row.completedTasks, 0);
      const pendingTasks = enrichedStudents.reduce((sum, row) => sum + row.pendingTasks, 0);
      const missedStudents = enrichedStudents.filter(
        (row) => row.totalLessons > 0 && row.attendedLessons < row.totalLessons,
      ).length;
      const totalTasks = completedTasks + pendingTasks;
      const performancePercent = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

      return {
        kurator,
        summary: {
          studentCount: enrichedStudents.length,
          completedTasks,
          pendingTasks,
          missedStudents,
          performancePercent,
          performanceNote: 'Vaqtinchalik formula',
        },
        students: enrichedStudents,
      };
    }),

  courseRuns: protectedProcedure.query(async ({ ctx }) => {
    if (ctx.mockPreview) {
      return mockCatalog().courseRuns;
    }
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
