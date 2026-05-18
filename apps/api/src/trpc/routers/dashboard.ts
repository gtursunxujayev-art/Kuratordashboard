import { router, protectedProcedure, adminProcedure, managerProcedure } from '../trpc';
import { z } from 'zod';
import { prisma } from '@kuratordashboard/db';
import { TRPCError } from '@trpc/server';
import { getCustomersScopedToKurator } from '../utils/kuratorScope';

const dateFilterSchema = z.enum(['today', 'this_week', 'last_week', 'this_month', 'last_month', 'all']);
const amaliyReportDatePresetSchema = z.enum([
  'today',
  'week1',
  'week2',
  'week3',
  'week4',
  'week5',
  'week6',
  'all',
]);
type AmaliyWeekKey = 'week1' | 'week2' | 'week3' | 'week4' | 'week5' | 'week6';
const AMALIY_WEEK_KEYS: AmaliyWeekKey[] = ['week1', 'week2', 'week3', 'week4', 'week5', 'week6'];

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

function isMissingCourseEndDateColumnError(error: unknown): boolean {
  const code = String((error as any)?.code || '');
  const message = String((error as any)?.message || '').toLowerCase();
  if (code !== 'P2021' && code !== 'P2022') {
    return message.includes('courses.enddate') && message.includes('does not exist');
  }
  return message.includes('courses.enddate');
}

function isMissingCourseRunMembersTableError(error: unknown): boolean {
  const code = String((error as any)?.code || '');
  const message = String((error as any)?.message || '').toLowerCase();
  if (code !== 'P2021' && code !== 'P2022') {
    return message.includes('course_run_members') && message.includes('does not exist');
  }
  return message.includes('course_run_members');
}

function isMissingCustomerGenderColumnError(error: unknown): boolean {
  const code = String((error as any)?.code || '');
  const message = String((error as any)?.message || '').toLowerCase();
  if (code !== 'P2021' && code !== 'P2022') {
    return message.includes('customers.gender') && message.includes('does not exist');
  }
  return message.includes('customers.gender');
}

function isMissingOptionalPerformanceSchemaError(error: unknown): boolean {
  const code = String((error as any)?.code || '');
  if (code !== 'P2021' && code !== 'P2022') {
    return false;
  }
  const message = String((error as any)?.message || '').toLowerCase();
  return (
    message.includes('kurator_tasks')
    || message.includes('class_attendance')
    || message.includes('student_exercise_logs')
    || message.includes('kurator_assignments')
    || message.includes('course_runs')
  );
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

function maxDate(left: Date, right: Date): Date {
  return left.getTime() >= right.getTime() ? left : right;
}

function minDate(left: Date, right: Date): Date {
  return left.getTime() <= right.getTime() ? left : right;
}

function toDateLabel(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
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

function getFirstMondayOnOrAfter(startDate: Date): Date {
  const day = startDate.getDay(); // 0=Sun, 1=Mon, ... 6=Sat
  if (day === 1) return startDate;
  const daysToMonday = (8 - day) % 7;
  return addDays(startDate, daysToMonday);
}

function resolveAmaliyReportDateRange(params: {
  datePreset: z.infer<typeof amaliyReportDatePresetSchema>;
  runStart: Date;
  runEndExclusive: Date;
}): { from: Date; to: Date } {
  const { datePreset, runStart, runEndExclusive } = params;

  if (datePreset === 'today') {
    const todayStart = startOfDayLocal(new Date());
    return { from: todayStart, to: addDays(todayStart, 1) };
  }

  if (datePreset === 'all') {
    return { from: runStart, to: runEndExclusive };
  }

  const weekNumber = Number(datePreset.replace('week', ''));
  const startsOnMonday = runStart.getDay() === 1;

  let from: Date;
  let to: Date;

  if (startsOnMonday) {
    from = addDays(runStart, (weekNumber - 1) * 7);
    to = addDays(from, 7);
  } else {
    const firstMonday = getFirstMondayOnOrAfter(runStart);
    if (weekNumber === 1) {
      // Partial week from run start until Sunday, as requested by product spec.
      from = runStart;
      to = firstMonday;
    } else {
      from = addDays(firstMonday, (weekNumber - 2) * 7);
      to = addDays(from, 7);
    }
  }

  return {
    from: maxDate(from, runStart),
    to: minDate(to, runEndExclusive),
  };
}

function resolveAmaliyWeekRanges(params: {
  runStart: Date;
  runEndExclusive: Date;
}): Record<AmaliyWeekKey, { from: Date; to: Date }> {
  const { runStart, runEndExclusive } = params;
  return {
    week1: resolveAmaliyReportDateRange({ datePreset: 'week1', runStart, runEndExclusive }),
    week2: resolveAmaliyReportDateRange({ datePreset: 'week2', runStart, runEndExclusive }),
    week3: resolveAmaliyReportDateRange({ datePreset: 'week3', runStart, runEndExclusive }),
    week4: resolveAmaliyReportDateRange({ datePreset: 'week4', runStart, runEndExclusive }),
    week5: resolveAmaliyReportDateRange({ datePreset: 'week5', runStart, runEndExclusive }),
    week6: resolveAmaliyReportDateRange({ datePreset: 'week6', runStart, runEndExclusive }),
  };
}

function isDateInRange(date: Date, range: { from: Date; to: Date }): boolean {
  const ts = date.getTime();
  return ts >= range.from.getTime() && ts < range.to.getTime();
}

function dayLabelUz(date: Date): string {
  const labels = ['Ya', 'Du', 'Se', 'Cho', 'Pay', 'Ju', 'Sha'];
  return labels[date.getDay()] ?? '';
}

function toDayKey(date: Date): string {
  return toDateLabel(startOfDayLocal(date));
}

function isAmaliyPracticeEligibleOnDate(type: string, date: Date): boolean {
  const day = startOfDayLocal(date).getDay();
  if (type === 'class') {
    return day === 0 || day === 6;
  }
  if (type === 'homework' || type === 'extra') {
    return day >= 1 && day <= 5;
  }
  return true;
}

function enumerateDateRange(range: { from: Date; to: Date }): Array<{ date: string; label: string }> {
  const result: Array<{ date: string; label: string }> = [];
  for (let cursor = startOfDayLocal(range.from); cursor.getTime() < range.to.getTime(); cursor = addDays(cursor, 1)) {
    result.push({
      date: toDateLabel(cursor),
      label: dayLabelUz(cursor),
    });
  }
  return result;
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

  if (kuratorOnly) {
    return getCustomersScopedToKurator({
      tenantId,
      kuratorUserId: user.userId,
      courseRunId,
    });
  }

  // Admin/Manager + courseRunId: customers in this run via per-customer
  // assignments, plus — if the run has been claimed by a kurator — any
  // currently-enrolled customer in that course (handles enrollments that
  // happened after the kurator attached).
  const [assignments, run] = await Promise.all([
    prisma.kuratorAssignment.findMany({
      where: { tenantId, isActive: true, courseRunId },
      select: { customerId: true },
    }),
    prisma.courseRun.findFirst({
      where: { tenantId, id: courseRunId },
      select: { courseId: true, kuratorUserId: true },
    }),
  ]);
  const ids = new Set<string>(assignments.map((row) => row.customerId));
  if (run?.kuratorUserId) {
    const enrolled = await prisma.income.findMany({
      where: {
        tenantId,
        courseId: run.courseId,
        ...ACTIVE_ENROLLMENT_FILTER,
      },
      select: { customerId: true },
      distinct: ['customerId'],
    });
    for (const row of enrolled) {
      if (row.customerId) ids.add(row.customerId);
    }
  }
  return Array.from(ids);
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

async function getCourseIdFromRun(tenantId: string, courseRunId?: string): Promise<string | undefined> {
  if (!courseRunId) return undefined;
  try {
    const run = await prisma.courseRun.findFirst({
      where: { id: courseRunId, tenantId },
      select: { courseId: true },
    });
    return run?.courseId;
  } catch (error) {
    if (!isMissingCourseRunsTableError(error)) {
      throw error;
    }
    return undefined;
  }
}

async function resolveRunMemberCustomerIds(params: {
  tenantId: string;
  courseRunId: string;
  courseId: string;
}): Promise<string[]> {
  const { tenantId, courseRunId, courseId } = params;

  try {
    const explicit = await prisma.courseRunMember.findMany({
      where: { tenantId, courseRunId },
      select: { customerId: true },
    });
    if (explicit.length > 0) {
      return explicit.map((row) => row.customerId);
    }
  } catch (error) {
    if (!isMissingCourseRunMembersTableError(error)) {
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
  exerciseCourseId?: string;
  courseRunId?: string;
  kuratorUserId?: string;
}): Promise<Map<string, StudentPerformance>> {
  const { tenantId, customerIds, dateRange, exerciseCourseId, courseRunId, kuratorUserId } = params;
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
    exerciseCourseId && !courseRunId
      ? { ...attendanceBaseWhere, courseRun: { courseId: exerciseCourseId } }
      : attendanceBaseWhere;
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
    if (!(exerciseCourseId && !courseRunId && isMissingCourseRunsTableError(error))) {
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
    ...(exerciseCourseId
      ? { exerciseDefinition: { courseId: exerciseCourseId } }
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
    if (!isMissingCourseRunsTableError(error)) {
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

      // Derive (kurator, customer) pairs from run-level kurator links so that
      // future enrollments not yet in the per-customer table are still counted.
      const ownedRuns = await prisma.courseRun.findMany({
        where: {
          tenantId,
          kuratorUserId: { not: null },
          ...(input.courseRunId ? { id: input.courseRunId } : {}),
          ...(!adminOrManager ? { kuratorUserId: user.userId } : {}),
        },
        select: { id: true, courseId: true, kuratorUserId: true },
      });

      const runDerivedPairs: Array<{ kuratorUserId: string; customerId: string }> = [];
      if (ownedRuns.length > 0) {
        const courseToKurators = new Map<string, Set<string>>();
        for (const run of ownedRuns) {
          if (!run.kuratorUserId) continue;
          const set = courseToKurators.get(run.courseId) ?? new Set<string>();
          set.add(run.kuratorUserId);
          courseToKurators.set(run.courseId, set);
        }
        const enrolledIncomes = await prisma.income.findMany({
          where: {
            tenantId,
            courseId: { in: Array.from(courseToKurators.keys()) },
            ...ACTIVE_ENROLLMENT_FILTER,
            ...(scopedStudentIds ? { customerId: { in: scopedStudentIds } } : {}),
          },
          select: { customerId: true, courseId: true },
          distinct: ['customerId', 'courseId'],
        });
        for (const row of enrolledIncomes) {
          if (!row.customerId || !row.courseId) continue;
          const kuratorSet = courseToKurators.get(row.courseId) ?? new Set<string>();
          for (const kuratorUserId of kuratorSet) {
            runDerivedPairs.push({ kuratorUserId, customerId: row.customerId });
          }
        }
      }

      const studentIdsByKurator = new Map<string, Set<string>>();
      const kuratorsByStudent = new Map<string, string[]>();
      const upsertPair = (kuratorUserId: string, customerId: string) => {
        const studentSet = studentIdsByKurator.get(kuratorUserId) ?? new Set<string>();
        studentSet.add(customerId);
        studentIdsByKurator.set(kuratorUserId, studentSet);

        const linkedKurators = kuratorsByStudent.get(customerId) ?? [];
        if (!linkedKurators.includes(kuratorUserId)) {
          linkedKurators.push(kuratorUserId);
        }
        kuratorsByStudent.set(customerId, linkedKurators);
      };
      for (const assignment of assignments) {
        upsertPair(assignment.kuratorUserId, assignment.customerId);
      }
      for (const pair of runDerivedPairs) {
        upsertPair(pair.kuratorUserId, pair.customerId);
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
      const runCourseId = await getCourseIdFromRun(tenantId, input.courseRunId);
      const effectiveExerciseCourseId = input.courseId ?? runCourseId;

      let perfMap = new Map<string, StudentPerformance>();
      try {
        perfMap = await buildStudentPerformanceMap({
          tenantId,
          customerIds: pageIds,
          dateRange,
          exerciseCourseId: effectiveExerciseCourseId,
          courseRunId: input.courseRunId,
        });
      } catch (error) {
        if (!isMissingOptionalPerformanceSchemaError(error)) {
          throw error;
        }
      }

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
      const runCourseId = await getCourseIdFromRun(tenantId, input.courseRunId);
      const effectiveExerciseCourseId = input.courseId ?? runCourseId;
      let perfMap = new Map<string, StudentPerformance>();
      try {
        perfMap = await buildStudentPerformanceMap({
          tenantId,
          customerIds: [input.customerId],
          dateRange,
          exerciseCourseId: effectiveExerciseCourseId,
          courseRunId: input.courseRunId,
        });
      } catch (error) {
        if (!isMissingOptionalPerformanceSchemaError(error)) {
          throw error;
        }
      }

      const taskWhere: Record<string, unknown> = {
        tenantId,
        customerId: input.customerId,
        ...(dateRange ? { createdAt: { gte: dateRange.from, lt: dateRange.to } } : {}),
      };

      let recentTasks: Array<{
        id: string;
        title: string;
        dueDate: Date | null;
        completedAt: Date | null;
        createdAt: Date;
        kurator: { id: string; name: string | null; username: string | null } | null;
      }> = [];
      try {
        recentTasks = await prisma.kuratorTask.findMany({
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
      } catch (error) {
        if (!isMissingOptionalPerformanceSchemaError(error)) {
          throw error;
        }
      }

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
        if (isMissingOptionalPerformanceSchemaError(error)) {
          recentAttendance = [];
        } else
        if (!(input.courseId && !input.courseRunId && isMissingCourseRunsTableError(error))) {
          throw error;
        } else {
          recentAttendance = await prisma.classAttendance.findMany({
            where: attendanceBaseWhere,
            select: { id: true, lessonDate: true, attended: true, lessonType: true },
            orderBy: { lessonDate: 'desc' },
            take: 50,
          });
        }
      }

      const exerciseWhere: Record<string, unknown> = {
        tenantId,
        customerId: input.customerId,
        ...(dateRange ? { completedAt: { gte: dateRange.from, lt: dateRange.to } } : {}),
        ...(effectiveExerciseCourseId
          ? { exerciseDefinition: { courseId: effectiveExerciseCourseId } }
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
        if (isMissingOptionalPerformanceSchemaError(error)) {
          recentExercises = [];
        } else
        if (!(input.courseId && !input.courseRunId && isMissingCourseRunsTableError(error))) {
          throw error;
        } else {
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
      }

      const homeworkDefinitionsWhere: Record<string, unknown> = {
        tenantId,
        isActive: true,
        type: 'homework',
      };
      if (effectiveExerciseCourseId) {
        homeworkDefinitionsWhere.courseId = effectiveExerciseCourseId;
      } else {
        const incomeCourseIds = Array.from(new Set(customer.incomes.map((income) => income.courseId).filter(Boolean)));
        if (incomeCourseIds.length > 0) {
          homeworkDefinitionsWhere.courseId = { in: incomeCourseIds };
        }
      }

      const [homeworkDefinitions, completedHomeworkCount] = await Promise.all([
        prisma.exerciseDefinition.findMany({
          where: homeworkDefinitionsWhere as any,
          select: { targetCount: true },
        }),
        prisma.studentExerciseLog.count({
          where: {
            tenantId,
            customerId: input.customerId,
            ...(dateRange ? { completedAt: { gte: dateRange.from, lt: dateRange.to } } : {}),
            exerciseDefinition: {
              type: 'homework',
              ...(effectiveExerciseCourseId ? { courseId: effectiveExerciseCourseId } : {}),
            },
          } as any,
        }),
      ]);
      const homeworkTotalCount = homeworkDefinitions.reduce((sum, row) => sum + row.targetCount, 0);
      const homeworkPendingCount = Math.max(0, homeworkTotalCount - completedHomeworkCount);

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
        homeworkSummary: {
          completed: completedHomeworkCount,
          pending: homeworkPendingCount,
          total: homeworkTotalCount,
        },
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
      const runCourseId = await getCourseIdFromRun(tenantId, input.courseRunId);
      const effectiveExerciseCourseId = input.courseId ?? runCourseId;

      const scopedIds = await getCustomersScopedToKurator({
        tenantId,
        kuratorUserId: input.kuratorUserId,
        courseRunId: input.courseRunId,
      });
      const studentIds = courseScopedIds
        ? scopedIds.filter((id) => courseScopedIds.includes(id))
        : scopedIds;
      const perfMap = await buildStudentPerformanceMap({
        tenantId,
        customerIds: studentIds,
        dateRange,
        exerciseCourseId: effectiveExerciseCourseId,
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

  amaliyReportMatrix: managerProcedure
    .input(
      z.object({
        courseId: z.string(),
        courseRunId: z.string().optional(),
        tariffId: z.string().optional(),
        kuratorUserId: z.string().optional(),
        datePreset: amaliyReportDatePresetSchema.default('today'),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { tenantId } = ctx;

      let course = await prisma.course.findFirst({
        where: { id: input.courseId, tenantId, isActive: true },
        select: { id: true, name: true, startDate: true, endDate: true },
      }).catch(async (error) => {
        if (!isMissingCourseEndDateColumnError(error)) {
          throw error;
        }
        const fallback = await prisma.course.findFirst({
          where: { id: input.courseId, tenantId, isActive: true },
          select: { id: true, name: true, startDate: true },
        });
        return fallback ? { ...fallback, endDate: null as Date | null } : null;
      });
      if (!course) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Kurs topilmadi' });
      }

      const selectedRun = input.courseRunId
        ? await prisma.courseRun.findFirst({
            where: {
              id: input.courseRunId,
              courseId: input.courseId,
              tenantId,
            },
            select: {
              id: true,
              name: true,
              courseId: true,
              startDate: true,
              endDate: true,
              kuratorUserId: true,
            },
          })
        : null;

      if (input.courseRunId && !selectedRun) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Kurs oqimi topilmadi' });
      }

      const latestRunForCourse = selectedRun
        ? selectedRun
        : await prisma.courseRun.findFirst({
            where: {
              tenantId,
              courseId: input.courseId,
            },
            select: {
              id: true,
              name: true,
              courseId: true,
              startDate: true,
              endDate: true,
              kuratorUserId: true,
            },
            orderBy: { startDate: 'desc' },
          });

      const todayStart = startOfDayLocal(new Date());
      const courseStart = course.startDate ? startOfDayLocal(course.startDate) : null;
      const courseEndExclusive = course.endDate ? addDays(startOfDayLocal(course.endDate), 1) : null;

      const runAnchorStart = latestRunForCourse
        ? startOfDayLocal(latestRunForCourse.startDate)
        : (courseStart ?? todayStart);
      const runAnchorEndExclusive = latestRunForCourse
        ? (
            selectedRun
              ? addDays(startOfDayLocal(latestRunForCourse.endDate), 1)
              : maxDate(addDays(startOfDayLocal(latestRunForCourse.endDate), 1), addDays(todayStart, 1))
          )
        : addDays(runAnchorStart, 42);

      // Course dates are authoritative for report windows; run selection only scopes student group.
      const useCourseAnchors = Boolean(courseStart);
      const anchorRunStart = useCourseAnchors ? (courseStart as Date) : runAnchorStart;
      const anchorRunEndExclusive = useCourseAnchors
        ? (
            courseEndExclusive && courseEndExclusive.getTime() > anchorRunStart.getTime()
              ? courseEndExclusive
              : maxDate(runAnchorEndExclusive, addDays(anchorRunStart, 1))
          )
        : runAnchorEndExclusive;

      let dateRange: { from: Date; to: Date };

      if (input.datePreset === 'today') {
        dateRange = { from: todayStart, to: addDays(todayStart, 1) };
      } else if (useCourseAnchors) {
        dateRange = resolveAmaliyReportDateRange({
          datePreset: input.datePreset,
          runStart: anchorRunStart,
          runEndExclusive: anchorRunEndExclusive,
        });
      } else if (latestRunForCourse) {
        dateRange = resolveAmaliyReportDateRange({
          datePreset: input.datePreset,
          runStart: anchorRunStart,
          runEndExclusive: anchorRunEndExclusive,
        });
      } else {
        dateRange =
          input.datePreset === 'all'
            ? { from: anchorRunStart, to: addDays(todayStart, 1) }
            : { from: todayStart, to: addDays(todayStart, 1) };
      }

      const weekRanges = resolveAmaliyWeekRanges({
        runStart: anchorRunStart,
        runEndExclusive: anchorRunEndExclusive,
      });
      const activeWeekRange: { from: Date; to: Date } | null =
        AMALIY_WEEK_KEYS.includes(input.datePreset as AmaliyWeekKey)
          ? weekRanges[input.datePreset as AmaliyWeekKey]
          : null;
      const activeWeekDays = activeWeekRange ? enumerateDateRange(activeWeekRange) : [];

      let assignedStudentIds: string[] = [];
      if (selectedRun) {
        assignedStudentIds = await resolveRunMemberCustomerIds({
          tenantId,
          courseRunId: selectedRun.id,
          courseId: selectedRun.courseId,
        });
      } else {
        const enrolled = await prisma.income.findMany({
          where: {
            tenantId,
            courseId: input.courseId,
            ...ACTIVE_ENROLLMENT_FILTER,
          },
          select: { customerId: true },
          distinct: ['customerId'],
        });
        assignedStudentIds = enrolled.map((row) => row.customerId).filter((id): id is string => Boolean(id));
      }

      if (input.kuratorUserId) {
        const kuratorScopedIds = await getCustomersScopedToKurator({
          tenantId,
          kuratorUserId: input.kuratorUserId,
          courseRunId: selectedRun?.id,
        });
        const scopedSet = new Set(kuratorScopedIds);
        assignedStudentIds = assignedStudentIds.filter((id) => scopedSet.has(id));
      }

      const kuratorsByStudent = new Map<string, Set<string>>();
      const assignments = await prisma.kuratorAssignment.findMany({
        where: {
          tenantId,
          isActive: true,
          ...(selectedRun ? { courseRunId: selectedRun.id } : { courseRun: { courseId: input.courseId } }),
        },
        select: {
          customerId: true,
          kurator: { select: { id: true, name: true, username: true } },
        },
      });

      for (const row of assignments) {
        const kuratorName = row.kurator.name ?? row.kurator.username ?? 'Kurator';
        const current = kuratorsByStudent.get(row.customerId) ?? new Set<string>();
        current.add(kuratorName);
        kuratorsByStudent.set(row.customerId, current);
      }

      const latestTariffByStudent = new Map<string, { tariffId: string | null; tariffName: string | null }>();
      if (assignedStudentIds.length > 0) {
        const incomes = await prisma.income.findMany({
          where: {
            tenantId,
            customerId: { in: assignedStudentIds },
            courseId: input.courseId,
            ...ACTIVE_ENROLLMENT_FILTER,
          },
          select: {
            customerId: true,
            tariffId: true,
            tariff: { select: { name: true } },
            entryDate: true,
          },
          orderBy: [{ customerId: 'asc' }, { entryDate: 'desc' }],
        });

        for (const income of incomes) {
          if (!latestTariffByStudent.has(income.customerId)) {
            latestTariffByStudent.set(income.customerId, {
              tariffId: income.tariffId,
              tariffName: income.tariff?.name ?? null,
            });
          }
        }
      }

      const filteredStudentIds = input.tariffId
        ? assignedStudentIds.filter((customerId) => latestTariffByStudent.get(customerId)?.tariffId === input.tariffId)
        : assignedStudentIds;

      const practices = await prisma.exerciseDefinition.findMany({
        where: {
          tenantId,
          courseId: input.courseId,
          isActive: true,
        },
        select: {
          id: true,
          name: true,
          type: true,
          orderIndex: true,
        },
        orderBy: [{ orderIndex: 'asc' }, { createdAt: 'asc' }],
      });

      const students = filteredStudentIds.length
        ? await prisma.customer.findMany({
            where: {
              tenantId,
              id: { in: filteredStudentIds },
            },
            select: {
              id: true,
              name: true,
              customerNumber: true,
            },
            orderBy: { name: 'asc' },
          })
        : [];

      const practiceIds = practices.map((practice) => practice.id);
      const shouldLoadLogs =
        students.length > 0 &&
        practiceIds.length > 0 &&
        dateRange.from.getTime() < dateRange.to.getTime();

      const logs = shouldLoadLogs
        ? await prisma.studentExerciseLog.findMany({
            where: {
              tenantId,
              customerId: { in: students.map((student) => student.id) },
              exerciseDefinitionId: { in: practiceIds },
              completedAt: { gte: dateRange.from, lt: dateRange.to },
            },
            select: {
              customerId: true,
              exerciseDefinitionId: true,
              points: true,
              colorHex: true,
              completedAt: true,
              createdAt: true,
            },
            orderBy: [{ completedAt: 'desc' }, { createdAt: 'desc' }],
          })
        : [];

      const sumPointsByCell = new Map<string, number>();
      const latestColorByCell = new Map<string, string | null>();
      const seenLogsByCell = new Set<string>();
      const weekPointsByCell = new Map<string, Record<AmaliyWeekKey, number>>();
      const weekHasLogsByCell = new Map<string, Record<AmaliyWeekKey, boolean>>();
      const weekColorStatsByCell = new Map<
        string,
        Record<AmaliyWeekKey, Map<string, { count: number; latestRank: number }>>
      >();
      const dayPointsByCell = new Map<string, Map<string, number>>();
      const dayHasLogsByCell = new Map<string, Map<string, boolean>>();
      const dayColorByCell = new Map<string, Map<string, string | null>>();
      const practiceTypeById = new Map(practices.map((practice) => [practice.id, practice.type]));

      for (let idx = 0; idx < logs.length; idx += 1) {
        const log = logs[idx];
        const practiceType = practiceTypeById.get(log.exerciseDefinitionId);
        if (!practiceType) continue;

        const completedDay = startOfDayLocal(log.completedAt);
        if (!isAmaliyPracticeEligibleOnDate(practiceType, completedDay)) {
          continue;
        }

        const key = `${log.customerId}:${log.exerciseDefinitionId}`;
        const pointValue = log.points ?? 0;
        sumPointsByCell.set(key, (sumPointsByCell.get(key) ?? 0) + pointValue);
        seenLogsByCell.add(key);
        if (!latestColorByCell.has(key)) {
          latestColorByCell.set(key, log.colorHex ?? null);
        }

        const weekPoints = weekPointsByCell.get(key) ?? {
          week1: 0,
          week2: 0,
          week3: 0,
          week4: 0,
          week5: 0,
          week6: 0,
        };
        const weekHasLogs = weekHasLogsByCell.get(key) ?? {
          week1: false,
          week2: false,
          week3: false,
          week4: false,
          week5: false,
          week6: false,
        };
        const weekColorStats = weekColorStatsByCell.get(key) ?? {
          week1: new Map<string, { count: number; latestRank: number }>(),
          week2: new Map<string, { count: number; latestRank: number }>(),
          week3: new Map<string, { count: number; latestRank: number }>(),
          week4: new Map<string, { count: number; latestRank: number }>(),
          week5: new Map<string, { count: number; latestRank: number }>(),
          week6: new Map<string, { count: number; latestRank: number }>(),
        };
        let matchedWeek = false;
        for (const weekKey of AMALIY_WEEK_KEYS) {
          if (isDateInRange(completedDay, weekRanges[weekKey])) {
            weekPoints[weekKey] += pointValue;
            weekHasLogs[weekKey] = true;
            matchedWeek = true;
            if (log.colorHex) {
              const bucket = weekColorStats[weekKey];
              const current = bucket.get(log.colorHex);
              if (current) {
                current.count += 1;
              } else {
                bucket.set(log.colorHex, { count: 1, latestRank: idx });
              }
            }
          }
        }
        if (!matchedWeek && input.datePreset === 'all' && isDateInRange(completedDay, dateRange)) {
          weekPoints.week6 += pointValue;
          weekHasLogs.week6 = true;
          if (log.colorHex) {
            const bucket = weekColorStats.week6;
            const current = bucket.get(log.colorHex);
            if (current) {
              current.count += 1;
            } else {
              bucket.set(log.colorHex, { count: 1, latestRank: idx });
            }
          }
        }
        weekPointsByCell.set(key, weekPoints);
        weekHasLogsByCell.set(key, weekHasLogs);
        weekColorStatsByCell.set(key, weekColorStats);

        if (activeWeekRange && isDateInRange(completedDay, activeWeekRange)) {
          const dayMap = dayPointsByCell.get(key) ?? new Map<string, number>();
          const dayHasLogs = dayHasLogsByCell.get(key) ?? new Map<string, boolean>();
          const dayColors = dayColorByCell.get(key) ?? new Map<string, string | null>();
          const dayKey = toDayKey(completedDay);
          dayMap.set(dayKey, (dayMap.get(dayKey) ?? 0) + pointValue);
          dayHasLogs.set(dayKey, true);
          if (!dayColors.has(dayKey)) {
            dayColors.set(dayKey, log.colorHex ?? null);
          }
          dayPointsByCell.set(key, dayMap);
          dayHasLogsByCell.set(key, dayHasLogs);
          dayColorByCell.set(key, dayColors);
        }
      }

      const weekApplicabilityByPracticeId = new Map<string, Record<AmaliyWeekKey, boolean>>();
      const dayApplicabilityByPracticeId = new Map<string, Map<string, boolean>>();
      for (const practice of practices) {
        const weekApplicability: Record<AmaliyWeekKey, boolean> = {
          week1: false,
          week2: false,
          week3: false,
          week4: false,
          week5: false,
          week6: false,
        };
        for (const weekKey of AMALIY_WEEK_KEYS) {
          const weekDays = enumerateDateRange(weekRanges[weekKey]);
          weekApplicability[weekKey] = weekDays.some((day) =>
            isAmaliyPracticeEligibleOnDate(practice.type, new Date(`${day.date}T00:00:00`)),
          );
        }
        weekApplicabilityByPracticeId.set(practice.id, weekApplicability);

        const dayApplicability = new Map<string, boolean>();
        for (const day of activeWeekDays) {
          dayApplicability.set(
            day.date,
            isAmaliyPracticeEligibleOnDate(practice.type, new Date(`${day.date}T00:00:00`)),
          );
        }
        dayApplicabilityByPracticeId.set(practice.id, dayApplicability);
      }

      const rows = students.map((student) => {
        const cells: Record<
          string,
          {
            points: number;
            totalPoints: number;
            colorHex: string | null;
            hasLogs: boolean;
            weekPoints: Record<AmaliyWeekKey, number>;
            weekColors: Record<AmaliyWeekKey, string | null>;
            dayPoints: Array<{ date: string; label: string; points: number }>;
            dayStats: Array<{
              date: string;
              label: string;
              points: number;
              hasLog: boolean;
              colorHex: string | null;
              isApplicable: boolean;
            }>;
            weekStats: Record<
              AmaliyWeekKey,
              { points: number; hasLog: boolean; colorHex: string | null; isApplicable: boolean }
            >;
          }
        > = {};
        let totalPoints = 0;

        for (const practice of practices) {
          const key = `${student.id}:${practice.id}`;
          const points = sumPointsByCell.get(key) ?? 0;
          const colorHex = latestColorByCell.get(key) ?? null;
          const hasLogs = seenLogsByCell.has(key);
          const weekPoints = weekPointsByCell.get(key) ?? {
            week1: 0,
            week2: 0,
            week3: 0,
            week4: 0,
            week5: 0,
            week6: 0,
          };
          const weekHasLogs = weekHasLogsByCell.get(key) ?? {
            week1: false,
            week2: false,
            week3: false,
            week4: false,
            week5: false,
            week6: false,
          };
          const weekColorStats = weekColorStatsByCell.get(key) ?? {
            week1: new Map<string, { count: number; latestRank: number }>(),
            week2: new Map<string, { count: number; latestRank: number }>(),
            week3: new Map<string, { count: number; latestRank: number }>(),
            week4: new Map<string, { count: number; latestRank: number }>(),
            week5: new Map<string, { count: number; latestRank: number }>(),
            week6: new Map<string, { count: number; latestRank: number }>(),
          };
          const weekColors: Record<AmaliyWeekKey, string | null> = {
            week1: null,
            week2: null,
            week3: null,
            week4: null,
            week5: null,
            week6: null,
          };
          const weekStats: Record<
            AmaliyWeekKey,
            { points: number; hasLog: boolean; colorHex: string | null; isApplicable: boolean }
          > = {
            week1: { points: weekPoints.week1, hasLog: weekHasLogs.week1, colorHex: null, isApplicable: false },
            week2: { points: weekPoints.week2, hasLog: weekHasLogs.week2, colorHex: null, isApplicable: false },
            week3: { points: weekPoints.week3, hasLog: weekHasLogs.week3, colorHex: null, isApplicable: false },
            week4: { points: weekPoints.week4, hasLog: weekHasLogs.week4, colorHex: null, isApplicable: false },
            week5: { points: weekPoints.week5, hasLog: weekHasLogs.week5, colorHex: null, isApplicable: false },
            week6: { points: weekPoints.week6, hasLog: weekHasLogs.week6, colorHex: null, isApplicable: false },
          };
          for (const weekKey of AMALIY_WEEK_KEYS) {
            let bestColor: string | null = null;
            let bestCount = -1;
            let bestRank = Number.POSITIVE_INFINITY;
            for (const [colorHex, info] of weekColorStats[weekKey]) {
              if (
                info.count > bestCount ||
                (info.count === bestCount && info.latestRank < bestRank)
              ) {
                bestColor = colorHex;
                bestCount = info.count;
                bestRank = info.latestRank;
              }
            }
            weekColors[weekKey] = bestColor;
            weekStats[weekKey].colorHex = bestColor;
            weekStats[weekKey].isApplicable =
              weekApplicabilityByPracticeId.get(practice.id)?.[weekKey] ?? false;
          }
          const dayPointMap = dayPointsByCell.get(key) ?? new Map<string, number>();
          const dayHasLogs = dayHasLogsByCell.get(key) ?? new Map<string, boolean>();
          const dayColors = dayColorByCell.get(key) ?? new Map<string, string | null>();
          const dayStats = activeWeekDays.map((day) => ({
            date: day.date,
            label: day.label,
            points: dayPointMap.get(day.date) ?? 0,
            hasLog: dayHasLogs.get(day.date) ?? false,
            colorHex: dayColors.get(day.date) ?? null,
            isApplicable: dayApplicabilityByPracticeId.get(practice.id)?.get(day.date) ?? false,
          }));
          const dayPoints = dayStats.map((day) => ({
            date: day.date,
            label: day.label,
            points: day.points,
          }));

          cells[practice.id] = {
            points,
            totalPoints: points,
            colorHex,
            hasLogs,
            weekPoints,
            weekColors,
            dayPoints,
            dayStats,
            weekStats,
          };
          // "extra" (Qo'shimcha mashqlar) is displayed in report cells
          // but excluded from the aggregated Jami ball.
          if (practice.type !== 'extra') {
            totalPoints += points;
          }
        }

        return {
          id: student.id,
          name: student.name,
          customerNumber: student.customerNumber,
          tariffName: latestTariffByStudent.get(student.id)?.tariffName ?? null,
          kuratorNames: Array.from(kuratorsByStudent.get(student.id) ?? []).sort((a, b) => a.localeCompare(b)),
          cells,
          totalPoints,
        };
      });

      return {
        meta: {
          courseId: course.id,
          courseName: course.name,
          courseRunId: selectedRun?.id ?? null,
          courseRunName: selectedRun?.name ?? null,
          datePreset: input.datePreset,
          dateFrom: toDateLabel(dateRange.from),
          dateToExclusive: toDateLabel(dateRange.to),
          dateToInclusive:
            dateRange.to.getTime() > dateRange.from.getTime() ? toDateLabel(addDays(dateRange.to, -1)) : null,
        },
        practices,
        students: rows,
      };
    }),

  courseRuns: protectedProcedure.query(async ({ ctx }) => {
    try {
      return await prisma.courseRun.findMany({
        where: { tenantId: ctx.tenantId, course: { isActive: true } },
        include: { course: { select: { name: true, category: true, isActive: true } } },
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
